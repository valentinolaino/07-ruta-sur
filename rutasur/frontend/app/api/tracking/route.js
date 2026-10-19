// Búsqueda de tracking: devuelve el envío + su historial embebido.
// Uso: GET /api/tracking?codigo=ENV-000001 (acepta también coincidencia parcial).

import { buscarPorCodigo, detalleEnvio } from "@/lib/consultas";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const codigo = searchParams.get("codigo") || "";

  try {
    const envio = await buscarPorCodigo(codigo);
    if (!envio) {
      return Response.json({
        envio: null,
        mensaje: `No se encontró un envío con "${codigo}"`,
      });
    }
    const detalle = await detalleEnvio(envio.shipment_id);
    return Response.json({
      envio,
      historial: envio.historial || [],
      alertas: detalle ? detalle.alertas : [],
      notificaciones: detalle ? detalle.notificaciones : [],
    });
  } catch (e) {
    return Response.json({ envio: null, mensaje: String(e) }, { status: 500 });
  }
}
