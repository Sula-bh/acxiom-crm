const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { z } = require("zod");

const router = express.Router();
router.use(authenticateToken);

const schema = z
  .object({
    name: z.string().min(2).max(150),
    customer_id: z.coerce.number().int().positive().nullable().optional(),
    lead_id: z.coerce.number().int().positive().nullable().optional(),
    amount: z.coerce.number().positive(),
    stage: z
      .enum(["Qualification", "Proposal", "Negotiation", "Won", "Lost"])
      .default("Qualification"),
    probability: z.coerce.number().min(0).max(100).default(10),
    expected_close_date: z.string().optional().or(z.literal("")),
  })
  .refine((data) => data.customer_id || data.lead_id, {
    message: "Select a customer or lead",
  });

router.get("/", async (req, res) => {
  try {
    const { search = "" } = req.query;
    const values = [`%${search}%`];

    let filter = "o.name ILIKE $1";
    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filter += ` AND o.assigned_to = $2`;
    }

    const result = await pool.query(
      `SELECT o.*, c.name AS customer_name, l.name AS lead_name
       FROM opportunities o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN leads l ON l.id = o.lead_id
       WHERE ${filter}
       ORDER BY o.created_at DESC`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to fetch opportunities" });
  }
});

router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const o = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO opportunities
       (name, customer_id, lead_id, amount, stage, probability,
        expected_close_date, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        o.name,
        o.customer_id || null,
        o.lead_id || null,
        o.amount,
        o.stage,
        o.probability,
        o.expected_close_date || null,
        req.user.id,
      ],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'opportunity', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Unable to create opportunity. Check linked customer or lead IDs.",
    });
  }
});

router.put("/:id", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const o = parsed.data;
  const values = [
    o.name,
    o.customer_id || null,
    o.lead_id || null,
    o.amount,
    o.stage,
    o.probability,
    o.expected_close_date || null,
    Number(req.params.id),
  ];

  let query = `
    UPDATE opportunities SET name=$1, customer_id=$2, lead_id=$3,
    amount=$4, stage=$5, probability=$6, expected_close_date=$7
    WHERE id=$8
  `;

  if (req.user.role === "SalesExecutive") {
    values.push(req.user.id);
    query += " AND assigned_to=$9";
  }

  query += " RETURNING *";

  try {
    const result = await pool.query(query, values);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'UPDATE', 'opportunity', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to update opportunity" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!["Admin", "Manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM opportunities WHERE id=$1 RETURNING id",
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'DELETE', 'opportunity', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.json({ message: "Opportunity deleted successfully" });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to delete opportunity" });
  }
});

module.exports = router;
