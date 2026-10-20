// Dispara un escenario en un simulador que YA está corriendo (le pega a su API).

const config = require("./config");

const base = process.env.SIM_URL || `http://localhost:${config.puertoControl}`;
const nombre = process.argv[2];

async function main() {
  try {
    if (!nombre) {
      const lista = await (await fetch(`${base}/escenarios`)).json();
      console.log("Escenarios disponibles:");
      for (const e of lista)
        console.log(`  ${e.nombre.padEnd(16)} ${e.descripcion}`);
      return;
    }
    const respuesta = await fetch(`${base}/escenarios/${nombre}`, {
      method: "POST",
    });
    console.log(JSON.stringify(await respuesta.json(), null, 2));
    if (!respuesta.ok) process.exitCode = 1;
  } catch (error) {
    console.error(
      `No se pudo conectar al simulador en ${base}. ¿Está corriendo? (npm run simulador)`,
    );
    process.exitCode = 1;
  }
}

main();
