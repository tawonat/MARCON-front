import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import nextEnv from "@next/env";
import { databaseConfig } from "../lib/db-config.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const database = databaseConfig().database;
const identifier = `\`${database.replaceAll("`", "``")}\``;
// Conecta sem schema para permitir a primeira instalação.
const connection = await mysql.createConnection(databaseConfig(process.env, true));
try {
  const [existing] = await connection.query("SHOW DATABASES LIKE ?", [database.replace(/[\\%_]/g, "\\$&")]);
  if (!existing.length) {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${identifier} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }
  await connection.query(`USE ${identifier}`);
  const file = await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8");
  // O bloco do Workbench usa marcon, mas o CLI respeita DATABASE_URL, inclusive bancos de teste.
  const marker = "-- BEGIN TABLES";
  if (!file.includes(marker)) throw new Error("Marcador das tabelas ausente na migração.");
  const tables = file.slice(file.indexOf(marker) + marker.length);
  for (const statement of tables.split(";").map((value) => value.trim()).filter(Boolean)) {
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
