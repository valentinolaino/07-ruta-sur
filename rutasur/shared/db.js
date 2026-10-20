// Conexión a PostgreSQL, transacciones e idempotencia.

const { Pool } = require("pg");
const config = require("./config");
const pool = new Pool({ connectionString: config.databaseUrl });
pool.on("error", (error) => {
  console.error(
    `[db] conexión perdida con PostgreSQL (${error.code ?? "sin código"}): ` +
      `${error.message}. El servicio sigue vivo y se reconecta en la próxima consulta.`,
  );
});

async function conTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const resultado = await fn(client);
    await client.query("COMMIT");
    return resultado;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release(); // devuelve la conexión al pool
  }
}
async function registrarEventoProcesado(client, consumidor, eventId) {
  const resultado = await client.query(
    `INSERT INTO eventos_procesados (consumidor, event_id)
     VALUES ($1, $2)
     ON CONFLICT (consumidor, event_id) DO NOTHING`,
    [consumidor, eventId],
  );
  return resultado.rowCount === 1;
}

async function cerrarPool() {
  await pool.end();
}

module.exports = { pool, conTransaccion, registrarEventoProcesado, cerrarPool };
