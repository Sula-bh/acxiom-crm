BEGIN;

ALTER TABLE leads
  DROP COLUMN converted_customer_id,
  DROP COLUMN converted_opportunity_id;

COMMIT;
