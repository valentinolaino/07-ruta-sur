const { pool } = require("../../shared/db");

function filaAFila(fila) {
  return {
    shipmentId: fila.shipment_id,
    estado: fila.estado,
    hubId: fila.hub_id,
    zonaId: fila.zona_id,
    venceMs: fila.vence_en ? fila.vence_en.getTime() : null,
    ultimaSecuencia: fila.ultima_secuencia,
    reglasAlertadas: fila.reglas_alertadas || [],
    terminado: fila.terminado,
    ultimoOcurridoMs: fila.ultimo_ocurrido_en.getTime(),
  };
}

async function leer(client, shipmentId) {
  const { rows } = await client.query(
    "SELECT * FROM monitor_sla WHERE shipment_id = $1 FOR UPDATE",
    [shipmentId],
  );
  return rows.length ? filaAFila(rows[0]) : null;
}

// Crea o actualiza el estado de un envío (upsert completo).
async function guardar(client, est) {
  await client.query(
    `INSERT INTO monitor_sla
       (shipment_id, estado, hub_id, zona_id, vence_en, ultima_secuencia,
        reglas_alertadas, terminado, ultimo_ocurrido_en, actualizado_en)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7, $8, to_timestamp($9 / 1000.0), now())
     ON CONFLICT (shipment_id) DO UPDATE SET
       estado = EXCLUDED.estado,
       hub_id = EXCLUDED.hub_id,
       zona_id = EXCLUDED.zona_id,
       vence_en = EXCLUDED.vence_en,
       ultima_secuencia = EXCLUDED.ultima_secuencia,
       reglas_alertadas = EXCLUDED.reglas_alertadas,
       terminado = EXCLUDED.terminado,
       ultimo_ocurrido_en = EXCLUDED.ultimo_ocurrido_en,
       actualizado_en = now()`,
    [
      est.shipmentId,
      est.estado,
      est.hubId,
      est.zonaId,
      est.venceMs,
      est.ultimaSecuencia,
      JSON.stringify(est.reglasAlertadas),
      est.terminado,
      est.ultimoOcurridoMs,
    ],
  );
}

// Anota una regla como ya alertada. Devuelve true si la agregó (tocó la fila):
// si otro camino ya la había anotado, devuelve false y NO hay que publicar de nuevo.
async function agregarRegla(client, shipmentId, regla) {
  const r = await client.query(
    `UPDATE monitor_sla
        SET reglas_alertadas = reglas_alertadas || $2::jsonb,
            actualizado_en = now()
      WHERE shipment_id = $1
        AND NOT reglas_alertadas @> $2::jsonb`,
    [shipmentId, JSON.stringify([regla])],
  );
  return r.rowCount === 1;
}

// Carga al arrancar todos los envíos ABERTOS (sin entregar).
async function cargarAbiertos() {
  const { rows } = await pool.query(
    "SELECT * FROM monitor_sla WHERE terminado = false ORDER BY shipment_id",
  );
  return rows.map(filaAFila);
}

// El mayor ocurridoEn visto = por dónde va el reloj simulado. Se usa al arrancar
// para no arrancar "en cero" después de un reinicio.
async function maxOcurrido() {
  const { rows } = await pool.query(
    "SELECT MAX(ultimo_ocurrido_en) AS max FROM monitor_sla",
  );
  return rows[0] && rows[0].max ? rows[0].max.getTime() : 0;
}

module.exports = { leer, guardar, agregarRegla, cargarAbiertos, maxOcurrido };
