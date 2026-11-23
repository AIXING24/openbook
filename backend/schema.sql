-- Isolated normalized schema; does not modify the earlier prototype tables.
CREATE TABLE IF NOT EXISTS gt_accounts(id TEXT PRIMARY KEY, generation TEXT, metadata TEXT, revision INTEGER NOT NULL DEFAULT 0, last_operation TEXT);
CREATE TABLE IF NOT EXISTS gt_imports(id TEXT PRIMARY KEY, account TEXT NOT NULL, source_hash TEXT NOT NULL, root TEXT NOT NULL, parts INTEGER NOT NULL, trade_count INTEGER NOT NULL, snapshot_count INTEGER NOT NULL, has_history INTEGER NOT NULL, next_part INTEGER NOT NULL DEFAULT 0, chain TEXT NOT NULL DEFAULT '', token TEXT, status TEXT NOT NULL DEFAULT 'uploading', UNIQUE(account,source_hash));
CREATE TABLE IF NOT EXISTS gt_parts(generation TEXT NOT NULL, number INTEGER NOT NULL, hash TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(generation,number));
CREATE TABLE IF NOT EXISTS gt_trades(account TEXT NOT NULL, generation TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, date TEXT NOT NULL, ts REAL NOT NULL, tc TEXT NOT NULL, cur TEXT NOT NULL, signature TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(generation,id), UNIQUE(generation,ordinal));
CREATE INDEX IF NOT EXISTS gt_trade_date ON gt_trades(account,generation,date,ts,ordinal);
CREATE INDEX IF NOT EXISTS gt_trade_stock ON gt_trades(account,generation,tc,date,ts,ordinal);
CREATE TABLE IF NOT EXISTS gt_operations(account TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(account,id));
CREATE TABLE IF NOT EXISTS gt_jobs(id TEXT PRIMARY KEY, account TEXT NOT NULL, generation TEXT NOT NULL, date TEXT NOT NULL, revision INTEGER NOT NULL, previous_date TEXT, phase TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '', token TEXT, reason TEXT, UNIQUE(account,date));
CREATE TABLE IF NOT EXISTS gt_positions(job TEXT NOT NULL, tc TEXT NOT NULL, cur TEXT NOT NULL, payload TEXT NOT NULL, valuation TEXT, PRIMARY KEY(job,tc));
CREATE TABLE IF NOT EXISTS gt_daily(account TEXT NOT NULL, date TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account,date));
CREATE TABLE IF NOT EXISTS gt_archive(account TEXT NOT NULL, date TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account,date,revision));
CREATE TABLE IF NOT EXISTS gt_prices(date TEXT NOT NULL, tc TEXT NOT NULL, px REAL NOT NULL, finalized INTEGER NOT NULL, PRIMARY KEY(date,tc));
CREATE TABLE IF NOT EXISTS gt_rates(date TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gt_control(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gt_validation(generation TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, token TEXT);
