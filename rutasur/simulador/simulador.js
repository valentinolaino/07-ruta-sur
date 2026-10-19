// Simulador de eventos de RutaSur.
//
// Reemplaza a los sistemas de origen (depósito, app del repartidor, comercio).
// Hace tres cosas:
//   1. FLUJO CONTINUO: crea envíos a un ritmo fijo (por defecto 20 por minuto) y va
//      publicando sus eventos a medida que pasa el tiempo simulado.
//   2. ESCENARIOS A PEDIDO: feliz, ausente, demorado, tercer-fallo, ráfaga, etc.
//   3. API DE CONTROL (HTTP, puerto 4000): el panel de demo de Next.js la usa para
//      disparar los escenarios.
//
// Uso:
//   node simulador/simulador.js                  -> flujo continuo + API
//   node simulador/simulador.js --sin-flujo      -> solo escenarios a pedido
//   node simulador/simulador.js --escenario feliz  -> dispara uno al arrancar
//
// Las mismas variables de entorno SIM_* de simulador/config.js cambian los parámetros.

const http = require('node:http');
const config = require('./config');
const { crearRng } = require('./aleatorio');
const { Reloj } = require('./reloj');
const { Agenda } = require('./agenda');
const { planificarEnvio } = require('./plan');
const { ESCENARIOS, NOMBRES } = require('./escenarios');
const { crearProductor, publicarLote, publicarCrudo } = require('../shared/kafka');
const { log, logError } = require('../shared/logger');

const SERVICIO = 'simulador';
const TICK_MS = 50; // cada cuánto se revisa la agenda
const REINTENTO_PUBLICACION_MS = 1000;

const args = process.argv.slice(2);
const flujoContinuo = !args.includes('--sin-flujo');
const escenarioInicial = args.includes('--escenario') ? args[args.indexOf('--escenario') + 1] : null;

