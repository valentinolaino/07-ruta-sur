// Estados "derivados": no vienen en envios.estados, los decide el servicio de reprogramación.
const ESTADO_POR_DECISION = {
  REPROGRAMADO: "REPROGRAMADO",
  RETENIDO: "RETENIDO",
  DEVOLUCION: "DEVOLUCION",
};

function documentoVacio(shipmentId) {
  return {
    shipmentId,
    estado: "CREADO", // un envío que todavía no tuvo su CREADO se ve como recién creado
    hubId: null,
    zonaId: null,
    repartidorId: null,
    promesaVenceEn: null,
    intentos: 0,
    motivoFallo: null,
    reprogramacion: null,
    historial: [],
    ultimaSecuencia: 0,
  };
}

function entradaHistorial(evento, origen, extra = {}) {
  return {
    eventId: evento.eventId,
    tipo: evento.tipo,
    ocurridoEn: evento.ocurridoEn,
    secuencia: evento.secuencia,
    origen, // de qué topic vino
    ...extra,
  };
}

const yaEstaEnHistorial = (doc, eventId) =>
  doc.historial.some((h) => h.eventId === eventId);

// Si el último fallo ya tiene decisión de reprogramación, el estado pasa a ser el derivado.
function estadoConDecision(doc) {
  const r = doc.reprogramacion;
  if (doc.estado === "ENTREGA_FALLIDA" && r && r.intento === doc.intentos) {
    return ESTADO_POR_DECISION[r.decision] || doc.estado;
  }
  return doc.estado;
}

// ---------------------------------------------------------------------------
// envios.estados
// ---------------------------------------------------------------------------
function aplicarEstado(doc, evento) {
  // Regla de duplicados (segunda línea de defensa; la primera es eventos_procesados)
  if (yaEstaEnHistorial(doc, evento.eventId)) {
    return { doc, aplicado: false, motivo: "duplicado" };
  }
  // Regla de orden: secuencia menor o igual a la ya aplicada -> se descarta.
  // Un evento viejo NUNCA puede hacer retroceder el estado.
  if (evento.secuencia <= doc.ultimaSecuencia) {
    return {
      doc,
      aplicado: false,
      motivo: `fuera de orden (secuencia ${evento.secuencia} <= ${doc.ultimaSecuencia})`,
    };
  }

  const fallo = evento.tipo === "ENTREGA_FALLIDA";
  const nuevo = {
    ...doc,
    estado: evento.tipo,
    // Las dimensiones se completan con lo que trae el evento y se conserva lo ya sabido.
    hubId: evento.hubId ?? doc.hubId,
    zonaId: evento.zonaId ?? doc.zonaId,
    repartidorId: evento.repartidorId ?? doc.repartidorId,
    intentos: fallo ? doc.intentos + 1 : doc.intentos,
    motivoFallo: fallo ? evento.motivo : doc.motivoFallo,
    ultimaSecuencia: evento.secuencia,
    historial: [
      ...doc.historial,
      entradaHistorial(
        evento,
        "envios.estados",
        fallo ? { motivo: evento.motivo } : {},
      ),
    ],
  };
  // Carrera entre topics: la decisión de reprogramación pudo llegar ANTES que el fallo.
  nuevo.estado = estadoConDecision(nuevo);
  return { doc: nuevo, aplicado: true };
}

// ---------------------------------------------------------------------------
// envios.promesas
// ---------------------------------------------------------------------------
function aplicarPromesa(doc, evento) {
  if (doc.promesaVenceEn === evento.venceEn) {
    return { doc, aplicado: false, motivo: "promesa sin cambios" };
  }
  return {
    doc: {
      ...doc,
      promesaVenceEn: evento.venceEn,
      hubId: evento.hubId ?? doc.hubId,
      zonaId: evento.zonaId ?? doc.zonaId,
    },
    aplicado: true,
  };
}

// ---------------------------------------------------------------------------
// envios.reprogramaciones
// ---------------------------------------------------------------------------
function aplicarReprogramacion(doc, evento) {
  if (yaEstaEnHistorial(doc, evento.eventId)) {
    return { doc, aplicado: false, motivo: "duplicado" };
  }
  const nuevo = {
    ...doc,
    reprogramacion: {
      decision: evento.tipo,
      intento: evento.intento,
      motivo: evento.motivo ?? null,
      proximoIntento: evento.proximoIntento ?? null,
      razon: evento.razon ?? null,
      decididoEn: evento.ocurridoEn,
    },
    historial: [
      ...doc.historial,
      entradaHistorial(evento, "envios.reprogramaciones", {
        intento: evento.intento,
      }),
    ],
  };
  // El estado cambia solo si el envío sigue en el fallo al que responde esta decisión.
  // Si ya avanzó (llegó el nuevo CLASIFICADO antes que la decisión), se registra y listo.
  nuevo.estado = estadoConDecision(nuevo);
  return { doc: nuevo, aplicado: true };
}

module.exports = {
  documentoVacio,
  aplicarEstado,
  aplicarPromesa,
  aplicarReprogramacion,
  estadoConDecision,
};
