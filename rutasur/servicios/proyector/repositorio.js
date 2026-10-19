// Acceso a PostgreSQL del proyector: traduce entre filas SQL y los "documentos" del reducer.

const { documentoVacio } = require('./reducer');

const aIso = (valor) => (valor instanceof Date ? valor.toISOString() : valor ?? null);

function filaADocumento(fila) {
  return {
    shipmentId: fila.shipment_id,
    estado: fila.estado,
    hubId: fila.hub_id,
    zonaId: fila.zona_id,
    repartidorId: fila.repartidor_id,
    promesaVenceEn: aIso(fila.promesa_vence_en),
    intentos: fila.intentos,
    motivoFallo: fila.motivo_fallo,
    reprogramacion: fila.reprogramacion,
    historial: fila.historial,
    ultimaSecuencia: fila.ultima_secuencia,
  };
}

// Lee el envío BLOQUEANDO la fila hasta el final de la transacción (FOR UPDATE).
// Si hay dos procesos del proyector, no pueden pisarse el mismo envío a la vez.
// Si el envío no existe todavía (llegó antes la promesa o una reprogramación que su
// CREADO), se crea vacío: ultima_secuencia = 0, así el CREADO real se aplica después.
async function leerEnvio(client, shipmentId) {
  await client.query(
    `INSERT INTO envios (shipment_id, estado) VALUES ($1, 'CREADO') ON CONFLICT (shipment_id) DO NOTHING`,
    [shipmentId]
  );
  const { rows } = await client.query('SELECT * FROM envios WHERE shipment_id = $1 FOR UPDATE', [shipmentId]);
  return rows.length ? filaADocumento(rows[0]) : documentoVacio(shipmentId);
}

// Guarda el documento. Un UPDATE dispara el trigger que hace NOTIFY y avisa a la interfaz.
async function guardarEnvio(client, doc) {
  await client.query(
    `UPDATE envios SET
       estado = $2, hub_id = $3, zona_id = $4, repartidor_id = $5,
       promesa_vence_en = $6, intentos = $7, motivo_fallo = $8,
       reprogramacion = $9, historial = $10, ultima_secuencia = $11,
       actualizado_en = now()
     WHERE shipment_id = $1`,
    [
      doc.shipmentId,
      doc.estado,
      doc.hubId,
      doc.zonaId,
      doc.repartidorId,
      doc.promesaVenceEn,
      doc.intentos,
      doc.motivoFallo,
      // pg convierte los arrays de JS a "arrays de Postgres"; para una columna JSONB
      // hay que pasarle el texto JSON ya armado.
      doc.reprogramacion === null ? null : JSON.stringify(doc.reprogramacion),
      JSON.stringify(doc.historial),
      doc.ultimaSecuencia,
    ]
  );
}

// Una alerta se abre una sola vez por (envío, regla): "sin repetición".
async function abrirAlerta(client, evento) {
  const r = await client.query(
    `INSERT INTO alertas (shipment_id, regla, prioridad, causa, creada_en)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (shipment_id, regla) DO NOTHING`,
    [evento.shipmentId, evento.tipo, evento.prioridad, evento.causa ?? null, evento.ocurridoEn]
  );
  return r.rowCount === 1;
}

// Cierra todas las alertas abiertas del envío (llegó ENTREGADO).
async function cerrarAlertas(client, evento) {
  const r = await client.query(
    `UPDATE alertas SET estado = 'CERRADA', cerrada_en = $2
     WHERE shipment_id = $1 AND estado = 'ABIERTA'`,
    [evento.shipmentId, evento.ocurridoEn]
  );
  return r.rowCount;
}

// event_id UNIQUE: si el evento se reprocesa, no se duplica la notificación.
async function registrarNotificacion(client, evento) {
  const r = await client.query(
    `INSERT INTO notificaciones (event_id, shipment_id, tipo, mensaje, opciones, creada_en)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      evento.eventId,
      evento.shipmentId,
      evento.tipo,
      evento.mensaje ?? null,
      evento.opciones ? JSON.stringify(evento.opciones) : null,
      evento.ocurridoEn,
    ]
  );
  return r.rowCount === 1;
}

// Las alertas y notificaciones no cambian la fila del envío, pero el detalle del envío en
// la interfaz las muestra. Tocar actualizado_en dispara el NOTIFY y la pantalla se refresca.
async function tocarEnvio(client, shipmentId) {
  await client.query('UPDATE envios SET actualizado_en = now() WHERE shipment_id = $1', [shipmentId]);
}

module.exports = { leerEnvio, guardarEnvio, abrirAlerta, cerrarAlertas, registrarNotificacion, tocarEnvio };
