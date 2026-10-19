# 07-ruta-sur — RutaSur (TP7)

**Caso práctico:** Sistema de logística orientada a eventos con Kafka + 5 consumidores independientes + 5 pantallas Next.js. El objetivo es visualizar la cadena de eventos, detectar riesgos de SLA, registrar notificaciones/alertas y mostrar analítica en tiempo real.

## Estructura

```
07-ruta-sur/
├── rutasur/                # Código del proyecto
│   ├── db/                # init.sql + migracion.sql (PostgreSQL)
│   ├── docker-compose.yml # Kafka KRaft + kafka-init + Postgres (puerto 5434)
│   ├── frontend/          # Next.js 14 (torre, detalle, tracking, analítica, demo + SSE)
│   ├── scripts/           # todos.js (orquestador), reconstruir.js (reproceso)
│   ├── servicios/         # proyector, notificaciones, reprogramacion, monitor-sla, analitica (+ tiempos)
│   ├── shared/            # eventos, kafka, config, logger, verificar
│   ├── simulador/         # simulador de eventos + API HTTP (puerto 4000)
│   └── package.json       # scripts npm
└── README.md
```

## Decisiones de diseño

- **PostgreSQL** en lugar de MongoDB (cambio sobre lo indicado en el PDF).
  - Se usa `LISTEN/NOTIFY` para tiempo real en lugar de change streams.
  - Las vistas derivadas (`envios`, `alertas`, `notificaciones`, `metricas_*`, `monitor_sla`, `eventos_procesados`) son **reconstruibles** desde los eventos de Kafka.
  - `db/init.sql` documenta el reemplazo; `db/migracion.sql` para volúmenes ya existentes.
- **Reloj simulado**: el "tiempo del sistema" es el mayor `ocurridoEn` visto (no el reloj de la máquina). El monitor SLA y el frontend usan esta regla.
- **Monitor SLA**:
  - Estado en memoria + respaldo en tabla `monitor_sla` (permite reanudar tras reinicio sin repetir alertas).
  - Evalúa 4 reglas: `VENCIDO`, `FALLO_DIA_LIMITE`, `SIN_SALIDA`, `SIN_INGRESO`.
  - Emite eventos `alertaAbierta`/`alertaCerrada` con `eventId` derivado (`idDerivado('alerta', shipmentId, regla)`) para evitar duplicados.
  - Lee `envios.promesas` desde el inicio (`topic.compactado`) y `envios.estados` según `MONITOR_DESDE_INICIO` (por defecto 1 en esta entrega).
- **Consumo con flags**: `shared/kafka.js` admite topics como string o `{ nombre, desdeInicio }`. Se usa un nuevo grupo `analitica-tiempos` que lee `envios.estados` **desde el inicio** para reconstruir el 4to indicador.
- **Idempotencia**: cada consumidor inserta `(consumidor, event_id)` en `eventos_procesados` antes de aplicar cambios.
- **Reprocesamiento**: `scripts/reconstruir.js` vacía vistas + `eventos_procesados` y hace `admin.resetOffsets({ earliest: true })` para **todos** los grupos consumidores (sin depender de CLI de Docker).
- **Frontend**: Next.js 14 lee **únicamente** las vistas de Postgres. Tiempo real via `LISTEN/NOTIFY` -> `app/api/en-vivo/route.js` (SSE). No accede a Kafka directamente.
- **Latencia**: objetivo < 2 segundos **evento → pantalla**. Se muestra "evento→pantalla" con cronómetro basado en reloj simulado.

## Requisitos de entorno

- Node.js 18+ (probado con entorno del curso)
- Docker + Docker Compose v2
- npm

## Puertos

| Servicio | Puerto |
|---|---|
| Postgres | `5434` (host) → `5432` (contenedor) |
| Kafka | `9092` |
| Simulador (HTTP) | `4000` |
| Frontend Next.js (dev) | `3000` |

> **Importante:** `docker-compose.yml` publica Postgres en `5434` (host) → `5432` (contenedor), porque el `5433` puede estar tomado por otros servicios de tu máquina. `shared/config.js`, `frontend/lib/db.js` y `scripts/*` usan `5434` por defecto. Si lo cambiás, ajustá los tres (o usá `DATABASE_URL`).

## Arranque rápido

Todo desde `rutasur/`:

