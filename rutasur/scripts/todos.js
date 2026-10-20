const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const raiz = path.resolve(__dirname, ".."); // carpeta rutasur/
const args = process.argv.slice(2);
const sinSimulador = args.includes("--sin-simulador");
const sinFrontend = args.includes("--sin-frontend");

const node = process.execPath; // el mismo node que corre este script

const servicios = [
  {
    nombre: "simulador",
    comando: node,
    args: ["simulador/simulador.js"],
    carpeta: raiz,
    activo: !sinSimulador,
  },
  {
    nombre: "proyector",
    comando: node,
    args: ["servicios/proyector/index.js"],
    carpeta: raiz,
    activo: true,
  },
  {
    nombre: "notificac.",
    comando: node,
    args: ["servicios/notificaciones/index.js"],
    carpeta: raiz,
    activo: true,
  },
  {
    nombre: "reprogram.",
    comando: node,
    args: ["servicios/reprogramacion/index.js"],
    carpeta: raiz,
    activo: true,
  },
  {
    nombre: "monitor-sla",
    comando: node,
    args: ["servicios/monitor-sla/index.js"],
    carpeta: raiz,
    activo: true,
  },
  {
    nombre: "analitica",
    comando: node,
    args: ["servicios/analitica/index.js"],
    carpeta: raiz,
    activo: true,
  },
  {
    nombre: "frontend",
    comando: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "dev"],
    carpeta: path.join(raiz, "frontend"),
    activo: !sinFrontend,
  },
];

const frontendListo = fs.existsSync(
  path.join(raiz, "frontend", "node_modules"),
);

console.log("RutaSur: levantando servicios");
console.log("  ¿Está el entorno de infraestructura?   docker compose up -d");
console.log("  ¿Todo bien?                            npm run verificar");
console.log("");

const hijos = [];
let saliendo = false;

// Reintento de servicios: si un proceso muere con error, lo relanzamos solos con
// backoff creciente. Si sigue muriendo, cortamos y avisamos.
const REINTENTO_MS = [2000, 5000, 10000, 30000];
const MAX_CAIDAS = REINTENTO_MS.length + 1;
const caidas = new Map(); // nombre -> intentos fallidos consecutivos

// Prefija cada línea de salida para saber de qué servicio viene.
function prefijsar(stream, salida, nombre) {
  let buffer = "";
  stream.on("data", (dato) => {
    buffer += dato.toString();
    const lineas = buffer.split(/\r?\n/);
    buffer = lineas.pop(); // la última puede estar incompleta
    for (const linea of lineas) salida.write(`[${nombre}] ${linea}\n`);
  });
}

function lanzar(svc) {
  const hijo = spawn(svc.comando, svc.args, {
    cwd: svc.carpeta,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: svc.comando !== "node",
  });

  prefijsar(hijo.stdout, process.stdout, svc.nombre);
  prefijsar(hijo.stderr, process.stderr, svc.nombre);

  // Si el spawn en sí falla (comando no encontrado, etc.), que no muera todo.
  hijo.on("error", (error) => {
    if (saliendo) return;
    console.log(`[${svc.nombre}] no se pudo lanzar: ${error.message}`);
  });

  hijo.on("exit", (codigo, senal) => {
    if (saliendo) return;
    const caidasPrevias = caidas.get(svc.nombre) ?? 0;

    if (codigo === 0 || codigo === null) {
      console.log(
        `[${svc.nombre}] terminó (código ${codigo ?? senal}); el resto sigue corriendo`,
      );
      return;
    }

    // Error: reintentamos con backoff, salvo que agotemos los intentos.
    if (caidasPrevias >= MAX_CAIDAS) {
      console.log(
        `[${svc.nombre}] se cayó ${MAX_CAIDAS} veces seguidas; no se reintenta más.`,
      );
      console.log(
        `[${svc.nombre}] revisá los mensajes de arriba (¿docker compose up -d?) y relanzá con  npm run todo`,
      );
      return;
    }

    const espera =
      REINTENTO_MS[caidasPrevias] ?? REINTENTO_MS[REINTENTO_MS.length - 1];
    caidas.set(svc.nombre, caidasPrevias + 1);
    console.log(
      `[${svc.nombre}] terminó con código ${codigo}; reintento ${caidasPrevias + 1}/${MAX_CAIDAS} en ${espera / 1000} s`,
    );
    setTimeout(() => {
      if (!saliendo) lanzar(svc);
    }, espera);
  });

  // Si arrancó y vive un rato, el próximo corte vuelve a tener todos los intentos.
  hijo.on("spawn", () => {
    setTimeout(() => {
      caidas.delete(svc.nombre);
    }, 30000).unref();
  });

  hijos.push({ nombre: svc.nombre, hijo });
}

for (const svc of servicios) {
  if (!svc.activo) continue;
  if (svc.nombre === "frontend" && !frontendListo) {
    console.log(
      "  ✘ frontend: falta node_modules (corré  npm install  dentro de frontend/) y volvé a lanzar",
    );
    console.log("");
    continue;
  }

  lanzar(svc);
  console.log(`  ✔ ${svc.nombre}`);
}
console.log("");

// Ctrl+C: detenemos todos los hijos y salimos.
function terminar() {
  if (saliendo) return;
  saliendo = true;
  console.log("\nDeteniendo servicios...");
  for (const { hijo } of hijos) hijo.kill("SIGINT");
  setTimeout(() => {
    for (const { hijo } of hijos) hijo.kill("SIGKILL");
    process.exit(0);
  }, 3000).unref();
}
process.on("SIGINT", terminar);
process.on("SIGTERM", terminar);
