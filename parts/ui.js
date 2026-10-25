/* ===== UI 工具 ===== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SYM = { CNY: '¥', USD: '$', HKD: 'HK$' };
const CN = { CNY: '人民币', USD: '美元' };
const MKT_TAG = { sh: '沪', sz: '深', hk: '港', us: '美' };
const ICO = { refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>' };

function fmtAmt(v, cur, sign) {
  const s = SYM[cur] || cur + ' ';
  const str = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : (sign ? '+' : '')) + s + str;
}
/* 大金额紧凑显示: ≥1亿用亿、≥10万用万, 防止统计块与表格在窄屏溢出 */
function fmtAmtC(v, cur, sign) {
  const s = SYM[cur] || cur + ' ';
  const a = Math.abs(v);
  const sg = v < 0 ? '-' : (sign ? '+' : '');
  if (a >= 1e8) return sg + s + (a / 1e8).toFixed(2) + '亿';
  if (a >= 1e5) return sg + s + (a / 1e4).toFixed(2) + '万';
  return sg + s + a.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPx(v) {
  if (!isFinite(v)) return '--';
  const d = Math.abs(v) >= 1 ? 2 : 4;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: d });
}
function fmtQty(q) { return q % 1 ? q.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : String(Math.round(q)); }
function fmtPct(v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
function fmtVol(v) { if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿'; if (v >= 1e4) return (v / 1e4).toFixed(1) + '万'; return String(Math.round(v)); }
function compactNum(v) { if (!v) return '0'; const a = Math.abs(v); if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿'; if (a >= 1e4) return (v / 1e4).toFixed(0) + '万'; return String(Math.round(v)); }
function fmtTs(ts) { const d = new Date(ts); return Core.pad(d.getHours()) + ':' + Core.pad(d.getMinutes()); }
function fmtDate(ds) { const p = String(ds).split('-'); return +p[1] + '月' + +p[2] + '日'; }
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function showToast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(showToast._t); showToast._t = setTimeout(() => t.hidden = true, 2400); }

/* ===== 主题与涨跌配色 ===== */
const UD = {
  light: { red: '#d93025', redBg: '#fcebe9', green: '#0e9f6e', greenBg: '#e5f6f0' },
  dark: { red: '#e5484d', redBg: 'rgba(229,72,77,.16)', green: '#12a594', greenBg: 'rgba(18,165,148,.16)' }
};
function isDark() { const t = document.documentElement.dataset.theme; if (t) return t === 'dark'; return matchMedia('(prefers-color-scheme: dark)').matches; }
function applyUpDown() {
  const c = UD[isDark() ? 'dark' : 'light'];
  const r = document.documentElement.style;
  r.setProperty('--up', S.upRed ? c.red : c.green);
  r.setProperty('--down', S.upRed ? c.green : c.red);
  r.setProperty('--up-bg', S.upRed ? c.redBg : c.greenBg);
  r.setProperty('--down-bg', S.upRed ? c.greenBg : c.redBg);
}
function applyTheme() {
  const d = document.documentElement;
  if (S.theme === 'auto') delete d.dataset.theme; else d.dataset.theme = S.theme;
  applyUpDown();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'auto') { applyUpDown(); rerender(); } });

function fxInfo() {
  if (fx && fx.ts) return { USDCNY: fx.USDCNY, HKDCNY: fx.HKDCNY, approx: fx.approx || (Date.now() - fx.ts > 48 * 3600e3) };
  return { USDCNY: Core.FX_FALLBACK.USDCNY, HKDCNY: Core.FX_FALLBACK.HKDCNY, approx: true };
}

/* ===== 视图切换 ===== */
let curView = null, picked = null, side = 'B';
function activeTcs() {
  const set = new Set(Core.calcPositions(S.trades).map(p => p.tc));
  if (picked && picked.tc) set.add(picked.tc);
  return [...set];
}
/* 视图切换压入浏览器历史 → 支持 iOS 边缘右滑返回(popstate 驱动) */
function showView(v, fromPop) {
  if (v === curView) { $('#main').scrollTop = 0; return; }
  if (!fromPop) { try { history.pushState({ v: v }, ''); } catch (e) {} }
  curView = v;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  ['pos', 'add', 'stats', 'set'].forEach(x => { $('#v-' + x).hidden = (x !== v); });
  if (v !== 'stats') {
    if (stChart) { stChart.dispose(); stChart = null; }
    if (stDonut) { stDonut.dispose(); stDonut = null; }
  }
  if (v === 'pos') renderPos();
  else if (v === 'stats') renderStats();
  else if (v === 'set') renderSet();
  $('#main').scrollTop = 0;   // 内容区滚动归零(应用壳布局下文档本身不滚动)
}
function rerender() {
  if (curView === 'pos') renderPos();
  else if (curView === 'stats') renderStats();
  else if (curView === 'set') renderSet();
  if (sheetTc && !$('#sheet').hidden) {
    renderSheetQuote(); renderSheetPos(); renderSheetTrades();
    const c = kCache[sheetTc + '|' + kPeriod];
    if (kChart && c) renderKline(c);
  }
}
function bindSeg(sel, fn, attr) {
  const el = $(sel); if (!el) return;
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    fn(b.dataset[attr || 'v']);
  });
}

/* ===== 持仓页 ===== */
function netBadge() {
  if (net.ok === false) return '<span class="netbad">行情不可用</span>';
  return net.at ? fmtTs(net.at) + ' 更新' : '待获取行情';
}
function emptyHtml() {
  return `<div class="card empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-6 4 3 5-8 4 5"/><path d="M3 21h18"/></svg>
    <p>还没有交易记录</p><div class="s">第一笔记录后，这里会汇总持仓、盈亏与统计</div>
    <button class="btn btn-primary" id="e-add" style="width:190px;margin:16px auto 0;display:block">记第一笔交易</button>
    <button class="btn" id="e-demo" style="margin-top:10px">载入示例数据看看</button></div>`;
}
function renderPos() {
  const el = $('#v-pos'); const F = fxInfo();
  const poss = Core.calcPositions(S.trades);
  let mktB = 0, costB = 0, realB = 0, noPx = 0;
  const rows = poss.map(p => {
    const q = quotes[p.tc]; const has = q && isFinite(q.px);
    const mvB = has ? Core.toBase(q.px * p.shares, p.cur, S.base, F) : null;
    const cB = Core.toBase(p.cost, p.cur, S.base, F);
    if (p.shares > 0) { costB += cB; if (mvB != null) mktB += mvB; else noPx++; }
    realB += Core.toBase(p.realized, p.cur, S.base, F);
    const pnl = p.shares > 0 && mvB != null ? mvB - cB : null;
    const left = `<div class="pr-l"><div class="pr-name"><span class="nm">${esc(p.name)}</span><span class="tag">${MKT_TAG[p.mkt] || ''}</span></div>
      <div class="pr-sub num">${p.shares > 0 ? fmtQty(p.shares) + '股 · 成本 ' + fmtAmt(p.avg, p.cur) : '已清仓 · 已实现 ' + fmtAmt(p.realized, p.cur, true)}</div></div>`;
    const right = p.shares > 0
      ? `<div class="pr-r"><div class="pr-px num">${has ? fmtPx(q.px) : '--'}${has ? ` <span class="pill ${q.pct >= 0 ? 'up' : 'down'}">${fmtPct(q.pct)}</span>` : ''}</div>
         <div class="pr-val num">${mvB != null ? fmtAmt(mvB, S.base) : '现价不可用'}${pnl != null ? ` <span class="pnl ${pnl >= 0 ? 'up' : 'down'}">${fmtAmt(pnl, S.base, true)}</span>` : ''}</div></div>`
      : `<div class="pr-r"><div class="pr-px num" style="color:var(--faint)">--</div>
         <div class="pr-val num"><span class="${p.realized >= 0 ? 'up' : 'down'}">${fmtAmt(Core.toBase(p.realized, p.cur, S.base, F), S.base, true)}</span></div></div>`;
    return `<button class="pos-row" data-tc="${esc(p.tc)}">${left}${right}</button>`;
  }).join('');
  const unreal = mktB - costB;
  const divB = poss.reduce((a, p) => a + Core.toBase(p.dividend, p.cur, S.base, F), 0);
  const demo = S.trades.some(t => t.demo);
  const d = new Date(); const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  el.innerHTML = `
   <div class="pagehead"><div style="flex:1"><div class="ttl" style="letter-spacing:.04em">OPEN BOOK</div>
     <div class="sub">${d.getMonth() + 1}月${d.getDate()}日 周${week} · ${netBadge()}</div></div>
     <button class="iconbtn" id="btn-refresh" aria-label="刷新行情">${ICO.refresh}</button></div>
   ${storageDead ? '<div class="banner">浏览器存储不可用（可能处于隐私模式）— 数据仅本次会话有效，请尽快导出备份。</div>' : ''}
   ${demo ? '<div class="banner">当前为示例数据：记录第一笔真实交易后自动替换，也可在设置中清空。</div>' : ''}
   ${net.ok === false ? '<div class="banner">行情获取失败（可能离线或受限环境）— 现价与K线暂不可用，记账与统计不受影响。</div>' : ''}
   ${divInbox.length ? `<button class="divcard" id="div-inbox-btn"><div style="flex:1"><div class="dc-t">发现 ${divInbox.length} 笔疑似分红待确认</div><div class="dc-s">点击查看 · 金额自动估算可修正 · 一键入账</div></div><span class="dc-arrow">›</span></button>` : ''}
   <div class="card sum">
     <div class="lbl">总市值（折${CN[S.base]}）</div>
     <div class="big num">${fmtAmt(mktB, S.base)}</div>
     <div class="sum-grid">
       <div><div class="lbl">浮动盈亏</div><div class="v num ${unreal >= 0 ? 'up' : 'down'}">${fmtAmtC(unreal, S.base, true)}</div></div>
       <div><div class="lbl">持仓成本（摊薄）</div><div class="v num">${fmtAmtC(costB, S.base)}</div></div>
       <div><div class="lbl">已实现盈亏</div><div class="v num ${realB >= 0 ? 'up' : 'down'}">${fmtAmtC(realB, S.base, true)}</div></div>
       <div><div class="lbl">分红收益（累计）</div><div class="v num">${fmtAmtC(divB, S.base)}</div></div>
     </div>
     <div class="fx-line num">1 USD = ${F.USDCNY.toFixed(4)} CNY · 1 HKD = ${F.HKDCNY.toFixed(4)} CNY${F.approx ? ' · 备用汇率' : ''}${noPx ? ` · ${noPx} 只无行情未计入总市值` : ''}</div>
   </div>
   ${poss.length ? `<div class="pos-h"><h2>持仓明细</h2><span>${poss.length} 只 · 点击看K线</span></div><div class="poslist">${rows}</div>` : emptyHtml()}`;
  const rb = $('#btn-refresh'); if (rb) rb.onclick = () => refreshQuotes();
  const dib = $('#div-inbox-btn'); if (dib) dib.onclick = openDivModal;
  el.querySelectorAll('.pos-row').forEach(b => b.onclick = () => openSheet(b.dataset.tc));
  const ea = $('#e-add'); if (ea) ea.onclick = () => showView('add');
  const ed = $('#e-demo'); if (ed) ed.onclick = () => { S.trades = demoTrades(); save(); renderPos(); };
}

