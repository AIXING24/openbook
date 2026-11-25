import {dailyStep} from './daily.mjs';
import {read,statement as query} from './storage.mjs';
export async function mockScheduledStep(db,controller){
  if(!Number.isFinite(controller.scheduledTime))return {status:'invalid-clock'};
  const target=await read(db,`SELECT t.account,c.date FROM gt_mock_schedule_targets t
    JOIN gt_accounts a ON a.id=t.account AND a.generation IS NOT NULL
    JOIN gt_mock_schedule_days c ON c.date>=t.start_date AND c.market_open=1
    WHERE c.ready_at<=? AND NOT EXISTS(SELECT 1 FROM gt_daily d WHERE d.account=t.account AND d.date=c.date AND d.status='confirmed')
    AND NOT EXISTS(SELECT 1 FROM gt_mock_schedule_days earlier WHERE earlier.date>=t.start_date AND earlier.date<c.date AND earlier.market_open=1
      AND NOT EXISTS(SELECT 1 FROM gt_daily d WHERE d.account=t.account AND d.date=earlier.date AND d.status='confirmed'))
    ORDER BY CASE WHEN t.account>COALESCE((SELECT value FROM gt_control WHERE key='mock-last-account'),'') THEN 0 ELSE 1 END,t.account,c.date LIMIT 1`,controller.scheduledTime);
  if(!target)return {status:'idle'};
  const result=await dailyStep(db,target.account,target.date);
  await db.batch([
    query(db,"INSERT INTO gt_control VALUES('mock-last-account',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",target.account),
    query(db,"INSERT INTO gt_control VALUES('mock-last-scheduled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify({account:target.account,date:target.date,result,scheduledTime:controller.scheduledTime,cron:controller.cron,source:'MOCK_CALENDAR'})),
  ]);
  return result;
}
