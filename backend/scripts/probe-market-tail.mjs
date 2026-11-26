import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import WebSocket from 'ws';
import {validationReportPrefix} from '../market-cpu-repeat.mjs';
import {sanitizeMarketCall, assessMarketCalls, tailProbeKinds, tailProbeHost} from '../market-call-telemetry.mjs';

let socket, tailId, tailEndpoint, token, report, reportFile;
const deadline = AbortSignal.timeout(90000);
const save = () => {if (reportFile && report) writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', {flag: 'w', mode: 0o600});};
try {
  const session = JSON.parse(readFileSync('.market-session.local.json', 'utf8'));
  const original = JSON.parse(readFileSync('wrangler.local.json', 'utf8'));
  if (!['cpu-tail-probe-01', 'cpu-tail-probe-02'].includes(session.runId) || session.name !== 'gaintrace-market-validation' || session.withSourceKey !== false || !/^[a-f0-9]{64}$/.test(session.validationToken) || Date.now() >= Date.parse(session.expiresAt) || !Number.isFinite(Date.parse(session.expiresAt))) throw Error('Invalid isolated probe session');
  reportFile = validationReportPrefix(session) + '-calls-v0.3.6.json';
  report = {version: 'backend v0.3.6 candidate', runId: session.runId, startedAt: new Date().toISOString(), syntheticOnly: true, sourceSecretStoredInCloudflare: false, realLedgerWrites: false, tailSessionCreated: false, tailSessionDeleted: false, requests: [], calls: [], rawMessagesPersisted: false, signedWebSocketUrlPersisted: false};
  save();
  report.phase = 'credentials';
  const credentials = await promisify(execFile)('./node_modules/.bin/wrangler', ['auth', 'token', '--json', '--config', 'wrangler.local.json'], {maxBuffer: 100000, timeout: 15000});
  token = JSON.parse(credentials.stdout).token;
  tailEndpoint = 'https://api.cloudflare.com/client/v4/accounts/' + original.account_id + '/workers/scripts/' + session.name + '/tails';
  report.phase = 'tail-registration';
  const registration = await fetch(tailEndpoint, {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, body: '{}', redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(15000)])});
  const payload = await registration.json();
  report.registrationHttpStatus = registration.status;
  if (!registration.ok || !payload.success || typeof payload.result?.id !== 'string') throw Error('Real-time tail unavailable');
  tailId = payload.result.id;
  report.tailSessionCreated = true;
  save();
  report.phase = 'tail-endpoint-validation';
  const target = new URL(payload.result.url);
  report.endpointUsesWss = target.protocol === 'wss:';
  report.endpointHostSupported = ['.workers.dev', '.cloudflare.com'].some(suffix => target.hostname.endsWith(suffix));
  if (target.protocol !== 'wss:' || !['.workers.dev', '.cloudflare.com'].some(suffix => target.hostname.endsWith(suffix))) throw Error('Unexpected real-time log endpoint');
  const probe = randomBytes(16).toString('hex');
  report.phase = 'websocket-connection';
  socket = new WebSocket(target, 'trace-v1', {handshakeTimeout: 10000, maxPayload: 200000});
  socket.on('error', () => {});
  socket.on('message', data => {
    try {
      const call = sanitizeMarketCall(JSON.parse(data.toString()), probe);
      if (call && report.calls.length < 20) {report.calls.push(call); save();}
    } catch {}
  });
  await new Promise((resolve, reject) => {
    socket.once('error', error => reject(Error('Log connection unavailable', {cause: error})));
    socket.once('open', () => socket.send(JSON.stringify({debug: false}), error => error ? reject(Error('Log negotiation unavailable')) : resolve()));
  });
  deadline.addEventListener('abort', () => socket?.terminate(), {once: true});
  await sleep(1000, undefined, {signal: deadline});
  report.phase = 'probe-dns';
  const lookup = await fetch('https://cloudflare-dns.com/dns-query?name=' + tailProbeHost + '&type=A', {headers: {accept: 'application/dns-json'}, redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)])});
  const dns = await lookup.json();
  const address = dns.Answer?.find(answer => answer.type === 1 && answer.name.replace(/\.$/, '') === tailProbeHost && isIP(answer.data) === 4)?.data;
  if (!lookup.ok || !address) throw Error('Probe route unavailable');
  report.phase = 'synthetic-requests';
  for (const [index, kind] of tailProbeKinds.entries()) {
    deadline.throwIfAborted();
    const startedAt = new Date().toISOString();
    const configuration = 'url = "https://' + tailProbeHost + '/validation/market?kind=' + kind + '&probe=' + probe + '&seq=' + (index + 1) + '"\nheader = "Authorization: Bearer ' + session.validationToken + '"\n';
    const result = await new Promise((resolve, reject) => {
      const child = execFile('/usr/bin/curl', ['--disable', '--config', '-', '--resolve', tailProbeHost + ':443:' + address, '--silent', '--show-error', '--max-time', '15', '--proto', '=https', '--max-redirs', '0', '--write-out', '\n%{http_code}'], {maxBuffer: 100000, timeout: 18000, signal: deadline}, (error, stdout) => {
        if (error) return reject(Error('Probe request unavailable'));
        try {
          const boundary = stdout.lastIndexOf('\n');
          const body = JSON.parse(stdout.slice(0, boundary));
          const httpStatus = Number(stdout.slice(boundary + 1));
          resolve({httpStatus, passed: httpStatus === 200 && body.status === 'verified-candidate' && body.synthetic === true && body.instruments === Number(kind.slice('evidence-'.length)) && body.realLedgerWrites === false});
        } catch {reject(Error('Probe response unavailable'));}
      });
      child.stdin.on('error', () => reject(Error('Probe input unavailable')));
      child.stdin.end(configuration);
    });
    report.requests.push({sequence: index + 1, kind, startedAt, completedAt: new Date().toISOString(), ...result});
    save();
    if (!result.passed) throw Error('Probe functional check failed');
    await sleep(1000, undefined, {signal: deadline});
  }
  report.phase = 'log-wait';
  for (let attempt = 0; attempt < 20 && report.calls.length < 3; attempt++) await sleep(500, undefined, {signal: deadline});
  report.completedAt = new Date().toISOString();
  report.phase = 'completed';
  report.observation = assessMarketCalls(report.calls);
  report.limitations = 'Real-time logs are not durable and may be sampled. Only documented $workers.cpuTimeMs is accepted as CPU; elapsed time and unknown units are never substituted. This probe does not recover earlier missing calls or prove universal free CPU headroom.';
} catch (error) {
  if (report) {
    report.probeFailed = true;
    report.failedAt = new Date().toISOString();
    const code = error.cause?.code ?? error.code;
    report.failureCode = ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ABORT_ERR'].includes(code) ? code : 'details-withheld';
  }
  console.error('Bounded real-time probe unavailable; raw credentials and responses withheld. Inspect cleanup evidence before retrying.');
  process.exitCode = 1;
} finally {
  socket?.terminate();
  if (tailId && tailEndpoint && token) {
    try {
      const response = await fetch(tailEndpoint + '/' + encodeURIComponent(tailId), {method: 'DELETE', headers: {authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(15000)});
      const payload = await response.json();
      report.tailSessionDeleted = response.ok && payload.success === true;
    } catch {}
    if (!report.tailSessionDeleted) process.exitCode = 1;
  }
  save();
  if (report) console.log(JSON.stringify({runId: report.runId, phase: report.phase, failureCode: report.failureCode, registrationHttpStatus: report.registrationHttpStatus, clientRequests: report.requests.length, observation: report.observation, tailSessionCreated: report.tailSessionCreated, tailSessionDeleted: report.tailSessionDeleted, probeFailed: report.probeFailed ?? false}));
}
