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

const conversionSchema = z
  .object({
    customerCode: z.string().trim().min(1).max(30).optional(),
    email: optionalEmail,
    phone: optionalPhone,
    companyName: z.string().trim().max(150).optional(),
    createOpportunity: z.boolean().default(false),
    expectedCloseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
      .optional(),
    probability: z.coerce.number().finite().min(0).max(100).default(10),
  })
  .superRefine((data, context) => {
    if (!data.createOpportunity) return;

    if (!data.expectedCloseDate) {
      context.addIssue({
        code: "custom",
        message: "Expected close date is required for the opportunity",
        path: ["expectedCloseDate"],
      });
      return;
    }

    const closeDate = new Date(`${data.expectedCloseDate}T00:00:00.000Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const validDate =
      !Number.isNaN(closeDate.getTime()) &&
      closeDate.toISOString().slice(0, 10) === data.expectedCloseDate;

    if (!validDate || closeDate < today) {
      context.addIssue({
        code: "custom",
        message: "Expected close date cannot be in the past",
        path: ["expectedCloseDate"],
      });
    }
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

// Convert a qualified lead once, keeping its related records and audit events atomic.
router.post("/:id/convert", async (req, res) => {
  const leadId = Number(req.params.id);

  if (!Number.isInteger(leadId) || leadId <= 0) {
    return res.status(400).json({ error: "Invalid lead ID" });
  }

  const parsed = conversionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const leadResult = await client.query(
      "SELECT * FROM leads WHERE id = $1 FOR UPDATE",
      [leadId],
    );

    if (!leadResult.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lead not found" });
    }

    const lead = leadResult.rows[0];

    if (
      req.user.role === "SalesExecutive" &&
      Number(lead.assigned_to) !== Number(req.user.id)
    ) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Access denied" });
    }

    if (lead.status === "Converted") {
      if (!lead.converted_customer_id) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Lead is marked converted but has no linked customer",
        });
      }

      const [customerResult, opportunityResult] = await Promise.all([
        client.query("SELECT * FROM customers WHERE id = $1", [
          lead.converted_customer_id,
        ]),
        lead.converted_opportunity_id
          ? client.query("SELECT * FROM opportunities WHERE id = $1", [
              lead.converted_opportunity_id,
            ])
          : Promise.resolve({ rows: [] }),
      ]);

      if (!customerResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Converted customer record is missing",
        });
      }

      await client.query("COMMIT");
      return res.json({
        lead,
        customer: customerResult.rows[0],
        opportunity: opportunityResult.rows[0] || null,
        alreadyConverted: true,
      });
    }

    if (lead.status !== "Qualified") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Only qualified leads can be converted",
      });
    }

    const conversion = parsed.data;
    const email = conversion.email || lead.email;
    const phone = conversion.phone || lead.phone;

    if (!email) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "A valid email address is required to create the customer",
      });
    }

    if (!phone) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "A valid phone number is required to create the customer",
      });
    }

    if (conversion.createOpportunity && Number(lead.expected_value) <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Lead expected value must be greater than zero",
      });
    }

    const ownerId = lead.assigned_to || req.user.id;
    const customerCode = conversion.customerCode || `CUS-${lead.lead_code}`;
    const customerResult = await client.query(
      `INSERT INTO customers
       (customer_code, name, email, phone, company_name, status, owner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'Active',$6,$7)
       RETURNING id, customer_code, name, email, phone, company_name,
                 status, owner_id, created_at`,
      [
        customerCode,
        lead.name,
        email.toLowerCase(),
        phone,
        conversion.companyName || lead.company_name || null,
        ownerId,
        req.user.id,
      ],
    );
    const customer = customerResult.rows[0];
    let opportunity = null;

    if (conversion.createOpportunity) {
      const opportunityResult = await client.query(
        `INSERT INTO opportunities
         (name, customer_id, lead_id, amount, stage, probability,
          expected_close_date, assigned_to)
         VALUES ($1,$2,$3,$4,'Qualification',$5,$6,$7)
         RETURNING *`,
        [
          lead.name,
          customer.id,
          lead.id,
          lead.expected_value,
          conversion.probability,
          conversion.expectedCloseDate,
          ownerId,
        ],
      );
      opportunity = opportunityResult.rows[0];
    }

    const updatedLeadResult = await client.query(
      `UPDATE leads
       SET status = 'Converted',
           converted_customer_id = $1,
           converted_opportunity_id = $2
       WHERE id = $3
       RETURNING *`,
      [customer.id, opportunity?.id || null, lead.id],
    );

    await client.query(
      `INSERT INTO audit_logs
       (user_id, action, entity_name, record_id, old_value, new_value, ip_address)
       VALUES ($1, 'CONVERT', 'Lead', $2, $3, $4, $5)`,
      [
        req.user.id,
        lead.id,
        JSON.stringify({ status: lead.status }),
        JSON.stringify({
          status: "Converted",
          customer_id: customer.id,
          opportunity_id: opportunity?.id || null,
        }),
        req.ip,
      ],
    );

    await client.query("COMMIT");
    res.status(201).json({
      lead: updatedLeadResult.rows[0],
      customer,
      opportunity,
      alreadyConverted: false,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return res.status(409).json({
        error: "A customer with this code, email, or phone already exists",
      });
    }
    console.error("Convert lead error:", error.message);
    res.status(500).json({ error: "Unable to convert lead" });
  } finally {
    client?.release();
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

  if (parsed.data.status === "Converted") {
    return res.status(400).json({
      error: "Use the lead conversion action to mark a lead as converted",
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

    if (existing.rows[0].status === "Converted") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Converted leads cannot be edited",
      });
    }

    if (lead.status === "Converted") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Use the lead conversion action to mark a lead as converted",
      });
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
