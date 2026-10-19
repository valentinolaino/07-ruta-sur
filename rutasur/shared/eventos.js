// Catálogo de eventos de RutaSur: nombres de topics, estados, motivos,
// esquema de validación y una función para crear eventos válidos.

const crypto = require('node:crypto');
const Ajv = require('ajv');

// ---------------------------------------------------------------------------
// 1. Constantes del catálogo (tal cual el PDF)
// ---------------------------------------------------------------------------

const TOPICS = {
  ESTADOS: 'envios.estados',
  PROMESAS: 'envios.promesas',
  REPROGRAMACIONES: 'envios.reprogramaciones',
  ALERTAS_SLA: 'alertas.sla',
  NOTIFICACIONES: 'notificaciones.enviadas',
  DLQ: 'envios.estados.dlq',
};

// Nombre del grupo de consumidores de cada servicio.
// Dos servicios con grupos distintos reciben TODOS los eventos del mismo topic.
const GRUPOS = {
  PROYECTOR: 'proyector',
  NOTIFICACIONES: 'notificaciones',
  REPROGRAMACION: 'reprogramacion',
  MONITOR_SLA: 'monitor-sla',
  ANALITICA: 'analitica',
};

const TIPOS_ESTADO = [
  'CREADO',
  'INGRESADO_HUB',
  'CLASIFICADO',
  'EN_REPARTO',
  'ENTREGADO',
  'ENTREGA_FALLIDA',
];

const MOTIVOS_FALLO = ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE'];

// Versión actual del esquema de los eventos (campo "version").
const VERSION_ESQUEMA = 1;

// --- Eventos que publican los servicios (no el simulador) ---

// envios.reprogramaciones: la decisión del servicio de reprogramación tras un fallo.
//   REPROGRAMADO -> hay nuevo intento (campo proximoIntento)
//   RETENIDO     -> dirección incorrecta: espera una corrección, no se reprograma sola
//   DEVOLUCION   -> rechazo, o tercer fallo: vuelve al comercio
const TIPOS_REPROGRAMACION = ['REPROGRAMADO', 'RETENIDO', 'DEVOLUCION'];

// alertas.sla: el "tipo" de una alerta ABIERTA es el nombre de la regla que la disparó;
// cuando el envío se entrega, el monitor emite ALERTA_CERRADA.
const REGLAS_SLA = ['SIN_INGRESO', 'SIN_SALIDA', 'FALLO_DIA_LIMITE', 'VENCIDO'];
const TIPO_ALERTA_CERRADA = 'ALERTA_CERRADA';
const PRIORIDAD_POR_REGLA = {
  SIN_INGRESO: 'MEDIA',
  SIN_SALIDA: 'ALTA',
  FALLO_DIA_LIMITE: 'ALTA',
  VENCIDO: 'CRITICA',
};

// notificaciones.enviadas
const TIPOS_NOTIFICACION = ['NOTIFICACION_FALLO', 'NOTIFICACION_ALERTA'];

// ---------------------------------------------------------------------------
// 2. Esquemas JSON
// JSON Schema es un estándar para describir cómo debe ser un JSON.
// La librería "ajv" lo usa para decir si un evento es válido y por qué no.
// ---------------------------------------------------------------------------

// Campos comunes a todo evento (tabla "Campos comunes a todo evento" del PDF).
const propiedadesComunes = {
  eventId: { type: 'string', minLength: 1 }, // identificador único: permite descartar duplicados
  shipmentId: { type: 'string', minLength: 1 }, // clave de partición y de correlación
  tipo: { type: 'string', minLength: 1 }, // estado o tipo de evento
  ocurridoEn: { type: 'string', minLength: 1 }, // cuándo pasó en el mundo real (la fecha se chequea aparte)
  secuencia: { type: 'integer', minimum: 1 }, // creciente por envío: detecta eventos fuera de orden
  hubId: { type: ['string', 'null'] }, // dimensiones para la analítica
  zonaId: { type: ['string', 'null'] },
  repartidorId: { type: ['string', 'null'] },
  version: { type: 'integer', minimum: 1 }, // versión del esquema
};

const camposObligatorios = ['eventId', 'shipmentId', 'tipo', 'ocurridoEn', 'secuencia', 'version'];

const esquemaBase = {
  type: 'object',
  required: camposObligatorios,
  properties: propiedadesComunes,
  additionalProperties: true, // cada tipo de evento puede sumar sus propios campos
};

// Esquema de envios.estados: suma la restricción de "tipo" y el motivo del fallo.
const esquemaEstado = {
  type: 'object',
  required: camposObligatorios,
  properties: {
    ...propiedadesComunes,
    tipo: { enum: TIPOS_ESTADO },
    motivo: { enum: MOTIVOS_FALLO },
  },
  additionalProperties: true,
  // Regla condicional: SI tipo es ENTREGA_FALLIDA, ENTONCES hace falta motivo,
  // y hub y zona deben estar informados (la analítica los necesita).
  if: { properties: { tipo: { const: 'ENTREGA_FALLIDA' } }, required: ['tipo'] },
  then: {
    required: ['motivo', 'hubId', 'zonaId'],
    properties: { hubId: { type: 'string' }, zonaId: { type: 'string' } },
  },
};

