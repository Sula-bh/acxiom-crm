const express = require("express");
const pool = require("../db");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

function pagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// Lead status/source report
router.get("/leads", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (req.query.status) {
      values.push(req.query.status);
      filters.push(`l.status = $${values.length}`);
    }

    if (req.query.source) {
      values.push(req.query.source);
      filters.push(`l.source = $${values.length}`);
    }

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filters.push(`l.assigned_to = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM leads l ${where}`,
      values,
    );

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT l.* FROM leads l ${where}
       ORDER BY l.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    res.json({
      data: result.rows,
      total: countResult.rows[0].total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Lead report error:", error.message);
    res.status(500).json({ error: "Unable to generate lead report" });
  }
});

// Follow-up status report, including overdue planned follow-ups
router.get("/followups", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (req.query.status) {
      values.push(req.query.status);
      filters.push(`f.status = $${values.length}`);
    }

    if (req.query.from_date) {
      values.push(req.query.from_date);
      filters.push(`f.followup_date >= $${values.length}::date`);
    }

    if (req.query.to_date) {
      values.push(req.query.to_date);
      filters.push(
        `f.followup_date < ($${values.length}::date + INTERVAL '1 day')`,
      );
    }

    if (req.query.overdue === "true") {
      filters.push(`f.status = 'Planned' AND f.followup_date < CURRENT_DATE`);
    }

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filters.push(`f.assigned_to = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM followups f ${where}`,
      values,
    );

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT f.*, c.name AS customer_name, l.name AS lead_name
       FROM followups f
       LEFT JOIN customers c ON c.id = f.customer_id
       LEFT JOIN leads l ON l.id = f.lead_id
       ${where}
       ORDER BY f.followup_date ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    res.json({
      data: result.rows,
      total: countResult.rows[0].total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Follow-up report error:", error.message);
    res.status(500).json({ error: "Unable to generate follow-up report" });
  }
});

// Opportunity pipeline grouped by stage and owner
router.get("/opportunities", async (req, res) => {
  try {
    const values = [];
    const filters = [];

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filters.push(`o.assigned_to = $${values.length}`);
    }

    if (req.query.stage) {
      values.push(req.query.stage);
      filters.push(`o.stage = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
      `SELECT o.stage,
              u.name AS owner_name,
              COUNT(*)::int AS opportunity_count,
              COALESCE(SUM(o.amount), 0) AS total_amount,
              COALESCE(SUM(
                CASE WHEN o.stage NOT IN ('Won', 'Lost')
                     THEN o.amount ELSE 0 END
              ), 0) AS pipeline_value
       FROM opportunities o
       LEFT JOIN users u ON u.id = o.assigned_to
       ${where}
       GROUP BY o.stage, u.name
       ORDER BY o.stage, u.name`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Opportunity report error:", error.message);
    res.status(500).json({ error: "Unable to generate opportunity report" });
  }
});

// Audit logs: Admin only
router.get("/audit-logs", authorizeRoles("Admin"), async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (req.query.action) {
      values.push(req.query.action);
      filters.push(`a.action = $${values.length}`);
    }

    if (req.query.entity_name) {
      values.push(req.query.entity_name);
      filters.push(`a.entity_name = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs a ${where}`,
      values,
    );

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );

    res.json({
      data: result.rows,
      total: countResult.rows[0].total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Audit report error:", error.message);
    res.status(500).json({ error: "Unable to generate audit report" });
  }
});

module.exports = router;
