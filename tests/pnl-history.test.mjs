import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';

const core = readFileSync(new URL('../parts/core.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../parts/pnl.js', import.meta.url), 'utf8');
const now = Date.parse('2026-11-12T10:00:00+08:00');
function instance(indexedDB = new IDBFactory()) {
  const context = vm.createContext({ indexedDB, setTimeout, clearTimeout, structuredClone });
  vm.runInContext(core + '\n' + source + '\nglobalThis.pnl = PnlHistory;', context);
  return context.pnl;
}
const trade = (side = 'B', px = 100, qty = 10, options = {}) => ({ id: 't1', date: '2026-11-10', tc: 'sh600000', mkt: 'sh', cur: 'CNY', side, px, qty, fee: 0, ts: 1, ...options });
const quotes = (px = 110, ts = now) => ({ sh600000: { px, ts } });
const fx = { USDCNY: 7, HKDCNY: 0.9, ts: now };
const plain = value => JSON.parse(JSON.stringify(value));

test('buy, add, partial sale, full sale and short cover preserve total P&L at unchanged prices', () => {
  const pnl = instance();
  let trades = [trade()];
  const amount = () => pnl.value(pnl.buildSnapshot(trades, quotes(), fx, { now }).snapshot, 'CNY');
  assert.equal(amount(), 100);
  trades.push(trade('B', 110, 5, { id: 't2', date: '2026-11-11', ts: 2 }));
  assert.equal(amount(), 100);
  trades.push(trade('S', 110, 6, { id: 't3', date: '2026-11-12', ts: 3 }));
  assert.ok(Math.abs(amount() - 100) < 1e-9);
  trades.push(trade('S', 110, 9, { id: 't4', date: '2026-11-12', ts: 4 }));
  assert.ok(Math.abs(amount() - 100) < 1e-9);
  trades = [trade('S', 120), trade('B', 110, 10, { id: 't2', date: '2026-11-12', ts: 2 })];
  assert.equal(amount(), 100);
});

test('fees and dividends enter P&L exactly once for held and closed positions', () => {
  const pnl = instance();
  const buy = trade('B', 100, 10, { fee: 2 });
  const dividend = trade('D', 0, 10, { id: 'div', date: '2026-11-11', amt: 30 });
  const held = pnl.buildSnapshot([buy, dividend], quotes(), fx, { now }).snapshot;
  assert.equal(pnl.value(held, 'CNY'), 128);
  const sold = pnl.buildSnapshot([buy, dividend, trade('S', 110, 10, { id: 'sell', date: '2026-11-12', fee: 3 })], {}, fx, { now }).snapshot;
  assert.ok(Math.abs(pnl.value(sold, 'CNY') - 125) < 1e-9);
  assert.equal(pnl.value(sold, 'CNY', 'unrealized'), 0);
  const lateDiv = pnl.buildSnapshot([buy, trade('S', 110, 10, { id: 'sell', date: '2026-11-11' }), dividend], {}, fx, { now }).snapshot;
  assert.ok(Math.abs(pnl.value(lateDiv, 'CNY') - 128) < 1e-9);
});

test('stored currency buckets support frozen FX and signed short valuation', () => {
  const pnl = instance();
  const snapshot = pnl.buildSnapshot([trade('S', 120, 10, { tc: 'usTEST.OQ', mkt: 'us', cur: 'USD' })], { 'usTEST.OQ': { px: 110, ts: now } }, fx, { now }).snapshot;
  assert.equal(pnl.value(snapshot, 'USD'), 100);
  assert.equal(pnl.value(snapshot, 'CNY'), 700);
  assert.equal(snapshot.positions[0].shares, -10);
  assert.equal(pnl.value(snapshot, 'CNY'), 700);
  assert.equal(pnl.value(snapshot, 'HKD'), 700 / 0.9);
});

