const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const raiz = path.resolve(__dirname, "..");
const frontend = path.join(raiz, "frontend");

function correr(comando, carpeta, { silencioso = false } = {}) {
  return spawnSync(comando, {
    cwd: carpeta,
    shell: true,
    stdio: silencioso ? "ignore" : "inherit",
  });
}

function paso(n, texto) {
  console.log(`\n[${n}/5] ${texto}`);
}

function abortar(mensaje) {
  console.error(`\n✘ ${mensaje}`);
  process.exit(1);
}

paso(1, "Levantando Kafka y PostgreSQL (docker compose up -d)");
if (correr("docker compose up -d", raiz).status !== 0) {
  abortar("docker compose falló. ¿Está Docker abierto y funcionando?");
}

paso(2, "Dependencias de los servicios");
if (fs.existsSync(path.join(raiz, "node_modules")))
  console.log("  ya instaladas");
else if (correr("npm install", raiz).status !== 0)
  abortar("npm install falló en rutasur/");

paso(3, "Dependencias del frontend");
if (fs.existsSync(path.join(frontend, "node_modules")))
  console.log("  ya instaladas");
else if (correr("npm install", frontend).status !== 0)
  abortar("npm install falló en frontend/");

paso(4, "Esperando a que Kafka (con sus 6 topics) y PostgreSQL estén listos");
const INTENTOS = 40; // 40 x 3 s = 2 minutos
let listo = false;
for (let i = 1; i <= INTENTOS && !listo; i++) {
  listo =
    correr("node shared/verificar.js", raiz, { silencioso: true }).status === 0;
  if (!listo) {
    process.stdout.write(`  esperando... (${i}/${INTENTOS})\r`);
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},3000)"]); // pausa de 3 s
  }
}
if (!listo)
  abortar(
    "La infraestructura no respondió a tiempo. Mirá: docker compose logs",
  );
console.log("  ✔ infraestructura lista                    ");

paso(5, "Levantando simulador, servicios y frontend (Ctrl+C los detiene)");
require("./todos.js"); // a partir de acá manda todos.js (spawn de cada proceso)
