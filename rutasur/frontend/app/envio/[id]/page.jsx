// Detalle de envío (CU1) — SERVER COMPONENT.

import { detalleEnvio, movimientosEnvio, ultimaActividad } from "@/lib/consultas";
import DetalleCliente from "./DetalleCliente";

export const dynamic = "force-dynamic";

export default async function Envio({ params }) {
  const { id } = params;
  const [detalle, movimientos, reloj] = await Promise.all([
    detalleEnvio(id),
    movimientosEnvio(id),
    ultimaActividad(),
  ]);

  if (!detalle) {
    return (
      <main className="wrap">
        <h1>Envío no encontrado</h1>
        <a href="/" className="btn">Volver a torre</a>
      </main>
    );
  }

  return (
    <DetalleCliente detalle={detalle} movimientos={movimientos} reloj={reloj} />
  );
}
