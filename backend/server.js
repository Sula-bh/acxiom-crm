require("dotenv").config();

const express = require("express");
const pool = require("./db");

const authRoutes = require("./routes/auth");
const customerRoutes = require("./routes/customers");
const dashboardRoutes = require("./routes/dashboard");
const leadRoutes = require("./routes/leads");
const opportunityRoutes = require("./routes/opportunities");
const followupRoutes = require("./routes/followups");
const userRoutes = require("./routes/users");
const reportsRoutes = require("./routes/reports");

const cors = require("cors");
const helmet = require("helmet");

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/opportunities", opportunityRoutes);
app.use("/api/followups", followupRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reports", reportsRoutes);

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({ status: "ok" });
  } catch (error) {
    console.error("Database error:", error.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
