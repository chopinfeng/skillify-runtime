-- Redacted request/response payloads per call — enables inspecting *what
-- arguments* a caller actually sent (not just whether the call succeeded),
-- both for the tenant's own observability and for grading the runtime-vs-
-- native-skill evals (see evals/PROTOCOL.md). Secrets are never part of
-- these — `input` is the caller's business arguments, `output` is
-- NormalizedResult.data; ctx.secret never flows into either.
ALTER TABLE audit_log ADD COLUMN input_json TEXT;
ALTER TABLE audit_log ADD COLUMN output_json TEXT;
