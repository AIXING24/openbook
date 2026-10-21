/* ===== 本地存储 ===== */
const LS_STATE = 'cj.v1', LS_QUOTES = 'cj.quotes.v1', LS_FX = 'cj.fx.v1';
let storageDead = false;
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { storageDead = true; return false; } }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 't' + Date.now() + Math.random().toString(36).slice(2, 8));

const DEFAULT_STATE = { v: 1, base: 'CNY', upRed: true, theme: 'auto', brokers: [], trades: [], lastBackup: 0, seeded: false, lastBroker: '' };
let S = Object.assign({}, DEFAULT_STATE, lsGet(LS_STATE) || {});
function save() { lsSet(LS_STATE, S); }

let quotes = lsGet(LS_QUOTES) || {};   // { tc: {px,prev,chg,pct,name,ts,delayed} }
let fx = lsGet(LS_FX) || null;         // { USDCNY, HKDCNY, ts, approx }
function saveQuotes() { lsSet(LS_QUOTES, quotes); }
function saveFx() { lsSet(LS_FX, fx); }
let net = { ok: null, at: 0 };
let onData = null, onBusy = null;      // 数据层 → UI 回调

/* ===== 网络基础 ===== */
async function fjson(url, ms) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function ftext(url, ms, enc) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
  try {
    const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(r.status);
    return new TextDecoder(enc || 'utf-8').decode(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

/* ===== 腾讯行情解析 =====
   响应为 v_代码="字段~字段~..." 的 GBK 文本, 关键位: [1]名称 [3]现价 [4]昨收 [31]涨跌额 [32]涨跌幅 */
function parseQtText(txt) {
  const out = { quotes: null, fx: null };
  const re = /v_([A-Za-z0-9_.]+)="([^"]*)"/g; let m;
  while ((m = re.exec(txt))) {
    const code = m[1], f = m[2].split('~');
    if (code.startsWith('wh')) {
      if (f.length > 4 && +f[3] > 0) { out.fx = out.fx || {}; out.fx[code.slice(2)] = +f[3]; }
      continue;
    }
    if (f.length < 36) continue;
    const px = +f[3]; if (!(px > 0)) continue;
    (out.quotes = out.quotes || {})[code] = { px, prev: +f[4] || px, open: +f[5] || 0, hi: +f[33] || 0, lo: +f[34] || 0, chg: +f[31] || 0, pct: +f[32] || 0, name: f[1] || '' };
  }
  return out;
}

/* ===== K线 ===== */
async function fetchKline(tc, period, count) {
  const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + tc + ',' + period + ',,,' + count + ',qfq';
  const j = await fjson(url);
  const d = j && j.data && j.data[tc]; if (!d) return null;
  const rows = d['qfq' + period] || d[period]; if (!rows || !rows.length) return null;
  const k = rows.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] })).filter(r => isFinite(r.o) && isFinite(r.c));
  const qt = d.qt && d.qt[tc];
  return { k, qt };
}

/* ===== 美股( qt.gtimg 不支持, 走 ifzq 的 qt 段, 延时行情 ) ===== */
async function usQuote(tc) {
  try {
    const r = await fetchKline(tc, 'day', 1);
    if (r && r.qt) {
      const q = r.qt, px = +q[3];
      if (px > 0) return { px, prev: +q[4] || px, open: +q[5] || 0, hi: +q[33] || 0, lo: +q[34] || 0, chg: +q[31] || 0, pct: +q[32] || 0, name: q[1] || '', delayed: true };
    }
  } catch (e) {}
  return null;
}
/* 美股交易所后缀自动探测: 错误后缀只回 1 根K线; 可带已知后缀优先(NYSE=N, NASDAQ=OQ, Arca/AMEX=AM) */
async function resolveUS(sym, prefSuf) {
  const sufs = [...new Set([prefSuf, 'OQ', 'N', 'AM'].filter(Boolean))];
  for (const suf of sufs) {
    const tc = 'us' + sym + '.' + suf;
    try {
      const r = await fetchKline(tc, 'day', 5);
      if (r && r.k.length >= 2) return { tc, code: sym + '.' + suf, mkt: 'us', name: (r.qt && r.qt[1]) || sym };
    } catch (e) {}
  }
  return null;
}

/* ===== 搜索( smartbox JSONP, 无 CORS 头故走 script 标签 ) ===== */
let searchChain = Promise.resolve();
function smartSearch(q) {
  const run = () => rawSearch(q);
  const p = searchChain.then(run, run);
  searchChain = p.catch(() => {});
  return p;
}
function rawSearch(q) {
  return new Promise(res => {
    const s = document.createElement('script'); let done = false;
    const finish = v => {
      if (done) return; done = true; clearTimeout(tm); s.remove();
      try { delete window.v_hint; } catch (e) { window.v_hint = undefined; }
      res(v);
    };
    const tm = setTimeout(() => finish([]), 6000);
    s.onload = () => { let out = []; try { out = parseHint(window.v_hint); } catch (e) {} finish(out); };
    s.onerror = () => finish(null);
    s.src = 'https://smartbox.gtimg.cn/s3/?v=2&q=' + encodeURIComponent(q) + '&t=all';
    document.head.appendChild(s);
  });
}
/* smartbox 返回格式(实测): 首条5字段[市场~代码~名称~拼音~类型], 其余条目4字段[代码~名称~拼音~类型]。
   类型后缀市场信息不可靠, 市场主要由代码形状推断; 白名单保留 股票GP/场内基金ETF,LOF */
