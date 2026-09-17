-- Links a user to one or more external identity providers (Google now,
-- room for more later without another migration). A user row's own
-- password_hash stays required (SQLite can't cheaply drop a NOT NULL
-- constraint) — a Google-only signup gets an unusable random placeholder
-- hash instead of a nullable column; see lib/oauth.ts.
CREATE TABLE oauth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_oauth_identities_provider_user ON oauth_identities(provider, provider_user_id);
CREATE INDEX idx_oauth_identities_user ON oauth_identities(user_id);
