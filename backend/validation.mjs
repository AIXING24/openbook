const currencies=['CNY','USD','HKD'];
const finite=Number.isFinite;
export const validDate = date => typeof date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && finite(Date.parse(date)) && new Date(date).toISOString().slice(0,10)===date;
export const dateAt = now => new Date(now+8*3600000).toISOString().slice(0,10);
export function normalizeTrade(t) {
  if(!t || !validDate(t.date) || !['sh','sz','hk','us'].includes(t.mkt) || typeof t.tc!=='string' || (t.tc.slice(0,2)!==t.mkt || !/^(sh|sz|hk|us)[A-Za-z0-9_.]+$/.test(t.tc)) || !['B','S','D'].includes(t.side))throw new Error('Invalid trade');
  const cur=t.cur||({sh:'CNY',sz:'CNY',hk:'HKD',us:'USD'})[t.mkt];
  if(typeof t.id!=='string' || !t.id || t.id.length>200 || !currencies.includes(cur) || !finite(t.px) || t.px<0 || !finite(t.qty) || t.qty<0 || !finite(t.fee||0) || (t.fee||0)<0 || (t.side!=='D' && (!t.px||!t.qty)) || (t.amt!=null && (!finite(t.amt)||t.amt<0)) || (t.ts!=null && (!finite(t.ts)||t.ts<0)))throw new Error('Invalid trade values');
  return {id:t.id,date:t.date,tc:t.tc,mkt:t.mkt,code:String(t.code||t.tc.slice(t.mkt.length)),name:String(t.name||t.code||''),cur,side:t.side,px:t.px,qty:t.qty,fee:t.fee||0,...(t.amt!=null?{amt:t.amt}:{}),broker:String(t.broker||''),note:String(t.note||''),ts:t.ts||0,...(t.demo?{demo:true}:{})};
}
export function validMetadata(m) {
  return m && m.v===1 && m.seeded===true && ['CNY','USD'].includes(m.base) && typeof m.upRed==='boolean' && ['auto','light','dark'].includes(m.theme) && Array.isArray(m.brokers) && m.brokers.length<=12 && m.brokers.every(x=>typeof x==='string') && typeof m.lastBroker==='string' && finite(m.lastBackup) && Number.isInteger(m.demoVersion) && Array.isArray(m.positionOrder) && m.positionOrder.length<=50 && new Set(m.positionOrder).size===m.positionOrder.length && m.positionOrder.every(x=>typeof x==='string');
}
export function validSnapshot(r, today=dateAt(Date.now())) {
  const timestamp=t=>finite(t) && t>=0 && t<=8640000000000000;
  if(!r || !validDate(r.date) || r.date>today || !timestamp(r.capturedAt) || dateAt(r.capturedAt)!==r.date || !Array.isArray(r.positions) || r.positions.length>50 || (r.invalidatedAt!=null && (!validDate(r.invalidatedAt)||r.invalidatedAt>r.date)))return false;
  const ids=new Set();
  for(const p of r.positions){
    if(!p || typeof p.tc!=='string' || !/^(sh|sz|hk|us)[A-Za-z0-9_.]+$/.test(p.tc) || ids.has(p.tc) || !currencies.includes(p.cur) || !finite(p.shares) || !p.shares || !finite(p.cost) || !finite(p.px) || p.px<=0 || !timestamp(p.quoteAt) || p.quoteAt>r.capturedAt+60000)return false;
    ids.add(p.tc);
  }
  for(const cur of currencies){
    if(!finite(r.amounts?.[cur]?.realized) || !finite(r.amounts[cur].unrealized) || (r.purchases!=null && (!finite(r.purchases[cur])||r.purchases[cur]<0)))return false;
    const value=r.positions.filter(p=>p.cur===cur).reduce((n,p)=>n+p.shares*p.px-p.cost,0);
    if(Math.abs(value-r.amounts[cur].unrealized)>Math.max(0.000001,Math.abs(value)*1e-10))return false;
  }
  return true;
}
export const mockTrade = t => t.broker==='Mock HSBC' && t.note==='模拟数据' && /^Mock stock \d+$/.test(t.name) && !t.demo;
