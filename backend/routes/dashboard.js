const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticateToken, async (req, res) => {
  const isSalesExecutive = req.user.role === "SalesExecutive";
  const params = [req.user.id, isSalesExecutive];

  try {
    const result = await pool.query(
      `
      SELECT
        (SELECT COUNT(*) FROM customers
         WHERE ($2::boolean = FALSE OR owner_id = $1))
          AS total_customers,

        (SELECT COUNT(*) FROM leads
         WHERE ($2::boolean = FALSE OR assigned_to = $1))
          AS total_leads,

        (SELECT COUNT(*) FROM leads
         WHERE status NOT IN ('Lost', 'Converted', 'Unqualified')
         AND ($2::boolean = FALSE OR assigned_to = $1))
          AS open_leads,

        (SELECT COUNT(*) FROM opportunities
         WHERE ($2::boolean = FALSE OR assigned_to = $1))
          AS total_opportunities,

        (SELECT COUNT(*) FROM opportunities
         WHERE stage NOT IN ('Won', 'Lost')
         AND ($2::boolean = FALSE OR assigned_to = $1))
          AS open_opportunities,

        (SELECT COUNT(*) FROM opportunities
         WHERE stage = 'Won'
         AND ($2::boolean = FALSE OR assigned_to = $1))
          AS won_opportunities,

        (SELECT COUNT(*) FROM opportunities
         WHERE stage = 'Lost'
         AND ($2::boolean = FALSE OR assigned_to = $1))
          AS lost_opportunities,

        (SELECT COALESCE(SUM(amount), 0) FROM opportunities
         WHERE stage NOT IN ('Won', 'Lost')
         AND ($2::boolean = FALSE OR assigned_to = $1))
          AS pipeline_value
      `,
      params,
    );

    const [stages, statuses] = await Promise.all([
      pool.query(
        `SELECT stage, COUNT(*)::int AS count
         FROM opportunities
         WHERE ($2::boolean = FALSE OR assigned_to = $1)
         GROUP BY stage`,
        params,
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM leads
         WHERE ($2::boolean = FALSE OR assigned_to = $1)
         GROUP BY status`,
        params,
      ),
    ]);

    res.json({
      ...result.rows[0],
      opportunities_by_stage: Object.fromEntries(
        stages.rows.map((row) => [row.stage, row.count]),
      ),
      leads_by_status: Object.fromEntries(
        statuses.rows.map((row) => [row.status, row.count]),
      ),
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);
    res.status(500).json({ error: "Unable to load dashboard" });
  }
});

module.exports = router;