function parseHint(h) {
  if (!h || h.indexOf('none_match') >= 0) return [];
  const g = h.split('~');
  const out = [];
  const keep = ty => /^(GP|ETF|LOF)/.test(ty);
  const tyOf = ty => ty.indexOf('ETF') === 0 ? 'ETF' : ty.indexOf('LOF') === 0 ? 'LOF' : '';
  const mktOf = (code, ty) => {
    if (/^\d{6}$/.test(code)) {
      if (/^(60|68|51|56|58|50)/.test(code)) return 'sh';
      if (/^(00|30|15|16)/.test(code)) return 'sz';
      const m = /\^(\w+)$/.exec(ty);
      return (m && (m[1] === 'sh' || m[1] === 'sz')) ? m[1] : null;
    }
    if (/^\d{1,5}$/.test(code)) return 'hk';
    if (/^[A-Za-z]/.test(code)) return 'us';
    return null;
  };
  const push = (mkt, code, name, ty) => {
    if (!mkt || !keep(ty) || !code) return;
    out.push({ mkt, code, tc: mkt + code, name, ty: tyOf(ty) });
  };
  let i = 0;
  if (g.length >= 5 && ['sh', 'sz', 'hk', 'us'].indexOf(g[0]) >= 0) {
    push(g[0], g[1], g[2], g[4]);
    i = 5;
  }
  for (; i + 3 < g.length; i += 4) {
    push(mktOf(g[i], g[i + 3]), g[i], g[i + 1], g[i + 3]);
    if (out.length >= 10) break;
  }
  return out;
}

/* ===== 手输6位代码直判(股票+场内基金前缀; 未知前缀返回null由调用方走搜索) ===== */
function directTc(raw) {
  raw = String(raw || '').trim();
  if (!/^\d{6}$/.test(raw)) return null;
  if (/^(60|68)/.test(raw)) return { tc: 'sh' + raw, code: raw, mkt: 'sh' };
  if (/^(00|30)/.test(raw)) return { tc: 'sz' + raw, code: raw, mkt: 'sz' };
  if (/^(51|56|58|50)/.test(raw)) return { tc: 'sh' + raw, code: raw, mkt: 'sh' };   // 沪 ETF/LOF
  if (/^(15|16)/.test(raw)) return { tc: 'sz' + raw, code: raw, mkt: 'sz' };         // 深 ETF/LOF
  if (/^(43|83|87|92)/.test(raw)) return { err: '北交所代码暂不支持，当前仅支持沪深港美' };
  return null;
}

/* ===== 行情批量刷新 ===== */
let refreshing = false;
async function refreshQuotes() {
  if (refreshing) return;
  refreshing = true; if (onBusy) onBusy(true);
  const tcs = activeTcs();
  const ah = tcs.filter(t => /^(sh|sz|hk)/.test(t));
  const us = tcs.filter(t => /^us/.test(t));
  const fxStale = !fx || !fx.ts || (Date.now() - fx.ts > 10 * 60 * 1000);
  let any = false;
  if (ah.length || fxStale) {
    const list = ah.slice();
    if (fxStale) list.push('whUSDCNY', 'whHKDCNY');
    try {
      const txt = await ftext('https://qt.gtimg.cn/q=' + list.join(','), 9000, 'gbk');
      const p = parseQtText(txt);
      if (p.quotes) { const now = Date.now(); for (const k in p.quotes) quotes[k] = Object.assign({ ts: now }, p.quotes[k]); saveQuotes(); any = true; }
      if (p.fx && p.fx.USDCNY > 0 && p.fx.HKDCNY > 0) {
        fx = { USDCNY: p.fx.USDCNY, HKDCNY: p.fx.HKDCNY, ts: Date.now(), approx: false }; saveFx(); any = true;
      }
    } catch (e) {}
  }
  for (const tc of us) { const q = await usQuote(tc); if (q) { quotes[tc] = Object.assign({ ts: Date.now() }, q); any = true; } }
  if (us.length) saveQuotes();
  if (!fx) {   // 汇率兜底: er-api 免费无 key
    try {
      const j = await fjson('https://open.er-api.com/v6/latest/USD', 9000);
      if (j && j.rates && j.rates.CNY && j.rates.HKD) {
        fx = { USDCNY: j.rates.CNY, HKDCNY: j.rates.CNY / j.rates.HKD, ts: Date.now(), approx: true }; saveFx(); any = true;
      }
    } catch (e) {}
  }
  net = { ok: any, at: Date.now() };
  refreshing = false; if (onBusy) onBusy(false);
  if (onData) onData();
}
