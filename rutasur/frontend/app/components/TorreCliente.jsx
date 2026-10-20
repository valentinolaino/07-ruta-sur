"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  etiquetaEstado,
  tonoEstado,
  EMBUDO,
  ESTADOS_FALLA,
  etiquetaRegla,
  tonoPrioridad,
} from "@/lib/estados";
import { hace, horaCorta, fijarRelojSimulado } from "@/lib/tiempo";
import EnVivo from "./EnVivo";

function Chip({ color = "gris", children }) {
  return <span className={`chip chip-${color}`}>{children}</span>;
}

function Crono({ actualizado }) {
  const [v, setV] = useState("—");
  useEffect(() => {
    setV(hace(actualizado));
    const i = setInterval(() => setV(hace(actualizado)), 1000);
    return () => clearInterval(i);
  }, [actualizado]);
  return <span>{v}</span>;
}

export default function TorreCliente({
  kpis,
  porHora,
  envios,
  conteo,
  reloj,
  alertas = [],
}) {
  useEffect(() => {
    if (reloj) fijarRelojSimulado(reloj);
  }, [reloj]);

  const totalEmbudo = new Map();
  for (const x of conteo) totalEmbudo.set(x.estado, Number(x.total));

  return (
    <main className="wrap">
      <EnVivo />
      <header className="cabecera">
        <div>
          <h1>RutaSur — Torre de control</h1>
          <p className="sub">
            Proyección · Actualización en vivo (SSE) · Reloj simulado
          </p>
        </div>
        <div className="acciones">
          <Link href="/tracking/" className="btn">
            Tracking
          </Link>
          <Link href="/analitica" className="btn">
            Analítica
          </Link>
          <Link href="/demo" className="btn">
            Demo / Escenarios
          </Link>
        </div>
      </header>

      <section className="grid kpi">
        <KPI label="Activos" valor={kpis.activos} tono="azul" />
        <KPI label="En reparto" valor={kpis.en_reparto} tono="celeste" />
        <KPI label="En tiempo" valor={kpis.en_tiempo} tono="verde" />
        <KPI label="Tarde" valor={kpis.tarde} tono="naranja" />
        <KPI label="Fallas" valor={kpis.fallas} tono="naranja" />
        <KPI label="En riesgo" valor={kpis.en_riesgo} tono="rojo" />
        <KPI label="Reprogramados" valor={kpis.reprogramados} tono="lila" />
      </section>

      <section className="panel">
        <h2>Proyección por hora</h2>
        <div className="barras">
          {porHora.map((f) => (
            <Barra key={f.ventana} hora={f.hora} {...f} />
          ))}
          {porHora.length === 0 && (
            <p className="muted">
              Sin datos todavía: lanzá un escenario desde Demo.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Embudo</h2>
        <div className="embudo">
          {EMBUDO.map((s) => (
            <div key={s} className="piso">
              <div className="etq">{etiquetaEstado(s)}</div>
              <div className="valor">{totalEmbudo.get(s) || 0}</div>
            </div>
          ))}
        </div>
        <div className="embudo" style={{ marginTop: 10 }}>
          {ESTADOS_FALLA.map((s) => (
            <div key={s} className="piso">
              <div className="etq">{etiquetaEstado(s)}</div>
              <div className="valor">{totalEmbudo.get(s) || 0}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Cola de alertas ({alertas.length})</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Alertas de SLA abiertas, de mayor a menor prioridad.
        </p>
        <ul className="lista">
          {alertas.map((a) => (
            <li key={a.id} className="item">
              <div className="campana">
                <span className={`puntito ${tonoPrioridad(a.prioridad)}`} />
                <div className="bloque">
                  <div>
                    <strong>{etiquetaRegla(a.regla)}</strong>{" "}
                    <span className={`chip chip-${tonoPrioridad(a.prioridad)}`}>
                      {a.prioridad}
                    </span>
                  </div>
                  <div className="meta">
                    <Link href={`/envio/${a.shipment_id}`}>
                      {a.shipment_id}
                    </Link>
                    {a.causa ? ` · ${a.causa}` : ""}
                  </div>
                </div>
              </div>
            </li>
          ))}
          {alertas.length === 0 && (
            <li className="muted">Sin alertas abiertas.</li>
          )}
        </ul>
      </section>

      <section className="panel">
        <h2>Últimos envíos</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Envío</th>
              <th>Estado</th>
              <th>Zona / Hub</th>
              <th>Promesa</th>
              <th>Intentos</th>
              <th>Alertas</th>
              <th>Último evento</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.shipment_id}>
                <td className="codigo">{e.shipment_id}</td>
                <td>
                  <Chip color={tonoEstado(e.estado)}>
                    {etiquetaEstado(e.estado)}
                  </Chip>
                </td>
                <td>
                  <div>{e.zona_id || "—"}</div>
                  <div className="muted">{e.hub_id || "—"}</div>
                </td>
                <td>{horaCorta(e.promesa_vence_en)}</td>
                <td>{e.intentos}</td>
                <td>{e.alertas_abiertas}</td>
                <td className="muted">
                  <Crono actualizado={e.actualizado_en} />
                </td>
                <td>
                  <Link className="btn ghost" href={`/envio/${e.shipment_id}`}>
                    Ver detalle
                  </Link>
                </td>
              </tr>
            ))}
            {envios.length === 0 && (
              <tr>
                <td colSpan="8" className="muted">
                  Sin envíos todavía.
                </td>
              </tr>
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

function Barra({ hora, en_tiempo, tarde, pendientes }) {
  const total =
    Number(en_tiempo || 0) + Number(tarde || 0) + Number(pendientes || 0);
  return (
    <div className="barra">
      <div className="barra-hora">{hora}</div>
      <div className="barra-cols">
        <Col w={(en_tiempo / Math.max(1, total)) * 100} c="verde" t="ET" />
        <Col w={(tarde / Math.max(1, total)) * 100} c="naranja" t="T" />
        <Col w={(pendientes / Math.max(1, total)) * 100} c="gris" t="P" />
      </div>
    </div>
  );
}

function Col({ w, c, t }) {
  return (
    <div className={`col col-${c}`} style={{ flex: `${w} 1 0%` }} title={t}>
      {w > 10 ? t : ""}
    </div>
  );
}
