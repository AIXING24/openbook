import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Miniflare } from 'miniflare';
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const require = createRequire(repo + '/package.json');
const { IDBFactory } = require('fake-indexeddb');
const copy = value => JSON.parse(JSON.stringify(value));
const digest = text => createHash('sha256').update(text).digest('hex');
const core = readFileSync(repo + '/parts/core.js', 'utf8');
const pnl = readFileSync(repo + '/parts/pnl.js', 'utf8');
const data = readFileSync(repo + '/parts/data.js', 'utf8');
const ui = readFileSync(repo + '/parts/ui.js', 'utf8');
const orderAndDefaults = data.slice(data.indexOf('function normalizePositionOrder'), data.indexOf('let S ='));
const importFunction = ui.slice(ui.indexOf('function prepareImport'), ui.indexOf('function handleImport'));
const legacy = core + '\n' + pnl + '\n' + orderAndDefaults + '\n' + importFunction;
writeFileSync(new URL('./legacy-app.mjs', import.meta.url), legacy + '\nexport {Core, PnlHistory, prepareImport, normalizePositionOrder};\n');
const context = vm.createContext({ indexedDB: new IDBFactory(), structuredClone, setTimeout, clearTimeout });
vm.runInContext(legacy + '\nglobalThis.legacy = {Core, PnlHistory, prepareImport};', context);
export const old = context.legacy;

export async function fixture(count = 1000, stocks = 50) {
  const trades = [], markets = [{mkt:'sh',cur:'CNY'}, {mkt:'hk',cur:'HKD'}, {mkt:'us',cur:'USD'}];
  for (let index = 0; index < count; index++) {
    const stock = index % stocks, market = markets[stock % 3], cycle = Math.floor(index / stocks);
    trades.push({ id: 'synthetic-' + index, date: '2026-11-' + (10 + Math.floor(index / (count / 5))), tc: market.mkt + (100000 + stock), ...market,
      code: String(100000 + stock), name: 'Mock stock ' + stock, side: cycle % 2 ? 'S' : 'B', px: cycle % 2 ? 110 : 100,
      qty: cycle % 2 && stock !== 0 ? 5 : 10, fee: 0.1, broker: 'Mock HSBC', note: '模拟数据', ts: index + 1 });
  }
  const quotes = Object.fromEntries(old.Core.calcPositions(trades).map(position => [position.tc, { px: 115 }]));
  const history = context.legacy.PnlHistory;
  const now = Date.parse('2026-11-12T10:00:00+08:00');
  await history.init(trades, now);
  await history.replace(null, trades, now);
  for (const date of ['2026-11-12','2026-11-13']) {
    const stamp = Date.parse(date + 'T10:00:00+08:00');
    const quoted = Object.fromEntries(Object.entries(quotes).map(([tc,q])=>[tc,{...q,ts:stamp}]));
    await history.capture(trades, quoted, {USDCNY:7,HKDCNY:0.9,ts:stamp}, {now:stamp});
  }
  return { v:1, base:'USD', upRed:false, theme:'dark', brokers:['Mock HSBC'], lastBroker:'Mock HSBC', lastBackup:0,
    positionOrder: Object.keys(quotes).reverse(), trades, pnlHistory: copy(await history.exportData()) };
}

