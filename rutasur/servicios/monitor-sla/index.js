const { consumir, crearProductor, publicar } = require("../../shared/kafka");
const { conTransaccion, registrarEventoProcesado } = require("../../shared/db");
const { TOPICS, GRUPOS, idDerivado } = require("../../shared/eventos");
const { log, logError } = require("../../shared/logger");
const {
  evaluar,
  pendientes,
  aplicar,
  alertaAbierta,
  alertaCerrada,
  PRIORIDAD_POR_REGLA,
} = require("./evaluar");
const respaldo = require("./respaldo");

const SERVICIO = "monitor-sla";

const TICK_MS = Number(process.env.MONITOR_TICK_MS) || 500;

// Estado en memoria: shipmentId -> objeto del monitor (el respaldo está en respaldo.js)
const abiertos = new Map();

let ahoraSim = 0;

// Se asigna en main(). El tick y el consumo de eventos publican con él.
let productor = null;

// El id del envío con la regla es la clave de "sin repetición" en todo el sistema.
const idAlerta = (shipmentId, regla) =>
  idDerivado("alerta", `${shipmentId}:${regla}`);

// ---------------------------------------------------------------------------
// Consumo de eventos
// ---------------------------------------------------------------------------
async function manejar(evento, ubicacion) {
  const estFinal = await conTransaccion(async (client) => {
    // Idempotencia: ¿ya apliqué este eventId? Entonces es un duplicado.
    const esNuevo = await registrarEventoProcesado(
      client,
      GRUPOS.MONITOR_SLA,
      evento.eventId,
    );
    if (!esNuevo) {
      log(SERVICIO, "evento duplicado descartado", {
        eventId: evento.eventId,
        ...ubicacion,
      });
      return null;
    }

    // El respaldo (no la memoria) es la verdad dentro de la transacción: así el tick
    // y el consumo de eventos no pueden abrir dos veces la misma regla.
    const previo = await respaldo.leer(client, evento.shipmentId);
    const {
      estado: nuevo,
      cambiado,
      motivo,
    } = aplicar(previo, evento, ubicacion.topic);

    if (!cambiado) {
      log(SERVICIO, `evento descartado: ${motivo}`, {
        shipmentId: evento.shipmentId,
        eventId: evento.eventId,
        ...ubicacion,
      });
      return null;
    }

    if (nuevo.ultimoOcurridoMs > ahoraSim) ahoraSim = nuevo.ultimoOcurridoMs;
    const ahoraLocal = Math.max(ahoraSim, nuevo.ultimoOcurridoMs);

    // "Evaluación al recibir cada evento": reglas que aplican con el estado nuevo.
    const reglas = pendientes(
      evaluar({ ...nuevo, ahoraMs: ahoraLocal }),
      nuevo.reglasAlertadas,
    );
    // El cierre solo corresponde si tenía alertas abiertas y recién ahora se entrega.
    const cerrar = nuevo.terminado && nuevo.reglasAlertadas.length > 0;

    const conAlertas = {
      ...nuevo,
      reglasAlertadas: [...nuevo.reglasAlertadas, ...reglas],
    };
    await respaldo.guardar(client, conAlertas);

    for (const regla of reglas) {
      await publicar(
        productor,
        TOPICS.ALERTAS_SLA,
        alertaAbierta({
          regla,
          estado: conAlertas,
          ahoraMs: ahoraLocal,
          eventId: idAlerta(conAlertas.shipmentId, regla),
        }),
      );
      log(
        SERVICIO,
        `alerta ABIERTA: ${regla} (prioridad ${PRIORIDAD_POR_REGLA[regla]})`,
        {
          shipmentId: conAlertas.shipmentId,
          estado: conAlertas.estado,
          eventId: evento.eventId,
          ...ubicacion,
        },
      );
    }

    if (cerrar) {
      await publicar(
        productor,
        TOPICS.ALERTAS_SLA,
        alertaCerrada({
          estado: conAlertas,
          ocurridoEn: evento.ocurridoEn,
          eventId: idDerivado("alerta-cierre", conAlertas.shipmentId),
        }),
      );
      log(SERVICIO, "alertas CERRADAS (envío entregado)", {
        shipmentId: conAlertas.shipmentId,
        cerradas: conAlertas.reglasAlertadas,
        ...ubicacion,
      });
    }

    return conAlertas;
  });

  // Recién después del COMMIT se sincroniza la memoria (si falló, queda como estaba
  // y el evento se reintenta limpio).
  if (estFinal) {
    if (estFinal.terminado) abiertos.delete(estFinal.shipmentId);
    else abiertos.set(estFinal.shipmentId, estFinal);
  }
}