test('cash-flow conservation includes all fees when short positions are covered or reversed', () => {
  const pnl = instance();
  const closed = [trade('S', 120, 10, { fee: 3 }), trade('B', 110, 10, { id: 'cover', date: '2026-11-12', fee: 4 })];
  assert.equal(pnl.value(pnl.buildSnapshot(closed, {}, fx, { now }).snapshot, 'CNY'), 93);
  let seed = 17;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let trial = 0; trial < 100; trial++) {
    const trades = [], price = 110;
    let cash = 0, shares = 0;
    for (let index = 0; index < 20; index++) {
      const side = random() > 0.5 ? 'B' : 'S', qty = Math.ceil(random() * 10), px = 80 + Math.floor(random() * 40), fee = Math.floor(random() * 5);
      trades.push(trade(side, px, qty, { id: String(index), fee, ts: index + 1 }));
      cash += (side === 'B' ? -1 : 1) * px * qty - fee;
      shares += (side === 'B' ? 1 : -1) * qty;
    }
    const snapshot = pnl.buildSnapshot(trades, quotes(price), fx, { now }).snapshot;
    assert.ok(Math.abs(pnl.value(snapshot, 'CNY') - (cash + shares * price)) < 1e-6);
  }
});

test('percentage uses each snapshot cumulative purchase basis including fees and dividends only in P&L', () => {
  const pnl = instance();
  const trades = [trade('B', 100, 10, { fee: 2 }), trade('D', 0, 10, { id: 'div', date: '2026-11-11', amt: 30 })];
  const held = pnl.buildSnapshot(trades, quotes(), fx, { now }).snapshot;
  assert.equal(held.purchases.CNY, 1002);
  assert.equal(pnl.percentage(held, 'CNY'), 128 / 1002 * 100);
  assert.ok(Math.abs(pnl.percentage(held, 'USD') - 128 / 1002 * 100) < 1e-9);
  const sold = pnl.buildSnapshot([...trades, trade('S', 110, 10, { id: 'sell', date: '2026-11-12', fee: 3 })], {}, fx, { now }).snapshot;
  assert.equal(sold.purchases.CNY, 1002);
  assert.ok(Math.abs(pnl.percentage(sold, 'CNY') - 125 / 1002 * 100) < 1e-9);
  const loss = pnl.buildSnapshot([trade()], quotes(90), fx, { now }).snapshot;
  assert.equal(pnl.percentage(loss, 'CNY'), -10);
  const zero = pnl.buildSnapshot([trade()], quotes(100), fx, { now }).snapshot;
  assert.equal(pnl.percentage(zero, 'CNY'), 0);
  const onlyShort = pnl.buildSnapshot([trade('S', 120)], quotes(), fx, { now }).snapshot;
  assert.equal(pnl.percentage(onlyShort, 'CNY'), null);
  const legacy = plain(held); delete legacy.purchases;
  assert.equal(pnl.percentage(pnl.normalizeSnapshot(legacy), 'CNY'), null);
  assert.equal(pnl.value(pnl.normalizeSnapshot(legacy), 'CNY'), 128);
  assert.equal(pnl.normalizeSnapshot({ ...plain(held), purchases: { CNY: -1, USD: 0, HKD: 0 } }), null);
});

test('new purchases update only the current percentage basis and percentage views preserve absolute zero and gaps', async () => {
  const pnl = instance(), trades = [trade()];
  await pnl.init(trades, now); await pnl.capture(trades, quotes(), fx, { now });
  const future = now + 2 * 86400000;
  const next = [...trades, trade('B', 110, 10, { id: 'add', date: '2026-11-14' })];
  await pnl.ledgerChanged(next, future);
  await pnl.capture(next, quotes(110, future), { ...fx, ts: future }, { now: future });
  assert.equal(pnl.percentage(pnl.state.snapshots[0], 'CNY'), 10);
  assert.equal(pnl.percentage(pnl.state.snapshots[1], 'CNY'), 100 / 2100 * 100);
  const view = pnl.view(pnl.state.snapshots, 'month', '2026-11-14', 'CNY', pnl.state.anchor, 'percent');
  assert.deepEqual(plain(view.points).map(point => point[1]), [10, null, 100 / 2100 * 100]);
  assert.equal(view.total, 100);
  const backup = await pnl.exportData();
  assert.deepEqual(plain(pnl.normalizeBackup(backup, next, '2026-11-14').snapshots), plain(pnl.state.snapshots));
});

