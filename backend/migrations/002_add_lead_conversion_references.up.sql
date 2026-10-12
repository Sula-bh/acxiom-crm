BEGIN;

ALTER TABLE leads
  ADD COLUMN converted_customer_id INTEGER
    REFERENCES customers(id),
  ADD COLUMN converted_opportunity_id INTEGER
    REFERENCES opportunities(id),
  ADD CONSTRAINT leads_converted_customer_id_key
    UNIQUE (converted_customer_id),
  ADD CONSTRAINT leads_converted_opportunity_id_key
    UNIQUE (converted_opportunity_id);

COMMIT;
