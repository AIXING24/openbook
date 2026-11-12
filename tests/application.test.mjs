import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import * as echarts from 'echarts';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const now = Date.parse('2026-11-12T10:00:00+08:00');
const fixture = { v: 1, seeded: true, base: 'CNY', upRed: true, theme: 'auto', brokers: [], lastBackup: 0, lastBroker: '', trades: [
  { id: 'fixture', date: '2026-11-10', tc: 'sh600000', mkt: 'sh', code: '600000', name: '测试股票', cur: 'CNY', side: 'B', px: 100, qty: 10, fee: 0, broker: '', note: '', ts: 1 },
] };
const copy = value => JSON.parse(JSON.stringify(value));
const until = async predicate => {
  for (let step = 0; step < 150; step++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Application did not reach expected state');
};
async function open(options = {}) {
  const errors = [], charts = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (error.type === 'unhandled exception') errors.push(error); });
  const network = { price: 110, incomplete: false };
  const dom = new JSDOM(html, {
    url: 'https://offline-gaintrace.invalid/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
    beforeParse(window) {
      const RealDate = window.Date;
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
      window.structuredClone = structuredClone;
      window.TextDecoder = TextDecoder;
      window.indexedDB = options.database === null ? undefined : options.database || new IDBFactory();
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.localStorage.setItem('cj.v1', JSON.stringify(options.state || fixture));
      if (options.pending) window.localStorage.setItem('cj.pnl-restore.v1', JSON.stringify(options.pending));
      if (options.blockStateWrite) {
        const proto = Object.getPrototypeOf(window.localStorage), original = proto.setItem;
        proto.setItem = function(key, value) { if (key === 'cj.v1') throw new Error('Quota exceeded'); return original.call(this, key, value); };
      }
      window.fetch = async url => {
        if (!String(url).startsWith('https://qt.gtimg.cn/q=')) throw new Error('Offline fixture only');
        const fields = Array(50).fill('0'); fields[1] = '测试股票'; fields[3] = String(network.price); fields[4] = '100';
        const text = (network.incomplete ? '' : 'v_sh600000="' + fields.join('~') + '";') + 'v_whUSDCNY="0~0~0~7~0";v_whHKDCNY="0~0~0~0.9~0";';
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
      };
      window.echarts = { init(container) {
        const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 320, height: 230 });
        const setOption = chart.setOption.bind(chart);
        chart.setOption = option => { setOption(option); container.innerHTML = chart.renderToSVGString(); };
        charts.push(chart);
        return chart;
      } };
    },
  });
  await until(() => !!dom.window.__cj);
  await dom.window.eval('PnlHistory.exportData()');
  await until(() => !dom.window.eval('refreshing'));
  await dom.window.eval('PnlHistory.exportData()');
  const app = { dom, window: dom.window, document: dom.window.document, charts, errors, network,
    evaluate: code => dom.window.eval(code), click: selector => { const element = dom.window.document.querySelector(selector); assert.ok(element, selector); element.click(); },
    close() { charts.forEach(chart => { if (!chart.isDisposed()) chart.dispose(); }); dom.window.close(); }
  };
  return app;
}

test('built HTML exactly matches six source parts and all scripts parse', () => {
  const expected = ['p1.html', 'core.js', 'data.js', 'pnl.js', 'ui.js', 'p4.html'].map(name => readFileSync(new URL('parts/' + name, root), 'utf8')).join('');
  assert.equal(html, expected);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.doesNotThrow(() => new vm.Script(scripts.join('\n')));
});

