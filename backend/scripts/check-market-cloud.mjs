import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {isIP} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';

try {
const session = JSON.parse(readFileSync('.market-session.local.json', 'utf8'));
const hostname = 'gaintrace-market-validation.aixing24-gaintrace.workers.dev';
const baseline = JSON.parse(readFileSync('massive-free-probes-v0.3.5.json', 'utf8'));
const response = await fetch('https://cloudflare-dns.com/dns-query?name=' + hostname + '&type=A', {headers: {accept: 'application/dns-json'}, redirect: 'error', signal: AbortSignal.timeout(20000)});
const dns = await response.json(), address = dns.Answer?.find(answer => answer.type === 1 && answer.name.replace(/\.$/, '') === hostname && isIP(answer.data) === 4)?.data;
if (!response.ok || !address || session.name !== 'gaintrace-market-validation' || !/^[a-f0-9]{64}$/.test(session.validationToken) || !Number.isFinite(Date.parse(session.expiresAt)) || Date.now() >= Date.parse(session.expiresAt)) throw Error('Isolated HTTPS route unavailable');
const report = {version: 'backend v0.3.6 candidate', startedAt: new Date().toISOString(), transport: 'diagnostic official DoH with original hostname and TLS validation', mobileBrowserAccessProven: false, firstRequestColdStartProven: false, productionWrites: false, stages: []};
const stages = session.withSourceKey ? ['evidence-50', 'evidence-5', 'summary', 'history', 'fx', 'today-readiness', 'unauthorized'] : ['evidence-50', 'evidence-5', 'fx', 'today-readiness', 'unauthorized', 'source-secret-missing'];
for (const kind of stages) {
  const startedAt = new Date().toISOString(), path = '/validation/market?kind=' + (['unauthorized', 'source-secret-missing'].includes(kind) ? 'summary' : kind);
  const configuration = 'url = "https://' + hostname + path + '"\n' + (kind === 'unauthorized' ? '' : 'header = "Authorization: Bearer ' + session.validationToken + '"\n');
  const result = await new Promise(resolve => {
    const child = execFile('/usr/bin/curl', ['--disable', '--config', '-', '--resolve', hostname + ':443:' + address, '--silent', '--show-error', '--max-time', '35', '--proto', '=https', '--max-redirs', '0', '--write-out', '\n%{http_code}'], {maxBuffer: 100000, timeout: 40000}, (error, stdout) => {
      if (error) return resolve({status: 'unavailable', rawOutputWithheld: true});
      const boundary = stdout.lastIndexOf('\n'), httpStatus = Number(stdout.slice(boundary + 1));
      try {
        const payload = JSON.parse(stdout.slice(0, boundary));
        resolve({httpStatus, payload});
      } catch {resolve({httpStatus, status: 'non-json-response', rawOutputWithheld: true});}
    });
    child.stdin.on('error', () => resolve({status: 'unavailable', rawOutputWithheld: true}));
    child.stdin.end(configuration);
  });
  const stage = {kind, startedAt, completedAt: new Date().toISOString(), ...result};
  if (['summary', 'history'].includes(kind) && result.payload?.selectedDataHash) stage.sameAsLocalBaseline = result.payload.selectedDataHash === baseline.probes.find(probe => probe.kind === kind)?.selectedDataHash;
  report.stages.push(stage);
  writeFileSync('market-cloud-checks-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(stage));
  if (kind !== stages.at(-1)) await sleep(13000);
}
report.completedAt = new Date().toISOString();
report.cpuMeasured = false;
report.limitations = 'Elapsed network/request time is not CPU. First request after secret deployment is not proof of cold start. Diagnostic DoH access is not ordinary mobile workers.dev availability. No production ledger activation.';
writeFileSync('market-cloud-checks-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
} catch {
  console.error('Isolated cloud checks unavailable; raw credentials and responses withheld.');
  process.exitCode = 1;
}