/* ===== 记一笔 ===== */
function setPicked(p) { picked = p; renderPicked(); }
function renderPicked() {
  const el = $('#f-pick');
  if (!picked) { el.hidden = true; return; }
  el.hidden = false;
  const q = quotes[picked.tc];
  $('#pk-name').innerHTML = esc(picked.name || picked.code) + ' <span class="tag">' + (MKT_TAG[picked.mkt] || '') + (picked.ty ? '·' + esc(picked.ty) : '') + '</span>';
  $('#pk-sub').textContent = picked.code + ' · ' + picked.cur +
    (q && isFinite(q.px) ? ' · 现价 ' + fmtPx(q.px) : '');
  $('#f-usepx').hidden = !(q && isFinite(q.px));
  updateAmt();
}
function hideSugg() { const s = $('#f-sugg'); if (s) { s.hidden = true; s.innerHTML = ''; } }
function showSuggTip(t) { const s = $('#f-sugg'); s.hidden = false; s.innerHTML = '<div class="sg-tip">' + esc(t) + '</div>'; }
function renderSugg(list) {
  const s = $('#f-sugg');
  if (!list || !list.length) { showSuggTip('无匹配结果，试试拼音或代码'); return; }
  s.hidden = false;
  s.innerHTML = list.map(r => `<button type="button" data-tc="${esc(r.tc)}"><span class="sg-name">${esc(r.name)} <span class="tag">${MKT_TAG[r.mkt] || ''}${r.ty ? '·' + r.ty : ''}</span></span><span class="sg-code">${esc(r.code)}</span></button>`).join('');
  s.querySelectorAll('button').forEach(b => b.onclick = () => {
    const r = list.find(x => x.tc === b.dataset.tc);
    setPicked({ tc: r.tc, code: r.code, mkt: r.mkt, name: r.name, cur: Core.CUR_OF[r.mkt], ty: r.ty || '' });
    $('#f-q').value = ''; hideSugg();
    fetchOneQuote(r.tc);
  });
}
function fetchOneQuote(tc) {
  if (/^us/.test(tc)) {
    usQuote(tc).then(q => { if (q) { quotes[tc] = Object.assign({ ts: Date.now() }, q); saveQuotes(); renderPicked(); } });
  } else {
    ftext('https://qt.gtimg.cn/q=' + tc, 6000, 'gbk')
      .then(txt => { const p = parseQtText(txt); if (p.quotes && p.quotes[tc]) { quotes[tc] = Object.assign({ ts: Date.now() }, p.quotes[tc]); saveQuotes(); renderPicked(); } })
      .catch(() => {});
  }
}
async function pickTc(tc) {
  const mkt = (/^(sh|sz|hk|us)/.exec(tc) || [])[1] || 'sh';
  const cd = tc.slice(2);
  const base = { tc, code: cd, mkt, name: cd, cur: Core.CUR_OF[mkt],
    ty: /^(51|56|58|15)/.test(cd) ? 'ETF' : /^(50|16)/.test(cd) ? 'LOF' : '' };
  setPicked(base); hideSugg(); $('#f-q').value = '';
  try {
    if (mkt === 'us') { const q = await usQuote(tc); if (q) { quotes[tc] = Object.assign({ ts: Date.now() }, q); saveQuotes(); } }
    else {
      const txt = await ftext('https://qt.gtimg.cn/q=' + tc, 6000, 'gbk');
      const p = parseQtText(txt); const qq = p.quotes && p.quotes[tc];
      if (!qq) { setPicked(null); showToast('未找到该代码，请检查'); return; }
      quotes[tc] = Object.assign({ ts: Date.now() }, qq); saveQuotes();
    }
  } catch (e) { /* 离线: 保留代码形式的选择 */ }
  const q = quotes[tc];
  if (q && q.name) setPicked(Object.assign({}, base, { name: q.name }));
  renderPicked();
}
async function doSearch(v) {
  showSuggTip('搜索中…');
  const r = await smartSearch(v);
  if (r === null) { showSuggTip('搜索失败 — 网络受限或离线，可直接输入代码'); return; }
  if (!r.length) {
    const m = /^([A-Za-z]{1,6})(?:\.([A-Za-z]{1,2}))?$/.exec(v);   // smartbox 未收录的美股代码 → 直连兜底
    if (m) { await tryUS(m[1].toUpperCase(), m[2] ? m[2].toUpperCase() : null); return; }
    showSuggTip('无匹配结果，试试拼音或代码');
    return;
  }
  renderSugg(r);
}
async function tryUS(sym, suf) {
  showSuggTip('识别美股代码 ' + sym + ' …');
  const r = await resolveUS(sym, suf);
  if (!r) { showSuggTip('无匹配结果，试试拼音或代码'); return; }
  setPicked({ tc: r.tc, code: r.code, mkt: 'us', name: r.name || r.code, cur: 'USD', ty: '' });
  $('#f-q').value = ''; hideSugg();
  fetchOneQuote(r.tc);
}
/* 输入路由: 完整6位数字(已知前缀)直连; 其余(不完整数字/字母/中文/拼音)走搜索建议列表 */
let qDeb = null;
function qInput(now) {
  const v = $('#f-q').value.trim();
  clearTimeout(qDeb);
  if (!v) { hideSugg(); return; }
  qDeb = setTimeout(() => {
    if (/^\d{6}$/.test(v)) {
      const d = directTc(v);
      if (d && d.err) { showSuggTip(d.err); return; }
      if (d && d.tc) { pickTc(d.tc); return; }
    }
    doSearch(v);
  }, now ? 0 : 600);
}
function updateAmt() {
  const px = +$('#f-px').value || 0, qty = +$('#f-qty').value || 0, fee = +$('#f-fee').value || 0;
  const cur = picked ? picked.cur : 'CNY';
  const amt = side === 'D' ? px * qty : (side === 'B' ? px * qty + fee : px * qty - fee);
  $('#f-amt-v').textContent = (picked && qty > 0)
    ? fmtAmt(amt, cur) + (side === 'D' ? '（分红冲减成本）' : (S.base !== cur ? ' ≈ ' + fmtAmt(Core.toBase(amt, cur, S.base, fxInfo()), S.base) : ''))
    : '—';
}
function initAdd() {
  $('#f-date').value = Core.todayStr();
  const dl = $('#f-brokers');
  dl.innerHTML = S.brokers.map(b => '<option value="' + esc(b) + '">').join('');
  if (S.lastBroker) $('#f-broker').value = S.lastBroker;
  $('#f-side').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    side = b.dataset.side;
    $$('#f-side button').forEach(x => x.classList.toggle('on', x === b));
    const isD = side === 'D';
    $('#f-px-lbl').textContent = isD ? '每份派息（元）' : '价格';
    $('#f-qty-lbl').textContent = isD ? '分红份额' : '数量（股）';
    $('#f-fee-cell').hidden = isD;
    if (isD) {
      const p = picked && Core.calcPositions(S.trades).find(x => x.tc === picked.tc);
      if (p && p.shares > 0) $('#f-qty').value = p.shares;
    }
    updateAmt();
  });
  $('#f-unpick').onclick = () => setPicked(null);
  $('#f-usepx').onclick = () => { const q = quotes[picked && picked.tc]; if (q && isFinite(q.px)) { $('#f-px').value = q.px; updateAmt(); } };
  ['f-px', 'f-qty', 'f-fee'].forEach(id => $('#' + id).addEventListener('input', updateAmt));
  $('#f-q').addEventListener('input', () => qInput(false));
  $('#f-q').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const s = $('#f-sugg');
      const first = s && !s.hidden ? s.querySelector('button') : null;
      if (first) { first.click(); return; }   // 建议列表开着 → 回车选第一条
      qInput(true);
    }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.searchbox')) hideSugg(); });
  $('#f-save').onclick = saveTrade;
}
function saveTrade() {
  if (!picked) { showToast('请先选择股票'); return; }
  const px = +$('#f-px').value, qty = +$('#f-qty').value, fee = +$('#f-fee').value || 0;
  const date = $('#f-date').value || Core.todayStr(), broker = $('#f-broker').value.trim(), note = $('#f-note').value.trim();
  if (!(qty > 0)) { showToast(side === 'D' ? '请输入分红份额' : '请输入数量'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showToast('请选择日期'); return; }
  if (S.trades.length && S.trades.every(t => t.demo)) S.trades = [];   // 首笔真实交易替换示例
  const t = { id: uid(), date, tc: picked.tc, mkt: picked.mkt, code: picked.code, name: picked.name || picked.code, cur: picked.cur,
    side, px: +px.toFixed(6), qty, fee: side === 'D' ? 0 : fee, broker, note, ts: Date.now() };
  if (side !== 'D' && !(px > 0)) { showToast('请输入价格'); return; }
  if (side === 'D') {
    if (!(px > 0)) { showToast('请输入每份派息（可从公告的每10份÷10）'); return; }
    t.amt = +(px * qty).toFixed(4);
  }
  S.trades.push(t);
  if (broker) {
    S.lastBroker = broker;
    if (S.brokers[0] !== broker) S.brokers = [broker].concat(S.brokers.filter(b => b !== broker)).slice(0, 12);
  }
  save();
  if (side === 'D') showToast('已记录分红 ' + t.name + ' ' + fmtAmt(t.amt, t.cur));
  else showToast('已记录' + (side === 'B' ? '买入' : '卖出') + ' ' + t.name + ' ' + fmtQty(qty) + '股');
  resetAddForm(); showView('pos'); refreshQuotes();
}
function resetAddForm() {
  setPicked(null);
  ['f-px', 'f-qty', 'f-fee', 'f-note'].forEach(id => $('#' + id).value = '');
  $('#f-date').value = Core.todayStr();
  updateAmt();
}

/* ===== 统计页 ===== */
let statPeriod = 'month', stChart = null, stDonut = null, statsSlideDir = 0;   // 1=滑入自右侧(切下一个), -1=自左侧
/* 分类色板(环形图按股票身份编码), 取自已验证的参考调色板, 固定顺序不循环 */
const CAT = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300']
};
function renderStats() {
  if (stChart) { stChart.dispose(); stChart = null; }
  if (stDonut) { stDonut.dispose(); stDonut = null; }
  const el = $('#v-stats'); const F = fxInfo();
  const start = statPeriod === 'week' ? Core.weekStartStr() : statPeriod === 'month' ? Core.monthStartStr() : statPeriod === 'year' ? Core.yearStartStr() : '0000-00-00';
  const st = Core.calcStats(S.trades, start);
  const cvt = b => ['CNY', 'USD', 'HKD'].reduce((a, c) => a + Core.toBase(b[c] || 0, c, S.base, F), 0);
  const buyB = cvt(st.buy), sellB = cvt(st.sell), netB = buyB - sellB;
  const realB = Core.calcPositions(S.trades).reduce((a, p) => a + Core.toBase(p.realized, p.cur, S.base, F), 0);
  const rangeLabel = statPeriod === 'week' ? '本周（' + fmtDate(Core.weekStartStr()) + ' 起）' : statPeriod === 'month' ? '本月' : statPeriod === 'year' ? '本年' : '全部';
  const stocksHtml = st.stocks.map(sk => {
    const b = cvt(sk.buy), s = cvt(sk.sell), n = b - s;
    return `<tr data-tc="${esc(sk.tc)}"><td class="nm">${esc(sk.name)}</td><td class="num">${fmtAmtC(b, S.base)}</td><td class="num">${fmtAmtC(s, S.base)}</td><td class="num ${n >= 0 ? 'up' : 'down'}">${fmtAmtC(n, S.base, true)}</td></tr>`;
  }).join('');
  const brokersHtml = st.brokers.map(br => {
    const b = cvt(br.buy), s = cvt(br.sell), n = b - s;
    return `<tr><td class="nm">${esc(br.broker)}</td><td class="num">${fmtAmtC(b, S.base)}</td><td class="num">${fmtAmtC(s, S.base)}</td><td class="num ${n >= 0 ? 'up' : 'down'}">${fmtAmtC(n, S.base, true)}</td></tr>`;
  }).join('');
  const donutMode = st.buy.n > 0 ? 'buy' : (st.sell.n > 0 ? 'sell' : null);
  el.innerHTML = `
   <div class="pagehead"><div style="flex:1"><div class="ttl">统计</div>
     <div class="sub">${rangeLabel} · ${st.n} 笔交易</div></div></div>
   <div class="seg" id="st-period">
     <button data-p="week" class="${statPeriod === 'week' ? 'on' : ''}">本周</button>
     <button data-p="month" class="${statPeriod === 'month' ? 'on' : ''}">本月</button>
     <button data-p="year" class="${statPeriod === 'year' ? 'on' : ''}">本年</button>
     <button data-p="all" class="${statPeriod === 'all' ? 'on' : ''}">全部</button>
   </div>
   <div class="tile-row">
     <div class="tile"><div class="lbl">买入金额</div><div class="v num">${fmtAmtC(buyB, S.base)}</div><div class="s">${st.buy.n} 笔</div></div>
     <div class="tile"><div class="lbl">卖出金额</div><div class="v num">${fmtAmtC(sellB, S.base)}</div><div class="s">${st.sell.n} 笔</div></div>
   </div>
   <div class="tile-row">
     <div class="tile"><div class="lbl">净买入</div><div class="v num ${netB >= 0 ? 'up' : 'down'}">${fmtAmtC(netB, S.base, true)}</div><div class="s">买入 − 卖出</div></div>
     <div class="tile"><div class="lbl">已实现盈亏（累计）</div><div class="v num ${realB >= 0 ? 'up' : 'down'}">${fmtAmtC(realB, S.base, true)}</div><div class="s">含历史全部卖出</div></div>
   </div>
   ${donutMode ? `<div class="card"><div class="chart-head"><h2 style="font-size:15px;margin:0">本期${donutMode === 'buy' ? '买入' : '卖出'}构成</h2></div><div id="st-donut"></div><div class="dlegend" id="st-dlegend"></div></div>` : ''}
   ${statPeriod === 'year' ? `<div class="card"><div class="chart-head"><h2 style="font-size:15px;margin:0">月度买卖（本年）</h2></div><div id="st-chart"></div></div>` : ''}
   ${st.stocks.length ? `<div class="card"><div class="pos-h" style="padding:0 0 8px"><h2>按股票</h2><span>${st.stocks.length} 只</span></div>
     <div class="twrap"><table class="t" id="st-stocks"><thead><tr><th>股票</th><th>买入</th><th>卖出</th><th>净额</th></tr></thead><tbody>${stocksHtml}</tbody></table></div></div>` : ''}
   ${st.brokers.length ? `<div class="card"><div class="pos-h" style="padding:0 0 8px"><h2>按券商</h2><span>${st.brokers.length} 家</span></div>
     <div class="twrap"><table class="t"><thead><tr><th>券商</th><th>买入</th><th>卖出</th><th>净额</th></tr></thead><tbody>${brokersHtml}</tbody></table></div></div>` : ''}
   <p class="footnote">外币金额按当前汇率折算${F.approx ? '（备用汇率，仅供参考）' : ''} · 金额满10万以「万」计 · 左右滑动可切换周期 · 点击股票行可查看K线与交易记录</p>`;
  bindSeg('#st-period', v => { statPeriod = v; renderStats(); }, 'p');
  el.querySelectorAll('#st-stocks tbody tr').forEach(tr => tr.onclick = () => openSheet(tr.dataset.tc));
  if (donutMode) renderStatsDonut(st, donutMode);
  if (statPeriod === 'year') renderStatsChart(st);
  /* 滑动切换后的滑入动画(点击切换不加动画) */
  el.classList.remove('from-r', 'from-l');
  if (statsSlideDir) { void el.offsetWidth; el.classList.add(statsSlideDir > 0 ? 'from-r' : 'from-l'); statsSlideDir = 0; }
}
/* 环形图: 本期买入(或卖出)金额按股票构成, 前6只 + 其他。
   图例用 HTML 放在画布下方(数量任意自动换行, 不与饼图争canvas空间) */
