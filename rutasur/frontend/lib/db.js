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

// Igual que en los servicios: si Postgres se cae o reinicia, las conexiones
// "idle" del pool mueren con un FATAL (p. ej. 57P01). Sin este handler, pg emite
// 'error' en el pool y Node mata el proceso del servidor Next ("uncaughtException").
// Con el handler, logueamos y el pool reconecta solo en la próxima consulta.
pool.on('error', (error) => {
  console.error(
    `[db] conexión perdida con PostgreSQL (${error.code ?? 'sin código'}): ` +
    `${error.message}. Se reconecta en la próxima consulta.`
  );
});

// Atajo: consultar(sql, params) -> rows
export async function consultar(texto, params = []) {
  const { rows } = await pool.query(texto, params);
  return rows;
}
