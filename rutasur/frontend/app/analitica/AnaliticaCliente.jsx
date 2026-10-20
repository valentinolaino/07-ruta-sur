"use client";

import {
  etiquetaEstado,
  tonoEstado,
  etiquetaRegla,
  tonoPrioridad,
} from "@/lib/estados";
import { fechaHora } from "@/lib/tiempo";
import EnVivo from "@/app/components/EnVivo";

const num = (v) => Number(v) || 0;
const pctNum = (a, b) => (num(b) > 0 ? (num(a) / num(b)) * 100 : null);
const pct = (a, b) => {
  const p = pctNum(a, b);
  return p === null ? "—" : `${p.toFixed(1)} %`;
};

const NOMBRE_FRANJA = { MANANA: "Mañana", TARDE: "Tarde" };

export default function AnaliticaCliente({
  totales,
  tiempos = [],
  dias = [],
  porZonaFranja = [],
  motivosPorZona = [],
  slaPorHubDia = [],
  opciones = { zonas: [], hubs: [] },
  filtros = {},
  alertas = [],
  riesgo = [],
}) {
  const t = totales || {};
  const hayFiltros =
    filtros.zona || filtros.hub || filtros.desde || filtros.hasta;

  return (
    <main className="wrap">
      <EnVivo />

      <header className="cabecera">
        <div>
          <h1 style={{ margin: 0 }}>Analítica</h1>
          <p className="sub">
            Primer intento, motivos de fallo, SLA y tiempo INGRESADO_HUB →
            EN_REPARTO (cuarto indicador, reprocesable)
          </p>
        </div>
        <div className="acciones">
          <a href="/" className="btn">
            Torre
          </a>
          <a href="/demo" className="btn">
            Demo
          </a>
        </div>
      </header>

      {/* ------------------------------------------------------------ filtros */}
      <form method="get" action="/analitica" className="panel an-filtros">
        <div className="field">
          <label htmlFor="f-zona">Zona</label>
          <select
            id="f-zona"
            className="input"
            name="zona"
            defaultValue={filtros.zona || ""}
          >
            <option value="">Todas</option>
            {opciones.zonas.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-hub">Hub</label>
          <select
            id="f-hub"
            className="input"
            name="hub"
            defaultValue={filtros.hub || ""}
          >
            <option value="">Todos</option>
            {opciones.hubs.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-desde">Desde</label>
          <input
            id="f-desde"
            className="input"
            type="date"
            name="desde"
            defaultValue={filtros.desde || ""}
          />
        </div>
        <div className="field">
          <label htmlFor="f-hasta">Hasta</label>
          <input
            id="f-hasta"
            className="input"
            type="date"
            name="hasta"
            defaultValue={filtros.hasta || ""}
          />
        </div>
        <div className="an-filtros-acc">
          <button className="btn an-btn-primario" type="submit">
            Filtrar
          </button>
          {hayFiltros && (
            <a href="/analitica" className="btn">
              Limpiar
            </a>
          )}
        </div>
      </form>

      {/* ---------------------------------------------------------------- KPIs */}
      <section className="an-kpis">
        <KPI label="Entregas" valor={t.entregas} tono="verde" />
        <KPI
          label="Primer intento"
          valor={pct(t.primer_intento, t.entregas)}
          tono="azul"
        />
        <KPI label="Fallos" valor={t.fallos} tono="naranja" />
        <KPI label="SLA cumplido" valor={t.sla_cumplidos} tono="verde" />
        <KPI label="SLA incumplido" valor={t.sla_incumplidos} tono="rojo" />
        <KPI
          label="% SLA"
          valor={pct(
            t.sla_cumplidos,
            num(t.sla_cumplidos) + num(t.sla_incumplidos),
          )}
          tono="celeste"
        />
      </section>

      {/* --------------------------------------------------- indicadores 1 y 2 */}
      <div className="an-dos">
        <section className="panel an-panel">
          <h2>Indicador 1 · Primer intento por zona y franja</h2>
          <p className="muted an-nota">
            Ordenado por fallos: la primera fila es dónde y cuándo se falla más.
          </p>
          <div className="an-scroll">
            <table className="tabla an-tabla">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Franja</th>
                  <th className="an-n">Entregas</th>
                  <th className="an-n">1.er intento</th>
                  <th>% 1.er intento</th>
                  <th className="an-n">Fallos</th>
                </tr>
              </thead>
              <tbody>
                {porZonaFranja.map((x, i) => (
                  <tr
                    key={`${x.zona_id}-${x.franja}`}
                    className={i === 0 ? "an-top" : ""}
                  >
                    <td>
                      <strong>{x.zona_id}</strong>
                    </td>
                    <td>{NOMBRE_FRANJA[x.franja] || x.franja}</td>
                    <td className="an-n">{x.entregas}</td>
                    <td className="an-n">{x.primer_intento}</td>
                    <td>
                      <Barra
                        valor={pctNum(x.primer_intento, x.entregas)}
                        tono="azul"
                      />
                    </td>
                    <td className="an-n">
                      <strong>{x.fallos}</strong>
                    </td>
                  </tr>
                ))}
                {porZonaFranja.length === 0 && <Vacio cols={6} />}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel an-panel">
          <h2>Indicador 2 · Motivos de fallo por zona</h2>
          <p className="muted an-nota">
            Cantidad de fallos y porcentaje sobre el total de la zona.
          </p>
          <div className="an-scroll">
            <table className="tabla an-tabla">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th className="an-n">Fallos</th>
                  <th className="an-n">Ausente</th>
                  <th className="an-n">Dirección</th>
                  <th className="an-n">Rechazo</th>
                  <th className="an-n">Zona inacc.</th>
                </tr>
              </thead>
              <tbody>
                {motivosPorZona.map((x) => (
                  <tr key={x.zona_id}>
                    <td>
                      <strong>{x.zona_id}</strong>
                    </td>
                    <td className="an-n">
                      <strong>{x.fallos}</strong>
                    </td>
                    <Motivo valor={x.ausente} total={x.fallos} />
                    <Motivo valor={x.direccion} total={x.fallos} />
                    <Motivo valor={x.rechazo} total={x.fallos} />
                    <Motivo valor={x.zona} total={x.fallos} />
                  </tr>
                ))}
                {motivosPorZona.length === 0 && <Vacio cols={6} />}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* --------------------------------------------------- indicadores 3 y 4 */}
      <div className="an-dos">
        <section className="panel an-panel">
          <h2>Indicador 3 · Cumplimiento de SLA por hub y día</h2>
          <p className="muted an-nota">Qué hub llega tarde, día por día.</p>
          <div className="an-scroll">
            <table className="tabla an-tabla">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Hub</th>
                  <th className="an-n">Cumplidos</th>
                  <th className="an-n">Incumplidos</th>
                  <th>% cumplimiento</th>
                </tr>
              </thead>
              <tbody>
                {slaPorHubDia.map((x) => (
                  <tr key={`${x.fecha}-${x.hub_id}`}>
                    <td>{x.fecha}</td>
                    <td>
                      <strong>{x.hub_id}</strong>
                    </td>
                    <td className="an-n">{x.cumplidos}</td>
                    <td className="an-n">{x.incumplidos}</td>
                    <td>
                      <Barra
                        valor={pctNum(
                          x.cumplidos,
                          num(x.cumplidos) + num(x.incumplidos),
                        )}
                        tono="verde"
                      />
                    </td>
                  </tr>
                ))}
                {slaPorHubDia.length === 0 && <Vacio cols={5} />}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel an-panel">
          <h2>Indicador 4 · INGRESADO_HUB → EN_REPARTO</h2>
          <p className="muted an-nota">
            Tiempo medio por hub y día (se completa con el reprocesamiento).
          </p>
          <div className="an-scroll">
            <table className="tabla an-tabla">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Hub</th>
                  <th className="an-n">Muestras</th>
                  <th className="an-n">Promedio</th>
                </tr>
              </thead>
              <tbody>
                {tiempos.map((x, i) => (
                  <tr key={`${x.fecha}-${x.hub_id}-${i}`}>
                    <td>{x.fecha}</td>
                    <td>
                      <strong>{x.hub_id}</strong>
                    </td>
                    <td className="an-n">{x.muestras}</td>
                    <td className="an-n">{duracionLegible(x.promedio_ms)}</td>
                  </tr>
                ))}
                {tiempos.length === 0 && (
                  <tr>
                    <td colSpan="4" className="muted an-vacio">
                      Sin datos todavía. Corré{" "}
                      <code>npm run analitica:tiempos</code> para que el grupo
                      nuevo lea <code>envios.estados</code> desde el inicio y
                      complete el histórico.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ------------------------------------------------- alertas y riesgo */}
      <div className="an-dos">
        <section className="panel an-panel">
          <h2>Alertas de SLA recientes</h2>
          <div className="an-scroll an-scroll-lista">
            <ul className="lista">
              {alertas.map((a) => (
                <li key={a.id} className="item">
                  <div className="campana">
                    <span className={`puntito ${tonoPrioridad(a.prioridad)}`} />
                    <div className="bloque">
                      <div>
                        <strong>{etiquetaRegla(a.regla)}</strong>{" "}
                        <span
                          className={`chip chip-${tonoPrioridad(a.prioridad)}`}
                        >
                          {a.prioridad}
                        </span>{" "}
                        <span
                          className={
                            a.estado === "ABIERTA"
                              ? "chip chip-rojo"
                              : "chip chip-gris"
                          }
                        >
                          {a.estado}
                        </span>
                      </div>
                      <div className="meta">
                        <a href={`/envio/${a.shipment_id}`}>{a.shipment_id}</a>{" "}
                        · {fechaHora(a.creada_en)}
                        {a.cerrada_en &&
                          ` · cerrada ${fechaHora(a.cerrada_en)}`}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {alertas.length === 0 && (
                <li className="muted">Sin alertas todavía.</li>
              )}
            </ul>
          </div>
        </section>

        <section className="panel an-panel">
          <h2>En riesgo de SLA (&lt; 6 h para la promesa)</h2>
          <div className="an-scroll an-scroll-lista">
            <ul className="lista">
              {riesgo.map((r) => (
                <li key={r.shipment_id} className="item">
                  <div className="bloque">
                    <div>
                      <strong>{r.shipment_id}</strong>{" "}
                      <span className={`chip chip-${tonoEstado(r.estado)}`}>
                        {etiquetaEstado(r.estado)}
                      </span>
                    </div>
                    <div className="meta">
                      Vence {fechaHora(r.promesa_vence_en)} · {r.hub_id} ·{" "}
                      {r.zona_id} · intentos {r.intentos}
                    </div>
                  </div>
                </li>
              ))}
              {riesgo.length === 0 && (
                <li className="muted">Sin envíos en riesgo.</li>
              )}
            </ul>
          </div>
        </section>
      </div>

      {/* --------------------------------------------------------------- por día */}
      <section className="panel an-panel">
        <h2>Por día</h2>
        <div className="an-scroll">
          <table className="tabla an-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="an-n">Entregas</th>
                <th className="an-n">Primer intento</th>
                <th className="an-n">Fallas</th>
                <th className="an-n">SLA cumplidos</th>
                <th className="an-n">SLA incumplidos</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => (
                <tr key={d.fecha}>
                  <td>
                    <strong>{d.fecha}</strong>
                  </td>
                  <td className="an-n">{d.entregas}</td>
                  <td className="an-n">{d.primer_intento}</td>
                  <td className="an-n">{d.fallos}</td>
                  <td className="an-n">{d.sla_cumplidos}</td>
                  <td className="an-n">{d.sla_incumplidos}</td>
                </tr>
              ))}
              {dias.length === 0 && (
                <Vacio cols={6} texto="Sin métricas todavía." />
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

// ms -> "12 min" / "1 h 05 min" (los tiempos son SIMULADOS, ver README)
function duracionLegible(ms) {
  if (ms === null || ms === undefined) return "—";
  const min = Math.round(Number(ms) / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

function KPI({ label, valor = 0, tono }) {
  return (
    <div className={`kpi-card kpi-${tono}`}>
      <div className="kpi-val">{valor ?? 0}</div>
      <div className="kpi-lbl">{label}</div>
    </div>
  );
}

// Porcentaje con barra: se lee de un vistazo qué zona u hub está mejor o peor.
function Barra({ valor, tono }) {
  if (valor === null) return <span className="muted">—</span>;
  return (
    <div className="an-barra">
      <div className="an-barra-pista">
        <div
          className={`an-barra-relleno an-${tono}`}
          style={{ width: `${Math.min(100, valor)}%` }}
        />
      </div>
      <span className="an-barra-txt">{valor.toFixed(1)} %</span>
    </div>
  );
}

function Motivo({ valor, total }) {
  return (
    <td className="an-n">
      {num(valor)} <span className="muted">({pct(valor, total)})</span>
    </td>
  );
}

function Vacio({ cols, texto = "Sin datos para estos filtros." }) {
  return (
    <tr>
      <td colSpan={cols} className="muted an-vacio">
        {texto}
      </td>
    </tr>
  );
}