export async function createRuntime() {
  const mf = new Miniflare({ modules:true, scriptPath:new URL('./worker.mjs',import.meta.url).pathname,
    compatibilityDate:'2025-11-01', cf:false, host:'127.0.0.1', port:0,
    d1Databases:{DB:'PROTOTYPE-wipe-me'}, d1Persist:false, bindings:{PROTOTYPE_MODE:'mock-only',TEST_ALICE_TOKEN:'MOCK-ALICE',TEST_BOB_TOKEN:'MOCK-BOB-LOCAL',TEST_ADMIN_TOKEN:'MOCK-ADMIN-LOCAL'} });
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const request = async (account,path,body) => {
    const response = await mf.dispatchFetch('http://prototype.invalid' + path, { method:body === undefined ? 'GET':'POST',
      headers:{authorization:'Bearer ' + (account==='alice'?'MOCK-ALICE':'MOCK-BOB-LOCAL'),'content-type':'application/json'}, ...(body===undefined?{}:{body:JSON.stringify(body)}) });
    return {status:response.status,body:await response.json()};
  };
  const seed = async (date,trades,price = 115,missing = null) => {
    await db.prepare('DELETE FROM prices WHERE date=?').bind(date).run();
    const statements = [...new Set(trades.map(trade=>trade.tc))].filter(tc=>tc!==missing).map(tc=>db.prepare('INSERT INTO prices VALUES(?,?,?,1)').bind(date,tc,price));
    statements.push(db.prepare('INSERT INTO rates VALUES(?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload').bind(date,JSON.stringify({USDCNY:7,HKDCNY:0.9})));
    await db.batch(statements);
  };
  const schedule = async date => {
    await db.prepare('INSERT INTO control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('valuation-date',date).run();
    const worker = await mf.getWorker();
    await worker.scheduled({scheduledTime:Date.now(),cron:'0 * * * *'});
    const row = await db.prepare("SELECT value FROM control WHERE key='last-scheduled-result'").first();
    return JSON.parse(row.value);
  };
  return {mf,db,request,seed,schedule,close:()=>mf.dispose()};
}

// A minimal data-layer adapter; production frontend integration is intentionally not installed.
export class FrontendPrototype {
  constructor(runtime,backup,account='alice') {
    this.runtime=runtime;this.account=account;this.original=JSON.stringify(backup);this.backup=copy(backup);
    this.local=copy(old.prepareImport(backup).state);this.mode='local';this.revision=0;this.outbox=[];this.offline=false;this.events=[];
    this.text=this.original;this.parts=[];for(let index=0;index<this.text.length;index+=10000)this.parts.push(this.text.slice(index,index+10000));
  }
  async start() {
    const result=await this.runtime.request(this.account,'/migration/start',{fingerprint:digest(this.text),chunks:this.parts.length});
    if(result.status!==200)throw new Error(JSON.stringify(result));this.migration=result.body;return result;
  }
  async chunk(number,text=this.parts[number]) {return this.runtime.request(this.account,'/migration/chunk',{id:this.migration.id,number,text});}
  async upload() {await this.start();for(let number=0;number<this.parts.length;number++)if(!this.migration.received.includes(number))await this.chunk(number);}
  async finish() {
    const result=await this.runtime.request(this.account,'/migration/commit',{id:this.migration.id});
    if(result.status!==200)return result;
    if(JSON.stringify(result.body.state)!==JSON.stringify(old.prepareImport(this.backup).state))throw new Error('Cloud state differs from local import');
    if(JSON.stringify(result.body.legacyHistory)!==JSON.stringify(this.backup.pnlHistory))throw new Error('Legacy evidence differs');
    this.mode='cloud-with-local-cache';this.revision=result.body.revision;return result;
  }
  edit(trade) {this.local.trades=this.local.trades.filter(row=>row.id!==trade.id).concat(copy(trade));this.outbox.push({id:crypto.randomUUID(),kind:'upsert-trade',trade:copy(trade)});}
  async sync({loseResponse=false}={}) {
    if(this.offline)return {pending:this.outbox.length};
    while(this.outbox.length){
      const operation=this.outbox[0];operation.expectedRevision??=this.revision;
      const result=await this.runtime.request(this.account,'/operation',operation);
      if(loseResponse)return {responseLost:true};
      if(result.status!==200)return result;
      this.revision=result.body.revision;this.outbox.shift();
    }
    return {pending:0,revision:this.revision};
  }
  summary(){return {mode:this.mode,offline:this.offline,localTrades:this.local.trades.length,revision:this.revision,pending:this.outbox.length,migrationId:this.migration?.id||null,chunks:this.parts.length,sourceUnchanged:JSON.stringify(this.backup)===this.original};}
}
