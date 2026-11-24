// Official Pages CPU quantiles; identities, tokens and financial data are absent.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
const reportVersion=process.argv[2]??'v0.1.4';
if(!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(reportVersion))throw Error('Fixed version identifier required');
const config=JSON.parse(readFileSync('wrangler.local.json','utf8'));
const acceptance=JSON.parse(readFileSync('kinde-cloud-verification-'+reportVersion+'.json','utf8'));
let auth;try{auth=await promisify(execFile)('./node_modules/.bin/wrangler',['auth','token','--json','--config','wrangler.local.json'],{env:process.env});}catch{throw Error('Official credentials unavailable; output withheld');}
const {token}=JSON.parse(auth.stdout),start=acceptance.startedAt,end=new Date().toISOString();
const query=`query($accountTag:string,$start:string,$end:string){__type(name:"AccountPagesFunctionsInvocationsAdaptiveGroupsQuantiles"){fields{name description}}viewer{accounts(filter:{accountTag:$accountTag}){pagesFunctionsInvocationsAdaptiveGroups(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end,scriptName:"pages-worker--24757550-production"}){dimensions{datetimeMinute scriptName status}sum{requests errors}quantiles{cpuTimeP50 cpuTimeP99 cpuTimeP999}}}}}`;
const response=await fetch('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,variables:{accountTag:config.account_id,start,end}}),signal:AbortSignal.timeout(30000)});
const data=await response.json();assert.equal(response.status,200);assert.ok(!data.errors,'Official analytics unavailable');
const description=data.data.__type.fields.find(f=>f.name==='cpuTimeP99').description;assert.match(description,/microseconds/);
const rows=data.data.viewer.accounts[0].pagesFunctionsInvocationsAdaptiveGroups;
const report={version:'auth '+reportVersion,queriedAt:end,timeRange:{start,end},deployment:acceptance.deployment,scriptName:'pages-worker--24757550-production',units:description,rows,requests:rows.reduce((n,r)=>n+r.sum.requests,0),runtimeErrors:rows.reduce((n,r)=>n+r.sum.errors,0),highestBucketP99Ms:rows.length?Math.max(...rows.map(r=>r.quantiles.cpuTimeP99))/1000:null,fullAuthenticatedFlowProven:acceptance.realLogin?.runtimeVersion===reportVersion&&acceptance.realLogin?.passed===true&&acceptance.realLogout?.runtimeVersion===reportVersion&&acceptance.realLogout?.passed===true,currentObservedBucketsWithin10ms:rows.length>0&&rows.every(r=>r.quantiles.cpuTimeP99<10000),freeCpuHeadroomProven:false,limitations:'Adaptive minute-bucket quantiles, not exact per-request maximum or path-level CPU. Minute buckets do not separate paths; independent successful callback/exchange/exit evidence and repeat/cold samples are required. Zero runtime errors does not prove stable Free CPU headroom.'};
writeFileSync('kinde-cloud-metrics-'+reportVersion+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
