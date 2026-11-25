import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
test('candidate market modules run in native Workerd without enabling cloud routes',async context=>{
  const runtime=new Miniflare({modules:true,scriptPath:new URL('./market-runtime.mjs',import.meta.url).pathname,compatibilityDate:'2026-08-06',cf:false,host:'127.0.0.1',port:0});context.after(()=>runtime.dispose());
  const invoke=async input=>{const response=await runtime.dispatchFetch('http://candidate.invalid/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
  await context.test('native IANA conversion includes standard time, DST and half-day close',async()=>{
    for(const [date,time,at] of [['2026-11-25','16:00','2026-11-25T21:00:00.000Z'],['2026-07-15','16:00','2026-07-15T20:00:00.000Z'],['2026-11-27','13:00','2026-11-27T18:00:00.000Z']])assert.equal((await invoke({kind:'close',date,market:'us',time})).at,at);
  });
  await context.test('native ECB reference parsing and an unapproved price source remain separated',async()=>{
    const date='2026-11-25',now=Date.parse(date+'T23:30:00Z');
    const csv='KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n'+Object.entries({CNY:7.8,USD:1.2,HKD:9.6}).map(([currency,value])=>'EXR.D.'+currency+'.EUR.SP00.A,D,'+currency+',EUR,SP00,A,'+date+','+value+',A').join('\n');
    const fx=await invoke({kind:'fx',csv,context:{date,observedAt:now}});assert.equal(fx.rates.USD,6.5);assert.equal(fx.basis,'ECB_REFERENCE');
    const result=await invoke({kind:'assess',evidence:{date,now,dateBasis:'market-local',approvedProviders:{'ecb-reference':true},fx,fxDate:date,instruments:[{tc:'usEXAMPLE',mkt:'us',cur:'USD',historyFrom:'2026-11-01'}],sessions:[{mkt:'us',date,open:true,status:'verified',priceDate:date,closeTime:'16:00',readyAt:Date.parse(date+'T21:15:00Z'),sourceUrl:'https://www.nyse.com/markets/hours-calendars'}],prices:[{tc:'usEXAMPLE',provider:'unapproved'}]}});
    assert.equal(result.status,'pending');assert.ok(result.issues.some(issue=>issue.reason==='price-provider-not-approved'));
  });
});
