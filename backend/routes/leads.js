const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { z } = require("zod");

const router = express.Router();

router.use(authenticateToken);

// Validation
const optionalEmail = z
  .union([
    z.string().trim().email("Enter a valid email address"),
    z.literal(""),
  ])
  .optional();

const optionalPhone = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number"),
    z.literal(""),
  ])
  .optional();

const leadSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: optionalEmail,
  phone: optionalPhone,
  company_name: z.string().trim().max(150).optional(),
  source: z.string().trim().max(50).optional(),
  status: z
    .enum(["New", "Contacted", "Qualified", "Unqualified", "Converted", "Lost"])
    .default("New"),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  expected_value: z.coerce.number().finite().min(0).default(0),
});

// GET all leads with optional search
router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const values = [`%${search}%`];

    let filter = `
      (name ILIKE $1 OR email ILIKE $1 OR company_name ILIKE $1)
    `;

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filter += ` AND assigned_to = $2`;
    }

    const result = await pool.query(
      `SELECT * FROM leads
       WHERE ${filter}
       ORDER BY created_at DESC
       LIMIT 100`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch leads error:", error.message);
    res.status(500).json({ error: "Unable to fetch leads" });
  }
});

// GET a single lead
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM leads WHERE id = $1`, [
      req.params.id,
    ]);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const lead = result.rows[0];

    if (
      req.user.role === "SalesExecutive" &&
      Number(lead.assigned_to) !== Number(req.user.id)
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(lead);
  } catch (error) {
    console.error("Fetch lead error:", error.message);
    res.status(500).json({ error: "Unable to fetch lead" });
  }
});

// CREATE a lead
router.post("/", async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const client = await pool.connect();

  try {
    const lead = parsed.data;
    const leadCode = `LEAD-${Date.now()}`;

    await client.query("BEGIN");

    // New leads are assigned to the logged-in user.
    const result = await client.query(
      `INSERT INTO leads
       (lead_code, name, email, phone, company_name, source,
        status, priority, expected_value, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        leadCode,
        lead.name,
        lead.email || null,
        lead.phone || null,
        lead.company_name || null,
        lead.source || null,
        lead.status,
        lead.priority,
        lead.expected_value,
        req.user.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'lead', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");

    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create lead error:", error.message);
    res.status(500).json({ error: "Unable to create lead" });
  } finally {
    client.release();
  }
});

// UPDATE a lead
router.put("/:id", async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const client = await pool.connect();

  try {
    const lead = parsed.data;

    await client.query("BEGIN");

    let lookupQuery = `SELECT * FROM leads WHERE id = $1`;
    const lookupValues = [req.params.id];

    if (req.user.role === "SalesExecutive") {
      lookupValues.push(req.user.id);
      lookupQuery += ` AND assigned_to = $2`;
    }

    lookupQuery += " FOR UPDATE";

    const existing = await client.query(lookupQuery, lookupValues);

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lead not found" });
    }

    const result = await client.query(
      `UPDATE leads
       SET name = $1,
           email = $2,
           phone = $3,
           company_name = $4,
           source = $5,
           status = $6,
           priority = $7,
           expected_value = $8
       WHERE id = $9
       RETURNING *`,
      [
        lead.name,
        lead.email || null,
        lead.phone || null,
        lead.company_name || null,
        lead.source || null,
        lead.status,
        lead.priority,
        lead.expected_value,
        req.params.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id)
       VALUES ($1, 'UPDATE', 'lead', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");

    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update lead error:", error.message);
    res.status(500).json({ error: "Unable to update lead" });
  } finally {
    client.release();
  }
});

// DELETE a lead: Admin and Manager only
router.delete("/:id", async (req, res) => {
  if (!["Admin", "Manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `DELETE FROM leads WHERE id = $1 RETURNING id`,
      [req.params.id],
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lead not found" });
    }

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id)
       VALUES ($1, 'DELETE', 'lead', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");

    res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete lead error:", error.message);
    res.status(500).json({
      error: "Unable to delete lead. It may be linked to another record.",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
