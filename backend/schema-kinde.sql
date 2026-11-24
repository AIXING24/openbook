-- Apply together with schema-auth.sql. Only the configured backend can read these transactions.
CREATE TABLE IF NOT EXISTS gt_kinde_logins (binding_hash TEXT PRIMARY KEY, oauth_state TEXT NOT NULL UNIQUE, nonce TEXT NOT NULL, verifier TEXT NOT NULL, client_state TEXT NOT NULL, client_challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed TEXT);
CREATE INDEX IF NOT EXISTS gt_kinde_logins_expiry ON gt_kinde_logins(expires_at);