function renderStatsDonut(st, mode) {
  const elm = $('#st-donut'); if (!elm) return;
  const lg = $('#st-dlegend');
  if (!window.echarts) { elm.innerHTML = '<div class="kerr" style="padding:24px 8px">图表组件加载失败（需联网）</div>'; if (lg) lg.innerHTML = ''; return; }
  const F = fxInfo();
  const items = st.stocks.map(sk => ({
    name: sk.name,
    v: ['CNY', 'USD', 'HKD'].reduce((a, c) => a + Core.toBase((mode === 'buy' ? sk.buy : sk.sell)[c] || 0, c, S.base, F), 0)
  })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (!items.length) {
    elm.innerHTML = '<div class="kerr" style="padding:24px 8px">本期无' + (mode === 'buy' ? '买入' : '卖出') + '</div>';
    if (lg) lg.innerHTML = '';
    return;
  }
  const pal = CAT[isDark() ? 'dark' : 'light'];
  const data = items.slice(0, 6).map((x, i) => ({ name: x.name, value: Math.round(x.v * 100) / 100, itemStyle: { color: pal[i] } }));
  const rest = items.slice(6);
  if (rest.length) data.push({ name: '其他', value: Math.round(rest.reduce((a, x) => a + x.v, 0) * 100) / 100, itemStyle: { color: '#898781' } });
  const total = items.reduce((a, x) => a + x.v, 0);
  const label = mode === 'buy' ? '买入' : '卖出';
  if (lg) {
    lg.innerHTML = data.map(d => {
      const pct = total > 0 ? (d.value / total * 100).toFixed(0) + '%' : '0%';
      return `<span class="dl"><i style="background:${d.itemStyle.color}"></i>${esc(d.name)} <em>${pct}</em></span>`;
    }).join('');
  }
  stDonut = echarts.init(elm);
  stDonut.setOption({
    animation: false,
    tooltip: {
      trigger: 'item', backgroundColor: cssVar('--card'), borderColor: cssVar('--line'), textStyle: { color: cssVar('--fg'), fontSize: 12 },
      formatter: p => esc(p.name) + '<br/>' + fmtAmt(p.value, S.base) + ' · ' + p.percent.toFixed(1) + '%'
    },
    series: [{
      type: 'pie', radius: ['50%', '72%'], center: ['50%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: cssVar('--card'), borderWidth: 2, borderRadius: 4 },
      label: { show: false }, emphasis: { scale: false },
      data
    }],
    graphic: [
      { type: 'text', left: 'center', top: '40%', style: { text: fmtAmtC(total, S.base), textAlign: 'center', fill: cssVar('--fg'), fontSize: 15, fontWeight: 700 } },
      { type: 'text', left: 'center', top: '53%', style: { text: label, textAlign: 'center', fill: cssVar('--muted'), fontSize: 11 } }
    ]
  });
}
function renderStatsChart(st) {
  const elm = $('#st-chart'); if (!elm) return;
  if (stChart) { stChart.dispose(); stChart = null; }
  if (!window.echarts) { elm.innerHTML = '<div class="kerr" style="padding:24px 8px">图表组件加载失败（需联网）</div>'; return; }
  const y = new Date().getFullYear(); const F = fxInfo();
  const labels = [], buy = [], sell = [];
  for (let m = 1; m <= 12; m++) {
    const key = y + '-' + Core.pad(m);
    const mo = st.monthly.find(x => x.m === key);
    labels.push(m + '月');
    const g = o => mo ? ['CNY', 'USD', 'HKD'].reduce((a, c) => a + Core.toBase(o[c] || 0, c, S.base, F), 0) : 0;
    buy.push(Math.round(g(mo ? mo.buy : null)));
    sell.push(Math.round(g(mo ? mo.sell : null)));
  }
  if (!st.monthly.length) { elm.innerHTML = '<div class="kerr" style="padding:24px 8px">本年暂无交易</div>'; return; }
  stChart = echarts.init(elm);
  stChart.setOption({
    animation: false,
    grid: { left: 8, right: 8, top: 30, bottom: 2, containLabel: true },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 10, itemGap: 14, textStyle: { color: cssVar('--muted'), fontSize: 11 } },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: cssVar('--card'), borderColor: cssVar('--line'), textStyle: { color: cssVar('--fg'), fontSize: 12 },
      formatter: ps => {
        let h = '<b>' + (ps[0].dataIndex + 1) + '月</b>';
        ps.forEach(p => { h += '<div>' + p.marker + esc(p.seriesName) + ' ' + fmtAmt(p.value, S.base) + '</div>'; });
        return h;
      }
    },
    xAxis: { type: 'category', data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: cssVar('--line') } }, axisLabel: { color: cssVar('--muted'), fontSize: 10 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: cssVar('--line') } }, axisLabel: { color: cssVar('--muted'), fontSize: 9, formatter: compactNum } },
    series: [
      { name: '买入', type: 'bar', data: buy, itemStyle: { color: cssVar('--up'), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 16, barGap: '30%' },
      { name: '卖出', type: 'bar', data: sell, itemStyle: { color: cssVar('--down'), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 16 }
    ]
  });
}

