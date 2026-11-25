import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare, createFetchMock} from 'miniflare';

test('isolated market candidate runs in native Workerd without D1 or real source secrets', async context => {
  const now = Date.now(), token = 'b'.repeat(64);
  const fetchMock = createFetchMock();
  fetchMock.disableNetConnect();
  const csv = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n' + Object.entries({CNY: 7.8, USD: 1.2, HKD: 9.6}).map(([currency, value]) => 'EXR.D.' + currency + '.EUR.SP00.A,D,' + currency + ',EUR,SP00,A,2026-11-24,' + value + ',A').join('\n');
  fetchMock.get('https://data-api.ecb.europa.eu').intercept({method: 'GET', path: '/service/data/EXR/D.USD+CNY+HKD.EUR.SP00.A?startPeriod=2026-11-24&endPeriod=2026-11-24&format=csvdata'}).reply(200, csv);
  const runtime = new Miniflare({modules: true, scriptPath: new URL('../market-validation.mjs', import.meta.url).pathname, compatibilityDate: '2026-08-06', cf: false, host: '127.0.0.1', port: 0, fetchMock, bindings: {VALIDATION_MODE: 'isolated-market-only', VALIDATION_STARTED_AT: new Date(now - 1000).toISOString(), VALIDATION_EXPIRES_AT: new Date(now + 600000).toISOString(), VALIDATION_TOKEN: token}});
  context.after(() => runtime.dispose());
  const call = path => runtime.dispatchFetch('https://isolated.invalid' + path, {headers: {authorization: 'Bearer ' + token}});
  await context.test('no authorization and missing source secret cannot call a real source', async () => {
    assert.equal((await runtime.dispatchFetch('https://isolated.invalid/validation/status')).status, 401);
    assert.equal((await call('/validation/market?kind=summary')).status, 503);
    const result = await (await call('/validation/status')).json();
    assert.equal(result.databaseBound, false);
    assert.equal(result.cronEnabled, false);
    assert.equal(result.sourceApproved, false);
  });
  await context.test('five and fifty mixed-market fixtures remain candidate-only in Workerd', async () => {
    for (const count of [5, 50]) {
      const result = await (await call('/validation/market?kind=evidence-' + count)).json();
      assert.equal(result.status, 'verified-candidate');
      assert.equal(result.instruments, count);
      assert.equal(result.synthetic, true);
      assert.equal(result.realLedgerWrites, false);
    }
  });
  await context.test('ECB source request and CSV parse work in native Workerd', async () => {
    const result = await (await call('/validation/market?kind=fx')).json();
    assert.equal(result.status, 'valid-candidate', JSON.stringify(result));
    assert.equal(result.basis, 'ECB_REFERENCE');
  });
});
