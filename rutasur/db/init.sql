-- RutaSur - esquema de lectura en PostgreSQL
--
-- Igual que en el PDF: estas tablas son VISTAS DERIVADAS de los eventos de Kafka,
-- no la fuente de verdad. Cualquiera se puede borrar y reconstruir leyendo el topic
-- desde el inicio.

-- ---------------------------------------------------------------------------
-- envios  (la escribe el PROYECTOR)
-- Un registro por envío: estado actual, promesa, intentos, historial embebido
-- y última secuencia aplicada.
-- ---------------------------------------------------------------------------
CREATE TABLE envios (
    shipment_id       TEXT PRIMARY KEY,                 -- "shipmentId único"
    estado            TEXT        NOT NULL,             -- CREADO, INGRESADO_HUB, ..., ENTREGADO, ENTREGA_FALLIDA,
                                                        -- y los derivados REPROGRAMADO, RETENIDO, DEVOLUCION
    hub_id            TEXT,
    zona_id           TEXT,
    repartidor_id     TEXT,
    promesa_vence_en  TIMESTAMPTZ,                      -- "promesa.venceEn"
    intentos          INTEGER     NOT NULL DEFAULT 0,
    motivo_fallo      TEXT,                             -- AUSENTE, DIRECCION_INCORRECTA, RECHAZADO, ZONA_INACCESIBLE
    reprogramacion    JSONB,                            -- próximo intento (día y franja) si corresponde
    historial         JSONB       NOT NULL DEFAULT '[]', -- embebido: es corto (< 15 eventos) y se lee junto al estado
    ultima_secuencia  INTEGER     NOT NULL DEFAULT 0,   -- regla de orden: se descarta secuencia <= a esta
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

-- ---------------------------------------------------------------------------
-- metricas_diarias  (la escribe el servicio de ANALÍTICA)
-- Agregados por día, zona y franja horaria. Se actualiza con incrementos atómicos:
--   INSERT ... ON CONFLICT (fecha, zona_id, franja)
--   DO UPDATE SET fallos_total = metricas_diarias.fallos_total + 1;
-- Así no se recalcula nada sobre millones de filas en cada consulta del tablero.
--
-- OJO: el cuarto indicador (tiempo medio INGRESADO_HUB -> EN_REPARTO por hub)
-- NO está acá a propósito. En la demo (paso 8) se agrega con el sistema andando.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- eventos_procesados  (la escribe CADA consumidor)
-- Es la base de la idempotencia: antes de aplicar un evento, el consumidor intenta
-- insertar (consumidor, event_id). Si ya existe, el evento es duplicado y se descarta.
--
-- Mongo tenía un índice TTL de 7 días; Postgres no lo trae. Se reemplaza por una
-- limpieza periódica:  DELETE FROM eventos_procesados WHERE procesado_en < now() - interval '7 days';
-- ---------------------------------------------------------------------------
CREATE TABLE eventos_procesados (
    consumidor    TEXT        NOT NULL,
    event_id      TEXT        NOT NULL,
    procesado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumidor, event_id)
);

CREATE INDEX idx_eventos_procesados_fecha ON eventos_procesados (procesado_en);

-- ---------------------------------------------------------------------------
-- Tiempo real para la interfaz: LISTEN / NOTIFY
-- Reemplaza a los "change streams" de MongoDB. Cada cambio en envios o alertas
-- avisa por un canal; el route handler de Next.js escucha ese canal y reenvía
-- los avisos al navegador por Server-Sent Events (SSE).
-- El aviso lleva solo datos mínimos (NOTIFY admite ~8 KB); la interfaz lee el
-- detalle completo de la tabla.
-- ---------------------------------------------------------------------------
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
