const assert = require("node:assert/strict");
const Module = require("node:module");
const { after, before, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-only-secret";

const user = {
  id: 1,
  name: "Test User",
  email: "test@example.invalid",
  role: "Admin",
  is_active: true,
  token_version: 0,
};
const auditEvents = [];
let failAuditInsert = false;
let transactionVersion;

const pool = {
  async query(query) {
    if (query.includes("FROM users WHERE id = $1")) {
      return { rows: [{ ...user }], rowCount: 1 };
    }
    throw new Error("Unexpected pool query in auth test");
  },
  async connect() {
    return {
      async query(query, values = []) {
        if (query === "BEGIN") {
          transactionVersion = user.token_version;
          return { rows: [], rowCount: null };
        }
        if (query === "COMMIT") return { rows: [], rowCount: null };
        if (query === "ROLLBACK") {
          user.token_version = transactionVersion;
          return { rows: [], rowCount: null };
        }
        if (query.includes("UPDATE users")) {
          user.token_version += 1;
          return { rows: [{ id: user.id }], rowCount: 1 };
        }
        if (query.includes("INSERT INTO audit_logs")) {
          if (failAuditInsert) throw new Error("Simulated audit failure");
          auditEvents.push({
            userId: values[0],
            action: "LOGOUT",
            ipAddress: values[1],
          });
          return { rows: [], rowCount: 1 };
        }
        throw new Error("Unexpected client query in auth test");
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

const authRoutes = require("../routes/auth");
const app = express();
app.use(express.json());
app.use("/api/auth", authRoutes);

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

function token(version = 0) {
  return jwt.sign(
    { id: user.id, role: user.role, ver: version },
    process.env.JWT_SECRET,
    { expiresIn: "5m" },
  );
}

function logout(tokenValue) {
  return fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenValue}` },
  });
}

test("logout revokes existing tokens and records the event", async () => {
  user.token_version = 0;
  user.is_active = true;
  auditEvents.length = 0;

  const bearer = token();
  const response = await logout(bearer);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "Logged out successfully",
  });
  assert.equal(user.token_version, 1);
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "LOGOUT");

  const replay = await logout(bearer);
  assert.equal(replay.status, 401);
});

test("failed logout audit rolls back token revocation", async () => {
  user.token_version = 0;
  user.is_active = true;
  failAuditInsert = true;

  try {
    const response = await logout(token());
    assert.equal(response.status, 500);
    assert.equal(user.token_version, 0);
  } finally {
    failAuditInsert = false;
  }
});
