import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {marketPhaseValidation} from '../market-phase-validation.mjs';
import {marketValidation} from '../market-validation.mjs';
import {phasedMarketKinds, phaseKinds, phaseResultPassed} from '../market-cpu-phases.mjs';
import {parseValidationRun, repeatedMarketKinds} from '../market-cpu-repeat.mjs';
import {analyzeHistoricalWindow} from '../market-history-telemetry.mjs';

const now = Date.parse('2026-11-26T04:00:00Z'), token = 'c'.repeat(64);
const env = {VALIDATION_MODE: 'isolated-market-only', VALIDATION_STARTED_AT: new Date(now - 1000).toISOString(), VALIDATION_EXPIRES_AT: new Date(now + 600000).toISOString(), VALIDATION_TOKEN: token};
const request = (kind, options = {}) => new Request('https://fixture.invalid/validation/market?kind=' + kind, {headers: {authorization: 'Bearer ' + token}, ...options});

test('phase plan is limited to eighteen calls and cannot enable real source mode', () => {
  const kinds = phasedMarketKinds('cpu-phases-01');
  assert.equal(kinds.length, 18);
  assert.deepEqual(kinds.slice(0, 8), phaseKinds);
  assert.deepEqual(kinds.slice(8, 16), phaseKinds.toReversed());
  assert.deepEqual(kinds.slice(-2), ['unauthorized', 'blocked-source']);
  assert.equal(parseValidationRun(['--mock-only', '--run-id=cpu-phases-01']).withSourceKey, false);
  assert.throws(() => parseValidationRun(['--with-massive-secret', '--run-id=cpu-phases-01']));
  assert.throws(() => phasedMarketKinds('cpu-repeat-01'));
  assert.throws(() => repeatedMarketKinds('cpu-phases-01'));
});

test('original candidate handler is unchanged from the spike and repeated runs', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../market-validation.mjs', import.meta.url))).digest('hex'), '434a9edb023cbf9951a69655a3a4160ff2cb3b88a923af7873ee70974f7b57af');
});

test('all synthetic phases pass, including repeated gates with prebuilt fixtures', async () => {
  const candidate = marketPhaseValidation(marketValidation({clock: () => now, fetchSource: () => {throw Error('Unexpected source');}}));
  for (const kind of phasedMarketKinds('cpu-phases-01').slice(0, 16)) {
    const response = await candidate.fetch(request(kind), env);
    assert.equal(phaseResultPassed(kind, {httpStatus: response.status, payload: await response.json()}), true, kind);
  }
});

test('evidence routes preserve exact original response rather than a replacement algorithm', async () => {
  const original = marketValidation({clock: () => now});
  const candidate = marketPhaseValidation(original);
  for (const kind of ['evidence-5', 'evidence-50']) assert.deepEqual(await (await candidate.fetch(request(kind), env)).json(), await (await original.fetch(request(kind), env)).json());
});

test('all upstream routes remain blocked even if source credentials are accidentally present', async () => {
  let sourceCalls = 0;
  const candidate = marketPhaseValidation(marketValidation({clock: () => now, fetchSource: () => {sourceCalls++; throw Error('Unexpected source');}}));
  for (const kind of ['summary', 'history', 'fx', 'today-readiness', 'unknown']) assert.equal((await candidate.fetch(request(kind), {...env, MASSIVE_API_KEY: 'secret-test-only-123456'})).status, 404);
  assert.equal(sourceCalls, 0);
});

test('authorization, expiry and read-only guards apply to split and delegated phases', async () => {
  const candidate = marketPhaseValidation(marketValidation({clock: () => now}));
  for (const kind of phaseKinds) {
    assert.equal((await candidate.fetch(request(kind, {headers: {}}), env)).status, 401);
    assert.equal((await candidate.fetch(request(kind), {...env, VALIDATION_EXPIRES_AT: new Date(now).toISOString()})).status, 401);
    assert.equal((await candidate.fetch(request(kind, {method: 'POST'}), env)).status, 405);
  }
});

test('result checks reject incomplete and wrong-kind evidence', () => {
  for (const kind of phaseKinds) assert.equal(phaseResultPassed(kind, {httpStatus: 200, payload: {}}), false);
  assert.equal(phaseResultPassed('fixture-5', {httpStatus: 200, payload: {kind: 'fixture-50', status: 'fixture-built', instruments: 5, synthetic: true, realLedgerWrites: false, issues: 0}}), false);
});

test('phase log correlation recognizes guarded source and unauthorized targets without reclassifying old runs', () => {
  const stages = ['control', 'unauthorized', 'blocked-source'].map((kind, index) => ({kind, startedAt: new Date(now + index * 3000).toISOString(), completedAt: new Date(now + index * 3000 + 500).toISOString(), httpStatus: index ? index === 1 ? 401 : 404 : 200}));
  const rows = stages.map((stage, index) => [stage.completedAt, ['control', 'evidence-5', 'summary'][index], 1, 'info', 'ok']);
  const buckets = stages.map(stage => ({dimensions: {datetime: stage.startedAt, scriptName: 'gaintrace-market-validation'}, sum: {requests: 1}, max: {cpuTime: 1500}}));
  const result = analyzeHistoricalWindow(rows, {runId: 'cpu-phases-01', stages}, {buckets});
  assert.equal(result.bucketCorrelationComplete, true);
  assert.equal(result.maxCorrelatedBucketCpuMs, 1.5);
  assert.equal(result.universalFreeHeadroomProven, false);
});

test('recorded eighteen-call cloud evidence keeps the second gate-5 spike red without inventing a cold start', () => {
  const read = kind => JSON.parse(readFileSync(new URL('../market-cpu-phases-01-' + kind + '-v0.3.6.json', import.meta.url), 'utf8'));
  const result = analyzeHistoricalWindow(read('dashboard').rows, read('checks'), read('cpu'));
  assert.equal(result.sequenceComplete, true);
  assert.equal(result.bucketCorrelationComplete, true);
  assert.equal(result.calls.length, 18);
  assert.equal(result.status, 'peak-reproduced');
  const spike = result.calls.find(call => call.clientSequence === 12);
  assert.equal(spike.clientKind, 'gate-5');
  assert.equal(spike.correlatedBucketMaximumCpuMs, 10.754);
  assert.equal(result.coldStartsProven, false);
  assert.equal(result.universalFreeHeadroomProven, false);
});
