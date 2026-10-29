/* =========================================================================
   CONSUMOS DE SERVICIOS · 2) Modelos, validación temporal y selección
   -------------------------------------------------------------------------
   Mismo método del proyecto Python de referencia (model_training.py,
   model_validation.py, statistical_analysis.py, reporting.py):
     · Familias: media, consumo específico fijo, lineal, Huber, segmentada,
       polinómica 2, splines + Ridge. (Random Forest y Gradient Boosting se
       evaluaron en Python y nunca ganaron; no se incluyen aquí.)
     · Prueba final = último 20 % del período, nunca usada para elegir.
     · Rolling-origin con ventana creciente y bloques de 14 días.
     · Chequeo físico, regla de simplicidad (+3 %), política de atípicos
       validada sobre días sin filtrar, intervalos empíricos por escenario,
       habilitación solo si el modelo se sostiene en la prueba final.
   Produce un «paquete» con el mismo formato que modelo_servicios.json, que
   leen servicios-prediccion.js y la interfaz.
   ========================================================================= */
(function (raiz) {
  "use strict";
  const D = typeof module !== "undefined" && module.exports ? require("./servicios-datos.js") : raiz.SrvDatos;
  const CFGM = { fraccion_test: 0.2, ventana_inicial: 0.5, paso_dias: 14, min_obs_modelo: 40, min_obs_test: 15, tolerancia_simplicidad: 0.03, nivel_intervalo: 0.9, umbral_mad: 3.5, semilla: 42 };
  const ESC = ["baja", "media", "alta"];
  const ESCALA = 1000;
  const DIA = 86400000;

  /* ------------------------------------------------------------ álgebra */
  const suma = (a) => a.reduce((s, v) => s + v, 0);
  const media = (a) => suma(a) / a.length;
  function cuantil(a, q) {
    const s = a.slice().sort((x, y) => x - y);
    if (!s.length) return NaN;
    const h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.min(s.length - 1, lo + 1);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  }
  const mediana = (a) => cuantil(a, 0.5);
  function std1(a) {
    if (a.length < 2) return null;
    const m = media(a);
    return Math.sqrt(suma(a.map((v) => (v - m) ** 2)) / (a.length - 1));
  }
  // Resuelve A x = b (A cuadrada simétrica pequeña) por eliminación con pivoteo.
  function resolver(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-300) throw new Error("singular");
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  // Mínimos cuadrados por QR de Householder (estable, como numpy.lstsq).
  function mco(X, y) {
    const n = X.length, p = X[0].length;
    const A = X.map((r) => r.slice()), b = y.slice();
    for (let k = 0; k < p; k++) {
      let nrm = 0;
      for (let i = k; i < n; i++) nrm += A[i][k] * A[i][k];
      nrm = Math.sqrt(nrm);
      if (nrm === 0) continue;
      const alfa = A[k][k] > 0 ? -nrm : nrm;
      const v = new Array(n).fill(0);
      v[k] = A[k][k] - alfa;
      for (let i = k + 1; i < n; i++) v[i] = A[i][k];
      let vv = 0;
      for (let i = k; i < n; i++) vv += v[i] * v[i];
      if (vv === 0) continue;
      for (let j = k; j < p; j++) {
        let s = 0;
        for (let i = k; i < n; i++) s += v[i] * A[i][j];
        s = (2 * s) / vv;
        for (let i = k; i < n; i++) A[i][j] -= s * v[i];
      }
      let s = 0;
      for (let i = k; i < n; i++) s += v[i] * b[i];
      s = (2 * s) / vv;
      for (let i = k; i < n; i++) b[i] -= s * v[i];
    }
    const x = new Array(p).fill(0);
    for (let k = p - 1; k >= 0; k--) {
      let s = b[k];
      for (let j = k + 1; j < p; j++) s -= A[k][j] * x[j];
      x[k] = Math.abs(A[k][k]) < 1e-12 ? 0 : s / A[k][k];
    }
    return x;
  }

  /* ------------------------------------------------------------ modelos */
  class Modelo {
    constructor(hiper) { this.hiper = hiper || {}; }
    fit(P, C) {
      if (P.length < 3) throw new Error("Muy pocos datos para entrenar");
      this.p_min = Math.min(...P);
      this.p_max = Math.max(...P);
      this._fit(P, C);
      return this;
    }
    predict(P) { return P.map((p) => Math.max(0, this._predict1(p))); }
    etiqueta() {
      const h = Object.entries(this.hiper).map(([k, v]) => `${k}=${v}`).join(", ");
      return this.nombre + (h ? ` (${h})` : "");
    }
    parametros() { return {}; }
    formula() { return null; }
    exportarWeb() {
      const x = [], y = [];
      for (let i = 0; i < 801; i++) { const v = (2 * this.p_max * i) / 800; x.push(+v.toFixed(6)); }
      for (const v of x) y.push(+Math.max(0, this._predict1(v)).toFixed(6));
      return { tipo: "rejilla", x, y };
    }
  }
  const fmtG = (v) => Number(v.toPrecision(6)).toString();
  class Media extends Modelo {
    get familia() { return "media"; } get nombre() { return "Media histórica (no depende del volumen)"; } get complejidad() { return 0; }
    _fit(P, C) { this.mu = media(C); }
    _predict1() { return this.mu; }
    parametros() { return { media: this.mu }; }
    formula() { return `C = ${fmtG(this.mu)}`; }
    exportarWeb() { return { tipo: "polinomio", coef: [this.mu], escala: 1 }; }
  }
  class Ratio extends Modelo {
    get familia() { return "ratio"; } get nombre() { return "Consumo específico fijo (indicador actual)"; } get complejidad() { return 1; }
    _fit(P, C) { this.k = suma(C) / suma(P); }
    _predict1(p) { return this.k * p; }
    parametros() { return { k_por_hL: this.k }; }
    formula() { return `C = ${fmtG(this.k)} · P`; }
    exportarWeb() { return { tipo: "polinomio", coef: [0, this.k], escala: 1 }; }
  }
  class Lineal extends Modelo {
    get familia() { return "lineal"; } get nombre() { return "Regresión lineal"; } get complejidad() { return 2; }
    _fit(P, C) { this.b = mco(P.map((p) => [1, p]), C); }
    _predict1(p) { return this.b[0] + this.b[1] * p; }
    parametros() { return { b0: this.b[0], b1: this.b[1] }; }
    formula() { return `C = ${fmtG(this.b[0])} + ${fmtG(this.b[1])} · P`; }
    exportarWeb() { return { tipo: "polinomio", coef: [this.b[0], this.b[1]], escala: 1 }; }
  }
  // Huber con escala conjunta (mismo objetivo que sklearn HuberRegressor,
  // alpha = 0): descenso por bloques (w por IRLS, σ en forma cerrada).
  function ajustarHuber(P, C, eps) {
    const n = P.length;
    let b = mco(P.map((p) => [1, p]), C);
    let r = C.map((c, i) => c - b[0] - b[1] * P[i]);
    let sigma = 1.4826 * mediana(r.map(Math.abs)) || std1(r) || 1;
    for (let it = 0; it < 500; it++) {
      const w = r.map((ri) => (Math.abs(ri) <= eps * sigma ? 1 : (eps * sigma) / Math.abs(ri)));
      let s00 = 0, s01 = 0, s11 = 0, t0 = 0, t1 = 0;
      for (let i = 0; i < n; i++) { s00 += w[i]; s01 += w[i] * P[i]; s11 += w[i] * P[i] * P[i]; t0 += w[i] * C[i]; t1 += w[i] * P[i] * C[i]; }
      const nb = resolver([[s00, s01], [s01, s11]], [t0, t1]);
      r = C.map((c, i) => c - nb[0] - nb[1] * P[i]);
      let si = 0, nout = 0;
      for (const ri of r) { if (Math.abs(ri) < eps * sigma) si += ri * ri; else nout++; }
      const den = n - eps * eps * nout;
      const ns = den > 0 ? Math.sqrt(si / den) : sigma;
      const cambio = Math.abs(nb[0] - b[0]) / (Math.abs(b[0]) + 1) + Math.abs(nb[1] - b[1]) / (Math.abs(b[1]) + 1e-9) + Math.abs(ns - sigma) / sigma;
      b = nb;
      sigma = ns;
      if (cambio < 1e-10) break;
    }
    return { b0: b[0], b1: b[1], sigma };
  }
  class Huber extends Modelo {
    get familia() { return "huber"; } get nombre() { return "Regresión robusta (Huber)"; } get complejidad() { return 3; }
    _fit(P, C) { const h = ajustarHuber(P, C, this.hiper.epsilon || 1.35); this.b0 = h.b0; this.b1 = h.b1; }
    _predict1(p) { return this.b0 + this.b1 * p; }
    parametros() { return { b0: this.b0, b1: this.b1, epsilon: this.hiper.epsilon || 1.35 }; }
    formula() { return `C = ${fmtG(this.b0)} + ${fmtG(this.b1)} · P`; }
    exportarWeb() { return { tipo: "polinomio", coef: [this.b0, this.b1], escala: 1 }; }
  }
  class Segmentada extends Modelo {
    get familia() { return "segmentada"; } get nombre() { return "Regresión lineal segmentada"; } get complejidad() { return 4; }
    _fit(P, C) {
      const n = P.length, minimo = Math.max(15, Math.floor(0.15 * n));
      let mejor = null;
      for (let i = 0; i <= 28; i++) {
        const q = 0.15 + 0.025 * i;
        const pc = cuantil(P, q);
        let izq = 0;
        for (const p of P) if (p <= pc) izq++;
        const der = n - izq;
        if (izq < minimo || der < minimo) continue;
        const X = P.map((p) => [1, p, Math.max(0, p - pc)]);
        const b = mco(X, C);
        let sse = 0;
        for (let k = 0; k < n; k++) sse += (b[0] + b[1] * P[k] + b[2] * X[k][2] - C[k]) ** 2;
        if (!mejor || sse < mejor.sse) mejor = { sse, pc, b, izq, der };
      }
      if (!mejor) {
        const b = mco(P.map((p) => [1, p]), C);
        this.pc = Math.max(...P); this.b = [b[0], b[1], 0]; this.lados = [n, 0];
      } else { this.pc = mejor.pc; this.b = mejor.b; this.lados = [mejor.izq, mejor.der]; }
    }
    _predict1(p) { return this.b[0] + this.b[1] * p + this.b[2] * Math.max(0, p - this.pc); }
    parametros() { return { b0: this.b[0], b1: this.b[1], b2: this.b[2], Pc: this.pc, obs_izquierda: this.lados[0], obs_derecha: this.lados[1] }; }
    formula() { return `C = ${fmtG(this.b[0])} + ${fmtG(this.b[1])} · P + ${fmtG(this.b[2])} · max(0, P − ${fmtG(this.pc)})`; }
    exportarWeb() { return { tipo: "segmentada", b0: this.b[0], b1: this.b[1], b2: this.b[2], pc: this.pc }; }
  }
  class Polinomio2 extends Modelo {
    get familia() { return "polinomica"; } get nombre() { return "Regresión polinómica grado 2"; } get complejidad() { return 4; }
    _fit(P, C) { this.b = mco(P.map((p) => { const z = p / ESCALA; return [1, z, z * z]; }), C); }
    _predict1(p) { const z = p / ESCALA; return this.b[0] + this.b[1] * z + this.b[2] * z * z; }
    parametros() { return { b0: this.b[0], b1: this.b[1] / ESCALA, b2: this.b[2] / (ESCALA * ESCALA) }; }
    formula() { const q = this.parametros(); return `C = ${fmtG(q.b0)} + ${fmtG(q.b1)} · P + ${fmtG(q.b2)} · P²`; }
    exportarWeb() { return { tipo: "polinomio", coef: this.b.slice(), escala: ESCALA }; }
  }
  // B-splines cúbicos (nudos uniformes, extrapolación lineal) + Ridge con
  // intercepto: igual que SplineTransformer + Ridge de scikit-learn.
  function baseBspline(t, k, x) {
    const nB = t.length - k - 1;
    let i = k;
    while (i < nB - 1 && x >= t[i + 1]) i++;
    const N = new Array(nB).fill(0);
    // Cox–de Boor local
    const Nl = [1];
    for (let d = 1; d <= k; d++) {
      const nuevo = new Array(d + 1).fill(0);
      for (let r = 0; r < d; r++) {
        const izq = t[i + r + 1] - t[i + r + 1 - d];
        const w = izq === 0 ? 0 : (x - t[i + r + 1 - d]) / izq;
        nuevo[r] += (1 - w) * Nl[r];
        nuevo[r + 1] += w * Nl[r];
      }
      Nl.length = 0;
      Nl.push(...nuevo);
    }
    for (let r = 0; r <= k; r++) { const j = i - k + r; if (j >= 0 && j < nB) N[j] = Nl[r]; }
    return N;
  }
  function derivBspline(t, k, x) {
    const nB = t.length - k - 1;
    const Nk1 = baseBspline(t, k - 1, x); // longitud nB+1
    const out = new Array(nB).fill(0);
    for (let j = 0; j < nB; j++) {
      const a = t[j + k] - t[j], b = t[j + k + 1] - t[j + 1];
      out[j] = (a ? (k / a) * (Nk1[j] || 0) : 0) - (b ? (k / b) * (Nk1[j + 1] || 0) : 0);
    }
    return out;
  }
  class Spline extends Modelo {
    get familia() { return "spline"; } get nombre() { return "Splines cúbicos con penalización (Ridge)"; } get complejidad() { return 5; }
    _base(p) {
      const x = p / ESCALA, k = 3, t = this.t, lo = this.xmin, hi = this.xmax;
      if (x < lo) { const f = baseBspline(t, k, lo), d = derivBspline(t, k, lo); return f.map((v, j) => v + (x - lo) * d[j]); }
      if (x > hi) { const f = baseBspline(t, k, hi), d = derivBspline(t, k, hi); return f.map((v, j) => v + (x - hi) * d[j]); }
      return baseBspline(t, k, x);
    }
    _fit(P, C) {
      const nk = this.hiper.nudos || 5, alpha = this.hiper.alpha === undefined ? 1 : this.hiper.alpha, k = 3;
      const xs = P.map((p) => p / ESCALA);
      this.xmin = Math.min(...xs); this.xmax = Math.max(...xs);
      const base = [];
      for (let i = 0; i < nk; i++) base.push(this.xmin + ((this.xmax - this.xmin) * i) / (nk - 1));
      const d0 = base[1] - base[0], d1 = base[nk - 1] - base[nk - 2];
      const t = [];
      for (let i = k; i >= 1; i--) t.push(base[0] - i * d0);
      t.push(...base);
      for (let i = 1; i <= k; i++) t.push(base[nk - 1] + i * d1);
      this.t = t;
      const X = P.map((p) => this._base(p));
      const m = X[0].length, n = X.length;
      const mx = new Array(m).fill(0);
      for (const r of X) for (let j = 0; j < m; j++) mx[j] += r[j] / n;
      const my = media(C);
      const A = Array.from({ length: m }, () => new Array(m).fill(0)), bb = new Array(m).fill(0);
      for (let i = 0; i < n; i++) {
        const xc = X[i].map((v, j) => v - mx[j]), yc = C[i] - my;
        for (let a = 0; a < m; a++) { bb[a] += xc[a] * yc; for (let b2 = 0; b2 < m; b2++) A[a][b2] += xc[a] * xc[b2]; }
      }
      for (let a = 0; a < m; a++) A[a][a] += alpha;
      this.w = resolver(A, bb);
      this.c0 = my - suma(this.w.map((w, j) => w * mx[j]));
    }
    _predict1(p) { const f = this._base(p); return this.c0 + suma(f.map((v, j) => v * this.w[j])); }
  }

  function candidatos() {
    return {
      media: [() => new Media()],
      ratio: [() => new Ratio()],
      lineal: [() => new Lineal()],
      huber: [() => new Huber({ epsilon: 1.35 })],
      segmentada: [() => new Segmentada()],
      polinomica: [() => new Polinomio2()],
      spline: [4, 6].flatMap((k) => [0.3, 3.0].map((a) => () => new Spline({ nudos: k, alpha: a }))),
    };
  }
  function chequeoFisico(m, P, C) {
    const lo = cuantil(P, 0.02), hi = cuantil(P, 0.98);
    const g = Array.from({ length: 200 }, (_, i) => lo + ((hi - lo) * i) / 199);
    const y = m.predict(g);
    const mu = media(C);
    let mx = -Infinity, caida = 0;
    for (const v of y) { mx = Math.max(mx, v); caida = Math.max(caida, mx - v); }
    if (caida > 0.05 * mu) return [false, `La curva baja ${D.numEs(caida)} al subir la producción dentro del rango histórico (más del 5 % de la media).`];
    if (g.some((p) => m._predict1(p) < -0.02 * mu)) return [false, "Daría consumos negativos dentro del rango histórico."];
    return [true, ""];
  }

  /* ------------------------------------------------------------ métricas */
  function metricas(y, yh) {
    const n = y.length;
    if (!n) return { n: 0 };
    const e = yh.map((v, i) => v - y[i]);
    const my = media(y);
    const sst = suma(y.map((v) => (v - my) ** 2));
    const sy = suma(y.map(Math.abs));
    const out = {
      n, MAE: media(e.map(Math.abs)), RMSE: Math.sqrt(media(e.map((v) => v * v))),
      WAPE: sy > 0 ? suma(e.map(Math.abs)) / sy : null, R2: sst > 0 ? 1 - suma(e.map((v) => v * v)) / sst : null,
      sesgo: media(e), sesgo_pct: suma(y) > 0 ? suma(e) / suma(y) : null,
    };
    const md = mediana(y);
    const ok = y.map((v) => v >= 0.2 * md);
    const k = ok.filter(Boolean).length;
    out.MAPE = k >= 5 ? media(e.filter((_, i) => ok[i]).map((v, i) => Math.abs(v) / y.filter((_, j) => ok[j])[i])) : null;
    out.MAPE_n = k;
    return out;
  }
  const umbrales = (P) => [cuantil(P, 1 / 3), cuantil(P, 2 / 3)];
  const escenario = (p, u) => (p <= u[0] ? "baja" : p <= u[1] ? "media" : "alta");
  function porEscenario(P, y, yh, u) {
    const o = {};
    for (const s of ESC) {
      const idx = P.map((p, i) => (escenario(p, u) === s ? i : -1)).filter((i) => i >= 0);
      o[s] = metricas(idx.map((i) => y[i]), idx.map((i) => yh[i]));
    }
    return o;
  }

  /* ------------------------------------------------------------ partición */
  const ms = (f) => Date.parse(f + "T00:00:00Z");
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  function corteTest(primera, ultima, frac) {
    const dias = (ms(ultima) - ms(primera)) / DIA + 1;
    const nTest = Math.ceil(dias * frac);
    return iso(ms(ultima) - (nTest - 1) * DIA);
  }
  function bloques(fechas, ventana, paso) {
    if (fechas.length < 10) return [];
    const f = fechas.map(ms);
    let a = f[Math.floor(f.length * ventana)];
    const fin = Math.max(...f), out = [];
    while (a <= fin) {
      const b = a + paso * DIA;
      const tr = [], va = [];
      f.forEach((t, i) => { if (t < a) tr.push(i); else if (t < b) va.push(i); });
      if (va.length && tr.length >= 10) out.push([tr, va]);
      a = b;
    }
    return out;
  }
  function mascaraAtipicos(P, C, umbral) {
    if (P.length < 10) return P.map(() => false);
    const h = ajustarHuber(P, C, 1.35);
    const r = C.map((c, i) => c - h.b0 - h.b1 * P[i]);
    const md = mediana(r);
    const mad = 1.4826 * mediana(r.map((v) => Math.abs(v - md)));
    if (!(mad > 0)) return P.map(() => false);
    return r.map((v) => Math.abs(v - md) > umbral * mad);
  }
  function filtrar(x, pol) {
    if (pol === "todos") return x;
    if (pol === "sin_marcados") return x.filter((r) => !r.dudoso);
    const m = mascaraAtipicos(x.map((r) => r.produccion_hL), x.map((r) => r.consumo), CFGM.umbral_mad);
    return x.filter((_, i) => !m[i]);
  }
  function oos(x, fab, pol) {
    const fol = bloques(x.map((r) => r.fecha), CFGM.ventana_inicial, CFGM.paso_dias);
    const out = [];
    fol.forEach(([tri, vai], k) => {
      const tr = filtrar(tri.map((i) => x[i]), pol);
      if (tr.length < 10) return;
      const P = tr.map((r) => r.produccion_hL), C = tr.map((r) => r.consumo);
      const m = fab().fit(P, C);
      const u = umbrales(P);
      const va = vai.map((i) => x[i]);
      const pr = m.predict(va.map((r) => r.produccion_hL));
      va.forEach((r, j) => out.push({ fold: k, fecha: r.fecha, P: r.produccion_hL, y: r.consumo, pred: pr[j], escenario: escenario(r.produccion_hL, u) }));
    });
    return out;
  }
  function resumenOos(o) {
    const m = metricas(o.map((r) => r.y), o.map((r) => r.pred));
    if (o.length) {
      const g = new Map();
      for (const r of o) { if (!g.has(r.fold)) g.set(r.fold, [0, 0]); const a = g.get(r.fold); a[0] += Math.abs(r.pred - r.y); a[1] += Math.abs(r.y); }
      const w = [...g.values()].map(([e, y]) => e / Math.max(1e-9, y));
      m.WAPE_por_bloque_std = w.length > 1 ? std1(w) : null;
      m.bloques = w.length;
    }
    return m;
  }
  function cuantilesResiduo(o, nivel, minEsc) {
    const a = (1 - nivel) / 2, r = o.map((x) => x.y - x.pred);
    const glob = { q_inf: cuantil(r, a), q_sup: cuantil(r, 1 - a), n: r.length };
    const out = { global: glob };
    for (const s of ESC) {
      const rs = o.filter((x) => x.escenario === s).map((x) => x.y - x.pred);
      out[s] = rs.length >= (minEsc || 25) ? { q_inf: cuantil(rs, a), q_sup: cuantil(rs, 1 - a), n: rs.length } : Object.assign({}, glob, { nota: `pocos días en ${s} (${rs.length}): se usa el global` });
    }
    return out;
  }

  /* ------------------------------------------------------------ estadística */
  function rangos(a) {
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(a.length);
    let ties = 0;
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const rk = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = rk;
      const t = j - i + 1;
      ties += t * t * t - t;
      i = j + 1;
    }
    return { r, ties };
  }
  function pearson(x, y) {
    const mx = media(x), my = media(y);
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < x.length; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; }
    return a / Math.sqrt(b * c);
  }
  function erfc(x) {
    // Aproximación de Chebyshev (Numerical Recipes, error < 1,2e-7).
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function mannWhitneyP(a, b) {
    const n1 = a.length, n2 = b.length, n = n1 + n2;
    const { r, ties } = rangos(a.concat(b));
    const R1 = suma(r.slice(0, n1));
    const U1 = R1 - (n1 * (n1 + 1)) / 2, U = Math.max(U1, n1 * n2 - U1);
    const mu = (n1 * n2) / 2, s = Math.sqrt(((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1))));
    const z = (U - mu - 0.5) / s;
    return Math.min(1, erfc(z / Math.SQRT2));
  }
  function correlaciones(x) {
    const P = x.map((r) => r.produccion_hL), C = x.map((r) => r.consumo);
    if (P.length < 5) return { n: P.length };
    const l = new Lineal().fit(P, C);
    const pr = pearson(P, C);
    return { n: P.length, pearson: pr, spearman: pearson(rangos(P).r, rangos(C).r), pendiente_mco: l.b[1], intercepto_mco: l.b[0], r2_mco: pr * pr, consumo_especifico: suma(C) / suma(P) };
  }
  function estabilidad(x, corte) {
    const tr = x.filter((r) => r.fecha < corte), te = x.filter((r) => r.fecha >= corte);
    if (tr.length < 10 || te.length < 5) return { evaluable: false };
    const a = suma(tr.map((r) => r.consumo)) / suma(tr.map((r) => r.produccion_hL));
    const b = suma(te.map((r) => r.consumo)) / suma(te.map((r) => r.produccion_hL));
    const p = mannWhitneyP(tr.map((r) => r.consumo / r.produccion_hL), te.map((r) => r.consumo / r.produccion_hL));
    return { evaluable: true, especifico_entrenamiento: a, especifico_prueba: b, cambio_relativo: b / a - 1, mannwhitney_p: p, alerta: Math.abs(b / a - 1) > 0.15 && p < 0.01 };
  }
  function cook(x) {
    const P = x.map((r) => r.produccion_hL), C = x.map((r) => r.consumo), n = P.length;
    if (n < 5) return P.map(() => 0);
    const l = new Lineal().fit(P, C);
    const e = C.map((c, i) => c - l.b[0] - l.b[1] * P[i]);
    const mp = media(P), sxx = suma(P.map((p) => (p - mp) ** 2));
    const s2 = suma(e.map((v) => v * v)) / Math.max(1, n - 2);
    return P.map((p, i) => { const h = Math.min(0.999, 1 / n + (p - mp) ** 2 / sxx); return ((e[i] ** 2) / (2 * s2)) * (h / (1 - h) ** 2); });
  }
  function consumoBase(filas, s, ln) {
    const v = filas.filter((r) => r.servicio === s && r.linea === ln && r.estado === "sin_produccion").map((r) => r.consumo);
    if (!v.length) return { n: 0 };
    return { n: v.length, mediana: mediana(v), p10: cuantil(v, 0.1), p90: cuantil(v, 0.9), media: media(v), dias_con_consumo_0: v.filter((c) => c === 0).length };
  }

  /* ------------------------------------------------------------ una combinación */
  function evaluarCombinacion(x, corte) {
    const tr = x.filter((r) => r.fecha < corte), te = x.filter((r) => r.fecha >= corte);
    const res = { n_total: x.length, n_entrenamiento: tr.length, n_test: te.length, corte_test: corte };
    if (tr.length < CFGM.min_obs_modelo) {
      res.habilitado = false;
      res.motivo = `Solo ${tr.length} días válidos para entrenar (mínimo ${CFGM.min_obs_modelo}).`;
      return res;
    }
    const Ptr = tr.map((r) => r.produccion_hL), Ctr = tr.map((r) => r.consumo);
    const tabla = [], oosFam = {};
    for (const [fam, vars] of Object.entries(candidatos())) {
      let mejor = null;
      for (const fab of vars) {
        const o = oos(tr, fab, "todos"), r = resumenOos(o);
        if (!mejor || (r.WAPE !== null && r.WAPE < mejor.r.WAPE)) mejor = { fab, r, o };
      }
      const mf = mejor.fab().fit(Ptr, Ctr);
      const [ok, nota] = chequeoFisico(mf, Ptr, Ctr);
      oosFam[fam] = mejor;
      const fila = { familia: fam, modelo: mf.etiqueta(), complejidad: mf.complejidad, fisico_ok: ok, fisico_nota: nota };
      for (const [k, v] of Object.entries(mejor.r)) fila["cv_" + k] = v;
      tabla.push(fila);
    }
    const validos = tabla.filter((t) => t.fisico_ok && t.cv_WAPE !== null);
    const w0 = Math.min(...validos.map((t) => t.cv_WAPE));
    const cand = validos.filter((t) => t.cv_WAPE <= w0 * (1 + CFGM.tolerancia_simplicidad)).sort((a, b) => a.complejidad - b.complejidad || a.cv_WAPE - b.cv_WAPE);
    const elegida = cand[0].familia;
    tabla.forEach((t) => (t.seleccionado = t.familia === elegida));
    res.regla_seleccion = `Mejor WAPE fuera de muestra entre los modelos físicamente razonables: ${D.pctEs(w0)}. Se elige el más simple dentro de +${D.pctEs(CFGM.tolerancia_simplicidad, 0)} de ese valor: ${elegida}.`;
    const fab = oosFam[elegida].fab;
    // Política de atípicos.
    const pols = {};
    for (const pol of ["todos", "sin_atipicos", "sin_marcados"]) {
      const o = pol === "todos" ? oosFam[elegida].o : oos(tr, fab, pol);
      pols[pol] = Object.assign({ oos: o }, resumenOos(o));
    }
    let politica = "todos";
    const base = pols.todos.WAPE;
    for (const pol of ["sin_atipicos", "sin_marcados"]) {
      const w = pols[pol].WAPE;
      if (w !== null && w <= base * 0.97 && (politica === "todos" || w < pols[politica].WAPE)) politica = pol;
    }
    res.politica_atipicos = politica;
    res.comparacion_politicas = {};
    for (const [p, d] of Object.entries(pols)) { const c = Object.assign({}, d); delete c.oos; res.comparacion_politicas[p] = c; }
    const oFinal = pols[politica].oos;
    // Prueba final.
    const trf = filtrar(tr, politica);
    const mTr = fab().fit(trf.map((r) => r.produccion_hL), trf.map((r) => r.consumo));
    const uTr = umbrales(Ptr);
    const qTr = cuantilesResiduo(oFinal, CFGM.nivel_intervalo);
    const test = { n: te.length };
    if (te.length) {
      const Pte = te.map((r) => r.produccion_hL), yte = te.map((r) => r.consumo);
      const pr = mTr.predict(Pte);
      const lo = [], hi = [];
      Pte.forEach((p, i) => { const q = qTr[escenario(p, uTr)]; lo.push(Math.max(0, pr[i] + q.q_inf)); hi.push(Math.max(0, pr[i] + q.q_sup)); });
      Object.assign(test, metricas(yte, pr));
      test.por_escenario = porEscenario(Pte, yte, pr, uTr);
      test.cobertura_intervalo = yte.filter((y, i) => y >= lo[i] && y <= hi[i]).length / yte.length;
      test.fuera_de_rango_entrenamiento = Pte.filter((p) => p < mTr.p_min || p > mTr.p_max).length;
      res.test_predicciones = te.map((r, i) => ({ fecha: r.fecha, P: r.produccion_hL, y: r.consumo, pred: pr[i], lo: lo[i], hi: hi[i], escenario: escenario(r.produccion_hL, uTr) }));
      tabla.forEach((t) => { t.test_WAPE = metricas(yte, oosFam[t.familia].fab().fit(Ptr, Ctr).predict(Pte)).WAPE; });
    }
    res.test = test;
    const wMedia = tabla.find((t) => t.familia === "media").cv_WAPE, wSel = tabla.find((t) => t.familia === elegida).cv_WAPE;
    res.mejora_vs_media = wMedia ? 1 - wSel / wMedia : null;
    // Despliegue.
    const todo = filtrar(x, politica);
    res.modelo = fab().fit(todo.map((r) => r.produccion_hL), todo.map((r) => r.consumo));
    res.modelo_test = mTr;
    res.familia = elegida;
    res.umbrales = umbrales(x.map((r) => r.produccion_hL));
    res.cuantiles = cuantilesResiduo(oos(x, fab, politica), CFGM.nivel_intervalo);
    res.cv_oos = oFinal;
    const cm = Object.assign({}, pols[politica]); delete cm.oos;
    res.cv_metricas = cm;
    res.cv_por_escenario = oFinal.length ? porEscenario(oFinal.map((r) => r.P), oFinal.map((r) => r.y), oFinal.map((r) => r.pred), uTr) : {};
    res.candidatos = tabla;
    res.atipicos_entrenamiento_final = mascaraAtipicos(x.map((r) => r.produccion_hL), x.map((r) => r.consumo), CFGM.umbral_mad).filter(Boolean).length;
    res.habilitado = true;
    [res.calidad, res.calidad_nota] = calificar(res);
    return res;
  }
  function calificar(res) {
    const t = res.test || {};
    if (res.familia === "media") return ["Sin relación con el volumen", "La producción no explica este consumo mejor que su promedio diario fuera de muestra. La estimación es el consumo típico del día con su rango histórico, no una respuesta al volumen."];
    if (res.mejora_vs_media !== null && res.mejora_vs_media < 0.05)
      return ["Relación débil con el volumen", `El modelo mejora solo ${D.pctEs(res.mejora_vs_media, 0)} al promedio diario fuera de muestra (menos de 5 %): el volumen explica poco este consumo. Úselo como consumo típico del día, no como una respuesta fina al volumen.`];
    if ((t.n || 0) < CFGM.min_obs_test) return ["No validada", `Solo ${t.n || 0} días en la prueba final (mínimo ${CFGM.min_obs_test}): la precisión no se puede demostrar.`];
    const w = t.WAPE;
    if (w === null || w === undefined) return ["No validada", "Sin error de prueba."];
    const q = w <= 0.1 ? "Alta" : w <= 0.2 ? "Media" : w <= 0.35 ? "Baja" : "Muy baja";
    return [q, `Error ponderado en la prueba final (WAPE) ${D.pctEs(w)} en ${t.n} días; el intervalo del ${D.pctEs(CFGM.nivel_intervalo, 0)} cubrió el ${D.pctEs(t.cobertura_intervalo || 0, 0)} de esos días.`];
  }
  function decidirHabilitacion(res, est) {
    if (!res.habilitado) return;
    const t = res.test || {};
    if ((t.n || 0) >= CFGM.min_obs_test) {
      const w = t.WAPE, cob = t.cobertura_intervalo;
      if ((w !== null && w > 0.35) || (cob !== null && cob < 0.5)) {
        let extra = "";
        if (est.alerta) extra = ` Además el consumo específico cambió ${D.pctEs(est.cambio_relativo, 0, true)} entre el entrenamiento (${D.numEs(est.especifico_entrenamiento, 2)}) y la prueba (${D.numEs(est.especifico_prueba, 2)}): posible cambio de régimen o de medición.`;
        res.habilitado = false;
        res.motivo = `El modelo no se sostiene en los datos recientes: en la prueba final el error ponderado fue ${D.pctEs(w, 0)} y el intervalo del ${D.pctEs(CFGM.nivel_intervalo, 0)} cubrió solo el ${D.pctEs(cob, 0)} de los días.${extra} No se publica una predicción hasta revisar la medición.`;
      }
    }
  }
  function tablaEscenarios(x, u, res) {
    const P = x.map((r) => r.produccion_hL), C = x.map((r) => r.consumo);
    const tp = (res.test && res.test.por_escenario) || {}, q = res.cuantiles || {}, m = res.modelo;
    const lim = { baja: [Math.min(...P), u[0]], media: [u[0], u[1]], alta: [u[1], Math.max(...P)] };
    const out = [];
    for (const s of ESC) {
      const idx = P.map((p, i) => (escenario(p, u) === s ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const Ps = idx.map((i) => P[i]), Cs = idx.map((i) => C[i]);
      const pt = mediana(Ps), pred = m ? m.predict([pt])[0] : null;
      const qs = q[s] || q.global || {};
      out.push({
        escenario: s, rango_hL: [Math.round(lim[s][0] * 10) / 10, Math.round(lim[s][1] * 10) / 10], n: idx.length, volumen_tipico_hL: pt,
        consumo_medio: media(Cs), consumo_especifico: suma(Cs) / suma(Ps), desviacion: std1(Cs), cv_dispersion: Cs.length > 1 ? std1(Cs) / media(Cs) : null,
        prediccion_volumen_tipico: pred, intervalo_volumen_tipico: pred === null ? null : [Math.max(0, pred + (qs.q_inf || 0)), Math.max(0, pred + (qs.q_sup || 0))],
        test_n: (tp[s] || {}).n, test_MAE: (tp[s] || {}).MAE, test_WAPE: (tp[s] || {}).WAPE,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------ todo */
  // libro SheetJS → paquete (mismo formato que modelo_servicios.json).
  function entrenar(wb, meta, progreso) {
    const t0 = Date.now();
    const verif = D.verificarEstructura(wb);
    const ds = D.construirDataset(wb);
    D.aplicarReglas(ds.filas);
    const corte = corteTest(ds.primera, ds.ultima, CFGM.fraccion_test);
    const modelos = {}, historico = [], audExtra = [];
    const UNIDAD = { vapor: "kg", electricidad: "kWh", agua: "hL" };
    const combos = [];
    for (const s of ["vapor", "electricidad", "agua"]) for (const ln of [...D.SRV_CFG.lineas, D.LINEA_AUX]) if (ln !== D.LINEA_AUX || s === "electricidad") combos.push([s, ln]);
    combos.forEach(([s, ln], ci) => {
      if (progreso) progreso(ci / combos.length, `${s} ${ln}`);
      const x = ds.filas.filter((r) => r.servicio === s && r.linea === ln && r.estado === "valido").sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
      if (!x.length) return;
      const res = evaluarCombinacion(x, corte);
      const est = estabilidad(x, corte);
      decidirHabilitacion(res, est);
      const at = mascaraAtipicos(x.map((r) => r.produccion_hL), x.map((r) => r.consumo), CFGM.umbral_mad);
      const ck = cook(x);
      const atip = new Map(x.map((r, i) => [r.fecha, at[i]]));
      const spec = {
        servicio: s, linea: ln, unidad: UNIDAD[s], habilitado: !!res.habilitado, motivo: res.motivo || "",
        n_validos: res.n_total, n_entrenamiento: res.n_entrenamiento, n_test: res.n_test, corte_test: res.corte_test,
        base_sin_produccion: consumoBase(ds.filas, s, ln), correlaciones: correlaciones(x), estabilidad: est,
      };
      if (res.modelo) {
        const m = res.modelo;
        Object.assign(spec, {
          familia: res.familia, nombre_modelo: m.etiqueta(), formula: m.formula(), parametros: m.parametros(), web: m.exportarWeb(),
          rango: { p_min: m.p_min, p_max: m.p_max, desde: x[0].fecha, hasta: x[x.length - 1].fecha },
          umbrales: res.umbrales, cuantiles: res.cuantiles, nivel_intervalo: CFGM.nivel_intervalo,
          calidad: res.calidad, calidad_nota: res.calidad_nota, regla_seleccion: res.regla_seleccion,
          politica_atipicos: res.politica_atipicos, comparacion_politicas: res.comparacion_politicas, mejora_vs_media: res.mejora_vs_media,
          cv: res.cv_metricas, cv_por_escenario: res.cv_por_escenario, test: res.test, escenarios: tablaEscenarios(x, res.umbrales, res),
          candidatos: res.candidatos, test_predicciones: res.test_predicciones || [], cv_residuos: res.cv_oos, atipicos_entrenamiento_final: res.atipicos_entrenamiento_final,
        });
        // Auditoría de atípicos estadísticos (con la decisión tomada).
        const cp = res.comparacion_politicas;
        const comp = cp.todos && cp.sin_atipicos ? `WAPE fuera de muestra con todos ${D.pctEs(cp.todos.WAPE)} vs. sin atípicos ${D.pctEs(cp.sin_atipicos.WAPE)}.` : "";
        x.forEach((r, i) => {
          if (!at[i]) return;
          audExtra.push({
            fecha: r.fecha, linea: ln, variable: `${s} (${UNIDAD[s]})`, valor_original: r.consumo, fuente: r.fuente,
            criterio: "Residuo > 3,5 MAD respecto a una recta robusta (Huber) del mismo volumen",
            decision: res.politica_atipicos === "sin_atipicos" ? "Excluido del entrenamiento" : "Se conserva",
            justificacion: `Producción ${D.numEs(r.produccion_hL)} hL. Distancia de Cook ${D.numEs(ck[i], 3)}${ck[i] > 4 / x.length ? " (influyente)" : ""}. ` +
              (res.politica_atipicos === "sin_atipicos" ? "La política sin atípicos mejoró el error fuera de muestra ≥3 %. " : "Quitar los atípicos no mejoró el error fuera de muestra: puede ser una condición real del proceso. ") + comp,
          });
        });
      }
      modelos[s + "|" + ln] = spec;
      for (const r of ds.filas) {
        if (r.servicio !== s || r.linea !== ln || r.fuera_de_periodo) continue;
        historico.push({ f: r.fecha, l: ln, s, P: r.produccion_hL === null ? null : Math.round(r.produccion_hL * 100) / 100, C: r.consumo === null ? null : Math.round(r.consumo * 1000) / 1000, e: r.estado, a: !!atip.get(r.fecha) && r.estado === "valido", d: !!r.dudoso, m: (r.motivo_exclusion || r.marca || "").slice(0, 160) });
      }
    });
    if (progreso) progreso(1, "listo");
    const aud = D.auditoriaReglas(ds.filas).concat(audExtra).sort((a, b) => (a.variable + a.linea + a.fecha < b.variable + b.linea + b.fecha ? -1 : 1));
    return {
      formato: "prediccion-servicios/1",
      version: "web-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ""),
      version_programa: "T-minus servicios 1.0",
      creado: new Date().toISOString().slice(0, 19),
      fuente: Object.assign({ primera_fecha: ds.primera, ultima_fecha: ds.ultima }, meta || {}),
      unidades: { produccion: "hL", vapor: "kg", electricidad: "kWh", agua: "hL", hl_a_l: 100, hl_a_m3: 0.1 },
      lineas: D.SRV_CFG.nombres,
      auxiliares: { reparte_entre: D.SRV_CFG.electricidad.aux.reparte, nombre: "Auxiliares eléctricos compartidos (L5, L7, L8)" },
      modelado: CFGM,
      corte_test: corte,
      modelos,
      historico,
      calidad: { resumen: D.resumenCalidad(ds.filas), chequeos: D.chequeos(ds), auditoria: aud, hojas: (meta && meta.hojas) || [], hojas_ocultas: (meta && meta.hojas_ocultas) || [], verificaciones: verif },
      segundos: (Date.now() - t0) / 1000,
    };
  }

  const api = { CFGM, entrenar, evaluarCombinacion, metricas, cuantil, ajustarHuber, mco, Media, Ratio, Lineal, Huber, Segmentada, Polinomio2, Spline, corteTest, bloques, mannWhitneyP, correlaciones };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SrvModelos = api;
})(typeof window !== "undefined" ? window : globalThis);
