-- Agent self-registration (see docs/plan.md discussion, 2026-09-18): an Agent
-- can register itself with no human email/password, the way Moltbook does —
-- but unlike Moltbook's launch, a tenant created this way is UNCLAIMED until
-- a real human attaches an email+password to it via POST /v1/auth/claim.
-- claimed_by_user_id is the sole "is this real" signal — any future public
-- stats or admin views must filter on it being non-null, so agent-registration
-- spam can never look like real usage the way Moltbook's numbers reportedly did.
ALTER TABLE tenants ADD COLUMN claimed_by_user_id TEXT REFERENCES users(id);

-- Per-IP rate limiting for the open registration endpoint. Stores only a
-- hash of the client IP (never the raw address), same pattern as every
-- other credential-shaped value in this schema.
CREATE TABLE registration_attempts (
  id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_registration_attempts_ip_time ON registration_attempts(ip_hash, created_at);
