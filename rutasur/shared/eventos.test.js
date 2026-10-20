// Tests del validador de eventos. Se ejecutan con:  npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { TOPICS, validarEvento, crearEvento } = require("./eventos");

function eventoValido(cambios = {}) {
  return crearEvento({
    shipmentId: "ENV-1",
    tipo: "INGRESADO_HUB",
    secuencia: 2,
    hubId: "HUB-1",
    zonaId: "ZONA-A",
    ...cambios,
  });
}

test("un evento de estado correcto es válido", () => {
  const r = validarEvento(TOPICS.ESTADOS, eventoValido());
  assert.equal(r.valido, true);
  assert.deepEqual(r.errores, []);
});

test("crearEvento genera un eventId distinto cada vez", () => {
  assert.notEqual(eventoValido().eventId, eventoValido().eventId);
});

test("falta eventId: es inválido y el error nombra el campo", () => {
  const evento = eventoValido();
  delete evento.eventId;
  const r = validarEvento(TOPICS.ESTADOS, evento);
  assert.equal(r.valido, false);
  assert.match(r.errores.join(" "), /eventId/);
});

test("un tipo de estado desconocido es inválido", () => {
  const r = validarEvento(
    TOPICS.ESTADOS,
    eventoValido({ tipo: "TELETRANSPORTADO" }),
  );
  assert.equal(r.valido, false);
});

test("secuencia 0 o decimal es inválida", () => {
  assert.equal(
    validarEvento(TOPICS.ESTADOS, eventoValido({ secuencia: 0 })).valido,
    false,
  );
  assert.equal(
    validarEvento(TOPICS.ESTADOS, eventoValido({ secuencia: 1.5 })).valido,
    false,
  );
});

test("ocurridoEn que no es una fecha es inválido", () => {
  const r = validarEvento(
    TOPICS.ESTADOS,
    eventoValido({ ocurridoEn: "ayer a la tarde" }),
  );
  assert.equal(r.valido, false);
  assert.match(r.errores.join(" "), /ocurridoEn/);
});

test("ENTREGA_FALLIDA sin motivo es inválida", () => {
  const r = validarEvento(
    TOPICS.ESTADOS,
    eventoValido({ tipo: "ENTREGA_FALLIDA" }),
  );
  assert.equal(r.valido, false);
  assert.match(r.errores.join(" "), /motivo/);
});

test("ENTREGA_FALLIDA con motivo, hub y zona es válida", () => {
  const r = validarEvento(
    TOPICS.ESTADOS,
    eventoValido({ tipo: "ENTREGA_FALLIDA", motivo: "AUSENTE" }),
  );
  assert.equal(r.valido, true);
});

test("ENTREGA_FALLIDA con un motivo inventado es inválida", () => {
  const r = validarEvento(
    TOPICS.ESTADOS,
    eventoValido({ tipo: "ENTREGA_FALLIDA", motivo: "LLOVIA" }),
  );
  assert.equal(r.valido, false);
});

test("ENTREGA_FALLIDA sin zona es inválida (la analítica la necesita)", () => {
  const r = validarEvento(
    TOPICS.ESTADOS,
    eventoValido({ tipo: "ENTREGA_FALLIDA", motivo: "AUSENTE", zonaId: null }),
  );
  assert.equal(r.valido, false);
});

test("un evento que no es un objeto es inválido", () => {
  assert.equal(validarEvento(TOPICS.ESTADOS, "hola").valido, false);
  assert.equal(validarEvento(TOPICS.ESTADOS, null).valido, false);
});

test("otros topics usan solo el esquema base (campos comunes)", () => {
  const evento = crearEvento({
    shipmentId: "ENV-1",
    tipo: "SIN_SALIDA",
    secuencia: 1,
  });
  assert.equal(validarEvento(TOPICS.ALERTAS_SLA, evento).valido, true);
});
