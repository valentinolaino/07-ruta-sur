// Reglas de reprogramación (CU2) como función pura.
//
// Entrada: el motivo del fallo, el número de intento que acaba de fallar y cuándo ocurrió.
// Salida:  { tipo, proximoIntento, razon }
//   tipo = REPROGRAMADO | RETENIDO | DEVOLUCION   (ver TIPOS_REPROGRAMACION en eventos.js)
//
// Reglas del PDF, en este orden de prioridad:
//   - Tercer intento fallido, cualquiera sea el motivo -> DEVOLUCION al comercio
//   - AUSENTE              -> nuevo intento el día hábil siguiente, en la franja OPUESTA a la del fallo
//   - DIRECCION_INCORRECTA -> RETENIDO hasta una corrección (no se reprograma sola)
//   - RECHAZADO            -> DEVOLUCION al comercio
//   - ZONA_INACCESIBLE     -> el PDF no la define. Supuesto: nuevo intento el día hábil
//                             siguiente, en la MISMA franja (no hay nada que "evitar").

const T = require('../../shared/tiempo');

const MAX_INTENTOS = 3;

function formatoFecha(ms) {
  return new Date(ms).toISOString().slice(0, 10); // AAAA-MM-DD
}

function decidir({ motivo, intento, ocurridoEn }) {
  if (intento >= MAX_INTENTOS) {
    return { tipo: 'DEVOLUCION', proximoIntento: null, razon: `tercer intento fallido (${motivo})` };
  }

  switch (motivo) {
    case 'AUSENTE': {
      const franja = T.franjaOpuesta(T.franjaDe(ocurridoEn));
      return {
        tipo: 'REPROGRAMADO',
        proximoIntento: { fecha: formatoFecha(T.siguienteDiaHabil(ocurridoEn)), franja },
        razon: 'ausente: día hábil siguiente, franja opuesta',
      };
    }
    case 'ZONA_INACCESIBLE':
      return {
        tipo: 'REPROGRAMADO',
        proximoIntento: {
          fecha: formatoFecha(T.siguienteDiaHabil(ocurridoEn)),
          franja: T.franjaDe(ocurridoEn),
        },
        razon: 'zona inaccesible: día hábil siguiente, misma franja',
      };
    case 'DIRECCION_INCORRECTA':
      return { tipo: 'RETENIDO', proximoIntento: null, razon: 'dirección incorrecta: retenido hasta corrección' };
    case 'RECHAZADO':
      return { tipo: 'DEVOLUCION', proximoIntento: null, razon: 'rechazado por el destinatario' };
    default:
      // El esquema ya valida el motivo; esto es una red de seguridad.
      throw new Error(`motivo de fallo desconocido: ${motivo}`);
  }
}

module.exports = { decidir, MAX_INTENTOS };
