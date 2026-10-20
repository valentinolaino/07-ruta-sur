"use client";

import { etiquetaEstado, tonoEstado } from "@/lib/estados";
import { fechaHora } from "@/lib/tiempo";
import { useEffect, useState } from "react";
import { hace, fijarRelojSimulado } from "@/lib/tiempo";
import EnVivo from "@/app/components/EnVivo";

function Crono({ actualizado }) {
  const [v, setV] = useState("—");
  useEffect(() => {
    setV(hace(actualizado));
    const i = setInterval(() => setV(hace(actualizado)), 1000);
    return () => clearInterval(i);
  }, [actualizado]);
  return <span>{v}</span>;
}

export default function DetalleCliente({ detalle, movimientos, reloj }) {
  useEffect(() => {
    if (reloj) fijarRelojSimulado(reloj);
  }, [reloj]);

  const e = detalle.envio;
  return (
    <main className="wrap">
      <EnVivo />
      <header className="cabecera">
        <div>
          <h1>Detalle de envío</h1>
          <p className="sub">
            Historial, alertas y notificaciones · último evento hace{" "}
            <Crono actualizado={e.actualizado_en} />
          </p>
        </div>
        <a href="/" className="btn">
          Volver a torre
        </a>
      </header>

      <section className="panel">
        <h2 className="codigo">{e.shipment_id}</h2>
        <div className="kv">
          <div className="k">Estado</div>
          <div>
            <span className={`chip chip-${tonoEstado(e.estado)}`}>
              {etiquetaEstado(e.estado)}
            </span>
          </div>
          <div className="k">Zona / Hub</div>
          <div>
            {e.zona_id || "—"} / {e.hub_id || "—"}
          </div>
          <div className="k">Repartidor</div>
          <div>{e.repartidor_id || "—"}</div>
          <div className="k">Promesa vence</div>
          <div>{fechaHora(e.promesa_vence_en)}</div>
          <div className="k">Intentos</div>
          <div>{e.intentos}</div>
          <div className="k">Motivo de fallo</div>
          <div>{e.motivo_fallo || "—"}</div>
          <div className="k">Reprogramación</div>
          <div className="codigo">
            {e.reprogramacion ? JSON.stringify(e.reprogramacion) : "—"}
          </div>
          <div className="k">Actualizado</div>
          <div>{fechaHora(e.actualizado_en)}</div>
        </div>
      </section>

      <div className="doscols">
        <section className="panel">
          <h2>Línea de tiempo</h2>
          <ul className="lista">
            {movimientos.map((x, i) => (
              <li key={x.eventId || i} className="item">
                <div className="bloque">
                  <div>
                    <strong>{x.tipo}</strong>
                    {x.origen ? ` · ${x.origen}` : ""}
                  </div>
                  <div className="meta">
                    {fechaHora(x.ocurridoEn)}
                    {x.secuencia != null && ` · secuencia ${x.secuencia}`}
                    {x.intento != null && ` · intento ${x.intento}`}
                  </div>
                </div>
              </li>
            ))}
            {movimientos.length === 0 && (
              <li className="muted">Sin movimientos aún.</li>
            )}
          </ul>
        </section>

        <section className="panel">
          <h2>Alertas</h2>
          <ul className="lista">
            {detalle.alertas.map((a) => (
              <li key={a.id} className="item">
                <div className="bloque">
                  <div>
                    <strong>{a.regla}</strong> · {a.prioridad} ·{" "}
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
                    Abierta {fechaHora(a.creada_en)}
                    {a.cerrada_en && ` · Cerrada ${fechaHora(a.cerrada_en)}`}
                  </div>
                </div>
              </li>
            ))}
            {detalle.alertas.length === 0 && (
              <li className="muted">Sin alertas.</li>
            )}
          </ul>

          <h2 style={{ marginTop: 12 }}>Notificaciones</h2>
          <ul className="lista">
            {detalle.notificaciones.map((n) => (
              <li key={n.id} className="item">
                <div className="bloque">
                  <div>
                    <strong>{n.tipo}</strong>
                  </div>
                  <div>{n.mensaje}</div>
                  <div className="meta">{fechaHora(n.creada_en)}</div>
                </div>
              </li>
            ))}
            {detalle.notificaciones.length === 0 && (
              <li className="muted">Sin notificaciones.</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
