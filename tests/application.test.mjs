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

test('actual boot records automatically; privacy keeps only percentage chart data and hides amounts', async () => {
  const app = await open();
  try {
    assert.equal(app.window.__cj.S.trades.length, 1);
    assert.equal(app.evaluate('PnlHistory.state.snapshots[0].amounts.CNY.unrealized'), 100);
    app.click('#tabs button[data-view="stats"]');
    assert.match(app.document.querySelector('#st-pnl').innerHTML, /<svg/);
    const hiddenChart = app.window.__cj.stPnl;
    const hiddenOption = hiddenChart.getOption();
    assert.equal(hiddenOption.series[0].data[0][1], 10);
    assert.equal(hiddenOption.yAxis[0].axisLabel.formatter(10), '10.00%');
    assert.equal(hiddenOption.series[0].markLine.label.formatter, '0%');
    const hiddenTooltip = hiddenOption.tooltip[0].formatter([{ value: hiddenOption.series[0].data[0] }]);
    assert.match(hiddenTooltip, /10\.00%/);
    assert.doesNotMatch(hiddenTooltip, /¥|HK\$|\$|100\.00|1000/);
    assert.doesNotMatch(app.document.querySelector('#pnl-card').innerHTML, /¥|HK\$|\$100|\+100/);
    assert.equal(app.document.querySelectorAll('#pnl-card .up, #pnl-card .down').length, 0);
    assert.match(app.document.querySelector('#pnl-card').textContent, /\*\*\*\*/);
    app.click('#btn-st-privacy');
    assert.equal(hiddenChart.isDisposed(), true);
    assert.match(app.document.querySelector('#st-pnl').innerHTML, /<svg/);
    assert.match(app.document.querySelector('#pnl-card').textContent, /\+¥100\.00/);
    const chart = app.window.__cj.stPnl;
    const option = chart.getOption();
    assert.equal(option.series[0].markLine.data[0].yAxis, 0);
    assert.equal(option.series[0].connectNulls, false);
    assert.equal(option.series[0].data[0][1], 100);
    assert.match(chart.renderToSVGString(), /<path/);
    app.click('#btn-st-privacy');
    assert.equal(chart.isDisposed(), true);
    assert.equal(app.window.__cj.stPnl.getOption().series[0].data[0][1], 10);
    assert.match(app.document.querySelector('#st-pnl').innerHTML, /<svg/);
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test('default demo ledger contains a multi-day sample curve in every period without saved demo snapshots', async () => {
  const app = await open({ state: { ...fixture, seeded: false, trades: [] } });
  try {
    assert.ok(app.window.__cj.S.trades.every(trade => trade.demo));
    assert.equal(app.window.__cj.S.demoVersion, 2);
    assert.match(app.document.querySelector('#v-pos').textContent, /示例交易与模拟行情/);
    assert.equal(app.document.querySelectorAll('#v-pos .down').length, 0);
    assert.ok(app.evaluate('calcDailyPnL().pnl') > 0);
    const quotesBefore = app.evaluate('JSON.stringify(quotes)');
    assert.ok(app.evaluate('Core.calcPositions(S.trades).every(p => p.realized >= 0 && demoMarket().quotes[p.tc].px * p.shares > p.cost && demoMarket().quotes[p.tc].chg > 0)'));
    assert.ok(app.evaluate('Core.calcPositions(S.trades).filter(p => p.trades.some(t => t.side === "S")).every(p => p.realized > 0)'));
    app.evaluate('openSheet("sh600519", true)');
    assert.equal(app.document.querySelectorAll('#sh-poscard .down, #sh-qgrid .down').length, 0);
    assert.match(app.document.querySelector('#sheet').textContent, /现价为模拟数据/);
    assert.equal(app.evaluate('JSON.stringify(quotes)'), quotesBefore, 'Demo display must not overwrite real quote cache');
    app.evaluate('closeSheet(true)');
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 0);
    app.click('#tabs button[data-view="stats"]');
    assert.match(app.document.querySelector('#pnl-card').textContent, /示例/);
    assert.match(app.document.querySelector('#pnl-card').textContent, /模拟近90天/);
    for (const period of ['week', 'month', 'year', 'all']) {
      app.click('#st-period button[data-p="' + period + '"]');
      const points = app.window.__cj.stPnl.getOption().series[0].data;
      assert.ok(points.length > 1);
      assert.ok(points.some(point => point[1] !== points[0][1]));
      assert.ok(points.every(point => point[1] > 0));
      const result = app.evaluate(`PnlHistory.view(PnlHistory.demoHistory(S.trades).snapshots, '${period}', PnlHistory.dateAt(), S.base)`);
      assert.ok(result.total > 0 && result.change > 0, period + ' must show a gain');
      if (period === 'all') assert.ok(points.some((point, index) => index && point[1] < points[index - 1][1]), 'Profitable demo still has fluctuations');
    }
    app.click('#btn-st-privacy');
    assert.ok(app.window.__cj.stPnl.getOption().series[0].data.every(point => point[1] > 0));
    assert.match(app.document.querySelector('#pnl-card').textContent, /\+¥/);
    await app.evaluate('PnlHistory.exportData()');
    assert.equal(app.evaluate('PnlHistory.state.snapshots.length'), 0);
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test('old demo ledger upgrades once; current demo and real or mixed ledgers remain unchanged', async () => {
  const sample = await open({ state: { ...fixture, seeded: false, trades: [] } });
  const current = copy(sample.window.__cj.S);
  sample.close();
  const old = { ...current, demoVersion: 0, trades: current.trades.map(trade => ({ ...trade, px: trade.side === 'B' ? trade.px * 2 : trade.px })) };
  const upgraded = await open({ state: old });
  try {
    assert.equal(upgraded.window.__cj.S.demoVersion, 2);
    assert.ok(upgraded.evaluate('Core.calcPositions(S.trades).every(p => p.realized >= 0)'));
    assert.notDeepEqual(copy(upgraded.window.__cj.S.trades), old.trades);
    assert.equal(upgraded.evaluate('PnlHistory.state.snapshots.length'), 0);
  } finally { upgraded.close(); }
  for (const state of [current, fixture, { ...fixture, trades: [...fixture.trades, current.trades[0]] }]) {
    const app = await open({ state });
    try {
      assert.deepEqual(copy(app.window.__cj.S.trades), state.trades);
      if (state !== current) {
        assert.equal(app.evaluate('demoMarket()'), null);
        assert.equal(app.evaluate('quotes.sh600000.px'), 110);
      }
    } finally { app.close(); }
  }
});

test('sample preview changes only the P&L panel and returns to unchanged real ledger and stored history', async () => {
  const app = await open();
  try {
    app.click('#tabs button[data-view="stats"]');
    const stateBefore = app.window.localStorage.getItem('cj.v1');
    const historyBefore = copy(app.evaluate('PnlHistory.state.snapshots'));
    app.click('#btn-pnl-demo');
    assert.match(app.document.querySelector('#pnl-card').textContent, /盈亏走势 · 示例/);
    assert.ok(app.window.__cj.stPnl.getOption().series[0].data.length > 1);
    assert.equal(app.window.localStorage.getItem('cj.v1'), stateBefore);
    assert.deepEqual(copy(app.evaluate('PnlHistory.state.snapshots')), historyBefore);
    app.click('#btn-st-privacy');
    assert.match(app.document.querySelector('#pnl-card').textContent, /纵轴为累计盈亏金额/);
    app.click('#btn-pnl-demo');
    assert.doesNotMatch(app.document.querySelector('#pnl-card').textContent, /模拟近90天/);
    assert.equal(app.window.__cj.stPnl.getOption().series[0].data[0][1], 100);
    assert.equal(app.window.localStorage.getItem('cj.v1'), stateBefore);
    assert.deepEqual(copy(app.evaluate('PnlHistory.state.snapshots')), historyBefore);
    app.click('#btn-pnl-demo'); app.click('#tabs button[data-view="pos"]'); app.click('#tabs button[data-view="stats"]');
    assert.equal(app.evaluate('pnlDemoPreview'), false);
  } finally { app.close(); }
});

test('amount chart tick labels match the exact scale used for mock point coordinates', async () => {
  const app = await open({ state: { ...fixture, seeded: false, trades: [] } });
  try {
    app.click('#tabs button[data-view="stats"]'); app.click('#btn-st-privacy');
    const check = () => {
      const chart = app.window.__cj.stPnl;
      const option = chart.getOption();
      const axis = chart.getModel().getComponent('yAxis').axis;
      const rows = axis.scale.getTicks().map(tick => {
        const label = option.yAxis[0].axisLabel.formatter(tick.value);
        const multiplier = label.endsWith('亿') ? 1e8 : label.endsWith('万') ? 1e4 : 1;
        const displayedAmount = parseFloat(label.replaceAll(',', '')) * multiplier;
        assert.ok(Math.abs(displayedAmount - tick.value) <= 0.01, `${tick.value} was incorrectly labelled ${label}`);
        assert.ok(chart.renderToSVGString().includes(label), `Actual SVG is missing tick ${label}`);
        return { value: tick.value, label, pixel: axis.toGlobalCoord(axis.dataToCoord(tick.value)) };
      });
      assert.equal(new Set(rows.map(row => row.label)).size, rows.length, 'Different monetary ticks must not share a label');
      for (const point of option.series[0].data) {
        if (point[1] === null) continue;
        const position = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, point);
        const enclosing = rows.findIndex(row => row.value >= point[1]);
        assert.ok(enclosing >= 0, 'Point lies outside the monetary scale');
        if (enclosing > 0) assert.ok(position[1] <= rows[enclosing - 1].pixel + 0.001 && position[1] >= rows[enclosing].pixel - 0.001, 'Point is not between its labelled monetary ticks');
        assert.ok(Math.abs(axis.coordToData(axis.dataToCoord(point[1])) - point[1]) <= 0.01);
      }
    };
    for (const period of ['month', 'week', 'all']) { app.click('#st-period button[data-p="' + period + '"]'); check(); }
    for (const values of [[-26360.45], [15000, -25000], [125000000, -26360450], [0.35, -0.125], [0]]) {
      app.window.axisFixture = { points: values.map((value, index) => [Date.parse('2026-11-12') + index * 86400000, value]) };
      app.evaluate("if (stPnl) stPnl.dispose(); renderPnlChart(axisFixture, 'amount');");
      check();
    }
  } finally { app.close(); }
});

test('calendar date labels stay unique and equally spaced across month boundaries, gaps and resize', async () => {
  const app = await open();
  try {
    app.click('#tabs button[data-view="stats"]');
    const cases = [
      ['2026-11-13', 1], ['2026-11-12', 2], ['2026-11-09', 5], ['2026-10-28', 10],
      ['2026-10-01', 31], ['2024-02-01', 29], ['2026-08-16', 90], ['2025-11-14', 365],
    ];
    for (const [date, length] of cases) for (const mode of ['amount', 'percent']) {
      const points = Array.from({ length }, (_, day) => [Date.parse(date) + day * 86400000, length > 10 && day >= 3 && day <= 5 ? null : (day % 7 - 2) * (mode === 'percent' ? 0.5 : 1000)]);
      app.window.axisFixture = { points };
      app.evaluate(`if (stPnl) stPnl.dispose(); renderPnlChart(axisFixture, '${mode}');`);
      const chart = app.window.__cj.stPnl;
      for (const width of [280, 320, 390, 560, 280]) {
        chart.resize({ width, height: 230 });
        const svgDom = new JSDOM(chart.renderToSVGString(), { contentType: 'image/svg+xml' });
        const labels = Array.from(svgDom.window.document.querySelectorAll('text'))
          .filter(node => /^\d{1,2}\/\d{1,2}$/.test(node.textContent))
          .map(node => ({ text: node.textContent, pixel: Number(/translate\(([-\d.]+)/.exec(node.getAttribute('transform') || '')?.[1]) + Number(node.getAttribute('x') || 0) }))
          .sort((a, b) => a.pixel - b.pixel);
        svgDom.window.close();
        const scenario = `${date}/${length}/${mode}/${width}`;
        assert.equal(new Set(labels.map(label => label.text)).size, labels.length, scenario + ': repeated day labels');
        assert.ok(labels.length >= (length === 1 ? 1 : 2) && labels.length <= 6, scenario + ': unsuitable label count');
        const dates = new Map(points.map(point => { const day = new Date(point[0]).toISOString().slice(0, 10); return [+day.slice(5, 7) + '/' + +day.slice(8), point[0]]; }));
        const dateAxis = chart.getModel().getComponent('xAxis').axis;
        for (const label of labels) {
          assert.ok(dates.has(label.text), scenario + ': date outside the recorded range');
          const expected = chart.convertToPixel({ xAxisIndex: 0 }, dates.get(label.text));
          assert.ok(Math.abs(expected - label.pixel) < 0.01, scenario + ': label does not match its date position');
        }
        for (let index = 2; index < labels.length; index++) {
          assert.ok(Math.abs((labels[index].pixel - labels[index - 1].pixel) - (labels[1].pixel - labels[0].pixel)) < 0.01, scenario + ': uneven visible date spacing');
          assert.equal(dates.get(labels[index].text) - dates.get(labels[index - 1].text), dates.get(labels[1].text) - dates.get(labels[0].text), scenario + ': unequal calendar intervals');
        }
        const dayPixels = points.map(point => dateAxis.toGlobalCoord(dateAxis.dataToCoord(point[0])));
        for (let index = 2; index < dayPixels.length; index++) assert.ok(Math.abs((dayPixels[index] - dayPixels[index - 1]) - (dayPixels[1] - dayPixels[0])) < 0.01, scenario + ': missing days compressed time');
        assert.deepEqual(copy(chart.getOption().series[0].data), points, scenario + ': chart altered the recorded values or gaps');
      }
    }
    assert.deepEqual(app.errors, []);
  } finally { app.close(); }
});

test('legacy records remain usable as amounts and never invent a missing percentage basis', async () => {
  const app = await open();
  try {
    const history = await app.evaluate('PnlHistory.exportData()');
    delete history.snapshots[0].purchases;
    delete history.anchor.purchases;
    app.window.legacyHistory = history;
    assert.equal(await app.evaluate('PnlHistory.replace(legacyHistory, S.trades)'), true);
    app.click('#tabs button[data-view="stats"]');
    assert.equal(app.window.__cj.stPnl, null);
    assert.match(app.document.querySelector('#pnl-card').textContent, /早期记录未保存买入基数/);
    app.click('#btn-st-privacy');
    assert.equal(app.window.__cj.stPnl.getOption().series[0].data[0][1], 100);
    app.click('#btn-st-privacy');
    await app.evaluate('refreshQuotes()'); await app.evaluate('PnlHistory.exportData()');
    assert.equal(app.window.__cj.stPnl.getOption().series[0].data[0][1], 10);
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
    assert.equal(report.version, 'v1.15.4'); assert.equal(report.build, 'layout-20261113-01');
    assert.equal(JSON.stringify(report).includes('测试股票'), false);
  } finally { app.close(); }
});
