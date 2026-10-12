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

    const [stages, statuses] = await Promise.all([
      pool.query(`
    SELECT stage, COUNT(*)::int AS count
    FROM opportunities
    GROUP BY stage
  `),
      pool.query(`
    SELECT status, COUNT(*)::int AS count
    FROM leads
    GROUP BY status
  `),
    ]);

    const opportunities_by_stage = Object.fromEntries(
      stages.rows.map((row) => [row.stage, row.count]),
    );

    const leads_by_status = Object.fromEntries(
      statuses.rows.map((row) => [row.status, row.count]),
    );

    res.json({
      ...result.rows[0],
      opportunities_by_stage,
      leads_by_status,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to load dashboard" });
  }
});

module.exports = router;
