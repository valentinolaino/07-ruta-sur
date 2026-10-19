// SERVICIO DE ANALÍTICA (CU4)
//
// Consume envios.estados y envios.promesas y convierte los eventos en los tres
// indicadores de negocio, guardándolos precalculados en metricas_diarias con
// INCREMENTOS ATÓMICOS (INSERT ... ON CONFLICT ... DO UPDATE SET col = col + 1):
// así el tablero consulta unas pocas filas en vez de recalcular sobre todo el
// histórico en cada carga.
//
// No publica eventos: su única escritura es metricas_diarias (ver tabla del PDF).
//
// Arranque:  npm run analitica
// (El CUARTO indicador con reprocesamiento está aparte: servicios/analitica/tiempos.js)

const { consumir } = require('../../shared/kafka');
const { conTransaccion, registrarEventoProcesado } = require('../../shared/db');
const { TOPICS, GRUPOS } = require('../../shared/eventos');
const { log } = require('../../shared/logger');
const { crearEstado, proyectar, contadoresDe, COLUMNAS_DIMENSION } = require('./indicadores');

const SERVICIO = 'analitica';

// Estado interno en memoria: shipmentId -> { ultimaSecuencia, fallos, promesaVenceMs }.
// A diferencia del monitor (CU3), el PDF no le pide respaldo ni tolerancia a
// reinicios: si el proceso se reinicia, la secuencia y los fallos de los envíos
// en vuelo se reconstruyen con los próximos eventos que lleguen.
const memoria = new Map();

// SUMA una fila en metricas_diarias con incrementos atómicos.
// Solo se pasan las columnas que esta fila trae; el resto queda en 0 o conserva
// su valor. En el conflicto (misma fecha+zona+franja) NO se pisa hub_id: la zona
// siempre corresponde al mismo hub.
async function sumar(client, fila) {
  const contadores = contadoresDe(fila);
  const dimensiones = COLUMNAS_DIMENSION;

  const columnasSql = [...dimensiones, ...contadores].join(', ');
  const placeholders = [...dimensiones, ...contadores].map((_, i) => `$${i + 1}`).join(', ');
  const valores = [...dimensiones, ...contadores].map((c) => fila[c]);

  const updateSql = contadores.map((c) => `${c} = metricas_diarias.${c} + EXCLUDED.${c}`).join(', ');

  await client.query(
    `INSERT INTO metricas_diarias (${columnasSql})
     VALUES (${placeholders})
     ON CONFLICT (fecha, zona_id, franja) DO UPDATE SET ${updateSql}`,
    valores
  );
}

async function manejar(evento, ubicacion) {
  const previo = memoria.get(evento.shipmentId) || crearEstado();
  const { estado: nuevo, fila, aplicado, motivo } = proyectar(previo, evento, ubicacion.topic);

  // Duplicado u fuera de orden: no se registra ni se cuenta.
  // (El offset igual se confirma: shared/kafka.js lo hace al volver de "manejar".)
  if (!aplicado) {
    log(SERVICIO, `evento descartado: ${motivo}`, {
      shipmentId: evento.shipmentId,
      eventId: evento.eventId,
      ...ubicacion,
    });
    return;
  }

  const confirmado = await conTransaccion(async (client) => {
    const esNuevo = await registrarEventoProcesado(client, GRUPOS.ANALITICA, evento.eventId);
    if (!esNuevo) {
      log(SERVICIO, 'evento duplicado descartado', { eventId: evento.eventId, ...ubicacion });
      return false;
    }
    if (fila) await sumar(client, fila);
    return true;
  });

  // La memoria se sincroniza después del COMMIT: si algo falló, el evento se
  // reintenta limpio y no queda una secuencia adelantada sin contar.
  if (confirmado) {
    memoria.set(evento.shipmentId, nuevo);
    if (fila) {
      log(SERVICIO, 'métricas incrementadas', {
        shipmentId: evento.shipmentId,
        tipo: evento.tipo,
        fila,
        ...ubicacion,
      });
    }
  }
}

async function main() {
  await consumir({
    servicio: SERVICIO,
    groupId: GRUPOS.ANALITICA,
    topics: [TOPICS.ESTADOS, TOPICS.PROMESAS],
    // ANALITICA_DESDE_INICIO=1 -> reconstrucción: si el grupo es nuevo, vuelve a
    // sumar todo el histórico desde el primer evento (la tabla debe estar vacía).
    desdeInicio: process.env.ANALITICA_DESDE_INICIO === '1',
    manejar,
  });
  log(SERVICIO, 'escuchando eventos', { grupo: GRUPOS.ANALITICA });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { manejar };
