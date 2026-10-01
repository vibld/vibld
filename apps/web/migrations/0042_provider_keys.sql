-- Model provider keys set from the admin panel (docs/decisions.md D127,
-- D131, D132).
--
-- One row per provider. The key itself is never stored: only its
-- AES-GCM encryption under VIBLD_KEY_ENCRYPTION_KEY, a Worker secret this
-- database never sees, with the provider bound in as associated data so a
-- row's ciphertext cannot be moved to another provider's row. `last4` is
-- the only part of the key anything shows.
--
-- A key here is used ahead of the Worker secret of the same name (D131);
-- removing it falls back to that secret.
CREATE TABLE provider_keys (
  provider TEXT PRIMARY KEY
    CHECK (provider IN ('anthropic', 'deepseek', 'openai')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
