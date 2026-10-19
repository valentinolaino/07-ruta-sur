// Tests de las reglas del monitor de SLA (CU3) y de sus eventos.
// Se ejecutan con:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluar, pendientes, causa, aplicar, alertaAbierta, alertaCerrada, RANK_ESTADO } = require('./evaluar');
const { validarEvento, PRIORIDAD_POR_REGLA, REGLAS_SLA, TIPO_ALERTA_CERRADA } = require('../../shared/eventos');

const HORA = 3600 * 1000;

// Lunes 19/10/2026 06:00 UTC; vence martes 20/10 a las 06:00 (24 h)
const AHORA = Date.parse('2026-10-19T06:00:00.000Z');
const VENCE_24H = AHORA + 24 * HORA;
const VENCE_EN_3H = AHORA + 3 * HORA;
const VENCE_EN_8H = AHORA + 8 * HORA;
const VENCE_EN_12H = AHORA + 12 * HORA;

// --- las cuatro reglas del PDF ---

test('SIN_INGRESO: faltan menos de 10 h y no ingresó al hub (MEDIA)', () => {
  const reglas = evaluar({ estado: 'CREADO', venceMs: VENCE_EN_8H, ahoraMs: AHORA });
  assert.deepEqual(reglas, ['SIN_INGRESO']);
  assert.equal(PRIORIDAD_POR_REGLA.SIN_INGRESO, 'MEDIA');
});

test('SIN_SALIDA: faltan menos de 4 h y no salió a reparto (ALTA)', () => {
  const reglas = evaluar({ estado: 'CLASIFICADO', venceMs: VENCE_EN_3H, ahoraMs: AHORA });
  assert.deepEqual(reglas, ['SIN_SALIDA']); // ya ingresó: SIN_INGRESO no aplica
  assert.equal(PRIORIDAD_POR_REGLA.SIN_SALIDA, 'ALTA');
});

test('con menos de 4 h y todavía en CREADO aplican las dos reglas', () => {
  assert.deepEqual(evaluar({ estado: 'CREADO', venceMs: VENCE_EN_3H, ahoraMs: AHORA }), ['SIN_SALIDA', 'SIN_INGRESO']);
});

test('EN_REPARTO no dispara SIN_SALIDA aunque falten 2 h', () => {
  assert.deepEqual(evaluar({ estado: 'EN_REPARTO', venceMs: AHORA + 2 * HORA, ahoraMs: AHORA }), []);
});

test('faltando más de 10 h no hay alerta', () => {
  assert.deepEqual(evaluar({ estado: 'CREADO', venceMs: VENCE_EN_12H, ahoraMs: AHORA }), []);
});

test('VENCIDO: pasó el vencimiento sin ENTREGADO (CRITICA)', () => {
  const reglas = evaluar({ estado: 'INGRESADO_HUB', venceMs: AHORA - HORA, ahoraMs: AHORA });
  assert.deepEqual(reglas, ['VENCIDO']);
  assert.equal(PRIORIDAD_POR_REGLA.VENCIDO, 'CRITICA');
});

test('FALLO_DIA_LIMITE: ENTREGA_FALLIDA y la promesa vence hoy (ALTA)', () => {
  // La promesa vence el mismo día (20/10 06:00) y todavía no pasó
  const reglas = evaluar({ estado: 'ENTREGA_FALLIDA', venceMs: Date.parse('2026-10-20T06:00:00.000Z'), ahoraMs: Date.parse('2026-10-20T03:00:00.000Z') });
  assert.deepEqual(reglas, ['FALLO_DIA_LIMITE']);
});

test('FALLO_DIA_LIMITE no aplica si la promesa vence otro día', () => {
  const reglas = evaluar({ estado: 'ENTREGA_FALLIDA', venceMs: VENCE_24H + 24 * HORA, ahoraMs: AHORA });
  assert.deepEqual(reglas, []);
});

// --- guardas ---

test('un envío entregado, sin promesa o sin estados nunca alerta', () => {
  assert.deepEqual(evaluar({ estado: 'ENTREGADO', venceMs: AHORA - HORA, ahoraMs: AHORA }), []);
  assert.deepEqual(evaluar({ estado: 'CREADO', venceMs: null, ahoraMs: AHORA }), []);
  assert.deepEqual(evaluar({ estado: '', venceMs: VENCE_EN_3H, ahoraMs: AHORA }), []); // solo promesa releída
});

test('pendientes() filtra las reglas que ya alertaron (sin repetición)', () => {
  const reglas = ['SIN_SALIDA', 'SIN_INGRESO'];
  assert.deepEqual(pendientes(reglas, ['SIN_INGRESO']), ['SIN_SALIDA']);
  assert.deepEqual(pendientes(reglas, []), reglas);
});

test('causa() explica el disparo de cada regla', () => {
  assert.match(causa('VENCIDO', { estado: 'INGRESADO_HUB', venceMs: AHORA - HORA, ahoraMs: AHORA }), /promesa vencida/);
  assert.match(causa('SIN_INGRESO', { estado: 'CREADO', venceMs: VENCE_EN_8H, ahoraMs: AHORA }), /no ingresó al hub/);
});

