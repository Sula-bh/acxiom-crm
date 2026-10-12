const { Pool } = require("pg");
require("dotenv").config();

const ssl =
  process.env.NODE_ENV !== "production" && process.env.DATABASE_SSL === "false"
    ? false
    : { rejectUnauthorized: true };

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err.message);
});

module.exports = pool;
