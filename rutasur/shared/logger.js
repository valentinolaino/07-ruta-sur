// Log simple con formato común: hora, servicio, mensaje y datos extra en JSON.

function log(servicio, mensaje, extra = {}) {
  const hora = new Date().toISOString();
  const datos =
    Object.keys(extra).length > 0 ? " " + JSON.stringify(extra) : "";
  console.log(`${hora} [${servicio}] ${mensaje}${datos}`);
}

function logError(servicio, mensaje, error, extra = {}) {
  const hora = new Date().toISOString();
  const datos =
    Object.keys(extra).length > 0 ? " " + JSON.stringify(extra) : "";
  console.error(`${hora} [${servicio}] ERROR ${mensaje}${datos}`);
  if (error) console.error(error);
}

module.exports = { log, logError };