/* 统计页左右滑动切换周期:
   - 水平位移≥56px 且明显大于垂直分量才判定(不误伤上下滚动)
   - 起手在可横向滚动的表格(.twrap)上不接管
   - 起手在左缘24px内不接管(留给 iOS 系统返回手势)
   - 多指(捏合)不接管; 点击仍然走原逻辑 */
function initStatsSwipe() {
  const el = $('#v-stats');
  if (!el) return;
  let sx = 0, sy = 0, st = 0, multi = false, onScroll = false;
  el.addEventListener('touchstart', e => {
    multi = e.touches.length > 1;
    onScroll = !!(e.target.closest && e.target.closest('.twrap'));
    const t = e.changedTouches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now();
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (multi || onScroll || sx < 24) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st > 800) return;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const order = ['week', 'month', 'year', 'all'];
    const i = order.indexOf(statPeriod);
    if (i < 0) return;
    const ni = dx < 0 ? Math.min(i + 1, order.length - 1) : Math.max(i - 1, 0);
    if (ni === i) return;
    statPeriod = order[ni];
    statsSlideDir = dx < 0 ? 1 : -1;
    renderStats();
  }, { passive: true });
}

/* ===== 设置页 ===== */
function renderSet() {
  const el = $('#v-set'); const F = fxInfo();
  const needBackup = S.trades.length >= 20 && (!S.lastBackup || Date.now() - S.lastBackup > 7 * 864e5);
  const backupTxt = S.lastBackup ? new Date(S.lastBackup).toLocaleString('zh-CN') : '从未备份';
  el.innerHTML = `
   <div class="pagehead"><div style="flex:1"><div class="ttl">设置</div><div class="sub">偏好 · 汇率 · 数据备份</div></div></div>
   <div class="sec-t">偏好</div>
   <div class="card">
     <div class="setrow"><div><div class="sl">基础货币</div><div class="sd">汇总与统计的折算目标</div></div>
       <div class="seg set" id="set-base"><button data-v="CNY" class="${S.base === 'CNY' ? 'on' : ''}">人民币</button><button data-v="USD" class="${S.base === 'USD' ? 'on' : ''}">美元</button></div></div>
     <div class="setrow"><div><div class="sl">涨跌配色</div><div class="sd">红涨绿跌为A股惯例</div></div>
       <div class="seg set" id="set-ud"><button data-v="1" class="${S.upRed ? 'on' : ''}">红涨绿跌</button><button data-v="0" class="${S.upRed ? '' : 'on'}">绿涨红跌</button></div></div>
     <div class="setrow"><div><div class="sl">外观</div><div class="sd">跟随系统或固定主题</div></div>
       <div class="seg set" id="set-theme"><button data-v="auto" class="${S.theme === 'auto' ? 'on' : ''}">系统</button><button data-v="light" class="${S.theme === 'light' ? 'on' : ''}">浅色</button><button data-v="dark" class="${S.theme === 'dark' ? 'on' : ''}">深色</button></div></div>
   </div>
   <div class="sec-t">行情与汇率</div>
   <div class="card">
     <div class="setrow"><div class="sl">美元 / 人民币</div><div class="num" style="font-weight:600">${F.USDCNY.toFixed(4)}</div></div>
     <div class="setrow"><div class="sl">港元 / 人民币</div><div class="num" style="font-weight:600">${F.HKDCNY.toFixed(4)}</div></div>
     <div class="setrow"><div><div class="sl">更新时间</div><div class="sd">${fx && fx.ts ? new Date(fx.ts).toLocaleString('zh-CN') : '未获取'}${F.approx ? ' · 备用汇率' : ''}</div></div>
       <button class="btn" id="btn-fxrefresh">刷新</button></div>
   </div>
   <div class="sec-t">数据</div>
   <div class="card">
     <div class="setrow"><div><div class="sl">导出备份</div><div class="sd">生成 JSON 文件，妥善保存</div></div><button class="btn" id="btn-export">导出</button></div>
     <div class="setrow"><div><div class="sl">导入备份</div><div class="sd">从备份 JSON 恢复（覆盖当前）</div></div><button class="btn" id="btn-import">导入</button></div>
     <input type="file" id="imp-file" accept=".json,application/json" hidden>
     <div class="setrow"><div><div class="sl">上次备份</div><div class="sd"${needBackup ? ' style="color:var(--warn)"' : ''}>${backupTxt}${needBackup ? ' · 记录较多，建议尽快备份' : ''}</div></div></div>
     <div class="setrow"><div><div class="sl">清空数据</div><div class="sd">删除全部交易记录（不可恢复）</div></div><button class="btn" id="btn-clear">清空数据</button></div>
   </div>
   <div class="sec-t">使用说明</div>
   <div class="card help">
     <p><b>添加到主屏幕：</b>iPhone 用 Safari 打开本页面，点分享按钮 →「添加到主屏幕」，即可像 App 一样全屏使用。</p>
     <p><b>数据安全：</b>所有数据仅保存在本设备的浏览器中，不上传任何服务器。清除浏览器数据或换设备前，请先导出备份。</p>
     <p><b>行情说明：</b>行情与K线来自腾讯财经公开接口；美股在美东交易时段内为实时行情（休市时显示上一交易日收盘）；K线为前复权数据。</p>
     <p><b>成本口径：</b>持仓成本为移动加权平均（含手续费）；分红冲减成本（摊薄，同券商口径），分红收益单独累计；卖出即时结转已实现盈亏。</p>
     <p><b>分红检测：</b>打开应用时自动比对持仓期间的前复权因子跳变，发现疑似分红会提示一键入账（估算金额可修正，美股暂不支持自动检测）。</p>
   </div>
   <p class="footnote" style="text-align:center">OPEN BOOK v1.11.1 · 本地优先 · 共 ${S.trades.length} 笔记录</p>`;
  bindSeg('#set-base', v => { if (v === S.base) return; S.base = v; save(); rerender(); showToast('基准货币已切换为' + CN[v]); });
  bindSeg('#set-ud', v => { S.upRed = v === '1'; save(); applyUpDown(); rerender(); });
  bindSeg('#set-theme', v => { S.theme = v; save(); applyTheme(); rerender(); });
  $('#btn-fxrefresh').onclick = () => { fx = null; refreshQuotes(); };
  $('#btn-export').onclick = doExport;
  $('#btn-import').onclick = () => $('#imp-file').click();
  $('#imp-file').onchange = e => { const f = e.target.files[0]; if (f) handleImport(f); e.target.value = ''; };
  bindClear();
}
function bindClear() {
  const b = $('#btn-clear'); if (!b) return;
  let arm = 0;
  b.onclick = () => {
    if (!S.trades.length) { showToast('没有数据可清空'); return; }
    if (Date.now() - arm < 4000) {
      S.trades = []; S.seeded = true; save(); rerender();
      if (!$('#sheet').hidden) closeSheet();
      showToast('已清空全部交易');
    } else {
      arm = Date.now(); b.textContent = '再点一次确认清空'; b.style.color = 'var(--up)';
      setTimeout(() => { if (b.isConnected) { b.textContent = '清空数据'; b.style.color = ''; } }, 4000);
    }
  };
}
function doExport() {
  const json = JSON.stringify(S, null, 2);
  S.lastBackup = Date.now(); save();
  openModal('备份已生成',
    `<p class="footnote" style="padding:0">共 ${S.trades.length} 笔交易。数据为明文 JSON，请妥善保管。</p>
     <textarea readonly id="exp-ta">${esc(json)}</textarea>`,
    [
      { t: '复制', fn: () => { navigator.clipboard.writeText(json).then(() => showToast('已复制到剪贴板'), () => { const ta = $('#exp-ta'); ta.focus(); ta.select(); showToast('请手动全选复制'); }); return true; } },
      { t: '下载 .json', fn: () => { downloadBackup(json); return true; } },
      { t: '关闭' }
    ]);
  renderSet();
}
function downloadBackup(json) {
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'openbook-backup-' + Core.dstr(new Date()).replace(/-/g, '') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { showToast('下载失败，请使用复制'); }
}
function handleImport(file) {
  const rd = new FileReader();
  rd.onload = () => {
    let obj = null;
    try { obj = JSON.parse(rd.result); } catch (e) {}
    if (!obj || obj.v !== 1 || !Array.isArray(obj.trades)) { showToast('文件格式不正确'); return; }
    openModal('导入备份',
      `<p class="footnote" style="padding:0">将导入 <b>${obj.trades.length}</b> 笔交易，覆盖当前 <b>${S.trades.length}</b> 笔。此操作不可撤销，建议先导出当前数据。</p>`,
      [
        { t: '取消' },
        {
          t: '确认导入', primary: true, fn: () => {
            S = Object.assign({}, DEFAULT_STATE, obj); S.seeded = true; save();
            if (!$('#sheet').hidden) closeSheet();
            rerender(); showToast('已导入 ' + S.trades.length + ' 笔交易');
          }
        }
      ]);
  };
  rd.readAsText(file);
}
function openModal(title, bodyHtml, acts) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHtml;
  const ac = $('#modal-acts'); ac.innerHTML = '';
  (acts || []).forEach(a => {
    const b = document.createElement('button');
    b.className = a.primary ? 'btn btn-primary' : 'btn';
    b.textContent = a.t;
    b.onclick = () => { const keep = a.fn && a.fn(); if (!keep) closeModal(); };
    ac.appendChild(b);
  });
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

