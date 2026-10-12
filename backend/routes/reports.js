const express = require("express");
const pool = require("../db");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

function pagination(query) {
  const page = Math.min(1000000, Math.max(1, parseInt(query.page, 10) || 1));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function isDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function addDateFilters(req, res, filters, values, column) {
  for (const key of ["from_date", "to_date"]) {
    const value = req.query[key];
    if (value === undefined) continue;
    if (!isDateOnly(value)) {
      res.status(400).json({ error: `Invalid ${key}; use YYYY-MM-DD` });
      return false;
    }

    values.push(value);
    const parameter = `$${values.length}::date`;
    filters.push(
      key === "from_date"
        ? `${column} >= ${parameter}`
        : `${column} < (${parameter} + INTERVAL '1 day')`,
    );
  }
  return true;
}

function addOwnerFilter(req, res, filters, values, column) {
  if (req.user.role === "SalesExecutive") {
    values.push(req.user.id);
    filters.push(`${column} = $${values.length}`);
    return true;
  }

  if (req.query.owner_id === undefined) return true;
  const ownerId = Number(req.query.owner_id);
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    res.status(400).json({ error: "Invalid owner_id" });
    return false;
  }
  values.push(ownerId);
  filters.push(`${column} = $${values.length}`);
  return true;
}

function addExactFilter(req, res, filters, values, queryKey, column) {
  const value = req.query[queryKey];
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || value.length > 100) {
    res.status(400).json({ error: `Invalid ${queryKey}` });
    return false;
  }
  values.push(value);
  filters.push(`${column} = $${values.length}`);
  return true;
}

function addEnumFilter(req, res, filters, values, queryKey, column, allowed) {
  const value = req.query[queryKey];
  if (value === undefined || value === "") return true;
  if (typeof value !== "string" || !allowed.includes(value)) {
    res.status(400).json({ error: `Invalid ${queryKey}` });
    return false;
  }
  values.push(value);
  filters.push(`${column} = $${values.length}`);
  return true;
}

function addIdFilter(req, res, filters, values, queryKey, column) {
  const value = req.query[queryKey];
  if (value === undefined || value === "") return true;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: `Invalid ${queryKey}` });
    return false;
  }
  values.push(id);
  filters.push(`${column} = $${values.length}`);
  return true;
}

function reportOrder(query, columns, fallback) {
  const column =
    Object.prototype.hasOwnProperty.call(columns, query.sort) && columns[query.sort]
      ? columns[query.sort]
      : fallback;
  const direction = query.direction === "asc" ? "ASC" : "DESC";
  return `${column} ${direction}`;
}

// Customer report
router.get("/customers", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (!addOwnerFilter(req, res, filters, values, "c.owner_id")) return;
    if (
      !addEnumFilter(req, res, filters, values, "status", "c.status", [
        "Active",
        "Inactive",
      ])
    ) {
      return;
    }
    if (!addDateFilters(req, res, filters, values, "c.created_at")) return;

    if (req.query.search !== undefined) {
      if (typeof req.query.search !== "string") {
        return res.status(400).json({ error: "Invalid search" });
      }
      values.push(`%${req.query.search.trim().slice(0, 100)}%`);
      filters.push(
        `(c.name ILIKE $${values.length} OR c.email ILIKE $${values.length}
          OR c.phone ILIKE $${values.length} OR c.company_name ILIKE $${values.length})`,
      );
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM customers c ${where}`,
      values,
    );
    values.push(limit, offset);
    const result = await pool.query(
      `SELECT c.id, c.customer_code, c.name, c.email, c.phone,
              c.company_name, c.status, c.owner_id, u.name AS owner_name,
              c.created_at
       FROM customers c
       LEFT JOIN users u ON u.id = c.owner_id
       ${where}
       ORDER BY ${reportOrder(req.query, {
         name: "c.name",
         status: "c.status",
         created_at: "c.created_at",
       }, "c.created_at")}
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
    console.error("Customer report error:", error.message);
    res.status(500).json({ error: "Unable to generate customer report" });
  }
});

