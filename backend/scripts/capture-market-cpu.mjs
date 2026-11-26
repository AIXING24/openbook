import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {validationReportPrefix, assessCpuObservation} from '../market-cpu-repeat.mjs';

try {
const session = JSON.parse(readFileSync('.market-session.local.json', 'utf8'));
const credentials = await promisify(execFile)('./node_modules/.bin/wrangler', ['auth', 'token', '--json', '--config', 'wrangler.local.json'], {maxBuffer: 100000});
const {token} = JSON.parse(credentials.stdout), original = JSON.parse(readFileSync('wrangler.local.json', 'utf8'));
const reportPrefix = validationReportPrefix(session);
const checks = JSON.parse(readFileSync(reportPrefix + '-checks-v0.3.6.json', 'utf8'));
const windowStart = new Date(Math.floor(Date.parse(checks.startedAt) / 60000) * 60000).toISOString(), windowEnd = new Date(Math.ceil(Date.parse(checks.completedAt) / 60000) * 60000).toISOString();
const query = 'query($accountTag:string,$start:string,$end:string,$scriptName:string){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsAdaptive(limit:1000,filter:{scriptName:$scriptName,datetime_geq:$start,datetime_leq:$end}){sum{requests errors subrequests cpuTimeUs} max{cpuTime} quantiles{cpuTimeP50 cpuTimeP99} dimensions{datetime scriptName status}}}}}';
for (let attempt = 0; attempt < 4; attempt++) {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'}, redirect: 'error', body: JSON.stringify({query, variables: {accountTag: original.account_id, start: windowStart, end: windowEnd, scriptName: 'gaintrace-market-validation'}}), signal: AbortSignal.timeout(25000)});
  const payload = await response.json();
  if (!response.ok || payload.errors || !payload.data?.viewer?.accounts?.[0]) throw Error('Official CPU analytics unavailable; raw response withheld');
  const buckets = payload.data.viewer.accounts[0].workersInvocationsAdaptive;
  const requests = buckets.reduce((total, row) => total + row.sum.requests, 0), errors = buckets.reduce((total, row) => total + row.sum.errors, 0);
  const report = {version: 'backend v0.3.6 candidate', queriedAt: new Date().toISOString(), timeRange: {start: windowStart, end: windowEnd}, clientTimeRange: {start: checks.startedAt, end: checks.completedAt}, scriptName: 'gaintrace-market-validation', buckets, observedRequests: requests, observedErrors: errors, maxObservedCpuMs: buckets.length ? Math.max(...buckets.map(row => row.max.cpuTime)) / 1000 : null, expectedClientRequests: checks.stages.length, reportedRequestCountMatchesClient: requests === checks.stages.length, allInvocationsIndividuallyProven: false, units: 'Official GraphQL CPU microseconds converted to milliseconds; bucket maximum, not network latency', universalFreeHeadroomProven: false, coldStartsProven: false, limitations: 'Returned adaptive analytics buckets for a small isolated, minute-rounded window only. Matching request counts is not proof of individually complete samples. No route-specific attribution, universal cold-start guarantee or complete account billing verification.'};
  report.observation = assessCpuObservation(report);
  writeFileSync(reportPrefix + '-cpu-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({...report, buckets: undefined}));
  if (requests >= checks.stages.length) break;
  if (attempt < 3) await sleep(60000);
}
} catch {
  console.error('Official isolated CPU analytics unavailable; raw credentials and responses withheld.');
  process.exitCode = 1;
}
