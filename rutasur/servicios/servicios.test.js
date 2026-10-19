// Tests de las reglas de reprogramación, los mensajes de notificación y los ids derivados.
// Se ejecutan con:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { decidir } = require('./reprogramacion/decidir');
const { construirNotificacion } = require('./notificaciones/mensajes');
const { TOPICS, idDerivado, validarEvento, crearEvento, PRIORIDAD_POR_REGLA, REGLAS_SLA } = require('../shared/eventos');

// Lunes 19/10/2026 10:00 UTC = franja MANANA | 15:00 = franja TARDE | viernes 23/10 10:00
const LUNES_MANANA = '2026-10-19T10:00:00.000Z';
const LUNES_TARDE = '2026-10-19T15:00:00.000Z';
const VIERNES_MANANA = '2026-10-23T10:00:00.000Z';

// --- decidir (reglas de reprogramación) ---

test('AUSENTE a la mañana: nuevo intento el día hábil siguiente, por la tarde', () => {
  const d = decidir({ motivo: 'AUSENTE', intento: 1, ocurridoEn: LUNES_MANANA });
  assert.equal(d.tipo, 'REPROGRAMADO');
  assert.deepEqual(d.proximoIntento, { fecha: '2026-10-20', franja: 'TARDE' });
});

test('AUSENTE a la tarde: nuevo intento por la mañana', () => {
  const d = decidir({ motivo: 'AUSENTE', intento: 1, ocurridoEn: LUNES_TARDE });
  assert.equal(d.proximoIntento.franja, 'MANANA');
});

test('AUSENTE un viernes: el nuevo intento es el lunes (día hábil siguiente)', () => {
  const d = decidir({ motivo: 'AUSENTE', intento: 1, ocurridoEn: VIERNES_MANANA });
  assert.equal(d.proximoIntento.fecha, '2026-10-26');
});

test('DIRECCION_INCORRECTA: queda RETENIDO y no se reprograma sola', () => {
  const d = decidir({ motivo: 'DIRECCION_INCORRECTA', intento: 1, ocurridoEn: LUNES_MANANA });
  assert.equal(d.tipo, 'RETENIDO');
  assert.equal(d.proximoIntento, null);
});

test('RECHAZADO: se marca para devolución al comercio', () => {
  assert.equal(decidir({ motivo: 'RECHAZADO', intento: 1, ocurridoEn: LUNES_MANANA }).tipo, 'DEVOLUCION');
});

test('el tercer fallo es devolución, cualquiera sea el motivo (incluso AUSENTE)', () => {
  for (const motivo of ['AUSENTE', 'DIRECCION_INCORRECTA', 'RECHAZADO', 'ZONA_INACCESIBLE']) {
    assert.equal(decidir({ motivo, intento: 3, ocurridoEn: LUNES_MANANA }).tipo, 'DEVOLUCION', motivo);
  }
});

test('el segundo fallo por AUSENTE todavía se reprograma', () => {
  assert.equal(decidir({ motivo: 'AUSENTE', intento: 2, ocurridoEn: LUNES_MANANA }).tipo, 'REPROGRAMADO');
});

test('ZONA_INACCESIBLE (supuesto): día hábil siguiente, misma franja', () => {
  const d = decidir({ motivo: 'ZONA_INACCESIBLE', intento: 1, ocurridoEn: LUNES_MANANA });
  assert.deepEqual(d.proximoIntento, { fecha: '2026-10-20', franja: 'MANANA' });
});

test('un motivo desconocido lanza error', () => {
  assert.throws(() => decidir({ motivo: 'LLOVIA', intento: 1, ocurridoEn: LUNES_MANANA }));
});

// --- notificaciones ---

test('un fallo genera un aviso con opciones para reprogramar', () => {
  const n = construirNotificacion(TOPICS.ESTADOS, { tipo: 'ENTREGA_FALLIDA', motivo: 'AUSENTE' });
  assert.equal(n.tipo, 'NOTIFICACION_FALLO');
  assert.ok(n.opciones.length >= 2);
});

test('los estados que no son fallo NO generan aviso', () => {
  for (const tipo of ['CREADO', 'INGRESADO_HUB', 'CLASIFICADO', 'EN_REPARTO', 'ENTREGADO']) {
    assert.equal(construirNotificacion(TOPICS.ESTADOS, { tipo }), null, tipo);
  }
});

test('cada regla de SLA genera un aviso; el cierre de la alerta no', () => {
  for (const regla of REGLAS_SLA) {
    assert.equal(construirNotificacion(TOPICS.ALERTAS_SLA, { tipo: regla }).tipo, 'NOTIFICACION_ALERTA');
  }
  assert.equal(construirNotificacion(TOPICS.ALERTAS_SLA, { tipo: 'ALERTA_CERRADA' }), null);
});

// --- ids derivados ---

test('idDerivado: mismo origen = mismo id; otro origen o prefijo = otro id; formato UUID', () => {
  assert.equal(idDerivado('notificacion', 'ENV-1#2'), idDerivado('notificacion', 'ENV-1#2'));
  assert.notEqual(idDerivado('notificacion', 'ENV-1#2'), idDerivado('notificacion', 'ENV-1#3'));
  assert.notEqual(idDerivado('notificacion', 'ENV-1#2'), idDerivado('reprogramacion', 'ENV-1#2'));
  assert.match(idDerivado('x', 'y'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

// --- contrato de los eventos que publican los servicios ---

test('el evento de reprogramación tiene un esquema válido y exige el intento', () => {
  const ok = crearEvento({ shipmentId: 'ENV-1', tipo: 'REPROGRAMADO', secuencia: 2, intento: 1 });
  assert.equal(validarEvento(TOPICS.REPROGRAMACIONES, ok).valido, true);
  const sinIntento = crearEvento({ shipmentId: 'ENV-1', tipo: 'REPROGRAMADO', secuencia: 2 });
  assert.equal(validarEvento(TOPICS.REPROGRAMACIONES, sinIntento).valido, false);
  const tipoMalo = crearEvento({ shipmentId: 'ENV-1', tipo: 'INVENTADO', secuencia: 2, intento: 1 });
  assert.equal(validarEvento(TOPICS.REPROGRAMACIONES, tipoMalo).valido, false);
});

test('la promesa exige venceEn; las notificaciones y alertas validan su tipo', () => {
  assert.equal(validarEvento(TOPICS.PROMESAS, crearEvento({ shipmentId: 'E', tipo: 'PROMESA', secuencia: 1 })).valido, false);
  assert.equal(validarEvento(TOPICS.PROMESAS, crearEvento({ shipmentId: 'E', tipo: 'PROMESA', secuencia: 1, venceEn: '2026-10-20T00:00:00Z' })).valido, true);
  assert.equal(validarEvento(TOPICS.NOTIFICACIONES, crearEvento({ shipmentId: 'E', tipo: 'NOTIFICACION_FALLO', secuencia: 1 })).valido, true);
  assert.equal(validarEvento(TOPICS.NOTIFICACIONES, crearEvento({ shipmentId: 'E', tipo: 'OTRA', secuencia: 1 })).valido, false);
  assert.equal(validarEvento(TOPICS.ALERTAS_SLA, crearEvento({ shipmentId: 'E', tipo: 'VENCIDO', secuencia: 1 })).valido, true);
});

test('prioridades de SLA según el PDF', () => {
  assert.deepEqual(PRIORIDAD_POR_REGLA, { SIN_INGRESO: 'MEDIA', SIN_SALIDA: 'ALTA', FALLO_DIA_LIMITE: 'ALTA', VENCIDO: 'CRITICA' });
});
