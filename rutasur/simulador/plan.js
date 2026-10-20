// Planificación del ciclo de vida de UN envío.
const { TOPICS, crearEvento } = require("../shared/eventos");
const T = require("../shared/tiempo");

const { HORA } = T;

function crearEventoDeterminista(rng, datos) {
  return { ...crearEvento(datos), eventId: rng.uuid() };
}

// Evento "roto" a propósito, para probar la DLQ. Hay cuatro maneras de romperlo.
function eventoMalformado(rng, shipmentId, simMs) {
  const base = crearEventoDeterminista(rng, {
    shipmentId,
    tipo: "CREADO",
    secuencia: 1,
    ocurridoEn: new Date(simMs).toISOString(),
  });
  switch (rng.entero(0, 3)) {
    case 0: // JSON cortado a la mitad
      return JSON.stringify(base).slice(0, 40);
    case 1: {
      // falta el eventId
      const { eventId, ...sinId } = base;
      return JSON.stringify(sinId);
    }
    case 2: // tipo de estado inexistente
      return JSON.stringify({ ...base, tipo: "TELETRANSPORTADO" });
    default: // ENTREGA_FALLIDA sin motivo
      return JSON.stringify({
        ...base,
        tipo: "ENTREGA_FALLIDA",
        hubId: "HUB-1",
        zonaId: "ZONA-A",
      });
  }
}