test('actual boot and quote refresh record automatically; privacy removes financial curve and sign color', async () => {
  const app = await open();
  try {
    assert.equal(app.window.__cj.S.trades.length, 1);
    assert.equal(app.evaluate('PnlHistory.state.snapshots[0].amounts.CNY.unrealized'), 100);
    app.click('#tabs button[data-view="stats"]');
    assert.equal(app.document.querySelector('#st-pnl'), null);
    assert.equal(app.document.querySelectorAll('#pnl-card .up, #pnl-card .down').length, 0);
    assert.match(app.document.querySelector('#pnl-card').textContent, /\*\*\*\*/);
    app.click('#btn-st-privacy');
    assert.match(app.document.querySelector('#st-pnl').innerHTML, /<svg/);
    assert.match(app.document.querySelector('#pnl-card').textContent, /\+¥100\.00/);
    const chart = app.window.__cj.stPnl;
    const option = chart.getOption();
    assert.equal(option.series[0].markLine.data[0].yAxis, 0);
    assert.equal(option.series[0].connectNulls, false);
    assert.equal(option.series[0].data[0][1], 100);
    assert.match(chart.renderToSVGString(), /<path/);
    app.click('#btn-st-privacy');
    assert.equal(app.window.__cj.stPnl, null); assert.equal(chart.isDisposed(), true);
    assert.equal(app.document.querySelector('#st-pnl'), null);
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test('incomplete refresh does not overwrite today; a later complete refresh replaces the daily point', async () => {
  const app = await open();
  try {
    app.network.incomplete = true;
    app.evaluate('quotes.sh600000.ts = Date.now() - 1000;');
    await app.evaluate('refreshQuotes()'); await app.evaluate('PnlHistory.exportData()');
    assert.equal(app.evaluate('PnlHistory.state.snapshots[0].amounts.CNY.unrealized'), 100);
    assert.match(app.evaluate('PnlHistory.state.issue'), /行情未齐/);
    app.network.incomplete = false; app.network.price = 120;
    await app.evaluate('refreshQuotes()'); await app.evaluate('PnlHistory.exportData()');
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 1);
    assert.equal(app.evaluate('PnlHistory.state.snapshots[0].amounts.CNY.unrealized'), 200);
    assert.equal(app.evaluate('PnlHistory.state.anchor.amounts.CNY.unrealized'), 100);
  } finally { app.close(); }
});

test('export includes complete history; import validates then restores both stores without polluting localStorage', async () => {
  const app = await open();
  try {
    app.click('#tabs button[data-view="set"]');
    await app.evaluate('doExport()');
    const backup = JSON.parse(app.document.querySelector('#exp-ta').value);
    assert.equal(backup.pnlHistory.complete, true); assert.equal(backup.pnlHistory.snapshots.length, 1);
    const prepared = app.evaluate('prepareImport(' + JSON.stringify(backup) + ')');
    app.window.preparedFixture = prepared;
    assert.equal(await app.evaluate('restoreDataset(preparedFixture.state, preparedFixture.history)'), true);
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 1);
    assert.equal(JSON.parse(app.window.localStorage.getItem('cj.v1')).pnlHistory, undefined);
    assert.equal(app.window.localStorage.getItem('cj.pnl-restore.v1'), null);
    const bad = copy(backup); bad.pnlHistory.snapshots[0].positions[0].px = 1;
    app.window.invalidFixture = bad;
    assert.throws(() => app.evaluate('prepareImport(invalidFixture)'));
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 1);
    assert.throws(() => app.evaluate('prepareImport({v:1,trades:[null]})'));
  } finally { app.close(); }
});

test('legacy imports and confirmed clear remove history; cancellation leaves it intact', async () => {
  const app = await open();
  try {
    app.click('#tabs button[data-view="set"]'); app.click('#btn-clear');
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 1);
    assert.equal(app.window.__cj.S.trades.length, 1);
    app.click('#btn-clear');
    await until(() => app.window.__cj.S.trades.length === 0);
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 0);
    const prepared = app.evaluate('prepareImport(' + JSON.stringify(fixture) + ')');
    app.window.legacyFixture = prepared;
    assert.equal(await app.evaluate('restoreDataset(legacyFixture.state, legacyFixture.history)'), true);
    assert.equal(app.window.__cj.S.trades.length, 1);
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 0);
  } finally { app.close(); }
});

test('interrupted restore journal rolls forward on reboot and completes safely', async () => {
  const pendingState = copy(fixture); pendingState.trades[0].px = 95;
  const app = await open({ pending: { state: pendingState, history: null } });
  try {
    assert.equal(app.window.__cj.S.trades[0].px, 95);
    assert.equal(JSON.parse(app.window.localStorage.getItem('cj.v1')).trades[0].px, 95);
    assert.equal(app.window.localStorage.getItem('cj.pnl-restore.v1'), null);
    assert.equal(app.evaluate('PnlHistory.state.snapshots[0].amounts.CNY.unrealized'), 150);
  } finally { app.close(); }
});

test('failed ledger write after history restore preserves a recovery journal and blocks misleading backups', async () => {
  const app = await open({ blockStateWrite: true });
  try {
    app.window.newFixture = { ...copy(fixture), trades: [] };
    assert.equal(await app.evaluate('restoreDataset(newFixture, null)'), false);
    assert.equal(app.window.__cj.S.trades.length, 1);
    assert.ok(app.window.localStorage.getItem('cj.pnl-restore.v1'));
    assert.equal(app.evaluate('restorePending'), true);
    await app.evaluate('doExport()');
    assert.match(app.document.querySelector('#toast').textContent, /恢复尚未完成/);
  } finally { app.close(); }
});

test('unavailable IndexedDB keeps the app usable and labels ledger-only backup explicitly', async () => {
  const app = await open({ database: null });
  try {
    app.click('#tabs button[data-view="stats"]');
    assert.match(app.document.querySelector('#pnl-card').textContent, /存储不可用/);
    app.click('#tabs button[data-view="set"]'); await app.evaluate('doExport()');
    assert.equal(JSON.parse(app.document.querySelector('#exp-ta').value).trades.length, 1);
    assert.match(app.document.querySelector('#modal-body').textContent, /不含盈亏历史/);
    assert.equal(JSON.parse(app.document.querySelector('#exp-ta').value).pnlHistory, undefined);
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test('existing iPhone safe-area configuration and diagnostic privacy are preserved', async () => {
  const app = await open();
  try {
    assert.match(app.document.querySelector('meta[name="viewport"]').content, /viewport-fit=contain/);
    assert.equal(app.document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content, 'default');
    const report = JSON.parse(app.evaluate('LayoutDiagnostics.report()'));
    assert.equal(report.version, 'v1.15.0'); assert.equal(report.build, 'layout-20261112-01');
    assert.equal(JSON.stringify(report).includes('测试股票'), false);
  } finally { app.close(); }
});
