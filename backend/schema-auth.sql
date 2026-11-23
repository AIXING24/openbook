-- Separate from mock ledger tables; no real identity is seeded by this file.
CREATE TABLE IF NOT EXISTS gt_auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gt_auth_identities (issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES gt_auth_users(id), PRIMARY KEY(issuer,subject));
CREATE TABLE IF NOT EXISTS gt_auth_handoffs (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES gt_auth_users(id), state TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, identity_expires_at INTEGER NOT NULL, consumed TEXT);
CREATE TABLE IF NOT EXISTS gt_auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES gt_auth_users(id), expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS gt_auth_handoffs_expiry ON gt_auth_handoffs(expires_at);
CREATE INDEX IF NOT EXISTS gt_auth_sessions_expiry ON gt_auth_sessions(expires_at);