// Lead status/source report
router.get("/leads", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (
      !addEnumFilter(req, res, filters, values, "status", "l.status", [
        "New",
        "Contacted",
        "Qualified",
        "Unqualified",
        "Converted",
        "Lost",
      ])
    ) {
      return;
    }
    if (!addExactFilter(req, res, filters, values, "source", "l.source")) return;
    if (!addOwnerFilter(req, res, filters, values, "l.assigned_to")) return;
    if (!addDateFilters(req, res, filters, values, "l.created_at")) return;

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM leads l ${where}`,
      values,
    );

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT l.*, u.name AS owner_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       ${where}
       ORDER BY ${reportOrder(req.query, {
         created_at: "l.created_at",
         name: "l.name",
         status: "l.status",
         source: "l.source",
       }, "l.created_at")}
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

// Lead conversion summary by source and owner
router.get("/conversions", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (!addOwnerFilter(req, res, filters, values, "l.assigned_to")) return;
    if (!addExactFilter(req, res, filters, values, "source", "l.source")) return;
    if (!addDateFilters(req, res, filters, values, "l.created_at")) return;
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM (
         SELECT l.source, l.assigned_to
         FROM leads l
         ${where}
         GROUP BY l.source, l.assigned_to
       ) grouped`,
      values,
    );
    values.push(limit, offset);
    const result = await pool.query(
      `SELECT COALESCE(l.source, 'Unknown') AS source,
              l.assigned_to AS owner_id,
              u.name AS owner_name,
              COUNT(*)::int AS lead_count,
              COUNT(*) FILTER (WHERE l.status = 'Converted')::int AS converted_count,
              ROUND(
                100.0 * COUNT(*) FILTER (WHERE l.status = 'Converted')
                / NULLIF(COUNT(*), 0),
                2
              ) AS conversion_rate
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       ${where}
       GROUP BY l.source, l.assigned_to, u.name
       ORDER BY source, owner_name
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
    console.error("Conversion report error:", error.message);
    res.status(500).json({ error: "Unable to generate conversion report" });
  }
});

// Follow-up status report, including overdue planned follow-ups
router.get("/followups", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (
      !addEnumFilter(req, res, filters, values, "status", "f.status", [
        "Planned",
        "Completed",
        "Missed",
        "Cancelled",
      ])
    ) {
      return;
    }

    if (!addDateFilters(req, res, filters, values, "f.followup_date")) return;

    if (
      req.query.overdue !== undefined &&
      req.query.overdue !== "true" &&
      req.query.overdue !== "false"
    ) {
      return res.status(400).json({ error: "Invalid overdue; use true or false" });
    }

    if (req.query.overdue === "true") {
      filters.push(`f.status = 'Planned' AND f.followup_date < CURRENT_DATE`);
    }

    if (!addOwnerFilter(req, res, filters, values, "f.assigned_to")) return;

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM followups f ${where}`,
      values,
    );

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT f.*, c.name AS customer_name, l.name AS lead_name,
              u.name AS owner_name
       FROM followups f
       LEFT JOIN customers c ON c.id = f.customer_id
       LEFT JOIN leads l ON l.id = f.lead_id
       LEFT JOIN users u ON u.id = f.assigned_to
       ${where}
       ORDER BY ${reportOrder(req.query, {
         followup_date: "f.followup_date",
         status: "f.status",
       }, "f.followup_date")}
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

// Detailed opportunity report
router.get("/opportunity-details", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (!addOwnerFilter(req, res, filters, values, "o.assigned_to")) return;
    if (
      !addEnumFilter(req, res, filters, values, "stage", "o.stage", [
        "Qualification",
        "Proposal",
        "Negotiation",
        "Won",
        "Lost",
      ])
    ) {
      return;
    }
    if (
      !addDateFilters(req, res, filters, values, "o.expected_close_date")
    ) {
      return;
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM opportunities o ${where}`,
      values,
    );
    values.push(limit, offset);
    const result = await pool.query(
      `SELECT o.id, o.name, o.customer_id, c.name AS customer_name,
              o.lead_id, l.name AS lead_name, o.amount, o.stage,
              o.probability, o.expected_close_date,
              o.assigned_to AS owner_id, u.name AS owner_name
       FROM opportunities o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN leads l ON l.id = o.lead_id
       LEFT JOIN users u ON u.id = o.assigned_to
       ${where}
       ORDER BY ${reportOrder(req.query, {
         name: "o.name",
         stage: "o.stage",
         amount: "o.amount",
         expected_close_date: "o.expected_close_date",
       }, "o.expected_close_date")}
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
    console.error("Opportunity detail report error:", error.message);
    res.status(500).json({ error: "Unable to generate opportunity report" });
  }
});