```bash
# 1) Infraestructura
cd rutasur
docker compose up -d

# 1b) Si venías de un volumen viejo de Postgres, aplicá la migración
#     (agrega monitor_sla y metricas_tiempos). En PowerShell:
#     Get-Content db/migracion.sql -Raw | docker exec -i rutasur-postgres psql -U rutasur -d rutasur

# 2) Verificar todo (estructura, puertos, topics)
npm run verificar

# 3) Dependencias del frontend (una sola vez)
cd frontend; npm install; cd ..

# 4) Levantar simulador + 5 consumidores + frontend
npm run todo
```

- `npm run todo` lanza: `simulador`, `proyector`, `notificaciones`, `reprogramacion`, `monitor-sla`, `analitica`, `frontend`. Prefijos `[nombre]` en logs.
- Flags: `npm run todo -- --sin-frontend` o `npm run todo -- --sin-simulador` si querés aislar.

Servicios individuales (útiles para debug):

```bash
npm run proyector
npm run notificaciones
npm run reprogramacion
npm run monitor
npm run analitica
npm run analitica:tiempos  # grupo nuevo, lee desde inicio
npm run frontend           # next dev
npm run simulador
```

## Tests

```bash
cd rutasur
npm test
```

Resultado esperado: **96/96 tests OK** (tests de `servicios/monitor-sla/evaluar.test.js` y `servicios/analitica/indicadores.test.js`).

## Reconstruir vistas desde cero (reprocesamiento completo)

Úsalo cuando quieras que **todos** los consumidores vuelvan a leer desde el inicio y reconstruyan las vistas.

```bash
cd rutasur
# Asegurate de tener los servicios DETENIDOS (Ctrl+C en npm run todo o kill)
npm run reconstruir
```

Lo que hace:
1. Vacía `envios`, `alertas`, `notificaciones`, `metricas_diarias`, `metricas_tiempos`, `eventos_procesados`, `monitor_sla`.
2. Resetea offsets a `earliest` para **todos** los grupos (`proyector`, `notificaciones`, `reprogramacion`, `monitor-sla`, `analitica`, `analitica-tiempos`) vía `kafka.admin.resetOffsets`.
3. Al volver a levantar los consumidores, reaplican todo el historial de `envios.estados`/`envios.promesas`/`notificaciones.*`/`alertas.sla`.

## Frontend — Pantallas

| Ruta | Descripción |
|---|---|
| `/` (torre) | **CU1**. KPIs, proyección por hora, embudo, últimos envíos, "evento→pantalla" con reloj simulado. Actualización via SSE. |
| `/envio/[id]` | **CU1**. Detalle completo + línea de tiempo (`events`) + alertas + notificaciones. |
| `/tracking/[codigo]` | Tracking por código de envío (estado + línea de tiempo). |
| `/analitica` | **CU4**. Totales, tasas, motivos de fallo, SLA, y **metricas_tiempos** (INGRESADO_HUB→EN_REPARTO p50/p95). Muestra alertas recientes y envíos en riesgo (<6h). |
| `/demo` | Lanzador de escenarios del simulador (proxy a `http://localhost:4000`). Instrucciones para correr `npm run analitica:tiempos` y reconstruir el 4to indicador. |

El tiempo real llega por `GET /api/en-vivo` (SSE) escuchando `envios_cambios` y `alertas_cambios`. El panel se refresca al recibir eventos.

## Criterios de aceptación (resumidos)

- **CU1 Proyección:** embudo por estado, conteo por hora de vencimiento, listado con "hace X" y latencia **evento→pantalla < 2s**.
- **CU2 Entrega fallida / reprogramación:** registro de fallos, intentos, motivo, reprogramación propuesta/aplicada (visto en detalle/envíos).
- **CU3 Riesgo de SLA:** 4 reglas evaluadas, alertas `ABIERTA/CERRADA`, sin repetición por (shipment_id, regla), cierre automático al recibir `ENTREGADO`/cambio que deja de aplicar, resiliente a reinicio (tabla `monitor_sla`).
- **CU4 Analítica + reprocesamiento:** 3 indicadores en `metricas_diarias`, 4to indicador en `metricas_tiempos` con grupo **analitica-tiempos** que lee desde inicio (reprocesable sin tocar otros grupos).

## Notas

- El `events` de Kafka se conserva como histórico; las vistas son derivadas.
- Los **mails/SMS** son simulados: solo se registran en `notificaciones`.
- `scripts/reconstruir.js` usa KafkaJS `admin.resetOffsets` (requiere conexión a Kafka; servicios detenidos).
- El frontend usa alias `@/*` (ver `frontend/jsconfig.json`).

## Verificación rápida

```bash
# En rutasur/
docker compose ps
npm run verificar
npm test  # 96/96
# En otra terminal: npm run todo
# En navegador: http://localhost:3000
```

Listo para correr todo el TP.