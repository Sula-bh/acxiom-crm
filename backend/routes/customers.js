const express = require("express");
const { z } = require("zod");
const pool = require("../db");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken);

const customerSchema = z.object({
  customerCode: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(150),
  email: z
    .string()
    .trim()
    .email()
    .max(255)
    .transform((v) => v.toLowerCase()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/),
  companyName: z.string().trim().max(150).optional().default(""),
  address: z.string().trim().max(1000).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(100).optional().default(""),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  ownerId: z.coerce.number().int().positive().optional(),
});

function validateCustomer(req, res, next) {
  const result = customerSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Validation failed",
      details: result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
  }

  req.validatedBody = result.data;
  next();
}

function canAccessCustomer(user, customer) {
  return user.role !== "SalesExecutive" || customer.owner_id === user.id;
}

// List/search customers
router.get("/", async (req, res) => {
  try {
    const search = String(req.query.search || "")
      .trim()
      .slice(0, 100);
    const params = [];
    let where = "";

    if (req.user.role === "SalesExecutive") {
      params.push(req.user.id);
      where = "WHERE owner_id = $1";
    }

    if (search) {
      params.push(`%${search}%`);
      const n = params.length;

      where += where ? " AND " : "WHERE ";
      where += `(name ILIKE $${n} OR email ILIKE $${n}
                  OR phone ILIKE $${n} OR company_name ILIKE $${n})`;
    }

    const result = await pool.query(
      `SELECT id, customer_code, name, email, phone, company_name,
              address, city, state, status, owner_id, created_at
       FROM customers ${where}
       ORDER BY created_at DESC LIMIT 100`,
      params,
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to retrieve customers" });
  }
});

// Get one customer
router.get("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_code, name, email, phone, company_name,
              address, city, state, status, owner_id, created_at
       FROM customers WHERE id = $1`,
      [req.params.id],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: "Customer not found" });
    }

    if (!canAccessCustomer(req.user, result.rows[0])) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to retrieve customer" });
  }
});

// Create customer
router.post(
  "/",
  authorizeRoles("Admin", "Manager", "SalesExecutive"),
  validateCustomer,
  async (req, res) => {
    const c = req.validatedBody;

    try {
      const ownerId =
        req.user.role === "SalesExecutive"
          ? req.user.id
          : c.ownerId || req.user.id;

      const result = await pool.query(
        `INSERT INTO customers
          (customer_code, name, email, phone, company_name, address,
           city, state, status, owner_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, customer_code, name, email, phone, company_name,
                   address, city, state, status, owner_id, created_at`,
        [
          c.customerCode,
          c.name,
          c.email,
          c.phone,
          c.companyName,
          c.address,
          c.city,
          c.state,
          c.status,
          ownerId,
          req.user.id,
        ],
      );

      await pool.query(
        `INSERT INTO audit_logs
          (user_id, action, entity_name, record_id, new_value, ip_address)
         VALUES ($1, 'CREATE', 'Customer', $2, $3, $4)`,
        [
          req.user.id,
          result.rows[0].id,
          JSON.stringify(result.rows[0]),
          req.ip,
        ],
      );

      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Customer code, email, or phone already exists",
        });
      }

      console.error(error.message);
      res.status(500).json({ error: "Unable to create customer" });
    }
  },
);

// Update customer
router.put(
  "/:id",
  authorizeRoles("Admin", "Manager", "SalesExecutive"),
  validateCustomer,
  async (req, res) => {
    const c = req.validatedBody;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT * FROM customers WHERE id = $1 FOR UPDATE",
        [req.params.id],
      );

      if (!existing.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Customer not found" });
      }

      if (!canAccessCustomer(req.user, existing.rows[0])) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Access denied" });
      }

      const ownerId =
        req.user.role === "SalesExecutive"
          ? req.user.id
          : c.ownerId || existing.rows[0].owner_id;

      const updated = await client.query(
        `UPDATE customers SET
          customer_code=$1, name=$2, email=$3, phone=$4,
          company_name=$5, address=$6, city=$7, state=$8,
          status=$9, owner_id=$10, updated_at=NOW()
         WHERE id=$11
         RETURNING id, customer_code, name, email, phone, company_name,
                   address, city, state, status, owner_id, created_at`,
        [
          c.customerCode,
          c.name,
          c.email,
          c.phone,
          c.companyName,
          c.address,
          c.city,
          c.state,
          c.status,
          ownerId,
          req.params.id,
        ],
      );

      await client.query(
        `INSERT INTO audit_logs
          (user_id, action, entity_name, record_id, old_value, new_value, ip_address)
         VALUES ($1, 'UPDATE', 'Customer', $2, $3, $4, $5)`,
        [
          req.user.id,
          req.params.id,
          JSON.stringify(existing.rows[0]),
          JSON.stringify(updated.rows[0]),
          req.ip,
        ],
      );

      await client.query("COMMIT");
      res.json(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});

      if (error.code === "23505") {
        return res.status(409).json({
          error: "Customer code, email, or phone already exists",
        });
      }

      console.error(error.message);
      res.status(500).json({ error: "Unable to update customer" });
    } finally {
      client.release();
    }
  },
);

// Delete customer — Admin/Manager only
router.delete("/:id", authorizeRoles("Admin", "Manager"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT * FROM customers WHERE id = $1 FOR UPDATE",
      [req.params.id],
    );

    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Customer not found" });
    }

    await client.query("DELETE FROM customers WHERE id = $1", [req.params.id]);

    await client.query(
      `INSERT INTO audit_logs
          (user_id, action, entity_name, record_id, old_value, ip_address)
         VALUES ($1, 'DELETE', 'Customer', $2, $3, $4)`,
      [req.user.id, req.params.id, JSON.stringify(existing.rows[0]), req.ip],
    );

    await client.query("COMMIT");
    res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(error.message);
    res.status(500).json({
      error: "Unable to delete customer. Check related records.",
    });
  } finally {
    client.release();
  }
});

module.exports = router;