// ---------------------------------------------------------------------------
// Tick: "además, cada minuto para todos los envíos abiertos"
// ---------------------------------------------------------------------------
async function evaluarTodos() {
  if (ahoraSim === 0) return; // todavía no vimos eventos: no hay "ahora" simulado

  for (const [shipmentId, est] of abiertos) {
    const candidatas = pendientes(
      evaluar({ ...est, ahoraMs: ahoraSim }),
      est.reglasAlertadas,
    );

    for (const regla of candidatas) {
      try {
        const abierto = await conTransaccion(async (client) => {
          const actual = await respaldo.leer(client, shipmentId);
          if (!actual || actual.terminado) return null; // entregó mientras tanto

          const ahoraLocal = Math.max(ahoraSim, actual.ultimoOcurridoMs);
          if (
            !pendientes(
              evaluar({ ...actual, ahoraMs: ahoraLocal }),
              actual.reglasAlertadas,
            ).includes(regla)
          ) {
            return null; // otra vía ya la evaluó y descartó (o ya abrió la misma regla)
          }
          // Guardia atómica: si la fila ya tiene la regla, otra corrida la ganó.
          const tocada = await respaldo.agregarRegla(client, shipmentId, regla);
          if (!tocada) return null;

          const alerta = alertaAbierta({
            regla,
            estado: {
              ...actual,
              reglasAlertadas: [...actual.reglasAlertadas, regla],
            },
            ahoraMs: ahoraLocal,
            eventId: idAlerta(shipmentId, regla),
          });
          await publicar(productor, TOPICS.ALERTAS_SLA, alerta);
          return {
            est: {
              ...actual,
              reglasAlertadas: [...actual.reglasAlertadas, regla],
            },
            alerta,
          };
        });

        if (abierto) {
          const enMemoria = abiertos.get(shipmentId);
          if (enMemoria)
            enMemoria.reglasAlertadas = abierto.est.reglasAlertadas;
          log(
            SERVICIO,
            `alerta ABIERTA por tick: ${regla} (prioridad ${abierto.alerta.prioridad})`,
            {
              shipmentId,
              causa: abierto.alerta.causa,
              relojSimulado: new Date(ahoraSim).toISOString(),
            },
          );
        }
      } catch (error) {
        // Una alerta que falla no frena el resto del tick: se reintentará en la próxima vuelta.
        logError(SERVICIO, `no se pudo abrir la alerta ${regla}`, error, {
          shipmentId,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function main() {
  productor = await crearProductor(`${SERVICIO}-productor`);

  for (const est of await respaldo.cargarAbiertos())
    abiertos.set(est.shipmentId, est);
  ahoraSim = await respaldo.maxOcurrido();

  await consumir({
    servicio: SERVICIO,
    groupId: GRUPOS.MONITOR_SLA,
    topics: [
      {
        nombre: TOPICS.ESTADOS,
        desdeInicio: process.env.MONITOR_DESDE_INICIO === "1",
      },
      { nombre: TOPICS.PROMESAS, desdeInicio: true },
    ],
    manejar,
  });
  log(SERVICIO, "escuchando eventos", {
    grupo: GRUPOS.MONITOR_SLA,
    enviosAbiertos: abiertos.size,
    relojSimulado: ahoraSim
      ? new Date(ahoraSim).toISOString()
      : "sin eventos todavía",
    tickMs: TICK_MS,
  });

  // 3) El tick del "paso del tiempo".
  setInterval(() => {
    evaluarTodos().catch((error) =>
      logError(SERVICIO, "error en el tick de evaluación", error),
    );
  }, TICK_MS);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { manejar, evaluarTodos, abiertos };
