const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const pool = require("../db");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Enter a valid email and password" });
  }

  const { email, password } = parsed.data;
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, name, email, password_hash, role,
              is_active, failed_login_count, lockout_until
       FROM users WHERE email = $1 FOR UPDATE`,
      [email],
    );

    const user = result.rows[0];

    if (!user || !user.is_active) {
      await client.query("ROLLBACK");
      return res
        .status(401)
        .json({ error: "Invalid credentials or inactive account" });
    }

    if (user.lockout_until && new Date(user.lockout_until) > new Date()) {
      await client.query("ROLLBACK");
      return res.status(423).json({ error: "Account temporarily locked" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      const attempts = user.failed_login_count + 1;
      const locked = attempts >= 5;

      await client.query(
        `UPDATE users
         SET failed_login_count = $1,
             lockout_until = CASE WHEN $2
               THEN NOW() + INTERVAL '15 minutes'
               ELSE NULL END
         WHERE id = $3`,
        [locked ? 0 : attempts, locked, user.id],
      );

      await client.query(
        `INSERT INTO audit_logs (user_id, action, entity_name, record_id, ip_address)
         VALUES ($1, 'LOGIN_FAILED', 'User', $1, $2)`,
        [user.id, req.ip],
      );

      await client.query("COMMIT");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    await client.query(
      "UPDATE users SET failed_login_count = 0, lockout_until = NULL WHERE id = $1",
      [user.id],
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id, ip_address)
       VALUES ($1, 'LOGIN_SUCCESS', 'User', $1, $2)`,
      [user.id, req.ip],
    );

    await client.query("COMMIT");

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Unable to log in" });
  } finally {
    client?.release();
  }
});

module.exports = router;
