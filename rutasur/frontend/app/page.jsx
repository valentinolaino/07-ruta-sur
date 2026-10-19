// RutaSur — Torre de control (CU1) — SERVER COMPONENT.
// Los datos se leen acá (Postgres, vistas derivadas) y se pasan al componente
// cliente, que solo hace el refresco en vivo (SSE + router.refresh()).

import {
  kpisTorre,
  proyeccionPorHora,
  listarEnvios,
  conteoPorEstado,
  ultimaActividad,
} from "@/lib/consultas";
import { fijarRelojSimulado } from "@/lib/tiempo";
import TorreCliente from "./components/TorreCliente";

export const dynamic = "force-dynamic";

export default async function Torre() {
  const [kpis, porHora, envios, conteo, ultima] = await Promise.all([
    kpisTorre(),
    proyeccionPorHora(),
    listarEnvios({ limite: 40 }),
    conteoPorEstado(),
    ultimaActividad(),
  ]);

  if (ultima) fijarRelojSimulado(ultima);

  return (
    <TorreCliente
      kpis={kpis || {}}
      porHora={porHora}
      envios={envios}
      conteo={conteo}
      reloj={ultima}
    />
  );
}
