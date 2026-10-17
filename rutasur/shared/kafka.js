// Conexión a Kafka: productor y consumidor reutilizables por todos los servicios.
//
// Decisiones del PDF que se implementan acá:
//   - Garantía "al menos una vez": el offset se confirma DESPUÉS de procesar, y no antes.
//   - Confirmación manual de offsets (autoCommit apagado).
//   - Evento inválido -> va a la DLQ con el motivo y el consumo continúa.
//   - Observabilidad: cada evento procesado registra eventId, partición y offset.

const { Kafka, logLevel } = require('kafkajs');
const config = require('./config');
const { TOPICS, validarEvento } = require('./eventos');
const { log, logError } = require('./logger');

function crearKafka(clientId) {
  return new Kafka({
    clientId, // nombre con el que Kafka identifica a este servicio
    brokers: config.kafkaBrokers,
    logLevel: logLevel.WARN, // solo advertencias y errores de la librería
    retry: { retries: 8 }, // reintenta conectar si Kafka todavía está arrancando
  });
}

// ---------------------------------------------------------------------------
// Productor
// ---------------------------------------------------------------------------

async function crearProductor(clientId) {
  const kafka = crearKafka(clientId);
  const producer = kafka.producer({
    // Si te equivocás el nombre de un topic, falla en vez de crear uno nuevo en silencio.
    allowAutoTopicCreation: false,
  });
  await producer.connect();
  return producer;
}

// Publica un evento. La CLAVE es siempre el shipmentId: Kafka manda todos los
// eventos con la misma clave a la misma partición, y eso garantiza su orden.
async function publicar(producer, topic, evento) {
  await producer.send({
    topic,
    messages: [{ key: evento.shipmentId, value: JSON.stringify(evento) }],
  });
}

// Igual que publicar, pero varios eventos en un solo envío (útil para la ráfaga de 500).
async function publicarLote(producer, topic, eventos) {
  await producer.send({
    topic,
    messages: eventos.map((e) => ({ key: e.shipmentId, value: JSON.stringify(e) })),
  });
}

// Publica un texto tal cual, sin convertirlo. El simulador lo usa para inyectar
// eventos malformados a propósito y probar la DLQ.
async function publicarCrudo(producer, topic, clave, texto) {
  await producer.send({ topic, messages: [{ key: clave, value: texto }] });
}

// ---------------------------------------------------------------------------
// Consumidor
// ---------------------------------------------------------------------------

// Arranca un consumidor y llama a "manejar(evento, ubicacion)" por cada evento VÁLIDO.
//
// Parámetros:
//   servicio    nombre para los logs (ej: 'proyector')
//   groupId     grupo de consumidores (ver GRUPOS en eventos.js)
//   topics      lista de topics a leer
//   manejar     async (evento, { topic, particion, offset }) => { ... }
//   desdeInicio true = si el grupo es nuevo, empieza desde el primer evento del topic
//               (así se hace el reprocesamiento del CU4). Si el grupo ya tiene offsets
//               guardados, esta opción se ignora y retoma desde donde quedó.
async function consumir({ servicio, groupId, topics, manejar, desdeInicio = false }) {
  const kafka = crearKafka(servicio);
  const consumer = kafka.consumer({ groupId });
  const productorDlq = await crearProductor(`${servicio}-dlq`);

  await consumer.connect();
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: desdeInicio });
  }

  await consumer.run({
    autoCommit: false, // los offsets los confirmamos nosotros, después de procesar
    eachMessage: async ({ topic, partition, message }) => {
      const ubicacion = { topic, particion: partition, offset: message.offset };
      const textoCrudo = message.value ? message.value.toString() : '';

      // 1) ¿Es un JSON?  2) ¿Cumple el esquema?
      let evento = null;
      let motivoInvalido = null;
      try {
        evento = JSON.parse(textoCrudo);
      } catch {
        motivoInvalido = 'JSON inválido';
      }
      if (!motivoInvalido) {
        const resultado = validarEvento(topic, evento);
        if (!resultado.valido) motivoInvalido = resultado.errores.join('; ');
      }

      if (motivoInvalido) {
        // Evento inválido: va a la DLQ con el motivo y el consumo continúa.
        const clave = message.key ? message.key.toString() : 'desconocido';
        await productorDlq.send({
          topic: TOPICS.DLQ,
          messages: [
            {
              key: clave,
              value: JSON.stringify({
                motivo: motivoInvalido,
                consumidor: groupId,
                origen: ubicacion,
                recibidoEn: new Date().toISOString(),
                payload: textoCrudo,
              }),
            },
          ],
        });
        log(servicio, 'evento inválido enviado a la DLQ', { motivo: motivoInvalido, ...ubicacion });
      } else {
        log(servicio, 'procesando evento', {
          eventId: evento.eventId,
          tipo: evento.tipo,
          ...ubicacion,
        });
        // Si "manejar" lanza un error, NO se confirma el offset: kafkajs reintenta
        // el mismo evento. Por eso "manejar" tiene que ser idempotente.
        await manejar(evento, ubicacion);
      }

      // Recién ahora confirmamos: "el próximo evento que quiero leer es offset + 1".
      await consumer.commitOffsets([
        { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
      ]);
    },
  });

  // Ctrl+C: nos desconectamos prolijo para que Kafka reasigne las particiones enseguida.
  const cerrar = async () => {
    log(servicio, 'cerrando consumidor...');
    try {
      await consumer.disconnect();
      await productorDlq.disconnect();
    } catch (error) {
      logError(servicio, 'error al cerrar', error);
    }
    process.exit(0);
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);

  return consumer;
}

module.exports = {
  crearKafka,
  crearProductor,
  publicar,
  publicarLote,
  publicarCrudo,
  consumir,
};
