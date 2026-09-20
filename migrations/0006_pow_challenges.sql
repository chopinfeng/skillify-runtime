-- Proof-of-work gate in front of agent self-registration (2026-09-20). Per-IP
-- rate limiting (0005) is weak against a botnet rotating source IPs; PoW
-- imposes a real compute cost per registration attempt regardless of which
-- IP it comes from, mirroring the pattern industry precedents (Atomic Mail,
-- MoltID) use to make bulk disposable agent registration expensive rather
-- than free. Complements, doesn't replace, the existing IP rate limit.
CREATE TABLE pow_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  difficulty_bits INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE UNIQUE INDEX idx_pow_challenges_challenge ON pow_challenges(challenge);
