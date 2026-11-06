/* =========================================================================
   REPORTE T-MINUS (servicios) — ¿estoy arrancando y parando bien?
   -------------------------------------------------------------------------
   Con los datos DIARIOS del Excel de Indicadores de servicios (no hay horas):

   · Parada  = uno o más días seguidos en que la línea no envasa (0 hL).
               Bien si en todos esos días el consumo de la línea quedó dentro
               de lo normal para una línea parada: ≤ P90 de sus días parados
               del histórico (el «consumo base» del modelo).
   · Arranque = el primer día con producción después de una parada.
               Bien si el consumo quedó dentro de la banda del 90 % del modelo
               para los hL de ese día (≤ límite superior).
   Se juzga con electricidad y vapor de la línea (contadores de línea). El agua
   por línea se muestra aparte: en L5, L7 y L8 es en parte un contador
   compartido dividido en tres y en L9 casi no sigue a la producción.

   Áreas (L5, L7, L8, L9, elaboración, servicios industriales) y servicios de
   planta: consumo real frente a lo esperado por los modelos para la
   producción real de cada día del periodo. Área foco = la que más se pasa;
   área de aprendizaje = la que menos. Servicio foco = el que más se pasa en la
   planta; mejor controlado = el que tiene más días dentro de su banda.
   Lo esperado sale de modelos entrenados con todo el histórico cargado.
   ========================================================================= */
