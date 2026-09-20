-- deleteExpiredPowChallenges() (src/db.ts) runs a DELETE ... WHERE expires_at < ?
-- on every GET /v1/auth/pow-challenge call to keep that free, unauthenticated
-- endpoint from growing the table without bound. Index the column it scans.
CREATE INDEX idx_pow_challenges_expires ON pow_challenges(expires_at);
