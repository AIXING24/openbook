// Streaming form of the existing moving-average ledger. No date/history lookups.
export const emptyPosition = cur => ({cur, shares:0, cost:0, avg:0, realized:0, dividend:0, purchases:0});
export function applyTrade(p, t) {
  if(t.side==='D') {
    const amount=t.amt ?? t.px*t.qty;
    p.dividend+=amount;
    if(p.shares>0){p.cost-=amount;p.avg=p.cost/p.shares;} else p.realized+=amount;
    return p;
  }
  if(t.side==='B') {
    p.purchases+=t.px*t.qty+t.fee;
    const short=Math.min(t.qty,Math.max(-p.shares,0)), long=t.qty-short;
    if(short>0){p.realized+=(p.avg-t.px)*short-t.fee*short/t.qty;p.cost+=p.avg*short;p.shares+=short;}
    p.cost+=t.px*long+t.fee*long/t.qty;p.shares+=long;
  } else {
    const long=Math.min(t.qty,Math.max(p.shares,0)),short=t.qty-long;
    if(long>0){p.realized+=(t.px-p.avg)*long;p.cost-=p.avg*long;p.shares-=long;}
    if(short>0){p.cost-=t.px*short;p.shares-=short;}
    p.realized-=t.fee;
  }
  if(Math.abs(p.shares)<1e-9){p.shares=0;p.cost=0;p.avg=0;} else p.avg=p.cost/p.shares;
  return p;
}
