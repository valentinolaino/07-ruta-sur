// Analítica — SERVER COMPONENT.

import { indicadores, alertasRecientes, enviosEnRiesgo } from "@/lib/consultas";
import AnaliticaCliente from "./AnaliticaCliente";

export const dynamic = "force-dynamic";

const texto = (v) =>
  (typeof v === "string" ? v : Array.isArray(v) ? v[0] : "") || "";

export default async function Analitica({ searchParams }) {
  const sp = (await searchParams) || {};
  const filtros = {
    zona: texto(sp.zona),
    hub: texto(sp.hub),
    desde: texto(sp.desde),
    hasta: texto(sp.hasta),
  };

  const [ind, alertas, riesgo] = await Promise.all([
    indicadores(filtros),
    alertasRecientes({ limite: 40 }),
    enviosEnRiesgo({ riesgoHoras: 6 }),
  ]);

  return (
    <AnaliticaCliente
      totales={ind.totales}
      tiempos={ind.tiempos}
      dias={ind.dias}
      porZonaFranja={ind.porZonaFranja}
      motivosPorZona={ind.motivosPorZona}
      slaPorHubDia={ind.slaPorHubDia}
      opciones={ind.opciones}
      filtros={filtros}
      alertas={alertas}
      riesgo={riesgo}
    />
  );
}
