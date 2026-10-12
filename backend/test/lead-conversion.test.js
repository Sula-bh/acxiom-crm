const assert = require("node:assert/strict");
const Module = require("node:module");
const { after, before, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-only-secret";

const users = new Map([
  [7, { id: 7, name: "Owner", email: "owner@example.invalid", role: "SalesExecutive", is_active: true, token_version: 0 }],
  [8, { id: 8, name: "Other", email: "other@example.invalid", role: "SalesExecutive", is_active: true, token_version: 0 }],
  [9, { id: 9, name: "Admin", email: "admin@example.invalid", role: "Admin", is_active: true, token_version: 0 }],
]);
let lead;
let customers;
let opportunities;
let auditEvents;
let failAuditInsert = false;
let transactionSnapshot;

function resetData(status = "Qualified") {
  lead = {
    id: 4,
    lead_code: "LEAD-1234",
    name: "Acme Contact",
    email: "contact@example.invalid",
    phone: "+12345678901",
    company_name: "Acme",
    status,
    priority: "High",
    expected_value: "1250.00",
    assigned_to: 7,
    converted_customer_id: null,
    converted_opportunity_id: null,
  };
  customers = [];
  opportunities = [];
  auditEvents = [];
  failAuditInsert = false;
}

const pool = {
  async query(query, values) {
    if (query.includes("FROM users WHERE id = $1")) {
      const user = users.get(Number(values[0]));
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }
    throw new Error("Unexpected pool query in lead conversion test");
  },
  async connect() {
    return {
      async query(query, values = []) {
        if (query === "BEGIN") {
          transactionSnapshot = structuredClone({
            lead,
            customers,
            opportunities,
            auditEvents,
          });
          return { rows: [], rowCount: null };
        }
        if (query === "COMMIT") return { rows: [], rowCount: null };
        if (query === "ROLLBACK") {
          lead = transactionSnapshot.lead;
          customers = transactionSnapshot.customers;
          opportunities = transactionSnapshot.opportunities;
          auditEvents = transactionSnapshot.auditEvents;
          return { rows: [], rowCount: null };
        }
        if (query.includes("SELECT * FROM leads WHERE id = $1 FOR UPDATE")) {
          return {
            rows: Number(values[0]) === lead.id ? [{ ...lead }] : [],
            rowCount: Number(values[0]) === lead.id ? 1 : 0,
          };
        }
        if (query.includes("SELECT * FROM customers WHERE id = $1")) {
          const record = customers.find((item) => item.id === Number(values[0]));
          return { rows: record ? [{ ...record }] : [], rowCount: record ? 1 : 0 };
        }
        if (query.includes("SELECT * FROM opportunities WHERE id = $1")) {
          const record = opportunities.find((item) => item.id === Number(values[0]));
          return { rows: record ? [{ ...record }] : [], rowCount: record ? 1 : 0 };
        }
        if (query.includes("INSERT INTO customers")) {
          const record = {
            id: customers.length + 21,
            customer_code: values[0],
            name: values[1],
            email: values[2],
            phone: values[3],
            company_name: values[4],
            status: "Active",
            owner_id: values[5],
            created_by: values[6],
          };
          customers.push(record);
          return { rows: [{ ...record }], rowCount: 1 };
        }
        if (query.includes("INSERT INTO opportunities")) {
          const record = {
            id: opportunities.length + 31,
            name: values[0],
            customer_id: values[1],
            lead_id: values[2],
            amount: values[3],
            stage: "Qualification",
            probability: values[4],
            expected_close_date: values[5],
            assigned_to: values[6],
          };
          opportunities.push(record);
          return { rows: [{ ...record }], rowCount: 1 };
        }
        if (query.includes("UPDATE leads")) {
          lead = {
            ...lead,
            status: "Converted",
            converted_customer_id: values[0],
            converted_opportunity_id: values[1],
          };
          return { rows: [{ ...lead }], rowCount: 1 };
        }
        if (query.includes("INSERT INTO audit_logs")) {
          if (failAuditInsert) throw new Error("Simulated audit failure");
          auditEvents.push({
            userId: values[0],
            action: "CONVERT",
            leadId: values[1],
            oldValue: JSON.parse(values[2]),
            newValue: JSON.parse(values[3]),
            ipAddress: values[4],
          });
          return { rows: [], rowCount: 1 };
        }
        throw new Error("Unexpected client query in lead conversion test");
      },
      release() {},
    };
  },
};

const dbPath = require.resolve("../db");
const dbModule = new Module(dbPath);
dbModule.filename = dbPath;
dbModule.loaded = true;
dbModule.exports = pool;
require.cache[dbPath] = dbModule;

const leadRoutes = require("../routes/leads");
const app = express();
app.use(express.json());
app.use("/api/leads", leadRoutes);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function token(userId = 7) {
  const user = users.get(userId);
  return jwt.sign(
    { id: user.id, role: user.role, ver: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn: "5m" },
  );
}

function convert(body = {}, userId = 7) {
  return fetch(`${baseUrl}/api/leads/${lead.id}/convert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token(userId)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createLead(body, userId = 7) {
  return fetch(`${baseUrl}/api/leads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token(userId)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("qualified lead conversion creates linked records and retries idempotently", async () => {
  resetData();
  const closeDate = new Date();
  closeDate.setUTCDate(closeDate.getUTCDate() + 10);
  const body = {
    createOpportunity: true,
    expectedCloseDate: closeDate.toISOString().slice(0, 10),
  };

  const first = await convert(body);
  assert.equal(first.status, 201);
  const firstResult = await first.json();
  assert.equal(firstResult.lead.status, "Converted");
  assert.equal(firstResult.customer.owner_id, lead.assigned_to);
  assert.equal(firstResult.opportunity.customer_id, firstResult.customer.id);
  assert.equal(firstResult.opportunity.lead_id, lead.id);
  assert.equal(firstResult.alreadyConverted, false);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "CONVERT");
  assert.deepEqual(auditEvents[0].oldValue, { status: "Qualified" });

  const repeated = await convert(body);
  assert.equal(repeated.status, 200);
  const repeatedResult = await repeated.json();
  assert.equal(repeatedResult.alreadyConverted, true);
  assert.equal(repeatedResult.customer.id, firstResult.customer.id);
  assert.equal(repeatedResult.opportunity.id, firstResult.opportunity.id);
  assert.equal(customers.length, 1);
  assert.equal(opportunities.length, 1);
  assert.equal(auditEvents.length, 1);
});

test("conversion rejects unqualified leads and missing contact fields", async () => {
  resetData("New");
  const invalidStatus = await convert();
  assert.equal(invalidStatus.status, 409);
  assert.equal(customers.length, 0);

  resetData();
  lead.email = null;
  const missingEmail = await convert();
  assert.equal(missingEmail.status, 400);
  assert.equal(customers.length, 0);
});

test("clients cannot create a lead directly in the converted status", async () => {
  resetData();
  const response = await createLead({
    name: "New lead",
    status: "Converted",
  });
  assert.equal(response.status, 400);
});

test("Sales Executives cannot convert another user's lead", async () => {
  resetData();
  const response = await convert({}, 8);
  assert.equal(response.status, 403);
  assert.equal(customers.length, 0);
  assert.equal(lead.status, "Qualified");
});

test("conversion transaction rolls back records when audit insertion fails", async () => {
  resetData();
  failAuditInsert = true;

  try {
    const response = await convert();
    assert.equal(response.status, 500);
    assert.equal(customers.length, 0);
    assert.equal(opportunities.length, 0);
    assert.equal(lead.status, "Qualified");
  } finally {
    failAuditInsert = false;
  }
});