// Opportunity pipeline grouped by stage and owner
router.get("/opportunities", async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (!addOwnerFilter(req, res, filters, values, "o.assigned_to")) return;
    if (
      !addEnumFilter(req, res, filters, values, "stage", "o.stage", [
        "Qualification",
        "Proposal",
        "Negotiation",
        "Won",
        "Lost",
      ])
    ) {
      return;
    }
    if (!addDateFilters(req, res, filters, values, "o.created_at")) return;

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM (
         SELECT o.stage, o.assigned_to
         FROM opportunities o
         LEFT JOIN users u ON u.id = o.assigned_to
         ${where}
         GROUP BY o.stage, o.assigned_to
       ) grouped`,
      values,
    );
    values.push(limit, offset);

    const result = await pool.query(
      `SELECT o.stage,
              o.assigned_to AS owner_id,
              u.name AS owner_name,
              COUNT(*)::int AS opportunity_count,
              COALESCE(SUM(o.amount), 0) AS total_amount,
              COALESCE(SUM(
                CASE WHEN o.stage NOT IN ('Won', 'Lost')
                     THEN o.amount ELSE 0 END
              ), 0) AS pipeline_value,
              COALESCE(SUM(
                CASE WHEN o.stage NOT IN ('Won', 'Lost')
                     THEN o.amount * o.probability / 100 ELSE 0 END
              ), 0) AS weighted_pipeline_value
       FROM opportunities o
       LEFT JOIN users u ON u.id = o.assigned_to
       ${where}
       GROUP BY o.stage, o.assigned_to, u.name
       ORDER BY o.stage, u.name, o.assigned_to
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
    console.error("Opportunity report error:", error.message);
    res.status(500).json({ error: "Unable to generate opportunity report" });
  }
});

// User activity summary; detailed audit records remain Admin-only.
router.get("/user-activity", authorizeRoles("Admin"), async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (!addIdFilter(req, res, filters, values, "user_id", "a.user_id")) {
      return;
    }
    if (!addDateFilters(req, res, filters, values, "a.created_at")) return;
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM (
         SELECT a.user_id
         FROM audit_logs a
         ${where}
         GROUP BY a.user_id
       ) grouped`,
      values,
    );
    values.push(limit, offset);
    const result = await pool.query(
      `SELECT a.user_id, u.name AS user_name,
              COUNT(*)::int AS action_count,
              MAX(a.created_at) AS last_activity
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where}
       GROUP BY a.user_id, u.name
       ORDER BY action_count DESC, user_name
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
    console.error("User activity report error:", error.message);
    res.status(500).json({ error: "Unable to generate user activity report" });
  }
});

// Audit logs: Admin only
router.get("/audit-logs", authorizeRoles("Admin"), async (req, res) => {
  try {
    const { page, limit, offset } = pagination(req.query);
    const values = [];
    const filters = [];

    if (!addExactFilter(req, res, filters, values, "action", "a.action")) return;
    if (
      !addExactFilter(
        req,
        res,
        filters,
        values,
        "entity_name",
        "a.entity_name",
      )
    ) {
      return;
    }
    if (!addIdFilter(req, res, filters, values, "user_id", "a.user_id")) {
      return;
    }
    if (!addDateFilters(req, res, filters, values, "a.created_at")) return;

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
         ORDER BY ${reportOrder(req.query, {
           created_at: "a.created_at",
           action: "a.action",
           entity_name: "a.entity_name",
         }, "a.created_at")}
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
