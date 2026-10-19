// Reconstrucción de las vistas (requisito de "Reconstrucción" del PDF):
//
//   "Borrar una colección y reprocesar el topic desde el inicio deja el mismo
//    resultado."
//
// Este script hace LAS DOS COSAS:
//   1. vacía las vistas derivadas de PostgreSQL (que son solo eso: vistas);
//   2. devuelve los offsets de TODOS los grupos de consumidores al principio
//      del log, para que cada servicio vuelva a leer desde el primer evento.
//
// Por qué hay que reiniciar TODO junto: las vistas se alimentan también de
// eventos que publican otros servicios (reprogramaciones, alertas, avisos).
// Si solo se releyera el proyector, esas decisiones no se republicarían y la
// reconstrucción quedaría incompleta. Al reiniciar todos los grupos con las
// vistas vacías, todo el mundo vuelve a emitir lo mismo con los MISMOS ids
// derivados, y el resultado es idéntico al anterior.
//
// USO (con Kafka y PostgreSQL levantados, y los servicios DETENIDOS):
//   npm run reconstruir
//
// Si los servicios siguen corriendo, sus consumidores seguirían desde su
// posición en memoria y pisarían este reset: siempre detener antes con Ctrl+C.

const { crearKafka } = require('../shared/kafka');
const { pool, cerrarPool } = require('../shared/db');
const { TOPICS, GRUPOS } = require('../shared/eventos');

// Cada grupo, con los topics que lee (igual que sus consumir() correspondientes).
const GRUPOS_A_REINICIAR = [
  { grupo: GRUPOS.PROYECTOR, topics: [TOPICS.ESTADOS, TOPICS.PROMESAS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS_SLA, TOPICS.NOTIFICACIONES] },
  { grupo: GRUPOS.NOTIFICACIONES, topics: [TOPICS.ESTADOS, TOPICS.ALERTAS_SLA] },
  { grupo: GRUPOS.REPROGRAMACION, topics: [TOPICS.ESTADOS] },
  { grupo: GRUPOS.MONITOR_SLA, topics: [TOPICS.ESTADOS, TOPICS.PROMESAS] },
  { grupo: GRUPOS.ANALITICA, topics: [TOPICS.ESTADOS, TOPICS.PROMESAS] },
  { grupo: GRUPOS.ANALITICA_TIEMPOS, topics: [TOPICS.ESTADOS] },
];

const TABLAS = ['envios', 'alertas', 'notificaciones', 'metricas_diarias', 'metricas_tiempos', 'monitor_sla'];

async function main() {
  console.log('Reconstrucción desde el log de eventos');
  console.log('-------------------------------------');

  // 1) Vaciar las vistas. eventos_procesados TAMBIÉN: es el registro de
  //    idempotencia; si quedara lleno, los servicios ignorarían los eventos al
  //    releerlos y nada se re-aplicaría.
  console.log(`Vaciando tablas: ${TABLAS.join(', ')} + eventos_procesados`);
  await pool.query(`TRUNCATE TABLE ${TABLAS.join(', ')} RESTART IDENTITY`);
  await pool.query('DELETE FROM eventos_procesados');

  // 2) offsets al principio del log para todos los grupos.
  const admin = crearKafka('reconstruir').admin();
  await admin.connect();
  try {
    for (const { grupo, topics } of GRUPOS_A_REINICIAR) {
      for (const topic of topics) {
        try {
          await admin.resetOffsets({ groupId: grupo, topic, earliest: true });
          console.log(`  ✔ ${grupo} @ ${topic} -> offset 0`);
        } catch (error) {
          // Grupo que todavía nunca corrió: no tiene offsets que reiniciar.
          console.log(`  ~ ${grupo} @ ${topic}: sin offsets (${error.message})`);
        }
      }
    }
  } finally {
    await admin.disconnect().catch(() => {});
  }

  await cerrarPool();
  console.log('\nListo. Ahora reiniciá los servicios:  npm run todo');
  console.log('El proyector, el monitor y la analítica volverán a leer desde el primer evento.');
  process.exit(0);
}

main().catch(async (error) => {
  console.error('No se pudo reconstruir (¿están Kafka y PostgreSQL levantados?):');
  console.error(error);
  await cerrarPool().catch(() => {});
  process.exit(1);
});
