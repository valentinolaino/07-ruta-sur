// Tests del reducer del proyector (reglas de orden, duplicados y estados derivados).
// Se ejecutan con:  npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { crearEvento } = require('../../shared/eventos');
const R = require('./reducer');

const ID = 'ENV-1';
let n = 0;
const ev = (tipo, secuencia, extra = {}) =>
  crearEvento({
    shipmentId: ID,
    tipo,
    secuencia,
    ocurridoEn: new Date(Date.UTC(2026, 9, 19, 6 + secuencia)).toISOString(),
    hubId: 'HUB-1',
    zonaId: 'ZONA-A',
    eventId: `e${++n}`,
    ...extra,
  });

// Aplica una lista de eventos de estado en orden y devuelve el documento final
function aplicarTodos(eventos, doc = R.documentoVacio(ID)) {
  return eventos.reduce((d, e) => R.aplicarEstado(d, e).doc, doc);
}

test('el ciclo normal deja el último estado y el historial completo', () => {
  const doc = aplicarTodos([ev('CREADO', 1), ev('INGRESADO_HUB', 2), ev('CLASIFICADO', 3, { repartidorId: 'R-001' }), ev('EN_REPARTO', 4), ev('ENTREGADO', 5)]);
  assert.equal(doc.estado, 'ENTREGADO');
  assert.equal(doc.historial.length, 5);
  assert.equal(doc.ultimaSecuencia, 5);
  assert.equal(doc.repartidorId, 'R-001');
  assert.equal(doc.hubId, 'HUB-1');
});

test('un evento duplicado (mismo eventId) no agrega una entrada repetida al historial', () => {
  const creado = ev('CREADO', 1);
  const doc1 = R.aplicarEstado(R.documentoVacio(ID), creado).doc;
  const r = R.aplicarEstado(doc1, creado);
  assert.equal(r.aplicado, false);
  assert.equal(r.motivo, 'duplicado');
  assert.equal(r.doc.historial.length, 1);
});

test('un evento fuera de orden (secuencia menor) NO hace retroceder el estado', () => {
  const doc = aplicarTodos([ev('CREADO', 1), ev('INGRESADO_HUB', 2), ev('CLASIFICADO', 3)]);
  const r = R.aplicarEstado(doc, ev('INGRESADO_HUB', 2)); // llega tarde, con otro eventId
  assert.equal(r.aplicado, false);
  assert.match(r.motivo, /fuera de orden/);
  assert.equal(r.doc.estado, 'CLASIFICADO');
  assert.equal(r.doc.historial.length, 3);
});

test('secuencia igual a la ya aplicada también se descarta', () => {
  const doc = aplicarTodos([ev('CREADO', 1), ev('INGRESADO_HUB', 2)]);
  assert.equal(R.aplicarEstado(doc, ev('CLASIFICADO', 2)).aplicado, false);
});

test('se pueden saltear secuencias (huecos): se aplica la mayor', () => {
  const doc = aplicarTodos([ev('CREADO', 1), ev('EN_REPARTO', 4)]);
  assert.equal(doc.estado, 'EN_REPARTO');
  assert.equal(doc.ultimaSecuencia, 4);
});

test('no modifica el documento recibido (funciones puras)', () => {
  const vacio = R.documentoVacio(ID);
  const copia = JSON.stringify(vacio);
  R.aplicarEstado(vacio, ev('CREADO', 1));
  assert.equal(JSON.stringify(vacio), copia);
});

test('ENTREGA_FALLIDA suma un intento y guarda el motivo', () => {
  const doc = aplicarTodos([ev('CREADO', 1), ev('ENTREGA_FALLIDA', 2, { motivo: 'AUSENTE', intento: 1 })]);
  assert.equal(doc.estado, 'ENTREGA_FALLIDA');
  assert.equal(doc.intentos, 1);
  assert.equal(doc.motivoFallo, 'AUSENTE');
  assert.equal(doc.historial.at(-1).motivo, 'AUSENTE');
});

test('promesa: guarda el vencimiento; la misma promesa dos veces no cambia nada', () => {
  const promesa = ev('PROMESA', 1, { venceEn: '2026-10-20T06:00:00.000Z' });
  const r1 = R.aplicarPromesa(R.documentoVacio(ID), promesa);
  assert.equal(r1.doc.promesaVenceEn, '2026-10-20T06:00:00.000Z');
  assert.equal(R.aplicarPromesa(r1.doc, promesa).aplicado, false);
});

