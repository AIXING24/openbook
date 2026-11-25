import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {massiveProbeRequests, assessMassiveSummary, assessMassiveHistory} from '../massive-evidence.mjs';
import {requestMassiveJson} from './massive-http.mjs';

const baseline = JSON.parse(readFileSync(new URL('../massive-free-probes-v0.3.5.json', import.meta.url), 'utf8'));
const file = new URL('../.massive-secrets.local.json', import.meta.url), metadata = lstatSync(file);
if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) throw new Error('Unsafe local secret configuration');
const key = JSON.parse(readFileSync(file, 'utf8')).MASSIVE_API_KEY;
const report = {version: 'backend v0.3.6 candidate', startedAt: new Date().toISOString(), baselineCompletedAt: baseline.completedAt, publicSampleOnly: true, productionWrites: false, cloudDeployment: false, probes: []};
for (const request of massiveProbeRequests(baseline.context).filter(value => ['summary', 'history'].includes(value.kind))) {
  if (report.probes.length) await sleep(13000);
  const probe = {kind: request.kind, observedAt: new Date().toISOString()};
  try {
    const response = await requestMassiveJson(request.path, key);
    probe.httpStatus = response.httpStatus;
    if (response.httpStatus !== 200) {probe.status = 'pending'; probe.reason = 'upstream-request-not-successful';}
    else {
      const payload = response.payload, result = request.kind === 'summary' ? assessMassiveSummary(payload, baseline.context) : assessMassiveHistory(payload, baseline.context);
      Object.assign(probe, result);
      if (result.status === 'valid-candidate') {
        const selected = request.kind === 'summary' ? {symbol: payload.symbol, from: payload.from, close: payload.close} : payload.results;
        probe.selectedDataHash = createHash('sha256').update(JSON.stringify(selected)).digest('hex');
        probe.sameAsBaseline = probe.selectedDataHash === baseline.probes.find(value => value.kind === request.kind)?.selectedDataHash;
      }
    }
  } catch {probe.status = 'pending'; probe.reason = 'source-or-evidence-unavailable';}
  report.probes.push(probe);
  console.log(JSON.stringify(probe));
  if ([401, 429].includes(probe.httpStatus)) break;
}
report.completedAt = new Date().toISOString();
report.allObservedUnchanged = report.probes.length === 2 && report.probes.every(probe => probe.sameAsBaseline === true);
report.limitations = 'Two reads at distinct times of one ticker. No change in selected fields during this interval is not a finality/revision guarantee. The next market-close/07:00 Beijing readiness window has not been observed; no historical observation timestamp is fabricated.';
writeFileSync(new URL('../massive-stability-v0.3.6.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