async function main() {
  const reloj = new Reloj({ inicioSimulado: config.inicioSimulado, factor: config.factorAceleracion });
  const agenda = new Agenda();
  const productor = await crearProductor(SERVICIO);

  // Dos generadores con la misma semilla base pero independientes: así disparar un
  // escenario en la demo NO cambia lo que genera el flujo continuo.
  const rngFlujo = crearRng(config.semilla);
  const rngEscenarios = crearRng(config.semilla ^ 0x9e3779b9);

  const estadisticas = { enviosCreados: 0, eventosPublicados: 0, errores: 0 };
  let numeroFlujo = 0; // cuántos envíos del flujo continuo ya se crearon
  let numeroDemo = 0;
  const realInicio = reloj.inicioReal;
  const msEntreEnvios = 60000 / config.enviosPorMinuto;

  // Mete todos los pasos de un plan en la agenda, a la hora real que le corresponde.
  function agendar(plan) {
    for (const paso of plan.pasos) {
      paso.shipmentId = plan.shipmentId; // para la clave de partición de los eventos "crudos"
      agenda.agregar(reloj.realDe(paso.simMs), paso);
    }
    estadisticas.enviosCreados += 1;
  }

  // --- 1. Flujo continuo --------------------------------------------------------
  // El n-ésimo envío se crea en un instante FIJO (inicio + n * intervalo), no "cuando
  // me acuerdo". Por eso, con la misma semilla, las fechas de los eventos se repiten.
  function crearEnviosPendientes(ahoraReal) {
    while (realInicio + numeroFlujo * msEntreEnvios <= ahoraReal) {
      const realCreacion = realInicio + numeroFlujo * msEntreEnvios;
      numeroFlujo += 1;
      agendar(
        planificarEnvio({
          numero: numeroFlujo,
          simInicio: reloj.simDe(realCreacion),
          rng: rngFlujo,
          config,
        })
      );
    }
  }

  // --- Publicación ------------------------------------------------------------
  // Los eventos vencidos se agrupan por topic y se mandan juntos (una ráfaga de 500
  // envíos no puede ser 500 llamadas sueltas). Dentro de un lote se conserva el orden.
  let publicando = false;
  async function vaciarAgenda() {
    if (publicando) return;
    publicando = true;
    try {
      const vencidos = agenda.extraerVencidos(Date.now());
      if (vencidos.length === 0) return;

      // Los eventos malformados (texto) se mandan uno por uno, tal cual.
      // Los demás: un lote por topic.
      const porTopic = new Map();
      const crudos = [];
      for (const paso of vencidos) {
        if (typeof paso.valor === 'string') crudos.push(paso);
        else {
          if (!porTopic.has(paso.topic)) porTopic.set(paso.topic, []);
          porTopic.get(paso.topic).push(paso);
        }
      }

      for (const [topic, pasos] of porTopic) {
        try {
          await publicarLote(productor, topic, pasos.map((p) => p.valor));
          estadisticas.eventosPublicados += pasos.length;
          // En una ráfaga son cientos de eventos: ahí se loguea un resumen, no uno por uno.
          if (pasos.length > 20) {
            log(SERVICIO, `publicados ${pasos.length} eventos`, { topic });
          } else {
            for (const p of pasos) {
              log(SERVICIO, `publicado ${p.etiqueta}`, {
                topic,
                eventId: p.valor.eventId,
                shipmentId: p.valor.shipmentId,
                secuencia: p.valor.secuencia,
              });
            }
          }
        } catch (error) {
          // Kafka no respondió: los pasos vuelven a la agenda y se reintentan.
          estadisticas.errores += 1;
          logError(SERVICIO, `no se pudo publicar en ${topic}; se reintenta`, error);
          for (const p of pasos) agenda.agregar(Date.now() + REINTENTO_PUBLICACION_MS, p);
        }
      }

      for (const paso of crudos) {
        try {
          await publicarCrudo(productor, paso.topic, claveDe(paso), paso.valor);
          estadisticas.eventosPublicados += 1;
          log(SERVICIO, 'publicado evento MALFORMADO a propósito (debe ir a la DLQ)', {
            topic: paso.topic,
            texto: paso.valor.slice(0, 80),
          });
        } catch (error) {
          estadisticas.errores += 1;
          logError(SERVICIO, 'no se pudo publicar el evento malformado; se reintenta', error);
          agenda.agregar(Date.now() + REINTENTO_PUBLICACION_MS, paso);
        }
      }
    } finally {
      publicando = false;
    }
  }

  // La clave de un evento malformado es el shipmentId del envío al que pertenece
  // (así cae en la misma partición que el resto de los eventos de ese envío).
  function claveDe(paso) {
    return paso.shipmentId;
  }

  // --- 2. Escenarios a pedido ---------------------------------------------------
  function dispararEscenario(nombre) {
    const escenario = ESCENARIOS[nombre];
    if (!escenario) return null;
    const planes = escenario.crear({
      rng: rngEscenarios,
      config,
      ahoraSim: reloj.ahoraSim(),
      siguienteDemo: () => ++numeroDemo,
    });
    for (const plan of planes) agendar(plan);
    log(SERVICIO, `escenario "${nombre}" disparado`, {
      envios: planes.length,
      shipmentIds: planes.length <= 5 ? planes.map((p) => p.shipmentId) : undefined,
    });
    return planes.map((p) => p.shipmentId);
  }

  // --- 3. API de control (HTTP) ---------------------------------------------------
  //   GET  /estado               -> parámetros y contadores
  //   GET  /escenarios           -> lista de escenarios con su descripción
  //   POST /escenarios/:nombre   -> dispara un escenario
  const servidor = http.createServer((req, res) => {
    // El panel de demo corre en otro puerto (Next.js): hay que permitir CORS.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    const responder = (codigo, cuerpo) => {
      res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(cuerpo));
    };

    if (req.method === 'OPTIONS') return responder(204, {});

    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/estado') {
      return responder(200, {
        flujoContinuo,
        enviosPorMinuto: config.enviosPorMinuto,
        factorAceleracion: config.factorAceleracion,
        semilla: config.semilla,
        ahoraSimulado: new Date(reloj.ahoraSim()).toISOString(),
        pendientesEnAgenda: agenda.pendientes,
        ...estadisticas,
      });
    }
    if (req.method === 'GET' && url.pathname === '/escenarios') {
      return responder(
        200,
        NOMBRES.map((nombre) => ({ nombre, descripcion: ESCENARIOS[nombre].descripcion }))
      );
    }
    const m = url.pathname.match(/^\/escenarios\/([\w-]+)$/);
    if (req.method === 'POST' && m) {
      const shipmentIds = dispararEscenario(m[1]);
      if (!shipmentIds) return responder(404, { error: `escenario desconocido: ${m[1]}`, disponibles: NOMBRES });
      return responder(200, { ok: true, escenario: m[1], shipmentIds });
    }
    return responder(404, { error: 'no encontrado' });
  });
  servidor.listen(config.puertoControl, () =>
    log(SERVICIO, `API de control en http://localhost:${config.puertoControl}`)
  );

  // --- Arranque -----------------------------------------------------------------
  log(SERVICIO, 'iniciado', {
    flujoContinuo,
    enviosPorMinuto: config.enviosPorMinuto,
    segundosRealesPorHoraSimulada: 3600 / config.factorAceleracion,
    semilla: config.semilla,
    inicioSimulado: new Date(config.inicioSimulado).toISOString(),
  });

  if (escenarioInicial && !dispararEscenario(escenarioInicial)) {
    logError(SERVICIO, `escenario desconocido: ${escenarioInicial}. Disponibles: ${NOMBRES.join(', ')}`);
  }

  const temporizador = setInterval(() => {
    if (flujoContinuo) crearEnviosPendientes(Date.now());
    vaciarAgenda().catch((error) => logError(SERVICIO, 'error al vaciar la agenda', error));
  }, TICK_MS);

  const cerrar = async () => {
    log(SERVICIO, 'cerrando...', { pendientesSinPublicar: agenda.pendientes });
    clearInterval(temporizador);
    servidor.close();
    try {
      await productor.disconnect();
    } catch (error) {
      logError(SERVICIO, 'error al cerrar', error);
    }
    process.exit(0);
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}

main().catch((error) => {
  logError(SERVICIO, 'no pudo iniciar (¿está Kafka levantado? probá: npm run verificar)', error);
  process.exit(1);
});
