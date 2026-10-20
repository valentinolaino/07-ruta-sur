// Generador de números pseudoaleatorios con SEMILLA.

function crearRng(semilla) {
  let estado = semilla >>> 0;

  // Número decimal en [0, 1)
  function siguiente() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next: siguiente,

    // Decimal en [min, max)
    rango: (min, max) => min + siguiente() * (max - min),

    // Entero en [min, max] (ambos incluidos)
    entero: (min, max) => min + Math.floor(siguiente() * (max - min + 1)),

    // true con probabilidad p (0.1 = 10 %)
    chance: (p) => siguiente() < p,

    // Un elemento al azar de una lista
    elegir: (lista) => lista[Math.floor(siguiente() * lista.length)],

    // Elige una clave de un objeto { CLAVE: peso }. Ej: { AUSENTE: 60, RECHAZADO: 15 }
    elegirPonderado(pesos) {
      const claves = Object.keys(pesos);
      const total = claves.reduce((suma, k) => suma + pesos[k], 0);
      let punto = siguiente() * total;
      for (const clave of claves) {
        punto -= pesos[clave];
        if (punto < 0) return clave;
      }
      return claves[claves.length - 1];
    },

    // UUID v4 determinista (crypto.randomUUID() no se puede fijar con semilla).
    uuid() {
      const hex = (n) =>
        Array.from({ length: n }, () =>
          Math.floor(siguiente() * 16).toString(16),
        ).join("");
      const variante = "89ab"[Math.floor(siguiente() * 4)];
      return `${hex(8)}-${hex(4)}-4${hex(3)}-${variante}${hex(3)}-${hex(12)}`;
    },
  };
}

module.exports = { crearRng };
