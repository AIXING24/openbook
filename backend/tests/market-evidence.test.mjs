import test from 'node:test';
import assert from 'node:assert/strict';
import {marketCloseAt,assessValuationEvidence} from '../market-evidence.mjs';
import {ecbReferenceRates} from '../ecb-fx.mjs';
const csv=date=>['KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE',...Object.entries({CNY:7.8,USD:1.2,HKD:9.6}).map(([currency,value])=>'EXR.D.'+currency+'.EUR.SP00.A,D,'+currency+',EUR,SP00,A,'+date+','+value+',A,"Reference, '+currency+'"')].join('\r\n');
function evidence(date='2026-11-25'){
  const now=Date.parse(date+'T23:30:00Z'),tc='usEXAMPLE',closeAt=marketCloseAt(date,'us','16:00');
  return {date,now,dateBasis:'market-local',approvedProviders:{'fixture-price':true,'ecb-reference':true},fxDate:date,fx:ecbReferenceRates(csv(date),{date,observedAt:now}),instruments:[{tc,mkt:'us',cur:'USD',historyFrom:'2026-11-01'}],sessions:[{mkt:'us',date,open:true,status:'verified',priceDate:date,closeTime:'16:00',readyAt:closeAt+15*60000,sourceUrl:'https://www.nyse.com/markets/hours-calendars'}],prices:[{tc,date,px:100,currency:'USD',provider:'fixture-price',adjustment:'unadjusted',session:'regular',status:'final',closeAt,observedAt:now,sourceUrl:'https://prices.example.test/daily'}],actionChecks:[{tc,fromDate:'2026-11-01',throughDate:date,state:'reconciled',unresolved:false,sourceUrl:'https://issuer.example.test/actions'}]};
}
test('IANA market close conversion handles DST, half days and Asian close auctions',()=>{
  for(const [date,market,time,expected] of [['2026-03-06','us','16:00','2026-03-06T21:00:00.000Z'],['2026-03-09','us','16:00','2026-03-09T20:00:00.000Z'],['2026-10-30','us','16:00','2026-10-30T20:00:00.000Z'],['2026-11-02','us','16:00','2026-11-02T21:00:00.000Z'],['2026-11-27','us','13:00','2026-11-27T18:00:00.000Z'],['2026-11-25','sh','15:00','2026-11-25T07:00:00.000Z'],['2026-11-25','sz','15:00','2026-11-25T07:00:00.000Z'],['2026-11-25','hk','16:10','2026-11-25T08:10:00.000Z'],['2026-11-25','hk','12:10','2026-11-25T04:10:00.000Z']])assert.equal(new Date(marketCloseAt(date,market,time)).toISOString(),expected);
  assert.throws(()=>marketCloseAt('2026-02-30','us','16:00'));assert.throws(()=>marketCloseAt('2026-11-25','us','23:00'));
});
test('candidate evidence gate does not invent a close or activate a provider',async context=>{
  await context.test('complete evidence returns a candidate only, with next-morning label and reference FX',()=>{
    const result=assessValuationEvidence(evidence());assert.equal(result.status,'verified-candidate');assert.equal(new Date(result.targetAt).toISOString(),'2026-11-25T23:00:00.000Z');assert.equal(result.fx.isExecutionRate,false);assert.equal(result.prices[0].carriedFromPreviousSession,false);
  });
  for(const [name,mutate,reason] of [
    ['window not ready',input=>input.now=input.sessions[0].readyAt,'daily-window-not-ready'],
    ['legacy date ambiguity',input=>input.dateBasis='legacy-shanghai-unverified','legacy-trade-date-basis-unverified'],
    ['unknown calendar',input=>input.sessions=[],'calendar-unverified'],
    ['missing close',input=>input.prices=[],'missing-or-duplicate-close'],
    ['unapproved source',input=>input.approvedProviders={},'price-provider-not-approved'],
    ['wrong session date',input=>input.prices[0].date='2026-11-24','price-session-date-mismatch'],
    ['adjusted price',input=>input.prices[0].adjustment='split-dividend-adjusted','adjusted-close-not-compatible-with-ledger'],
    ['after-hours price',input=>input.prices[0].session='post-market','close-not-confirmed'],
    ['provisional bar',input=>input.prices[0].status='provisional','close-not-confirmed'],
    ['quote observed before closing',input=>input.prices[0].observedAt=input.prices[0].closeAt-1,'close-not-confirmed'],
    ['unreconciled split',input=>input.actionChecks[0].state='needs-review','corporate-actions-unreconciled'],
    ['partial action coverage',input=>input.actionChecks[0].fromDate='2026-11-02','corporate-actions-unreconciled'],
    ['future FX',input=>input.fxDate='2026-11-26','fx-date-unverified'],
    ['wrong historical FX date',input=>input.fx.asOfDate='2026-11-24','fx-date-unverified'],
    ['fallback FX',input=>input.fx.approximate=true,'fx-reference-invalid'],
  ])await context.test(name,()=>{const input=evidence();mutate(input);const result=assessValuationEvidence(input);assert.equal(result.status,'pending');assert.ok(result.issues.some(issue=>issue.reason===reason));});
  await context.test('a verified holiday carries an explicitly named previous session, not a made-up daily bar',()=>{
    const input=evidence('2026-11-26'),previous='2026-11-25',closeAt=marketCloseAt(previous,'us','16:00');
    Object.assign(input.sessions[0],{open:false,priceDate:previous,readyAt:closeAt+15*60000});Object.assign(input.prices[0],{date:previous,closeAt});
    const result=assessValuationEvidence(input);assert.equal(result.status,'verified-candidate');assert.equal(result.prices[0].carriedFromPreviousSession,true);assert.equal(result.prices[0].date,previous);
    input.sessions[0].priceDate=input.date;assert.equal(assessValuationEvidence(input).status,'pending');
  });
  await context.test('half-day data must match the official half-day closing time',()=>{
    const input=evidence('2026-11-27'),closeAt=marketCloseAt(input.date,'us','13:00');Object.assign(input.sessions[0],{closeTime:'13:00',readyAt:closeAt+15*60000});
    assert.equal(assessValuationEvidence(input).status,'pending');input.prices[0].closeAt=closeAt;assert.equal(assessValuationEvidence(input).status,'verified-candidate');
  });
  await context.test('Hong Kong close-auction applicability cannot be assumed for every security',()=>{
    const input=evidence(),tc='hk00001';Object.assign(input.instruments[0],{tc,mkt:'hk',cur:'HKD'});Object.assign(input.sessions[0],{mkt:'hk',closeTime:'16:00'});Object.assign(input.prices[0],{tc,currency:'HKD',closeAt:marketCloseAt(input.date,'hk','16:00')});input.actionChecks[0].tc=tc;
    assert.ok(assessValuationEvidence(input).issues.some(issue=>issue.reason==='hong-kong-close-mechanism-unverified'));
    input.sessions[0].closeMechanism='NON_CAS';assert.equal(assessValuationEvidence(input).status,'verified-candidate');
    input.sessions[0].closeMechanism='CAS';assert.equal(assessValuationEvidence(input).status,'pending');
    input.sessions[0].closeTime='16:10';input.prices[0].closeAt=marketCloseAt(input.date,'hk','16:10');assert.equal(assessValuationEvidence(input).status,'verified-candidate');
  });
  await context.test('one portfolio may contain both CAS and non-CAS Hong Kong securities',()=>{
    const input=evidence(),first='hk00001',second='hk00002';Object.assign(input.instruments[0],{tc:first,mkt:'hk',cur:'HKD'});input.instruments.push({...input.instruments[0],tc:second});
    Object.assign(input.sessions[0],{mkt:'hk',closeMechanism:'CAS',closeTime:'16:10'});input.sessions.push({...input.sessions[0],tc:second,closeMechanism:'NON_CAS',closeTime:'16:00'});
    Object.assign(input.prices[0],{tc:first,currency:'HKD',closeAt:marketCloseAt(input.date,'hk','16:10')});input.prices.push({...input.prices[0],tc:second,closeAt:marketCloseAt(input.date,'hk','16:00')});
    input.actionChecks[0].tc=first;input.actionChecks.push({...input.actionChecks[0],tc:second});
    const result=assessValuationEvidence(input);assert.equal(result.status,'verified-candidate');assert.equal(result.prices.length,2);assert.notEqual(result.prices[0].closeAt,result.prices[1].closeAt);
  });
});
test('bounded ECB CSV adapter computes unrounded cross rates and rejects mismatched evidence',()=>{
  const date='2026-11-24',observedAt=Date.parse('2026-11-25T00:00:00Z'),result=ecbReferenceRates(csv(date),{date,observedAt});
  assert.equal(result.rates.USD,6.5);assert.equal(result.rates.HKD,0.8125);assert.equal(result.isExecutionRate,false);assert.equal(result.basis,'ECB_REFERENCE');
  for(const invalid of [csv(date).replace('7.8','0'),csv(date).replace('1.2','NaN'),csv(date).replace('D,USD,EUR','D,USD,CNY'),csv(date).replace(',A,"Reference, USD"',',M,"Reference, USD"'),csv(date).replaceAll('2026-11-24','2026-11-23'),csv(date)+'\n'+csv(date).split('\r\n')[1],csv(date).split('\r\n').slice(0,3).join('\n'),csv(date).slice(0,-1),'x'.repeat(24001)])assert.throws(()=>ecbReferenceRates(invalid,{date,observedAt}));
});
