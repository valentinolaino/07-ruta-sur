// Etiquetas y colores de los estados de envío (espejo del catálogo del TP).
// Deben coincidir con TIPOS_ESTADO / TIPOS_REPROGRAMACION en shared/eventos.js.

export const ESTADOS = {
  CREADO: { etq: "Creado", tono: "gris" },
  INGRESADO_HUB: { etq: "Ingresado al hub", tono: "azul" },
  CLASIFICADO: { etq: "Clasificado", tono: "celeste" },
  EN_REPARTO: { etq: "En reparto", tono: "celeste" },
  ENTREGADO: { etq: "Entregado", tono: "verde" },
  ENTREGA_FALLIDA: { etq: "Entrega fallida", tono: "naranja" },
  REPROGRAMADO: { etq: "Reprogramado", tono: "lila" },
  RETENIDO: { etq: "Retenido", tono: "naranja" },
  DEVOLUCION: { etq: "Devolución", tono: "rojo" },
};

export function etiquetaEstado(estado) {
  return (ESTADOS[estado] && ESTADOS[estado].etq) || estado || "—";
}

export function tonoEstado(estado) {
  return (ESTADOS[estado] && ESTADOS[estado].tono) || "gris";
}

// Pasos del embudo del CU1: cada paso cuenta envíos que llegaron a ese hito.
export const EMBUDO = ["CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO", "ENTREGADO"];

// Estados fuera del circuito feliz (contadores adicionales de la torre).
export const ESTADOS_FALLA = ["ENTREGA_FALLIDA", "REPROGRAMADO", "RETENIDO", "DEVOLUCION"];

// Las reglas de SLA (shared/eventos.js: REGLAS_SLA + PRIORIDAD_POR_REGLA).
export const REGLAS_SLA = {
  SIN_INGRESO: { etq: "Sin ingreso al hub", prioridad: "MEDIA" },
  SIN_SALIDA: { etq: "Sin salida a reparto", prioridad: "ALTA" },
  FALLO_DIA_LIMITE: { etq: "Fallo en el día límite", prioridad: "ALTA" },
  VENCIDO: { etq: "Promesa vencida", prioridad: "CRITICA" },
};

export function etiquetaRegla(regla) {
  return (REGLAS_SLA[regla] && REGLAS_SLA[regla].etq) || regla || "—";
}

export function tonoPrioridad(prioridad) {
  if (prioridad === "CRITICA") return "rojo";
  if (prioridad === "ALTA") return "naranja";
  if (prioridad === "MEDIA") return "gris";
  return "gris";
}
