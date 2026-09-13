import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.ts";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function migrate(): Promise<void> {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "sql", "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}
