// Reglas del MONITOR DE SLA (CU3) como funciones puras: no tocan Kafka ni la base.
//
// El monitor no reacciona solo a eventos: evalúa el PASO DEL TIEMPO. Cruza el
// último estado de cada envío con su promesa de entrega y, si el riesgo crece,
// emite una alerta en alertas.sla ANTES del vencimiento.
//
// Las cuatro reglas del PDF, con su prioridad:
//   VENCIDO          -> CRITICA   pasó el vencimiento sin ENTREGADO
//   FALLO_DIA_LIMITE -> ALTA      ENTREGA_FALLIDA y la promesa vence hoy
//   SIN_SALIDA       -> ALTA      faltan < 4 h y el envío no salió a reparto
//   SIN_INGRESO      -> MEDIA     faltan < 10 h y el envío no ingresó al hub
//
// "Ahora" SIEMPRE es el reloj simulado (el mayor campo ocurridoEn visto), nunca
// el reloj de la máquina: con el factor de aceleración, el tiempo real corre
// 120 veces más rápido que el de los eventos y las alertas no dispararían a tiempo.

const T = require('../../shared/tiempo');
const { TOPICS, REGLAS_SLA, PRIORIDAD_POR_REGLA, TIPO_ALERTA_CERRADA, crearEvento } = require('../../shared/eventos');

// "Avance" de cada estado en el circuito del envío. Sirve para responder:
//   ¿ingresó al hub?          rank >= 2
//   ¿salió a reparto?         rank >= 4
// Un envío sin estados conocidos tiene rank 0 (recién creado o solo con promesa).
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

// Devuelve las reglas que aplican AHORA, de mayor a menor severidad.
//   estado    último estado del envío (envios.estados)
//   venceMs   vencimiento de la promesa en ms (null si aún no llegó envios.promesas)
//   ahoraMs   reloj simulado actual en ms
//
// Notas de lectura del PDF:
//   - SIN_INGRESO y SIN_SALIDA solo aplican ANTES del vencimiento: una vez vencido,
//     "faltan menos de 10 h" sería técnicamente cierto para siempre y la alerta
//     VENCIDO (CRITICA) es la que corresponde.
//   - FALLO_DIA_LIMITE es independiente: mientras la promesa venza HOY, aplica
//     aunque ya haya pasado la hora (el día límite se cumplió o no).
function evaluar({ estado, venceMs, ahoraMs }) {
  // Sin promesa no hay SLA; entregado no está en riesgo; y un envío del que todavía
  // no vimos NINGÚN estado (solo la promesa releída del topic compactado) no se
  // evalúa: podría ser uno que ya se entregó hace días.
  if (!venceMs || !estado || estado === 'ENTREGADO') return [];

  const faltan = venceMs - ahoraMs;
  const reglas = [];

  if (ahoraMs > venceMs) reglas.push('VENCIDO');

  if (estado === 'ENTREGA_FALLIDA' && T.mismoDia(venceMs, ahoraMs)) {
    reglas.push('FALLO_DIA_LIMITE');
  }

  if (faltan > 0 && faltan < 4 * HORA && rank(estado) < 4) reglas.push('SIN_SALIDA');
  if (faltan > 0 && faltan < 10 * HORA && rank(estado) < 2) reglas.push('SIN_INGRESO');

  return reglas;
}

// "Sin repetición": filtra las reglas que YA alertaron sobre este envío.
function pendientes(reglas, yaAlertadas) {
  return reglas.filter((r) => !yaAlertadas.includes(r));
}

// Texto explicativo que viaja en el campo "causa" de la alerta (lo muestra la torre).
function causa(regla, { estado, venceMs, ahoraMs }) {
  const horas = (((venceMs - ahoraMs) / HORA) || 0).toFixed(1);
  switch (regla) {
    case 'VENCIDO':
      return `promesa vencida el ${new Date(venceMs).toISOString()} y el envío está en ${estado}`;
    case 'FALLO_DIA_LIMITE':
      return `entrega fallida el día límite (promesa hasta el ${new Date(venceMs).toISOString().slice(0, 10)})`;
    case 'SIN_SALIDA':
      return `faltan ${horas} h para el vencimiento y el envío no salió a reparto (estado: ${estado})`;
    case 'SIN_INGRESO':
      return `faltan ${horas} h para el vencimiento y el envío no ingresó al hub (estado: ${estado})`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Transición del estado interno del monitor al llegar un evento.
//
//   aplicar(previo, evento, topic) -> { estado, cambiado, motivo }
//
//   previo  objeto del monitor para ese envío (o null si es el primero)
//   estado  objeto NUEVO (nunca se muta el anterior)
//   cambiado=false -> el evento no cambia nada (duplicado u fuera de orden) y ni
//                     se persiste ni se evalúa.
//
// Dos reglas análogas a las del proyector, porque el simulador puede inyectar
// eventos duplicados (2 %) y fuera de orden (2 %):
//   - orden: secuencia menor o igual a la ya vista -> se descarta;
//   - el reloj simulado (ultimoOcurridoMs) jamás retrocede.
// ---------------------------------------------------------------------------
function aplicar(previo, evento, topic) {
  const ocurridoMs = T.aMs(evento.ocurridoEn);

  if (!previo) {
    previo = {
      shipmentId: evento.shipmentId,
      estado: '', // '' = todavía no vimos ningún estado (la columna es NOT NULL)
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
    const sinCambios = venceMs === previo.venceMs && (evento.hubId ?? null) === (previo.hubId ?? null);
    if (sinCambios) return { estado: previo, cambiado: false, motivo: 'promesa sin cambios' };
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
      terminado: evento.tipo === 'ENTREGADO',
      ultimoOcurridoMs: Math.max(previo.ultimoOcurridoMs, ocurridoMs),
    },
    cambiado: true,
  };
}

// ---------------------------------------------------------------------------
// Armado de los eventos que publica el monitor (alertas.sla)
// ---------------------------------------------------------------------------

// Alerta ABIERTA: el "tipo" es el nombre de la regla que la disparó.
// El eventId es DERIVADO (envío + regla): si el monitor se cae y reevalúa, o un
// offset se relee, sale el MISMO id y el resto del sistema lo descarta como duplicado.
function alertaAbierta({ regla, estado, ahoraMs, eventId }) {
  return crearEvento({
    shipmentId: estado.shipmentId,
    tipo: regla,
    secuencia: Math.max(estado.ultimaSecuencia, 1),
    ocurridoEn: new Date(ahoraMs).toISOString(),
    hubId: estado.hubId,
    zonaId: estado.zonaId,
    prioridad: PRIORIDAD_POR_REGLA[regla],
    causa: causa(regla, { estado: estado.estado, venceMs: estado.venceMs, ahoraMs }),
    origen: 'monitor-sla',
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
    origen: 'monitor-sla',
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
