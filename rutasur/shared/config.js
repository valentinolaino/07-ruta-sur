// Configuración común a todos los servicios.
//
// Cada valor se lee de una variable de entorno y, si no existe, usa el valor por
// defecto que coincide con el docker-compose.yml. Cuando corras un servicio
// DENTRO de Docker, solo vas a cambiar las variables (por ejemplo KAFKA_BROKERS=kafka:29092),
// sin tocar el código.

module.exports = {
  // Lista de brokers separados por coma. Desde tu máquina: localhost:9092
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),

  // Cadena de conexión a PostgreSQL: usuario, contraseña, host, puerto y base.
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://rutasur:rutasur@localhost:5432/rutasur',
};
