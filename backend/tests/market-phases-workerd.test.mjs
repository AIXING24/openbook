import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, createFetchMock} from 'miniflare';
import {phasedMarketKinds, phaseResultPassed} from '../market-cpu-phases.mjs';

test('native Workerd executes the eighteen-call phase plan without D1, Cron or any source network', async context => {
  const now = Date.now(), token = 'd'.repeat(64), fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const runtime = new Miniflare({modules: true, scriptPath: new URL('../market-phase-validation.mjs', import.meta.url).pathname, compatibilityDate: '2026-08-06', cf: false, host: '127.0.0.1', port: 0, fetchMock, bindings: {VALIDATION_MODE: 'isolated-market-only', VALIDATION_STARTED_AT: new Date(now - 1000).toISOString(), VALIDATION_EXPIRES_AT: new Date(now + 600000).toISOString(), VALIDATION_TOKEN: token, MASSIVE_API_KEY: 'accidental-test-secret-only'}});
  context.after(() => runtime.dispose());
  for (const kind of phasedMarketKinds('cpu-phases-01')) {
    const target = kind === 'unauthorized' ? 'evidence-5' : kind === 'blocked-source' ? 'summary' : kind;
    const response = await runtime.dispatchFetch('https://fixture.invalid/validation/market?kind=' + target, {headers: kind === 'unauthorized' ? {} : {authorization: 'Bearer ' + token}});
    assert.equal(phaseResultPassed(kind, {httpStatus: response.status, payload: await response.json()}), true, kind);
  }
  for (const kind of ['history', 'fx', 'today-readiness']) assert.equal((await runtime.dispatchFetch('https://fixture.invalid/validation/market?kind=' + kind, {headers: {authorization: 'Bearer ' + token}})).status, 404);
});
