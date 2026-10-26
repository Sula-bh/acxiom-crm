const { Pool } = require("pg");
const net = require("node:net");
require("dotenv").config();

const databaseIpFamily = Number(process.env.DATABASE_IP_FAMILY || 4);

if (![4, 6].includes(databaseIpFamily)) {
  throw new Error("DATABASE_IP_FAMILY must be 4 or 6");
}

class DatabaseSocket extends net.Socket {
  connect(port, host) {
    return super.connect({ port, host, family: databaseIpFamily });
  }
}

const ssl =
  process.env.NODE_ENV !== "production" && process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: true };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  stream: () => new DatabaseSocket(),
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err.message);
});

module.exports = pool;
