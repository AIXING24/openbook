import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeHistoricalWindow} from '../market-history-telemetry.mjs';

const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const observations = read('market-history-dashboard-v0.3.6.json');
const evidence = prefix => ({rows: observations.windows[prefix], checks: read(prefix + '-checks-v0.3.6.json'), cpu: read(prefix + '-cpu-v0.3.6.json')});
const analyze = prefix => {const {rows, checks, cpu} = evidence(prefix); return analyzeHistoricalWindow(rows, checks, cpu);};

test('all 59 displayed calls uniquely match known client stages without request headers', () => {
  let total = 0;
  for (const prefix of Object.keys(observations.windows)) {
    const result = analyze(prefix);
    assert.equal(result.sequenceComplete, true);
    assert.equal(result.displayedCpuComplete, true);
    assert.ok(result.calls.every(call => Math.abs(call.clientClockDeltaMs) <= 1000));
    total += result.displayedCalls;
  }
  assert.equal(total, 59);
});

test('historical peak stays red and correlates to the five-instrument synthetic route', () => {
  const result = analyze('market-massive-cloud');
  assert.equal(result.status, 'peak-reproduced');
  assert.equal(result.maxDisplayedCpuMs, 16);
  assert.equal(result.maxCorrelatedBucketCpuMs, 16.749);
  assert.equal(result.calls.find(call => call.correlatedBucketMaximumCpuMs === 16.749).clientKind, 'evidence-5');
  assert.equal(result.bucketCorrelationComplete, true);
  const {rows, checks, cpu} = evidence('market-massive-cloud');
  assert.equal(analyzeHistoricalWindow(rows.filter(row => row[1] !== 'evidence-5'), checks, cpu).status, 'peak-reproduced');
});

test('network waiting is not CPU and may span multiple seconds before the log timestamp', () => {
  const call = analyze('market-massive-cloud').calls.find(call => call.clientKind === 'fx');
  assert.equal(call.correlatedBucketMaximumCpuMs, 5.84);
  assert.equal(call.correlatedBucketTime, '2026-11-25T13:07:08Z');
  assert.equal(call.loggedAt, '2026-11-25T13:07:10.900Z');
});

test('first repeat peak correlates to fifty instruments, not a universal five-instrument cause', () => {
  const result = analyze('market-cpu-repeat-01');
  assert.equal(result.maxCorrelatedBucketCpuMs, 9.822);
  assert.equal(result.calls.find(call => call.correlatedBucketMaximumCpuMs === 9.822).clientKind, 'evidence-50');
  assert.equal(result.universalFreeHeadroomProven, false);
});

test('second repeat recovers the log but not fractional CPU for the missing fifty-instrument bucket', () => {
  const result = analyze('market-cpu-repeat-02');
  assert.equal(result.sequenceComplete, true);
  assert.equal(result.bucketCorrelationComplete, false);
  assert.equal(result.status, 'inconclusive');
  assert.deepEqual(result.missingBucketCorrelations, [{loggedAt: '2026-11-26T03:28:08.407Z', clientSequence: 23, clientKind: 'evidence-50', cpuDisplayMs: 1}]);
  const control = result.calls.find(call => call.clientKind === 'source-secret-missing');
  assert.equal(control.clientHttpStatus, 503);
  assert.equal(control.logLevel, 'error');
  assert.equal(control.outcome, 'ok');
  assert.equal(control.correlatedBucketMaximumCpuMs, 0.311);
});

test('duplicate, missing or ambiguous rows cannot certify complete call evidence', () => {
  const {rows, checks, cpu} = evidence('market-cpu-repeat-01');
  for (const sample of [rows.slice(1), [...rows, rows[0]], [rows[0], rows[0], ...rows.slice(2)]]) {
    const result = analyzeHistoricalWindow(sample, checks, cpu);
    assert.equal(result.sequenceComplete, false);
    assert.equal(result.status, 'inconclusive');
  }
  const altered = structuredClone(rows);
  altered[0][0] = '2026-11-26T03:23:59.000Z';
  assert.equal(analyzeHistoricalWindow(altered, checks, cpu).sequenceComplete, false);
});

test('invalid units and foreign services are rejected and grouped buckets cannot imply per-call CPU', () => {
  const {rows, checks, cpu} = evidence('market-cpu-repeat-01');
  for (const value of [-1, Infinity, '9']) {const altered = structuredClone(rows); altered[0][2] = value; assert.throws(() => analyzeHistoricalWindow(altered, checks, cpu));}
  const foreign = structuredClone(cpu);
  foreign.buckets[0].dimensions.scriptName = 'other-worker';
  assert.throws(() => analyzeHistoricalWindow(rows, checks, foreign));
  const grouped = structuredClone(cpu);
  grouped.buckets[0].sum.requests = 2;
  assert.equal(analyzeHistoricalWindow(rows, checks, grouped).bucketCorrelationComplete, false);
});
