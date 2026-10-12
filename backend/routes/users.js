const express = require("express");
const pool = require("../db");
const bcrypt = require("bcrypt");
const { z } = require("zod");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");

const router = express.Router();

router.use(authenticateToken, authorizeRoles("Admin"));

const userSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z
    .string()
    .min(12)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/,
      "Password must contain uppercase, lowercase, number, and special character",
    ),
  role: z.enum(["Admin", "Manager", "SalesExecutive"]),
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_active, created_at
       FROM users ORDER BY id`,
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to fetch users" });
  }
});

router.post("/", async (req, res) => {
  const parsed = userSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0].message,
    });
  }

  const { name, email, password, role } = parsed.data;

  try {
    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email.toLowerCase(), hash, role],
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, 'CREATE', 'user', $2)`,
      [req.user.id, result.rows[0].id],
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error(error.message);
    res.status(500).json({ error: "Unable to create user" });
  }
});

router.patch("/:id/status", async (req, res) => {
  const parsed = z.object({ is_active: z.boolean() }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid account status" });
  }

  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  if (id === req.user.id && !parsed.data.is_active) {
    return res.status(400).json({
      error: "You cannot deactivate your own account",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET is_active = $1
       WHERE id = $2
       RETURNING id, name, email, role, is_active`,
      [parsed.data.is_active, id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "User not found" });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id)
       VALUES ($1, $2, 'user', $3)`,
      [req.user.id, parsed.data.is_active ? "ACTIVATE" : "DEACTIVATE", id],
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Unable to update user status" });
  }
});

module.exports = router;