/* ===== 个股详情页 ===== */
let sheetTc = null, kChart = null, kPeriod = 'day', kCache = {};
function openSheet(tc, fromPop) {
  if (sheetTc === tc && !$('#sheet').hidden) return;
  if (!fromPop) { try { history.pushState({ sheet: tc }, ''); } catch (e) {} }   // 详情页压栈 → 右滑关闭
  sheetTc = tc; kPeriod = 'day'; kCache = {};
  const p = Core.calcPositions(S.trades).find(x => x.tc === tc);
  const name = p ? p.name : (quotes[tc] && quotes[tc].name) || tc;
  const mkt = p ? p.mkt : (/^(sh|sz|hk|us)/.exec(tc) || ['', ''])[1];
  const cur = p ? p.cur : Core.CUR_OF[mkt];
  const sh = $('#sheet');
  sh.hidden = false; document.body.style.overflow = 'hidden';
  sh.innerHTML = `
   <div class="sh-head">
     <button class="iconbtn" id="sh-close" aria-label="关闭">✕</button>
     <div style="min-width:0;flex:1"><div class="sh-name"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><span class="tag">${MKT_TAG[mkt] || ''}</span></div>
     <div class="sh-code">${esc(tc)} · ${cur}</div></div>
     <div class="sh-px"><div class="p num" id="sh-px">--</div><div class="c num" id="sh-chg">--</div></div>
   </div>
   <div class="sh-body">
     <div class="card"><div class="qgrid" id="sh-qgrid"></div></div>
     <div class="card">
       <div class="chart-head"><h2 style="font-size:15px;margin:0">K线 · 前复权</h2>
         <div class="seg mini" id="sh-period"><button data-p="day" class="on">日K</button><button data-p="week">周K</button><button data-p="month">月K</button></div></div>
       <div class="ma-legend" id="ma-legend"></div>
       <div id="kchart"><div class="kerr">加载中…</div></div>
     </div>
     <div class="card" id="sh-poscard"></div>
     <div class="card"><div class="pos-h" style="padding:0 0 8px"><h2>交易记录</h2><span id="sh-tcount"></span></div><div id="sh-trades"></div>
       <button class="btn" style="width:100%;margin-top:10px" id="sh-add">为这只股票记一笔</button></div>
   </div>`;
  $('#sh-close').onclick = () => closeSheet();   // 注意不能直接赋值closeSheet: 事件对象会被误当作fromPop参数
  $('#sh-add').onclick = () => {
    const st = p;
    try { history.replaceState({ v: 'add' }, ''); } catch (e) {}   // 原地改写栈顶, 避免与返回竞态
    closeSheet(true);
    showView('add', true);
    if (st) setPicked({ tc: st.tc, code: st.code, mkt: st.mkt, name: st.name, cur: st.cur, ty: st.ty || '' });
  };
  $('#sh-period').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    kPeriod = b.dataset.p;
    $$('#sh-period button').forEach(x => x.classList.toggle('on', x === b));
    loadKline();
  });
  renderSheetQuote(); renderSheetPos(); renderSheetTrades();
  loadKline();
}
function closeSheet(fromPop) {
  const popIt = !fromPop && history.state && history.state.sheet;   // 消费掉详情页的栈条目
  $('#sheet').hidden = true; document.body.style.overflow = '';
  if (kChart) { kChart.dispose(); kChart = null; }
  sheetTc = null; kCache = {};
  if (popIt) history.back();
}
function renderSheetQuote() {
  if (!sheetTc) return;
  const g = $('#sh-qgrid'); if (!g) return;
  const q = quotes[sheetTc];
  const cell = (l, v, c) => `<div><div class="l">${l}</div><div class="v num ${c || ''}">${v}</div></div>`;
  if (!q || !isFinite(q.px)) {
    g.innerHTML = cell('现价', '--') + cell('涨跌', '--') + cell('涨跌幅', '--') + cell('昨收', '--') + cell('今开', '--') + cell('最高', '--') + cell('最低', '--');
    $('#sh-px').textContent = '--'; $('#sh-chg').textContent = '行情不可用';
    $('#sh-px').className = 'p num'; $('#sh-chg').className = 'c num';
    return;
  }
  const cls = q.chg >= 0 ? 'up' : 'down';
  g.innerHTML = cell('现价', fmtPx(q.px)) + cell('涨跌', (q.chg > 0 ? '+' : '') + q.chg.toFixed(2), cls) + cell('涨跌幅', fmtPct(q.pct), cls)
    + cell('昨收', fmtPx(q.prev)) + cell('今开', q.open ? fmtPx(q.open) : '--') + cell('最高', q.hi ? fmtPx(q.hi) : '--') + cell('最低', q.lo ? fmtPx(q.lo) : '--');
  $('#sh-px').textContent = fmtPx(q.px);
  $('#sh-px').className = 'p num ' + cls;
  $('#sh-chg').textContent = (q.chg > 0 ? '+' : '') + q.chg.toFixed(2) + '  ' + fmtPct(q.pct);
  $('#sh-chg').className = 'c num ' + cls;
}
function renderSheetPos() {
  if (!sheetTc) return;
  const elc = $('#sh-poscard'); if (!elc) return;
  const p = Core.calcPositions(S.trades).find(x => x.tc === sheetTc);
  if (!p) { elc.innerHTML = '<p class="footnote" style="padding:0">暂无交易记录</p>'; return; }
  const q = quotes[p.tc]; const has = q && isFinite(q.px);
  const mv = has ? p.shares * q.px : null;
  const pnl = (mv != null && p.shares > 0) ? mv - p.cost : null;
  const F = fxInfo();
  const bNote = v => (p.cur !== S.base ? ' ≈ ' + fmtAmt(Core.toBase(v, p.cur, S.base, F), S.base) : '');
  const cell = (l, v, c) => `<div><div class="l">${l}</div><div class="v num ${c || ''}">${v}</div></div>`;
  elc.innerHTML = `
   <div class="qgrid">
     ${cell('持仓', p.shares > 0 ? fmtQty(p.shares) + '股' : '已清仓')}
     ${cell('平均成本', p.shares > 0 ? fmtAmt(p.avg, p.cur) : '--')}
     ${cell('现价', has ? fmtPx(q.px) : '--')}
     ${cell('浮动盈亏', pnl != null ? fmtAmt(pnl, p.cur, true) + bNote(pnl) : '--', pnl != null && pnl < 0 ? 'down' : 'up')}
   </div>
   <div class="fx-line num" style="margin-top:10px">本股已实现盈亏 <b class="${p.realized >= 0 ? 'up' : 'down'}">${fmtAmt(p.realized, p.cur, true)}</b>${bNote(p.realized)}${p.dividend > 0 ? ` · 分红收益 <b>${fmtAmt(p.dividend, p.cur)}</b>（已冲减成本）` : ''} · 共 ${p.trades.length} 笔</div>`;
}
function renderSheetTrades() {
  if (!sheetTc) return;
  const box = $('#sh-trades'); if (!box) return;
  const p = Core.calcPositions(S.trades).find(x => x.tc === sheetTc);
  const ts = (p ? p.trades : []).slice().reverse();
  const tc2 = $('#sh-tcount'); if (tc2) tc2.textContent = ts.length + ' 笔';
  if (!ts.length) { box.innerHTML = '<p class="footnote" style="padding:4px 0">暂无记录</p>'; return; }
  const F = fxInfo();
  box.innerHTML = ts.map(t => {
    const isD = t.side === 'D';
    const amt = isD ? (t.amt != null ? +t.amt : t.px * t.qty) : t.px * t.qty;
    const base = t.cur !== S.base ? '<span class="b2">≈ ' + fmtAmt(Core.toBase(amt, t.cur, S.base, F), S.base) + '</span>' : '';
    return `<div class="trade-row"><span class="bs ${t.side}">${isD ? '息' : t.side}</span>
      <div class="tr-mid"><div class="tr-px num">${isD ? fmtAmt(amt, t.cur) : fmtPx(t.px) + ' × ' + fmtQty(t.qty)}</div>
      <div class="tr-sub">${fmtDate(t.date)}${isD && t.px > 0 ? ' · 每份 ' + fmtPx(t.px) + ' × ' + fmtQty(t.qty) : ''}${!isD && t.fee ? ' · 费 ' + fmtAmt(t.fee, t.cur) : ''}${t.broker ? ' · ' + esc(t.broker) : ''}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
      <div class="tr-amt num">${isD ? '冲减成本' : fmtAmt(amt, t.cur)}${isD ? '' : base}</div>
      <button class="del" data-id="${esc(t.id)}" aria-label="删除">删除</button></div>`;
  }).join('');
  box.querySelectorAll('.del').forEach(b => b.onclick = () => {
    const id = b.dataset.id;
    if (b.classList.contains('arm')) {
      S.trades = S.trades.filter(t => t.id !== id); save();
      renderSheetPos(); renderSheetTrades();
      if (curView === 'pos') renderPos();
      if (curView === 'stats') renderStats();
      showToast('已删除该笔交易');
    } else {
      b.classList.add('arm'); b.textContent = '确认删';
      setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = '删除'; } }, 3000);
    }
  });
}
async function loadKline() {
  if (!sheetTc) return;
  const err = document.createElement('div');
  if (!window.echarts) {
    $('#kchart').innerHTML = '<div class="kerr">图表组件（ECharts）加载失败 — 需联网加载，其余功能不受影响。</div>';
    return;
  }
  $('#kchart').innerHTML = '<div class="kerr">加载中…</div>';
  const key = sheetTc + '|' + kPeriod;
  try {
    let r = kCache[key];
    if (!r) {
      r = await fetchKline(sheetTc, kPeriod, kPeriod === 'day' ? 250 : kPeriod === 'week' ? 160 : 120);
      if (!r || !r.k.length) throw new Error('empty');
      kCache[key] = r;
      if (r.qt) {   // K线响应自带最新报价, 顺带更新
        const q = r.qt, px = +q[3];
        if (px > 0) {
          quotes[sheetTc] = Object.assign({ ts: Date.now() },
            { px, prev: +q[4] || px, open: +q[5] || 0, hi: +q[33] || 0, lo: +q[34] || 0, chg: +q[31] || 0, pct: +q[32] || 0, name: q[1] || '' });
          saveQuotes(); renderSheetQuote(); renderSheetPos();
        }
      }
    }
    renderKline(r);
  } catch (e) {
    $('#kchart').innerHTML = '<div class="kerr">无法获取K线 — 可能离线或处于受限环境（行情接口需正常网络）。<br><button class="btn" id="k-retry">重试</button></div>';
    const rb = $('#k-retry'); if (rb) rb.onclick = loadKline;
  }
}
function renderKline(r) {
  const el = $('#kchart'); if (!el) return;
  el.innerHTML = '';
  if (kChart) { kChart.dispose(); kChart = null; }
  kChart = echarts.init(el);
  const k = r.k, dates = k.map(x => x.d);
  const up = cssVar('--up'), dn = cssVar('--down'), card = cssVar('--card');
  const muted = cssVar('--muted'), line = cssVar('--line'), faint = cssVar('--faint');
  const cs = k.map(x => [x.o, x.c, x.l, x.h]);
  const vol = k.map(x => ({ value: x.v, itemStyle: { color: x.c >= x.o ? up : dn, opacity: .55 } }));
  const ma = n => k.map((_, i) => {
    if (i < n - 1) return null;
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += k[j].c;
    return +(s / n).toFixed(2);
  });
  /* 用户交易 → K线标记(B/S), 同日同向合并。
     非交易日(周末/节假日)的成交自动对齐到之前最近的一根K线(10天内) */
  const p = Core.calcPositions(S.trades).find(x => x.tc === sheetTc);
  const posTrades = p ? p.trades : [];
  const dset = new Set(dates);
  const snapDate = ds => {
    if (dset.has(ds)) return ds;
    let prev = null;
    for (const d of dates) { if (d >= ds) break; prev = d; }
    if (!prev) return null;
    if ((new Date(ds) - new Date(prev)) / 864e5 > 10) return null;
    return prev;
  };
  const byd = new Map();
  const tradesByDate = {};
  for (const t of posTrades) {
    if (t.side === 'D') continue;   // 分红不进K线标记(其px=每份派息, 远低于股价, 会压扁Y轴)
    const kd = snapDate(t.date);
    if (!kd) continue;
    const kk = kd + '|' + t.side;
    const g = byd.get(kk) || { date: kd, side: t.side, px: 0, qty: 0, n: 0 };
    g.px += t.px * t.qty; g.qty += t.qty; g.n++;
    byd.set(kk, g);
    (tradesByDate[kd] = tradesByDate[kd] || []).push(t);
  }
  /* 同花顺风格小标记: 5px 价格锚点 + 10px B/S 字母(带底色描边保证可读), 标签自动避让重叠 */
  const bsData = [...byd.values()].map(g => {
    const isB = g.side === 'B';
    const txt = (isB ? 'B' : 'S') + (g.n > 1 ? g.n : '');
    return {
      value: [g.date, +(g.px / g.qty).toFixed(2)],
      symbolSize: 5,
      itemStyle: { color: isB ? up : dn, borderColor: card, borderWidth: 1 },
      label: {
        show: true, position: isB ? 'bottom' : 'top', distance: 2,
        formatter: () => txt, color: isB ? up : dn, fontSize: 10, fontWeight: 700,
        textBorderColor: card, textBorderWidth: 2
      }
    };
  });
  const startPct = Math.max(0, 100 * (1 - Math.min(90, dates.length) / Math.max(dates.length, 1)));
  /* 跨年时间轴(同花顺式): 年份首根显示年份, 日/周K其余显示MM-DD、月K显示月份。
     一律按"日期值"定位(缩放过滤后轴索引语义不可靠); 年份标签自身也按间距抽稀(月K多年份时隔年显示), 且两侧常规标签让位 —— 任何缩放状态都不叠字 */
  const yearFirst = new Set();
  let lastY = '';
  for (const d of dates) { const y = d.slice(0, 4); if (y !== lastY) { yearFirst.add(d); lastY = y; } }
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const vis0 = Math.min(90, dates.length);
  let xStep = Math.max(1, Math.round(vis0 / 6));
  let keepYears = new Set(yearFirst);   // 保留年份标签的日期
  let suppress = new Set();             // 全量索引: 不显示常规标签的位置(年份±让位区)
  const relabel = (s, e, plotW) => {
    const candleW = plotW / Math.max(e - s + 1, 1);
    const minGap = Math.max(1, Math.ceil(56 / candleW));   // ≈ 年份与常规标签宽度之和
    const cand = [];
    for (let i = s; i <= e; i++) if (yearFirst.has(dates[i])) cand.push(i);
    const keep = [];
    for (const yi of cand) { if (!keep.length || yi - keep[keep.length - 1] >= minGap) keep.push(yi); }
    keepYears = new Set(keep.map(i => dates[i]));
    const set = new Set();
    for (const yi of keep) for (let j = Math.max(0, yi - minGap); j <= Math.min(dates.length - 1, yi + minGap); j++) set.add(j);
    return set;
  };
  suppress = relabel(dates.length - vis0, dates.length - 1, 380);
  const xInterval = (idx, val) => {
    const fi = dateIdx.get(val);
    if (fi == null) return false;
    return keepYears.has(val) || (fi % xStep === 0 && !suppress.has(fi));
  };
  const fmtLabel = val => keepYears.has(val) ? val.slice(0, 4) : (kPeriod === 'month' ? val.slice(5, 7) : (val.length > 7 ? val.slice(5) : val));
  kChart.setOption({
    animation: false,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: faint }, crossStyle: { color: faint } },
      backgroundColor: card, borderColor: line, textStyle: { color: cssVar('--fg'), fontSize: 12 }, padding: [8, 10],
      formatter: params => {
        const p2 = params.find(x => x.seriesType === 'candlestick') || params[0];
        if (!p2) return '';
        const i = p2.dataIndex, rr = k[i];
        if (!rr) return '';
        const chg = i > 0 && k[i - 1].c ? (rr.c - k[i - 1].c) / k[i - 1].c * 100 : 0;
        let h = `<div style="font-weight:600">${rr.d}</div><div>开 ${fmtPx(rr.o)} 收 <b style="color:${rr.c >= rr.o ? up : dn}">${fmtPx(rr.c)}</b></div><div>高 ${fmtPx(rr.h)} 低 ${fmtPx(rr.l)}</div><div>量 ${fmtVol(rr.v)} · <span style="color:${chg >= 0 ? up : dn}">${fmtPct(chg)}</span></div>`;
        const ts = tradesByDate[rr.d];
        if (ts) for (const t of ts) {
          h += `<div style="margin-top:4px;padding-top:4px;border-top:1px dashed ${line}"><b style="color:${t.side === 'B' ? up : dn}">${t.side === 'B' ? '买入' : '卖出'}</b> ${fmtPx(t.px)}×${fmtQty(t.qty)}${t.broker ? ' · ' + esc(t.broker) : ''}</div>`;
        }
        return h;
      }
    },
    grid: [{ left: 6, right: 8, top: 30, height: '54%' }, { left: 6, right: 8, top: '74%', height: '14%' }],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: true, axisTick: { show: false }, axisLine: { lineStyle: { color: line } }, axisLabel: { color: muted, fontSize: 9, interval: xInterval, formatter: fmtLabel } },
      { type: 'category', gridIndex: 1, data: dates, axisTick: { show: false }, axisLabel: { show: false }, axisLine: { lineStyle: { color: line } } }
    ],
    yAxis: [
      { scale: true, splitNumber: 4, splitLine: { lineStyle: { color: line } }, axisLabel: { color: muted, fontSize: 9 } },
      { gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, splitLine: { show: false } }
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: startPct, end: 100 }],
    series: [
      { name: 'K线', type: 'candlestick', data: cs, itemStyle: { color: up, color0: dn, borderColor: up, borderColor0: dn } },
      { name: '买卖点', type: 'scatter', data: bsData, symbol: 'circle', symbolSize: 5, z: 5, emphasis: { disabled: true }, labelLayout: { hideOverlap: true } },
      { name: 'MA5', type: 'line', data: ma(5), showSymbol: false, lineStyle: { width: 1.2, color: '#e0a832' }, itemStyle: { color: '#e0a832' }, emphasis: { disabled: true } },
      { name: 'MA10', type: 'line', data: ma(10), showSymbol: false, lineStyle: { width: 1.2, color: '#b678f0' }, itemStyle: { color: '#b678f0' }, emphasis: { disabled: true } },
      { name: 'MA20', type: 'line', data: ma(20), showSymbol: false, lineStyle: { width: 1.2, color: '#4aa3f0' }, itemStyle: { color: '#4aa3f0' }, emphasis: { disabled: true } },
      { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vol, barWidth: '58%' }
    ]
  });
  kChart.on('datazoom', () => {
    updateMaLegend(k);
    try {
      const dz = kChart.getOption().dataZoom[0];
      const zs = dz.startValue != null ? dz.startValue : 0;
      const ze = dz.endValue != null ? dz.endValue : dates.length - 1;
      xStep = Math.max(1, Math.round((ze - zs + 1) / 6));
      suppress = relabel(zs, ze, Math.max(120, kChart.getWidth() - 16));
      kChart.setOption({ xAxis: [{ axisLabel: { interval: xInterval } }] });   // 触发轴标签按新参数重排
    } catch (err) {}
  });
  updateMaLegend(k);
}
function updateMaLegend(k) {
  const el = $('#ma-legend'); if (!el || !kChart || !k || !k.length) return;
  let end = k.length - 1;
  try { const dz = kChart.getOption().dataZoom[0]; if (dz && dz.endValue != null) end = dz.endValue; } catch (e) {}
  end = Math.max(0, Math.min(end, k.length - 1));
  const one = n => {
    let s = 0, cnt = 0;
    for (let i = Math.max(0, end - n + 1); i <= end; i++) { s += k[i].c; cnt++; }
    return cnt ? (s / cnt).toFixed(2) : '--';
  };
  el.innerHTML = `<span style="color:#e0a832">MA5 <b>${one(5)}</b></span><span style="color:#b678f0">MA10 <b>${one(10)}</b></span><span style="color:#4aa3f0">MA20 <b>${one(20)}</b></span><span style="margin-left:auto;color:var(--faint)">${k[end].d}</span>`;
}

