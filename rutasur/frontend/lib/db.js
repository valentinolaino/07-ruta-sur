// Conexión a PostgreSQL.
//
// La interfaz SOLO lee de acá (las vistas derivadas de los eventos): nunca toca
// Kafka. Es la regla de arquitectura del PDF: Next.js lee el modelo de lectura y
// los change streams (acá: LISTEN/NOTIFY de PostgreSQL) alimentan el tiempo real.
//
// "globalThis" evita abrir un pool de conexiones por cada recarga del dev server.

import pg from 'pg';
const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL || 'postgres://rutasur:rutasur@localhost:5434/rutasur';

export const pool = globalThis.__rutasurPool ?? new Pool({ connectionString, max: 5 });
globalThis.__rutasurPool = pool;

// Atajo: consultar(sql, params) -> rows
export async function consultar(texto, params = []) {
  const { rows } = await pool.query(texto, params);
  return rows;
}
