const numero = (nombre, porDefecto) => {
  const valor = Number(process.env[nombre]);
  return process.env[nombre] !== undefined && Number.isFinite(valor)
    ? valor
    : porDefecto;
};

// 6 zonas en 3 hubs
const ZONAS = [
  { id: "ZONA-A", hubId: "HUB-1", tasaFallo: 0.05 },
  { id: "ZONA-B", hubId: "HUB-1", tasaFallo: 0.12 },
  { id: "ZONA-C", hubId: "HUB-2", tasaFallo: 0.3, sesgoManana: true },
  { id: "ZONA-D", hubId: "HUB-2", tasaFallo: 0.18 },
  { id: "ZONA-E", hubId: "HUB-3", tasaFallo: 0.22 },
  { id: "ZONA-F", hubId: "HUB-3", tasaFallo: 0.2 },
];

const REPARTIDORES_POR_ZONA = 20;

const segundosPorHora = numero("SIM_SEGUNDOS_POR_HORA", 30); // 1 hora simulada = 30 s reales

module.exports = {
  zonas: ZONAS,
  repartidoresPorZona: REPARTIDORES_POR_ZONA,

  enviosPorMinuto: numero("SIM_ENVIOS_POR_MINUTO", 20),

  // Cuántos milisegundos simulados pasan por cada milisegundo real (30 s -> 1 h = 120)
  factorAceleracion: 3600 / segundosPorHora,

  // Inicio del reloj simulado. Fijo para que la corrida sea repetible.
  // Lunes 19/10/2026 06:00 UTC.
  inicioSimulado: Date.parse(
    process.env.SIM_INICIO || "2026-10-19T06:00:00.000Z",
  ),

  semilla: numero("SIM_SEMILLA", 42),

  // Motivos de fallo (pesos): 60 % ausente, 20 % dirección, 15 % rechazo, 5 % zona
  motivos: {
    AUSENTE: 60,
    DIRECCION_INCORRECTA: 20,
    RECHAZADO: 15,
    ZONA_INACCESIBLE: 5,
  },

  probDemoraHub: numero("SIM_PROB_DEMORA_HUB", 0.1),
  probDuplicado: numero("SIM_PROB_DUPLICADO", 0.02),
  probFueraDeOrden: numero("SIM_PROB_FUERA_DE_ORDEN", 0.02),
  probMalformado: numero("SIM_PROB_MALFORMADO", 0.01),

  puertoControl: numero("SIM_PUERTO", 4000),
};
