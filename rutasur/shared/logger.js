// Log simple con formato común: hora, servicio, mensaje y datos extra en JSON.
//
// Requisito no funcional de observabilidad: cada servicio registra eventId,
// partición y offset. Con un formato único es fácil buscar un evento en los logs.

function log(servicio, mensaje, extra = {}) {
  const hora = new Date().toISOString();
  const datos = Object.keys(extra).length > 0 ? ' ' + JSON.stringify(extra) : '';
  console.log(`${hora} [${servicio}] ${mensaje}${datos}`);
}

function logError(servicio, mensaje, error, extra = {}) {
  const hora = new Date().toISOString();
  const datos = Object.keys(extra).length > 0 ? ' ' + JSON.stringify(extra) : '';
  console.error(`${hora} [${servicio}] ERROR ${mensaje}${datos}`);
  if (error) console.error(error);
}

module.exports = { log, logError };
