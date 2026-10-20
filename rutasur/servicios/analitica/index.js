const { consumir } = require("../../shared/kafka");
const { conTransaccion, registrarEventoProcesado } = require("../../shared/db");
const { TOPICS, GRUPOS } = require("../../shared/eventos");
const { log } = require("../../shared/logger");
const {
  crearEstado,
  proyectar,
  contadoresDe,
  COLUMNAS_DIMENSION,
} = require("./indicadores");

const SERVICIO = "analitica";

const memoria = new Map();

async function sumar(client, fila) {
  const contadores = contadoresDe(fila);
  const dimensiones = COLUMNAS_DIMENSION;

  const columnasSql = [...dimensiones, ...contadores].join(", ");
  const placeholders = [...dimensiones, ...contadores]
    .map((_, i) => `$${i + 1}`)
    .join(", ");
  const valores = [...dimensiones, ...contadores].map((c) => fila[c]);

  const updateSql = contadores
    .map((c) => `${c} = metricas_diarias.${c} + EXCLUDED.${c}`)
    .join(", ");

  await client.query(
    `INSERT INTO metricas_diarias (${columnasSql})
     VALUES (${placeholders})
     ON CONFLICT (fecha, zona_id, franja) DO UPDATE SET ${updateSql}`,
    valores,
  );
}

async function manejar(evento, ubicacion) {
  const previo = memoria.get(evento.shipmentId) || crearEstado();
  const {
    estado: nuevo,
    fila,
    aplicado,
    motivo,
  } = proyectar(previo, evento, ubicacion.topic);

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
    const esNuevo = await registrarEventoProcesado(
      client,
      GRUPOS.ANALITICA,
      evento.eventId,
    );
    if (!esNuevo) {
      log(SERVICIO, "evento duplicado descartado", {
        eventId: evento.eventId,
        ...ubicacion,
      });
      return false;
    }
    if (fila) await sumar(client, fila);
    return true;
  });

  if (confirmado) {
    memoria.set(evento.shipmentId, nuevo);
    if (fila) {
      log(SERVICIO, "métricas incrementadas", {
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
    desdeInicio: process.env.ANALITICA_DESDE_INICIO === "1",
    manejar,
  });
  log(SERVICIO, "escuchando eventos", { grupo: GRUPOS.ANALITICA });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { manejar };
