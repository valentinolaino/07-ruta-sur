// Tests de los indicadores de la analítica (CU4).
// Se ejecutan con:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEstado, dimensiones, proyectar, contadoresDe, COLUMNA_MOTIVO } = require('./indicadores');
const { TOPICS, MOTIVOS_FALLO } = require('../../shared/eventos');

// Lunes 19/10/2026 10:00 UTC = franja MANANA | 15:00 = franja TARDE
const MANANA = '2026-10-19T10:00:00.000Z';
const TARDE = '2026-10-19T15:00:00.000Z';

const evento = (tipo, secuencia, extra = {}) => ({
  shipmentId: 'ENV-1',
  tipo,
  secuencia,
  ocurridoEn: MANANA,
  hubId: 'HUB-2',
  zonaId: 'ZONA-C',
  repartidorId: 'R-041',
  ...extra,
});

// --- dimensiones ---

test('dimensiones: día (UTC), franja y las dimensiones del evento', () => {
  assert.deepEqual(dimensiones(evento('ENTREGADO', 6)), { fecha: '2026-10-19', zona_id: 'ZONA-C', franja: 'MANANA', hub_id: 'HUB-2' });
  assert.equal(dimensiones(evento('ENTREGADO', 6, { ocurridoEn: TARDE })).franja, 'TARDE');
});

test('dimensiones: sin hub o zona no hay fila (la analítica no la suma)', () => {
  assert.equal(dimensiones(evento('ENTREGADO', 6, { hubId: null })), null);
  assert.equal(dimensiones(evento('ENTREGADO', 6, { zonaId: null })), null);
});

// --- indicador 1 y 3: entregas y SLA ---

test('ENTREGADO en primer intento suma entrega + primer intento + SLA cumplido', () => {
  const conPromesa = proyectar(crearEstado(), { ...evento('PROMESA', 1), venceEn: '2026-10-21T10:00:00.000Z' }, TOPICS.PROMESAS).estado;
  const r = proyectar(conPromesa, evento('ENTREGADO', 5), TOPICS.ESTADOS);
  assert.equal(r.aplicado, true);
  assert.deepEqual(r.fila, {
    fecha: '2026-10-19', zona_id: 'ZONA-C', franja: 'MANANA', hub_id: 'HUB-2',
    entregas_total: 1,
    entregas_primer_intento: 1,
    sla_cumplidos: 1,
  });
});

test('ENTREGADO después de un fallo NO cuenta como primer intento', () => {
  const conFallo = proyectar(crearEstado(), evento('ENTREGA_FALLIDA', 4, { motivo: 'AUSENTE' }), TOPICS.ESTADOS).estado;
  const conPromesa = proyectar(conFallo, { ...evento('PROMESA', 1), venceEn: '2026-10-21T10:00:00.000Z' }, TOPICS.PROMESAS).estado;
  const r = proyectar(conPromesa, evento('ENTREGADO', 6), TOPICS.ESTADOS);
  assert.equal(r.fila.entregas_total, 1);
  assert.equal(r.fila.entregas_primer_intento, undefined);
});

test('SLA incumplido: se entregó DESPUÉS de la fecha prometida', () => {
  const conPromesa = proyectar(crearEstado(), { ...evento('PROMESA', 1), venceEn: '2026-10-19T08:00:00.000Z' }, TOPICS.PROMESAS).estado;
  const r = proyectar(conPromesa, evento('ENTREGADO', 5), TOPICS.ESTADOS); // entregado 10:00, venció 08:00
  assert.equal(r.fila.sla_incumplidos, 1);
  assert.equal(r.fila.sla_cumplidos, undefined);
});

test('SLA sin promesa conocida: no se juzga (no suma ninguna columna sla)', () => {
  const r = proyectar(crearEstado(), evento('ENTREGADO', 5), TOPICS.ESTADOS);
  assert.equal(r.fila.entregas_total, 1);
  assert.equal(r.fila.sla_cumplidos, undefined);
  assert.equal(r.fila.sla_incumplidos, undefined);
});

// --- indicador 2: motivos ---

test('cada motivo de fallo suma en su columna', () => {
  for (const motivo of MOTIVOS_FALLO) {
    const r = proyectar(crearEstado(), evento('ENTREGA_FALLIDA', 4, { motivo }), TOPICS.ESTADOS);
    assert.equal(r.fila.fallos_total, 1, motivo);
    assert.equal(r.fila[COLUMNA_MOTIVO[motivo]], 1, motivo);
    assert.equal(r.estado.fallos, 1);
  }
});

// --- orden y eventos que no aportan ---

test('un evento fuera de orden no se vuelve a contar', () => {
  const r1 = proyectar(crearEstado(), evento('ENTREGA_FALLIDA', 4, { motivo: 'RECHAZADO' }), TOPICS.ESTADOS);
  const r2 = proyectar(r1.estado, evento('ENTREGA_FALLIDA', 4, { motivo: 'RECHAZADO' }), TOPICS.ESTADOS);
  assert.equal(r2.aplicado, false);
  assert.equal(r2.fila, null);
  // y una copia vieja tampoco: la secuencia ya avanzó
  const r3 = proyectar(r1.estado, evento('ENTREGADO', 3), TOPICS.ESTADOS);
  assert.equal(r3.aplicado, false);
});

test('los estados intermedios solo avanzan la secuencia (sin fila)', () => {
  const r = proyectar(crearEstado(), evento('CLASIFICADO', 3), TOPICS.ESTADOS);
  assert.equal(r.aplicado, true);
  assert.equal(r.fila, null);
  assert.equal(r.estado.ultimaSecuencia, 3);
});

test('la promesa se guarda una vez y no cambia si se repite', () => {
  const promesa = { ...evento('PROMESA', 1), venceEn: '2026-10-21T10:00:00.000Z' };
  const r1 = proyectar(crearEstado(), promesa, TOPICS.PROMESAS);
  assert.equal(r1.aplicado, true);
  assert.equal(r1.estado.promesaVenceMs, Date.parse('2026-10-21T10:00:00.000Z'));
  const r2 = proyectar(r1.estado, promesa, TOPICS.PROMESAS);
  assert.equal(r2.aplicado, false);
});

test('contadoresDe separa las columnas de las dimensiones', () => {
  const r = proyectar(crearEstado(), evento('ENTREGA_FALLIDA', 4, { motivo: 'AUSENTE' }), TOPICS.ESTADOS);
  assert.deepEqual(contadoresDe(r.fila), ['fallos_total', 'fallos_ausente']);
});
