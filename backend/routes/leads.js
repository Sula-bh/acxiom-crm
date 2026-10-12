const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { z } = require("zod");

const router = express.Router();
router.use(authenticateToken);

const leadSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/)
    .optional()
    .or(z.literal("")),
  company_name: z.string().max(150).optional(),
  source: z.string().max(50).optional(),
  status: z
    .enum(["New", "Contacted", "Qualified", "Unqualified", "Converted", "Lost"])
    .default("New"),
  priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
  expected_value: z.coerce.number().min(0).default(0),
});

router.get("/", async (req, res) => {
  try {
    const { search = "" } = req.query;
    const values = [`%${search}%`];
    let filter = `
      (name ILIKE $1 OR email ILIKE $1 OR company_name ILIKE $1)
    `;

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filter += ` AND assigned_to = $2`;
    }

    const result = await pool.query(
      `SELECT * FROM leads WHERE ${filter} ORDER BY created_at DESC`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to fetch leads" });
  }
});

router.post("/", async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  try {
    const lead = parsed.data;
    const leadCode = `LEAD-${Date.now()}`;
    const result = await pool.query(
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

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'lead', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to create lead" });
  }
});

router.put("/:id", async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  try {
    const lead = parsed.data;
    const values = [
      lead.name,
      lead.email || null,
      lead.phone || null,
      lead.company_name || null,
      lead.source || null,
      lead.status,
      lead.priority,
      lead.expected_value,
      Number(req.params.id),
    ];

    let query = `
      UPDATE leads SET name=$1, email=$2, phone=$3,
      company_name=$4, source=$5, status=$6, priority=$7,
      expected_value=$8
      WHERE id=$9
    `;

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      query += ` AND assigned_to=$10`;
    }

    query += " RETURNING *";

    const result = await pool.query(query, values);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Lead not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'UPDATE', 'lead', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to update lead" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!["Admin", "Manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM leads WHERE id=$1 RETURNING id",
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Lead not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'DELETE', 'lead', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Unable to delete lead. It may be linked to another record.",
    });
  }
});

module.exports = router;
