"use client";

import { etiquetaEstado, tonoEstado, etiquetaRegla, tonoPrioridad } from "@/lib/estados";
import { fechaHora } from "@/lib/tiempo";
import EnVivo from "@/app/components/EnVivo";

const pct = (a, b) => (Number(b) > 0 ? ((Number(a) / Number(b)) * 100).toFixed(1) : "—");

export default function AnaliticaCliente({ totales, tiempos, dias, alertas, riesgo }) {
  const t = totales || {};
  return (
    <main className="wrap">
      <EnVivo />
      <header className="cabecera">
        <div>
          <h1>Analítica — CU4</h1>
          <p className="sub">
            Primer intento, motivos de fallo, SLA y tiempo INGRESADO_HUB → EN_REPARTO
            (cuarto indicador, reprocesable)
          </p>
        </div>
        <div className="acciones">
          <a href="/" className="btn">Torre</a>
          <a href="/demo" className="btn">Demo</a>
        </div>
      </header>

      <section className="grid kpi">
        <KPI label="Entregas" valor={t.entregas} tono="verde" />
        <KPI label="Primer intento" valor={`${pct(t.primer_intento, t.entregas)} %`} tono="azul" />
        <KPI label="Fallos" valor={t.fallos} tono="naranja" />
        <KPI label="SLA cumplido" valor={t.sla_cumplidos} tono="verde" />
        <KPI label="SLA incumplido" valor={t.sla_incumplidos} tono="rojo" />
        <KPI label="% SLA" valor={`${pct(t.sla_cumplidos, Number(t.sla_cumplidos) + Number(t.sla_incumplidos))} %`} tono="celeste" />
      </section>

      <div className="doscols">
        <section className="panel">
          <h2>Motivos de fallo</h2>
          <table className="tabla">
            <thead>
              <tr><th>Motivo</th><th>Intentos</th><th>% de fallos</th></tr>
            </thead>
            <tbody>
              <FilaMotivo nombre="Ausente" valor={t.ausente} total={t.fallos} />
              <FilaMotivo nombre="Dirección incorrecta" valor={t.direccion} total={t.fallos} />
              <FilaMotivo nombre="Rechazado" valor={t.rechazo} total={t.fallos} />
              <FilaMotivo nombre="Zona inaccesible" valor={t.zona} total={t.fallos} />
            </tbody>
          </table>

          <h2 style={{ marginTop: 12 }}>Indicador 4 — INGRESADO_HUB → EN_REPARTO (reprocesamiento)</h2>
          <table className="tabla">
            <thead>
              <tr><th>Día</th><th>Hub</th><th>Muestras</th><th>Promedio (ms)</th></tr>
            </thead>
            <tbody>
              {tiempos.map((x, i) => (
                <tr key={`${x.fecha}-${x.hub_id}-${i}`}>
                  <td>{x.fecha}</td>
                  <td>{x.hub_id}</td>
                  <td>{x.muestras}</td>
                  <td>{x.promedio_ms ?? "—"}</td>
                </tr>
              ))}
              {tiempos.length === 0 && (
                <tr>
                  <td colSpan="4" className="muted">
                    Sin datos: corré <code>npm run analitica:tiempos</code> (lee
                    envios.estados desde el inicio y completa el histórico).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Alertas de SLA recientes (CU3)</h2>
          <ul className="lista">
            {alertas.map((a) => (
              <li key={a.id} className="item">
                <div className="campana">
                  <span className={`puntito ${tonoPrioridad(a.prioridad)}`} />
                  <div className="bloque">
                    <div>
                      <strong>{etiquetaRegla(a.regla)}</strong> ·{" "}
                      <span className={`chip chip-${tonoPrioridad(a.prioridad)}`}>
                        {a.prioridad}
                      </span>{" "}
                      <span className={a.estado === "ABIERTA" ? "chip chip-rojo" : "chip chip-gris"}>
                        {a.estado}
                      </span>
                    </div>
                    <div className="meta">
                      <a href={`/envio/${a.shipment_id}`}>{a.shipment_id}</a> ·{" "}
                      {fechaHora(a.creada_en)}
                      {a.cerrada_en && ` · cerrada ${fechaHora(a.cerrada_en)}`}
                    </div>
                  </div>
                </div>
              </li>
            ))}
            {alertas.length === 0 && <li className="muted">Sin alertas todavía.</li>}
          </ul>

          <h2 style={{ marginTop: 12 }}>En riesgo de SLA (&lt; 6 h para la promesa)</h2>
          <ul className="lista">
            {riesgo.map((r) => (
              <li key={r.shipment_id} className="item">
                <div className="bloque">
                  <div>
                    <strong>{r.shipment_id}</strong> ·{" "}
                    <span className={`chip chip-${tonoEstado(r.estado)}`}>
                      {etiquetaEstado(r.estado)}
                    </span>
                  </div>
                  <div className="meta">
                    Vence {fechaHora(r.promesa_vence_en)} · Hub {r.hub_id} · Zona {r.zona_id} ·{" "}
                    intentos {r.intentos}
                  </div>
                </div>
              </li>
            ))}
            {riesgo.length === 0 && <li className="muted">Sin envíos en riesgo.</li>}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2>Por día</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Entregas</th>
              <th>Primer intento</th>
              <th>Fallas</th>
              <th>SLA cumplidos</th>
              <th>SLA incumplidos</th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d) => (
              <tr key={d.fecha}>
                <td>{d.fecha}</td>
                <td>{d.entregas}</td>
                <td>{d.primer_intento}</td>
                <td>{d.fallos}</td>
                <td>{d.sla_cumplidos}</td>
                <td>{d.sla_incumplidos}</td>
              </tr>
            ))}
            {dias.length === 0 && (
              <tr><td colSpan="6" className="muted">Sin métricas todavía.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function KPI({ label, valor = 0, tono }) {
  return (
    <div className={`kpi-card kpi-${tono}`}>
      <div className="kpi-val">{valor}</div>
      <div className="kpi-lbl">{label}</div>
    </div>
  );
}

function FilaMotivo({ nombre, valor, total }) {
  return (
    <tr>
      <td>{nombre}</td>
      <td>{valor}</td>
      <td>{pct(valor, total)} %</td>
    </tr>
  );
}
