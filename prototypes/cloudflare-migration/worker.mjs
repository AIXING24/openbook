// MOCK-ONLY THROWAWAY WORKER. No production login or real ledger.
import { Core, PnlHistory, prepareImport, normalizePositionOrder } from './legacy-app.mjs';
const json = (data, status = 200) => Response.json(data, { status });
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const read = (db, sql, ...values) => db.prepare(sql).bind(...values).first();
const all = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results;
const run = (db, sql, ...values) => db.prepare(sql).bind(...values).run();
const authorized = (request, secret) => typeof secret === 'string' && secret.length >= 10 && request.headers.get('authorization') === 'Bearer ' + secret;
const accountOf = (request, env) => authorized(request, env.TEST_ALICE_TOKEN) ? 'alice' : authorized(request, env.TEST_BOB_TOKEN) ? 'bob' : null;
const mockTrade = trade => trade?.broker === 'Mock HSBC' && trade.note === '模拟数据' && /^Mock stock \d+$/.test(trade.name) && !trade.demo;
const validDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;

async function validationRoute(request, env, path, body) {
  if (!authorized(request, env.TEST_ADMIN_TOKEN)) return json({ error: 'validation admin authorization required' }, 401);
  if (path === '/validation/status' && request.method === 'GET') {
    return json({ version:'prototype v0.2.1', scheduled:await all(env.DB, "SELECT * FROM control WHERE key IN ('last-scheduled-result','last-scheduled-at','valuation-date')"),
      jobs:await all(env.DB,'SELECT * FROM jobs ORDER BY date,account_id'), archives:await all(env.DB,'SELECT account_id,date,revision FROM daily_archive') });
  }
  if (path === '/validation/seed' && request.method === 'POST') {
    if (!validDate(body.date) || !Array.isArray(body.symbols) || body.symbols.length > 50 || body.symbols.some(tc => !/^(sh|hk|us)100\d{3}$/.test(tc)) || !Number.isFinite(body.price) || body.price <= 0) return json({error:'invalid synthetic prices'},422);
    await run(env.DB,'DELETE FROM prices WHERE date=?',body.date);
    const statements = [...new Set(body.symbols)].filter(tc=>tc!==body.missing).map(tc=>env.DB.prepare('INSERT INTO prices VALUES(?,?,?,?)').bind(body.date,tc,body.price,body.finalized === false ? 0 : 1));
    statements.push(body.noFx ? env.DB.prepare('DELETE FROM rates WHERE date=?').bind(body.date) : env.DB.prepare('INSERT INTO rates VALUES(?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload').bind(body.date,JSON.stringify({USDCNY:7,HKDCNY:0.9})));
    if (body.schedule) statements.push(env.DB.prepare('INSERT INTO control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('valuation-date',body.date));
    await env.DB.batch(statements);
    return json({seeded:true,date:body.date,symbols:body.symbols.length});
  }
  if (path === '/validation/run' && request.method === 'POST') {
    if (!validDate(body.date)) return json({error:'invalid date'},422);
    return json({output:await dailyJob(env,body.date)});
  }
  if (path === '/validation/providers' && request.method === 'GET') {
    const providers = [
      ...['sh600519','hk00700','usNVDA.OQ'].map(symbol=>({symbol,url:'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param='+symbol+',day,,,500,'})),
      {symbol:'historical-fx',url:'https://api.frankfurter.dev/v1/2025-11-03..2025-11-05?base=USD&symbols=CNY,HKD'},
    ];
    const results = [];
    for (const provider of providers) {
      try {
        const response = await fetch(provider.url,{signal:AbortSignal.timeout(15000)});
        const data = await response.json();
        if (provider.symbol === 'historical-fx') results.push({symbol:provider.symbol,status:response.status,dates:Object.keys(data.rates || {}),base:data.base});
        else { const rows=data.data?.[provider.symbol]?.day || []; results.push({symbol:provider.symbol,status:response.status,count:rows.length,firstDate:rows[0]?.[0],lastDate:rows.at(-1)?.[0],finalBarIsNotAssumedClosed:true}); }
      } catch (error) { results.push({symbol:provider.symbol,error:error.name}); }
    }
    return json({results});
  }
  return json({error:'validation route not found'},404);
}
async function stateOf(db, account) {
  const accountRow = await read(db, 'SELECT * FROM accounts WHERE id=?', account);
  return { revision: accountRow?.revision || 0, migrationId: accountRow?.migration_id || null,
    ...(accountRow?.payload ? JSON.parse(accountRow.payload) : { state: null, legacyHistory: null }),
    confirmedHistory: (await all(db, 'SELECT payload,status FROM daily WHERE account_id=? ORDER BY date', account)).map(row => ({ ...JSON.parse(row.payload), status: row.status })) };
}
async function accountState(db, account) {
  const row=await read(db,'SELECT revision,migration_id,payload FROM accounts WHERE id=?',account);
  return {revision:row?.revision || 0,migrationId:row?.migration_id || null,...(row?.payload?JSON.parse(row.payload):{state:null,legacyHistory:null})};
}
async function stateResponse(db, account, extra={}) {
  const row=await read(db,'SELECT revision,migration_id,payload FROM accounts WHERE id=?',account);
  const history=await all(db,"SELECT json_set(payload,'$.status',status) AS payload FROM daily WHERE account_id=? ORDER BY date",account);
  const prefix=JSON.stringify({revision:row?.revision || 0,migrationId:row?.migration_id || null,...extra}).slice(0,-1);
  const payload=row?.payload || '{"state":null,"legacyHistory":null}';
  return new Response(prefix+','+payload.slice(1,-1)+',"confirmedHistory":['+history.map(r=>r.payload).join(',')+']}',{headers:{'content-type':'application/json'}});
}
async function migrationOf(db, account, id) { return read(db, 'SELECT * FROM migrations WHERE account_id=? AND id=?', account, id); }

export async function dailyJob(env, date) {
  const db = env.DB;
  const cutoff = Date.parse(date + 'T23:59:00+08:00');
  const priceRows = await all(db, 'SELECT * FROM prices WHERE date=? AND finalized=1', date);
  const quote = Object.fromEntries(priceRows.map(row => [row.tc, { px: row.px, ts: cutoff }]));
  const rate = await read(db, 'SELECT payload FROM rates WHERE date=?', date);
  const fx = rate ? { ...JSON.parse(rate.payload), ts: cutoff } : null;
  const output = [];
  for (const { id } of await all(db, 'SELECT id FROM accounts WHERE payload IS NOT NULL ORDER BY id LIMIT 2')) {
    const current = await accountState(db, id);
    const existing = await read(db, 'SELECT revision,status FROM daily WHERE account_id=? AND date=?', id, date);
    if (existing?.revision === current.revision && existing.status === 'confirmed') { output.push({ account: id, status: 'already-confirmed' }); continue; }
    const result = PnlHistory.buildSnapshot(current.state.trades, quote, fx, { now: cutoff, startedAt: cutoff });
    if (!result.snapshot) {
      await run(db, 'INSERT INTO jobs VALUES(?,?,?,?) ON CONFLICT(account_id,date) DO UPDATE SET status=excluded.status,reason=excluded.reason', id, date, 'pending', result.reason);
      output.push({ account: id, status: 'pending', reason: result.reason }); continue;
    }
    const payload = JSON.stringify({ ...result.snapshot, valuationDate: date, generatedAt: Date.now(), source: 'SYNTHETIC_CONFIRMED_CLOSE', ledgerRevision: current.revision });
    const savedBatch = await db.batch([
      db.prepare('INSERT OR IGNORE INTO daily_archive SELECT account_id,date,revision,payload FROM daily WHERE account_id=? AND date=? AND revision<>? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND revision=?)').bind(id,date,current.revision,id,current.revision),
      db.prepare(`INSERT INTO daily(account_id,date,revision,status,payload)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND revision=?)
      ON CONFLICT(account_id,date) DO UPDATE SET revision=excluded.revision,status=excluded.status,payload=excluded.payload`).bind(id, date, current.revision, 'confirmed', payload, id, current.revision),
    ]);
    const saved = savedBatch[1];
    if (!saved.meta.changes) { output.push({ account: id, status: 'revision-changed' }); continue; }
    await run(db, 'INSERT INTO jobs VALUES(?,?,?,NULL) ON CONFLICT(account_id,date) DO UPDATE SET status=excluded.status,reason=NULL', id, date, 'complete');
    output.push({ account: id, status: 'confirmed' });
  }
  await run(db, 'INSERT INTO control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', 'last-scheduled-result', JSON.stringify(output));
  return output;
}

export default {
  async fetch(request, env) {
    if (env.PROTOTYPE_MODE !== 'mock-only') return json({ error: 'mock-only prototype disabled' }, 503);
    const path = new URL(request.url).pathname;
    if (!['GET','POST'].includes(request.method)) return json({error:'method not allowed'},405);
    let body = {};
    if (request.method === 'POST') {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 100000) return json({error:'request too large'},413);
      try { body = JSON.parse(text); } catch { return json({error:'invalid JSON'},400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'invalid body'},400);
    }
    if (path.startsWith('/validation/')) return validationRoute(request,env,path,body);
    const account = accountOf(request, env);
    if (!account) return json({ error: 'mock account authorization required' }, 401);
    const db = env.DB;
    if (request.method === 'GET' && path === '/state') return stateResponse(db, account);
    if (request.method !== 'POST') return json({error:'method not allowed'},405);
    if (path === '/migration/start') {
      if (!/^[a-f0-9]{64}$/.test(body.fingerprint) || !Number.isInteger(body.chunks) || body.chunks < 1 || body.chunks > 128) return json({ error: 'invalid migration manifest' }, 422);
      await run(db, 'INSERT OR IGNORE INTO accounts(id) VALUES(?)', account);
      const id = crypto.randomUUID();
      await run(db, 'INSERT OR IGNORE INTO migrations VALUES(?,?,?,?,?)', id, account, body.fingerprint, body.chunks, 'uploading');
      const migration = await read(db, 'SELECT * FROM migrations WHERE account_id=? AND fingerprint=?', account, body.fingerprint);
      if (migration.chunks !== body.chunks) return json({ error: 'manifest conflict' }, 409);
      const received = (await all(db, 'SELECT number FROM chunks WHERE migration_id=? ORDER BY number', migration.id)).map(row => row.number);
      return json({ ...migration, received });
    }
    if (path === '/migration/chunk') {
      const migration = await migrationOf(db, account, body.id);
      if (!migration) return json({ error: 'migration not found' }, 404);
      if (!Number.isInteger(body.number) || body.number < 0 || body.number >= migration.chunks || typeof body.text !== 'string' || new TextEncoder().encode(body.text).length > 24000) return json({ error: 'invalid chunk' }, 422);
      const digest = await hash(body.text);
      const existing = await read(db, 'SELECT hash FROM chunks WHERE migration_id=? AND number=?', migration.id, body.number);
      if (existing && existing.hash !== digest) return json({ error: 'chunk conflict' }, 409);
      await run(db, 'INSERT OR IGNORE INTO chunks VALUES(?,?,?,?)', migration.id, body.number, body.text, digest);
      return json({ accepted: true, duplicate: !!existing });
    }
    if (path === '/migration/commit') {
      const migration = await migrationOf(db, account, body.id);
      if (!migration) return json({ error: 'migration not found' }, 404);
      const current = await accountState(db, account);
      if (migration.status === 'committed' && current.migrationId === migration.id) return stateResponse(db, account, {committed:true,duplicate:true});
      if (current.state) return json({ error: 'cloud account already contains data; explicit reconciliation required' }, 409);
      const chunks = await all(db, 'SELECT number,text FROM chunks WHERE migration_id=? ORDER BY number', migration.id);
      if (chunks.length !== migration.chunks) return json({ error: 'migration incomplete' }, 409);
      const text = chunks.map(row => row.text).join('');
      if (await hash(text) !== migration.fingerprint) return json({ error: 'fingerprint mismatch' }, 422);
      let prepared;
      try { prepared = prepareImport(JSON.parse(text)); } catch { return json({ error: 'legacy import validation failed' }, 422); }
      if (prepared.state.trades.length > 1000 || prepared.state.trades.some(trade => !mockTrade(trade))) return json({ error: 'prototype accepts at most 1000 synthetic non-demo trades' }, 422);
      const payload = JSON.stringify({ state: prepared.state, legacyHistory: prepared.history, legacyKind: 'captured-at-refresh' });
      const result = await db.batch([
        db.prepare('UPDATE accounts SET payload=?,migration_id=?,revision=1,last_operation=? WHERE id=? AND revision=0 AND payload IS NULL').bind(payload, migration.id, 'import:' + migration.id, account),
        db.prepare("UPDATE migrations SET status='committed' WHERE id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND migration_id=?)").bind(migration.id, account, migration.id),
      ]);
      if (!result[0].meta.changes) return json({ error: 'account changed during commit' }, 409);
      return stateResponse(db, account, {committed:true});
    }
    if (path === '/operation') {
      const current = await accountState(db, account);
      if (!current.state) return json({ error: 'migration not committed' }, 409);
      const digest = await hash(JSON.stringify(body));
      const prior = await read(db, 'SELECT hash,revision FROM operations WHERE account_id=? AND id=?', account, body.id);
      if (prior) return prior.hash === digest ? json({ duplicate: true, revision: prior.revision }) : json({ error: 'operation id reused with different data' }, 409);
      if (!body.id || body.expectedRevision !== current.revision || !['upsert-trade', 'delete-trade', 'preferences'].includes(body.kind)) return json({ error: 'revision or operation conflict' }, 409);
      const next = {state:{...current.state,trades:current.state.trades}};
      if (body.kind === 'upsert-trade' && !mockTrade(body.trade)) return json({error:'synthetic trades only'},422);
      let normalizedTrade;
      if (body.kind === 'upsert-trade') {
        try { normalizedTrade=prepareImport({v:1,trades:[body.trade]}).state.trades[0]; } catch {return json({error:'invalid ledger operation'},422);}
        if(current.state.trades.some(t=>t.id!==normalizedTrade.id && t.tc===normalizedTrade.tc && t.cur!==normalizedTrade.cur))return json({error:'conflicting currency'},422);
        next.state.trades = next.state.trades.filter(trade => trade.id !== normalizedTrade.id).concat(normalizedTrade);
      }
      if (body.kind === 'delete-trade') next.state.trades = next.state.trades.filter(trade => trade.id !== body.tradeId);
      if (body.kind === 'preferences') for(const key of ['base','upRed','theme','brokers','lastBroker','lastBackup','positionOrder','demoVersion']) if(Object.hasOwn(body.preferences || {},key)) next.state[key]=body.preferences[key];
      const metadata=prepareImport({...next.state,trades:[]}).state;
      delete metadata.trades;
      metadata.positionOrder=next.state.positionOrder;
      next.state={...metadata,trades:next.state.trades};
      next.state.positionOrder = normalizePositionOrder(next.state.positionOrder, next.state.trades);
      const revision = current.revision + 1;
      const oldTrade = current.state.trades.find(trade => trade.id === (body.trade?.id || body.tradeId));
      const since = [oldTrade?.date, body.trade?.date].filter(Boolean).sort()[0];
      const index=current.state.trades.findIndex(t=>t.id===(normalizedTrade?.id || body.tradeId));
      const removePath=index<0?'$.__unused_validation_key__':'$.state.trades['+index+']';
      let update;
      if(body.kind==='preferences') update=db.prepare("UPDATE accounts SET payload=json_patch(payload,?),revision=?,last_operation=? WHERE id=? AND revision=?").bind(JSON.stringify({state:{...metadata,positionOrder:next.state.positionOrder}}),revision,body.id,account,current.revision);
      else if(body.kind==='upsert-trade') update=db.prepare("UPDATE accounts SET payload=json_set(json_remove(payload,?),'$.state.trades[#]',json(?),'$.state.positionOrder',json(?)),revision=?,last_operation=? WHERE id=? AND revision=?").bind(removePath,JSON.stringify(normalizedTrade),JSON.stringify(next.state.positionOrder),revision,body.id,account,current.revision);
      else update=db.prepare("UPDATE accounts SET payload=json_set(json_remove(payload,?),'$.state.positionOrder',json(?)),revision=?,last_operation=? WHERE id=? AND revision=?").bind(removePath,JSON.stringify(next.state.positionOrder),revision,body.id,account,current.revision);
      const statements = [
        update,
        db.prepare('INSERT INTO operations SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND revision=? AND last_operation=?)').bind(account, body.id, digest, revision, account, revision, body.id),
      ];
      if (since && body.kind !== 'preferences') statements.push(db.prepare("UPDATE daily SET status='invalidated' WHERE account_id=? AND date>=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND last_operation=?)").bind(account, since, account, body.id));
      const result = await db.batch(statements);
      return result[0].meta.changes ? json({ revision }) : json({ error: 'concurrent revision conflict' }, 409);
    }
    return json({ error: 'route not found' }, 404);
  },
  async scheduled(controller, env) {
    if (env.PROTOTYPE_MODE !== 'mock-only') return;
    const clock = await read(env.DB, "SELECT value FROM control WHERE key='valuation-date'");
    if (clock) await dailyJob(env, clock.value);
    await run(env.DB,'INSERT INTO control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','last-scheduled-at',JSON.stringify({scheduledTime:controller.scheduledTime,cron:controller.cron,observedAt:Date.now()}));
  },
};
