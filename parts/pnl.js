const PnlHistory = (() => {
  const currencies = ['CNY', 'USD', 'HKD'];
  const dayMilliseconds = 86400000;
  const databaseName = 'gaintrace-pnl-history';
  const snapshotsStore = 'snapshots';
  const metadataStore = 'metadata';
  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  let databasePromise;
  let entries = [];
  let ledger = null;
  let anchor = null;
  let status = 'loading';
  let issue = '';
  let queue = Promise.resolve();
  let changeHandler = null;
  let revision = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const timestamp = value => finite(value) && value >= 0 && value <= 8640000000000000;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  function dateAt(timestamp = Date.now()) {
    const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  const shiftDate = (date, offset) => new Date(Date.parse(date + 'T00:00:00Z') + offset * dayMilliseconds).toISOString().slice(0, 10);
  const cutoffAt = today => shiftDate(today, -364);
  function ledgerRows(trades) {
    return trades.map((trade, index) => ({
      id: String(trade.id || 'legacy-' + index), date: trade.date,
      signature: JSON.stringify([trade.date, trade.tc, trade.mkt, trade.cur, trade.side, trade.px, trade.qty, trade.fee || 0, trade.amt ?? null, trade.ts || 0]),
    }));
  }
  function changedSince(previous, next, today) {
    if (!previous) return null;
    const before = new Map(previous.map(row => [row.id, row]));
    const after = new Map(next.map(row => [row.id, row]));
    const dates = [];
    for (const row of previous) {
      const replacement = after.get(row.id);
      if (!replacement || row.signature !== replacement.signature) dates.push(row.date, replacement?.date);
    }
    for (const row of next) if (!before.has(row.id) && row.date < today) dates.push(row.date);
    return dates.filter(date => validDate(date) && date < today).sort()[0] || null;
  }
  function retain(records, today) {
    const cutoff = cutoffAt(today);
    const sorted = records.filter(record => validDate(record.date) && record.date <= today).sort((first, second) => first.date.localeCompare(second.date));
    const oldBaseline = sorted.filter(record => record.date < cutoff).at(-1);
    return (oldBaseline ? [oldBaseline] : []).concat(sorted.filter(record => record.date >= cutoff));
  }
  function buildSnapshot(trades, quotes, exchange, context = {}) {
    const capturedAt = context.now ?? Date.now();
    const today = dateAt(capturedAt);
    if (!trades.length || trades.some(trade => trade.demo)) return { snapshot: null, reason: 'empty' };
    const effectiveTrades = trades.filter(trade => trade.date <= today);
    if (!effectiveTrades.length) return { snapshot: null, reason: 'empty' };
    const positions = Core.calcPositions(effectiveTrades);
    const rates = { CNY: 1, USD: null, HKD: null };
    const validExchange = exchange && finite(exchange.ts) && exchange.ts <= capturedAt + 60000 && capturedAt - exchange.ts <= 48 * 3600000;
    if (validExchange && finite(exchange.USDCNY) && exchange.USDCNY > 0) rates.USD = exchange.USDCNY;
    if (validExchange && finite(exchange.HKDCNY) && exchange.HKDCNY > 0) rates.HKD = exchange.HKDCNY;
    const amounts = Object.fromEntries(currencies.map(currency => [currency, { realized: 0, unrealized: 0 }]));
    const purchases = Object.fromEntries(currencies.map(currency => [currency, 0]));
    for (const trade of effectiveTrades) {
      if (trade.side !== 'B') continue;
      const currency = trade.cur || ({ sh: 'CNY', sz: 'CNY', hk: 'HKD', us: 'USD' })[trade.mkt];
      if (!currencies.includes(currency)) return { snapshot: null, reason: 'ledger' };
      purchases[currency] += trade.px * trade.qty + (trade.fee || 0);
    }
    const valuations = [];
    for (const position of positions) {
      if (!currencies.includes(position.cur) || !finite(position.realized) || !finite(position.cost) || !finite(position.shares)) return { snapshot: null, reason: 'ledger' };
      if (position.cur !== 'CNY' && !rates[position.cur]) return { snapshot: null, reason: 'fx' };
      amounts[position.cur].realized += position.realized;
      if (!position.shares) continue;
      const quote = quotes[position.tc];
      const earliestQuote = context.startedAt ?? capturedAt - 15 * 60000;
      if (!quote || !finite(quote.px) || quote.px <= 0 || !finite(quote.ts) || quote.ts < earliestQuote || quote.ts > capturedAt + 60000) return { snapshot: null, reason: 'quotes' };
      amounts[position.cur].unrealized += position.shares * quote.px - position.cost;
      valuations.push({ tc: position.tc, cur: position.cur, shares: position.shares, cost: position.cost, px: quote.px, quoteAt: quote.ts });
    }
    if (currencies.some(currency => !finite(amounts[currency].realized) || !finite(amounts[currency].unrealized) || !finite(purchases[currency]) || purchases[currency] < 0)) return { snapshot: null, reason: 'ledger' };
    return { snapshot: { date: today, capturedAt, amounts, purchases, rates, fxAt: validExchange ? exchange.ts : null, fxApprox: exchange?.approx === true, positions: valuations, invalidatedAt: null }, reason: '' };
  }
  function normalizeSnapshot(record) {
    if (!record || !validDate(record.date) || !timestamp(record.capturedAt) || dateAt(record.capturedAt) !== record.date || !Array.isArray(record.positions) || record.positions.length > 5000) return null;
    if (record.invalidatedAt != null && (!validDate(record.invalidatedAt) || record.invalidatedAt > record.date)) return null;
    const amounts = {};
    const purchases = record.purchases == null ? null : {};
    const rates = { CNY: 1 };
    for (const currency of currencies) {
      const amount = record.amounts?.[currency];
      if (!amount || !finite(amount.realized) || !finite(amount.unrealized)) return null;
      amounts[currency] = { realized: amount.realized, unrealized: amount.unrealized };
      if (purchases) {
        if (!finite(record.purchases[currency]) || record.purchases[currency] < 0) return null;
        purchases[currency] = record.purchases[currency];
      }
      if (currency !== 'CNY') rates[currency] = finite(record.rates?.[currency]) && record.rates[currency] > 0 ? record.rates[currency] : null;
    }
    const positions = [];
    const identities = new Set();
    for (const position of record.positions) {
      if (!position || typeof position.tc !== 'string' || !/^(sh|sz|hk|us)[A-Za-z0-9_.]+$/.test(position.tc) || identities.has(position.tc) || !currencies.includes(position.cur) || !finite(position.shares) || !position.shares || !finite(position.cost) || !finite(position.px) || position.px <= 0 || !timestamp(position.quoteAt) || position.quoteAt > record.capturedAt + 60000) return null;
      identities.add(position.tc);
      positions.push({ tc: position.tc, cur: position.cur, shares: position.shares, cost: position.cost, px: position.px, quoteAt: position.quoteAt });
    }
    for (const currency of currencies) {
      const computed = positions.filter(position => position.cur === currency).reduce((total, position) => total + position.shares * position.px - position.cost, 0);
      if (!finite(computed) || Math.abs(computed - amounts[currency].unrealized) > Math.max(0.000001, Math.abs(computed) * 1e-10)) return null;
    }
    return { date: record.date, capturedAt: record.capturedAt, amounts, ...(purchases ? { purchases } : {}), rates, fxAt: finite(record.fxAt) ? record.fxAt : null, fxApprox: record.fxApprox === true, positions, invalidatedAt: validDate(record.invalidatedAt) ? record.invalidatedAt : null };
  }
  function value(record, base, component = 'total') {
    if (!record || record.invalidatedAt || !currencies.includes(base)) return null;
    if (component === 'purchases' && !record.purchases) return null;
    let total = 0;
    for (const currency of currencies) {
      const amount = record.amounts[currency];
      const native = component === 'purchases' ? record.purchases[currency] : component === 'realized' ? amount.realized : component === 'unrealized' ? amount.unrealized : amount.realized + amount.unrealized;
      if (!native) continue;
      if (currency === base) total += native;
      else {
        if (!record.rates[currency] || !record.rates[base]) return null;
        total += native * record.rates[currency] / record.rates[base];
      }
    }
    return finite(total) ? total : null;
  }
  function percentage(record, base) {
    const total = value(record, base);
    const basis = value(record, base, 'purchases');
    const result = total !== null && basis !== null && basis > 0 ? total / basis * 100 : null;
    return finite(result) ? result : null;
  }
  function demoHistory(trades, now = Date.now()) {
    if (!trades.length || !trades.every(trade => trade.demo)) return null;
    const today = dateAt(now);
    const cleanTrades = trades.map(({ demo, ...trade }) => trade);
    const snapshots = [];
    for (let day = 0; day < 90; day++) {
      const date = shiftDate(today, day - 89);
      const capturedAt = date === today ? now : Date.parse(date + 'T15:00:00+08:00');
      const effectiveTrades = cleanTrades.filter(trade => trade.date <= date);
      const demoQuotes = {};
      for (const position of Core.calcPositions(effectiveTrades)) {
        const phase = { CNY: 0, USD: 0.8, HKD: 1.5 }[position.cur] || 0;
        const move = 0.055 + day * 0.0008 + 0.015 * Math.sin(day * 0.25 + phase) + 0.008 * Math.cos(day * 0.11) + Math.max(0, day - 79) * 0.004;
        demoQuotes[position.tc] = { px: Math.max(0.01, Math.abs(position.avg) || 100) * (1 + move), ts: capturedAt };
      }
      const demoFx = { USDCNY: 7.1 + 0.04 * Math.sin(day / 17), HKDCNY: 0.91 + 0.006 * Math.cos(day / 11), ts: capturedAt, approx: false };
      const result = buildSnapshot(effectiveTrades, demoQuotes, demoFx, { now: capturedAt });
      if (result.snapshot) snapshots.push(result.snapshot);
    }
    return { status: 'ready', issue: '', snapshots, anchor: snapshots[0] || null, demo: true };
  }
  function periodStart(period, today) {
    if (period === 'month') return today.slice(0, 7) + '-01';
    if (period === 'year') return today.slice(0, 4) + '-01-01';
    if (period === 'week') return shiftDate(today, -(new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7);
    return cutoffAt(today);
  }
  function view(records, period, today, base, initialAnchor = null, mode = 'amount') {
    const start = [periodStart(period, today), cutoffAt(today)].sort().at(-1);
    const visible = records.filter(record => record.date >= start && record.date <= today).sort((first, second) => first.date.localeCompare(second.date));
    const prior = records.filter(record => record.date < start).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const firstValid = visible.find(record => value(record, base) !== null);
    const reference = prior && value(prior, base) !== null ? prior : initialAnchor && initialAnchor.date >= start && value(initialAnchor, base) !== null ? initialAnchor : firstValid;
    const latest = visible.at(-1) || null;
    const latestValue = value(latest, base);
    const baselineValue = value(reference, base);
    const points = [];
    const byDate = new Map(visible.map(record => [record.date, record]));
    if (visible.length) for (let date = visible[0].date; date <= today; date = shiftDate(date, 1)) points.push([Date.parse(date + 'T00:00:00Z'), mode === 'percent' ? percentage(byDate.get(date), base) : value(byDate.get(date), base)]);
    return { start, records: visible, reference, latest, total: latestValue, change: latestValue !== null && baselineValue !== null ? latestValue - baselineValue : null, completePeriod: reference === prior && prior?.date === shiftDate(start, -1) && baselineValue !== null, points };
  }
  function notify() { if (changeHandler) { try { changeHandler(); } catch (error) {} } }
  function openDatabase() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const request = indexedDB.open(databaseName, 1);
      const timer = setTimeout(() => reject(new Error('IndexedDB timeout')), 5000);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(snapshotsStore)) database.createObjectStore(snapshotsStore, { keyPath: 'date' });
        if (!database.objectStoreNames.contains(metadataStore)) database.createObjectStore(metadataStore, { keyPath: 'key' });
      };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB blocked')); };
      request.onsuccess = () => { clearTimeout(timer); request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    });
    return databasePromise;
  }
  async function load() {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([snapshotsStore, metadataStore], 'readonly');
      const snapshots = transaction.objectStore(snapshotsStore).getAll();
      const metadata = transaction.objectStore(metadataStore).get('state');
      transaction.oncomplete = () => {
        entries = snapshots.result.map(normalizeSnapshot).filter(Boolean).sort((first, second) => first.date.localeCompare(second.date));
        ledger = Array.isArray(metadata.result?.ledger) ? metadata.result.ledger : null;
        anchor = normalizeSnapshot(metadata.result?.anchor);
        revision = metadata.result?.revision || 0;
        resolve();
      };
      transaction.onabort = () => reject(transaction.error || new Error('History read failed'));
    });
  }
  async function commit(nextEntries, nextLedger, nextAnchor) {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([snapshotsStore, metadataStore], 'readwrite');
      const store = transaction.objectStore(snapshotsStore);
      const metadata = transaction.objectStore(metadataStore);
      const current = metadata.get('state');
      current.onsuccess = () => {
        if ((current.result?.revision || 0) !== revision) { transaction.abort(); return; }
        const nextDates = new Set(nextEntries.map(record => record.date));
        const previousByDate = new Map(entries.map(record => [record.date, JSON.stringify(record)]));
        for (const record of entries) if (!nextDates.has(record.date)) store.delete(record.date);
        for (const record of nextEntries) if (previousByDate.get(record.date) !== JSON.stringify(record)) store.put(record);
        metadata.put({ key: 'state', ledger: nextLedger, anchor: nextAnchor, revision: revision + 1 });
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error('History save failed'));
    });
    entries = nextEntries; ledger = nextLedger; anchor = nextAnchor; revision += 1; status = 'ready';
  }
  function enqueue(action) {
    const run = async () => { await load(); return action(); };
    const operation = queue.then(() => globalThis.navigator?.locks ? navigator.locks.request(databaseName, run) : run());
    queue = operation.catch(() => { status = 'unavailable'; issue = '盈亏历史存储不可用，请导出备份'; notify(); });
    return operation.catch(() => false);
  }
  async function observe(nextLedger, today) {
    const since = changedSince(ledger, nextLedger, today);
    const changed = ledger && JSON.stringify(ledger) !== JSON.stringify(nextLedger);
    const nextEntries = retain(entries, today).map(record => (since && record.date >= since && record.date < today) || (changed && record.date === today) ? { ...record, invalidatedAt: since || today } : record);
    let nextAnchor = anchor && anchor.date >= cutoffAt(today) ? anchor : null;
    if (since && nextAnchor && nextAnchor.date >= since) nextAnchor = { ...nextAnchor, invalidatedAt: since };
    if (!ledger && entries.length) for (const record of nextEntries) if (record.date < today) record.invalidatedAt = record.date;
    await commit(nextEntries, nextLedger, nextAnchor);
  }
  function init(trades, now = Date.now()) {
    const nextLedger = ledgerRows(copy(trades));
    return enqueue(async () => { await observe(nextLedger, dateAt(now)); notify(); return true; });
  }
  function ledgerChanged(trades, now = Date.now()) {
    const nextLedger = ledgerRows(copy(trades));
    return enqueue(async () => { await observe(nextLedger, dateAt(now)); notify(); return true; });
  }
  function capture(trades, quotes, exchange, context = {}) {
    const result = buildSnapshot(copy(trades), copy(quotes), exchange ? copy(exchange) : null, context);
    const nextLedger = ledgerRows(trades);
    return enqueue(async () => {
      if (!result.snapshot) {
        issue = { quotes: '本次行情未齐，未保存新的盈亏记录', fx: '本次汇率不可用，未保存新的盈亏记录', ledger: '账本数据需核验，未保存新的盈亏记录', empty: '' }[result.reason];
        notify(); return false;
      }
      if (JSON.stringify(ledger) !== JSON.stringify(nextLedger)) return false;
      const record = result.snapshot;
      if (entries.some(entry => entry.date > record.date)) return false;
      const existing = entries.find(entry => entry.date === record.date);
      if (existing && existing.capturedAt > record.capturedAt) return false;
      const nextEntries = retain(entries.filter(entry => entry.date !== record.date).concat(record), record.date);
      const nextAnchor = anchor && anchor.date >= cutoffAt(record.date) ? anchor : entries.length ? null : copy(record);
      await commit(nextEntries, nextLedger, nextAnchor);
      issue = ''; notify(); return true;
    });
  }
  function exportData() {
    return enqueue(async () => ({ schema: 1, complete: status === 'ready', snapshots: copy(entries), anchor: anchor ? copy(anchor) : null, ledger: ledger ? copy(ledger) : null }));
  }
  function normalizeBackup(data, trades, today) {
    if (data == null) return { snapshots: [], anchor: null, ledger: ledgerRows(trades) };
    if (!data || data.schema !== 1 || data.complete !== true || !Array.isArray(data.snapshots) || data.snapshots.length > 366 || !Array.isArray(data.ledger)) throw new Error('Invalid history backup');
    const snapshots = data.snapshots.map(normalizeSnapshot);
    if (snapshots.some(record => !record || record.date > today) || new Set(snapshots.map(record => record.date)).size !== snapshots.length) throw new Error('Invalid history records');
    const expectedLedger = ledgerRows(trades);
    if (JSON.stringify(data.ledger) !== JSON.stringify(expectedLedger)) throw new Error('History does not match ledger');
    const importedAnchor = data.anchor == null ? null : normalizeSnapshot(data.anchor);
    if (data.anchor != null && (!importedAnchor || importedAnchor.date > today)) throw new Error('Invalid history baseline');
    return { snapshots: retain(snapshots, today), anchor: importedAnchor && importedAnchor.date >= cutoffAt(today) ? importedAnchor : null, ledger: expectedLedger };
  }
  function replace(data, trades, now = Date.now()) {
    const prepared = normalizeBackup(data, copy(trades), dateAt(now));
    return enqueue(async () => { await commit(prepared.snapshots, prepared.ledger, prepared.anchor); issue = ''; notify(); return true; });
  }
  return {
    dateAt, cutoffAt, shiftDate, buildSnapshot, normalizeDate: validDate, normalizeSnapshot, retain, value, percentage, demoHistory, view, normalizeBackup, init, ledgerChanged, capture, exportData, replace,
    get state() { return { status, issue, snapshots: copy(entries), anchor: anchor ? copy(anchor) : null }; },
    set onChange(handler) { changeHandler = handler; },
  };
})();
