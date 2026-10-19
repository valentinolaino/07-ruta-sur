-- RutaSur - migración para volúmenes de PostgreSQL ya creados
--
-- db/init.sql SOLO se ejecuta la primera vez que se crea el volumen. Si tu entorno
-- ya está corriendo y aparecieron tablas nuevas (monitor_sla, metricas_tiempos),
-- aplicá este archivo SIN borrar nada:
--
--   docker compose exec -T postgres psql -U rutasur -d rutasur < db/migracion.sql
--
-- (En una máquina limpia no hace falta: init.sql ya trae todo.)

CREATE TABLE IF NOT EXISTS monitor_sla (
    shipment_id        TEXT PRIMARY KEY,
    estado             TEXT NOT NULL,
    hub_id             TEXT,
    zona_id            TEXT,
    vence_en           TIMESTAMPTZ,
    ultima_secuencia   INTEGER NOT NULL DEFAULT 0,
    reglas_alertadas   JSONB   NOT NULL DEFAULT '[]',
    terminado          BOOLEAN NOT NULL DEFAULT false,
    ultimo_ocurrido_en TIMESTAMPTZ NOT NULL,
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitor_sla_abiertos ON monitor_sla (terminado);

CREATE TABLE IF NOT EXISTS metricas_tiempos (
    fecha    DATE    NOT NULL,
    hub_id   TEXT    NOT NULL,
    muestras INTEGER NOT NULL DEFAULT 0,
    suma_ms  BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (fecha, hub_id)
);
