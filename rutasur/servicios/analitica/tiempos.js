// ANALÍTICA - CUARTO INDICADOR: tiempo medio entre INGRESADO_HUB y EN_REPARTO,
// por hub y día. Este archivo ES el reprocesamiento del CU4:
//
//   "Un grupo de consumidores nuevo lee el topic desde el inicio y completa el
//    histórico sin tocar los demás servicios."
//
// Por eso está separado de index.js y usa el grupo "analitica-tiempos": la
// primera vez que se lanza no tiene offsets guardados, así que arranca en el
// primer evento de envios.estados (desdeInicio: true) y reconstruye el histórico
// completo; después sigue en vivo con los eventos nuevos.
//
// Demo (paso 8): se activa RECIÉN cuando el sistema ya está en marcha.
//   npm run analitica:tiempos        (o el botón del panel de demo)
//
// Para relanzarlo desde cero hay que vaciar los offsets del grupo; ver
// `npm run reconstruir -- --todo` en el README.

const { consumir } = require('../../shared/kafka');
const { conTransaccion, registrarEventoProcesado } = require('../../shared/db');
const { TOPICS, GRUPOS } = require('../../shared/eventos');
const { log } = require('../../shared/logger');
const T = require('../../shared/tiempo');

const SERVICIO = 'analitica-tiempos';

// Estado interno en memoria: shipmentId -> { ultimaSecuencia, ingresoMs }
//   ingresoMs = ocurridoEn del INGRESADO_HUB, o null si ya se usó.
// Al consumir EN_REPARTO se mide la demora y se OLVIDA el ingreso: si el envío
// vuelve a salir después de un reintento (CLASIFICADO -> EN_REPARTO sin un nuevo
// INGRESADO_HUB), no se mide dos veces con el mismo ingreso.
const memoria = new Map();

function crearEstado() {
  return { ultimaSecuencia: 0, ingresoMs: null };
}

// Demora acumulada en la fila (fecha, hub): media = suma_ms / muestras.
async function acumular(client, fecha, hubId, demoraMs) {
  await client.query(
    `INSERT INTO metricas_tiempos (fecha, hub_id, muestras, suma_ms)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (fecha, hub_id) DO UPDATE SET
       muestras = metricas_tiempos.muestras + 1,
       suma_ms  = metricas_tiempos.suma_ms + EXCLUDED.suma_ms`,
    [fecha, hubId, demoraMs]
  );
}

async function manejar(evento, ubicacion) {
  if (ubicacion.topic !== TOPICS.ESTADOS) return; // solo los estados interesan

  const previo = memoria.get(evento.shipmentId) || crearEstado();

  // Misma regla de orden que el resto de los servicios: un evento viejo no vuelve
  // a medir (ni a retroceder la secuencia).
  if (evento.secuencia <= previo.ultimaSecuencia) {
    log(SERVICIO, `evento descartado: fuera de orden (secuencia ${evento.secuencia} <= ${previo.ultimaSecuencia})`, {
      shipmentId: evento.shipmentId,
      eventId: evento.eventId,
      ...ubicacion,
    });
    return;
  }
  const base = { ...previo, ultimaSecuencia: evento.secuencia };

  let nuevo = base;
  let medicion = null;

  if (evento.tipo === 'INGRESADO_HUB') {
    // Anota cuándo ingresó; la medición se hace cuando salga.
    nuevo = { ...base, ingresoMs: T.aMs(evento.ocurridoEn) };
  } else if (evento.tipo === 'EN_REPARTO' && previo.ingresoMs !== null) {
    const demoraMs = T.aMs(evento.ocurridoEn) - previo.ingresoMs;
    nuevo = { ...base, ingresoMs: null }; // ya se usó este ingreso (no medir dos veces)
    if (evento.hubId && demoraMs >= 0) {
      medicion = {
        fecha: new Date(T.aMs(evento.ocurridoEn)).toISOString().slice(0, 10),
        hubId: evento.hubId,
        demoraMs,
      };
    }
  }
  // EN_REPARTO sin ingreso registrado (o cualquier otro estado): solo avanza la
  // secuencia para que un evento viejo no se cuente después.

  const confirmado = await conTransaccion(async (client) => {
    const esNuevo = await registrarEventoProcesado(client, GRUPOS.ANALITICA_TIEMPOS, evento.eventId);
    if (!esNuevo) {
      log(SERVICIO, 'evento duplicado descartado', { eventId: evento.eventId, ...ubicacion });
      return false;
    }
    if (medicion) await acumular(client, medicion.fecha, medicion.hubId, medicion.demoraMs);
    return true;
  });

  if (confirmado) {
    memoria.set(evento.shipmentId, nuevo);
    if (medicion) {
      log(SERVICIO, 'demora de hub medida', {
        shipmentId: evento.shipmentId,
        hubId: medicion.hubId,
        demoraMinutos: Math.round(medicion.demoraMs / 60000),
        ...ubicacion,
      });
    }
  }
}

async function main() {
  await consumir({
    servicio: SERVICIO,
    groupId: GRUPOS.ANALITICA_TIEMPOS,
    topics: [TOPICS.ESTADOS],
    // EL PUNTO ENTERO DE ESTE SERVICIO: grupo nuevo -> desde el primer evento.
    desdeInicio: true,
    manejar,
  });
  log(SERVICIO, 'reprocesando histórico y siguiendo en vivo', {
    grupo: GRUPOS.ANALITICA_TIEMPOS,
    desdeInicio: true,
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { manejar };
