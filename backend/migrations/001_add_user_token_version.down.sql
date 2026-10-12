BEGIN;

ALTER TABLE users
  DROP COLUMN token_version;

COMMIT;
