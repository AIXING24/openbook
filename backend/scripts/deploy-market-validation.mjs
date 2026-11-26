import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {parseValidationRun, validationReportPrefix} from '../market-cpu-repeat.mjs';

const execute = promisify(execFile), name = 'gaintrace-market-validation';
try {
  const {withSourceKey, runId} = parseValidationRun(process.argv.slice(2));
  const reportPrefix = validationReportPrefix({withSourceKey, runId});
  const original = JSON.parse(readFileSync('wrangler.local.json', 'utf8'));
  const credentials = await execute('./node_modules/.bin/wrangler', ['auth', 'token', '--json', '--config', 'wrangler.local.json'], {maxBuffer: 100000});
  const {token} = JSON.parse(credentials.stdout);
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + original.account_id + '/workers/scripts', {headers: {authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(20000)});
  const existing = await response.json();
  if (!response.ok || !existing.success || !Array.isArray(existing.result) || existing.result.some(script => script.id === name)) throw Error('Fresh isolated worker could not be verified');
  let sourceKey;
  if (withSourceKey) {
    const secretFile = '.massive-secrets.local.json', metadata = lstatSync(secretFile);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) throw Error('Unsafe local secret');
    sourceKey = JSON.parse(readFileSync(secretFile, 'utf8')).MASSIVE_API_KEY;
    if (typeof sourceKey !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(sourceKey)) throw Error('Invalid local secret');
  }
  const startedClock = Date.now(), startedAt = new Date(startedClock).toISOString(), expiresAt = new Date(startedClock + 3600000).toISOString(), validationToken = randomBytes(32).toString('hex');
  const config = JSON.parse(readFileSync('wrangler.market.example.json', 'utf8'));
  if (config.name !== name || config.d1_databases?.length || config.kv_namespaces?.length || config.triggers?.crons?.length) throw Error('Unexpected isolation configuration');
  config.account_id = original.account_id;
  config.vars.VALIDATION_STARTED_AT = startedAt;
  config.vars.VALIDATION_EXPIRES_AT = expiresAt;
  writeFileSync('wrangler.market.local.json', JSON.stringify(config, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  writeFileSync('.market-session.local.json', JSON.stringify({name, startedAt, expiresAt, validationToken, withSourceKey, runId}) + '\n', {flag: 'wx', mode: 0o600});
  await execute('./node_modules/.bin/wrangler', ['deploy', '--config', 'wrangler.market.local.json'], {maxBuffer: 1000000, timeout: 120000});
  const report = {version: 'backend v0.3.6 candidate', name, startedAt, expiresAt, deployedAt: new Date().toISOString(), isolated: true, officialCliDeployment: true, sourceSecretStoredInCloudflare: false, noDatabaseBinding: true, noCron: true, realLedgerWrites: false, productionDeploymentChanged: false, sourceModuleHash: createHash('sha256').update(readFileSync('market-validation.mjs')).digest('hex')};
  writeFileSync(reportPrefix + '-deployment-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
  await new Promise((resolve, reject) => {
    const child = execFile('./node_modules/.bin/wrangler', ['secret', 'bulk', '--config', 'wrangler.market.local.json'], {maxBuffer: 100000, timeout: 120000}, error => error ? reject(Error('Isolated secret configuration failed')) : resolve());
    child.stdin.on('error', () => reject(Error('Secret input unavailable')));
    child.stdin.end(JSON.stringify({...(withSourceKey ? {MASSIVE_API_KEY: sourceKey} : {}), VALIDATION_TOKEN: validationToken}));
  });
  report.sourceSecretStoredInCloudflare = withSourceKey;
  writeFileSync(reportPrefix + '-deployment-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch {
  console.error('Isolated deployment unavailable; raw credentials and CLI output withheld. Inspect isolated resource status before retrying.');
  process.exitCode = 1;
}
