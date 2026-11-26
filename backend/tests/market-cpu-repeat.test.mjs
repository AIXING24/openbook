import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseValidationRun, validationReportPrefix, repeatedMarketKinds, assessCpuObservation} from '../market-cpu-repeat.mjs';

test('existing report namespaces remain unchanged', () => {
  assert.equal(validationReportPrefix(parseValidationRun([])), 'market-cloud');
  assert.equal(validationReportPrefix(parseValidationRun(['--mock-only'])), 'market-cloud');
  assert.equal(validationReportPrefix(parseValidationRun(['--with-massive-secret'])), 'market-massive-cloud');
});

test('two bounded repeated runs use separate mock-only namespaces', () => {
  for (const runId of ['cpu-repeat-01', 'cpu-repeat-02']) assert.equal(validationReportPrefix(parseValidationRun(['--mock-only', '--run-id=' + runId])), 'market-' + runId);
});

test('repeat arguments cannot enable a source secret or arbitrary output path', () => {
  for (const args of [['--with-massive-secret', '--run-id=cpu-repeat-01'], ['--mock-only', '--with-massive-secret'], ['--run-id=../../secret'], ['--run-id=cpu-repeat-03'], ['--run-id=cpu-repeat-01', '--run-id=cpu-repeat-02'], ['--unknown']]) assert.throws(() => parseValidationRun(args));
  assert.throws(() => validationReportPrefix({withSourceKey: 'false'}));
});

test('repeat plans contain twelve requests per fixed fixture and reverse first use', () => {
  for (const [runId, first] of [['cpu-repeat-01', 'evidence-5'], ['cpu-repeat-02', 'evidence-50']]) {
    const kinds = repeatedMarketKinds(runId);
    assert.equal(kinds.length, 26);
    assert.equal(kinds[0], first);
    assert.equal(kinds.filter(kind => kind === 'evidence-5').length, 12);
    assert.equal(kinds.filter(kind => kind === 'evidence-50').length, 12);
    assert.deepEqual(kinds.slice(-2), ['unauthorized', 'source-secret-missing']);
  }
  assert.throws(() => repeatedMarketKinds(undefined));
});

test('recorded real-cloud spike remains red-capable at the official CPU seam', () => {
  const report = JSON.parse(readFileSync(new URL('../market-massive-cloud-cpu-v0.3.6.json', import.meta.url), 'utf8'));
  const result = assessCpuObservation(report);
  assert.equal(result.status, 'peak-reproduced');
  assert.equal(result.maxCpuMs, 16.749);
  assert.equal(result.observedRequests, 7);
  assert.equal(result.universalFreeHeadroomProven, false);
});

test('low observations are not a universal free or cold-start guarantee', () => {
  const result = assessCpuObservation({expectedClientRequests: 1, buckets: [{max: {cpuTime: 9000}, sum: {requests: 1, errors: 0, subrequests: 0}}]});
  assert.equal(result.status, 'no-peak-observed');
  assert.equal(result.coldStartsProven, false);
  assert.equal(result.universalFreeHeadroomProven, false);
});

test('missing, partial and erroneous samples cannot pass as complete observations', () => {
  assert.equal(assessCpuObservation({expectedClientRequests: 1, buckets: []}).status, 'inconclusive');
  assert.equal(assessCpuObservation({expectedClientRequests: 2, buckets: [{max: {cpuTime: 1000}, sum: {requests: 1, errors: 0, subrequests: 0}}]}).status, 'inconclusive');
  assert.equal(assessCpuObservation({expectedClientRequests: 1, buckets: [{max: {cpuTime: 1000}, sum: {requests: 1, errors: 1, subrequests: 0}}]}).status, 'inconclusive');
  const partialPeak = assessCpuObservation({expectedClientRequests: 2, buckets: [{max: {cpuTime: 16000}, sum: {requests: 1, errors: 0, subrequests: 0}}]});
  assert.equal(partialPeak.status, 'peak-reproduced');
  assert.equal(partialPeak.countsMatched, false);
});

test('invalid CPU units and bucket counts are rejected', () => {
  for (const cpuTime of [-1, NaN, Infinity]) assert.throws(() => assessCpuObservation({expectedClientRequests: 1, buckets: [{max: {cpuTime}, sum: {requests: 1, errors: 0, subrequests: 0}}]}));
  assert.throws(() => assessCpuObservation({expectedClientRequests: 0, buckets: []}));
  assert.throws(() => assessCpuObservation({expectedClientRequests: 1, buckets: []}, 0));
  for (const requests of [-1, 0.5, NaN]) assert.throws(() => assessCpuObservation({expectedClientRequests: 1, buckets: [{max: {cpuTime: 1000}, sum: {requests, errors: 0, subrequests: 0}}]}));
});
