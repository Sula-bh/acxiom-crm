const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const { z } = require("zod");
const pool = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

router.post("/login", loginRateLimit, async (req, res) => {
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
              is_active, failed_login_count, lockout_until, token_version
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
      { id: user.id, role: user.role, ver: user.token_version },
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

router.post("/logout", authenticateToken, async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE users
       SET token_version = token_version + 1
       WHERE id = $1 AND is_active = TRUE
       RETURNING id`,
      [req.user.id],
    );

    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "User is no longer active" });
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_name, record_id, ip_address)
       VALUES ($1, 'LOGOUT', 'User', $1, $2)`,
      [req.user.id, req.ip],
    );

    await client.query("COMMIT");
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("Logout error:", error.message);
    res.status(500).json({ error: "Unable to log out securely" });
  } finally {
    client?.release();
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role
       FROM users
       WHERE id = $1 AND is_active = TRUE`,
      [req.user.id],
    );

    if (!result.rows[0]) {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    res.json({ user: result.rows[0] });
  } catch {
    res.status(500).json({ error: "Unable to verify session" });
  }
});

module.exports = router;
