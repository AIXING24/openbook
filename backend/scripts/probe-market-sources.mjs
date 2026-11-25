import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const report={version:'backend v0.3.5 candidate',startedAt:new Date().toISOString(),publicSampleSymbolsOnly:true,officialPriceLicenseVerified:false,productionWrites:false,probes:[]};
for(const symbol of ['sh600519','hk00700','usNVDA.OQ']){
  for(const adjustment of ['','qfq']){
    const url=new URL('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get');url.searchParams.set('param',symbol+',day,,,400,'+adjustment);
    const probe={symbol,mode:adjustment||'raw',endpoint:url.toString(),checkedAt:new Date().toISOString(),confirmedCloseEvidence:false};
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(25000)});probe.httpStatus=response.status;
      if(!response.ok)throw Error('HTTP failure');
      const text=await response.text();if(text.length>512000)throw Error('Oversized public sample');
      const data=JSON.parse(text),entry=data.data?.[symbol],key=adjustment?adjustment+'day':'day';
      const rows=entry?.[key];probe.responseKeys=Object.keys(entry||{});probe.explicitRequestedSeriesPresent=Array.isArray(rows)&&rows.length>0;
      if(probe.explicitRequestedSeriesPresent){
        probe.rows=rows.length;probe.firstDate=rows[0][0];probe.lastDate=rows.at(-1)[0];
        probe.responseHash=createHash('sha256').update(text).digest('hex');
        probe.allRowsHavePositiveClose=rows.every(row=>Array.isArray(row)&&row.length>=6&&Number(row[2])>0);
      }
      probe.providerMessage=typeof data.msg==='string'?data.msg.slice(0,100):null;
    }catch{probe.error='Public sample unavailable or unsupported; no fallback to adjusted/latest quote';}
    report.probes.push(probe);
    console.log(JSON.stringify({symbol,mode:probe.mode,httpStatus:probe.httpStatus,seriesPresent:probe.explicitRequestedSeriesPresent,rows:probe.rows,firstDate:probe.firstDate,lastDate:probe.lastDate,error:probe.error}));
  }
}
report.completedAt=new Date().toISOString();report.limitations='Endpoint availability and explicit raw series only. No official API contract, retention/redistribution licence, final-session flag, exhaustive ticker support or corporate-action completeness is proven. No bar is promoted to a confirmed production close.';
writeFileSync(new URL('../market-source-probes-v0.3.5.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