(function (raiz) {
  "use strict";
  const LINEAS = ["L5", "L7", "L8", "L9"];
  const JUZGA = ["electricidad", "vapor"];
  const MIN_BASE = 5; // días parados mínimos para tener un consumo base de referencia
  const dia = (f) => Date.parse(f + "T00:00:00Z");
  const fecha = (ms) => new Date(ms).toISOString().slice(0, 10);

  // Semanas lunes–domingo completas y meses con datos (más reciente primero).
  function periodos(desde, hasta) {
    const out = { semanas: [], meses: [] };
    if (!desde || !hasta) return out;
    const t0 = dia(desde), t1 = dia(hasta);
    let lunes = t0 + ((8 - new Date(t0).getUTCDay()) % 7) * 86400000; // primer lunes ≥ desde
    for (; lunes + 6 * 86400000 <= t1; lunes += 7 * 86400000) out.semanas.push({ tipo: "semana", desde: fecha(lunes), hasta: fecha(lunes + 6 * 86400000), etq: "Semana " + semanaIso(lunes) + " · " + fecha(lunes).slice(5).split("-").reverse().join("/") + " al " + fecha(lunes + 6 * 86400000).slice(5).split("-").reverse().join("/") });
    for (let a = new Date(t0), m = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1); m <= t1; ) {
      const d = new Date(m), sig = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      const ini = Math.max(m, t0), fin = Math.min(sig - 86400000, t1);
      out.meses.push({ tipo: "mes", desde: fecha(ini), hasta: fecha(fin), completo: fin === sig - 86400000 && ini === m, etq: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"][d.getUTCMonth()] + " " + d.getUTCFullYear() + (fin === sig - 86400000 ? "" : " (hasta el " + fecha(fin).slice(8) + ")") });
      m = sig;
    }
    out.semanas.reverse(); out.meses.reverse();
    return out;
  }
  function semanaIso(ms) {
    const d = new Date(ms), j = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)));
    return Math.ceil(((j - Date.UTC(j.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  function anterior(P) {
    const n = Math.round((dia(P.hasta) - dia(P.desde)) / 86400000) + 1;
    if (P.tipo === "semana") return { tipo: "semana", desde: fecha(dia(P.desde) - 7 * 86400000), hasta: fecha(dia(P.desde) - 86400000) };
    const d = new Date(dia(P.desde)), ini = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
    return { tipo: "mes", desde: fecha(ini), hasta: fecha(Math.min(dia(P.desde) - 86400000, ini + (n - 1) * 86400000)) };
  }

  // Lo esperado para una línea, servicio y día: con 0 hL el consumo base (mediana y P90 de los
  // días parados); con producción, el modelo (o el respaldo) y su banda del 90 %.
  // Criterio «exigente»: parada ≤ P75 de los días parados; arranque ≤ esperado + la mitad de la banda superior.
  function esperadoLinea(PR, m, P, exigente, p75) {
    if (!m) return null;
    if (P === 0) {
      const b = m.base_sin_produccion;
      if (!(b && b.n >= MIN_BASE)) return null;
      return { esp: b.mediana, lim: exigente && p75 != null ? p75 : b.p90 };
    }
    const r = PR.predecirCombinacion(m, P);
    if (!(r && r.habilitado && r.estimado != null && r.intervalo)) return null;
    return { esp: r.estimado, lim: exigente ? r.estimado + (r.intervalo[1] - r.estimado) / 2 : r.intervalo[1] };
  }
  function cuantil(xs, q) {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y), i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }

  function calcular(ctx, P) {
    const { B, E, I, PR, claveInd, totalElab, clavePlanta, v } = ctx;
    const pd = new Map((B.produccion_diaria || []).map((r) => [r[0], { coc: r[1] || 0, fil: r[2] || 0, env: r[3] || 0 }]));
    const enP = (f) => f >= P.desde && f <= P.hasta;
    const exigente = ctx.criterio === "exigente";
    // P75 del consumo en días parados, por línea y servicio (mismos días que el consumo base del modelo).
    const parados = {};
    for (const h of B.historico) if (h.P === 0 && h.C != null && h.e === "sin_produccion") (parados[h.s + "|" + h.l] = parados[h.s + "|" + h.l] || []).push(h.C);
    const p75 = {};
    for (const [k, xs] of Object.entries(parados)) p75[k] = xs.length >= MIN_BASE ? cuantil(xs, 0.75) : null;
    // --- Líneas: días por línea
    const porLinea = {};
    for (const h of B.historico) {
      if (!LINEAS.includes(h.l)) continue;
      const L = (porLinea[h.l] = porLinea[h.l] || new Map());
      const d = L.get(h.f) || { f: h.f, P: h.P, s: {} };
      if (h.P != null) d.P = h.P;
      d.s[h.s] = h;
      L.set(h.f, d);
    }
    const eventos = [];
    const juzgar = (ln, d, sv) => {
      const h = d.s[sv];
      if (!h || h.C == null || h.e === "excluido") return null;
      const x = esperadoLinea(PR, B.modelos[sv + "|" + ln], d.P || 0, exigente, p75[sv + "|" + ln]);
      if (!x) return null;
      return { f: d.f, real: h.C, esp: x.esp, lim: x.lim, ok: h.C <= x.lim, exceso: Math.max(0, h.C - x.esp) };
    };
    for (const ln of LINEAS) {
      const L = porLinea[ln];
      if (!L) continue;
      const dias = [...L.values()].filter((d) => d.P != null).sort((a, b) => (a.f < b.f ? -1 : 1));
      for (let i = 0; i < dias.length; i++) {
        if (dias[i].P !== 0) continue;
        let j = i;
        while (j + 1 < dias.length && dias[j + 1].P === 0 && dia(dias[j + 1].f) - dia(dias[j].f) === 86400000) j++;
        const tramo = dias.slice(i, j + 1);
        const ev = { tipo: "parada", linea: ln, desde: tramo[0].f, hasta: tramo[tramo.length - 1].f, dias: tramo.length, servicios: {} };
        for (const sv of [...JUZGA, "agua"]) {
          const js = tramo.map((d) => juzgar(ln, d, sv)).filter(Boolean);
          if (js.length) ev.servicios[sv] = { real: sum(js, "real"), esp: sum(js, "esp"), exceso: sum(js, "exceso"), ok: js.every((x) => x.ok), dias: js.length, malos: js.filter((x) => !x.ok).map((x) => x.f) };
        }
        eventos.push(ev);
        const sig = dias[j + 1];
        if (sig && sig.P > 0 && dia(sig.f) - dia(dias[j].f) === 86400000) {
          const ea = { tipo: "arranque", linea: ln, desde: sig.f, hasta: sig.f, dias: 1, P: sig.P, servicios: {} };
          for (const sv of [...JUZGA, "agua"]) {
            const x = juzgar(ln, sig, sv);
            if (x) ea.servicios[sv] = { real: x.real, esp: x.esp, lim: x.lim, exceso: x.exceso, ok: x.ok, dias: 1, malos: x.ok ? [] : [x.f] };
          }
          eventos.push(ea);
        }
        i = j;
      }
    }
    for (const ev of eventos) {
      const js = JUZGA.filter((sv) => ev.servicios[sv]);
      ev.estado = !js.length ? "sin_dato" : js.every((sv) => ev.servicios[sv].ok) ? "bien" : "mal";
      ev.fallan = js.filter((sv) => !ev.servicios[sv].ok);
    }
    const evP = eventos.filter((e) => enP(e.desde));
    const conteo = (tipo) => { const x = evP.filter((e) => e.tipo === tipo && e.estado !== "sin_dato"); return { n: x.length, bien: x.filter((e) => e.estado === "bien").length, sin_dato: evP.filter((e) => e.tipo === tipo && e.estado === "sin_dato").length }; };
    const resumen = { arranque: conteo("arranque"), parada: conteo("parada") };
    // Exceso sobre lo esperado, por tipo, servicio y línea (pareto)
    const exceso = {}, pareto = [];
    for (const tipo of ["arranque", "parada"]) {
      exceso[tipo] = {};
      for (const sv of [...JUZGA, "agua"]) {
        const x = evP.filter((e) => e.tipo === tipo && e.servicios[sv]);
        exceso[tipo][sv] = { exceso: sum(x.map((e) => e.servicios[sv]), "exceso"), esp: sum(x.map((e) => e.servicios[sv]), "esp"), real: sum(x.map((e) => e.servicios[sv]), "real") };
        for (const ln of LINEAS) {
          const y = x.filter((e) => e.linea === ln), ex = sum(y.map((e) => e.servicios[sv]), "exceso");
          if (y.length) pareto.push({ tipo, servicio: sv, linea: ln, eventos: y.length, mal: y.filter((e) => !e.servicios[sv].ok).length, exceso: ex });
        }
      }
    }
    // --- Áreas: real frente a esperado en los días del periodo
    const areas = [];
    for (const ln of LINEAS) {
      const L = porLinea[ln], a = { area: ln, tipo: "linea", servicios: {} };
      for (const sv of [...JUZGA, "agua"]) {
        let real = 0, esp = 0, n = 0, dentro = 0;
        for (const d of L ? L.values() : []) {
          if (!enP(d.f)) continue;
          const x = juzgar(ln, d, sv);
          if (!x) continue;
          real += x.real; esp += x.esp; n++; if (x.ok) dentro++;
        }
        if (n) a.servicios[sv] = { real, esp, desvio: esp > 0 ? real / esp - 1 : null, dias: n, dentro };
      }
      a.juzga = JUZGA;
      areas.push(a);
    }
    const diasP = [...pd.keys()].filter(enP).sort();
    const desdeModelos = (nombre, tipo, predf, M, claves) => {
      const a = { area: nombre, tipo, servicios: {} };
      for (const [sv, k] of Object.entries(claves)) {
        const m = k && M && M.modelos[k];
        if (!m) continue;
        const real = new Map(m.historico.filter((h) => h.c != null && h.e !== "excluido").map((h) => [h.f, h.c]));
        let r = 0, e = 0, n = 0, dentro = 0;
        for (const f of diasP) {
          if (!real.has(f)) continue;
          const p = predf(M, pd.get(f))[k];
          if (!p || p.estimado == null) continue;
          r += real.get(f); e += p.estimado; n++;
          if (!p.intervalo || real.get(f) <= p.intervalo[1]) dentro++;
        }
        if (n) a.servicios[sv] = { real: r, esp: e, desvio: e > 0 ? r / e - 1 : null, dias: n, dentro };
      }
      a.juzga = Object.keys(a.servicios);
      return a;
    };
    if (E) { const T = totalElab(v); areas.push(desdeModelos("Elaboración", "area", ctx.predElab, E, { vapor: T.vapor, electricidad: T.electricidad, agua: T.agua })); }
    if (I) areas.push(desdeModelos("Servicios industriales", "area", ctx.predInd, I, { electricidad: claveInd(I, "elec_servicios", v), agua: claveInd(I, "agua_servicios", v) }));
    for (const a of areas) {
      const ds = a.juzga.map((sv) => a.servicios[sv] && a.servicios[sv].desvio).filter((x) => x != null);
      a.desvio = ds.length ? ds.reduce((s, x) => s + x, 0) / ds.length : null;
    }
    // --- Servicios de la planta
    const servicios = [];
    if (I) {
      const pl = desdeModelos("Planta", "planta", ctx.predInd, I, { vapor: clavePlanta(I, "vapor", v), agua: clavePlanta(I, "agua", v), electricidad: clavePlanta(I, "electricidad", v) });
      for (const [sv, x] of Object.entries(pl.servicios)) servicios.push(Object.assign({ servicio: sv, dentro_pct: x.dentro / x.dias }, x));
    }
    // --- Focos
    const conDato = areas.filter((a) => a.desvio != null);
    const ord = [...conDato].sort((a, b) => b.desvio - a.desvio);
    const pctBien = (c) => (c.n ? c.bien / c.n : null);
    const pa = pctBien(resumen.arranque), pp = pctBien(resumen.parada);
    const exRel = (tipo) => { const xs = JUZGA.map((sv) => exceso[tipo][sv]).filter((x) => x.esp > 0); return xs.length ? xs.reduce((s, x) => s + x.exceso / x.esp, 0) / xs.length : 0; };
    let focoTM = null;
    if (pa != null || pp != null) {
      if (pa == null) focoTM = "parada";
      else if (pp == null) focoTM = "arranque";
      else if (Math.abs(pa - pp) > 1e-9) focoTM = pa < pp ? "arranque" : "parada";
      else focoTM = exRel("arranque") >= exRel("parada") ? "arranque" : "parada";
    }
    // Servicio foco: el que más se pasa de lo esperado; si ninguno se pasa, el que menos días tiene
    // dentro de su banda. Mejor controlado: entre los demás, el de más días dentro de su banda.
    const sOrd = [...servicios].sort((a, b) => (b.desvio > 0 || a.desvio > 0 ? b.desvio - a.desvio : a.dentro_pct - b.dentro_pct || b.desvio - a.desvio));
    const sCtrl = servicios.filter((x) => x !== sOrd[0]).sort((a, b) => b.dentro_pct - a.dentro_pct || Math.abs(a.desvio) - Math.abs(b.desvio));
    return {
      periodo: P, eventos: evP, resumen, exceso, pareto: pareto.filter((x) => x.exceso > 0).sort((a, b) => b.exceso - a.exceso), areas, servicios,
      foco: { tminus: focoTM, area: ord[0] || null, aprendizaje: ord.length > 1 ? ord[ord.length - 1] : null, servicio: sOrd[0] || null, controlado: sCtrl[0] || null },
      dias: diasP.length,
    };
  }

  /* ---------------- Regresión múltiple de planta (pedida por la planta) ----------------
     C = b0 + b5·hL L5 + b7·hL L7 + b8·hL L8 + b9·hL L9 + bc·hL cocinados, mínimos cuadrados.
     Validación: se ajusta con los días antes del corte de prueba del modelo de planta y se mide
     el error en los días siguientes (por día, por semana completa y el sesgo). Las fórmulas que
     se muestran se ajustan con todos los días. Días: válidos o de carga base del modelo de planta. */
  function mco(X, y) {
    const k = X[0].length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
    for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { A[a][k] += X[i][a] * y[i]; for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b]; }
    for (let c = 0; c < k; c++) {
      let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map((r, i) => r[k] / r[i]);
  }
  function regresionPlanta(B, I, claveInd, v) {
    if (!B || !I || !B.produccion_diaria) return null;
    const hl = new Map();
    for (const h of B.historico) { if (!LINEAS.includes(h.l) || h.P == null) continue; const x = hl.get(h.f) || {}; x[h.l] = h.P; hl.set(h.f, x); }
    const coc = new Map(B.produccion_diaria.map((r) => [r[0], r[1] || 0]));
    const SERV = [["vapor", "vapor_planta", "kg"], ["electricidad", "elec_planta", "kWh"], ["agua", "agua_planta", "hL"], ["co2", "co2_consumo", "kg"]];
    const out = [];
    for (const [sv, base, u] of SERV) {
      const k = claveInd(I, base, v), m = k && I.modelos[k];
      if (!m) continue;
      const filas = [];
      for (const h of m.historico) {
        if (h.c == null || (h.e !== "valido" && h.e !== "carga_base")) continue;
        const x = hl.get(h.f);
        if (!x || LINEAS.some((l) => x[l] == null) || !coc.has(h.f)) continue;
        filas.push({ f: h.f, x: [1, x.L5, x.L7, x.L8, x.L9, coc.get(h.f)], y: h.c });
      }
      if (filas.length < 60) continue;
      const corte = m.corte || filas[Math.floor(filas.length * 0.8)].f;
      const tr = filas.filter((r) => r.f < corte), te = filas.filter((r) => r.f >= corte);
      const bT = tr.length >= 30 ? mco(tr.map((r) => r.x), tr.map((r) => r.y)) : null;
      const pred = (b, r) => r.x.reduce((a, xi, i) => a + xi * b[i], 0);
      let val = null;
      if (bT && te.length >= 14) {
        const sy = te.reduce((a, r) => a + r.y, 0), se = te.reduce((a, r) => a + Math.abs(r.y - pred(bT, r)), 0), sp = te.reduce((a, r) => a + pred(bT, r), 0);
        const sem = new Map();
        for (const r of te) { const d = new Date(r.f + "T00:00:00Z"), l = fecha(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000); const w = sem.get(l) || [0, 0, 0]; w[0] += r.y; w[1] += pred(bT, r); w[2]++; sem.set(l, w); }
        const ws = [...sem.values()].filter((w) => w[2] === 7);
        val = { dia: se / sy, semana: ws.length ? ws.reduce((a, w) => a + Math.abs(w[0] - w[1]), 0) / ws.reduce((a, w) => a + w[0], 0) : null, sesgo: sp / sy - 1, n: te.length, desde: te[0].f };
      }
      const b = mco(filas.map((r) => r.x), filas.map((r) => r.y));
      if (!b) continue;
      out.push({ servicio: sv, serie: k, unidad: u, coef: b, n: filas.length, desde: filas[0].f, hasta: filas[filas.length - 1].f, val });
    }
    return out;
  }
  function sum(arr, k) { return arr.reduce((s, x) => s + (x[k] || 0), 0); }

  const api = { periodos, anterior, calcular, esperadoLinea, regresionPlanta, mco, LINEAS, JUZGA, MIN_BASE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SrvRep = api;
})(typeof window !== "undefined" ? window : globalThis);
