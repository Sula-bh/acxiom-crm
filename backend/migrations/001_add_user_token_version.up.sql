BEGIN;

ALTER TABLE users
  ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0
  CHECK (token_version >= 0);

COMMIT;
