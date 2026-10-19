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
                         AND promesa_vence_en - now() < interval '6 hours'
                         AND promesa_vence_en > now())                        AS en_riesgo,
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
      AND promesa_vence_en > now()
      AND promesa_vence_en - now() < ($1 || ' hours')::interval
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
export async function indicadores() {
  const [totales, tiempos, dias] = await Promise.all([
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
      FROM metricas_diarias
    `),
    filas(`
      SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
             hub_id, muestras, suma_ms,
             ROUND((suma_ms::numeric / NULLIF(muestras, 0)), 1) AS promedio_ms
      FROM metricas_tiempos
      ORDER BY fecha DESC, promedio_ms DESC NULLS LAST
      LIMIT 30
    `),
    filas(`
      SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha,
             SUM(entregas_total)              AS entregas,
             SUM(entregas_primer_intento)     AS primer_intento,
             SUM(fallos_total)                AS fallos,
             SUM(sla_cumplidos)               AS sla_cumplidos,
             SUM(sla_incumplidos)             AS sla_incumplidos
      FROM metricas_diarias
      GROUP BY fecha
      ORDER BY fecha DESC
      LIMIT 14
    `),
  ]);
  return { totales: totales[0] || {}, tiempos, dias };
}

// ------------------------------------------------------------------ tracking
// Acepta el shipment_id completo (ENV-000001) o una parte (ENV-000, 1, ...).
export async function buscarPorCodigo(codigo) {
  const termino = String(codigo || "").trim();
  if (!termino) return null;
  const [exacto] = await filas(
    `SELECT * FROM envios WHERE shipment_id = $1`,
    [termino.toUpperCase()]
  );
  if (exacto) return exacto;
  const [parcial] = await filas(
    `SELECT * FROM envios WHERE shipment_id ILIKE $1
      ORDER BY shipment_id LIMIT 1`,
    [`%${termino}%`]
  );
  return parcial || null;
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
