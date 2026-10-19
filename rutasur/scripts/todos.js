// Levanta todos los servicios de RutaSur con un solo comando.
//
//   npm run todo                     -> servicios + simulador + frontend
//   npm run todo -- --sin-simulador  -> sin el flujo continuo de eventos
//   npm run todo -- --sin-frontend   -> solo backend (para correr Next.js a parte)
//
// PRIMERO hay que tener el entorno de infraestructura levantado:
//   docker compose up -d            (Kafka + PostgreSQL)
//   npm run verificar               (opcional: chequea topics y tablas)
//
// Cada proceso es independiente (es lo que pide el PDF: poder detener uno en la
// demo sin afectar a los demás). La salida de cada uno aparece con su prefijo
// [nombre].  Ctrl+C detiene todo junto.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const raiz = path.resolve(__dirname, '..'); // carpeta rutasur/
const args = process.argv.slice(2);
const sinSimulador = args.includes('--sin-simulador');
const sinFrontend = args.includes('--sin-frontend');

const node = process.execPath; // el mismo node que corre este script

const servicios = [
  { nombre: 'simulador',   comando: node,          args: ['simulador/simulador.js'],            carpeta: raiz,           activo: !sinSimulador },
  { nombre: 'proyector',   comando: node,          args: ['servicios/proyector/index.js'],      carpeta: raiz,           activo: true },
  { nombre: 'notificac.',  comando: node,          args: ['servicios/notificaciones/index.js'], carpeta: raiz,           activo: true },
  { nombre: 'reprogram.',  comando: node,          args: ['servicios/reprogramacion/index.js'], carpeta: raiz,           activo: true },
  { nombre: 'monitor-sla', comando: node,          args: ['servicios/monitor-sla/index.js'],    carpeta: raiz,           activo: true },
  { nombre: 'analitica',   comando: node,          args: ['servicios/analitica/index.js'],      carpeta: raiz,           activo: true },
  {
    nombre: 'frontend',
    comando: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'dev'],
    carpeta: path.join(raiz, 'frontend'),
    activo: !sinFrontend,
  },
];

const frontendListo = fs.existsSync(path.join(raiz, 'frontend', 'node_modules'));

console.log('RutaSur: levantando servicios');
console.log('  ¿Está el entorno de infraestructura?   docker compose up -d');
console.log('  ¿Todo bien?                            npm run verificar');
console.log('');

const hijos = [];
let saliendo = false;

// Prefija cada línea de salida para saber de qué servicio viene.
function prefijsar(stream, salida, nombre) {
  let buffer = '';
  stream.on('data', (dato) => {
    buffer += dato.toString();
    const lineas = buffer.split(/\r?\n/);
    buffer = lineas.pop(); // la última puede estar incompleta
    for (const linea of lineas) salida.write(`[${nombre}] ${linea}\n`);
  });
}

for (const svc of servicios) {
  if (!svc.activo) continue;
  if (svc.nombre === 'frontend' && !frontendListo) {
    console.log('  ✘ frontend: falta node_modules (corré  npm install  dentro de frontend/) y volvé a lanzar');
    console.log('');
    continue;
  }

  const hijo = spawn(svc.comando, svc.args, {
    cwd: svc.carpeta,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  prefijsar(hijo.stdout, process.stdout, svc.nombre);
  prefijsar(hijo.stderr, process.stderr, svc.nombre);

  hijo.on('exit', (codigo, senal) => {
    if (saliendo) return;
    console.log(`[${svc.nombre}] terminó (código ${codigo ?? senal}); el resto sigue corriendo`);
    if (codigo && codigo !== 0) {
      console.log(`[${svc.nombre}] revisá los mensajes de error de arriba (¿docker compose up -d?)`);
    }
  });

  hijos.push({ nombre: svc.nombre, hijo });
  console.log(`  ✔ ${svc.nombre}`);
}
console.log('');

// Ctrl+C: detenemos todos los hijos y salimos.
function terminar() {
  if (saliendo) return;
  saliendo = true;
  console.log('\nDeteniendo servicios...');
  for (const { hijo } of hijos) hijo.kill('SIGINT');
  setTimeout(() => {
    for (const { hijo } of hijos) hijo.kill('SIGKILL');
    process.exit(0);
  }, 3000).unref();
}
process.on('SIGINT', terminar);
process.on('SIGTERM', terminar);
