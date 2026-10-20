-- RutaSur - migración para volúmenes de PostgreSQL ya creados

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
