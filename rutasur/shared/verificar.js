// Chequea que el entorno del Paso 1 esté funcionando.
// Se ejecuta con:  npm run verificar
//
// Comprueba:
//   1. Que Kafka responde y existen los 6 topics del catálogo.
//   2. Que PostgreSQL responde y existen las tablas del esquema.

const { crearKafka } = require('./kafka');
const { pool, cerrarPool } = require('./db');
const { TOPICS } = require('./eventos');

const TABLAS_ESPERADAS = [
  'envios',
  'alertas',
  'notificaciones',
  'metricas_diarias',
  'eventos_procesados',
];

let hayErrores = false;

function ok(texto) {
  console.log(`  ✔ ${texto}`);
}
function falla(texto) {
  hayErrores = true;
  console.log(`  ✘ ${texto}`);
}

async function verificarKafka() {
  console.log('Kafka');
  const admin = crearKafka('verificar').admin();
  try {
    await admin.connect();
    ok('conexión con el broker');
    const existentes = await admin.listTopics();
    for (const topic of Object.values(TOPICS)) {
      if (existentes.includes(topic)) ok(`topic ${topic}`);
      else falla(`falta el topic ${topic} (revisá: docker compose logs kafka-init)`);
    }
  } catch (error) {
    falla(`no se pudo conectar a Kafka: ${error.message}`);
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function verificarPostgres() {
  console.log('PostgreSQL');
  try {
    await pool.query('SELECT 1');
    ok('conexión con la base');
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const existentes = rows.map((r) => r.table_name);
    for (const tabla of TABLAS_ESPERADAS) {
      if (existentes.includes(tabla)) ok(`tabla ${tabla}`);
      else falla(`falta la tabla ${tabla} (¿se ejecutó db/init.sql?)`);
    }
  } catch (error) {
    falla(`no se pudo conectar a PostgreSQL: ${error.message}`);
  }
}

async function main() {
  await verificarKafka();
  await verificarPostgres();
  await cerrarPool();
  console.log(hayErrores ? '\nHay problemas para resolver.' : '\nTodo listo.');
  process.exit(hayErrores ? 1 : 0);
}

main();
