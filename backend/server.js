const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT current_database() AS database");

    res.json({ status: "ok", ...result.rows[0] });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.listen(3001, () => {
  console.log("Server running at http://localhost:5000");
});
