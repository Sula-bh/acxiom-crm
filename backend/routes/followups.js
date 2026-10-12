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
    subject: z.string().trim().min(2).max(150),
    remarks: z.string().trim().max(1000).optional(),
    status: z
      .enum(["Planned", "Completed", "Missed", "Cancelled"])
      .default("Planned"),
  })
  .refine((data) => Boolean(data.customer_id || data.lead_id), {
    message: "Select a customer or lead",
  })
  .refine(
    (data) => {
      if (data.status !== "Planned") return true;

      const date = new Date(data.followup_date);
      if (Number.isNaN(date.getTime())) return false;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const followupDay = new Date(date);
      followupDay.setHours(0, 0, 0, 0);

      return followupDay >= today;
    },
    {
      message: "A planned follow-up cannot be scheduled in the past",
      path: ["followup_date"],
    },
  );

function isSalesExecutive(user) {
  return user.role === "SalesExecutive";
}

// Verify linked records exist and are accessible to the current user.
async function validateLinks(client, followup, user) {
  if (followup.customer_id) {
    let query = "SELECT id FROM customers WHERE id = $1";
    const values = [followup.customer_id];

    if (isSalesExecutive(user)) {
      values.push(user.id);
      query += " AND owner_id = $2";
    }

    const result = await client.query(query, values);

    if (!result.rowCount) {
      return "Customer not found or access denied";
    }
  }

  if (followup.lead_id) {
    let query = "SELECT id FROM leads WHERE id = $1";
    const values = [followup.lead_id];

    if (isSalesExecutive(user)) {
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

// GET follow-ups
router.get("/", async (req, res) => {
  try {
    const values = [];
    let filter = "TRUE";

    if (isSalesExecutive(req.user)) {
      values.push(req.user.id);
      filter += " AND f.assigned_to = $1";
    }

    const result = await pool.query(
      `SELECT f.*, c.name AS customer_name, l.name AS lead_name
       FROM followups f
       LEFT JOIN customers c ON c.id = f.customer_id
       LEFT JOIN leads l ON l.id = f.lead_id
       WHERE ${filter}
       ORDER BY f.followup_date ASC
       LIMIT 200`,
      values,
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Fetch follow-ups error:", error.message);
    res.status(500).json({ error: "Unable to fetch follow-ups" });
  }
});

// GET one follow-up
router.get("/:id", async (req, res) => {
  try {
    let query = "SELECT * FROM followups WHERE id = $1";
    const values = [req.params.id];

    if (isSalesExecutive(req.user)) {
      values.push(req.user.id);
      query += " AND assigned_to = $2";
    }

    const result = await pool.query(query, values);

    if (!result.rowCount) {
      return res.status(404).json({ error: "Follow-up not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Fetch follow-up error:", error.message);
    res.status(500).json({ error: "Unable to fetch follow-up" });
  }
});

// CREATE follow-up
router.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const followup = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const linkError = await validateLinks(client, followup, req.user);

    if (linkError) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: linkError });
    }

    const result = await client.query(
      `INSERT INTO followups
       (customer_id, lead_id, followup_date, followup_type,
        subject, remarks, status, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        followup.customer_id || null,
        followup.lead_id || null,
        followup.followup_date,
        followup.followup_type,
        followup.subject,
        followup.remarks || null,
        followup.status,
        req.user.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'followup', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Create follow-up error:", error.message);
    res.status(500).json({
      error: "Unable to create follow-up",
    });
  } finally {
    client.release();
  }
});

// UPDATE follow-up
router.put("/:id", async (req, res) => {
  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const followup = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let lookup = "SELECT * FROM followups WHERE id = $1";
    const lookupValues = [req.params.id];

    if (isSalesExecutive(req.user)) {
      lookupValues.push(req.user.id);
      lookup += " AND assigned_to = $2";
    }

    lookup += " FOR UPDATE";

    const existing = await client.query(lookup, lookupValues);

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Follow-up not found" });
    }

    const linkError = await validateLinks(client, followup, req.user);

    if (linkError) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: linkError });
    }

    const result = await client.query(
      `UPDATE followups
       SET customer_id = $1,
           lead_id = $2,
           followup_date = $3,
           followup_type = $4,
           subject = $5,
           remarks = $6,
           status = $7
       WHERE id = $8
       RETURNING *`,
      [
        followup.customer_id || null,
        followup.lead_id || null,
        followup.followup_date,
        followup.followup_type,
        followup.subject,
        followup.remarks || null,
        followup.status,
        req.params.id,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id)
       VALUES ($1, 'UPDATE', 'followup', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update follow-up error:", error.message);
    res.status(500).json({ error: "Unable to update follow-up" });
  } finally {
    client.release();
  }
});

// DELETE follow-up: Admin and Manager only
router.delete("/:id", async (req, res) => {
  if (!["Admin", "Manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "DELETE FROM followups WHERE id = $1 RETURNING id",
      [req.params.id],
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Follow-up not found" });
    }

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id)
       VALUES ($1, 'DELETE', 'followup', $2)`,
      [req.user.id, result.rows[0].id],
    );

    await client.query("COMMIT");
    res.json({ message: "Follow-up deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Delete follow-up error:", error.message);
    res.status(500).json({ error: "Unable to delete follow-up" });
  } finally {
    client.release();
  }
});

module.exports = router;
