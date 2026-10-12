const jwt = require("jsonwebtoken");
const pool = require("../db");

async function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error: "Authentication required",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      `SELECT id, name, email, role, is_active, token_version
       FROM users WHERE id = $1`,
      [decoded.id],
    );

    const user = result.rows[0];

    if (!user || !user.is_active) {
      return res.status(401).json({
        error: "Account is inactive or no longer exists",
      });
    }

    if (decoded.ver !== user.token_version) {
      return res.status(401).json({
        error: "Invalid or revoked token",
      });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError" ||
      error.name === "NotBeforeError"
    ) {
      return res.status(401).json({
        error: "Invalid or expired token",
      });
    }

    console.error("Authentication error:", error.message);
    return res.status(500).json({
      error: "Authentication service unavailable",
    });
  }
}

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }
    next();
  };
}

module.exports = { authenticateToken, authorizeRoles };
