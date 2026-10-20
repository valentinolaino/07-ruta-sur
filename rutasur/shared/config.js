module.exports = {
  // Lista de brokers separados por coma. Desde tu máquina: localhost:9092
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),

  // Cadena de conexión a PostgreSQL: usuario, contraseña, host, puerto y base.
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://rutasur:rutasur@localhost:5434/rutasur",
};
