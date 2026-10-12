const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM leads) AS total_leads,
        (SELECT COUNT(*) FROM leads
          WHERE status NOT IN ('Lost', 'Converted', 'Unqualified')) AS open_leads,
        (SELECT COUNT(*) FROM opportunities) AS total_opportunities,
        (SELECT COUNT(*) FROM opportunities
          WHERE stage NOT IN ('Won', 'Lost')) AS open_opportunities,
        (SELECT COUNT(*) FROM opportunities
          WHERE stage = 'Won') AS won_opportunities,
        (SELECT COUNT(*) FROM opportunities
          WHERE stage = 'Lost') AS lost_opportunities,
        (SELECT COALESCE(SUM(amount), 0) FROM opportunities
          WHERE stage NOT IN ('Won', 'Lost')) AS pipeline_value
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to load dashboard" });
  }
});

module.exports = router;
