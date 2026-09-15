-- Tenants and their wrapped DEK (envelope encryption root)
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dek_wrapped TEXT NOT NULL,      -- base64(AES-GCM(KEK, dek) || iv), see src/lib/crypto.ts
  created_at INTEGER NOT NULL
);

CREATE TABLE tenant_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key_hash TEXT NOT NULL,         -- sha256(api_key), plaintext key is shown once at creation and never stored
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);

CREATE TABLE connected_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  platform TEXT NOT NULL,         -- 'bigmodel-cn' | 'feishu'
  label TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL, -- base64(AES-GCM(DEK, secret_json) || iv); secret_json shape is platform-specific
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_connected_accounts_tenant ON connected_accounts(tenant_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  ok INTEGER NOT NULL,            -- 0/1
  http_status INTEGER,
  platform_code TEXT,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at);