/* ===== 分红自动检测(方案B): 双K线因子法, 每股每天一次, 持仓页待确认卡片 ===== */
let divInbox = [];   // {tc,name,cur,date,perShare,shares,amt,kind}
const DIVCHK = 'cj.divchk';
function getDivChk() { try { return JSON.parse(localStorage.getItem(DIVCHK)) || {}; } catch (e) { return {}; } }
function setDivChk(o) { try { localStorage.setItem(DIVCHK, JSON.stringify(o)); } catch (e) {} }
async function checkDividends() {
  const today = Core.todayStr();
  const chk = getDivChk();
  const poss = Core.calcPositions(S.trades).filter(p => p.shares > 0 && !/^us/.test(p.tc));
  const todo = poss.filter(p => !chk[p.tc] || chk[p.tc].d !== today);
  if (!todo.length) { if (curView === 'pos') renderPos(); return; }
  for (const p of todo) {
    chk[p.tc] = Object.assign({ ig: [] }, chk[p.tc], { d: today });
    setDivChk(chk);
    let evs;
    try { evs = await detectDividends(p.tc, p.trades[0].date); } catch (e) { continue; }
    if (!evs) continue;
    const dDates = S.trades.filter(t => t.tc === p.tc && t.side === 'D').map(t => t.date);
    for (const ev of evs) {
      const key = p.tc + '|' + ev.date;
      const near = dDates.some(dd => Math.abs(new Date(dd) - new Date(ev.date)) / 864e5 <= 7);
      if (near || (chk[p.tc].ig || []).indexOf(key) >= 0) continue;
      const sh = Core.sharesAt(S.trades, p.tc, ev.date);
      if (sh <= 0 && ev.kind !== 'big') continue;
      divInbox = divInbox.filter(x => !(x.tc === p.tc && x.date === ev.date));
      divInbox.push({ tc: p.tc, mkt: p.mkt, code: p.code, name: p.name, cur: p.cur, date: ev.date, perShare: ev.perShare, shares: sh, amt: +(ev.perShare * sh).toFixed(2), kind: ev.kind });
    }
  }
  if (curView === 'pos') renderPos();
}
function openDivModal() {
  if (!divInbox.length) return;
  const rows = divInbox.map((it, i) => {
    if (it.kind === 'big') {
      return `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
        <div style="font-weight:600">${esc(it.name)} <span class="tag">${MKT_TAG[it.mkt] || ''}</span> · ${fmtDate(it.date)}</div>
        <div class="footnote" style="padding:2px 0 0">复权因子大幅跳变（疑似送转/份额折算），请核对公告后手动记账。</div>
        <button class="btn" style="margin-top:6px;padding:6px 14px;font-size:12px" data-ig="${i}">忽略</button></div>`;
    }
    return `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
      <div style="font-weight:600">${esc(it.name)} <span class="tag">${MKT_TAG[it.mkt] || ''}</span> · ${fmtDate(it.date)}</div>
      <div class="footnote" style="padding:2px 0 0">估算每份 ${fmtPx(it.perShare)} × 当时持股 ${fmtQty(it.shares)} 份</div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
        <input class="inp num" id="div-amt-${i}" type="number" inputmode="decimal" step="any" value="${it.amt}" style="flex:1;padding:8px 10px;font-size:14px">
        <button class="btn" style="flex:none;padding:8px 14px;font-size:13px;background:var(--up);color:#fff;border:0" data-ok="${i}">入账</button>
        <button class="btn" style="flex:none;padding:8px 14px;font-size:13px" data-ig="${i}">忽略</button>
      </div></div>`;
  }).join('');
  openModal('确认分红入账（冲减成本）', rows, [{ t: '关闭' }]);
  divInbox.forEach((it, i) => { void i; });
  document.querySelectorAll('#modal-body [data-ok]').forEach(b => b.onclick = () => {
    const i = +b.dataset.ok, it = divInbox[i];
    if (!it) return;
    const amt = +($('#div-amt-' + i) ? $('#div-amt-' + i).value : it.amt) || it.amt;
    const t = { id: uid(), date: it.date, tc: it.tc, mkt: it.mkt, code: it.code, name: it.name, cur: it.cur,
      side: 'D', px: it.shares > 0 ? +(amt / it.shares).toFixed(6) : 0, qty: it.shares, fee: 0, amt: +amt.toFixed(2),
      broker: '', note: '自动检测', ts: Date.now() };
    if (S.trades.length && S.trades.every(x => x.demo)) S.trades = [];
    S.trades.push(t); save();
    divInbox.splice(i, 1);
    closeModal(); rerender();
    showToast('已入账分红 ' + it.name + ' ' + fmtAmt(+amt.toFixed(2), it.cur));
    if (!divInbox.length) checkDividends();
  });
  document.querySelectorAll('#modal-body [data-ig]').forEach(b => b.onclick = () => {
    const i = +b.dataset.ig, it = divInbox[i];
    if (!it) return;
    const chk = getDivChk();
    (chk[it.tc] = Object.assign({ ig: [] }, chk[it.tc])).ig.push(it.tc + '|' + it.date);
    setDivChk(chk);
    divInbox.splice(i, 1);
    closeModal(); rerender();
  });
}

