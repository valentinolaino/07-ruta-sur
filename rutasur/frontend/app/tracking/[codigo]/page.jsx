// Tracking — SERVER COMPONENT. La búsqueda es interactiva: el componente
// cliente la resuelve contra /api/tracking.

import TrackingCliente from "./TrackingCliente";

export const dynamic = "force-dynamic";

export default async function Tracking() {
  return <TrackingCliente />;
}