function planificarEnvio({ numero, simInicio, rng, config, opciones = {} }) {
  const shipmentId =
    opciones.shipmentId || `ENV-${String(numero).padStart(6, "0")}`;
  const zona = opciones.zonaId
    ? config.zonas.find((z) => z.id === opciones.zonaId)
    : rng.elegir(config.zonas);
  const indiceZona = config.zonas.indexOf(zona);
  const hubId = zona.hubId;
  const zonaId = zona.id;
  const repartidorId = `R-${String(indiceZona * config.repartidoresPorZona + rng.entero(1, config.repartidoresPorZona)).padStart(3, "0")}`;

  // true = siempre, false = nunca, sin indicar = la probabilidad configurada
  const probabilidad = (forzar, porDefecto) =>
    forzar === undefined ? porDefecto : forzar ? 1 : 0;
  const pDuplicado = probabilidad(
    opciones.duplicarEventos,
    config.probDuplicado,
  );
  const pFueraDeOrden = probabilidad(
    opciones.desordenarEventos,
    config.probFueraDeOrden,
  );

  const pasos = [];
  let secuencia = 0;
  let anterior = null; // { tipo, simMs } del último estado emitido

  // Agrega un evento a envios.estados (con su duplicado o su "evento viejo" si toca).
  function estado(simMs, tipo, extra = {}, conRepartidor = true) {
    secuencia += 1;
    const evento = crearEventoDeterminista(rng, {
      shipmentId,
      tipo,
      secuencia,
      ocurridoEn: new Date(simMs).toISOString(),
      hubId,
      zonaId,
      repartidorId: conRepartidor ? repartidorId : null,
      ...extra,
    });
    pasos.push({ simMs, topic: TOPICS.ESTADOS, valor: evento, etiqueta: tipo });

    // Duplicado: MISMO eventId. El consumidor debe descartarlo (idempotencia).
    if (rng.chance(pDuplicado)) {
      pasos.push({
        simMs,
        topic: TOPICS.ESTADOS,
        valor: evento,
        etiqueta: `${tipo} (duplicado)`,
      });
    }
    // Fuera de orden: llega, después de éste, un evento VIEJO (secuencia anterior).
    // Tiene eventId nuevo, así que lo único que lo frena es la regla de secuencia.
    if (anterior && rng.chance(pFueraDeOrden)) {
      const viejo = crearEventoDeterminista(rng, {
        shipmentId,
        tipo: anterior.tipo,
        secuencia: secuencia - 1,
        ocurridoEn: new Date(anterior.simMs).toISOString(),
        hubId,
        zonaId,
        repartidorId: conRepartidor ? repartidorId : null,
        ...anterior.extra, // el evento viejo conserva sus campos propios (motivo, intento)
      });
      pasos.push({
        simMs,
        topic: TOPICS.ESTADOS,
        valor: viejo,
        etiqueta: `${anterior.tipo} (fuera de orden)`,
      });
    }
    anterior = { tipo, simMs, extra };
  }

  // --- Decisiones aleatorias (se sortean SIEMPRE, para que cambiar una opción
  //     no altere el resto de la secuencia aleatoria) ---
  const sorteoDemora = rng.next();
  const tipoDemora = rng.chance(0.5) ? "INGRESO" : "SALIDA";
  const horasPromesaSorteo = rng.elegir([24, 36, 48]);
  const sorteoMalformado = rng.next();

  let demora = null;
  if (opciones.demora !== undefined) demora = opciones.demora;
  else if (sorteoDemora < config.probDemoraHub) demora = tipoDemora;

  // Con demora, la promesa es de 24 h: así la demora termina en alerta de SLA.
  const horasPromesa =
    opciones.horasPromesa ?? (demora ? 24 : horasPromesaSorteo);

  // --- Instante 0: promesa y creación ---
  const t0 = simInicio;
  const venceEn = t0 + horasPromesa * HORA;
  pasos.push({
    simMs: t0,
    topic: TOPICS.PROMESAS,
    valor: crearEventoDeterminista(rng, {
      shipmentId,
      tipo: "PROMESA",
      secuencia: 1,
      ocurridoEn: new Date(t0).toISOString(),
      hubId,
      zonaId,
      venceEn: new Date(venceEn).toISOString(),
    }),
    etiqueta: "PROMESA",
  });

  estado(t0, "CREADO", {}, false);

  // --- Cronograma ---
  const h = opciones.horas;
  const tIngreso =
    t0 +
    (h
      ? h.ingreso
      : demora === "INGRESO"
        ? rng.rango(15, 19)
        : rng.rango(1, 3)) *
      HORA;
  estado(tIngreso, "INGRESADO_HUB", {}, false);

  if (!opciones.detenerEnHub) {
    const tClasificado =
      tIngreso + (h ? h.clasificado - h.ingreso : rng.rango(0.5, 1)) * HORA;
    estado(tClasificado, "CLASIFICADO");

    const tReparto = h
      ? t0 + h.reparto * HORA
      : demora === "SALIDA"
        ? t0 + rng.rango(21, 23) * HORA
        : tClasificado + rng.rango(1, 2) * HORA;
    estado(tReparto, "EN_REPARTO");

    // --- Intentos de entrega (máximo 3) ---
    let intento = 1;
    let inicioReparto = tReparto;
    let tResultado = h
      ? t0 + h.resultado * HORA
      : tReparto + rng.rango(2, 5) * HORA;

    while (true) {
      const franja = T.franjaDe(tResultado);
      let tasa = zona.tasaFallo;
      if (zona.sesgoManana) tasa *= franja === "MANANA" ? 1.6 : 0.4; // la mañana falla más

      const forzado = opciones.resultados
        ? opciones.resultados[intento - 1]
        : undefined;
      const sorteoFallo = rng.next();
      const motivoSorteado = rng.elegirPonderado(config.motivos);
      let resultado;
      if (forzado) resultado = forzado;
      else resultado = sorteoFallo < tasa ? motivoSorteado : "ENTREGADO";

      if (resultado === "ENTREGADO") {
        estado(tResultado, "ENTREGADO");
        break;
      }

      estado(tResultado, "ENTREGA_FALLIDA", { motivo: resultado, intento });

      // ¿Habrá nuevo intento? Solo AUSENTE y ZONA_INACCESIBLE vuelven al circuito,
      // y nunca después del tercer fallo. (Los demás motivos terminan en retención o devolución.)
      const reintenta =
        (resultado === "AUSENTE" || resultado === "ZONA_INACCESIBLE") &&
        intento < 3;
      if (!reintenta) break;

      let tClasificadoNuevo;
      if (opciones.reintentoHoras !== undefined) {
        tClasificadoNuevo = tResultado + opciones.reintentoHoras * HORA;
        inicioReparto = tClasificadoNuevo + 0.25 * HORA;
      } else {
        // Regla real: día hábil siguiente; AUSENTE en la franja opuesta, ZONA en la misma.
        const dia = T.siguienteDiaHabil(tResultado);
        const franjaNueva =
          resultado === "AUSENTE" ? T.franjaOpuesta(franja) : franja;
        inicioReparto = T.inicioDeFranja(dia, franjaNueva);
        tClasificadoNuevo = inicioReparto - 2 * HORA;
      }
      estado(tClasificadoNuevo, "CLASIFICADO");
      estado(inicioReparto, "EN_REPARTO");

      intento += 1;
      tResultado =
        h || opciones.reintentoHoras !== undefined
          ? inicioReparto + 0.5 * HORA
          : inicioReparto + rng.rango(1, 3) * HORA;
    }
  }

  // --- Evento malformado (opcional): va al mismo topic y debe terminar en la DLQ ---
  const hayMalformado =
    opciones.malformado ?? sorteoMalformado < config.probMalformado;
  if (hayMalformado) {
    const simMs = t0 + 0.5 * HORA;
    pasos.push({
      simMs,
      topic: TOPICS.ESTADOS,
      valor: eventoMalformado(rng, shipmentId, simMs),
      etiqueta: "MALFORMADO",
    });
  }

  // Orden cronológico (el sort de Node es estable: a igual hora, se conserva el
  // orden de inserción, o sea "evento y después su duplicado").
  pasos.sort((a, b) => a.simMs - b.simMs);

  return { shipmentId, zonaId, hubId, pasos };
}

module.exports = { planificarEnvio, eventoMalformado };
