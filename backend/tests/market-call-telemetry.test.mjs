import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMarketCall, assessMarketCalls, tailProbeKinds, tailProbeHost} from '../market-call-telemetry.mjs';
import {parseValidationRun, repeatedMarketKinds, validationReportPrefix} from '../market-cpu-repeat.mjs';

const marker = 'a'.repeat(32);
const eventFor = (sequence, additions = {}) => ({outcome: 'ok', event: {request: {url: 'https://' + tailProbeHost + '/validation/market?probe=' + marker + '&seq=' + sequence + '&kind=' + tailProbeKinds[sequence - 1]}}, ...additions});
const callsFor = cpu => tailProbeKinds.map((kind, index) => sanitizeMarketCall(eventFor(index + 1, {$workers: {cpuTimeMs: cpu}}), marker));

test('probe reports are separate and cannot run real sources or the 26-call repeat plan', () => {
  assert.equal(validationReportPrefix(parseValidationRun(['--mock-only', '--run-id=cpu-tail-probe-01'])), 'market-cpu-tail-probe-01');
  assert.equal(validationReportPrefix(parseValidationRun(['--mock-only', '--run-id=cpu-tail-probe-02'])), 'market-cpu-tail-probe-02');
  assert.throws(() => parseValidationRun(['--with-massive-secret', '--run-id=cpu-tail-probe-01']));
  assert.throws(() => repeatedMarketKinds('cpu-tail-probe-01'));
  assert.throws(() => repeatedMarketKinds('cpu-tail-probe-02'));
});

test('only probe-matched route, host, sequence and kind are retained', () => {
  assert.equal(sanitizeMarketCall(eventFor(1), marker).sequence, 1);
  for (const replacement of ['https://other.invalid/', eventFor(1).event.request.url.replace(marker, 'b'.repeat(32)), eventFor(1).event.request.url.replace('seq=1', 'seq=4'), eventFor(1).event.request.url.replace('evidence-5', 'summary')]) assert.equal(sanitizeMarketCall({event: {request: {url: replacement}}}, marker), null);
  assert.equal(sanitizeMarketCall({}, marker), null);
  assert.throws(() => sanitizeMarketCall({}, 'invalid'));
});

test('headers, log messages, request identifiers and unknown CPU units are not retained', () => {
  const event = eventFor(1, {cpuTime: 999, cpuTimeMs: 999, wallTime: 999, logs: [{message: ['private-value']}], $metadata: {requestId: 'private-value'}});
  event.event.request.headers = {authorization: 'private-value'};
  const sanitized = sanitizeMarketCall(event, marker);
  assert.equal(sanitized.cpuMs, null);
  assert.equal(sanitized.cpuSource, null);
  assert.equal(JSON.stringify(sanitized).includes('private-value'), false);
  assert.equal(JSON.stringify(sanitized).includes(marker), false);
  assert.equal(JSON.stringify(sanitized).includes('999'), false);
  assert.equal(sanitized.fieldPresence.cpuTime, true);
});

test('Workers Logs explicit milliseconds are accepted without network time substitution', () => {
  const original = eventFor(1);
  const call = sanitizeMarketCall({$workers: {event: original.event, outcome: 'ok', cpuTimeMs: 16.749, wallTimeMs: 1000}}, marker);
  assert.equal(call.cpuMs, 16.749);
  for (const cpuTimeMs of [NaN, Infinity, -1, '16.749']) assert.equal(sanitizeMarketCall(eventFor(1, {$workers: {cpuTimeMs}}), marker).cpuMs, null);
});

test('all matched calls without CPU remain inconclusive', () => {
  const result = assessMarketCalls(tailProbeKinds.map((kind, index) => sanitizeMarketCall(eventFor(index + 1), marker)));
  assert.equal(result.sequenceComplete, true);
  assert.equal(result.cpuComplete, false);
  assert.equal(result.status, 'inconclusive');
});

test('missing, duplicate or erroneous calls cannot pass the CPU gate', () => {
  const calls = callsFor(1);
  for (const sample of [[], calls.slice(1), [...calls, calls[0]], [calls[0], calls[0], calls[2]], [calls[0], {...calls[1], outcome: 'exception'}, calls[2]]]) assert.equal(assessMarketCalls(sample).status, 'inconclusive');
});

test('an observed peak stays red even with missing calls', () => {
  assert.equal(assessMarketCalls(callsFor(16.749).slice(0, 1)).status, 'peak-reproduced');
  const low = assessMarketCalls(callsFor(9.822));
  assert.equal(low.status, 'no-peak-observed');
  assert.equal(low.coldStartsProven, false);
  assert.equal(low.universalFreeHeadroomProven, false);
});