/* ===== 示例数据 ===== */
function demoTrades() {
  const t = (date, tc, mkt, code, name, cur, s2, px, qty, fee, broker) =>
    ({ id: uid(), date, tc, mkt, code, name, cur, side: s2, px, qty, fee, broker, note: '', ts: Date.now() - Math.round(Math.random() * 1e7), demo: true });
  return [
    t('2026-07-15', 'sh600519', 'sh', '600519', '贵州茅台', 'CNY', 'B', 1485.00, 100, 5, '华泰证券'),
    t('2026-08-12', 'sh600519', 'sh', '600519', '贵州茅台', 'CNY', 'B', 1420.00, 100, 5, '华泰证券'),
    t('2026-09-10', 'sh600519', 'sh', '600519', '贵州茅台', 'CNY', 'S', 1395.00, 100, 5, '华泰证券'),
    t('2026-10-09', 'sh600519', 'sh', '600519', '贵州茅台', 'CNY', 'B', 1330.00, 100, 5, '华泰证券'),
    t('2026-07-22', 'usAAPL.OQ', 'us', 'AAPL.OQ', '苹果', 'USD', 'B', 218.50, 60, 1, '富途牛牛'),
    t('2026-09-10', 'usAAPL.OQ', 'us', 'AAPL.OQ', '苹果', 'USD', 'B', 214.20, 40, 1, '富途牛牛'),
    t('2026-08-20', 'hk00700', 'hk', '00700', '腾讯控股', 'HKD', 'B', 372.00, 200, 138, '长桥'),
    t('2026-10-13', 'hk00700', 'hk', '00700', '腾讯控股', 'HKD', 'S', 415.00, 100, 138, '长桥'),
    t('2026-09-25', 'sz000333', 'sz', '000333', '美的集团', 'CNY', 'B', 73.80, 300, 5, '华泰证券'),
    t('2026-10-16', 'sz000333', 'sz', '000333', '美的集团', 'CNY', 'B', 75.20, 200, 5, '华泰证券'),
    t('2026-10-20', 'sz000333', 'sz', '000333', '美的集团', 'CNY', 'S', 76.10, 100, 5, '华泰证券')
  ];
}

