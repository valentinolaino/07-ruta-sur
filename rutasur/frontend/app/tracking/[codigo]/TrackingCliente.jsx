"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tonoEstado } from "@/lib/estados";
import { fechaHora } from "@/lib/tiempo";

// Tracking público: estado actual, fecha estimada y línea de tiempo, sin datos internos.
// Se actualiza en vivo: escucha el SSE /api/en-vivo (que a su vez escucha NOTIFY de Postgres)
// y vuelve a pedir el envío cuando hay un cambio. Nunca habla con Kafka.
export default function TrackingCliente() {
  const [codigo, setCodigo] = useState("");
  const [envio, setEnvio] = useState(null);
  const [err, setErr] = useState("");
  const [buscando, setBuscando] = useState(false);
  const codigoActivo = useRef(null); // código del envío que se está siguiendo

  const consultar = useCallback(async (c, { silencioso = false } = {}) => {
    if (!silencioso) {
      setBuscando(true);
      setErr("");
    }
    try {
      const r = await fetch(`/api/tracking?codigo=${encodeURIComponent(c)}`, { cache: "no-store" });
      const d = await r.json();
      if (!d.envio) {
        if (!silencioso) {
          setEnvio(null);
          setErr(d.mensaje || "No encontramos un envío con ese código");
          codigoActivo.current = null;
        }
      } else {
        setEnvio(d.envio);
        codigoActivo.current = d.envio.codigo;
      }
    } catch (e) {
      if (!silencioso) setErr("No pudimos consultar el envío");
    } finally {
      if (!silencioso) setBuscando(false);
    }
  }, []);

  // Si alguien entra con /tracking/ENV-000001, se busca ese código.
  useEffect(() => {
    const actual = window.location.pathname.split("/")[2];
    if (actual) {
      const c = decodeURIComponent(actual).toUpperCase();
      setCodigo(c);
      consultar(c);
    }
  }, [consultar]);

  // En vivo: cada aviso del SSE vuelve a leer el envío que se está siguiendo.
  useEffect(() => {
    const es = new EventSource("/api/en-vivo");
    es.addEventListener("cambio", () => {
      if (codigoActivo.current) consultar(codigoActivo.current, { silencioso: true });
    });
    es.onerror = () => {};
    return () => es.close();
  }, [consultar]);

  return (
    <main className="wrap">
      <header className="cabecera">
        <div>
          <h1>Seguí tu envío</h1>
          <p className="sub">Ingresá tu código para ver dónde está tu paquete</p>
        </div>
      </header>

      <section className="panel">
        <div className="form">
          <div className="field">
            <label>Código de envío</label>
            <input
              className="input"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && consultar(codigo)}
              placeholder="Ej. ENV-000001"
            />
          </div>
          <button className="btn" onClick={() => consultar(codigo)} disabled={buscando}>
            {buscando ? "Buscando..." : "Buscar"}
          </button>
          {err && <div className="muted">{err}</div>}
        </div>
      </section>

      {envio && (
        <>
          <section className="panel">
            <h2 className="codigo">{envio.codigo}</h2>
            <div className="kv">
              <div className="k">Estado</div>
              <div>
                <span className={`chip chip-${tonoEstado(envio.estado)}`}>{envio.etiqueta}</span>
              </div>
              {envio.estimada && (
                <>
                  <div className="k">Fecha estimada</div>
                  <div>
                    {envio.estimada.franja
                      ? `${new Date(envio.estimada.fecha + "T00:00:00").toLocaleDateString("es-AR")} · ${
                          envio.estimada.franja === "MANANA" ? "mañana" : "tarde"
                        }`
                      : fechaHora(envio.estimada.fecha)}
                  </div>
                </>
              )}
              <div className="k">Última actualización</div>
              <div>{fechaHora(envio.actualizadoEn)}</div>
            </div>
          </section>

          <section className="panel">
            <h2>Recorrido</h2>
            <ul className="lista">
              {envio.linea.map((h, i) => (
                <li key={`${h.ocurridoEn}-${i}`} className="item">
                  <div className="bloque">
                    <div><strong>{h.etiqueta}</strong></div>
                    <div className="meta">{fechaHora(h.ocurridoEn)}</div>
                  </div>
                </li>
              ))}
              {envio.linea.length === 0 && <li className="muted">Todavía no hay movimientos.</li>}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
