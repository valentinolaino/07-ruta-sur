// Reloj simulado: convierte entre tiempo REAL (el de la máquina) y tiempo SIMULADO
// (el que viaja en el campo ocurridoEn de los eventos).
//
// Con factor = 120, cada segundo real equivale a 2 minutos simulados:
// 1 hora simulada = 30 segundos reales.

class Reloj {
  constructor({ inicioSimulado, factor, inicioReal = Date.now() }) {
    this.inicioSimulado = inicioSimulado;
    this.factor = factor;
    this.inicioReal = inicioReal;
  }

  // Instante simulado que corresponde a un instante real
  simDe(realMs) {
    return this.inicioSimulado + (realMs - this.inicioReal) * this.factor;
  }

  // Instante real en el que ocurrirá un instante simulado
  realDe(simMs) {
    return this.inicioReal + (simMs - this.inicioSimulado) / this.factor;
  }

  ahoraSim() {
    return this.simDe(Date.now());
  }
}

module.exports = { Reloj };
