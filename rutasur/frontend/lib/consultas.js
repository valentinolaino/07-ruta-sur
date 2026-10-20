// Consultas del frontend contra las vistas de Postgres.
// Todas las pantallas leen acá; ninguna habla con Kafka directamente
// (la entrada en vivo llega por SSE y el router.refresh() de Next).
//
// OJO: se usa SOLO el esquema real de db/init.sql:
//   envios(shipment_id, estado, hub_id, zona_id, repartidor_id, promesa_vence_en,
//          intentos, motivo_fallo, reprogramacion, historial, ultima_secuencia, actualizado_en)
//   historial es JSONB con entradas {eventId, tipo, ocurridoEn, secuencia, origen}

import { pool } from "./db";

async function filas(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// Hito de entrega: ocurridoEn del último evento ENTREGADO del historial.
const ENTREGA_EN = `
  (SELECT h->>'ocurridoEn'
     FROM jsonb_array_elements(e.historial) h
    WHERE h->>'tipo' = 'ENTREGADO'
    ORDER BY h->>'ocurridoEn' DESC
    LIMIT 1)`;

// Reloj SIMULADO: el mayor ocurridoEn que vio el monitor de SLA (monitor_sla). Es el
// mismo "ahora" que usan las alertas; con el factor de aceleración el reloj de la
// máquina (now()) no sirve para decidir qué está "en riesgo". Si todavía no hay
// eventos, cae a now().
const AHORA_SIM = `(SELECT COALESCE(MAX(ultimo_ocurrido_en), now()) FROM monitor_sla)`;

// ---------------------------------------------------------------- CU1 / torre
export async function kpisTorre() {
  const [r] = await filas(`
    SELECT
      COUNT(*) FILTER (WHERE estado NOT IN ('ENTREGADO','DEVOLUCION'))       AS activos,
      COUNT(*) FILTER (WHERE estado = 'EN_REPARTO')                           AS en_reparto,
      COUNT(*) FILTER (WHERE estado = 'ENTREGADO'
                         AND (${ENTREGA_EN})::timestamptz <= promesa_vence_en) AS en_tiempo,
      COUNT(*) FILTER (WHERE estado = 'ENTREGADO'
                         AND (${ENTREGA_EN})::timestamptz >  promesa_vence_en) AS tarde,
      COUNT(*) FILTER (WHERE estado IN ('ENTREGA_FALLIDA','REPROGRAMADO',
                                        'RETENIDO','DEVOLUCION'))            AS fallas,
      COUNT(*) FILTER (WHERE estado NOT IN ('ENTREGADO','DEVOLUCION')
                         AND promesa_vence_en - ${AHORA_SIM} < interval '6 hours'
                         AND promesa_vence_en > ${AHORA_SIM})                 AS en_riesgo,
      COUNT(*) FILTER (WHERE estado = 'REPROGRAMADO')                         AS reprogramados
    FROM envios e
  `);
  return r;
}

// Proyección: envíos por hora-ventana de la promesa (barras del embudo).
export async function proyeccionPorHora() {
  return filas(`
    SELECT to_char(promesa_vence_en, 'YYYY-MM-DD HH24:00') AS ventana,
           to_char(promesa_vence_en, 'HH24:00')            AS hora,
           COUNT(*) FILTER (WHERE estado = 'ENTREGADO'
                              AND (${ENTREGA_EN})::timestamptz <= promesa_vence_en) AS en_tiempo,
           COUNT(*) FILTER (WHERE estado = 'ENTREGADO'
                              AND (${ENTREGA_EN})::timestamptz >  promesa_vence_en) AS tarde,
           COUNT(*) FILTER (WHERE estado NOT IN ('ENTREGADO','DEVOLUCION'))  AS pendientes
    FROM envios e
    GROUP BY 1, 2
    ORDER BY 1
  `);
}

// Envíos de la tabla principal (los más recientes primero).
export async function listarEnvios({ limite = 40, estado = null } = {}) {
  const params = [];
  let where = "";
  if (estado) {
    params.push(estado);
    where = "WHERE e.estado = $1";
  }
  params.push(limite);
  return filas(`
    SELECT e.shipment_id, e.estado, e.hub_id, e.zona_id, e.repartidor_id,
           e.promesa_vence_en, e.intentos, e.motivo_fallo, e.reprogramacion,
           e.actualizado_en, e.historial,
           (SELECT COUNT(*) FROM alertas a
             WHERE a.shipment_id = e.shipment_id AND a.estado = 'ABIERTA') AS alertas_abiertas
    FROM envios e
    ${where}
    ORDER BY e.actualizado_en DESC
    LIMIT $${params.length}
  `, params);
}

// Detalle del embudo por estado (para las columnas de la torre).
export async function conteoPorEstado() {
  return filas(`
    SELECT estado, COUNT(*) AS total
    FROM envios
    GROUP BY estado
  `);
}

// ------------------------------------------------------------- CU1 / detalle
export async function detalleEnvio(id) {
  const [envio] = await filas(`SELECT * FROM envios WHERE shipment_id = $1`, [id]);
  if (!envio) return null;
  const [alertas, notificaciones] = await Promise.all([
    filas(
      `SELECT * FROM alertas WHERE shipment_id = $1
        ORDER BY creada_en DESC, id DESC`,
      [id]
    ),
    filas(
      `SELECT * FROM notificaciones WHERE shipment_id = $1
        ORDER BY creada_en DESC, id DESC`,
      [id]
    ),
  ]);
  return { envio, alertas, notificaciones };
}

// Línea de tiempo: viene embebida en envios.historial (se lee junto al estado).
export async function movimientosEnvio(id) {
  const [r] = await filas(
    `SELECT historial FROM envios WHERE shipment_id = $1`,
    [id]
  ).catch(() => [null]);
  if (!r || !r.historial) return [];
  return [...r.historial]
    .filter((h) => h && h.tipo)
    .sort((a, b) => String(b.ocurridoEn).localeCompare(String(a.ocurridoEn)));
}

// ------------------------------------------------------------------ CU2 / SLA
// Regla de riesgo: la promesa vence dentro de menos de RIESGO_HORAS.
export async function enviosEnRiesgo({ riesgoHoras = 6 } = {}) {
  return filas(`
    SELECT * FROM envios
    WHERE estado NOT IN ('ENTREGADO','DEVOLUCION')
      AND promesa_vence_en IS NOT NULL
      AND promesa_vence_en > ${AHORA_SIM}
      AND promesa_vence_en - ${AHORA_SIM} < ($1 || ' hours')::interval
    ORDER BY promesa_vence_en ASC
    LIMIT 60
  `, [riesgoHoras]);
}

// Alertas recientes (panel derecho del CU3).
export async function alertasRecientes({ limite = 40 } = {}) {
  return filas(`
    SELECT * FROM alertas
    ORDER BY creada_en DESC NULLS LAST, id DESC
    LIMIT $1
  `, [limite]);
}

// Cola de alertas ABIERTAS de la torre, priorizada: crítica > alta > media y, a igual
// prioridad, la más antigua primero.
export async function colaAlertas({ limite = 15 } = {}) {
  return filas(`
    SELECT * FROM alertas
    WHERE estado = 'ABIERTA'
    ORDER BY CASE prioridad WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END,
             creada_en ASC, id ASC
    LIMIT $1
  `, [limite]);
}

// Historial de alertas de una regla (para mostrar el cierre).
export async function historialAlertas(regla, { limite = 20 } = {}) {
  return filas(`
    SELECT * FROM alertas
    WHERE regla = $1
    ORDER BY creada_en DESC NULLS LAST, id DESC
    LIMIT $2
  `, [regla, limite]);
}

// --------------------------------------------------------------- CU4 / analítica
// Filtros opcionales: { zona, hub, desde, hasta } (fechas AAAA-MM-DD).
// Se arma un WHERE parametrizado y se reutiliza en todas las consultas.
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;

function dondeMetricas({ zona, hub, desde, hasta } = {}) {
  const cond = [];
  const params = [];
  if (zona) { params.push(zona); cond.push(`zona_id = $${params.length}`); }
  if (hub) { params.push(hub); cond.push(`hub_id = $${params.length}`); }
  if (desde && FECHA_OK.test(desde)) { params.push(desde); cond.push(`fecha >= $${params.length}`); }
  if (hasta && FECHA_OK.test(hasta)) { params.push(hasta); cond.push(`fecha <= $${params.length}`); }
  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

export async function indicadores(filtros = {}) {
  const { where, params } = dondeMetricas(filtros);
  // metricas_tiempos no tiene zona: solo se filtra por hub y fecha.
  const t = dondeMetricas({ hub: filtros.hub, desde: filtros.desde, hasta: filtros.hasta });

  const [totales, tiempos, dias, porZonaFranja, motivosPorZona, slaPorHubDia, opciones] =
    await Promise.all([
      filas(`
        SELECT
          COALESCE(SUM(entregas_total), 0)              AS entregas,
          COALESCE(SUM(entregas_primer_intento), 0)     AS primer_intento,
          COALESCE(SUM(fallos_total), 0)                AS fallos,
          COALESCE(SUM(fallos_ausente), 0)              AS ausente,
          COALESCE(SUM(fallos_direccion), 0)            AS direccion,
          COALESCE(SUM(fallos_rechazo), 0)              AS rechazo,
          COALESCE(SUM(fallos_zona), 0)                 AS zona,
          COALESCE(SUM(sla_cumplidos), 0)               AS sla_cumplidos,
          COALESCE(SUM(sla_incumplidos), 0)             AS sla_incumplidos
        FROM metricas_diarias ${where}
      `, params),
      filas(`
        SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
               hub_id, muestras, suma_ms,
               ROUND((suma_ms::numeric / NULLIF(muestras, 0)), 1) AS promedio_ms
        FROM metricas_tiempos ${t.where}
        ORDER BY fecha DESC, promedio_ms DESC NULLS LAST
        LIMIT 30
      `, t.params),
      filas(`
        SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
               SUM(entregas_total)              AS entregas,
               SUM(entregas_primer_intento)     AS primer_intento,
               SUM(fallos_total)                AS fallos,
               SUM(sla_cumplidos)               AS sla_cumplidos,
               SUM(sla_incumplidos)             AS sla_incumplidos
        FROM metricas_diarias ${where}
        GROUP BY fecha
        ORDER BY fecha DESC
        LIMIT 14
      `, params),
      // Indicador 1: ¿dónde y cuándo fallamos más? (zona x franja), más fallos primero.
      filas(`
        SELECT zona_id, franja,
               SUM(entregas_total)          AS entregas,
               SUM(entregas_primer_intento) AS primer_intento,
               SUM(fallos_total)            AS fallos
        FROM metricas_diarias ${where}
        GROUP BY zona_id, franja
        ORDER BY SUM(fallos_total) DESC, zona_id, franja
      `, params),
      // Indicador 2: ¿por qué fallamos? (zona x motivo)
      filas(`
        SELECT zona_id,
               SUM(fallos_total)     AS fallos,
               SUM(fallos_ausente)   AS ausente,
               SUM(fallos_direccion) AS direccion,
               SUM(fallos_rechazo)   AS rechazo,
               SUM(fallos_zona)      AS zona
        FROM metricas_diarias ${where}
        GROUP BY zona_id
        ORDER BY SUM(fallos_total) DESC, zona_id
      `, params),
      // Indicador 3: ¿qué hub llega tarde? (hub x día)
      filas(`
        SELECT hub_id, to_char(fecha, 'YYYY-MM-DD') AS fecha,
               SUM(sla_cumplidos)   AS cumplidos,
               SUM(sla_incumplidos) AS incumplidos
        FROM metricas_diarias ${where}
        GROUP BY hub_id, fecha
        ORDER BY fecha DESC, SUM(sla_incumplidos) DESC, hub_id
        LIMIT 60
      `, params),
      // Opciones de los filtros (sin aplicar filtros, para poder cambiar de selección).
      filas(`
        SELECT ARRAY(SELECT DISTINCT zona_id FROM metricas_diarias ORDER BY 1) AS zonas,
               ARRAY(SELECT DISTINCT hub_id  FROM metricas_diarias ORDER BY 1) AS hubs
      `),
    ]);

  return {
    totales: totales[0] || {},
    tiempos,
    dias,
    porZonaFranja,
    motivosPorZona,
    slaPorHubDia,
    opciones: opciones[0] || { zonas: [], hubs: [] },
  };
}

// ------------------------------------------------------------------ tracking
// TRACKING PÚBLICO: lo ve el destinatario, así que devuelve SOLO lo que le sirve:
// el estado, la fecha estimada y una línea de tiempo de hitos. Nada interno
// (repartidor, zona, hub, intentos, motivo del fallo, secuencias, alertas, etc.).
// El código tiene que ser EXACTO (ENV-000001): una búsqueda parcial dejaría
// "adivinar" envíos de otras personas.
const HITOS_PUBLICOS = new Set([
  "CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO",
  "ENTREGADO", "ENTREGA_FALLIDA", "REPROGRAMADO", "RETENIDO", "DEVOLUCION",
]);

export async function trackingPublico(codigo) {
  let termino = String(codigo || "").trim().toUpperCase();
  if (!termino) return null;
  // Comodidad: si escriben solo el número (513, 000513) se completa a ENV-000513.
  // Sigue siendo una búsqueda EXACTA: no se listan ni se adivinan otros envíos.
  if (/^\d{1,6}$/.test(termino)) termino = `ENV-${termino.padStart(6, "0")}`;
  const [e] = await filas(
    `SELECT shipment_id, estado, promesa_vence_en, reprogramacion, historial
       FROM envios WHERE shipment_id = $1`,
    [termino]
  );
  if (!e) return null;

  const hitos = (e.historial || [])
    .filter((h) => h && HITOS_PUBLICOS.has(h.tipo))
    .map((h) => ({ tipo: h.tipo, ocurridoEn: h.ocurridoEn }))
    .sort((a, b) => String(a.ocurridoEn).localeCompare(String(b.ocurridoEn)));

  // Fecha estimada: si hay un nuevo intento programado, esa; si no, la promesa original.
  const nuevo = e.reprogramacion && e.reprogramacion.proximoIntento;
  return {
    codigo: e.shipment_id,
    estado: e.estado,
    fechaEstimada: nuevo ? nuevo.fecha : e.promesa_vence_en,
    nuevoIntento: nuevo ? { fecha: nuevo.fecha, franja: nuevo.franja } : null,
    hitos,
  };
}

// Tracking PÚBLICO (destinatario): solo coincidencia EXACTA del código (la búsqueda parcial
// dejaría recorrer envíos ajenos) y solo columnas no internas. No se leen alertas,
// notificaciones, repartidor, zona, hub ni intentos.
const ETQ_PUBLICA = {
  CREADO: "Envío registrado",
  INGRESADO_HUB: "Llegó al centro de distribución",
  CLASIFICADO: "Preparado para el reparto",
  EN_REPARTO: "En camino",
  ENTREGADO: "Entregado",
  ENTREGA_FALLIDA: "No pudimos entregarlo",
  REPROGRAMADO: "Nuevo intento programado",
  RETENIDO: "Retenido: necesitamos corregir la dirección",
  DEVOLUCION: "Se devuelve al comercio",
};

export async function envioPublico(codigo) {
  const termino = String(codigo || "").trim().toUpperCase();
  if (!termino) return null;
  const [e] = await filas(
    `SELECT shipment_id, estado, promesa_vence_en, reprogramacion, historial, actualizado_en
       FROM envios WHERE shipment_id = $1`,
    [termino]
  );
  if (!e) return null;

  // Fecha estimada: la del próximo intento si hay reprogramación; no aplica a los estados finales.
  let estimada = null;
  const prox = e.reprogramacion && e.reprogramacion.proximoIntento;
  if (e.estado === "REPROGRAMADO" && prox) estimada = { fecha: prox.fecha, franja: prox.franja };
  else if (!["ENTREGADO", "RETENIDO", "DEVOLUCION"].includes(e.estado) && e.promesa_vence_en) {
    estimada = { fecha: new Date(e.promesa_vence_en).toISOString(), franja: null };
  }

  // Línea de tiempo: solo estados del envío (sin motivo, secuencia, origen ni ids).
  const vistos = new Set();
  const linea = (e.historial || [])
    .filter((h) => h && h.origen === "envios.estados" && ETQ_PUBLICA[h.tipo])
    .sort((a, b) => String(a.ocurridoEn).localeCompare(String(b.ocurridoEn)))
    .filter((h) => (vistos.has(h.eventId) ? false : vistos.add(h.eventId)))
    .map((h) => ({ etiqueta: ETQ_PUBLICA[h.tipo], ocurridoEn: h.ocurridoEn }));

  return {
    codigo: e.shipment_id,
    estado: e.estado,
    etiqueta: ETQ_PUBLICA[e.estado] || "En proceso",
    estimada,
    actualizadoEn: e.actualizado_en,
    linea,
  };
}

// Último evento "ocurrido en" de toda la base: marca el reloj simulado.
export async function ultimaActividad() {
  try {
    const [r] = await filas(`
      SELECT MAX(t) AS t FROM (
        SELECT actualizado_en AS t FROM envios
        UNION ALL
        SELECT creada_en FROM notificaciones
      ) x
    `);
    return r && r.t;
  } catch (e) {
    return null;
  }
}