test('partial, stale, invalid and prior-refresh quotes never produce fake snapshots', () => {
  const pnl = instance();
  const trades = [trade(), trade('B', 50, 2, { id: 't2', tc: 'sz000001', mkt: 'sz' })];
  assert.equal(pnl.buildSnapshot(trades, quotes(), fx, { now }).reason, 'quotes');
  for (const quote of [{ px: 0, ts: now }, { px: NaN, ts: now }, { px: 100, ts: now - 16 * 60000 }, { px: 100, ts: now + 60001 }]) {
    assert.equal(pnl.buildSnapshot([trade()], { sh600000: quote }, fx, { now }).snapshot, null);
  }
  assert.equal(pnl.buildSnapshot([trade()], quotes(110, now - 1), fx, { now, startedAt: now }).snapshot, null);
  const foreign = [trade('B', 100, 10, { tc: 'usTEST.OQ', mkt: 'us', cur: 'USD' })];
  assert.equal(pnl.buildSnapshot(foreign, { 'usTEST.OQ': { px: 110, ts: now } }, null, { now }).reason, 'fx');
  assert.equal(pnl.buildSnapshot(foreign, {}, { ...fx, ts: now - 49 * 3600000 }, { now }).reason, 'fx');
  assert.equal(pnl.buildSnapshot([trade('B', 100, 10, { demo: true })], quotes(), fx, { now }).snapshot, null);
  assert.equal(pnl.buildSnapshot([trade('B', 100, 10, { date: '2026-11-13' })], quotes(), fx, { now }).snapshot, null);
  assert.equal(pnl.buildSnapshot([trade(), trade('B', 900, 1, { id: 'future', date: '2026-11-13' })], quotes(), fx, { now }).snapshot.amounts.CNY.unrealized, 100);
});

test('date-based retention keeps 365 calendar dates plus one prior baseline across leap years', () => {
  const pnl = instance();
  const today = '2024-03-01';
  assert.equal(pnl.cutoffAt(today), '2023-03-03');
  const records = [];
  for (let date = '2022-01-01'; date <= today; date = pnl.shiftDate(date, 1)) records.push({ date });
  const retained = pnl.retain(records, today);
  assert.equal(retained.length, 366);
  assert.equal(retained[0].date, '2023-03-02');
  assert.equal(retained.at(-1).date, today);
  const sparse = pnl.retain([{ date: '2022-01-01' }, { date: '2023-01-01' }, { date: '2024-02-29' }], today);
  assert.deepEqual(plain(sparse).map(record => record.date), ['2023-01-01', '2024-02-29']);
  assert.equal(pnl.dateAt(Date.parse('2026-11-11T16:00:00Z')), '2026-11-12');
});

test('same-day overwrite persists across reloads, past dates freeze, and captures cannot move backwards', async () => {
  const database = new IDBFactory(), pnl = instance(database);
  const trades = [trade()];
  assert.equal(await pnl.init(trades, now), true);
  assert.equal(await pnl.capture(trades, quotes(), fx, { now }), true);
  assert.equal(await pnl.capture(trades, quotes(120, now + 1000), fx, { now: now + 1000 }), true);
  assert.equal(pnl.state.snapshots.length, 1);
  assert.equal(pnl.state.snapshots[0].amounts.CNY.unrealized, 200);
  assert.equal(pnl.state.anchor.amounts.CNY.unrealized, 100);
  assert.equal(await pnl.capture(trades, quotes(), fx, { now }), false);
  const tomorrow = now + 86400000;
  assert.equal(await pnl.capture(trades, quotes(130, tomorrow), { ...fx, ts: tomorrow }, { now: tomorrow }), true);
  assert.equal(await pnl.capture(trades, quotes(), fx, { now }), false);
  const reload = instance(database);
  await reload.init(trades, tomorrow);
  assert.deepEqual(plain(reload.state.snapshots).map(record => record.amounts.CNY.unrealized), [200, 300]);
  assert.equal(reload.state.anchor.amounts.CNY.unrealized, 100);
});

