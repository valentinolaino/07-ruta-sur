// Agenda de publicaciones: una cola ordenada por "cuándo hay que publicar".
//
// El simulador planifica de antemano todos los eventos de un envío (cada uno con su
// instante simulado) y los deja acá. Un temporizador vacía la agenda: saca los
// eventos que ya vencieron y los publica en Kafka.

class Agenda {
  constructor() {
    this.items = []; // ordenados por realMs; a igual hora, por orden de llegada
    this.contador = 0;
  }

  // Inserta manteniendo el orden (búsqueda binaria). Dos items con la misma hora
  // conservan el orden en que se agregaron: importa para "evento, y su duplicado".
  agregar(realMs, paso) {
    const item = { realMs, orden: this.contador++, paso };
    let bajo = 0;
    let alto = this.items.length;
    while (bajo < alto) {
      const medio = (bajo + alto) >> 1;
      const m = this.items[medio];
      if (m.realMs < realMs || (m.realMs === realMs && m.orden < item.orden)) bajo = medio + 1;
      else alto = medio;
    }
    this.items.splice(bajo, 0, item);
  }

  // Quita y devuelve los pasos cuya hora ya llegó (en orden).
  extraerVencidos(ahoraRealMs) {
    let n = 0;
    while (n < this.items.length && this.items[n].realMs <= ahoraRealMs) n++;
    return this.items.splice(0, n).map((i) => i.paso);
  }

  get pendientes() {
    return this.items.length;
  }
}

module.exports = { Agenda };
