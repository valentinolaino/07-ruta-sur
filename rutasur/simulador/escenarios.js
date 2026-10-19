// Escenarios a pedido para la demo (los dispara el panel de Next.js o la línea de comandos).
//
// Cada escenario devuelve una lista de "planes" (uno por envío) listos para agendar.
// Los tiempos están acortados a propósito: con 1 h simulada = 30 s reales, el envío
// feliz termina en ~30 s y la alerta del "demorado" aparece al minuto.

const { planificarEnvio } = require('./plan');
// ctx = { rng, config, ahoraSim, siguienteDemo }
//   rng            generador con semilla (aparte del flujo continuo, para no alterarlo)
//   ahoraSim       instante simulado actual
//   siguienteDemo  () => número para armar ids ENV-D0001, ENV-D0002...
function unEnvio(ctx, opciones, simInicio = ctx.ahoraSim) {
  const n = ctx.siguienteDemo();
  return planificarEnvio({
    numero: n,
    simInicio,
    rng: ctx.rng,
    config: ctx.config,
    opciones: {
      shipmentId: `ENV-D${String(n).padStart(4, '0')}`,
      // En los escenarios no hay demora, duplicados, desorden ni eventos rotos al azar:
      // lo que se ve en la demo es exactamente lo que se pidió.
      demora: null,
      malformado: false,
      duplicarEventos: false,
      desordenarEventos: false,
      ...opciones,
    },
  });
}

const ESCENARIOS = {
  feliz: {
    descripcion: 'Un envío recorre todos los estados sin incidentes (~30 s).',
    crear: (ctx) => [
      unEnvio(ctx, {
        horas: { ingreso: 0.2, clasificado: 0.4, reparto: 0.6, resultado: 1 },
        resultados: ['ENTREGADO'],
      }),
    ],
  },

  ausente: {
    descripcion: 'Un envío falla por AUSENTE y se reprograma; el 2.º intento sale bien.',
    crear: (ctx) => [
      unEnvio(ctx, {
        zonaId: 'ZONA-C',
        horas: { ingreso: 0.2, clasificado: 0.4, reparto: 0.6, resultado: 1 },
        resultados: ['AUSENTE', 'ENTREGADO'],
        reintentoHoras: 1.5, // acortado para la demo (la regla real es el día hábil siguiente)
      }),
    ],
  },

  demorado: {
    descripcion: 'Un envío queda detenido en el hub hasta disparar una alerta de SLA.',
    crear: (ctx) => [
      unEnvio(ctx, {
        horasPromesa: 5, // a la hora simulada ~1 (30 s reales) faltan < 4 h: alerta "sin salida"
        horas: { ingreso: 0.3 },
        detenerEnHub: true,
      }),
    ],
  },

  'tercer-fallo': {
    descripcion: 'Un envío agota sus 3 intentos y pasa a devolución.',
    crear: (ctx) => [
      unEnvio(ctx, {
        horas: { ingreso: 0.2, clasificado: 0.4, reparto: 0.6, resultado: 1 },
        resultados: ['AUSENTE', 'AUSENTE', 'AUSENTE'],
        reintentoHoras: 1.5,
      }),
    ],
  },

  // Para los criterios "un duplicado no agrega entrada repetida" y
  // "un evento fuera de orden no hace retroceder el estado".
  duplicado: {
    descripcion: 'Un envío feliz donde CADA evento llega dos veces.',
    crear: (ctx) => [
      unEnvio(ctx, {
        duplicarEventos: true,
        horas: { ingreso: 0.2, clasificado: 0.4, reparto: 0.6, resultado: 1 },
        resultados: ['ENTREGADO'],
      }),
    ],
  },

  'fuera-de-orden': {
    descripcion: 'Un envío feliz donde, tras cada evento, llega uno viejo (secuencia menor).',
    crear: (ctx) => [
      unEnvio(ctx, {
        desordenarEventos: true,
        horas: { ingreso: 0.2, clasificado: 0.4, reparto: 0.6, resultado: 1 },
        resultados: ['ENTREGADO'],
      }),
    ],
  },

  invalido: {
    descripcion: 'Inyecta un evento malformado: debe terminar en la DLQ sin frenar el flujo.',
    crear: (ctx) => [
      unEnvio(ctx, {
        malformado: true,
        detenerEnHub: true,
        horas: { ingreso: 0.2 },
        horasPromesa: 48,
      }),
    ],
  },

  rafaga: {
    descripcion: '500 envíos creados en ~5 segundos (acumulación y recuperación).',
    crear: (ctx) => {
      const CANTIDAD = 500;
      const SEGUNDOS = 5;
      const factor = ctx.config.factorAceleracion;
      const planes = [];
      for (let i = 0; i < CANTIDAD; i++) {
        // reparte las creaciones a lo largo de los 5 segundos reales
        const desfase = (i * (SEGUNDOS * 1000) / CANTIDAD) * factor;
        planes.push(
          unEnvio(
            ctx,
            { demora: undefined, malformado: undefined, duplicarEventos: undefined, desordenarEventos: undefined },
            ctx.ahoraSim + desfase
          )
        );
      }
      return planes;
    },
  },
};

module.exports = { ESCENARIOS, NOMBRES: Object.keys(ESCENARIOS) };
