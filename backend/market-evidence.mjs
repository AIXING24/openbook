import {validDate} from './validation.mjs';
const profiles={sh:{zone:'Asia/Shanghai',cur:'CNY',closes:['15:00']},sz:{zone:'Asia/Shanghai',cur:'CNY',closes:['15:00']},hk:{zone:'Asia/Hong_Kong',cur:'HKD',closes:['16:00','16:10','12:00','12:10']},us:{zone:'America/New_York',cur:'USD',closes:['16:00','13:00']}};
const formatters=new Map();
function localParts(timestamp,market){
  if(!formatters.has(market))formatters.set(market,new Intl.DateTimeFormat('en-GB',{timeZone:profiles[market].zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}));
  return Object.fromEntries(formatters.get(market).formatToParts(timestamp).map(part=>[part.type,part.value]));
}
const httpsUrl=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
const approved=(registry,id)=>typeof id==='string'&&Object.hasOwn(registry,id)&&registry[id]===true;
export function marketCloseAt(date,market,time){
  if(!validDate(date)||!Object.hasOwn(profiles,market)||!profiles[market].closes.includes(time))throw Error('Unsupported market close');
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const wall=Date.UTC(year,month-1,day,hour,minute);let timestamp=wall;
  for(let attempt=0;attempt<4;attempt++){
    const parts=localParts(timestamp,market);
    const rendered=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
    const difference=wall-rendered;if(!difference)return timestamp;timestamp+=difference;
  }
  throw Error('Market time could not be resolved');
}
export function assessValuationEvidence({date,now,instruments=[],sessions=[],prices=[],fx,fxDate,dateBasis,actionChecks=[],approvedProviders={}}){
  if(!validDate(date)||!Number.isFinite(now)||now<0)throw Error('Invalid valuation date or clock');
  const targetAt=Date.parse(date+'T23:00:00Z'),issues=[],accepted=[],closeCache=new Map();
  const issue=(reason,tc)=>issues.push({reason,...(tc?{tc}:{})});
  if(now<targetAt)issue('daily-window-not-ready');
  if(dateBasis!=='market-local')issue('legacy-trade-date-basis-unverified');
  if(!Array.isArray(sessions)||sessions.length>50||!Array.isArray(prices)||prices.length>50||!Array.isArray(actionChecks)||actionChecks.length>50||!approvedProviders||typeof approvedProviders!=='object')return {status:'pending',date,targetAt,issues:[...issues,{reason:'unsupported-evidence-shape'}]};
  if(!Array.isArray(instruments)||!instruments.length||instruments.length>50)return {status:'pending',date,targetAt,issues:[...issues,{reason:'unsupported-instrument-count'}]};
  const seen=new Set();
  for(const instrument of instruments){
    const {tc,mkt,cur,historyFrom}=instrument||{},profile=profiles[mkt];
    if(!profile||typeof tc!=='string'||!tc.startsWith(mkt)||cur!==profile.cur||!validDate(historyFrom)||historyFrom>date||seen.has(tc)){issue('invalid-instrument',tc);continue;}
    seen.add(tc);
    const specific=sessions.filter(session=>session?.tc===tc&&session.mkt===mkt&&session.date===date);
    const matching=specific.length?specific:sessions.filter(session=>session?.mkt===mkt&&session.date===date&&!session.tc);
    if(matching.length!==1||matching[0].status!=='verified'||!httpsUrl(matching[0].sourceUrl)){issue('calendar-unverified',tc);continue;}
    const session=matching[0];
    if(mkt==='hk'&&!(session.closeMechanism==='CAS'?['16:10','12:10']:session.closeMechanism==='NON_CAS'?['16:00','12:00']:[]).includes(session.closeTime)){issue('hong-kong-close-mechanism-unverified',tc);continue;}
    if(typeof session.open!=='boolean'||!validDate(session.priceDate)||(session.open?session.priceDate!==date:session.priceDate>=date)){issue('calendar-price-date-invalid',tc);continue;}
    let closeAt;try{const key=[mkt,session.priceDate,session.closeTime].join('|');if(!closeCache.has(key))closeCache.set(key,marketCloseAt(session.priceDate,mkt,session.closeTime));closeAt=closeCache.get(key);}catch{issue('calendar-close-unsupported',tc);continue;}
    if(!Number.isFinite(session.readyAt)||session.readyAt<closeAt||session.readyAt>now||closeAt>targetAt){issue('market-close-not-ready',tc);continue;}
    const records=prices.filter(price=>price?.tc===tc);
    if(records.length!==1){issue('missing-or-duplicate-close',tc);continue;}
    const price=records[0];
    if(!approved(approvedProviders,price.provider)){issue('price-provider-not-approved',tc);continue;}
    if(price.date!==session.priceDate||price.closeAt!==closeAt){issue('price-session-date-mismatch',tc);continue;}
    if(price.currency!==cur||!Number.isFinite(price.px)||price.px<=0){issue('invalid-close-price',tc);continue;}
    if(price.adjustment!=='unadjusted'){issue('adjusted-close-not-compatible-with-ledger',tc);continue;}
    if(price.session!=='regular'||price.status!=='final'||!httpsUrl(price.sourceUrl)||!Number.isFinite(price.observedAt)||price.observedAt<closeAt||price.observedAt>now){issue('close-not-confirmed',tc);continue;}
    const checks=actionChecks.filter(check=>check?.tc===tc);
    if(checks.length!==1||checks[0].state!=='reconciled'||checks[0].unresolved!==false||!validDate(checks[0].fromDate)||checks[0].fromDate>historyFrom||!validDate(checks[0].throughDate)||checks[0].throughDate<date||!httpsUrl(checks[0].sourceUrl)){issue('corporate-actions-unreconciled',tc);continue;}
    accepted.push({...price,market:mkt,marketTimeZone:profile.zone,carriedFromPreviousSession:!session.open});
  }
  if(!validDate(fxDate)||fxDate>date||!fx||fx.asOfDate!==fxDate)issue('fx-date-unverified');
  else if(!approved(approvedProviders,fx.provider))issue('fx-provider-not-approved');
  else if(fx.basis!=='ECB_REFERENCE'||fx.approximate!==false||fx.rates?.CNY!==1||!['USD','HKD'].every(currency=>Number.isFinite(fx.rates?.[currency])&&fx.rates[currency]>0)||!httpsUrl(fx.sourceUrl)||!Number.isFinite(fx.observedAt)||fx.observedAt<Date.parse(fxDate+'T00:00:00Z')||fx.observedAt>now)issue('fx-reference-invalid');
  if(issues.length)return {status:'pending',date,targetAt,issues};
  return {status:'verified-candidate',date,targetAt,prices:accepted,fx:{...fx,carriedFromPreviousReferenceDate:fxDate<date},notes:['Candidate evidence only; no database write or production activation.','FX uses an informational reference rate, not an execution or exact market-close rate.']};
}