test('normal new-day trades preserve history; backdated edits and deletions invalidate affected history only', async () => {
  const pnl = instance(), trades = [trade()];
  await pnl.init(trades, now);
  await pnl.capture(trades, quotes(), fx, { now });
  const tomorrow = now + 86400000;
  const next = trades.concat(trade('B', 120, 1, { id: 'add', date: '2026-11-13', ts: tomorrow }));
  await pnl.ledgerChanged(next, tomorrow);
  assert.equal(pnl.state.snapshots[0].invalidatedAt, null);
  await pnl.capture(next, quotes(120, tomorrow), { ...fx, ts: tomorrow }, { now: tomorrow });
  const corrected = next.map(trade => ({ ...trade })); corrected[0].px = 90;
  await pnl.ledgerChanged(corrected, tomorrow);
  assert.equal(pnl.state.snapshots[0].invalidatedAt, '2026-11-10');
  assert.equal(pnl.value(pnl.state.snapshots[0], 'CNY'), null);
  assert.equal(pnl.state.snapshots[0].amounts.CNY.unrealized, 100);
  await pnl.capture(corrected, quotes(120, tomorrow), { ...fx, ts: tomorrow }, { now: tomorrow });
  assert.equal(pnl.state.snapshots[1].invalidatedAt, null);
  const interval = pnl.view(pnl.state.snapshots, 'month', '2026-11-13', 'CNY', pnl.state.anchor);
  assert.equal(interval.reference.date, '2026-11-13');
  assert.equal(interval.change, 0);
  await pnl.ledgerChanged(corrected.slice(1), tomorrow);
  assert.equal(pnl.state.snapshots[0].invalidatedAt, '2026-11-10');
});

test('chart keeps absolute P&L and missing days; incomplete baselines use actual recorded intervals', () => {
  const pnl = instance();
  const record = (date, px) => {
    const ts = Date.parse(date + 'T10:00:00+08:00');
    return pnl.buildSnapshot([trade('B', 100, 10, { date: '2026-10-01' })], quotes(px, ts), { ...fx, ts }, { now: ts }).snapshot;
  };
  const records = [record('2026-10-31', 110), record('2026-11-01', 112), record('2026-11-03', 115)];
  const monthly = pnl.view(records, 'month', '2026-11-03', 'CNY');
  assert.equal(monthly.total, 150); assert.equal(monthly.change, 50); assert.equal(monthly.completePeriod, true);
  assert.deepEqual(plain(monthly.points).map(point => point[1]), [120, null, 150]);
  const missingPrior = pnl.view([record('2026-10-28', 110), ...records.slice(1)], 'month', '2026-11-03', 'CNY');
  assert.equal(missingPrior.completePeriod, false); assert.equal(missingPrior.reference.date, '2026-10-28');
  const week = pnl.view(records, 'week', '2026-11-03', 'CNY');
  assert.equal(week.total, 150); assert.equal(week.points[0][1], 150);
});

