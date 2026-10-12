const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { z } = require("zod");

const router = express.Router();
router.use(authenticateToken);

const schema = z
  .object({
    customer_id: z.coerce.number().int().positive().nullable().optional(),
    lead_id: z.coerce.number().int().positive().nullable().optional(),
    followup_date: z.string().min(1),
    followup_type: z.enum(["Call", "Meeting", "Email", "Task"]),
    subject: z.string().min(2).max(150),
    remarks: z.string().max(1000).optional(),
    status: z
      .enum(["Planned", "Completed", "Missed", "Cancelled"])
      .default("Planned"),
  })
  .refine((data) => Boolean(data.customer_id || data.lead_id), {
    message: "Select a customer or lead",
  });

router.get("/", async (req, res) => {
  try {
    const values = [];
    let filter = "TRUE";

    if (req.user.role === "SalesExecutive") {
      values.push(req.user.id);
      filter += ` AND f.assigned_to = $1`;
    }

    const result = await pool.query(
      `SELECT f.*, c.name AS customer_name, l.name AS lead_name
       FROM followups f
       LEFT JOIN customers c ON c.id = f.customer_id
       LEFT JOIN leads l ON l.id = f.lead_id
       WHERE ${filter}
       ORDER BY f.followup_date ASC`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to fetch follow-ups" });
  }
});

router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const f = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO followups
       (customer_id, lead_id, followup_date, followup_type,
        subject, remarks, status, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        f.customer_id || null,
        f.lead_id || null,
        f.followup_date,
        f.followup_type,
        f.subject,
        f.remarks || null,
        f.status,
        req.user.id,
      ],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'followup', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      error: "Unable to create follow-up. Check the linked record ID.",
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

  const f = parsed.data;
  const values = [
    f.customer_id || null,
    f.lead_id || null,
    f.followup_date,
    f.followup_type,
    f.subject,
    f.remarks || null,
    f.status,
    Number(req.params.id),
  ];

  let query = `
    UPDATE followups SET customer_id=$1, lead_id=$2,
    followup_date=$3, followup_type=$4, subject=$5,
    remarks=$6, status=$7 WHERE id=$8
  `;

  if (req.user.role === "SalesExecutive") {
    values.push(req.user.id);
    query += " AND assigned_to=$9";
  }

  query += " RETURNING *";

  try {
    const result = await pool.query(query, values);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Follow-up not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'UPDATE', 'followup', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to update follow-up" });
  }
});

router.delete("/:id", async (req, res) => {
  if (!["Admin", "Manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM followups WHERE id=$1 RETURNING id",
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Follow-up not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'DELETE', 'followup', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.json({ message: "Follow-up deleted successfully" });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to delete follow-up" });
  }
});

module.exports = router;
