// Reglas de la ANALÍTICA (CU4) como funciones puras: no tocan Kafka ni la base.
//
// Convierte los eventos en los tres indicadores de negocio del PDF:
//
//   1. Tasa de entrega en primer intento  -> ¿dónde y cuándo fallamos más?
//      (zona, franja horaria, día)
//   2. Distribución de motivos de fallo   -> ¿por qué fallamos?
//      (zona, motivo)
//   3. Cumplimiento de SLA                -> ¿qué hub llega tarde?
//      (hub, día)
//
// El cuarto indicador (tiempo medio INGRESADO_HUB -> EN_REPARTO por hub) vive en
// tiempos.js: es el del REPROCESAMIENTO y usa otro grupo de consumidores.
//
// Estado interno por envío (en memoria, ver index.js):
//   { ultimaSecuencia, fallos, promesaVenceMs }
//   - ultimaSecuencia -> la misma regla de orden del proyector: un evento viejo
//     (el simulador inyecta un 2 % fuera de orden) no debe volver a contar.
//   - fallos          -> ¿el ENTREGADO fue en primer intento?
//   - promesaVenceMs  -> para el indicador 3 la analítica necesita la fecha
//     prometida; viene de envios.promesas (único tema en el que el catálogo del
//     PDF se extiende: la tabla lo reserva al monitor, ver README/decisiones).

const { TOPICS } = require('../../shared/eventos');
const T = require('../../shared/tiempo');

// Columna de metricas_diarias que suma cada motivo de fallo.
const COLUMNA_MOTIVO = {
  AUSENTE: 'fallos_ausente',
  DIRECCION_INCORRECTA: 'fallos_direccion',
  RECHAZADO: 'fallos_rechazo',
  ZONA_INACCESIBLE: 'fallos_zona',
};

const COLUMNAS_DIMENSION = ['fecha', 'zona_id', 'franja', 'hub_id'];

function crearEstado() {
  return { ultimaSecuencia: 0, fallos: 0, promesaVenceMs: null };
}

// Día (UTC) y franja del instante en que ocurrió el evento: son las dimensiones
// de los tres indicadores ("zona, franja horaria, día" / "hub, día").
function dimensiones(evento) {
  const ms = T.aMs(evento.ocurridoEn);
  if (!evento.hubId || !evento.zonaId) return null; // sin dimensiones no hay fila
  return {
    fecha: new Date(ms).toISOString().slice(0, 10),
    zona_id: evento.zonaId,
    franja: T.franjaDe(ms),
    hub_id: evento.hubId,
  };
}

// ---------------------------------------------------------------------------
// proyectar(estado, evento, topic) -> { estado, fila, aplicado, motivo }
//
//   estado  objeto NUEVO (nunca se muta el anterior)
//   fila    fila a sumar en metricas_diarias, o null si este evento no aporta
//   aplicado=false -> el evento no cambia nada (duplicado u fuera de orden):
//                     ni se registra como procesado ni se cuenta.
// ---------------------------------------------------------------------------
function proyectar(estado, evento, topic) {
  const ocurridoMs = T.aMs(evento.ocurridoEn);

  // --- envios.promesas: solo recuerda el vencimiento (no es un indicador) ---
  if (topic === TOPICS.PROMESAS) {
    const venceMs = T.aMs(evento.venceEn);
    if (venceMs === estado.promesaVenceMs) {
      return { estado, fila: null, aplicado: false, motivo: 'promesa sin cambios' };
    }
    return { estado: { ...estado, promesaVenceMs: venceMs }, fila: null, aplicado: true };
  }

  // --- envios.estados: regla de orden ---
  if (evento.secuencia <= estado.ultimaSecuencia) {
    return {
      estado,
      fila: null,
      aplicado: false,
      motivo: `fuera de orden (secuencia ${evento.secuencia} <= ${estado.ultimaSecuencia})`,
    };
  }
  const base = { ...estado, ultimaSecuencia: evento.secuencia };

  if (evento.tipo === 'ENTREGADO') {
    const dim = dimensiones(evento);
    if (!dim) return { estado: base, fila: null, aplicado: true, motivo: 'sin dimensiones' };

    const contadores = { entregas_total: 1 };
    // Primer intento = se entregó sin ningún ENTREGA_FALLIDA previo.
    if (estado.fallos === 0) contadores.entregas_primer_intento = 1;
    // SLA: se cumple si la entrega no pasó de la fecha prometida.
    // Sin promesa conocida (aún no llegó envios.promesas) no se cuenta: no se puede juzgar.
    if (estado.promesaVenceMs) {
      if (ocurridoMs <= estado.promesaVenceMs) contadores.sla_cumplidos = 1;
      else contadores.sla_incumplidos = 1;
    }
    return { estado: base, fila: { ...dim, ...contadores }, aplicado: true };
  }

  if (evento.tipo === 'ENTREGA_FALLIDA') {
    const dim = dimensiones(evento);
    if (!dim) return { estado: base, fila: null, aplicado: true, motivo: 'sin dimensiones' };
    const columnaMotivo = COLUMNA_MOTIVO[evento.motivo];
    if (!columnaMotivo) return { estado: base, fila: null, aplicado: true, motivo: `motivo desconocido: ${evento.motivo}` };
    return {
      estado: { ...base, fallos: estado.fallos + 1 },
      fila: { ...dim, fallos_total: 1, [columnaMotivo]: 1 },
      aplicado: true,
    };
  }

  // Los demás estados (CREADO, INGRESADO_HUB, ...) no aportan indicadores,
  // pero avanzan la secuencia para que un evento viejo no se cuente después.
  return { estado: base, fila: null, aplicado: true };
}

// Columnas de contador de una fila (las que se suman; las dimensiones no).
function contadoresDe(fila) {
  return Object.keys(fila).filter((c) => !COLUMNAS_DIMENSION.includes(c));
}

module.exports = { crearEstado, dimensiones, proyectar, contadoresDe, COLUMNA_MOTIVO, COLUMNAS_DIMENSION };
