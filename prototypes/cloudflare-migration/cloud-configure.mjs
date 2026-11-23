// Prepare isolated configuration after official whoami/D1 creation.
import {readFileSync,writeFileSync} from 'node:fs';
const [accountId,databaseId,cronMode]=process.argv.slice(2);
if(!/^[a-f0-9]{32}$/.test(accountId||'') || !/^[a-f0-9-]{36}$/.test(databaseId||''))throw new Error('Verified account and D1 IDs required');
writeFileSync(new URL('./wrangler.local.json',import.meta.url),JSON.stringify({
  name:'gaintrace-free-validation',main:'worker.mjs',account_id:accountId,compatibility_date:'2026-11-01',workers_dev:true,preview_urls:false,
  vars:{PROTOTYPE_MODE:'mock-only'},d1_databases:[{binding:'DB',database_name:'gaintrace-free-validation-db',database_id:databaseId}],
  observability:{enabled:true,head_sampling_rate:1},triggers:{crons:cronMode==='observe-cron'?['*/2 * * * *']:[]},
},null,2)+'\n');
console.log('Configured isolated mock-only Worker. Any explicitly enabled test Cron must be removed after observation.');
