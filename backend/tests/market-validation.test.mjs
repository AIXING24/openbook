import test from 'node:test';
import assert from 'node:assert/strict';
import {marketValidation, mockMarketEvidence, boundedSourceText} from '../market-validation.mjs';

const now = Date.parse('2026-11-25T12:00:00Z'), token = 'a'.repeat(64), key = 'synthetic-test-key-not-a-credential';
const environment = () => ({VALIDATION_MODE: 'isolated-market-only', VALIDATION_STARTED_AT: new Date(now - 1000).toISOString(), VALIDATION_EXPIRES_AT: new Date(now + 600000).toISOString(), VALIDATION_TOKEN: token, MASSIVE_API_KEY: key});
const request = (kind, options = {}) => new Request('https://isolated.invalid/validation/market?kind=' + kind, {headers: {authorization: 'Bearer ' + token}, ...options});

test('isolated validation rejects unauthorized, expired and long-lived configuration without source calls', async () => {
  let calls = 0;
  const worker = marketValidation({clock: () => now, fetchSource: async () => {calls++; throw Error();}});
  for (const change of [{VALIDATION_TOKEN: ''}, {VALIDATION_MODE: 'mock-only'}, {VALIDATION_EXPIRES_AT: new Date(now).toISOString()}, {VALIDATION_EXPIRES_AT: new Date(now + 7200000).toISOString()}, {VALIDATION_STARTED_AT: 'invalid'}]) assert.equal((await worker.fetch(request('summary'), {...environment(), ...change})).status, 401);
  assert.equal((await worker.fetch(request('summary', {headers: {authorization: 'Bearer wrong'}}), environment())).status, 401);
  assert.equal(calls, 0);
});

test('isolated validation permits only fixed read-only routes and kinds', async () => {
  const worker = marketValidation({clock: () => now, fetchSource: async () => {throw Error('Unexpected source call');}});
  assert.equal((await worker.fetch(request('summary', {method: 'POST'}), environment())).status, 405);
  assert.equal((await worker.fetch(request('https://other.invalid'), environment())).status, 400);
  assert.equal((await worker.fetch(new Request('https://isolated.invalid/anything', {headers: {authorization: 'Bearer ' + token}}), environment())).status, 404);
});

test('mixed-market five and fifty instrument fixtures do not write or approve a real source', async () => {
  const worker = marketValidation({clock: () => now});
  for (const count of [5, 50]) {
    const response = await worker.fetch(request('evidence-' + count), environment()), result = await response.json();
    assert.equal(result.status, 'verified-candidate');
    assert.equal(result.instruments, count);
    assert.equal(result.synthetic, true);
    assert.equal(result.realLedgerWrites, false);
  }
  assert.throws(() => mockMarketEvidence(51));
});

test('before regular close readiness remains pending without requesting a quote', async () => {
  const worker = marketValidation({clock: () => now, fetchSource: async () => {throw Error('No request expected');}});
  const result = await (await worker.fetch(request('today-readiness'), environment())).json();
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'regular-session-not-closed');
  assert.equal(result.upstreamRequests, 0);
  assert.equal(result.finalityVerified, false);
});

test('real summary response includes metadata and hash but no prices or secrets', async () => {
  const worker = marketValidation({clock: () => now, fetchSource: async (url, options) => {
    assert.equal(url, 'https://api.massive.com/v1/open-close/NVDA/2026-11-24?adjusted=false');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Bearer ' + key);
    return Response.json({status: 'OK', symbol: 'NVDA', from: '2026-11-24', open: 10, high: 12, low: 9, close: 11, afterHours: 500});
  }});
  const text = await (await worker.fetch(request('summary'), environment())).text(), result = JSON.parse(text);
  assert.equal(result.status, 'valid-candidate');
  assert.match(result.selectedDataHash, /^[a-f0-9]{64}$/);
  assert.equal(result.finalityVerified, false);
  assert.ok(!text.includes(key) && !text.includes(token));
  assert.ok(!('close' in result) && !('prices' in result) && !('afterHours' in result));
});

test('upstream errors are pending and never echo provider bodies', async () => {
  for (const status of [401, 403, 429, 500]) {
    const worker = marketValidation({clock: () => now, fetchSource: async () => new Response(key, {status})});
    const text = await (await worker.fetch(request('summary'), environment())).text();
    assert.equal(JSON.parse(text).status, 'pending');
    assert.ok(!text.includes(key));
  }
});

test('bounded source reader handles chunk overflow and empty responses', async () => {
  assert.equal(await boundedSourceText(new Response('abc'), 3), 'abc');
  await assert.rejects(boundedSourceText(new Response('abcd'), 3));
  await assert.rejects(boundedSourceText(new Response(null), 3));
});
