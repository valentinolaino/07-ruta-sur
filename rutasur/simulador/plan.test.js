// Tests del simulador (lógica pura, sin Kafka).

const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("./config");
const { crearRng } = require("./aleatorio");
const { Agenda } = require("./agenda");
const { Reloj } = require("./reloj");
const { planificarEnvio } = require("./plan");
const { ESCENARIOS, NOMBRES } = require("./escenarios");
const { TOPICS, validarEvento } = require("../shared/eventos");
const T = require("../shared/tiempo");

const INICIO = config.inicioSimulado;

function ctx(semilla = 1) {
  let n = 0;
  return {
    rng: crearRng(semilla),
    config,
    ahoraSim: INICIO,
    siguienteDemo: () => ++n,
  };
}

const estados = (plan) =>
  plan.pasos.filter(
    (p) => p.topic === TOPICS.ESTADOS && typeof p.valor === "object",
  );
const tipos = (plan) => estados(plan).map((p) => p.valor.tipo);

// ---------------------------------------------------------------- aleatorio

test("la misma semilla da la misma secuencia; otra semilla, otra distinta", () => {
  const a = crearRng(7);
  const b = crearRng(7);
  const c = crearRng(8);
  const sa = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(
    sa,
    Array.from({ length: 5 }, () => b.next()),
  );
  assert.notDeepEqual(
    sa,
    Array.from({ length: 5 }, () => c.next()),
  );
});

