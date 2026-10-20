"use client";

import { useEffect, useState } from "react";

// Pantalla de demo / escenarios.

export default function Demo() {
  const [esc, setEsc] = useState([]);
  const [sel, setSel] = useState("");
  const [log, setLog] = useState("");
  const [ultimo, setUltimo] = useState(null); // { nombre, ok, detalle }
  const [lanzando, setLanzando] = useState(null); // nombre del escenario en curso
  const [cargandoLista, setCargandoLista] = useState(true);

  async function cargarEsc() {
    setCargandoLista(true);
    try {
      const r = await fetch("/api/escenarios", { cache: "no-store" });
      const d = await r.json();
      const lista = Array.isArray(d) ? d : d.escenarios || d.lista || [];
      setEsc(lista);
      setSel((s) => s || (lista[0] && lista[0].nombre) || "");
      setLog("");
    } catch (e) {
      setEsc([]);
      setLog(
        `No se pudo leer la lista de escenarios (¿corre el simulador en el puerto 4000?).\n${e}`,
      );
    } finally {
      setCargandoLista(false);
    }
  }

  async function lanzar(nombre) {
    if (!nombre || lanzando) return;
    setLanzando(nombre);
    setUltimo({ nombre, ok: null, detalle: "Lanzando…" });
    try {
      const r = await fetch("/api/escenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre }),
      });
      const texto = await r.text();
      let detalle = texto;
      try {
        const j = JSON.parse(texto);
        detalle = JSON.stringify(j, null, 2);
      } catch (e) {
        /* dejamos el texto tal cual */
      }
      setUltimo({ nombre, ok: r.ok, detalle });
      setLog(detalle);
    } catch (e) {
      setUltimo({ nombre, ok: false, detalle: String(e) });
      setLog(String(e));
    } finally {
      setLanzando(null);
    }
  }

  useEffect(() => {
    cargarEsc();
  }, []);

  return (
    <main className="wrap">
      <header className="cabecera">
        <div>
          <h1>Demo / Escenarios</h1>
          <p className="sub">
            Lanzá un escenario del simulador y mirá cómo se refleja en la torre
            (actualización en vivo en menos de 2 s)
          </p>
        </div>
        <div className="acciones">
          <a href="/analitica" className="btn">
            Analítica
          </a>
          <a href="/" className="btn">
            Volver a torre
          </a>
        </div>
      </header>

      {/* ---------------------------------------------------- lista escenarios */}
      <section className="panel">
        <div className="panel-titulo">
          <h2>Escenarios del simulador</h2>
          <button
            className="btn ghost"
            onClick={cargarEsc}
            disabled={cargandoLista}
          >
            {cargandoLista ? "Cargando…" : "Actualizar lista"}
          </button>
        </div>

        {esc.length === 0 && !cargandoLista && (
          <p className="muted">
            Sin escenarios: ¿está levantado el simulador? (
            <code>npm run todo</code> o <code>npm run simulador</code>).
          </p>
        )}

        <div className="demo-grid">
          {esc.map((x) => {
            const enCurso = lanzando === x.nombre;
            const ok =
              ultimo && ultimo.nombre === x.nombre ? ultimo.ok : undefined;
            return (
              <div key={x.nombre} className="demo-card">
                <div className="demo-card-titulo">
                  <span className="codigo">{x.nombre}</span>
                  {ok === true && (
                    <span className="chip chip-verde">lanzado</span>
                  )}
                  {ok === false && (
                    <span className="chip chip-rojo">error</span>
                  )}
                  {ok === null && (
                    <span className="chip chip-azul">en curso</span>
                  )}
                </div>
                <p className="demo-desc">{x.descripcion}</p>
                <button
                  className="btn"
                  disabled={!!lanzando}
                  onClick={() => lanzar(x.nombre)}
                >
                  {enCurso ? "Lanzando…" : "Lanzar"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Selector de respaldo: elegir y lanzar con un botón */}
        {esc.length > 0 && (
          <div className="demo-selector">
            <label htmlFor="sel-escenario">O elegir de la lista:</label>
            <select
              id="sel-escenario"
              className="input"
              value={sel}
              onChange={(e) => setSel(e.target.value)}
            >
              {esc.map((x) => (
                <option key={x.nombre} value={x.nombre}>
                  {x.nombre}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!sel || !!lanzando}
              onClick={() => lanzar(sel)}
            >
              {lanzando === sel ? "Lanzando…" : "Lanzar seleccionado"}
            </button>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- resultado */}
      {ultimo && (
        <section className="panel">
          <div className="panel-titulo">
            <h2>Último lanzamiento</h2>
            <span
              className={
                ultimo.ok === true
                  ? "chip chip-verde"
                  : ultimo.ok === false
                    ? "chip chip-rojo"
                    : "chip chip-azul"
              }
            >
              {ultimo.ok === true
                ? "ok"
                : ultimo.ok === false
                  ? "error"
                  : "en curso"}
            </span>
          </div>
          <pre className="codigo bloque-codigo">{ultimo.detalle}</pre>
          <p className="meta">
            Andá a la <a href="/">torre</a>: los eventos deberían aparecer en
            vivo.
          </p>
        </section>
      )}

      {/* ----------------------------------------------------- reprocesamiento */}
      <section className="panel">
        <h2>Reprocesamiento — 4to indicador (INGRESADO_HUB → EN_REPARTO)</h2>
        <p className="sub">
          El grupo <code>analitica-tiempos</code> es nuevo, así que lee{" "}
          <code>envios.estados</code> desde el inicio y reconstruye{" "}
          <code>metricas_tiempos</code> con todo el histórico, sin tocar a los
          demás servicios.
        </p>
        <div className="demo-grid">
          <div className="demo-card">
            <div className="demo-card-titulo">
              <span className="codigo">Opción A</span>
              <span className="chip chip-verde">recomendada</span>
            </div>
            <p className="demo-desc">
              Desde una terminal en <code>rutasur/</code>:
            </p>
            <pre className="codigo bloque-codigo">
              npm run analitica:tiempos
            </pre>
            <p className="meta">
              Se corta con Ctrl+C. El avance se ve en /analitica.
            </p>
          </div>
          <div className="demo-card">
            <div className="demo-card-titulo">
              <span className="codigo">Opción B</span>
              <span className="chip chip-gris">completa</span>
            </div>
            <p className="demo-desc">
              Para reconstruir TODAS las vistas y grupos desde cero:
            </p>
            <pre className="codigo bloque-codigo">npm run reconstruir</pre>
            <p className="meta">Con los servicios detenidos. Ver README.</p>
          </div>
        </div>
      </section>

      {log && (
        <section className="panel">
          <h2>Log</h2>
          <pre className="codigo bloque-codigo">{log}</pre>
        </section>
      )}
    </main>
  );
}
