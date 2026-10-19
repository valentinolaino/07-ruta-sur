// SSE en vivo: escucha envios_cambios y alertas_cambios en PostgreSQL
// (el reemplazo de los "change streams" de Mongo) y reenvía un aviso al navegador.
// Es read-only: no modifica la base.

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const cliente = await pool.connect();
  let cerrado = false;
  let heartbeat = null;

  const stream = new ReadableStream({
    start(controller) {
      const enviar = (tipo) => {
        if (cerrado) return;
        try {
          controller.enqueue(`event: ${tipo}\ndata: ${Date.now()}\n\n`);
        } catch (e) {
          // el cliente se fue
        }
      };

      const cerrar = () => {
        if (cerrado) return;
        cerrado = true;
        if (heartbeat) clearInterval(heartbeat);
        cliente.removeAllListeners();
        try {
          cliente.release();
        } catch (e) {}
      };

      async function arrancar() {
        try {
          await cliente.query("LISTEN envios_cambios");
          await cliente.query("LISTEN alertas_cambios");
        } catch (e) {
          cerrar();
          return;
        }
        enviar("open");
        // Latido cada 15 s: mantiene viva la conexión y sirve de respaldo.
        heartbeat = setInterval(() => enviar("ping"), 15000);
        cliente.on("notification", () => enviar("cambio"));
        cliente.on("error", cerrar);
        cliente.on("end", cerrar);
      }

      req.signal.addEventListener("abort", cerrar);
      arrancar();
    },
    cancel() {
      if (cerrado) return;
      cerrado = true;
      if (heartbeat) clearInterval(heartbeat);
      try {
        cliente.release();
      } catch (e) {}
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
