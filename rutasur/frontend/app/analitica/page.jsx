// Analítica (CU4) — SERVER COMPONENT.

import { indicadores, alertasRecientes, enviosEnRiesgo } from "@/lib/consultas";
import AnaliticaCliente from "./AnaliticaCliente";

export const dynamic = "force-dynamic";

export default async function Analitica() {
  const [ind, alertas, riesgo] = await Promise.all([
    indicadores(),
    alertasRecientes({ limite: 40 }),
    enviosEnRiesgo({ riesgoHoras: 6 }),
  ]);

  return (
    <AnaliticaCliente
      totales={ind.totales}
      tiempos={ind.tiempos}
      dias={ind.dias}
      alertas={alertas}
      riesgo={riesgo}
    />
  );
}
