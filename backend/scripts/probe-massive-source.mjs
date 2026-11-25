import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {massiveProbeRequests, assessMassiveSummary, assessMassiveHistory, assessMassiveActions} from '../massive-evidence.mjs';
import {requestMassiveJson} from './massive-http.mjs';

const context = {ticker: 'NVDA', from: '2025-11-25', through: '2026-11-24'};
const report = {version: 'backend v0.3.5 candidate', startedAt: new Date().toISOString(), publicSampleOnly: true, provider: 'massive', context, transport: 'macos-system-curl', tlsVerificationEnabled: true, authenticatedReadOnly: true, priceSeriesPublished: false, productionWrites: false, cloudDeployment: false, sourceApproved: false, probes: []};
let key;
try {
  const file = new URL('../.massive-secrets.local.json', import.meta.url);
  const metadata = lstatSync(file);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) throw new Error();
  key = JSON.parse(readFileSync(file, 'utf8')).MASSIVE_API_KEY;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error();
} catch {
  console.error('Safe local API key configuration is missing or invalid. No network request sent.');
  process.exit(1);
}

const requests = massiveProbeRequests(context);
let nextRequestAt = 0, summaryClose, historyClose;
for (const request of requests) {
  await sleep(Math.max(0, nextRequestAt - Date.now()));
  nextRequestAt = Date.now() + 13000;
  const probe = {kind: request.kind, endpoint: 'https://api.massive.com' + request.path, requestedAt: new Date().toISOString()};
  try {
    const response = await requestMassiveJson(request.path, key);
    probe.httpStatus = response.httpStatus;
    if (response.httpStatus < 200 || response.httpStatus >= 300) {
      probe.status = 'pending';
      probe.reason = response.httpStatus === 401 ? 'authentication-rejected' : response.httpStatus === 403 ? 'entitlement-or-request-denied' : response.httpStatus === 429 ? 'rate-limited' : 'http-error';
    } else {
      const payload = response.payload;
      const assessment = request.kind === 'summary' ? assessMassiveSummary(payload, context) : request.kind === 'history' ? assessMassiveHistory(payload, context) : assessMassiveActions(payload, context, request.kind);
      Object.assign(probe, assessment);
      if (assessment.status === 'valid-candidate') {
        const selected = request.kind === 'summary' ? {symbol: payload.symbol, from: payload.from, close: payload.close} : payload.results;
        probe.selectedDataHash = createHash('sha256').update(JSON.stringify(selected)).digest('hex');
        if (request.kind === 'summary') summaryClose = payload.close;
        if (request.kind === 'history' && assessment.lastDate === context.through) historyClose = payload.results.at(-1).c;
      }
    }
  } catch {
    probe.status = 'pending';
    probe.reason = 'network-tls-json-or-shape-unavailable';
  }
  probe.completedAt = new Date().toISOString();
  report.probes.push(probe);
  console.log(JSON.stringify(probe));
  if (probe.httpStatus === 401 || probe.httpStatus === 429) {
    report.stoppedEarly = true;
    break;
  }
}
key = undefined;
report.latestCloseComparison = {date: context.through, comparable: Number.isFinite(summaryClose) && Number.isFinite(historyClose)};
if (report.latestCloseComparison.comparable) report.latestCloseComparison.matches = Math.abs(summaryClose - historyClose) <= 1e-8;
report.completedAt = new Date().toISOString();
report.limitations = 'One personal account and one public ticker only. No full event pagination, official-calendar completeness, final/revision guarantee, rate-limit stress test, Cloudflare connectivity/CPU, public redistribution licence or production activation is established. Bar dates use New York time; aggregates are not automatically labelled final regular-session closes.';
writeFileSync(new URL('../massive-free-probes-v0.3.5.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