test("uuid determinista tiene formato de UUID v4", () => {
  assert.match(
    crearRng(1).uuid(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("elegirPonderado respeta los pesos (60/20/15/5)", () => {
  const rng = crearRng(3);
  const cuenta = {};
  for (let i = 0; i < 20000; i++) {
    const k = rng.elegirPonderado(config.motivos);
    cuenta[k] = (cuenta[k] || 0) + 1;
  }
  assert.ok(Math.abs(cuenta.AUSENTE / 20000 - 0.6) < 0.02);
  assert.ok(Math.abs(cuenta.DIRECCION_INCORRECTA / 20000 - 0.2) < 0.02);
  assert.ok(Math.abs(cuenta.ZONA_INACCESIBLE / 20000 - 0.05) < 0.01);
});

// ---------------------------------------------------------------- tiempo

test("día hábil siguiente: viernes salta al lunes", () => {
  const viernes = Date.parse("2026-10-23T15:00:00Z");
  assert.equal(
    new Date(T.siguienteDiaHabil(viernes)).toISOString(),
    "2026-10-26T00:00:00.000Z",
  );
  const lunes = Date.parse("2026-10-19T10:00:00Z");
  assert.equal(
    new Date(T.siguienteDiaHabil(lunes)).toISOString(),
    "2026-10-20T00:00:00.000Z",
  );
});

test("franjas: mañana antes de las 13, tarde después; la opuesta cambia", () => {
  assert.equal(T.franjaDe("2026-10-19T12:59:00Z"), "MANANA");
  assert.equal(T.franjaDe("2026-10-19T13:00:00Z"), "TARDE");
  assert.equal(T.franjaOpuesta("MANANA"), "TARDE");
});

test("reloj: 1 hora simulada = 30 segundos reales con el factor por defecto", () => {
  const reloj = new Reloj({
    inicioSimulado: INICIO,
    factor: config.factorAceleracion,
    inicioReal: 1000,
  });
  assert.equal(reloj.simDe(1000 + 30000), INICIO + T.HORA);
  assert.equal(reloj.realDe(INICIO + T.HORA), 31000);
});

// ---------------------------------------------------------------- agenda

test("la agenda devuelve en orden y conserva el orden de inserción a igual hora", () => {
  const ag = new Agenda();
  ag.agregar(300, "c");
  ag.agregar(100, "a1");
  ag.agregar(100, "a2");
  ag.agregar(200, "b");
  assert.deepEqual(ag.extraerVencidos(150), ["a1", "a2"]);
  assert.deepEqual(ag.extraerVencidos(1000), ["b", "c"]);
  assert.equal(ag.pendientes, 0);
});

// ---------------------------------------------------------------- plan de un envío

function plan(opciones, semilla = 1) {
  return planificarEnvio({
    numero: 1,
    simInicio: INICIO,
    rng: crearRng(semilla),
    config,
    opciones,
  });
}

test("envío feliz: todos los estados en orden, secuencia 1..n y promesa publicada", () => {
  const p = ESCENARIOS.feliz.crear(ctx())[0];
  assert.deepEqual(tipos(p), [
    "CREADO",
    "INGRESADO_HUB",
    "CLASIFICADO",
    "EN_REPARTO",
    "ENTREGADO",
  ]);
  assert.deepEqual(
    estados(p).map((e) => e.valor.secuencia),
    [1, 2, 3, 4, 5],
  );
  const promesas = p.pasos.filter((x) => x.topic === TOPICS.PROMESAS);
  assert.equal(promesas.length, 1);
  assert.ok(Date.parse(promesas[0].valor.venceEn) > INICIO);
});

test("todos los eventos válidos del simulador cumplen el esquema", () => {
  for (const nombre of ["feliz", "ausente", "tercer-fallo", "demorado"]) {
    for (const p of ESCENARIOS[nombre].crear(ctx())) {
      for (const paso of p.pasos) {
        const r = validarEvento(paso.topic, paso.valor);
        assert.equal(
          r.valido,
          true,
          `${nombre}/${paso.etiqueta}: ${r.errores.join("; ")}`,
        );
      }
    }
  }
});

test("ausente: falla con AUSENTE (con hub y zona), se reprograma y el 2.º intento entrega", () => {
  const p = ESCENARIOS.ausente.crear(ctx())[0];
  assert.deepEqual(tipos(p), [
    "CREADO",
    "INGRESADO_HUB",
    "CLASIFICADO",
    "EN_REPARTO",
    "ENTREGA_FALLIDA",
    "CLASIFICADO",
    "EN_REPARTO",
    "ENTREGADO",
  ]);
  const fallo = estados(p).find(
    (e) => e.valor.tipo === "ENTREGA_FALLIDA",
  ).valor;
  assert.equal(fallo.motivo, "AUSENTE");
  assert.ok(fallo.hubId && fallo.zonaId);
});

test("tercer fallo: exactamente 3 ENTREGA_FALLIDA y es lo último que pasa", () => {
  const p = ESCENARIOS["tercer-fallo"].crear(ctx())[0];
  const t = tipos(p);
  assert.equal(t.filter((x) => x === "ENTREGA_FALLIDA").length, 3);
  assert.equal(t.at(-1), "ENTREGA_FALLIDA");
  assert.equal(t.includes("ENTREGADO"), false);
});

test("demorado: queda en el hub, nunca sale a reparto, y la promesa vence en 5 h", () => {
  const p = ESCENARIOS.demorado.crear(ctx())[0];
  assert.deepEqual(tipos(p), ["CREADO", "INGRESADO_HUB"]);
  const promesa = p.pasos.find((x) => x.topic === TOPICS.PROMESAS).valor;
  assert.equal(Date.parse(promesa.venceEn) - INICIO, 5 * T.HORA);
});

test("DIRECCION_INCORRECTA y RECHAZADO no generan nuevo intento", () => {
  for (const motivo of ["DIRECCION_INCORRECTA", "RECHAZADO"]) {
    const p = plan({
      resultados: [motivo],
      demora: null,
      malformado: false,
      duplicarEventos: false,
      desordenarEventos: false,
    });
    assert.equal(tipos(p).at(-1), "ENTREGA_FALLIDA");
    assert.equal(tipos(p).filter((x) => x === "EN_REPARTO").length, 1);
  }
});

test("regla real de reintento: AUSENTE vuelve el día hábil siguiente en la franja opuesta", () => {
  const p = plan({
    zonaId: "ZONA-A",
    resultados: ["AUSENTE", "ENTREGADO"],
    horas: undefined,
    demora: null,
    malformado: false,
    duplicarEventos: false,
    desordenarEventos: false,
  });
  const falla = estados(p).find(
    (e) => e.valor.tipo === "ENTREGA_FALLIDA",
  ).valor;
  const repartos = estados(p).filter((e) => e.valor.tipo === "EN_REPARTO");
  assert.equal(repartos.length, 2);
  const segundo = Date.parse(repartos[1].valor.ocurridoEn);
  assert.equal(T.esDiaHabil(segundo), true);
  assert.ok(
    T.inicioDelDia(segundo) > T.inicioDelDia(Date.parse(falla.ocurridoEn)),
  );
  assert.equal(
    T.franjaDe(segundo),
    T.franjaOpuesta(T.franjaDe(falla.ocurridoEn)),
  );
});

test("duplicado: cada evento aparece dos veces con el MISMO eventId", () => {
  const p = ESCENARIOS.duplicado.crear(ctx())[0];
  const ids = estados(p).map((e) => e.valor.eventId);
  assert.equal(ids.length, 10); // 5 estados x 2
  assert.equal(new Set(ids).size, 5);
});

test("fuera de orden: tras cada evento llega uno viejo con secuencia MENOR y otro eventId", () => {
  const p = ESCENARIOS["fuera-de-orden"].crear(ctx())[0];
  const ev = estados(p).map((e) => e.valor);
  let maxima = 0;
  let viejos = 0;
  for (const e of ev) {
    if (e.secuencia < maxima) viejos++;
    maxima = Math.max(maxima, e.secuencia);
  }
  assert.equal(viejos, 4); // uno tras cada evento, salvo el primero
  assert.equal(new Set(ev.map((e) => e.eventId)).size, ev.length); // ninguno repite eventId
});

test("invalido: el evento malformado es texto y no pasa la validación", () => {
  for (let semilla = 1; semilla <= 12; semilla++) {
    const c = ctx(semilla);
    const p = ESCENARIOS.invalido.crear(c)[0];
    const crudo = p.pasos.find((x) => typeof x.valor === "string");
    assert.ok(crudo, "debe haber un evento malformado");
    let evento = null;
    try {
      evento = JSON.parse(crudo.valor);
    } catch {
      /* JSON roto: también es inválido */
    }
    if (evento !== null)
      assert.equal(
        validarEvento(TOPICS.ESTADOS, evento).valido,
        false,
        crudo.valor,
      );
  }
});

test("ráfaga: 500 envíos con ids distintos, repartidos en el tiempo", () => {
  const planes = ESCENARIOS.rafaga.crear(ctx());
  assert.equal(planes.length, 500);
  assert.equal(new Set(planes.map((p) => p.shipmentId)).size, 500);
  const reales = T.HORA / config.factorAceleracion / 1000; // segundos reales por hora simulada
  const ultimo = planes.at(-1).pasos[0].simMs - INICIO;
  assert.ok((ultimo / T.HORA) * reales < 5.1);
});

test("todos los escenarios existen y tienen descripción", () => {
  assert.deepEqual(NOMBRES.sort(), [
    "ausente",
    "demorado",
    "duplicado",
    "feliz",
    "fuera-de-orden",
    "invalido",
    "rafaga",
    "tercer-fallo",
  ]);
  for (const n of NOMBRES) assert.ok(ESCENARIOS[n].descripcion);
});

test("misma semilla = mismos eventos (incluidos los eventId)", () => {
  const generar = () => {
    const rng = crearRng(42);
    const salida = [];
    for (let i = 1; i <= 50; i++) {
      salida.push(
        planificarEnvio({
          numero: i,
          simInicio: INICIO + i * T.HORA,
          rng,
          config,
        }),
      );
    }
    return JSON.stringify(salida);
  };
  assert.equal(generar(), generar());
});

test("flujo continuo: la tasa de entrega en primer intento ronda el 82 % (18 % de fallos)", () => {
  const rng = crearRng(42);
  let entregados = 0;
  let primeraVez = 0;
  const N = 4000;
  for (let i = 1; i <= N; i++) {
    const p = planificarEnvio({
      numero: i,
      simInicio: INICIO,
      rng,
      config,
      opciones: { demora: null, malformado: false },
    });
    const t = tipos(p);
    const primerResultado = t.find(
      (x) => x === "ENTREGADO" || x === "ENTREGA_FALLIDA",
    );
    entregados++;
    if (primerResultado === "ENTREGADO") primeraVez++;
  }
  const tasa = primeraVez / entregados;
  assert.ok(tasa > 0.78 && tasa < 0.86, `tasa de primer intento: ${tasa}`);
});

test("los eventos de un envío salen en orden cronológico", () => {
  const rng = crearRng(5);
  for (let i = 1; i <= 200; i++) {
    const p = planificarEnvio({ numero: i, simInicio: INICIO, rng, config });
    for (let j = 1; j < p.pasos.length; j++)
      assert.ok(p.pasos[j].simMs >= p.pasos[j - 1].simMs);
  }
});