test('la promesa que llega ANTES del CREADO no impide aplicar el CREADO', () => {
  const doc = R.aplicarPromesa(R.documentoVacio(ID), ev('PROMESA', 1, { venceEn: '2026-10-20T06:00:00Z' })).doc;
  const r = R.aplicarEstado(doc, ev('CREADO', 1));
  assert.equal(r.aplicado, true);
  assert.equal(r.doc.promesaVenceEn, '2026-10-20T06:00:00Z');
});

// --- estados derivados (reprogramación) ---

const fallo = (seq, intento, motivo = 'AUSENTE') => ev('ENTREGA_FALLIDA', seq, { motivo, intento });
const decision = (tipo, intento, extra = {}) => ev(tipo, 1, { intento, motivo: 'AUSENTE', ...extra });

test('REPROGRAMADO tras el fallo cambia el estado a REPROGRAMADO y guarda el próximo intento', () => {
  let doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1)]);
  const r = R.aplicarReprogramacion(doc, decision('REPROGRAMADO', 1, { proximoIntento: { fecha: '2026-10-20', franja: 'TARDE' } }));
  assert.equal(r.doc.estado, 'REPROGRAMADO');
  assert.deepEqual(r.doc.reprogramacion.proximoIntento, { fecha: '2026-10-20', franja: 'TARDE' });
});

test('RETENIDO y DEVOLUCION son estados finales derivados', () => {
  const doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1, 'DIRECCION_INCORRECTA')]);
  assert.equal(R.aplicarReprogramacion(doc, decision('RETENIDO', 1)).doc.estado, 'RETENIDO');
  assert.equal(R.aplicarReprogramacion(doc, decision('DEVOLUCION', 1)).doc.estado, 'DEVOLUCION');
});

test('el nuevo CLASIFICADO tras REPROGRAMADO vuelve al circuito', () => {
  let doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1)]);
  doc = R.aplicarReprogramacion(doc, decision('REPROGRAMADO', 1)).doc;
  doc = R.aplicarEstado(doc, ev('CLASIFICADO', 3)).doc;
  assert.equal(doc.estado, 'CLASIFICADO');
});

test('carrera entre topics: la decisión llega ANTES que el fallo y igual se refleja', () => {
  let doc = aplicarTodos([ev('CREADO', 1)]);
  doc = R.aplicarReprogramacion(doc, decision('REPROGRAMADO', 1)).doc; // todavía no hay fallo
  assert.equal(doc.estado, 'CREADO'); // no pisa el estado
  doc = R.aplicarEstado(doc, fallo(2, 1)).doc;
  assert.equal(doc.estado, 'REPROGRAMADO');
});

test('carrera entre topics: la decisión llega DESPUÉS de que el envío ya avanzó', () => {
  let doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1), ev('CLASIFICADO', 3)]);
  const r = R.aplicarReprogramacion(doc, decision('REPROGRAMADO', 1));
  assert.equal(r.doc.estado, 'CLASIFICADO'); // no hace retroceder
  assert.equal(r.doc.reprogramacion.decision, 'REPROGRAMADO'); // pero queda registrada
});

test('la decisión del intento 1 no afecta al fallo del intento 2', () => {
  let doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1)]);
  doc = R.aplicarReprogramacion(doc, decision('REPROGRAMADO', 1)).doc;
  doc = aplicarTodos([ev('CLASIFICADO', 3), ev('EN_REPARTO', 4), fallo(5, 2)], doc);
  assert.equal(doc.estado, 'ENTREGA_FALLIDA'); // espera la decisión del intento 2
  doc = R.aplicarReprogramacion(doc, decision('REPROGRAMADO', 2)).doc;
  assert.equal(doc.estado, 'REPROGRAMADO');
});

test('tercer fallo: la decisión DEVOLUCION deja el envío en DEVOLUCION', () => {
  let doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1), fallo(3, 2), fallo(4, 3)]);
  assert.equal(doc.intentos, 3);
  doc = R.aplicarReprogramacion(doc, decision('DEVOLUCION', 3)).doc;
  assert.equal(doc.estado, 'DEVOLUCION');
});

test('la misma decisión dos veces (mismo eventId) no se duplica en el historial', () => {
  const doc = aplicarTodos([ev('CREADO', 1), fallo(2, 1)]);
  const d = decision('REPROGRAMADO', 1);
  const r1 = R.aplicarReprogramacion(doc, d);
  const r2 = R.aplicarReprogramacion(r1.doc, d);
  assert.equal(r2.aplicado, false);
  assert.equal(r2.doc.historial.length, r1.doc.historial.length);
});