test('history roundtrips with ledger matching; corrupted snapshots reject before mutation; legacy restore clears', async () => {
  const pnl = instance(), trades = [trade()];
  await pnl.init(trades, now); await pnl.capture(trades, quotes(), fx, { now });
  const exported = await pnl.exportData();
  const imported = instance(); await imported.init([], now);
  assert.equal(await imported.replace(exported, trades, now), true);
  assert.deepEqual(plain(imported.state.snapshots), plain(pnl.state.snapshots));
  const corrupt = plain(exported); corrupt.snapshots[0].amounts.CNY.unrealized = -999;
  assert.throws(() => imported.normalizeBackup(corrupt, trades, '2026-11-12'));
  assert.throws(() => imported.normalizeBackup({ ...plain(exported), complete: false }, trades, '2026-11-12'));
  assert.throws(() => imported.normalizeBackup(exported, [trade('B', 101)], '2026-11-12'));
  assert.equal(imported.state.snapshots.length, 1);
  assert.equal(await imported.replace(null, trades, now), true);
  assert.equal(imported.state.snapshots.length, 0);
  assert.equal(imported.state.anchor, null);
  assert.equal(imported.normalizeSnapshot({ ...plain(exported.snapshots[0]), capturedAt: 1e300 }), null);
});

test('IndexedDB failures abort atomically and surface unavailable storage without losing committed records', async () => {
  const database = new IDBFactory(), pnl = instance(database), trades = [trade()];
  await pnl.init(trades, now); await pnl.capture(trades, quotes(), fx, { now });
  const open = database.open.bind(database); let inject = true;
  database.open = (...args) => {
    const request = open(...args);
    request.addEventListener('success', () => {
      const original = request.result.transaction.bind(request.result);
      request.result.transaction = (...params) => {
        const transaction = original(...params);
        if (params[1] === 'readwrite' && inject) {
          inject = false;
          const metadata = transaction.objectStore('metadata');
          const put = metadata.put.bind(metadata);
          metadata.put = value => { const request = put(value); request.addEventListener('success', () => transaction.abort()); return request; };
        }
        return transaction;
      };
    });
    return request;
  };
  const failing = instance(database); await failing.init(trades, now);
  assert.equal(failing.state.status, 'unavailable');
  const reload = instance(database); await reload.init(trades, now);
  assert.equal(reload.state.snapshots[0].amounts.CNY.unrealized, 100);
  const unavailable = instance(null);
  assert.equal(await unavailable.init(trades, now), false);
  assert.equal(await unavailable.capture(trades, quotes(), fx, { now }), false);
  assert.equal(unavailable.state.status, 'unavailable');
});

test('concurrent instances cannot overwrite a newer daily capture, and can recover after conflicts', async () => {
  const database = new IDBFactory(), first = instance(database), second = instance(database), trades = [trade()];
  await first.init(trades, now); await second.init(trades, now);
  await Promise.all([
    first.capture(trades, quotes(110), fx, { now }),
    second.capture(trades, quotes(120, now + 1000), fx, { now: now + 1000 }),
  ]);
  await second.capture(trades, quotes(120, now + 1000), fx, { now: now + 1000 });
  assert.equal(await first.capture(trades, quotes(), fx, { now }), false);
  const fresh = instance(database); await fresh.init(trades, now + 1000);
  assert.equal(fresh.state.snapshots.length, 1);
  assert.equal(fresh.state.snapshots[0].amounts.CNY.unrealized, 200);
});

test('persisted retention removes old snapshots and activation anchor while cumulative realized gains survive', async () => {
  const pnl = instance();
  const trades = [trade('B', 100, 10, { date: '2024-01-01' }), trade('S', 120, 10, { id: 'sell', date: '2024-01-02' })];
  const previous = now - 366 * 86400000;
  await pnl.init(trades, previous); await pnl.capture(trades, {}, { ...fx, ts: previous }, { now: previous });
  await pnl.capture(trades, {}, fx, { now });
  assert.equal(pnl.state.snapshots.length, 2);
  assert.equal(pnl.state.anchor, null);
  assert.equal(pnl.value(pnl.state.snapshots.at(-1), 'CNY'), 200);
  assert.equal((await pnl.exportData()).ledger.length, 2);
});