/* ===== 启动 ===== */
function boot() {
  applyTheme();
  if (location.hash === '#dark') document.documentElement.dataset.theme = 'dark';
  if (!S.seeded && !S.trades.length) { S.trades = demoTrades(); S.seeded = true; save(); }
  /* 数据迁移: v1.3~v1.8.1 期间经搜索保存的美股代码是小写(行情拉不到), 统一转大写 */
  let migrated = false;
  for (const t of S.trades) {
    if (/^us[a-z]/.test(t.tc)) { t.tc = 'us' + t.tc.slice(2).toUpperCase(); t.code = String(t.code || '').toUpperCase(); migrated = true; }
  }
  if (migrated) save();
  initAdd();
  initStatsSwipe();
  $$('#tabs button').forEach(b => b.onclick = () => showView(b.dataset.view));
  document.addEventListener('keydown', e => {   // 桌面: Esc 关闭弹层
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden) { closeModal(); return; }
    if (!$('#sheet').hidden) closeSheet();
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  window.addEventListener('resize', () => { if (kChart) kChart.resize(); if (stChart) stChart.resize(); });
  onData = () => { rerender(); checkDividends(); };
  onBusy = busy => { const el = document.getElementById('btn-refresh'); if (el) el.classList.toggle('spin', busy); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { fitShell(); if (Date.now() - net.at > 60e3) refreshQuotes(); } });
  /* iOS Safari 工具栏收放时 100dvh 偶发不触发重排, 壳高滞留导致底栏下方出现空隙(重进才恢复)。
     改由 JS 用 innerHeight 主动驱动壳高: 随工具栏实时变化、不受键盘影响、resize 事件可靠;
     CSS 的 100dvh 仅作 JS 生效前的首屏回退; 捏合缩放期间跳过 */
  function fitShell() {
    const vv = window.visualViewport;
    if (vv && Math.abs(vv.scale - 1) > 0.02) return;
    document.body.style.height = window.innerHeight + 'px';
  }
  window.addEventListener('resize', fitShell);
  window.addEventListener('orientationchange', () => setTimeout(fitShell, 300));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitShell);
  fitShell();
  /* 浏览器历史导航: 视图/详情页压栈, iOS 边缘右滑(或浏览器返回)经 popstate 驱动回退 */
  try { history.replaceState({ v: 'pos' }, ''); } catch (e) {}
  window.addEventListener('popstate', e => {
    const st = e.state || { v: 'pos' };
    if (st.sheet) {
      if (!$('#sheet').hidden && sheetTc === st.sheet) return;
      if (!$('#sheet').hidden) closeSheet(true);
      openSheet(st.sheet, true);
    } else {
      if (!$('#sheet').hidden) closeSheet(true);
      if (st.v && st.v !== curView) showView(st.v, true);
    }
  });
  showView('pos', true);
  const h = location.hash.slice(1);
  if (h && h !== 'dark' && S.trades.some(t => t.tc === h)) openSheet(h);   // 深链: #股票代码 直达详情
  /* 只读调试钩子: window.__cj.kChart / .stChart / .stDonut / .S */
  window.__cj = { get S() { return S; }, get kChart() { return kChart; }, get stChart() { return stChart; }, get stDonut() { return stDonut; } };
  refreshQuotes();
}
boot();
