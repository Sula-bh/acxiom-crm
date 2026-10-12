require("dotenv").config();

const bcrypt = require("bcrypt");
const pool = require("../db");
const { z } = require("zod");
const readline = require("node:readline/promises");

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const name = (await rl.question("Admin name: ")).trim();
    const email = (await rl.question("Admin email: ")).trim().toLowerCase();
    const password = await rl.question("Admin password (min 12 characters): ");

    const schema = z.object({
      name: z.string().min(1).max(100),
      email: z.string().email().max(255),
      password: z
        .string()
        .min(12)
        .max(128)
        .regex(/[a-z]/, "Include a lowercase letter")
        .regex(/[A-Z]/, "Include an uppercase letter")
        .regex(/[0-9]/, "Include a number")
        .regex(/[^A-Za-z0-9]/, "Include a special character"),
    });

    const parsed = schema.safeParse({ name, email, password });

    if (!parsed.success) {
      throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'Admin')`,
      [name, email, hash],
    );

    console.log("Admin account created successfully.");
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Could not create admin:", error.message);
  process.exitCode = 1;
});
