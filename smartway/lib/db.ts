import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { databaseConfig, databaseConfigured } from "./db-config.mjs";

const state = globalThis as typeof globalThis & { marconPool?: Pool };

export function databaseEnabled() {
  return databaseConfigured();
}

export function getPool(): Pool {
  return state.marconPool ??= mysql.createPool({
    ...databaseConfig(),
    connectionLimit: 10,
    decimalNumbers: true,
    dateStrings: true,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
}

export async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
