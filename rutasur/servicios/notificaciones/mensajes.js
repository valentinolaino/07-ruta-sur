// Textos y opciones de las notificaciones simuladas (no se envía ningún mail ni SMS:
// el servicio solo registra qué se le habría avisado al destinatario).

const { TOPICS } = require('../../shared/eventos');

const OPCIONES_REPROGRAMAR = [
  { codigo: 'REPROGRAMAR_MANANA', texto: 'Reprogramar para la mañana' },
  { codigo: 'REPROGRAMAR_TARDE', texto: 'Reprogramar para la tarde' },
  { codigo: 'RETIRAR_EN_SUCURSAL', texto: 'Retirar en la sucursal' },
];

const MENSAJES_FALLO = {
  AUSENTE: {
    mensaje: 'No pudimos entregar tu paquete porque no había nadie. Elegí cuándo volvemos a intentarlo.',
    opciones: OPCIONES_REPROGRAMAR,
  },
  DIRECCION_INCORRECTA: {
    mensaje: 'La dirección de entrega parece incorrecta. Confirmanos la dirección para poder seguir.',
    opciones: [{ codigo: 'CORREGIR_DIRECCION', texto: 'Corregir la dirección' }],
  },
  RECHAZADO: {
    mensaje: 'El paquete fue rechazado en la entrega y volverá al comercio.',
    opciones: [],
  },
  ZONA_INACCESIBLE: {
    mensaje: 'No pudimos acceder a tu zona. Vamos a intentarlo nuevamente.',
    opciones: OPCIONES_REPROGRAMAR,
  },
};

const MENSAJES_ALERTA = {
  SIN_INGRESO: 'Tu envío todavía no llegó a nuestro centro de distribución. Estamos trabajando para cumplir la fecha prometida.',
  SIN_SALIDA: 'Tu envío está en el centro de distribución y la entrega prometida se acerca. Lo estamos priorizando.',
  FALLO_DIA_LIMITE: 'No pudimos entregar tu envío el día prometido. Te contactamos para coordinar una nueva entrega.',
  VENCIDO: 'Tu envío no llegó en la fecha prometida. Pedimos disculpas: ya estamos resolviéndolo.',
};

// Devuelve { tipo, mensaje, opciones } para el evento recibido, o null si ese evento
// no genera aviso (por ejemplo un CLASIFICADO, o el cierre de una alerta).
function construirNotificacion(topic, evento) {
  if (topic === TOPICS.ESTADOS && evento.tipo === 'ENTREGA_FALLIDA') {
    const base = MENSAJES_FALLO[evento.motivo];
    if (!base) return null;
    return { tipo: 'NOTIFICACION_FALLO', mensaje: base.mensaje, opciones: base.opciones };
  }
  if (topic === TOPICS.ALERTAS_SLA && MENSAJES_ALERTA[evento.tipo]) {
    return { tipo: 'NOTIFICACION_ALERTA', mensaje: MENSAJES_ALERTA[evento.tipo], opciones: [] };
  }
  return null;
}

module.exports = { construirNotificacion };
