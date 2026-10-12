const assert = require("node:assert/strict");
const Module = require("node:module");
const { after, before, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-only-secret";

const users = new Map([
  [7, { id: 7, name: "Owner", email: "owner@example.invalid", role: "SalesExecutive", is_active: true, token_version: 0 }],
  [9, { id: 9, name: "Admin", email: "admin@example.invalid", role: "Admin", is_active: true, token_version: 0 }],
]);
const reportQueries = [];

const pool = {
  async query(query, values = []) {
    if (query.includes("FROM users WHERE id = $1")) {
      const user = users.get(Number(values[0]));
      return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }

    reportQueries.push({ query, values });
    if (query.includes("COUNT(*)::int AS total")) {
      return { rows: [{ total: 42 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
};

const dbPath = require.resolve("../db");
const dbModule = new Module(dbPath);
dbModule.filename = dbPath;
dbModule.loaded = true;
dbModule.exports = pool;
require.cache[dbPath] = dbModule;

const reportRoutes = require("../routes/reports");
const app = express();
app.use("/api/reports", reportRoutes);

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

function token(userId) {
  const user = users.get(userId);
  return jwt.sign(
    { id: user.id, role: user.role, ver: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn: "5m" },
  );
}

function getReport(path, userId = 7) {
  return fetch(`${baseUrl}/api/reports${path}`, {
    headers: { Authorization: `Bearer ${token(userId)}` },
  });
}

test("sales report scope cannot be widened with another owner_id", async () => {
  reportQueries.length = 0;
  const response = await getReport(
    "/opportunities?owner_id=8&stage=Won&page=2&limit=30",
  );

  assert.equal(response.status, 200);
  assert.equal(reportQueries.length, 2);
  for (const { query, values } of reportQueries) {
    assert.match(query, /o\.assigned_to = \$1/);
    assert.match(query, /o\.stage = \$2/);
    assert.deepEqual(values.slice(0, 2), [7, "Won"]);
  }
  assert.deepEqual(reportQueries[1].values, [7, "Won", 30, 30]);
});

test("invalid report enums and dates are rejected before report queries", async () => {
  reportQueries.length = 0;

  const invalidStatus = await getReport("/customers?status=Active%20OR%201%3D1");
  assert.equal(invalidStatus.status, 400);
  assert.deepEqual(await invalidStatus.json(), { error: "Invalid status" });

  const invalidDate = await getReport(
    "/audit-logs?from_date=2024-02-30",
    9,
  );
  assert.equal(invalidDate.status, 400);
  assert.deepEqual(
    await invalidDate.json(),
    { error: "Invalid from_date; use YYYY-MM-DD" },
  );
  assert.equal(reportQueries.length, 0);
});

test("audit report is Admin-only and sort expressions are allow-listed", async () => {
  reportQueries.length = 0;

  const denied = await getReport("/audit-logs", 7);
  assert.equal(denied.status, 403);
  assert.equal(reportQueries.length, 0);

  const allowed = await getReport("/audit-logs?sort=created_at%20DESC", 9);
  assert.equal(allowed.status, 200);
  assert.equal(reportQueries.length, 2);
  assert.match(reportQueries[1].query, /ORDER BY a\.created_at DESC/);
  assert.doesNotMatch(reportQueries[1].query, /created_at DESC DESC/);
});
