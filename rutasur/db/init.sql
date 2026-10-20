-- RutaSur - esquema de lectura en PostgreSQL

CREATE TABLE envios (
    shipment_id       TEXT PRIMARY KEY,                 
    estado            TEXT        NOT NULL,            
                                                       
    hub_id            TEXT,
    zona_id           TEXT,
    repartidor_id     TEXT,
    promesa_vence_en  TIMESTAMPTZ,                      
    intentos          INTEGER     NOT NULL DEFAULT 0,
    motivo_fallo      TEXT,                             
    reprogramacion    JSONB,                            
    historial         JSONB       NOT NULL DEFAULT '[]', 
    ultima_secuencia  INTEGER     NOT NULL DEFAULT 0,   
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_envios_estado_zona ON envios (estado, zona_id);
CREATE INDEX idx_envios_promesa     ON envios (promesa_vence_en);

-- ---------------------------------------------------------------------------
-- alertas  (la escribe el PROYECTOR a partir de alertas.sla)
-- ---------------------------------------------------------------------------
CREATE TABLE alertas (
    id           BIGSERIAL PRIMARY KEY,
    shipment_id  TEXT        NOT NULL,
    regla        TEXT        NOT NULL,   -- SIN_INGRESO, SIN_SALIDA, FALLO_DIA_LIMITE, VENCIDO
    prioridad    TEXT        NOT NULL,   -- MEDIA, ALTA, CRITICA
    estado       TEXT        NOT NULL DEFAULT 'ABIERTA',  -- ABIERTA | CERRADA
    causa        TEXT,
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
    cerrada_en   TIMESTAMPTZ,
    -- "Sin repetición": la misma regla no alerta dos veces sobre el mismo envío.
    CONSTRAINT uq_alerta_envio_regla UNIQUE (shipment_id, regla)
);

CREATE INDEX idx_alertas_estado_prioridad ON alertas (estado, prioridad);
CREATE INDEX idx_alertas_shipment         ON alertas (shipment_id);

-- ---------------------------------------------------------------------------
-- notificaciones  (la escribe el PROYECTOR a partir de notificaciones.enviadas)
-- No se manda ningún mail ni SMS: solo se registra la notificación simulada.
-- ---------------------------------------------------------------------------
CREATE TABLE notificaciones (
    id           BIGSERIAL PRIMARY KEY,
    event_id     TEXT        NOT NULL UNIQUE,  -- evita duplicar el registro si el evento se reprocesa
    shipment_id  TEXT        NOT NULL,
    tipo         TEXT        NOT NULL,
    mensaje      TEXT,
    opciones     JSONB,                         -- opciones para reprogramar
    creada_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notificaciones_shipment ON notificaciones (shipment_id);


CREATE TABLE metricas_diarias (
    fecha                    DATE    NOT NULL,
    zona_id                  TEXT    NOT NULL,
    franja                   TEXT    NOT NULL,      -- p. ej. MANANA | TARDE
    hub_id                   TEXT    NOT NULL,
    -- Indicador 1: tasa de entrega en primer intento
    entregas_total           INTEGER NOT NULL DEFAULT 0,
    entregas_primer_intento  INTEGER NOT NULL DEFAULT 0,
    -- Indicador 2: distribución de motivos de fallo
    fallos_total             INTEGER NOT NULL DEFAULT 0,
    fallos_ausente           INTEGER NOT NULL DEFAULT 0,
    fallos_direccion         INTEGER NOT NULL DEFAULT 0,
    fallos_rechazo           INTEGER NOT NULL DEFAULT 0,
    fallos_zona              INTEGER NOT NULL DEFAULT 0,
    -- Indicador 3: cumplimiento de SLA
    sla_cumplidos            INTEGER NOT NULL DEFAULT 0,
    sla_incumplidos          INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_metricas UNIQUE (fecha, zona_id, franja)
);

CREATE TABLE eventos_procesados (
    consumidor    TEXT        NOT NULL,
    event_id      TEXT        NOT NULL,
    procesado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumidor, event_id)
);

CREATE INDEX idx_eventos_procesados_fecha ON eventos_procesados (procesado_en);

CREATE TABLE monitor_sla (
    shipment_id        TEXT PRIMARY KEY,
    estado             TEXT NOT NULL,             -- último estado de envios.estados aplicado
    hub_id             TEXT,
    zona_id            TEXT,
    vence_en           TIMESTAMPTZ,               -- vencimiento de la promesa (envios.promesas)
    ultima_secuencia   INTEGER NOT NULL DEFAULT 0, -- regla de orden, igual que el proyector
    reglas_alertadas   JSONB   NOT NULL DEFAULT '[]', -- ["SIN_INGRESO", ...]: reglas que ya dispararon
    terminado          BOOLEAN NOT NULL DEFAULT false, -- llegó ENTREGADO: no se evalúa más
    ultimo_ocurrido_en TIMESTAMPTZ NOT NULL,      -- mayor ocurridoEn visto = reloj simulado al arrancar
    actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El tick evalúa todos los envíos abiertos.
CREATE INDEX idx_monitor_sla_abiertos ON monitor_sla (terminado);


CREATE TABLE metricas_tiempos (
    fecha    DATE    NOT NULL,                 -- día (UTC) del EN_REPARTO
    hub_id   TEXT    NOT NULL,
    muestras INTEGER NOT NULL DEFAULT 0,       -- cuántos envíos salieron
    suma_ms  BIGINT  NOT NULL DEFAULT 0,       -- suma de demoras: media = suma_ms / muestras
    PRIMARY KEY (fecha, hub_id)
);

CREATE FUNCTION notificar_cambio_envio() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'envios_cambios',
        json_build_object('shipmentId', NEW.shipment_id, 'estado', NEW.estado)::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_envios_cambios
AFTER INSERT OR UPDATE ON envios
FOR EACH ROW EXECUTE FUNCTION notificar_cambio_envio();

CREATE FUNCTION notificar_cambio_alerta() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'alertas_cambios',
        json_build_object(
            'shipmentId', NEW.shipment_id,
            'regla',      NEW.regla,
            'prioridad',  NEW.prioridad,
            'estado',     NEW.estado
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_alertas_cambios
AFTER INSERT OR UPDATE ON alertas
FOR EACH ROW EXECUTE FUNCTION notificar_cambio_alerta();