// allowUnionTypes permite escribir type: ['string', 'null'].
// allErrors hace que ajv informe TODOS los problemas y no solo el primero.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validarBase = ajv.compile(esquemaBase);
const validarEstado = ajv.compile(esquemaEstado);

// Los topics de los servicios suman a los campos comunes una restricción sobre "tipo"
// y los campos propios que el proyector necesita. Se mantienen livianos a propósito.
const esquemaPromesa = {
  ...esquemaBase,
  required: [...camposObligatorios, 'venceEn'],
  properties: { ...propiedadesComunes, tipo: { const: 'PROMESA' }, venceEn: { type: 'string', minLength: 1 } },
};
const esquemaReprogramacion = {
  ...esquemaBase,
  required: [...camposObligatorios, 'intento'],
  properties: {
    ...propiedadesComunes,
    tipo: { enum: TIPOS_REPROGRAMACION },
    intento: { type: 'integer', minimum: 1 },
  },
};
const esquemaAlerta = {
  ...esquemaBase,
  properties: { ...propiedadesComunes, tipo: { enum: [...REGLAS_SLA, TIPO_ALERTA_CERRADA] } },
};
const esquemaNotificacion = {
  ...esquemaBase,
  properties: { ...propiedadesComunes, tipo: { enum: TIPOS_NOTIFICACION } },
};

// Cada topic puede tener su validador; si no tiene, se usa el base.
const validadoresPorTopic = {
  [TOPICS.ESTADOS]: validarEstado,
  [TOPICS.PROMESAS]: ajv.compile(esquemaPromesa),
  [TOPICS.REPROGRAMACIONES]: ajv.compile(esquemaReprogramacion),
  [TOPICS.ALERTAS_SLA]: ajv.compile(esquemaAlerta),
  [TOPICS.NOTIFICACIONES]: ajv.compile(esquemaNotificacion),
};

// ---------------------------------------------------------------------------
// 3. Validación
// ---------------------------------------------------------------------------

// Devuelve { valido: true, errores: [] } o { valido: false, errores: ['...'] }
function validarEvento(topic, evento) {
  const validar = validadoresPorTopic[topic] || validarBase;
  const errores = [];

  if (!validar(evento)) {
    for (const e of validar.errors) {
      const campo = e.instancePath || '(evento)';
      errores.push(`${campo} ${e.message}`);
    }
  }

  // ajv no verifica que un texto sea una fecha real; lo chequeamos nosotros.
  if (evento && typeof evento.ocurridoEn === 'string' && Number.isNaN(Date.parse(evento.ocurridoEn))) {
    errores.push('/ocurridoEn no es una fecha válida (se espera formato ISO, ej: 2026-10-17T16:00:00Z)');
  }

  return { valido: errores.length === 0, errores };
}

// ---------------------------------------------------------------------------
// 4. Crear eventos
// ---------------------------------------------------------------------------

// Arma un evento con todos los campos comunes. Lo usará el simulador y los servicios
// que publican eventos propios (alertas, notificaciones, reprogramaciones).
// "datos" trae lo obligatorio: shipmentId, tipo y secuencia; el resto es opcional.
function crearEvento({
  shipmentId,
  tipo,
  secuencia,
  ocurridoEn = new Date().toISOString(), // el simulador pasará su reloj simulado
  hubId = null,
  zonaId = null,
  repartidorId = null,
  ...extra // campos propios del evento (motivo, regla, prioridad, etc.)
}) {
  return {
    eventId: crypto.randomUUID(),
    shipmentId,
    tipo,
    ocurridoEn,
    secuencia,
    hubId,
    zonaId,
    repartidorId,
    version: VERSION_ESQUEMA,
    ...extra,
  };
}

// ID DERIVADO: un eventId que se calcula a partir del evento que lo causó, en vez de
// ser aleatorio. Si un servicio se cae después de publicar y antes de confirmar el offset,
// al reiniciar reprocesa el mismo evento y publica OTRA VEZ la reacción, pero con el
// MISMO eventId. El consumidor que la recibe la detecta como duplicado y la descarta.
// Así, "al menos una vez" en el transporte se convierte en "una vez" en el resultado.
//
//   idDerivado('notificacion', evento.eventId)  -> siempre el mismo UUID para ese evento
function idDerivado(prefijo, eventIdOrigen) {
  const h = crypto.createHash('sha256').update(`${prefijo}:${eventIdOrigen}`).digest('hex');
  // formato UUID v4 (versión y variante fijadas)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

module.exports = {
  TOPICS,
  GRUPOS,
  TIPOS_ESTADO,
  MOTIVOS_FALLO,
  VERSION_ESQUEMA,
  TIPOS_REPROGRAMACION,
  REGLAS_SLA,
  TIPO_ALERTA_CERRADA,
  PRIORIDAD_POR_REGLA,
  TIPOS_NOTIFICACION,
  validarEvento,
  crearEvento,
  idDerivado,
};