// --- transición de estado (aplicar) ---

const eventoEstado = (tipo, secuencia, extra = {}) => ({
  shipmentId: 'ENV-1',
  tipo,
  secuencia,
  ocurridoEn: '2026-10-19T08:00:00.000Z',
  hubId: 'HUB-1',
  zonaId: 'ZONA-A',
  ...extra,
});

test('aplicar: un evento fuera de orden NO retrocede el estado', () => {
  const visto = { shipmentId: 'ENV-1', estado: 'EN_REPARTO', hubId: 'HUB-1', zonaId: 'ZONA-A', venceMs: null, ultimaSecuencia: 4, reglasAlertadas: [], terminado: false, ultimoOcurridoMs: 0 };
  const r = aplicar(visto, eventoEstado('CLASIFICADO', 3), 'envios.estados');
  assert.equal(r.cambiado, false);
  assert.equal(r.estado.estado, 'EN_REPARTO');
});

test('aplicar: CREADO arranca el estado y ENTREGADO marca terminado', () => {
  const r1 = aplicar(null, eventoEstado('CREADO', 1), 'envios.estados');
  assert.equal(r1.cambiado, true);
  assert.equal(r1.estado.estado, 'CREADO');
  assert.equal(r1.estado.terminado, false);

  const r2 = aplicar(r1.estado, eventoEstado('ENTREGADO', 6), 'envios.estados');
  assert.equal(r2.estado.terminado, true);
});

test('aplicar: la promesa guarda el vencimiento y no duplica sin cambios', () => {
  const promesa = { ...eventoEstado('PROMESA', 1), tipo: 'PROMESA', venceEn: '2026-10-20T06:00:00.000Z' };
  const r1 = aplicar(null, promesa, 'envios.promesas');
  assert.equal(r1.cambiado, true);
  assert.equal(r1.estado.venceMs, Date.parse('2026-10-20T06:00:00.000Z'));
  assert.equal(r1.estado.estado, ''); // todavía sin estados

  const r2 = aplicar(r1.estado, promesa, 'envios.promesas');
  assert.equal(r2.cambiado, false);
});

test('aplicar: el reloj simulado (último ocurridoEn) jamás retrocede', () => {
  const r1 = aplicar(null, eventoEstado('CREADO', 1), 'envios.estados');
  const r2 = aplicar(r1.estado, { ...eventoEstado('INGRESADO_HUB', 2), ocurridoEn: '2026-10-19T10:00:00.000Z' }, 'envios.estados');
  assert.ok(r2.estado.ultimoOcurridoMs > r1.estado.ultimoOcurridoMs);
});

// --- eventos que publica el monitor ---

const estadoMonitor = {
  shipmentId: 'ENV-1',
  estado: 'CREADO',
  hubId: 'HUB-1',
  zonaId: 'ZONA-C',
  venceMs: VENCE_EN_8H,
  ultimaSecuencia: 3,
  reglasAlertadas: [],
  terminado: false,
  ultimoOcurridoMs: AHORA,
};

test('la alerta abierta cumple el esquema de alertas.sla y lleva prioridad y causa', () => {
  const ev = alertaAbierta({
    regla: 'SIN_INGRESO',
    estado: estadoMonitor,
    ahoraMs: AHORA,
    eventId: '00000000-0000-4000-a000-000000000001',
  });
  assert.equal(validarEvento('alertas.sla', ev).valido, true);
  assert.equal(ev.tipo, 'SIN_INGRESO');
  assert.equal(ev.prioridad, 'MEDIA');
  assert.ok(ev.causa.length > 10);
  assert.equal(ev.hubId, 'HUB-1');
});

test('la alerta cerrada cumple el esquema y usa el tipo ALERTA_CERRADA', () => {
  const ev = alertaCerrada({
    estado: estadoMonitor,
    ocurridoEn: '2026-10-19T12:00:00.000Z',
    eventId: '00000000-0000-4000-a000-000000000002',
  });
  assert.equal(validarEvento('alertas.sla', ev).valido, true);
  assert.equal(ev.tipo, TIPO_ALERTA_CERRADA);
});

test('las prioridades del monitor coinciden con la tabla del PDF', () => {
  assert.deepEqual(PRIORIDAD_POR_REGLA, { SIN_INGRESO: 'MEDIA', SIN_SALIDA: 'ALTA', FALLO_DIA_LIMITE: 'ALTA', VENCIDO: 'CRITICA' });
  assert.deepEqual(REGLAS_SLA, ['SIN_INGRESO', 'SIN_SALIDA', 'FALLO_DIA_LIMITE', 'VENCIDO']);
  assert.equal(RANK_ESTADO.ENTREGA_FALLIDA, RANK_ESTADO.EN_REPARTO); // un fallo ya salió a reparto
});
