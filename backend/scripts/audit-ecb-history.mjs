import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ecbReferenceRates} from '../ecb-fx.mjs';
const start='2025-11-25',end='2026-11-24',sourceUrl='https://data-api.ecb.europa.eu/service/data/EXR/D.USD+CNY+HKD.EUR.SP00.A?startPeriod='+start+'&endPeriod='+end+'&format=csvdata';
const {stdout:text}=await promisify(execFile)('curl',['-fLsS','--max-time','45',sourceUrl],{maxBuffer:1000000});assert.ok(text.length<1000000,'Bounded one-year offline audit');
const [header,...lines]=text.trim().split(/\r?\n/),dateIndex=header.split(',').indexOf('TIME_PERIOD');assert.ok(dateIndex>=0);
const groups=new Map();
for(const line of lines){const date=line.split(',')[dateIndex];assert.match(date,/^\d{4}-\d{2}-\d{2}$/);assert.ok(date>=start&&date<=end);if(!groups.has(date))groups.set(date,[]);groups.get(date).push(line);}
const observedAt=Date.now();
for(const [date,rows] of groups){const record=ecbReferenceRates(header+'\n'+rows.join('\n'),{date,observedAt});assert.ok(record.rates.USD>0&&record.rates.HKD>0);assert.equal(record.basis,'ECB_REFERENCE');}
const dates=[...groups.keys()].sort();
const report={version:'backend v0.3.5 candidate',checkedAt:new Date().toISOString(),source:'European Central Bank',sourceUrl,transport:'curl HTTPS with certificate verification',requestedRange:{start,end},responseBytes:new TextEncoder().encode(text).length,observations:lines.length,referenceDates:groups.size,firstReferenceDate:dates[0],lastReferenceDate:dates.at(-1),allDatesHaveThreeValidatedCurrencies:true,allCrossRatesFinitePositive:true,parserUnit:'One date / three rows per call; full-year grouping is an offline Node audit, not a Worker CPU result',basis:'ECB_REFERENCE',method:'CNY per USD = EURCNY / EURUSD; CNY per HKD = EURCNY / EURHKD',productionWrites:false,limitations:'Reference dates do not represent every calendar day. Prior reference dates require a verified TARGET calendar decision, not an arbitrary stale-rate fallback. Reference rates are not exact exchange close or actual bank execution rates. Derived rates are modifications of ECB data.'};
writeFileSync(new URL('../ecb-history-audit-v0.3.5.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
