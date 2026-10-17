// Conexión a PostgreSQL, transacciones e idempotencia.

const { Pool } = require('pg');
const config = require('./config');

// Un "pool" mantiene varias conexiones abiertas y las presta cuando se necesitan,
// en lugar de abrir una nueva por cada consulta. No se conecta hasta la primera consulta.
const pool = new Pool({ connectionString: config.databaseUrl });

// Ejecuta "fn" dentro de una transacción: o se aplican TODOS los cambios o ninguno.
//
//   await conTransaccion(async (client) => {
//     await client.query('INSERT ...');
//     await client.query('UPDATE ...');
//   });
//
// Si "fn" lanza un error, se hace ROLLBACK (se deshace todo) y el error se propaga.
async function conTransaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(); // devuelve la conexión al pool
  }
}

// IDEMPOTENCIA: "si este evento ya lo apliqué, no lo apliques de nuevo".
//
// Intenta anotar (consumidor, eventId) en eventos_procesados.
//   - Devuelve true  -> es la primera vez: hay que procesar el evento.
//   - Devuelve false -> ya estaba anotado: es un duplicado, hay que descartarlo.
//
// IMPORTANTE: llamala con el "client" de conTransaccion, junto con el resto de los
// cambios. Así, si algo falla a mitad de camino, el rollback también deshace esta
// anotación, y el evento se podrá reintentar sin quedar marcado como procesado.
async function registrarEventoProcesado(client, consumidor, eventId) {
  const resultado = await client.query(
    `INSERT INTO eventos_procesados (consumidor, event_id)
     VALUES ($1, $2)
     ON CONFLICT (consumidor, event_id) DO NOTHING`,
    [consumidor, eventId]
  );
  return resultado.rowCount === 1;
}

async function cerrarPool() {
  await pool.end();
}

module.exports = { pool, conTransaccion, registrarEventoProcesado, cerrarPool };
