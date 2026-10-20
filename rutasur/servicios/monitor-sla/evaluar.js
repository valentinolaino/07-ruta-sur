const T = require("../../shared/tiempo");
const {
  TOPICS,
  REGLAS_SLA,
  PRIORIDAD_POR_REGLA,
  TIPO_ALERTA_CERRADA,
  crearEvento,
} = require("../../shared/eventos");

const RANK_ESTADO = {
  CREADO: 1,
  INGRESADO_HUB: 2,
  CLASIFICADO: 3,
  EN_REPARTO: 4,
  ENTREGA_FALLIDA: 4, // ya salió a reparto; el fallo no lo "devuelve" al hub
  ENTREGADO: 5,
};

const rank = (estado) => RANK_ESTADO[estado] ?? 0;

const HORA = T.HORA;
function evaluar({ estado, venceMs, ahoraMs }) {
  // Sin promesa no hay SLA; entregado no está en riesgo; y un envío del que todavía
  // no vimos NINGÚN estado (solo la promesa releída del topic compactado) no se
  // evalúa: podría ser uno que ya se entregó hace días.
  if (!venceMs || !estado || estado === "ENTREGADO") return [];

  const faltan = venceMs - ahoraMs;
  const reglas = [];

  if (ahoraMs > venceMs) reglas.push("VENCIDO");

  if (estado === "ENTREGA_FALLIDA" && T.mismoDia(venceMs, ahoraMs)) {
    reglas.push("FALLO_DIA_LIMITE");
  }

  if (faltan > 0 && faltan < 4 * HORA && rank(estado) < 4)
    reglas.push("SIN_SALIDA");
  if (faltan > 0 && faltan < 10 * HORA && rank(estado) < 2)
    reglas.push("SIN_INGRESO");

  return reglas;
}

// "Sin repetición": filtra las reglas que YA alertaron sobre este envío.
function pendientes(reglas, yaAlertadas) {
  return reglas.filter((r) => !yaAlertadas.includes(r));
}

// Texto explicativo que viaja en el campo "causa" de la alerta (lo muestra la torre).
function causa(regla, { estado, venceMs, ahoraMs }) {
  const horas = ((venceMs - ahoraMs) / HORA || 0).toFixed(1);
  switch (regla) {
    case "VENCIDO":
      return `promesa vencida el ${new Date(venceMs).toISOString()} y el envío está en ${estado}`;
    case "FALLO_DIA_LIMITE":
      return `entrega fallida el día límite (promesa hasta el ${new Date(venceMs).toISOString().slice(0, 10)})`;
    case "SIN_SALIDA":
      return `faltan ${horas} h para el vencimiento y el envío no salió a reparto (estado: ${estado})`;
    case "SIN_INGRESO":
      return `faltan ${horas} h para el vencimiento y el envío no ingresó al hub (estado: ${estado})`;
    default:
      return null;
  }
}

function aplicar(previo, evento, topic) {
  const ocurridoMs = T.aMs(evento.ocurridoEn);

  if (!previo) {
    previo = {
      shipmentId: evento.shipmentId,
      estado: "", // '' = todavía no vimos ningún estado (la columna es NOT NULL)
      hubId: null,
      zonaId: null,
      venceMs: null,
      ultimaSecuencia: 0,
      reglasAlertadas: [],
      terminado: false,
      ultimoOcurridoMs: 0,
    };
  }

  if (topic === TOPICS.PROMESAS) {
    const venceMs = T.aMs(evento.venceEn);
    const sinCambios =
      venceMs === previo.venceMs &&
      (evento.hubId ?? null) === (previo.hubId ?? null);
    if (sinCambios)
      return { estado: previo, cambiado: false, motivo: "promesa sin cambios" };
    return {
      estado: {
        ...previo,
        venceMs,
        hubId: evento.hubId ?? previo.hubId,
        zonaId: evento.zonaId ?? previo.zonaId,
        ultimoOcurridoMs: Math.max(previo.ultimoOcurridoMs, ocurridoMs),
      },
      cambiado: true,
    };
  }

  // envios.estados: regla de orden. Un evento viejo NUNCA retrocede el estado.
  if (evento.secuencia <= previo.ultimaSecuencia) {
    return {
      estado: previo,
      cambiado: false,
      motivo: `fuera de orden (secuencia ${evento.secuencia} <= ${previo.ultimaSecuencia})`,
    };
  }

  return {
    estado: {
      ...previo,
      estado: evento.tipo,
      hubId: evento.hubId ?? previo.hubId,
      zonaId: evento.zonaId ?? previo.zonaId,
      ultimaSecuencia: evento.secuencia,
      terminado: evento.tipo === "ENTREGADO",
      ultimoOcurridoMs: Math.max(previo.ultimoOcurridoMs, ocurridoMs),
    },
    cambiado: true,
  };
}

function alertaAbierta({ regla, estado, ahoraMs, eventId }) {
  return crearEvento({
    shipmentId: estado.shipmentId,
    tipo: regla,
    secuencia: Math.max(estado.ultimaSecuencia, 1),
    ocurridoEn: new Date(ahoraMs).toISOString(),
    hubId: estado.hubId,
    zonaId: estado.zonaId,
    prioridad: PRIORIDAD_POR_REGLA[regla],
    causa: causa(regla, {
      estado: estado.estado,
      venceMs: estado.venceMs,
      ahoraMs,
    }),
    origen: "monitor-sla",
    eventId, // crea el id aleatorio y lo pisa con el derivado
  });
}

// Cierre: llega ENTREGADO y el monitor apaga las alertas que había abierto.
function alertaCerrada({ estado, ocurridoEn, eventId }) {
  return crearEvento({
    shipmentId: estado.shipmentId,
    tipo: TIPO_ALERTA_CERRADA,
    secuencia: Math.max(estado.ultimaSecuencia, 1),
    ocurridoEn,
    hubId: estado.hubId,
    zonaId: estado.zonaId,
    origen: "monitor-sla",
    eventId,
  });
}

module.exports = {
  RANK_ESTADO,
  rank,
  evaluar,
  pendientes,
  causa,
  aplicar,
  alertaAbierta,
  alertaCerrada,
  REGLAS_SLA,
  PRIORIDAD_POR_REGLA,
};
