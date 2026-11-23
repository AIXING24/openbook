import {readFileSync,writeFileSync} from 'node:fs';
import {configureValidationDns} from './cloud-transport.mjs';
const secrets=JSON.parse(readFileSync(new URL('./.validation-secrets.json',import.meta.url),'utf8'));
const deployment=JSON.parse(readFileSync(new URL('./cloud-deployment.json',import.meta.url),'utf8'));
const host=new URL(deployment.url).hostname;const transport=await configureValidationDns(host);
const targetDate=process.argv[2] || '2026-11-23';
const get=async (role,path)=>{
 const response=await fetch(new URL(path,deployment.url),{headers:{authorization:'Bearer '+secrets['TEST_'+role+'_TOKEN']},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Observation request failed: '+response.status);return response.json();
};
const status=await get('ADMIN','/validation/status');
const clock=status.scheduled.find(r=>r.key==='last-scheduled-at');
const states=[];
for(const role of ['ALICE','BOB']){
 const state=await get(role,'/state');const point=state.confirmedHistory.find(p=>p.valuationDate===targetDate);
 states.push({account:role.toLowerCase(),revision:state.revision,tradeCount:state.state?.trades.length,point:point?{date:point.valuationDate,status:point.status,source:point.source,generatedAt:point.generatedAt,ledgerRevision:point.ledgerRevision}:null});
}
const output={observedAt:new Date().toISOString(),transport,clock:clock?JSON.parse(clock.value):null,scheduledResult:status.scheduled.find(r=>r.key==='last-scheduled-result')?.value,states,
 actualCronPersisted:!!clock && states.every(s=>s.point?.status==='confirmed')};
writeFileSync(new URL('./cloud-scheduler-results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
