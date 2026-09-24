import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL antes de migrar.");
const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const file = await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8");
  for (const statement of file.split(";").map((value) => value.trim()).filter(Boolean)) {
    await connection.query(statement);
  }
  await connection.execute(
    "INSERT IGNORE INTO schema_migrations (version) VALUES (?)",
    ["001_initial"],
  );
  console.log("Migração 001_initial aplicada.");
} finally {
  await connection.end();
}
