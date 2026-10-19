// SERVICIO DE REPROGRAMACIÓN (CU2)
//
// Reacciona a ENTREGA_FALLIDA: decide qué pasa con el envío y publica la decisión en
// envios.reprogramaciones. No sabe que existen el servicio de notificaciones ni la
// analítica: los tres consumen el mismo evento en grupos distintos, en paralelo.
//
// Arranque:  npm run reprogramacion

const { consumir, crearProductor, publicar } = require('../../shared/kafka');
const { conTransaccion, registrarEventoProcesado } = require('../../shared/db');
const { TOPICS, GRUPOS, crearEvento, idDerivado } = require('../../shared/eventos');
const { log } = require('../../shared/logger');
const { decidir } = require('./decidir');

const SERVICIO = 'reprogramacion';

async function main() {
  const productor = await crearProductor(`${SERVICIO}-productor`);

  await consumir({
    servicio: SERVICIO,
    groupId: GRUPOS.REPROGRAMACION,
    topics: [TOPICS.ESTADOS],
    manejar: async (evento, ubicacion) => {
      if (evento.tipo !== 'ENTREGA_FALLIDA') return; // los demás estados no le interesan

      await conTransaccion(async (client) => {
        const esNuevo = await registrarEventoProcesado(client, GRUPOS.REPROGRAMACION, evento.eventId);
        if (!esNuevo) {
          log(SERVICIO, 'evento duplicado descartado', { eventId: evento.eventId, ...ubicacion });
          return;
        }

        // Si el evento no trae el número de intento, se asume el primero.
        const intento = evento.intento ?? 1;
        const decision = decidir({ motivo: evento.motivo, intento, ocurridoEn: evento.ocurridoEn });

        const reaccion = crearEvento({
          shipmentId: evento.shipmentId,
          tipo: decision.tipo,
          secuencia: evento.secuencia,
          ocurridoEn: evento.ocurridoEn, // el reloj simulado viaja en el evento
          hubId: evento.hubId,
          zonaId: evento.zonaId,
          repartidorId: evento.repartidorId,
          intento,
          motivo: evento.motivo,
          proximoIntento: decision.proximoIntento,
          razon: decision.razon,
          origenEventId: evento.eventId,
          // ID derivado del fallo (envío + secuencia): si el servicio se cae después de
          // publicar y reprocesa, o si llega una copia vieja del mismo fallo con otro
          // eventId, la decisión sale con el MISMO eventId y el proyector la descarta.
          eventId: idDerivado('reprogramacion', `${evento.shipmentId}#${evento.secuencia}`),
        });

        // Se publica DENTRO de la transacción: si Kafka falla, se hace rollback y se reintenta.
        await publicar(productor, TOPICS.REPROGRAMACIONES, reaccion);
        log(SERVICIO, `decisión: ${decision.tipo}`, {
          shipmentId: evento.shipmentId,
          intento,
          motivo: evento.motivo,
          proximoIntento: decision.proximoIntento,
          eventId: evento.eventId,
          ...ubicacion,
        });
      });
    },
  });
  log(SERVICIO, 'escuchando eventos', { grupo: GRUPOS.REPROGRAMACION });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
