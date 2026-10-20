// Conexión a PostgreSQL.

import pg from "pg";
const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://rutasur:rutasur@localhost:5434/rutasur";

export const pool =
  globalThis.__rutasurPool ?? new Pool({ connectionString, max: 5 });
globalThis.__rutasurPool = pool;

pool.on("error", (error) => {
  console.error(
    `[db] conexión perdida con PostgreSQL (${error.code ?? "sin código"}): ` +
      `${error.message}. Se reconecta en la próxima consulta.`,
  );
});

// Atajo: consultar(sql, params) -> rows
export async function consultar(texto, params = []) {
  const { rows } = await pool.query(texto, params);
  return rows;
}
