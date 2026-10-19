"use client";

import { useEffect, useState } from "react";
import { etiquetaEstado, tonoEstado } from "@/lib/estados";
import { fechaHora } from "@/lib/tiempo";

export default function TrackingCliente() {
  const [codigo, setCodigo] = useState("");
  const [envio, setEnvio] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [err, setErr] = useState("");
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    setBuscando(true);
    setErr("");
    try {
      const r = await fetch(
        `/api/tracking?codigo=${encodeURIComponent(codigo)}`,
        { cache: "no-store" }
      );
      const d = await r.json();
      if (!d.envio) {
        setErr(d.mensaje || "No se encontró un envío con ese código");
        setEnvio(null);
        setHistorial([]);
      } else {
        setEnvio(d.envio);
        setHistorial(d.historial || []);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBuscando(false);
    }
  }

  // Si alguien entra con /tracking/ENV-000001, buscamos ese código.
  useEffect(() => {
    const actual = window.location.pathname.split("/")[2];
    if (actual) {
      setCodigo(decodeURIComponent(actual).toUpperCase());
      buscarCon(decodeURIComponent(actual));
    }
    async function buscarCon(c) {
      const r = await fetch(`/api/tracking?codigo=${encodeURIComponent(c)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      if (d.envio) {
        setEnvio(d.envio);
        setHistorial(d.historial || []);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="wrap">
      <header className="cabecera">
        <div>
          <h1>Tracking de envío</h1>
          <p className="sub">Estado actual y línea de tiempo (vista derivada de los eventos)</p>
        </div>
        <a href="/" className="btn">Volver a torre</a>
      </header>

      <section className="panel">
        <div className="form">
          <div className="field">
            <label>Código de envío</label>
            <input
              className="input"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && buscar()}
              placeholder="Ej. ENV-000001"
            />
          </div>
          <button className="btn" onClick={buscar} disabled={buscando}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          {err && <div className="muted">{err}</div>}
        </div>
      </section>

      {envio && (
        <>
          <section className="panel">
            <h2 className="codigo">{envio.shipment_id}</h2>
            <div className="kv">
              <div className="k">Estado</div>
              <div>
                <span className={`chip chip-${tonoEstado(envio.estado)}`}>
                  {etiquetaEstado(envio.estado)}
                </span>
              </div>
              <div className="k">Zona / Hub</div>
              <div>
                {envio.zona_id || "—"} / {envio.hub_id || "—"}
              </div>
              <div className="k">Repartidor</div>
              <div>{envio.repartidor_id || "—"}</div>
              <div className="k">Promesa</div>
              <div>{fechaHora(envio.promesa_vence_en)}</div>
              <div className="k">Intentos</div>
              <div>
                {envio.intentos} {envio.motivo_fallo ? `· ${envio.motivo_fallo}` : ""}
              </div>
              <div className="k">Actualizado</div>
              <div>{fechaHora(envio.actualizado_en)}</div>
            </div>
          </section>

          <section className="panel">
            <h2>Línea de tiempo</h2>
            <ul className="lista">
              {historial.map((h) => (
                <li key={h.eventId} className="item">
                  <div className="bloque">
                    <div>
                      <strong>{h.tipo}</strong> · {h.origen}
                    </div>
                    <div className="meta">
                      {fechaHora(h.ocurridoEn)} · secuencia {h.secuencia}
                    </div>
                  </div>
                </li>
              ))}
              {historial.length === 0 && <li className="muted">Sin eventos.</li>}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
