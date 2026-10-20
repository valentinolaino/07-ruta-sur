// Tracking PÚBLICO: devuelve solo lo que puede ver el destinatario (estado, fecha estimada
// y línea de tiempo). Nada de repartidor, zona, hub, intentos, motivos, alertas ni ids internos.
// Uso: GET /api/tracking?codigo=ENV-000001  (código exacto)

import { envioPublico } from "@/lib/consultas";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const codigo = searchParams.get("codigo") || "";

  try {
    const envio = await envioPublico(codigo);
    if (!envio) {
      return Response.json({ envio: null, mensaje: "No encontramos un envío con ese código" });
    }
    return Response.json({ envio });
  } catch (e) {
    return Response.json({ envio: null, mensaje: "No pudimos consultar el envío" }, { status: 500 });
  }
}
