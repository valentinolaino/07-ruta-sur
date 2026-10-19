// Utilidades de tiempo para el frontend.
//
// Regla del TP: el "reloj del sistema" del proyecto es el reloj simulado del
// simulador (la hora de los eventos), no el reloj de la máquina. Las pantallas
// usan esta misma regla para los cronómetros y para la barra de latencia
// evento→pantalla.

// Hora simulada "actual": la del evento más reciente visto en la base, con un
// avance proporcional al tiempo real transcurrido desde que lo vimos, de modo
// que el cronómetro avance suave mientras no llegan eventos nuevos.
let baseVista = null;
let baseReloj = 0;

export function fijarRelojSimulado(fecha) {
  baseVista = new Date(fecha).getTime();
  baseReloj = Date.now();
}

export function relojSimulado() {
  if (baseVista === null) return Date.now();
  return baseVista + (Date.now() - baseReloj);
}

// "hace 2 min 05 s" para un instante pasado (acepta Date, ISO o epoch ms).
export function hace( instante) {
  if (instante == null) return "—";
  const t = new Date(instante).getTime();
  const seg = Math.max(0, Math.floor((relojSimulado() - t) / 1000));
  if (seg < 60) return `${seg} s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `${min} min ${seg % 60} s`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

// mm:ss acumulado entre dos instantes (duración de un tramo).
export function duracion(desde, hasta) {
  if (desde == null || hasta == null) return "—";
  const seg = Math.max(0, Math.floor((new Date(hasta) - new Date(desde)) / 1000));
  return `${String(Math.floor(seg / 60)).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")}`;
}

export function horaCorta(instante) {
  if (instante == null) return "—";
  // Render síncrono para evitar mismatch SSR/CSR
  const d = new Date(instante);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function fechaHora(instante) {
  if (instante == null) return "—";
  const d = new Date(instante);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}:${ss}`;
}
