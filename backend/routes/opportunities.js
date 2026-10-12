const express = require("express");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");
const { z } = require("zod");

const router = express.Router();
router.use(authenticateToken);

const schema = z
  .object({
    name: z.string().trim().min(2).max(150),
    customer_id: z.coerce.number().int().positive().nullable().optional(),
    lead_id: z.coerce.number().int().positive().nullable().optional(),
    amount: z.coerce.number().finite().positive(),
    stage: z
      .enum(["Qualification", "Proposal", "Negotiation", "Won", "Lost"])
      .default("Qualification"),
    probability: z.coerce.number().finite().min(0).max(100).default(10),
    expected_close_date: z
      .union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
        z.literal(""),
      ])
      .optional(),
  })
  .refine((data) => data.customer_id || data.lead_id, {
    message: "Select a customer or lead",
  })
  .refine(
    (data) => {
      if (!data.expected_close_date || ["Won", "Lost"].includes(data.stage)) {
        return true;
      }

      const date = new Date(`${data.expected_close_date}T00:00:00Z`);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      return !Number.isNaN(date.getTime()) && date >= today;
    },
    {
      message:
        "Expected close date cannot be in the past for an active opportunity",
      path: ["expected_close_date"],
    },
  );

function isSalesExecutive(req) {
  return req.user.role === "SalesExecutive";
}

// Validate linked records and their access.
async function validateLinks(client, opportunity, user) {
  if (opportunity.customer_id) {
    let query = "SELECT id FROM customers WHERE id = $1";
    const values = [opportunity.customer_id];

    if (isSalesExecutive({ user })) {
      values.push(user.id);
      query += " AND owner_id = $2";
    }

    const result = await client.query(query, values);

    if (!result.rowCount) {
      return "Customer not found or access denied";
    }
  }

  if (opportunity.lead_id) {
    let query = "SELECT id FROM leads WHERE id = $1";
    const values = [opportunity.lead_id];

    if (isSalesExecutive({ user })) {
      values.push(user.id);
      query += " AND assigned_to = $2";
    }

    const result = await client.query(query, values);

    if (!result.rowCount) {
      return "Lead not found or access denied";
    }
  }

  return null;
}

// GET opportunities
router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const values = [`%${search}%`];

    let filter = "o.name ILIKE $1";

    if (isSalesExecutive(req)) {
      values.push(req.user.id);
      filter += " AND o.assigned_to = $2";
    }

    const result = await pool.query(
      `SELECT o.*, c.name AS customer_name, l.name AS lead_name
       FROM opportunities o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN leads l ON l.id = o.lead_id
       WHERE ${filter}
       ORDER BY o.created_at DESC
       LIMIT 100`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch opportunities error:", error.message);
    res.status(500).json({ error: "Unable to fetch opportunities" });
  }
});

// GET one opportunity
router.get("/:id", async (req, res) => {
  try {
    let query = `
      SELECT o.*, c.name AS customer_name, l.name AS lead_name
      FROM opportunities o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN leads l ON l.id = o.lead_id
      WHERE o.id = $1
    `;
    const values = [req.params.id];

    if (isSalesExecutive(req)) {
      values.push(req.user.id);
      query += " AND o.assigned_to = $2";
    }

    const result = await pool.query(query, values);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Opportunity not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Fetch opportunity error:", error.message);
    res.status(500).json({ error: "Unable to fetch opportunity" });
  }
});

// CREATE opportunity
router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const opportunity = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const linkError = await validateLinks(client, opportunity, req.user);

    if (linkError) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: linkError });
    }

    const result = await client.query(
      `INSERT INTO opportunities
       (name, customer_id, lead_id, amount, stage, probability,
        expected_close_date, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        opportunity.name,
        opportunity.customer_id || null,
        opportunity.lead_id || null,
        opportunity.amount,
        opportunity.stage,
        opportunity.probability,
        opportunity.expected_close_date || null,
        req.user.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'opportunity', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create opportunity error:", error.message);
    res.status(500).json({
      error: "Unable to create opportunity",
    });
  } finally {
    client.release();
  }
});

// UPDATE opportunity
router.put("/:id", async (req, res) => {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const opportunity = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let lookup = "SELECT * FROM opportunities WHERE id = $1";
    const lookupValues = [req.params.id];

    if (isSalesExecutive(req)) {
      lookupValues.push(req.user.id);
      lookup += " AND assigned_to = $2";
    }

    lookup += " FOR UPDATE";

    const existing = await client.query(lookup, lookupValues);

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    const linkError = await validateLinks(client, opportunity, req.user);

    if (linkError) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: linkError });
    }

    const result = await client.query(
      `UPDATE opportunities
       SET name = $1,
           customer_id = $2,
           lead_id = $3,
           amount = $4,
           stage = $5,
           probability = $6,
           expected_close_date = $7
       WHERE id = $8
       RETURNING *`,
      [
        opportunity.name,
        opportunity.customer_id || null,
        opportunity.lead_id || null,
        opportunity.amount,
        opportunity.stage,
        opportunity.probability,
        opportunity.expected_close_date || null,
        req.params.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'UPDATE', 'opportunity', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update opportunity error:", error.message);
    res.status(500).json({ error: "Unable to update opportunity" });
  } finally {
    client.release();
  }
});

// DELETE opportunity: Admin and Manager only
router.delete("/:id", async (req, res) => {
  if (!["Admin", "Manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "DELETE FROM opportunities WHERE id = $1 RETURNING id",
      [req.params.id],
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Opportunity not found" });
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'DELETE', 'opportunity', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");
    res.json({ message: "Opportunity deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete opportunity error:", error.message);
    res.status(500).json({
      error:
        "Unable to delete opportunity. It may be linked to another record.",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
