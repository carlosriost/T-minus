/* =========================================================================
   CONSUMOS DE SERVICIOS · 4) Elaboración (cocinas, cavas y filtración)
   -------------------------------------------------------------------------
   Lee del Excel «Indicadores de servicios» el vapor, la electricidad y el
   agua de elaboración y los hL cocinados, filtrados y envasados; depura los
   datos (ajustes escritos a mano, valores fijos, cambio de nivel de los
   contadores) y compara, para cada área y servicio, qué variable y qué
   modelo predicen mejor días que no vio. Mismo método que el análisis en
   Python (elab/modelar.py), salvo bosque aleatorio y gradient boosting, que
   no se usan en el navegador.
   ========================================================================= */
(function (raiz) {
  "use strict";
  const enNode = typeof module !== "undefined" && module.exports;
  const D = enNode ? require("./servicios-datos.js") : raiz.SrvDatos;
  const M = enNode ? require("./servicios-modelos.js") : raiz.SrvModelos;
  const PR = enNode ? require("./servicios-prediccion.js") : raiz.SrvPred;

  const HOJAS_ELAB = ["MAESTRA", "Contadores vapor", "ENERGIA ELECTRICA", "DATOS SEMANA", "AGUA SERV-PERI"];
  // Los contadores de vapor de cocina y de cavas y filtración cambian de nivel
  // a comienzos de marzo de 2026 (la suma de los dos se mantiene).
  const CAMBIO_CYF = "2026-03-08";
  const CAMBIO_COC = "2026-03-09";
  const CFG = { test: 0.2, tol: 0.03, mad: 3.5, mejora_politica: 0.03, nivel: 0.9, umbral_base: 0.1 };
  const ESCALA = 1000;
  const DRIVERS = { coc: ["coc"], fil: ["fil"], env: ["env"], "coc+fil": ["coc", "fil"], "coc+fil+env": ["coc", "fil", "env"] };
  const NOMBRE_DRIVER = { coc: "hL cocinados", fil: "hL filtrados", env: "hL envasados", "coc+fil": "cocinados + filtrados", "coc+fil+env": "cocinados + filtrados + envasados" };

  // serie: [área, servicio, variante, unidad, factor, variables naturales, campo]
  const SERIES = {
    vapor_cocina_oficial: ["Cocinas", "vapor", "oficial", "kg", 1000, ["coc"], "vapCoc"],
    vapor_cocina_medido: ["Cocinas", "vapor", "contador", "kg", 1000, ["coc"], "vapCocMed"],
    vapor_cyf_oficial: ["Cavas y filtración", "vapor", "oficial", "kg", 1000, ["fil"], "vapCyf"],
    vapor_cyf_medido: ["Cavas y filtración", "vapor", "contador", "kg", 1000, ["fil"], "vapCyfMed"],
    vapor_secador: ["Secador", "vapor", "contador", "kg", 1000, ["coc"], "vapSec"],
    vapor_elab_oficial: ["Elaboración", "vapor", "oficial", "kg", 1000, ["coc", "fil"], "vapElab"],
    vapor_elab_medido: ["Elaboración", "vapor", "contador", "kg", 1000, ["coc", "fil"], "vapElabMed"],
    elec_cocinas: ["Cocinas", "electricidad", "", "kWh", 1, ["coc"], "kwhCoc"],
    elec_filtracion: ["Filtración", "electricidad", "", "kWh", 1, ["fil"], "kwhFil"],
    elec_elab: ["Elaboración", "electricidad", "", "kWh", 1, ["coc", "fil"], "kwhElab"],
    agua_cocinas: ["Cocinas", "agua", "", "hL", 1, ["coc"], "aguaCoc"],
    agua_cavas: ["Cavas", "agua", "", "hL", 1, ["coc", "fil"], "aguaCav"],
    agua_filtracion: ["Filtración", "agua", "", "hL", 1, ["fil"], "aguaFil"],
    agua_elab: ["Elaboración", "agua", "", "hL", 1, ["coc", "fil"], "aguaElab"],
  };

  /* ------------------------------------------------------------ utilidades */
  const suma = (a) => a.reduce((s, v) => s + v, 0);
  const media = (a) => suma(a) / a.length;
  const cuantil = M.cuantil;
  const mediana = (a) => cuantil(a, 0.5);
  const num = (v) => D.aNumero(v);
  function celda(wb, h, c, f) { const ws = wb.Sheets[h]; return ws ? ws[c + f] : undefined; }
  function valor(wb, h, c, f) { const x = celda(wb, h, c, f); return x ? num(x.v) : null; }
  function formula(wb, h, c, f) { const x = celda(wb, h, c, f); if (!x) return null; if (x.f) return "=" + x.f; return x.v === undefined ? null : x.v; }
  function esFecha(c) {
    if (!c || typeof c.v !== "number") return false;
    if (c.t === "d") return true;
    const z = c.z || "";
    if (raiz.XLSX && raiz.XLSX.SSF && z) return raiz.XLSX.SSF.is_date(z);
    return /[dmy]/i.test(z.replace(/"[^"]*"/g, "")) && !/^General$/i.test(z);
  }
  function filasPorFecha(wb, hoja, col, desde, hasta) {
    const ws = wb.Sheets[hoja], out = new Map();
    if (!ws || !ws["!ref"]) return out;
    const n = Number((/:([A-Z]+)(\d+)$/.exec(ws["!ref"]) || [0, 0, 0])[2]);
    for (let r = 1; r <= n; r++) {
      const c = ws[col + r];
      if (!esFecha(c)) continue;
      const f = D.serialAFecha(c.v);
      if (f && f >= desde && f <= hasta && !out.has(f)) out.set(f, r);
    }
    return out;
  }
  const lunes = (f) => { const d = new Date(f + "T00:00:00Z"); const k = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - k * 86400000).toISOString().slice(0, 10); };

  /* ------------------------------------------------------------ lectura */
  // Ajuste escrito a mano = valor oficial − diferencia de las lecturas que la
  // fórmula referencia (cubre «+24+18», «+k−5» o el número dentro del IF).
  function ajusteContador(wb, f, oficial, col) {
    if (!(typeof f === "string" && f.startsWith("="))) return { aj: 0, fijo: true };
    const m = new RegExp(col + "(\\d+)\\s*-\\s*" + col + "(\\d+)").exec(f);
    if (!m || oficial === null) return { aj: 0, fijo: true };
    const a = valor(wb, "Contadores vapor", col, Number(m[1])), b = valor(wb, "Contadores vapor", col, Number(m[2]));
    if (a === null || b === null) return { aj: 0, fijo: true };
    return { aj: Math.round((oficial - (a - b)) * 1e6) / 1e6, fijo: false };
  }

  function leer(wb, desde, hasta) {
    const faltan = HOJAS_ELAB.filter((h) => !wb.Sheets[h]);
    if (faltan.length) throw new Error("Faltan hojas para elaboración: " + faltan.join(", "));
    const mM = filasPorFecha(wb, "MAESTRA", "A", desde, hasta);
    const mV = filasPorFecha(wb, "Contadores vapor", "A", desde, hasta);
    const mE = filasPorFecha(wb, "ENERGIA ELECTRICA", "A", desde, hasta);
    const mS = filasPorFecha(wb, "DATOS SEMANA", "C", desde, hasta);
    const mA = filasPorFecha(wb, "AGUA SERV-PERI", "A", desde, hasta);
    const filas = [];
    for (const [f, rM] of [...mM.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const r = { fecha: f };
      const eb = valor(wb, "MAESTRA", "EB", rM), ed = valor(wb, "MAESTRA", "ED", rM);
      r.coc = (eb === 1 ? 0 : eb || 0) + (ed || 0); // EB vale 1 cuando no hubo cerveza cocinada
      r.fil = valor(wb, "MAESTRA", "EH", rM);
      r.env = ["CF", "CH", "CJ", "CL"].reduce((s, c) => s + (valor(wb, "MAESTRA", c, rM) || 0), 0);
      const B = valor(wb, "MAESTRA", "B", rM);
      const rV = mV.get(f);
      if (rV) {
        r.vapSec = valor(wb, "Contadores vapor", "AS", rV);
        r.vapCoc = valor(wb, "Contadores vapor", "AU", rV);
        r.vapCyf = valor(wb, "Contadores vapor", "AW", rV);
        const a = ajusteContador(wb, formula(wb, "Contadores vapor", "AU", rV), r.vapCoc, "AT");
        const b = ajusteContador(wb, formula(wb, "Contadores vapor", "AW", rV), r.vapCyf, "AV");
        r.ajCoc = a.aj; r.fijoCoc = a.fijo; r.ajCyf = b.aj; r.fijoCyf = b.fijo;
        r.vapCocMed = r.vapCoc === null ? null : r.vapCoc - a.aj;
        r.vapCyfMed = r.vapCyf === null ? null : r.vapCyf - b.aj;
        const sec = Math.max(0, r.vapSec || 0);
        r.vapElab = r.vapCoc === null || r.vapCyf === null ? null : sec + r.vapCoc + r.vapCyf;
        r.vapElabMed = r.vapCocMed === null || r.vapCyfMed === null ? null : sec + r.vapCocMed + r.vapCyfMed;
      }
      const rE = mE.get(f);
      if (rE && B !== null) {
        const T = valor(wb, "ENERGIA ELECTRICA", "T", rE), V = valor(wb, "ENERGIA ELECTRICA", "V", rE);
        const fT = String(formula(wb, "ENERGIA ELECTRICA", "T", rE) || ""), fV = formula(wb, "ENERGIA ELECTRICA", "V", rE);
        const mT = /,0\)\s*\+\s*(\d+(?:\.\d+)?)\s*\)/.exec(fT);
        r.ajKwh = mT ? Number(mT[1]) : 0;
        r.kwhCoc = T === null ? null : T * B - r.ajKwh;
        r.kwhFil = V === null ? null : V * B;
        r.fijoKwhFil = !(typeof fV === "string" && fV.startsWith("="));
        r.kwhElab = r.kwhCoc === null || r.kwhFil === null ? null : r.kwhCoc + r.kwhFil;
      }
      const rS = mS.get(f);
      if (rS) {
        r.aguaCoc = valor(wb, "DATOS SEMANA", "FE", rS);
        r.aguaCav = valor(wb, "DATOS SEMANA", "FF", rS);
        r.aguaFil = valor(wb, "DATOS SEMANA", "FG", rS);
        r.aguaElab = r.aguaCoc === null || r.aguaCav === null || r.aguaFil === null ? null : r.aguaCoc + r.aguaCav + r.aguaFil;
        r.aguaTotalExcel = valor(wb, "DATOS SEMANA", "D", rS);
        const fD = formula(wb, "DATOS SEMANA", "D", rS);
        r.aguaTotalAjustada = !(typeof fD === "string" && /^=VLOOKUP\([^)]*\)$/i.test(fD.replace(/\s/g, "")));
      }
      const rA = mA.get(f);
      if (rA) r.aguaMedidor = valor(wb, "AGUA SERV-PERI", "CH", rA);
      filas.push(r);
    }
    return filas;
  }

  /* ------------------------------------------------------------ reglas */
  function series(filas) {
    const medias = { coc: media(filas.map((r) => r.coc || 0)), fil: media(filas.map((r) => r.fil || 0)), env: media(filas.map((r) => r.env || 0)) };
    const out = {};
    for (const [s, [area, serv, variante, unidad, fac, nat, campo]] of Object.entries(SERIES)) {
      out[s] = filas.map((r) => {
        const v = r[campo];
        let estado = "valido", motivo = "", marca = "";
        if (v === null || v === undefined || !isFinite(v)) { estado = "excluido"; motivo = "sin dato"; }
        else if ((s.startsWith("vapor_cocina") || s.startsWith("vapor_elab")) && r.fijoCoc) { estado = "excluido"; motivo = "cocina: valor escrito a mano en vez de fórmula"; }
        else if (s.startsWith("vapor_cyf") && r.fijoCyf) { estado = "excluido"; motivo = "cavas y filtración: valor escrito a mano en vez de fórmula"; }
        if (estado === "valido" && s === "vapor_cyf_medido" && r.fecha < CAMBIO_CYF) { estado = "excluido"; motivo = "contador de cavas y filtración con otro nivel antes del 08/03"; }
        if (estado === "valido" && s === "vapor_cocina_medido" && r.fecha < CAMBIO_COC) { estado = "excluido"; motivo = "contador de cocina con otro nivel antes del 09/03"; }
        if (estado === "valido" && (s === "elec_filtracion" || s === "elec_elab") && r.fijoKwhFil) { estado = "excluido"; motivo = "filtración: kWh/hL escrito a mano"; }
        if (estado === "valido" && v < 0) { estado = "excluido"; motivo = "valor negativo"; }
        if (estado === "valido") {
          if (s === "vapor_cocina_oficial" && r.ajCoc) marca = `ajuste manual ${D.numEs(r.ajCoc, 1, true)} t`;
          if (s === "vapor_cyf_oficial" && r.ajCyf) marca = `ajuste manual ${D.numEs(r.ajCyf, 1, true)} t`;
          if (s === "vapor_elab_oficial" && (r.ajCoc || r.ajCyf)) marca = `ajuste manual ${D.numEs((r.ajCoc || 0) + (r.ajCyf || 0), 1, true)} t`;
          if ((s === "elec_cocinas" || s === "elec_elab") && r.ajKwh) marca = `se quitó un ajuste manual de +${D.numEs(r.ajKwh)} kWh`;
          if (s === "agua_elab" && r.aguaMedidor && r.aguaElab) {
            const q = (r.aguaMedidor * 10) / r.aguaElab;
            if (q < 0.7 || q > 1.3) marca = `el medidor general de elaboración difiere ${D.pctEs(q - 1, 0, true)}`;
          }
        }
        if (estado === "valido" && nat.some((k) => (r[k] || 0) < CFG.umbral_base * medias[k])) { estado = "carga_base"; motivo = "producción del área < 10 % de la media"; }
        if (estado === "valido" && v === 0) { estado = "excluido"; motivo = "consumo cero con producción"; }
        return { fecha: r.fecha, consumo: v === null || v === undefined ? null : v * fac, coc: r.coc || 0, fil: r.fil || 0, env: r.env || 0, estado, motivo, marca, dudoso: !!marca };
      });
    }
    return { series: out, medias };
  }

  /* ------------------------------------------------------------ modelos */
  // Varias variables: mínimos cuadrados y Huber (escala conjunta), en miles de hL.
  function huberMulti(X, y, eps) {
    const n = X.length;
    let b = M.mco(X, y);
    const pred = (bb) => X.map((r) => suma(r.map((v, j) => v * bb[j])));
    let r = y.map((v, i) => v - pred(b)[i]);
    let sigma = 1.4826 * mediana(r.map(Math.abs)) || 1;
    for (let it = 0; it < 500; it++) {
      const w = r.map((ri) => (Math.abs(ri) <= eps * sigma ? 1 : (eps * sigma) / Math.abs(ri)));
      const sw = w.map(Math.sqrt);
      const nb = M.mco(X.map((row, i) => row.map((v) => v * sw[i])), y.map((v, i) => v * sw[i]));
      const p = pred(nb);
      r = y.map((v, i) => v - p[i]);
      let si = 0, nout = 0;
      for (const ri of r) { if (Math.abs(ri) < eps * sigma) si += ri * ri; else nout++; }
      const den = n - eps * eps * nout;
      const ns = den > 0 ? Math.sqrt(si / den) : sigma;
      let cambio = Math.abs(ns - sigma) / sigma;
      nb.forEach((v, j) => (cambio += Math.abs(v - b[j]) / (Math.abs(b[j]) + 1e-9)));
      b = nb; sigma = ns;
      if (cambio < 1e-10) break;
    }
    return b;
  }
  class Multi {
    constructor(tipo) { this.tipo = tipo; this.familia = tipo; this.nombre = tipo === "lineal" ? "Regresión lineal múltiple" : "Regresión robusta (Huber) múltiple"; this.complejidad = tipo === "lineal" ? 2 : 3; }
    fit(X, y) {
      const Z = X.map((r) => [1, ...r.map((v) => v / ESCALA)]);
      this.b = this.tipo === "lineal" ? M.mco(Z, y) : huberMulti(Z, y, 1.35);
      this.lo = X[0].map((_, j) => Math.min(...X.map((r) => r[j])));
      this.hi = X[0].map((_, j) => Math.max(...X.map((r) => r[j])));
      return this;
    }
    predict(X) { return X.map((r) => Math.max(0, this.b[0] + suma(r.map((v, j) => (this.b[j + 1] * v) / ESCALA)))); }
    web() { return { tipo: "multi", b0: this.b[0], b: this.b.slice(1).map((v) => v / ESCALA) }; }
    etiqueta() { return this.nombre; }
  }
  class Uno {
    constructor(fab) { this.fab = fab; const m = fab(); this.familia = m.familia; this.nombre = m.etiqueta(); this.complejidad = m.complejidad; }
    fit(X, y) { this.m = this.fab().fit(X.map((r) => r[0]), y); this.lo = [this.m.p_min]; this.hi = [this.m.p_max]; return this; }
    predict(X) { return this.m.predict(X.map((r) => r[0])); }
    web() { return { tipo: "uno", web: this.m.exportarWeb() }; }
    etiqueta() { return this.m.etiqueta(); }
    formula() { return this.m.formula(); }
  }
  function candidatos(k) {
    if (k > 1) return [["lineal", () => new Multi("lineal")], ["huber", () => new Multi("huber")]];
    const fams = [["media", () => new M.Media()], ["ratio", () => new M.Ratio()], ["lineal", () => new M.Lineal()], ["huber", () => new M.Huber({ epsilon: 1.35 })], ["segmentada", () => new M.Segmentada()], ["polinomica", () => new M.Polinomio2()]];
    for (const nk of [4, 6]) for (const a of [0.3, 3.0]) fams.push(["spline", () => new M.Spline({ nudos: nk, alpha: a })]);
    return fams.map(([f, fab]) => [f, () => new Uno(fab)]);
  }
  const XY = (rows, cols) => rows.map((r) => cols.map((c) => r[c]));
  function met(y, p) {
    const e = p.map((v, i) => v - y[i]), sy = suma(y.map(Math.abs)), my = media(y);
    const ss = suma(y.map((v) => (v - my) ** 2));
    return { n: y.length, WAPE: sy ? suma(e.map(Math.abs)) / sy : null, MAE: media(e.map(Math.abs)), R2: ss ? 1 - suma(e.map((v) => v * v)) / ss : null, sesgo: media(e) };
  }
  function folds(fechas) {
    const out = [];
    const f = fechas.map((x) => Date.parse(x + "T00:00:00Z"));
    let a = f[Math.floor(f.length * 0.5)];
    const fin = Math.max(...f);
    while (a <= fin) {
      const b = a + 14 * 86400000, tr = [], va = [];
      f.forEach((t, i) => { if (t < a) tr.push(i); else if (t < b) va.push(i); });
      if (va.length && tr.length >= 15) out.push([tr, va]);
      a = b;
    }
    return out;
  }
  function atipicos(X, y) {
    if (y.length < 15) return y.map(() => false);
    const m = new Multi("huber").fit(X, y);
    const r = y.map((v, i) => v - m.predict([X[i]])[0]);
    const md = mediana(r), mad = 1.4826 * mediana(r.map((v) => Math.abs(v - md)));
    return mad > 0 ? r.map((v) => Math.abs(v - md) > CFG.mad * mad) : y.map(() => false);
  }
  function filtrar(rows, cols, pol) {
    if (pol === "sin_atipicos") { const m = atipicos(XY(rows, cols), rows.map((r) => r.consumo)); return rows.filter((_, i) => !m[i]); }
    if (pol === "sin_marcados") return rows.filter((r) => !r.dudoso);
    return rows;
  }
  function oos(x, cols, fab, pol) {
    const out = [];
    folds(x.map((r) => r.fecha)).forEach(([tr, va], k) => {
      const T = filtrar(tr.map((i) => x[i]), cols, pol);
      if (T.length < 15) return;
      const m = fab().fit(XY(T, cols), T.map((r) => r.consumo));
      const V = va.map((i) => x[i]);
      const p = m.predict(XY(V, cols));
      V.forEach((r, j) => out.push({ fold: k, fecha: r.fecha, y: r.consumo, pred: p[j] }));
    });
    return out;
  }
  function fisico(m, X, y) {
    const med = X[0].map((_, j) => mediana(X.map((r) => r[j]))), mu = media(y);
    for (let j = 0; j < med.length; j++) {
      const col = X.map((r) => r[j]), lo = cuantil(col, 0.02), hi = cuantil(col, 0.98);
      const g = Array.from({ length: 200 }, (_, i) => { const r = med.slice(); r[j] = lo + ((hi - lo) * i) / 199; return r; });
      const p = m.predict(g);
      let mx = -Infinity, caida = 0;
      for (const v of p) { mx = Math.max(mx, v); caida = Math.max(caida, mx - v); }
      if (caida > 0.05 * mu) return [false, `baja al subir la variable ${j + 1}`];
    }
    return [true, ""];
  }
  function semanal(pred) {
    const g = new Map();
    for (const r of pred) { const k = lunes(r.fecha); if (!g.has(k)) g.set(k, { y: 0, p: 0, n: 0 }); const a = g.get(k); a.y += r.y; a.p += r.pred; a.n++; }
    const w = [...g.values()].filter((a) => a.n >= 5);
    const sy = suma(w.map((a) => a.y));
    return w.length && sy ? { WAPE: suma(w.map((a) => Math.abs(a.p - a.y))) / sy, semanas: w.length } : { WAPE: null, semanas: 0 };
  }

  function evaluarSerie(x) {
    const corte = M.corteTest(x[0].fecha, x[x.length - 1].fecha, CFG.test);
    const ent = x.filter((r) => r.fecha < corte), pru = x.filter((r) => r.fecha >= corte);
    const cand = [];
    for (const [dk, cols] of Object.entries(DRIVERS)) {
      for (const [fam, fab] of candidatos(cols.length)) {
        const o = oos(ent, cols, fab, "todos");
        if (o.length < 10) continue;
        const mm = fab().fit(XY(ent, cols), ent.map((r) => r.consumo));
        const [ok, nota] = fisico(mm, XY(ent, cols), ent.map((r) => r.consumo));
        const cv = met(o.map((r) => r.y), o.map((r) => r.pred));
        cand.push({ drivers: dk, cols, familia: fam, modelo: mm.etiqueta(), complejidad: mm.complejidad + (cols.length - 1) * 0.5, cv_WAPE: cv.WAPE, cv_R2: cv.R2, fisico_ok: ok, fisico_nota: nota, test_WAPE: met(pru.map((r) => r.consumo), mm.predict(XY(pru, cols))).WAPE, fab });
      }
    }
    const base = Math.min(...cand.filter((c) => c.familia === "media" && c.cols.length === 1).map((c) => c.cv_WAPE));
    const ok = cand.filter((c) => c.fisico_ok && c.cv_WAPE !== null);
    const w0 = Math.min(...ok.map((c) => c.cv_WAPE));
    const sel = ok.filter((c) => c.cv_WAPE <= w0 * (1 + CFG.tol)).sort((a, b) => a.complejidad - b.complejidad || a.cv_WAPE - b.cv_WAPE)[0];
    const { cols, fab } = sel;
    const pols = {};
    for (const pol of ["todos", "sin_atipicos", "sin_marcados"]) {
      if (pol === "sin_marcados" && !ent.some((r) => r.dudoso)) continue;
      const o = oos(ent, cols, fab, pol);
      if (o.length) pols[pol] = met(o.map((r) => r.y), o.map((r) => r.pred)).WAPE;
    }
    let pol = "todos";
    for (const p of ["sin_atipicos", "sin_marcados"]) if (p in pols && pols[p] <= pols.todos * (1 - CFG.mejora_politica) && pols[p] < (pols[pol] === undefined ? 9 : pols[pol])) pol = p;
    const o = oos(ent, cols, fab, pol);
    const entF = filtrar(ent, cols, pol);
    const mEnt = fab().fit(XY(entF, cols), entF.map((r) => r.consumo));
    const pt = mEnt.predict(XY(pru, cols));
    const res = o.map((r) => r.y - r.pred), a = (1 - CFG.nivel) / 2;
    const q = [cuantil(res, a), cuantil(res, 1 - a)];
    const ypru = pru.map((r) => r.consumo);
    const cob = ypru.filter((y, i) => y >= Math.max(0, pt[i] + q[0]) && y <= pt[i] + q[1]).length / ypru.length;
    const test = met(ypru, pt), cv = met(o.map((r) => r.y), o.map((r) => r.pred));
    const predTest = pru.map((r, i) => ({ fecha: r.fecha, y: r.consumo, pred: pt[i] }));
    const xF = filtrar(x, cols, pol);
    const mFin = fab().fit(XY(xF, cols), xF.map((r) => r.consumo));
    const porDriver = {};
    for (const c of ok) porDriver[c.drivers] = Math.min(porDriver[c.drivers] === undefined ? Infinity : porDriver[c.drivers], c.cv_WAPE);
    return {
      corte, n_entrenamiento: ent.length, n_test: pru.length, drivers: sel.drivers, cols, familia: sel.familia, modelo: mFin.etiqueta(),
      formula: mFin.formula ? mFin.formula() : null, web: mFin.web(), lo: mFin.lo, hi: mFin.hi,
      politica: pol, politicas: pols, cv, test, test_semanal: semanal(predTest), cobertura: cob, q,
      mejora_vs_media: base ? (base - cv.WAPE) / base : null, por_driver: porDriver,
      candidatos: cand.map((c) => { const r = Object.assign({}, c); delete r.fab; delete r.cols; r.seleccionado = c === sel; return r; }),
      pred_test: predTest,
    };
  }
  function calidad(r) {
    const w = r.test.WAPE;
    const malo = w === null || w > 0.35 || r.cobertura < 0.5;
    if (r.familia === "media") return malo ? "Sin relación · no confiable" : "Sin relación con el volumen";
    if (malo) return "No confiable";
    let qq = w <= 0.1 ? "Alta" : w <= 0.2 ? "Media" : "Baja";
    if (r.mejora_vs_media !== null && r.mejora_vs_media < 0.05) qq += " · relación débil";
    return qq;
  }

  /* ------------------------------------------------------------ todo */
  function entrenar(wb, periodo, progreso) {
    const t0 = Date.now();
    const filas = leer(wb, periodo.desde, periodo.hasta);
    const { series: S, medias } = series(filas);
    const modelos = {};
    const claves = Object.keys(SERIES);
    claves.forEach((s, i) => {
      if (progreso) progreso(i / claves.length, s);
      const [area, serv, variante, unidad, , nat] = SERIES[s];
      const xs = S[s];
      const v = xs.filter((r) => r.estado === "valido");
      const spec = { serie: s, area, servicio: serv, variante, unidad, naturales: nat, n_estados: {} };
      xs.forEach((r) => (spec.n_estados[r.estado] = (spec.n_estados[r.estado] || 0) + 1));
      // Carga base: días con la producción natural del área < 10 % de la media.
      // Se mide contra la producción propia del área (la primera variable
      // natural: cocinados para cocinas, cavas y los totales; filtrados para filtración).
      const b = xs.filter((r) => r.estado !== "excluido" && r.consumo !== null && r[nat[0]] < CFG.umbral_base * medias[nat[0]]).map((r) => r.consumo);
      spec.carga_base = b.length ? { n: b.length, mediana: mediana(b), min: Math.min(...b), max: Math.max(...b), p10: cuantil(b, 0.1), p90: cuantil(b, 0.9) } : { n: 0 };
      spec.media_valida = v.length ? media(v.map((r) => r.consumo)) : null;
      if (v.length >= 40) {
        const hb = new Multi("huber").fit(XY(v, [nat[0]]), v.map((r) => r.consumo));
        spec.fijo_operando = hb.b[0];
        const r = evaluarSerie(v);
        Object.assign(spec, r);
        spec.calidad = calidad(r);
        spec.habilitado = !/no confiable/i.test(spec.calidad);
        // Estabilidad del consumo específico (primera vs. segunda mitad).
        const e = v.map((x) => x.consumo / Math.max(1, x[nat[0]])), h = Math.floor(e.length / 2);
        const e1 = mediana(e.slice(0, h)), e2 = mediana(e.slice(h));
        spec.estabilidad = { especifico_1: e1, especifico_2: e2, cambio: e2 / e1 - 1, p: M.mannWhitneyP(e.slice(0, h), e.slice(h)) };
      } else { spec.habilitado = false; spec.calidad = "Sin datos suficientes"; }
      spec.historico = xs.map((r) => ({ f: r.fecha, c: r.consumo === null ? null : Math.round(r.consumo * 10) / 10, e: r.estado, m: (r.motivo || r.marca || "").slice(0, 90) }));
      modelos[s] = spec;
    });
    // Resumen de la auditoría del vapor (ajustes escritos a mano).
    const conV = filas.filter((r) => r.vapCoc !== null && r.vapCoc !== undefined);
    const desde = (f) => conV.filter((r) => r.fecha >= f);
    const aud = {
      dias: conV.length,
      cocina: { dias_ajuste: conV.filter((r) => Math.abs(r.ajCoc || 0) > 1e-6).length, suma_t: suma(conV.map((r) => r.ajCoc || 0)), oficial_t: suma(conV.map((r) => r.vapCoc || 0)), fijos: conV.filter((r) => r.fijoCoc).map((r) => r.fecha) },
      cyf: { dias_ajuste: conV.filter((r) => Math.abs(r.ajCyf || 0) > 1e-6).length, suma_t: suma(conV.map((r) => r.ajCyf || 0)), oficial_desde_cambio: media(desde(CAMBIO_CYF).map((r) => r.vapCyf)), contador_desde_cambio: media(desde(CAMBIO_CYF).map((r) => r.vapCyfMed)), contador_antes: media(conV.filter((r) => r.fecha < CAMBIO_CYF).map((r) => r.vapCyfMed)) },
      kwh_ajustes: filas.filter((r) => r.ajKwh).map((r) => ({ fecha: r.fecha, kwh: r.ajKwh })),
      kwh_fil_fijos: filas.filter((r) => r.fijoKwhFil).map((r) => r.fecha),
      agua_total_ajustada: filas.filter((r) => r.aguaTotalAjustada).map((r) => r.fecha),
      agua_medidor_vs_suma: (() => { const z = filas.filter((r) => r.aguaMedidor && r.aguaElab); return z.length ? suma(z.map((r) => r.aguaMedidor * 10)) / suma(z.map((r) => r.aguaElab)) : null; })(),
      cambio_contadores: { cocina: CAMBIO_COC, cyf: CAMBIO_CYF },
    };
    if (progreso) progreso(1, "listo");
    return { formato: "elaboracion/1", desde: periodo.desde, hasta: periodo.hasta, medias, umbral_base: CFG.umbral_base, nivel: CFG.nivel, modelos, auditoria: aud, segundos: (Date.now() - t0) / 1000 };
  }

  /* ------------------------------------------------------------ predicción */
  function evaluarWeb(web, x) {
    if (web.tipo === "multi") return Math.max(0, web.b0 + suma(web.b.map((b, j) => b * x[j])));
    return Math.max(0, PR.evaluar(web.web, x[0]));
  }
  // prod = { coc, fil, env } en hL del día. Devuelve una fila por serie.
  function predecir(E, prod) {
    const out = {};
    for (const [s, m] of Object.entries(E.modelos)) {
      const r = { serie: s, area: m.area, servicio: m.servicio, variante: m.variante, unidad: m.unidad, calidad: m.calidad, habilitado: m.habilitado };
      const k0 = m.naturales[0], bajo = (prod[k0] || 0) < E.umbral_base * E.medias[k0];
      if (bajo && m.carga_base && m.carga_base.n) {
        r.estimado = m.carga_base.mediana; r.intervalo = [m.carga_base.p10, m.carga_base.p90]; r.carga_base = true;
      } else if (m.web) {
        const x = m.cols.map((c) => prod[c] || 0);
        r.estimado = evaluarWeb(m.web, x);
        r.intervalo = [Math.max(0, r.estimado + m.q[0]), r.estimado + m.q[1]];
        r.extrapolacion = x.some((v, j) => v < m.lo[j] || v > m.hi[j]);
        if (bajo) r.nota = "Producción baja y sin días de carga base medidos: se usa el modelo.";
      } else r.estimado = null;
      out[s] = r;
    }
    return out;
  }

  const api = { HOJAS_ELAB, SERIES, NOMBRE_DRIVER, CAMBIO_COC, CAMBIO_CYF, leer, series, entrenar, predecir, evaluarWeb };
  if (enNode) module.exports = api;
  else raiz.SrvElab = api;
})(typeof window !== "undefined" ? window : globalThis);
