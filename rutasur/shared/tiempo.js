// Utilidades de tiempo compartidas (las usan el simulador y, más adelante,
// el servicio de reprogramación y el monitor de SLA).
//
// El "reloj simulado" viaja dentro de los eventos (campo ocurridoEn). Para que los
// resultados no dependan de la zona horaria de la máquina, TODO se calcula en UTC.

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

// Franjas horarias de entrega.
//   MANANA: antes de las 13:00   |   TARDE: desde las 13:00
const FRANJAS = ['MANANA', 'TARDE'];
const HORA_CORTE_FRANJA = 13;

// Hora (UTC) a la que arranca el reparto de cada franja.
const INICIO_FRANJA = { MANANA: 9, TARDE: 15 };

// Acepta milisegundos, un Date o un texto ISO.
function aMs(valor) {
  return valor instanceof Date ? valor.getTime() : typeof valor === 'number' ? valor : Date.parse(valor);
}

function franjaDe(valor) {
  return new Date(aMs(valor)).getUTCHours() < HORA_CORTE_FRANJA ? 'MANANA' : 'TARDE';
}

function franjaOpuesta(franja) {
  return franja === 'MANANA' ? 'TARDE' : 'MANANA';
}

// Lunes a viernes (no se contemplan feriados).
function esDiaHabil(valor) {
  const dia = new Date(aMs(valor)).getUTCDay(); // 0 = domingo, 6 = sábado
  return dia !== 0 && dia !== 6;
}

// Medianoche (UTC) del día que contiene el instante dado.
function inicioDelDia(valor) {
  const ms = aMs(valor);
  return ms - (((ms % DIA) + DIA) % DIA);
}

// Medianoche (UTC) del próximo día hábil, estrictamente posterior al día del instante dado.
function siguienteDiaHabil(valor) {
  let ms = inicioDelDia(valor) + DIA;
  while (!esDiaHabil(ms)) ms += DIA;
  return ms;
}

// Instante en el que arranca el reparto de una franja, en el día que contiene "diaMs".
function inicioDeFranja(diaMs, franja) {
  return inicioDelDia(diaMs) + INICIO_FRANJA[franja] * HORA;
}

// ¿Los dos instantes caen en el mismo día (UTC)? Sirve para la regla "la promesa vence hoy".
function mismoDia(a, b) {
  return inicioDelDia(a) === inicioDelDia(b);
}

module.exports = {
  HORA,
  DIA,
  FRANJAS,
  aMs,
  franjaDe,
  franjaOpuesta,
  esDiaHabil,
  inicioDelDia,
  siguienteDiaHabil,
  inicioDeFranja,
  mismoDia,
};
