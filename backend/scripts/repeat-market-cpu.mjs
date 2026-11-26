import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {validationReportPrefix, repeatedMarketKinds} from '../market-cpu-repeat.mjs';

try {
  const session = JSON.parse(readFileSync('.market-session.local.json', 'utf8'));
  const prefix = validationReportPrefix(session), kinds = repeatedMarketKinds(session.runId);
  const hostname = 'gaintrace-market-validation.aixing24-gaintrace.workers.dev';
  if (session.name !== 'gaintrace-market-validation' || session.withSourceKey !== false || !/^[a-f0-9]{64}$/.test(session.validationToken) || !Number.isFinite(Date.parse(session.expiresAt)) || Date.now() >= Date.parse(session.expiresAt)) throw Error('Repeated isolation unavailable');
  if (session.runId === 'cpu-repeat-02') {
    const previous = JSON.parse(readFileSync('market-cpu-repeat-01-checks-v0.3.6.json', 'utf8'));
    if (previous.runId !== 'cpu-repeat-01' || !Number.isFinite(Date.parse(previous.completedAt))) throw Error('Prior bounded window unavailable');
    const earliest = Math.ceil(Date.parse(previous.completedAt) / 60000) * 60000 + 1000;
    if (Date.now() < earliest) await sleep(earliest - Date.now());
  }
  const response = await fetch('https://cloudflare-dns.com/dns-query?name=' + hostname + '&type=A', {headers: {accept: 'application/dns-json'}, redirect: 'error', signal: AbortSignal.timeout(20000)});
  const dns = await response.json();
  const address = dns.Answer?.find(answer => answer.type === 1 && answer.name.replace(/\.$/, '') === hostname && isIP(answer.data) === 4)?.data;
  if (!response.ok || !address) throw Error('Isolated diagnostic route unavailable');
  const report = {version: 'backend v0.3.6 candidate', runId: session.runId, startedAt: new Date().toISOString(), synthetic: true, sourceSecretStoredInCloudflare: false, firstRequestColdStartProven: false, mobileBrowserAccessProven: false, intervalMs: 3000, productionWrites: false, stages: []};
  for (const [index, kind] of kinds.entries()) {
    const startedAt = new Date().toISOString();
    const target = ['unauthorized', 'source-secret-missing'].includes(kind) ? 'summary' : kind;
    const configuration = 'url = "https://' + hostname + '/validation/market?kind=' + target + '"\n' + (kind === 'unauthorized' ? '' : 'header = "Authorization: Bearer ' + session.validationToken + '"\n');
    const result = await new Promise(resolve => {
      const child = execFile('/usr/bin/curl', ['--disable', '--config', '-', '--resolve', hostname + ':443:' + address, '--silent', '--show-error', '--max-time', '35', '--proto', '=https', '--max-redirs', '0', '--write-out', '\n%{http_code}'], {maxBuffer: 100000, timeout: 40000}, (error, stdout) => {
        if (error) return resolve({status: 'unavailable', rawOutputWithheld: true});
        const boundary = stdout.lastIndexOf('\n'), httpStatus = Number(stdout.slice(boundary + 1));
        try {resolve({httpStatus, payload: JSON.parse(stdout.slice(0, boundary))});} catch {resolve({httpStatus, status: 'non-json-response', rawOutputWithheld: true});}
      });
      child.stdin.on('error', () => resolve({status: 'unavailable', rawOutputWithheld: true}));
      child.stdin.end(configuration);
    });
    const passed = kind === 'unauthorized' ? result.httpStatus === 401 : kind === 'source-secret-missing' ? result.httpStatus === 503 : result.httpStatus === 200 && result.payload?.status === 'verified-candidate' && result.payload.synthetic === true && result.payload.instruments === Number(kind.slice('evidence-'.length)) && result.payload.realLedgerWrites === false;
    report.stages.push({kind, startedAt, completedAt: new Date().toISOString(), ...result, passed});
    writeFileSync(prefix + '-checks-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
    if (!passed) throw Error('Repeated stage failed; partial evidence preserved');
    if (index % 6 === 0 || index === kinds.length - 1) console.log(JSON.stringify({runId: session.runId, completedRequests: index + 1, expectedRequests: kinds.length, latestKind: kind, passed}));
    if (index < kinds.length - 1) await sleep(3000);
  }
  report.completedAt = new Date().toISOString();
  report.cpuMeasured = false;
  report.limitations = 'Elapsed request time is not CPU; authoritative CPU is captured separately. Fresh deployment is not proof of cold start. Synthetic fixtures only; no real source or production ledger.';
  writeFileSync(prefix + '-checks-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
} catch {
  console.error('Repeated isolated checks unavailable; raw credentials and responses withheld. Clean up the isolated resource before retrying.');
  process.exitCode = 1;
}
