// SERVICIO DE NOTIFICACIONES (CU2)
//
// Registra un aviso al destinatario cuando un envío falla (envios.estados) o cuando el
// monitor de SLA emite una alerta (alertas.sla), y publica ese aviso en
// notificaciones.enviadas. El proyector lo guarda en PostgreSQL.
//
// Arranque:  npm run notificaciones

const { consumir, crearProductor, publicar } = require('../../shared/kafka');
const { conTransaccion, registrarEventoProcesado } = require('../../shared/db');
const { TOPICS, GRUPOS, crearEvento, idDerivado } = require('../../shared/eventos');
const { log } = require('../../shared/logger');
const { construirNotificacion } = require('./mensajes');

const SERVICIO = 'notificaciones';

// Qué identifica "el mismo hecho" para derivar el id del aviso:
//   - un estado del envío: (envío + secuencia). Así una copia vieja del mismo fallo, que
//     llega con otro eventId, no genera un segundo aviso.
//   - una alerta: su propio eventId (el monitor ya lo hace determinista).
function claveOrigen(topic, evento) {
  return topic === TOPICS.ESTADOS ? `${evento.shipmentId}#${evento.secuencia}` : evento.eventId;
}

async function main() {
  const productor = await crearProductor(`${SERVICIO}-productor`);

  await consumir({
    servicio: SERVICIO,
    groupId: GRUPOS.NOTIFICACIONES,
    topics: [TOPICS.ESTADOS, TOPICS.ALERTAS_SLA],
    manejar: async (evento, ubicacion) => {
      const notificacion = construirNotificacion(ubicacion.topic, evento);
      if (!notificacion) return; // este evento no genera aviso

      await conTransaccion(async (client) => {
        const esNuevo = await registrarEventoProcesado(client, GRUPOS.NOTIFICACIONES, evento.eventId);
        if (!esNuevo) {
          log(SERVICIO, 'evento duplicado descartado', { eventId: evento.eventId, ...ubicacion });
          return;
        }

        const aviso = crearEvento({
          shipmentId: evento.shipmentId,
          tipo: notificacion.tipo,
          secuencia: evento.secuencia,
          ocurridoEn: evento.ocurridoEn,
          hubId: evento.hubId,
          zonaId: evento.zonaId,
          repartidorId: evento.repartidorId,
          mensaje: notificacion.mensaje,
          opciones: notificacion.opciones,
          origenEventId: evento.eventId,
          origenTipo: evento.tipo,
          // Derivado del hecho que lo causó: "exactamente una notificación por fallo"
          // aunque el servicio se reinicie y reprocese, o llegue una copia vieja.
          eventId: idDerivado('notificacion', claveOrigen(ubicacion.topic, evento)),
        });

        await publicar(productor, TOPICS.NOTIFICACIONES, aviso);
        log(SERVICIO, `aviso registrado: ${notificacion.tipo}`, {
          shipmentId: evento.shipmentId,
          eventId: evento.eventId,
          ...ubicacion,
        });
      });
    },
  });
  log(SERVICIO, 'escuchando eventos', { grupo: GRUPOS.NOTIFICACIONES });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
