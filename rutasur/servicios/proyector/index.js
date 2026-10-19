// SERVICIO PROYECTOR (CU1)
//
// Consume los eventos y mantiene en PostgreSQL las vistas de lectura que usa la interfaz:
// envios, alertas y notificaciones. Es el único que escribe esas tablas.
//
// Cada evento se aplica dentro de UNA transacción que incluye:
//   1. registrar (consumidor, eventId) en eventos_procesados   -> idempotencia
//   2. aplicar el cambio a la tabla correspondiente
// El offset de Kafka se confirma DESPUÉS (lo hace shared/kafka.js al volver "manejar").
// Si algo falla a mitad, el rollback deshace todo y el evento se reintenta limpio.
//
// Arranque:  npm run proyector

const { consumir } = require('../../shared/kafka');
const { conTransaccion, registrarEventoProcesado } = require('../../shared/db');
const { TOPICS, GRUPOS, TIPO_ALERTA_CERRADA } = require('../../shared/eventos');
const { log } = require('../../shared/logger');
const reducer = require('./reducer');
const repo = require('./repositorio');

const SERVICIO = 'proyector';

// Aplica un evento de un topic que modifica el documento del envío.
async function proyectarEnvio(client, evento, ubicacion, aplicar) {
  const doc = await repo.leerEnvio(client, evento.shipmentId);
  const resultado = aplicar(doc, evento);
  if (resultado.aplicado) {
    await repo.guardarEnvio(client, resultado.doc);
    log(SERVICIO, 'envío actualizado', {
      shipmentId: evento.shipmentId,
      estado: resultado.doc.estado,
      eventId: evento.eventId,
      ...ubicacion,
    });
  } else {
    log(SERVICIO, `evento descartado: ${resultado.motivo}`, {
      shipmentId: evento.shipmentId,
      eventId: evento.eventId,
      ...ubicacion,
    });
  }
}

async function manejar(evento, ubicacion) {
  await conTransaccion(async (client) => {
    // Idempotencia: ¿ya apliqué este eventId? Entonces es un duplicado.
    const esNuevo = await registrarEventoProcesado(client, GRUPOS.PROYECTOR, evento.eventId);
    if (!esNuevo) {
      log(SERVICIO, 'evento duplicado descartado', { eventId: evento.eventId, ...ubicacion });
      return;
    }

    switch (ubicacion.topic) {
      case TOPICS.ESTADOS:
        return proyectarEnvio(client, evento, ubicacion, reducer.aplicarEstado);

      case TOPICS.PROMESAS:
        return proyectarEnvio(client, evento, ubicacion, reducer.aplicarPromesa);

      case TOPICS.REPROGRAMACIONES:
        return proyectarEnvio(client, evento, ubicacion, reducer.aplicarReprogramacion);

      case TOPICS.ALERTAS_SLA: {
        if (evento.tipo === TIPO_ALERTA_CERRADA) await repo.cerrarAlertas(client, evento);
        else await repo.abrirAlerta(client, evento);
        await repo.tocarEnvio(client, evento.shipmentId);
        return;
      }

      case TOPICS.NOTIFICACIONES:
        await repo.registrarNotificacion(client, evento);
        await repo.tocarEnvio(client, evento.shipmentId);
        return;

      default:
        log(SERVICIO, 'topic no esperado, se ignora', { ...ubicacion });
    }
  });
}

async function main() {
  await consumir({
    servicio: SERVICIO,
    groupId: GRUPOS.PROYECTOR,
    topics: [
      TOPICS.ESTADOS,
      TOPICS.PROMESAS,
      TOPICS.REPROGRAMACIONES,
      TOPICS.ALERTAS_SLA,
      TOPICS.NOTIFICACIONES,
    ],
    // PROYECTOR_DESDE_INICIO=1 -> si el grupo es nuevo, relee los topics desde el primer
    // evento. Sirve para reconstruir las vistas (requisito de reconstrucción).
    desdeInicio: process.env.PROYECTOR_DESDE_INICIO === '1',
    manejar,
  });
  log(SERVICIO, 'escuchando eventos', { grupo: GRUPOS.PROYECTOR });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { manejar };
