/* ===== CORE: 纯逻辑（无 DOM 依赖），便于单元测试 ===== */
const Core = (() => {
  const pad = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayStr = () => dstr(new Date());
  const weekStartStr = () => { const d = new Date(); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return dstr(d); };
  const monthStartStr = () => new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1) + '-01';
  const yearStartStr = () => new Date().getFullYear() + '-01-01';

  const FX_FALLBACK = { USDCNY: 7.20, HKDCNY: 0.92 };       // 汇率不可用时的备用近似值
  const CUR_OF = { sh: 'CNY', sz: 'CNY', hk: 'HKD', us: 'USD' };
  const EPS = 1e-9;

  function toCnyMap(fx) {
    return { CNY: 1, USD: (fx && fx.USDCNY) || FX_FALLBACK.USDCNY, HKD: (fx && fx.HKDCNY) || FX_FALLBACK.HKDCNY };
  }
  /* 任意币种金额按当前汇率折算到基准币种: 先折成人民币再除以目标币种汇率 */
  function toBase(amt, from, base, fx) {
    if (from === base) return amt;
    const m = toCnyMap(fx);
    return amt * m[from] / m[base];
  }

  /* 持仓计算: 移动加权平均成本法（手续费入成本）; 卖出产生已实现盈亏。
     多空对称账本: cost 与 shares 同号(空头时均为负, avg=cost/shares 恒为正的均价),
     因此"先卖后买"(做空或补录历史交易)与"先买后卖"结果一致。 */
  function calcPositions(trades) {
    const map = new Map();
    const sorted = [...trades].sort((a, b) => a.date === b.date ? (a.ts || 0) - (b.ts || 0) : (a.date < b.date ? -1 : 1));
    for (const t of sorted) {
      let p = map.get(t.tc);
      if (!p) {
        p = { tc: t.tc, mkt: t.mkt, code: t.code, name: t.name, cur: t.cur || CUR_OF[t.mkt] || 'CNY',
          shares: 0, cost: 0, avg: 0, realized: 0, trades: [] };
        map.set(t.tc, p);
      }
      p.trades.push(t);
      if (t.side === 'B') {
        const short = Math.min(t.qty, Math.max(-p.shares, 0));   // 先买回平空的部分
        const longQ = t.qty - short;
        if (short > 0) { p.realized += (p.avg - t.px) * short; p.cost += p.avg * short; p.shares += short; }
        p.cost += t.px * longQ + (t.fee || 0);
        p.shares += longQ;
      } else {
        const longQ = Math.min(t.qty, Math.max(p.shares, 0));    // 先卖出减多的部分
        const shortQ = t.qty - longQ;
        if (longQ > 0) { p.realized += (t.px - p.avg) * longQ; p.cost -= p.avg * longQ; p.shares -= longQ; }
        if (shortQ > 0) { p.cost -= t.px * shortQ; p.shares -= shortQ; }
        p.realized -= (t.fee || 0);
      }
      if (Math.abs(p.shares) < EPS) { p.shares = 0; p.cost = 0; p.avg = 0; }
      else { p.avg = p.cost / p.shares; }
    }
    return [...map.values()].sort((a, b) =>
      String(b.trades[b.trades.length - 1].date).localeCompare(String(a.trades[a.trades.length - 1].date)));   // 最近交易的排前面
  }

  /* 周期统计: 各币种原始金额分桶, 由 UI 层按当前汇率折算 */
  function calcStats(trades, startStr) {
    const inP = trades.filter(t => t.date >= startStr);
    const bucket = () => ({ CNY: 0, USD: 0, HKD: 0, n: 0 });
    const buy = bucket(), sell = bucket();
    const byStock = new Map(), byBroker = new Map(), monthly = new Map();
    const nowY = new Date().getFullYear();
    for (const t of inP) {
      const cur = t.cur || CUR_OF[t.mkt] || 'CNY';
      const amt = t.px * t.qty;
      const gross = t.side === 'B' ? amt + (t.fee || 0) : amt - (t.fee || 0);
      const dst = t.side === 'B' ? buy : sell;
      dst[cur] += gross; dst.n++;
      const sk = byStock.get(t.tc) || { tc: t.tc, name: t.name, mkt: t.mkt, buy: { CNY: 0, USD: 0, HKD: 0 }, sell: { CNY: 0, USD: 0, HKD: 0 } };
      (t.side === 'B' ? sk.buy : sk.sell)[cur] += gross;
      byStock.set(t.tc, sk);
      const bk = (t.broker || '').trim();
      if (bk) {
        const br = byBroker.get(bk) || { broker: bk, buy: { CNY: 0, USD: 0, HKD: 0 }, sell: { CNY: 0, USD: 0, HKD: 0 } };
        (t.side === 'B' ? br.buy : br.sell)[cur] += gross;
        byBroker.set(bk, br);
      }
      if (+t.date.slice(0, 4) === nowY) {
        const mk = t.date.slice(0, 7);
        const mo = monthly.get(mk) || { m: mk, buy: { CNY: 0, USD: 0, HKD: 0 }, sell: { CNY: 0, USD: 0, HKD: 0 } };
        (t.side === 'B' ? mo.buy : mo.sell)[cur] += gross;
        monthly.set(mk, mo);
      }
    }
    return { buy, sell, n: inP.length, stocks: [...byStock.values()],
      brokers: [...byBroker.values()], monthly: [...monthly.values()].sort((a, b) => a.m < b.m ? -1 : 1) };
  }

  return { pad, dstr, todayStr, weekStartStr, monthStartStr, yearStartStr,
    toBase, toCnyMap, calcPositions, calcStats, CUR_OF, FX_FALLBACK };
})();
