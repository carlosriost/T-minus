/* Predicción a partir del paquete de modelos (JSON).
   Es el espejo EXACTO de src/prediction.py: las pruebas (tests/test_paridad_web.py)
   comparan los dos con los mismos datos. Si cambias uno, cambia el otro. */
(function (raiz) {
  "use strict";
  const SERVICIOS = ["vapor", "electricidad", "agua"];
  const LINEA_AUX = "AUX";

  function aHl(cantidad, unidad) {
    const v = typeof cantidad === "number" ? cantidad : Number(String(cantidad).trim());
    if (cantidad === "" || cantidad === null || !Number.isFinite(v)) throw new Error("La producción debe ser un número.");
    if (v < 0) throw new Error("La producción no puede ser negativa.");
    const u = String(unidad || "").trim().toLowerCase();
    if (["hl", "hectolitros", "hectolitro"].includes(u)) return v;
    if (["l", "litros", "litro"].includes(u)) return v / 100; // 1 hL = 100 L
    throw new Error("Unidad desconocida: use L o hL.");
  }

  function evaluar(web, P) {
    let y;
    if (web.tipo === "polinomio") {
      const z = P / (web.escala || 1);
      y = 0;
      for (let i = 0; i < web.coef.length; i++) y += web.coef[i] * Math.pow(z, i);
    } else if (web.tipo === "segmentada") {
      y = web.b0 + web.b1 * P + web.b2 * Math.max(0, P - web.pc);
    } else if (web.tipo === "rejilla") {
      const xs = web.x, ys = web.y;
      if (P <= xs[0]) y = ys[0];
      else if (P >= xs[xs.length - 1]) y = ys[ys.length - 1];
      else {
        let lo = 0, hi = xs.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (xs[mid] <= P) lo = mid; else hi = mid;
        }
        const f = (P - xs[lo]) / (xs[hi] - xs[lo]);
        y = ys[lo] + f * (ys[hi] - ys[lo]);
      }
    } else throw new Error("Tipo de modelo desconocido: " + web.tipo);
    return Math.max(0, y);
  }

  function escenario(P, u) {
    return P <= u[0] ? "baja" : P <= u[1] ? "media" : "alta";
  }

  // Igual que src/formato.py: miles con punto (independiente del navegador).
  function fmt0(v) {
    const n = Number(v).toFixed(0);
    const neg = n.startsWith("-");
    return (neg ? "-" : "") + n.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  function predecirCombinacion(m, P) {
    const out = { servicio: m.servicio, linea: m.linea, unidad: m.unidad, P_hL: P };
    if (!m.habilitado) return Object.assign(out, { habilitado: false, motivo: m.motivo || "Sin modelo confiable." });
    if (P === 0) {
      const b = m.base_sin_produccion || {};
      return Object.assign(out, {
        habilitado: true,
        sin_produccion: true,
        estimado: b.n ? b.mediana : null,
        intervalo: b.n ? [b.p10, b.p90] : null,
        nota: b.n
          ? `Día sin producción: consumo base observado en ${b.n} días (mediana y rango P10–P90), no sale del modelo.`
          : "No hay días sin producción para estimar el consumo base.",
      });
    }
    const y = evaluar(m.web, P);
    const esc = escenario(P, m.umbrales);
    const q = m.cuantiles[esc] || m.cuantiles.global;
    const lo = Math.max(0, y + q.q_inf), hi = Math.max(0, y + q.q_sup);
    const r = m.rango;
    const extrap = P < r.p_min || P > r.p_max;
    Object.assign(out, {
      habilitado: true,
      estimado: y,
      intervalo: [lo, hi],
      nivel_intervalo: m.nivel_intervalo,
      especifico: y / P,
      escenario: esc,
      modelo: m.nombre_modelo,
      calidad: m.calidad,
      calidad_nota: m.calidad_nota,
      rango_entrenamiento_hL: [r.p_min, r.p_max],
      extrapolacion: extrap,
      aviso: extrap ? `Fuera del rango histórico (${fmt0(r.p_min)}–${fmt0(r.p_max)} hL): el resultado es una extrapolación y puede no ser válido.` : "",
    });
    if (m.servicio === "agua") {
      out.estimado_m3 = y * 0.1;
      out.intervalo_m3 = [lo * 0.1, hi * 0.1];
    }
    return out;
  }

  function predecir(bundle, linea, cantidad, unidad) {
    const P = aHl(cantidad, unidad || "hL");
    if (!(linea in bundle.lineas)) throw new Error("Línea desconocida: " + linea);
    const res = { linea, P_hL: P, P_L: P * 100, servicios: {} };
    for (const s of SERVICIOS) {
      const m = bundle.modelos[s + "|" + linea];
      res.servicios[s] = m ? predecirCombinacion(m, P) : { habilitado: false, motivo: "No hay datos de este servicio para la línea." };
    }
    return res;
  }

  function planificar(bundle, plan) {
    const lineas = {};
    for (const ln of Object.keys(plan)) lineas[ln] = predecir(bundle, ln, plan[ln][0], plan[ln][1]);
    const totales = {};
    for (const s of SERVICIOS) {
      let est = 0, lo = 0, hi = 0;
      const faltan = [];
      for (const ln of Object.keys(lineas)) {
        const r = lineas[ln], x = r.servicios[s];
        if (r.P_hL === 0 && !x.habilitado) continue;
        if (!x.habilitado || x.estimado === null || x.estimado === undefined) { faltan.push(ln); continue; }
        est += x.estimado;
        if (x.intervalo) { lo += x.intervalo[0]; hi += x.intervalo[1]; }
      }
      totales[s] = { estimado: est, intervalo_conservador: [lo, hi], completo: faltan.length === 0, lineas_sin_modelo: faltan };
    }
    const aux = bundle.modelos["electricidad|" + LINEA_AUX];
    const reparte = (bundle.auxiliares && bundle.auxiliares.reparte_entre) || [];
    let pAux = 0;
    for (const ln of reparte) if (lineas[ln]) pAux += lineas[ln].P_hL;
    if (aux && aux.habilitado) {
      const a = predecirCombinacion(aux, pAux);
      totales.electricidad_auxiliares = a;
      if (a.estimado !== null && a.estimado !== undefined) {
        const t = totales.electricidad;
        t.estimado_con_auxiliares = t.estimado + a.estimado;
        if (a.intervalo) t.intervalo_conservador_con_auxiliares = [t.intervalo_conservador[0] + a.intervalo[0], t.intervalo_conservador[1] + a.intervalo[1]];
      }
    }
    totales.agua.estimado_m3 = totales.agua.estimado * 0.1;
    return { lineas, totales, nota_intervalos: "El intervalo del total suma los extremos de cada línea: es conservador (más ancho que el real si los errores no van en la misma dirección)." };
  }

  const api = { SERVICIOS, LINEA_AUX, aHl, evaluar, escenario, predecirCombinacion, predecir, planificar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SrvPred = api;
})(typeof window !== "undefined" ? window : globalThis);
