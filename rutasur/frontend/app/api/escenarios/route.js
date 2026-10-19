// Proxy al simulador (puerto 4000) para el panel /demo.
//   GET  /api/escenarios            -> lista de escenarios disponibles
//   POST /api/escenarios {nombre}   -> lanza un escenario

export const dynamic = "force-dynamic";

const base = () => `http://localhost:${process.env.SIM_PUERTO || "4000"}`;

export async function GET() {
  try {
    const res = await fetch(`${base()}/escenarios`, { cache: "no-store" });
    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: `No se pudo contactar al simulador: ${e}` },
      { status: 502 }
    );
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const nombre = body.nombre;
  if (!nombre) {
    return Response.json({ error: "nombre requerido" }, { status: 400 });
  }
  try {
    const res = await fetch(`${base()}/escenarios/${encodeURIComponent(nombre)}`, {
      method: "POST",
    });
    const texto = await res.text();
    let data;
    try {
      data = JSON.parse(texto);
    } catch (e) {
      data = { resultado: texto };
    }
    return Response.json({ ...data, lanzado: res.ok }, { status: res.status });
  } catch (e) {
    return Response.json(
      { error: `No se pudo contactar al simulador: ${e}` },
      { status: 502 }
    );
  }
}
