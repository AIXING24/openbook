import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstatSync, readFileSync, writeFileSync, unlinkSync} from 'node:fs';

try {
  const name = 'gaintrace-market-validation', execute = promisify(execFile);
  const config = JSON.parse(readFileSync('wrangler.market.local.json', 'utf8')), original = JSON.parse(readFileSync('wrangler.local.json', 'utf8'));
  const deployment = JSON.parse(readFileSync('market-cloud-deployment-v0.3.6.json', 'utf8'));
  if (config.name !== name || deployment.name !== name || config.account_id !== original.account_id || config.d1_databases?.length || config.triggers?.crons?.length) throw Error('Isolated resource identity mismatch');
  await execute('./node_modules/.bin/wrangler', ['delete', '--force', '--config', 'wrangler.market.local.json'], {maxBuffer: 100000, timeout: 120000});
  const credentials = await execute('./node_modules/.bin/wrangler', ['auth', 'token', '--json', '--config', 'wrangler.local.json'], {maxBuffer: 100000});
  const {token} = JSON.parse(credentials.stdout), headers = {authorization: 'Bearer ' + token};
  const listing = await fetch('https://api.cloudflare.com/client/v4/accounts/' + original.account_id + '/workers/scripts', {headers, redirect: 'error', signal: AbortSignal.timeout(20000)});
  const workers = await listing.json();
  const scheduling = await fetch('https://api.cloudflare.com/client/v4/accounts/' + original.account_id + '/workers/scripts/' + original.name + '/schedules', {headers, redirect: 'error', signal: AbortSignal.timeout(20000)});
  const schedules = await scheduling.json();
  if (!listing.ok || !workers.success || !Array.isArray(workers.result) || !scheduling.ok || !schedules.success || !Array.isArray(schedules.result?.schedules)) throw Error('Independent cleanup verification unavailable');
  const report = {version: 'backend v0.3.6 candidate', checkedAt: new Date().toISOString(), isolatedWorkerRemoved: !workers.result.some(worker => worker.id === name), isolatedSecretsRemovedWithWorker: !workers.result.some(worker => worker.id === name), originalWorkerStillExists: workers.result.some(worker => worker.id === original.name), originalCronCount: schedules.result.schedules.length, realLedgerWrites: false};
  if (!report.isolatedWorkerRemoved || !report.originalWorkerStillExists || report.originalCronCount !== 0) throw Error('Independent cleanup checks failed');
  for (const file of ['.market-session.local.json', 'wrangler.market.local.json']) {
    if (!lstatSync(file).isFile()) throw Error('Unexpected local validation file');
    unlinkSync(file);
  }
  writeFileSync('market-cloud-cleanup-v0.3.6.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch {
  console.error('Isolated cleanup not fully verified; raw credentials and CLI output withheld.');
  process.exitCode = 1;
}
