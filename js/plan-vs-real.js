/* =========================================================================
   PLAN VS. REAL DE COCINAS
   -------------------------------------------------------------------------
   Compara el plan de cocinas que FerIA calcula desde el plan de envasado
   (STATE.seq, motor de engine.js) con el programa que de verdad publica el
   área de Cocinas (Excel «Programa_Cocinas.xlsx», que ya leyó
   programa-cocinas.js en PC.filas). Aquí NO se vuelve a leer el Excel.

   Por qué cada regla de la comparación:
   · Ventana: del I0 al fin del último cocimiento del plan FerIA. Antes del I0
     FerIA no programa nada (lo que hay es inventario) y después de su último
     cocimiento no hay contra qué comparar. Del real solo entra lo que cae ahí.
   · Mostos: FerIA tiene una sola Pony (GO y HG son el mismo mosto y se cuecen
     juntas), así que en el real Pony HG + Pony GO = Pony. Club Colombia no está
     en el catálogo de FerIA: se muestra aparte, «solo en el real».
   · hL = cocimientos × hL por cocimiento del catálogo en los dos lados, para que
     la diferencia sea de cantidad y no de rendimiento de laboratorio.
   · Parejas: el n-ésimo cocimiento de un mosto en el plan contra el n-ésimo del
     mismo mosto en el real. Desfase = cargue real − cargue plan (+ = el real
     arranca después). Adherencia = % de cocimientos del plan cuya pareja real
     arranca a ±X h (X editable, 4 h por defecto).
   · Cobertura del envasado: la misma regla del motor. Cada bloque de envasado
     necesita sus cocimientos cargados a más tardar en
     «primer envasado − maduración − fermentación − cocina» (tiempos del
     catálogo). Se cuentan los cocimientos de cada mosto desde el I0 y en orden:
     el bloque que pide el cocimiento acumulado n.º C está cubierto si el C-ésimo
     cocimiento (del plan o del real) cargó antes de ese límite.
   · Reglas: se miden igual en los dos planes y sobre TODAS las marcas de la
     ventana (una corrida de Pony depende de lo que se cocina alrededor), sin
     importar el filtro de mostos.
   ========================================================================= */

const PVR_LS_KEY = "planVsRealCocinas";
const PVR_H = 3600000;
const PVR_D = 86400000;
const PVR_MOSTOS = [
  { id: "estandar", nombre: "Estándar", cls: "pc-c1" },
  { id: "pilsen", nombre: "Pilsen", cls: "pc-c2" },
  { id: "light", nombre: "Light", cls: "pc-c3" },
  { id: "pony", nombre: "Pony (GO + HG)", cls: "pc-c4" },
];
// Club Colombia: aún no está en el catálogo de mostos de FerIA (decisión de
// Utilities/Elaboración: por el momento no se agrega), así que no tiene pareja.
const PVR_CLUB = { id: "club", nombre: "Club Colombia", cls: "pc-c6" };
// Topes de los acuerdos (los mismos que usan acuerdos.js y engine.js).
const PVR_TOPE_PONY_SEMANA_HL = 23600; // acuerdo R6: hL de Pony por semana
const PVR_ASEO_MAX_DIAS = 14; // acuerdo 1 de Elaboración: aseo cada 14 días máx.
const PVR_PARADA_H = 12; // hueco sin cargues que se considera parada (SLA 1)
const PVR_PONY_MIN = 2;
const PVR_PONY_MAX = 5;
const PVR_PONY_SEP_H = 24; // día de por medio entre corridas de Pony

let PVR_F = null; // filtros: {desde, hasta, mostos:Set, tol, unidad, firma}
let PVR_SEL = null; // clave del cocimiento elegido ("p…" plan / "r…" real)
let PVR_ULTIMO = null; // último resultado (para el detalle y los «Ver»)

/* ------------------------------------------------------------ utilidades */

function pvrPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PVR_LS_KEY) || "null") || {};
  } catch (_) {
    return {};
  }
}
function pvrGuardarPrefs() {
  try {
    localStorage.setItem(PVR_LS_KEY, JSON.stringify({ tol: PVR_F.tol, mostos: [...PVR_F.mostos], unidad: PVR_F.unidad }));
  } catch (_) {
    // Sin almacenamiento: los filtros viven solo en esta sesión.
  }
}
function pvrInfo(id) {
  return PVR_MOSTOS.find((m) => m.id === id) || (id === "club" ? PVR_CLUB : { id, nombre: id, cls: "pc-otro" });
}
function pvrCatalogo(id) {
  return ((typeof MOSTO_CATALOG !== "undefined" && MOSTO_CATALOG) || []).find((m) => m.id === id) || null;
}
function pvrHlCoc(id) {
  const m = pvrCatalogo(id);
  return m ? Number(m.volumenPorCocimiento) || 0 : null; // null = sin catálogo (Club)
}
function pvrMostoDeReal(id) {
  return id === "ponyhg" || id === "ponygo" ? "pony" : id;
}
function pvrEsPony(id) {
  return id === "pony";
}
function pvrLunes(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}
function pvrFmt(ms) {
  return ms == null ? "—" : fmtDateTime(new Date(ms));
}
function pvrFmtDesfase(h) {
  if (h == null || !isFinite(h)) return "—";
  const m = Math.round(Math.abs(h) * 60);
  const s = m === 0 ? "±" : h > 0 ? "+" : "−";
  // Más de dos días se lee mejor en días.
  if (Math.abs(h) >= 48) return `${s}${MOD_NF(Math.abs(h) / 24, 1)} días`;
  return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}
function pvrPct(a, b) {
  return b ? (a / b) * 100 : null;
}
function pvrFmtDif(real, plan, dec) {
  const d = real - plan;
  const p = pvrPct(d, plan);
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${MOD_NF(Math.abs(d), dec || 0)}${p != null ? ` (${d > 0 ? "+" : d < 0 ? "−" : "±"}${MOD_NF(Math.abs(p), 0)} %)` : ""}`;
}

/* -------------------------------------------------------------- entradas */

// Lee los dos planes tal como están cargados en la app.
function pvrFuentes() {
  if (typeof PC !== "undefined" && !PC && typeof pcRecuperar === "function") pcRecuperar();
  const seq = typeof STATE !== "undefined" && STATE ? STATE.seq : null;
  const feria = seq && Array.isArray(seq.rows) ? seq.rows.filter((r) => r.start && r.end) : [];
  const cocF = feria.filter((r) => r.tipo === "cocimiento").sort((a, b) => a.start - b.start);
  const pc = typeof PC !== "undefined" && PC && Array.isArray(PC.filas) ? PC : null;
  const i0d = typeof getI0Date === "function" ? getI0Date() : null;
  const i0 = i0d && !isNaN(i0d) ? i0d.getTime() : cocF.length ? cocF[0].start.getTime() : null;
  return { feria, cocF, pc, real: pc ? pc.filas : null, i0 };
}

/* ------------------------------------------------------------- cálculo */

// Cálculo puro: todo lo que muestra el módulo, sin tocar el DOM.
// src = pvrFuentes(); opts = {desde, hasta, mostos:Set, tol}
function calcularPlanVsReal(src, opts) {
  const { desde, hasta, mostos, tol } = opts;
  const enVentana = (ms) => ms >= desde && ms <= hasta;

  // Todos los cocimientos de cada lado (para arranques y cobertura).
  const planTodos = src.cocF.map((r) => ({ lado: "plan", key: `p${r.n != null ? r.n : r.start.getTime()}`, mosto: r.mostoId, ms: r.start.getTime(), fin: r.end.getTime(), row: r }));
  const realTodos = (src.real || [])
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.tipo === "coc" && x.inicio != null)
    .map(({ x, i }) => ({ lado: "real", key: `r${i}`, mosto: pvrMostoDeReal(x.id), ms: x.inicio, fin: x.fin != null ? x.fin : x.inicio + (x.durMin || 0) * 60000, x, i }))
    .sort((a, b) => a.ms - b.ms);

  // Ventana: por fecha de cargue.
  const planV = planTodos.filter((c) => enVentana(c.ms));
  const realV = realTodos.filter((c) => enVentana(c.ms));
  const plan = planV.filter((c) => mostos.has(c.mosto));
  const real = realV.filter((c) => mostos.has(c.mosto));
  const numerar = (lista) => {
    const k = {};
    lista.forEach((c) => (c.k = k[c.mosto] = (k[c.mosto] || 0) + 1));
  };
  numerar(plan);
  numerar(real);

  // Aseos y paros de cada lado dentro de la ventana.
  const aseosPlan = src.feria
    .filter((r) => r.tipo === "aseo" && enVentana(r.start.getTime()))
    .map((r) => ({ ms: r.start.getTime(), fin: r.end.getTime(), nombre: r.nombre || "Aseo" }));
  const eventosReal = (src.real || [])
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.tipo === "evento" && x.inicio != null && (x.fin != null ? x.fin : x.inicio) >= desde && x.inicio <= hasta)
    .map(({ x, i }) => ({ ms: x.inicio, fin: x.fin != null ? x.fin : x.inicio + (x.durMin || 0) * 60000, id: x.id, nombre: x.texto, i }));
  const aseosReal = eventosReal.filter((e) => e.id === "aseo" && enVentana(e.ms));

  // (b) Parejas n-ésimo contra n-ésimo, por mosto comparable.
  const comparables = [...mostos].filter((m) => m !== "club");
  const parejas = [];
  comparables.forEach((m) => {
    const p = plan.filter((c) => c.mosto === m);
    const r = real.filter((c) => c.mosto === m);
    for (let k = 0; k < Math.max(p.length, r.length); k++) {
      const a = p[k] || null;
      const b = r[k] || null;
      const d = a && b ? (b.ms - a.ms) / PVR_H : null;
      const par = { mosto: m, k: k + 1, plan: a, real: b, desfaseH: d, dentro: d == null ? null : Math.abs(d) <= tol + 1e-9 };
      if (a) a.par = par;
      if (b) b.par = par;
      parejas.push(par);
    }
  });
  parejas.sort((u, v) => (u.plan ? u.plan.ms : u.real.ms) - (v.plan ? v.plan.ms : v.real.ms));
  const club = real.filter((c) => c.mosto === "club");

  // (a) Totales y semanas.
  const porMosto = {};
  [...mostos].forEach((m) => {
    const hl = pvrHlCoc(m);
    const pc = plan.filter((c) => c.mosto === m).length;
    const rc = real.filter((c) => c.mosto === m).length;
    porMosto[m] = { plan: pc, real: rc, hlPlan: hl != null ? pc * hl : null, hlReal: hl != null ? rc * hl : null };
  });
  const sum = (campo) => comparables.reduce((a, m) => a + (porMosto[m][campo] || 0), 0);
  const tot = { cocPlan: sum("plan"), cocReal: sum("real"), hlPlan: sum("hlPlan"), hlReal: sum("hlReal"), club: club.length };
  const semanas = [];
  for (let w = pvrLunes(desde); w <= hasta; w += 7 * PVR_D) {
    const fila = { semana: w, mostos: {} };
    [...mostos].forEach((m) => {
      const hl = pvrHlCoc(m);
      const pc = plan.filter((c) => c.mosto === m && pvrLunes(c.ms) === w).length;
      const rc = real.filter((c) => c.mosto === m && pvrLunes(c.ms) === w).length;
      fila.mostos[m] = { plan: pc, real: rc, hlPlan: hl != null ? pc * hl : null, hlReal: hl != null ? rc * hl : null };
    });
    semanas.push(fila);
  }

  // Adherencia y desfase.
  const conPareja = parejas.filter((p) => p.desfaseH != null);
  const dentro = conPareja.filter((p) => p.dentro).length;
  const adherencia = { dentro, base: tot.cocPlan, pct: pvrPct(dentro, tot.cocPlan) };
  const desfase = {
    n: conPareja.length,
    prom: conPareja.length ? conPareja.reduce((a, p) => a + p.desfaseH, 0) / conPareja.length : null,
    promAbs: conPareja.length ? conPareja.reduce((a, p) => a + Math.abs(p.desfaseH), 0) / conPareja.length : null,
  };

  // (c) Secuencia y (e) reglas: sobre todas las marcas de la ventana.
  const secuencia = { plan: pvrSecuencia(planV, aseosPlan), real: pvrSecuencia(realV, aseosReal) };
  const reglas = pvrReglas(planV, realV, aseosPlan, aseosReal, planTodos, realTodos, desde, hasta);

  // (d) Cobertura del envasado.
  const cobertura = pvrCobertura(src, planTodos, realTodos, mostos);

  const res = { desde, hasta, tol, mostos, plan, real, planTodos, realTodos, aseosPlan, eventosReal, parejas, club, porMosto, tot, semanas, adherencia, desfase, secuencia, reglas, cobertura };
  res.discrepancias = pvrDiscrepancias(res);
  return res;
}

// Bloques de marca en orden: cocimientos seguidos del mismo mosto. Los aseos se
// muestran entre bloques, pero un aseo periódico no es cambio de marca.
function pvrSecuencia(cocs, aseos) {
  const items = [...cocs.map((c) => ({ t: "c", ms: c.ms, c })), ...aseos.map((a) => ({ t: "a", ms: a.ms, a }))].sort((a, b) => a.ms - b.ms || (a.t === "a" ? -1 : 1));
  const chips = [];
  let marcas = 0;
  let cambiosPony = 0;
  let prevMosto = null;
  items.forEach((it) => {
    const ult = chips[chips.length - 1];
    if (it.t === "a") {
      chips.push({ tipo: "aseo", ms: it.ms, n: 1 });
      return;
    }
    const m = it.c.mosto;
    if (ult && ult.tipo === "coc" && ult.mosto === m) ult.n++;
    else chips.push({ tipo: "coc", mosto: m, ms: it.ms, n: 1, key: it.c.key });
    if (prevMosto !== m) {
      if (prevMosto != null) {
        marcas++;
        if (pvrEsPony(prevMosto) !== pvrEsPony(m)) cambiosPony++;
      }
      prevMosto = m;
    }
  });
  const ts = aseos.map((a) => a.ms).sort((a, b) => a - b);
  let sepMax = null;
  for (let i = 1; i < ts.length; i++) sepMax = Math.max(sepMax || 0, (ts[i] - ts[i - 1]) / PVR_D);
  return { chips, cambiosMarca: marcas, cambiosPony, aseos: ts.length, sepMaxDias: sepMax };
}

// Reglas de negocio medidas igual en los dos planes.
function pvrReglas(planV, realV, aseosPlan, aseosReal, planTodos, realTodos, desde, hasta) {
  const diasVentana = (hasta - desde) / PVR_D;
  const medir = (cocs, aseos, todos) => {
    const r = {};
    // 1. Aseos con 14 días de separación máxima (acuerdo 1 de Elaboración).
    const ts = aseos.map((a) => a.ms).sort((a, b) => a - b);
    let sep = null;
    for (let i = 1; i < ts.length; i++) sep = Math.max(sep || 0, (ts[i] - ts[i - 1]) / PVR_D);
    if (ts.length >= 2) r.aseos = { ok: sep <= PVR_ASEO_MAX_DIAS, mag: sep, txt: `${MOD_NF(sep, 1)} días máx. · ${ts.length} aseos` };
    else if (diasVentana > PVR_ASEO_MAX_DIAS) r.aseos = { ok: ts.length > 0, mag: diasVentana, txt: `${ts.length} aseo(s) en ${MOD_NF(diasVentana, 0)} días` };
    else r.aseos = { ok: null, mag: 0, txt: `${ts.length} aseo(s) · ventana de ${MOD_NF(diasVentana, 1)} días (no alcanza a medir 14)` };

    // 2. Corridas de Pony de 2 a 5 cocimientos seguidos.
    const corridas = [];
    let cur = null;
    cocs.forEach((c) => {
      if (pvrEsPony(c.mosto)) {
        if (!cur) corridas.push((cur = { n: 0, ini: c.ms, finUlt: c.fin, key: c.key }));
        cur.n++;
        cur.finUlt = Math.max(cur.finUlt, c.fin);
      } else cur = null;
    });
    const fuera = corridas.filter((x) => x.n < PVR_PONY_MIN || x.n > PVR_PONY_MAX);
    r.corridas = corridas.length
      ? { ok: !fuera.length, mag: fuera.length, txt: `${corridas.length} corrida(s): ${corridas.map((x) => x.n).join(", ")}${fuera.length ? ` · ${fuera.length} fuera de 2–5` : ""}`, ver: fuera[0] && fuera[0].key }
      : { ok: null, mag: 0, txt: "Sin Pony en la ventana" };

    // 3. Día de por medio (24 h) entre corridas de Pony: del fin del último
    //    cocimiento de una corrida al cargue de la siguiente (como el motor).
    const seps = corridas.slice(1).map((x, i) => ({ h: (x.ini - corridas[i].finUlt) / PVR_H, key: x.key }));
    const cortas = seps.filter((s) => s.h < PVR_PONY_SEP_H);
    r.sep24 = seps.length
      ? { ok: !cortas.length, mag: cortas.length, txt: `mín. ${MOD_NF(Math.min(...seps.map((s) => s.h)), 1)} h entre ${corridas.length} corridas${cortas.length ? ` · ${cortas.length} con menos de 24 h` : ""}`, ver: cortas[0] && cortas[0].key }
      : { ok: null, mag: 0, txt: corridas.length ? "Una sola corrida" : "Sin Pony en la ventana" };

    // 4. Arranque con cerveza (SLA 1): el primer cocimiento y el que viene
    //    después de 12 h o más sin cargues no deben ser Pony.
    const arranques = cocs.filter((c) => {
      const idx = todos.indexOf(c);
      const prev = idx > 0 ? todos[idx - 1] : null;
      return !prev || c.ms - prev.ms >= PVR_PARADA_H * PVR_H;
    });
    const conPony = arranques.filter((c) => pvrEsPony(c.mosto));
    r.arranque = arranques.length
      ? { ok: !conPony.length, mag: conPony.length, txt: `${arranques.length} arranque(s)${conPony.length ? ` · ${conPony.length} con Pony` : " · todos con cerveza"}`, ver: conPony[0] && conPony[0].key }
      : { ok: null, mag: 0, txt: "Sin arranques en la ventana" };

    // 5. Tope de Pony por semana (acuerdo R6): cocimientos × hL del catálogo.
    const hlPony = pvrHlCoc("pony") || 0;
    const porSem = {};
    cocs.filter((c) => pvrEsPony(c.mosto)).forEach((c) => (porSem[pvrLunes(c.ms)] = (porSem[pvrLunes(c.ms)] || 0) + hlPony));
    const max = Math.max(0, ...Object.values(porSem));
    r.topePony = { ok: max <= PVR_TOPE_PONY_SEMANA_HL, mag: max, txt: `${MOD_NF(max)} hL en la semana más alta (tope ${MOD_NF(PVR_TOPE_PONY_SEMANA_HL)})` };
    return r;
  };
  const sortTodos = (l) => [...l].sort((a, b) => a.ms - b.ms);
  const p = medir(planV, aseosPlan, sortTodos(planTodos));
  const q = medir(realV, aseosReal, sortTodos(realTodos));
  const nombres = {
    aseos: "Aseos con ≤ 14 días de separación",
    corridas: "Corridas de Pony de 2 a 5",
    sep24: "≥ 24 h entre corridas de Pony",
    arranque: "Arranque con cerveza (SLA 1)",
    topePony: "Tope de Pony por semana",
  };
  return Object.keys(nombres).map((k) => {
    const a = p[k];
    const b = q[k];
    let mejor = "—";
    if (a.ok === true && b.ok === false) mejor = "plan";
    else if (b.ok === true && a.ok === false) mejor = "real";
    else if (a.ok === false && b.ok === false) mejor = a.mag < b.mag ? "plan" : b.mag < a.mag ? "real" : "empate";
    else if (a.ok === true && b.ok === true) mejor = "empate";
    return { id: k, nombre: nombres[k], plan: a, real: b, mejor };
  });
}

// Cobertura del envasado (misma regla del motor, ver encabezado).
function pvrCobertura(src, planTodos, realTodos, mostos) {
  const grupos = new Map();
  src.cocF.forEach((r) => {
    if (!mostos.has(r.mostoId) || !r.deadline) return;
    const key = r.blockId != null ? `b${r.blockId}` : `${r.blockLabel}|${r.tren}|${r.deadline.getTime()}`;
    if (!grupos.has(key)) grupos.set(key, { key, mosto: r.mostoId, etiqueta: r.blockLabel || r.nombre || r.mostoId, tren: r.tren, codigo: r.codigo, deadline: r.deadline.getTime(), n: 0 });
    grupos.get(key).n++;
  });
  const bloques = [];
  const porMosto = {};
  grupos.forEach((g) => (porMosto[g.mosto] = porMosto[g.mosto] || []).push(g));
  const i0 = src.i0;
  Object.keys(porMosto).forEach((m) => {
    const cat = pvrCatalogo(m) || {};
    const procMs = ((Number(cat.tiempoCocinaHoras) || 0) + (Number(cat.tiempoFermentacionHoras) || 0) + (Number(cat.tiempoMaduracionHoras) || 0)) * PVR_H;
    const pl = planTodos.filter((c) => c.mosto === m).sort((a, b) => a.ms - b.ms);
    const re = realTodos.filter((c) => c.mosto === m && (i0 == null || c.ms >= i0)).sort((a, b) => a.ms - b.ms);
    let acum = 0;
    porMosto[m]
      .sort((a, b) => a.deadline - b.deadline)
      .forEach((g) => {
        acum += g.n;
        const limite = g.deadline - procMs;
        const cp = pl[acum - 1] || null;
        const cr = re[acum - 1] || null;
        bloques.push({
          ...g,
          acum,
          limite,
          plan: cp,
          real: cr,
          okPlan: !!cp && cp.ms <= limite + 60000,
          okReal: !!cr && cr.ms <= limite + 60000,
          retrasoPlanH: cp ? (cp.ms - limite) / PVR_H : null,
          retrasoRealH: cr ? (cr.ms - limite) / PVR_H : null,
          faltanReal: Math.max(0, acum - re.length),
          faltanPlan: Math.max(0, acum - pl.length),
        });
      });
  });
  bloques.sort((a, b) => a.deadline - b.deadline);
  return {
    bloques,
    realNoFeriaSi: bloques.filter((b) => !b.okReal && b.okPlan),
    feriaNoRealSi: bloques.filter((b) => b.okReal && !b.okPlan),
    ninguno: bloques.filter((b) => !b.okReal && !b.okPlan),
    enRiesgoReal: bloques.filter((b) => !b.okReal).length,
    enRiesgoPlan: bloques.filter((b) => !b.okPlan).length,
  };
}

// Discrepancias ordenadas por gravedad (3 alta · 2 media · 1 baja · 0 info).
function pvrDiscrepancias(res) {
  const d = [];
  const nom = (m) => pvrInfo(m).nombre;
  res.cobertura.bloques
    .filter((b) => !b.okReal)
    .forEach((b) =>
      d.push({
        sev: 3,
        tipo: "Envasado en riesgo",
        mosto: b.mosto,
        txt: `El real no alcanza a tener listo «${b.etiqueta}» (tren ${b.tren || "—"}, envasa ${pvrFmt(b.deadline)}).${b.okPlan ? " FerIA sí lo cubre." : " FerIA tampoco."}`,
        dato: b.real ? `${pvrFmtDesfase(b.retrasoRealH)} tarde` : `faltan ${b.faltanReal} coc.`,
        mag: b.real ? b.retrasoRealH : 1000 + b.faltanReal,
        // Se muestra el cocimiento del plan (está en la ventana) con su pareja real.
        ver: (b.plan && b.plan.key) || (b.real && b.real.key),
      }),
    );
  const porMosto = {};
  res.parejas.forEach((p) => {
    const o = (porMosto[p.mosto] = porMosto[p.mosto] || { falt: [], sobr: [] });
    if (p.plan && !p.real) o.falt.push(p);
    if (p.real && !p.plan) o.sobr.push(p);
  });
  Object.keys(porMosto).forEach((m) => {
    const o = porMosto[m];
    if (o.falt.length)
      d.push({ sev: 3, tipo: "Faltan en el real", mosto: m, txt: `El plan FerIA tiene ${o.falt.length} cocimiento(s) de ${nom(m)} más que el real en la ventana (desde el ${pvrFmt(o.falt[0].plan.ms)}).`, dato: `−${o.falt.length} coc.`, mag: o.falt.length, ver: o.falt[0].plan.key });
    if (o.sobr.length)
      d.push({ sev: 1, tipo: "Sobran en el real", mosto: m, txt: `El real tiene ${o.sobr.length} cocimiento(s) de ${nom(m)} más que el plan FerIA (desde el ${pvrFmt(o.sobr[0].real.ms)}).`, dato: `+${o.sobr.length} coc.`, mag: o.sobr.length, ver: o.sobr[0].real.key });
  });
  res.parejas
    .filter((p) => p.desfaseH != null && !p.dentro)
    .forEach((p) =>
      d.push({
        sev: Math.abs(p.desfaseH) > 2 * res.tol ? 3 : 2,
        tipo: "Desfase",
        mosto: p.mosto,
        txt: `${nom(p.mosto)} n.º ${p.k}: el real carga ${p.desfaseH > 0 ? "después" : "antes"} (plan ${pvrFmt(p.plan.ms)} · real ${pvrFmt(p.real.ms)}${p.real.x && p.real.x.n != null ? `, #${p.real.x.n}` : ""}).`,
        dato: pvrFmtDesfase(p.desfaseH),
        mag: Math.abs(p.desfaseH),
        ver: p.real.key,
      }),
    );
  res.reglas.forEach((r) => {
    if (r.real.ok === false) d.push({ sev: 2, tipo: "Regla (real)", txt: `${r.nombre}: el plan real no cumple — ${r.real.txt}.`, dato: "incumple", mag: r.real.mag, ver: r.real.ver });
    if (r.plan.ok === false) d.push({ sev: 1, tipo: "Regla (FerIA)", txt: `${r.nombre}: el plan FerIA no cumple — ${r.plan.txt}.`, dato: "incumple", mag: r.plan.mag, ver: r.plan.ver });
  });
  if (res.club.length)
    d.push({ sev: 0, tipo: "Solo en el real", mosto: "club", txt: `${res.club.length} cocimiento(s) de Club Colombia: no está en el catálogo de FerIA, así que no tiene pareja.`, dato: `${res.club.length} coc.`, mag: res.club.length, ver: res.club[0].key });
  return d.sort((a, b) => b.sev - a.sev || b.mag - a.mag);
}

/* ---------------------------------------------------------------- dibujo */

function renderPlanVsReal() {
  const cont = document.getElementById("planVsRealPanel");
  if (!cont) return;
  const src = pvrFuentes();
  const titulo = (sub) => `<div class="panel-head"><h3>Plan vs. real de cocinas</h3><span class="sub">${sub}</span></div>`;

  // Avisos claros si falta alguno de los dos planes.
  const faltan = [];
  if (!src.cocF.length)
    faltan.push(`<div class="pvr-falta"><b>Falta el plan FerIA.</b> Carga el plan de envasado y revisa el I0 en «Datos de entrada»: con eso FerIA calcula su plan de cocinas.<button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button></div>`);
  if (!src.real || !src.real.some((x) => x.tipo === "coc"))
    faltan.push(`<div class="pvr-falta"><b>Falta el plan real.</b> Carga el Excel «Programa_Cocinas.xlsx» del área de Cocinas en el módulo «Programa de cocinas (Excel)».<button class="btn small" data-goto="view-programa-cocinas">Ir a Programa de cocinas →</button></div>`);
  if (faltan.length) {
    cont.innerHTML = `<div class="panel">${titulo("Se necesitan los dos planes para comparar")}<div class="panel-body">${faltan.join("")}</div></div>`;
    return;
  }

  // Filtros: la ventana se reinicia cuando cambian los planes.
  const finFeria = Math.max(...src.cocF.map((r) => r.end.getTime()));
  const ini = src.i0 != null ? Math.min(src.i0, src.cocF[0].start.getTime()) : src.cocF[0].start.getTime();
  const firma = `${ini}|${finFeria}|${src.cocF.length}|${src.pc.archivo || ""}|${src.real.length}`;
  if (!PVR_F || PVR_F.firma !== firma) {
    const pr = pvrPrefs();
    const ids = [...PVR_MOSTOS.map((m) => m.id), "club"];
    PVR_F = {
      firma,
      ventana: [ini, finFeria],
      desde: ini,
      hasta: finFeria,
      mostos: new Set(Array.isArray(pr.mostos) && pr.mostos.some((m) => ids.includes(m)) ? pr.mostos.filter((m) => ids.includes(m)) : ids),
      tol: Number(pr.tol) > 0 ? Number(pr.tol) : 4,
      unidad: pr.unidad === "hl" ? "hl" : "coc",
    };
    PVR_SEL = null;
  }
  const res = calcularPlanVsReal(src, PVR_F);
  PVR_ULTIMO = res;

  const realCoc = src.real.filter((x) => x.tipo === "coc" && x.inicio != null);
  const rIni = Math.min(...realCoc.map((x) => x.inicio));
  const rFin = Math.max(...realCoc.map((x) => x.inicio));
  const sinReal = !res.realTodos.some((c) => c.ms >= PVR_F.desde && c.ms <= PVR_F.hasta);
  const avisoSolape = sinReal
    ? `<div class="pvr-falta"><b>El Excel real no tiene cocimientos en esta ventana.</b> Cubre del ${escapeHtml(pvrFmt(rIni))} de ${new Date(rIni).getUTCFullYear()} al ${escapeHtml(pvrFmt(rFin))} de ${new Date(rFin).getUTCFullYear()}; la ventana va del ${escapeHtml(pvrFmt(PVR_F.desde))} al ${escapeHtml(pvrFmt(PVR_F.hasta))}. Revisa el I0 o carga el programa de Cocinas de estas fechas.</div>`
    : "";

  cont.innerHTML = `
    <div class="panel">
      ${titulo(`FerIA: ${src.cocF.length} cocimientos desde el I0 · Real: ${escapeHtml(src.pc.archivo || "Excel")} (${realCoc.length.toLocaleString("es-CO")} cocimientos)`)}
      <div class="panel-body">
        ${pvrHtmlFiltros(res)}
        ${avisoSolape}
        <div class="acu-kpis pvr-kpis">${pvrHtmlKpis(res)}</div>
        <div class="pc-layout">
          <div class="acu-card">
            <div class="acu-card-tit">Línea de tiempo: plan FerIA arriba, real de Cocinas abajo <small class="pc-sub">· misma escala · cada punto es un cargue · la línea une las parejas (roja si el desfase pasa de ${MOD_NF(PVR_F.tol, 1)} h) · clic para ver el detalle</small></div>
            <div id="pvrLinea" class="pvr-linea"></div>
            ${pvrLeyenda()}
          </div>
          <div class="acu-card" id="pvrDetalle">${pvrHtmlDetalle(res)}</div>
        </div>
        <div class="vol-grid3 pvr-grid2">
          <div class="acu-card"><div class="acu-card-tit">Plan vs. real por semana
            <span class="pvr-seg">${[["coc", "Cocimientos"], ["hl", "hL"]].map(([v, l]) => `<button class="pc-chip ${PVR_F.unidad === v ? "on" : ""}" data-pvr-unidad="${v}">${l}</button>`).join("")}</span></div>
            <div id="pvrBarras" class="pc-chart"></div>
            <div class="legend pc-leyenda"><div class="item"><span class="sw pvr-sw-plan"></span>Plan FerIA (relleno)</div><div class="item"><span class="sw pvr-sw-real"></span>Real (rayado)</div>${PVR_F.unidad === "hl" && PVR_F.mostos.has("club") ? '<div class="item">Club Colombia no tiene hL de catálogo: solo se ve en «Cocimientos».</div>' : ""}</div>
          </div>
          <div class="acu-card"><div class="acu-card-tit">Por mosto y por semana <small class="pc-sub">· cocimientos y hL (cocimientos × hL del catálogo) · diferencia = real − plan</small></div>${pvrHtmlTablaSemanas(res)}</div>
        </div>
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Discrepancias (${res.discrepancias.length}) <small class="pc-sub">· de la más grave a la menos grave</small></div>
          ${pvrHtmlDiscrepancias(res)}
        </div>
        <div class="vol-grid3 pvr-grid2">
          <div class="acu-card"><div class="acu-card-tit">Secuencia de bloques <small class="pc-sub">· todas las marcas de la ventana</small></div>${pvrHtmlSecuencia(res)}</div>
          <div class="acu-card"><div class="acu-card-tit">Reglas de negocio lado a lado <small class="pc-sub">· medidas igual en los dos planes</small></div>${pvrHtmlReglas(res)}</div>
        </div>
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Cobertura del envasado <small class="pc-sub">· ¿cada bloque de envasado tiene su cerveza lista a tiempo? cargue a más tardar = primer envasado − maduración − fermentación − cocina (catálogo)</small></div>
          ${pvrHtmlCobertura(res)}
        </div>
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Todas las parejas (${res.parejas.length}) <small class="pc-sub">· n-ésimo cocimiento de cada mosto en el plan contra el n-ésimo en el real</small></div>
          ${pvrHtmlParejas(res)}
        </div>
      </div>
    </div>`;
  pvrDibujarLinea(res);
  pvrDibujarBarras(res);
  pvrConectar(res);
}

function pvrHtmlFiltros(res) {
  const f = PVR_F;
  const d2i = (ms) => new Date(ms).toISOString().slice(0, 10);
  const esVentana = f.desde === f.ventana[0] && f.hasta === f.ventana[1];
  return `<div class="pc-filtros pvr-filtros">
    <div class="pc-fgrupo"><span class="pc-flab">Rango</span>
      <button class="pc-chip ${esVentana ? "on" : ""}" data-pvr-ventana>I0 → último cocimiento FerIA</button>
      <input type="date" class="pc-fecha" id="pvrDesde" value="${d2i(f.desde)}" aria-label="Desde">
      <span class="pc-flab">a</span>
      <input type="date" class="pc-fecha" id="pvrHasta" value="${d2i(f.hasta)}" aria-label="Hasta">
      <span class="pc-sub">${escapeHtml(pvrFmt(f.desde))} → ${escapeHtml(pvrFmt(f.hasta))}</span>
    </div>
    <div class="pc-fgrupo"><span class="pc-flab">Mostos</span>
      ${[...PVR_MOSTOS, PVR_CLUB].map((m) => `<button class="pc-chip pc-chip-m ${f.mostos.has(m.id) ? "on" : ""}" data-pvr-mosto="${m.id}"><span class="pc-dot ${m.cls}"></span>${m.nombre}${m.id === "club" ? ' <small class="pc-sub">solo en el real</small>' : ""}</button>`).join("")}
      <span class="pc-flab" style="margin-left:10px;">Tolerancia X</span>
      <input type="number" class="pc-fecha pvr-tol" id="pvrTol" min="0.5" step="0.5" value="${f.tol}" aria-label="Tolerancia en horas"><span class="pc-sub">h · desfase aceptable para contar en la adherencia</span>
    </div>
  </div>`;
}

function pvrHtmlKpis(res) {
  const t = res.tot;
  const a = res.adherencia;
  const c = res.cobertura;
  const colAdh = a.pct == null ? null : a.pct >= 80 ? "var(--ok)" : a.pct >= 50 ? "var(--warn)" : "var(--danger)";
  return (
    modKpi("◉", "Cocimientos plan · real", `${MOD_NF(t.cocPlan)} <small>·</small> ${MOD_NF(t.cocReal)}`, `real − plan: ${pvrFmtDif(t.cocReal, t.cocPlan)}${t.club ? ` · +${t.club} de Club solo en el real` : ""}`) +
    modKpi("◍", "hL plan · real", `${MOD_NF(t.hlPlan)} <small>·</small> ${MOD_NF(t.hlReal)}`, `real − plan: ${pvrFmtDif(t.hlReal, t.hlPlan)} hL · hL del catálogo`) +
    modKpi("%", "Adherencia", a.pct == null ? "—" : `${MOD_NF(a.pct, 0)} <small>%</small>`, `${a.dentro} de ${a.base} cocimientos del plan con |desfase| ≤ ${MOD_NF(res.tol, 1)} h`, colAdh) +
    modKpi("⏱", "Desfase promedio", res.desfase.prom == null ? "—" : pvrFmtDesfase(res.desfase.prom), res.desfase.prom == null ? "Sin parejas" : `+ = el real arranca después · promedio sin signo ${pvrFmtDesfase(res.desfase.promAbs).replace(/^[+−±]/, "")}`) +
    modKpi("⚠", "Bloques de envasado en riesgo con el real", `${c.enRiesgoReal} <small>de ${c.bloques.length}</small>`, `no alcanzan a tener la cerveza lista · con FerIA: ${c.enRiesgoPlan}`, c.enRiesgoReal ? "var(--danger)" : "var(--ok)")
  );
}

function pvrLeyenda() {
  return `<div class="legend pc-leyenda">${[...PVR_MOSTOS, PVR_CLUB].map((m) => `<div class="item"><span class="sw ${m.cls}"></span>${m.nombre}</div>`).join("")}<div class="item"><span class="sw pc-aseo"></span>Aseo</div><div class="item"><span class="sw pc-paro"></span>Paro</div><div class="item"><span class="pvr-ley-solo"></span>Sin pareja</div><div class="item"><span class="pvr-ley-par"></span>Pareja dentro de X</div><div class="item"><span class="pvr-ley-par mal"></span>Pareja fuera de X</div></div>`;
}

// Línea de tiempo de doble carril (SVG). Etiquetas de carril fijas a la
// izquierda; el lienzo se desplaza si la ventana es larga.
function pvrDibujarLinea(res) {
  const cont = document.getElementById("pvrLinea");
  if (!cont) return;
  const ancho = Math.max(600, cont.clientWidth - 112);
  const horas = Math.max(1, (res.hasta - res.desde) / PVR_H);
  const pxH = Math.max(6, (ancho - 20) / horas);
  const W = Math.ceil(horas * pxH + 20);
  const x = (ms) => 10 + ((ms - res.desde) / PVR_H) * pxH;
  const ejeH = 34;
  const carril = 64;
  const hueco = 46;
  const yP = ejeH;
  const yR = ejeH + carril + hueco;
  const H = yR + carril + 8;
  const cP = yP + carril / 2;
  const cR = yR + carril / 2;
  const s = [];
  s.push(`<defs><pattern id="pcRayado" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--pc-neutro)"></rect></pattern></defs>`);
  // Días y horas.
  for (let d = Math.floor(res.desde / PVR_D) * PVR_D; d <= res.hasta; d += PVR_D) {
    for (let h = 6; h < 24 && pxH * 6 >= 26; h += 6) {
      const t = d + h * PVR_H;
      if (t < res.desde || t > res.hasta) continue;
      s.push(`<line class="pc-grid pvr-grid-h" x1="${x(t)}" y1="${ejeH - 6}" x2="${x(t)}" y2="${H - 8}"></line><text class="pc-ax" x="${x(t) + 3}" y="${ejeH - 8}">${String(h).padStart(2, "0")}</text>`);
    }
    if (d < res.desde) continue;
    const dt = new Date(d);
    const finde = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
    s.push(`<rect class="${finde ? "pc-finde" : "pvr-nada"}" x="${x(d)}" y="${ejeH}" width="${24 * pxH}" height="${H - ejeH - 8}"></rect>`);
    s.push(`<line class="pc-sem" x1="${x(d)}" y1="4" x2="${x(d)}" y2="${H - 8}"></line><text class="pc-ax ${dt.getUTCDay() === 1 ? "pc-lunes" : ""}" x="${x(d) + 4}" y="14">${escapeHtml(fmtDate(dt))}</text>`);
  }
  // Fondo de carriles.
  s.push(`<rect class="pvr-carril" x="0" y="${yP + 4}" width="${W}" height="${carril - 8}"></rect><rect class="pvr-carril" x="0" y="${yR + 4}" width="${W}" height="${carril - 8}"></rect>`);
  // I0.
  if (res.desde === PVR_F.ventana[0]) s.push(`<line class="pvr-i0" x1="${x(res.desde)}" y1="${ejeH - 4}" x2="${x(res.desde)}" y2="${H - 8}"></line><text class="pc-ax pvr-i0-t" x="${x(res.desde) + 4}" y="${ejeH - 20}">I0</text>`);
  // Aseos (plan) y aseos/paros (real).
  res.aseosPlan.forEach((a) => s.push(`<rect class="pc-ev pc-aseo" x="${x(a.ms)}" y="${yP + 8}" width="${Math.max(2, x(Math.min(a.fin, res.hasta)) - x(a.ms))}" height="${carril - 16}" data-pvr-tip="${escapeHtml(`Aseo FerIA · ${pvrFmt(a.ms)} → ${pvrFmt(a.fin)}`)}"></rect>`));
  res.eventosReal.forEach((e) => {
    const cls = e.id === "paro" ? "pc-paro" : e.id === "propagador" ? "pc-prop" : "pc-aseo";
    const a = Math.max(e.ms, res.desde);
    s.push(`<rect class="pc-ev ${cls}" x="${x(a)}" y="${yR + 8}" width="${Math.max(2, x(Math.min(e.fin, res.hasta)) - x(a))}" height="${carril - 16}" data-pvr-tip="${escapeHtml(`${e.nombre} · ${pvrFmt(e.ms)} → ${pvrFmt(e.fin)}`)}"></rect>`);
  });
  // Líneas de pareja.
  res.parejas
    .filter((p) => p.plan && p.real)
    .forEach((p) => s.push(`<line class="pvr-par ${p.dentro ? "" : "mal"} ${PVR_SEL && (PVR_SEL === p.plan.key || PVR_SEL === p.real.key) ? "sel" : ""}" x1="${x(p.plan.ms)}" y1="${cP + 7}" x2="${x(p.real.ms)}" y2="${cR - 7}"></line>`));
  // Cargues.
  const punto = (c, cy) => {
    const solo = c.mosto === "club" || !c.par || !c.par.plan || !c.par.real;
    return `<circle class="pc-pt ${pvrInfo(c.mosto).cls} ${solo ? "pvr-solo" : ""} ${PVR_SEL === c.key ? "pc-selm" : ""}" cx="${x(c.ms)}" cy="${cy}" r="6" data-pvr-key="${c.key}"></circle>`;
  };
  res.plan.forEach((c) => s.push(punto(c, cP)));
  res.real.forEach((c) => s.push(punto(c, cR)));
  const etiquetas = `<div class="pvr-lab" style="height:${ejeH}px"></div><div class="pvr-lab" style="height:${carril}px"><b>Plan FerIA</b><small>${res.plan.length} cargues</small></div><div class="pvr-lab pvr-lab-h" style="height:${hueco}px"><small>parejas</small></div><div class="pvr-lab" style="height:${carril}px"><b>Real (Cocinas)</b><small>${res.real.length} cargues</small></div>`;
  cont.innerHTML = `<div class="pvr-tl"><div class="pvr-labs">${etiquetas}</div><div class="pvr-svgwrap" id="pvrSvgWrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="pvr-svg">${s.join("")}</svg></div></div>`;
  // Centrar lo elegido si existe.
  if (PVR_SEL) {
    const sel = [...res.plan, ...res.real].find((c) => c.key === PVR_SEL);
    const wrap = document.getElementById("pvrSvgWrap");
    if (sel && wrap) wrap.scrollLeft = Math.max(0, x(sel.ms) - wrap.clientWidth / 2);
  }
}

// Barras agrupadas por semana: plan (relleno) y real (rayado) por mosto.
function pvrDibujarBarras(res) {
  const cont = document.getElementById("pvrBarras");
  if (!cont) return;
  const hl = PVR_F.unidad === "hl";
  const mostos = [...PVR_MOSTOS.map((m) => m.id), "club"].filter((m) => res.mostos.has(m) && !(hl && m === "club"));
  const val = (o, lado) => (hl ? o[lado === "plan" ? "hlPlan" : "hlReal"] || 0 : o[lado]);
  const max = Math.max(1, ...res.semanas.flatMap((w) => mostos.flatMap((m) => [val(w.mostos[m], "plan"), val(w.mostos[m], "real")])));
  const W = Math.max(320, cont.clientWidth || 520);
  const H = 230;
  const top = 18;
  const bot = 36;
  const left = 46;
  const gw = (W - left - 8) / Math.max(1, res.semanas.length);
  const bw = Math.max(4, Math.min(22, (gw - 18) / Math.max(1, mostos.length * 2)));
  const y = (v) => top + (H - top - bot) * (1 - v / max);
  const s = [`<defs>${mostos.map((m) => `<pattern id="pvrRay-${m}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="pvr-ray-fondo"></rect><rect width="2.2" height="5" class="${pvrInfo(m).cls}"></rect></pattern>`).join("")}</defs>`];
  // Rejilla.
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    s.push(`<line class="pc-grid" x1="${left}" y1="${y(v)}" x2="${W - 4}" y2="${y(v)}"></line><text class="pc-ax" x="${left - 6}" y="${y(v) + 3}" text-anchor="end">${MOD_NF(v)}</text>`);
  }
  res.semanas.forEach((w, i) => {
    const gx = left + i * gw + (gw - mostos.length * 2 * bw - (mostos.length - 1) * 4) / 2;
    mostos.forEach((m, j) => {
      const o = w.mostos[m];
      const bx = gx + j * (2 * bw + 4);
      [["plan", 0], ["real", 1]].forEach(([lado, k]) => {
        const v = val(o, lado);
        if (m === "club" && lado === "plan") return;
        const yy = y(v);
        const tip = `${pvrInfo(m).nombre} · semana del ${fmtDate(new Date(w.semana))} · ${lado === "plan" ? "Plan FerIA" : "Real"}: ${MOD_NF(o[lado])} coc.${o.hlPlan != null ? ` · ${MOD_NF(lado === "plan" ? o.hlPlan : o.hlReal)} hL` : ""}`;
        s.push(`<rect class="${lado === "plan" ? pvrInfo(m).cls : "pvr-barra-real"}" ${lado === "real" ? `fill="url(#pvrRay-${m})" stroke="var(--pc-c${pvrInfo(m).cls.slice(-1)})"` : ""} x="${bx + k * bw}" y="${yy}" width="${bw - 1}" height="${Math.max(0, H - bot - yy)}" rx="1.5" data-pvr-tip="${escapeHtml(tip)}"></rect>`);
        if (v > 0 && bw >= 9) s.push(`<text class="pc-ax pvr-bv" x="${bx + k * bw + (bw - 1) / 2}" y="${yy - 3}" text-anchor="middle">${hl ? MOD_NF(v / 1000, 1) + "k" : MOD_NF(v)}</text>`);
      });
    });
    s.push(`<text class="pc-ax" x="${left + i * gw + gw / 2}" y="${H - bot + 16}" text-anchor="middle">Sem. ${typeof pcSemanaIso === "function" ? pcSemanaIso(w.semana) : ""} · ${escapeHtml(fmtDate(new Date(w.semana)))}</text>`);
  });
  s.push(`<text class="pc-ax" x="${left}" y="10">${hl ? "hL (catálogo)" : "cocimientos"}</text>`);
  cont.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s.join("")}</svg>`;
}

function pvrHtmlTablaSemanas(res) {
  const mostos = [...PVR_MOSTOS.map((m) => m.id), "club"].filter((m) => res.mostos.has(m));
  const celda = (o) => {
    const dif = o.real - o.plan;
    const cls = dif > 0 ? "pvr-mas" : dif < 0 ? "pvr-menos" : "";
    return `<td class="num"><b>${MOD_NF(o.plan)}</b> → <b>${MOD_NF(o.real)}</b> <span class="${cls}">${pvrFmtDif(o.real, o.plan)}</span>${o.hlPlan != null ? `<br><small class="pc-sub">${MOD_NF(o.hlPlan)} → ${MOD_NF(o.hlReal)} hL</small>` : '<br><small class="pc-sub">sin hL de catálogo</small>'}</td>`;
  };
  const filas = mostos
    .map((m) => {
      const t = res.porMosto[m];
      return `<tr><td><span class="pc-dot ${pvrInfo(m).cls}"></span>${escapeHtml(pvrInfo(m).nombre)}</td>${res.semanas.map((w) => celda(w.mostos[m])).join("")}${celda(t)}</tr>`;
    })
    .join("");
  return `<div class="table-scroll mod-noclip"><table class="acu-tabla pvr-tsem"><thead><tr><th>Mosto</th>${res.semanas.map((w) => `<th class="num">Semana del ${escapeHtml(fmtDate(new Date(w.semana)))}<br><small class="pc-sub">plan → real (dif.)</small></th>`).join("")}<th class="num">Total ventana</th></tr></thead><tbody>${filas}</tbody></table></div>`;
}

function pvrHtmlDiscrepancias(res) {
  if (!res.discrepancias.length) return '<p class="empty-note">Sin discrepancias: el real sigue al plan FerIA dentro de la tolerancia.</p>';
  const sev = ["Info", "Baja", "Media", "Alta"];
  return `<div class="table-scroll" style="max-height:360px;"><table class="acu-tabla pvr-disc"><thead><tr><th>Gravedad</th><th>Tipo</th><th>Qué pasa</th><th class="num">Dato</th><th></th></tr></thead><tbody>${res.discrepancias
    .map(
      (d) => `<tr><td><span class="pvr-sev pvr-sev${d.sev}">${sev[d.sev]}</span></td><td class="rec-imp">${d.mosto ? `<span class="pc-dot ${pvrInfo(d.mosto).cls}"></span>` : ""}${escapeHtml(d.tipo)}</td><td class="rec-imp">${escapeHtml(d.txt)}</td><td class="num">${escapeHtml(d.dato)}</td><td>${d.ver ? `<button class="btn small" data-pvr-ver="${d.ver}">Ver</button>` : ""}</td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}

function pvrHtmlSecuencia(res) {
  const lado = (titulo, sq) => `
    <div class="pvr-seq">
      <div class="pvr-seq-t"><b>${titulo}</b><span>${sq.cambiosMarca} cambio(s) de marca · ${sq.cambiosPony} Pony↔cerveza · ${sq.aseos} aseo(s)${sq.sepMaxDias != null ? ` · separación máx. ${MOD_NF(sq.sepMaxDias, 1)} días` : ""}</span></div>
      <div class="pvr-chips">${
        sq.chips.length
          ? sq.chips
              .map((c, i) =>
                c.tipo === "aseo"
                  ? `<span class="pvr-chip pvr-chip-aseo" title="Aseo · ${escapeHtml(pvrFmt(c.ms))}">▨ aseo</span>`
                  : `<span class="pvr-chip" ${c.key ? `data-pvr-ver="${c.key}"` : ""} title="${escapeHtml(pvrInfo(c.mosto).nombre)} desde ${escapeHtml(pvrFmt(c.ms))}"><span class="pc-dot ${pvrInfo(c.mosto).cls}"></span>${escapeHtml(pvrInfo(c.mosto).nombre.replace(" (GO + HG)", ""))} ×${c.n}</span>`,
              )
              .join('<span class="pvr-flecha">›</span>')
          : '<span class="pc-sub">Sin cocimientos en la ventana.</span>'
      }</div>
    </div>`;
  return lado("Plan FerIA", res.secuencia.plan) + lado("Real (Cocinas)", res.secuencia.real);
}

function pvrHtmlReglas(res) {
  const ico = (ok) => (ok === true ? '<span class="pvr-ok">✓</span>' : ok === false ? '<span class="pvr-no">✗</span>' : '<span class="pc-sub">n/a</span>');
  const mejor = { plan: "Plan FerIA", real: "Real", empate: "Empate", "—": "—" };
  return `<table class="acu-tabla pvr-reglas"><thead><tr><th>Regla</th><th>Plan FerIA</th><th>Real (Cocinas)</th><th>Cumple mejor</th></tr></thead><tbody>${res.reglas
    .map(
      (r) => `<tr><td class="rec-imp"><b>${escapeHtml(r.nombre)}</b></td><td class="rec-imp">${ico(r.plan.ok)} ${escapeHtml(r.plan.txt)}${r.plan.ver ? ` <button class="pc-mini" data-pvr-ver="${r.plan.ver}">ver</button>` : ""}</td><td class="rec-imp">${ico(r.real.ok)} ${escapeHtml(r.real.txt)}${r.real.ver ? ` <button class="pc-mini" data-pvr-ver="${r.real.ver}">ver</button>` : ""}</td><td class="rec-imp"><b class="pvr-mejor-${r.mejor}">${mejor[r.mejor]}</b></td></tr>`,
    )
    .join("")}</tbody></table><p class="acu-nota">Arranque = primer cocimiento o el que llega después de ${PVR_PARADA_H} h o más sin cargues. Tope de Pony = cocimientos de Pony × hL del catálogo en la semana calendario.</p>`;
}

function pvrHtmlCobertura(res) {
  const c = res.cobertura;
  if (!c.bloques.length) return '<p class="empty-note">No hay bloques de envasado con fecha en el plan FerIA para los mostos elegidos.</p>';
  const estado = (ok, ret, falt) => (ok ? `<span class="pvr-ok">✓ a tiempo</span>${ret != null ? ` <small class="pc-sub">${pvrFmtDesfase(ret)}</small>` : ""}` : falt ? `<span class="pvr-no">✗ faltan ${falt} coc.</span>` : `<span class="pvr-no">✗ ${pvrFmtDesfase(ret)} tarde</span>`);
  const orden = [...c.bloques].sort((a, b) => (a.okReal === b.okReal ? a.deadline - b.deadline : a.okReal ? 1 : -1));
  const lista = (titulo, l) => `<div class="pvr-cob-l"><b>${titulo}</b><span>${l.length ? l.map((b) => escapeHtml(b.etiqueta)).join(" · ") : "ninguno"}</span></div>`;
  return `
    <div class="pvr-cob-res">
      ${lista(`El real NO cubre a tiempo y FerIA sí (${c.realNoFeriaSi.length})`, c.realNoFeriaSi)}
      ${lista(`FerIA no cubre y el real sí (${c.feriaNoRealSi.length})`, c.feriaNoRealSi)}
      ${lista(`Ninguno de los dos cubre (${c.ninguno.length})`, c.ninguno)}
    </div>
    <div class="table-scroll" style="max-height:340px;"><table class="acu-tabla pvr-cob"><thead><tr><th>Bloque de envasado</th><th>Tren</th><th>Primer envasado</th><th class="num">Coc. acumulados</th><th>Cargue a más tardar</th><th>Plan FerIA</th><th>Real</th><th></th></tr></thead><tbody>${orden
      .map(
        (b) => `<tr class="${b.okReal ? "" : "pvr-fila-riesgo"}"><td class="rec-imp"><span class="pc-dot ${pvrInfo(b.mosto).cls}"></span>${escapeHtml(b.etiqueta)}</td><td>${escapeHtml(String(b.tren || "—"))}</td><td>${escapeHtml(pvrFmt(b.deadline))}</td><td class="num">${b.acum}</td><td>${escapeHtml(pvrFmt(b.limite))}</td><td>${estado(b.okPlan, b.retrasoPlanH, b.faltanPlan)}</td><td>${estado(b.okReal, b.retrasoRealH, b.faltanReal)}</td><td>${(b.plan || b.real) ? `<button class="btn small" data-pvr-ver="${(b.plan || b.real).key}">Ver</button>` : ""}</td></tr>`,
      )
      .join("")}</tbody></table></div>
    <p class="acu-nota">Se asume que los cocimientos reales de cada mosto, contados desde el I0 y en orden, alimentan los mismos bloques que el plan FerIA. El tiempo entre paréntesis es la holgura (− = llegó antes del límite).</p>`;
}

function pvrHtmlParejas(res) {
  const filas = res.parejas
    .map((p) => {
      const key = (p.real || p.plan).key;
      const d = p.desfaseH;
      const cls = d == null ? "" : p.dentro ? "pvr-ok" : "pvr-no";
      const hl = pvrHlCoc(p.mosto);
      return `<tr class="pvr-fila ${PVR_SEL && (PVR_SEL === (p.plan && p.plan.key) || PVR_SEL === (p.real && p.real.key)) ? "pvr-fila-sel" : ""}" data-pvr-ver="${key}">
        <td class="num">${p.real && p.real.x.n != null ? "#" + p.real.x.n : "—"}</td>
        <td><span class="pc-dot ${pvrInfo(p.mosto).cls}"></span>${escapeHtml(pvrInfo(p.mosto).nombre)} <small class="pc-sub">n.º ${p.k}</small></td>
        <td>${p.plan ? escapeHtml(pvrFmt(p.plan.ms)) : '<span class="pvr-no">sin plan (sobra en el real)</span>'}</td>
        <td>${p.real ? escapeHtml(pvrFmt(p.real.ms)) : '<span class="pvr-no">sin real (falta)</span>'}${p.real && p.real.x.equipo ? ` <small class="pc-sub">· ${escapeHtml(p.real.x.equipo)}</small>` : ""}</td>
        <td class="num"><span class="${cls}">${pvrFmtDesfase(d)}</span></td>
        <td class="num">${hl != null ? MOD_NF(hl) : "—"}</td></tr>`;
    })
    .join("");
  const club = res.club
    .map((c) => `<tr class="pvr-fila" data-pvr-ver="${c.key}"><td class="num">${c.x.n != null ? "#" + c.x.n : "—"}</td><td><span class="pc-dot pc-c6"></span>Club Colombia <small class="pc-sub">solo en el real</small></td><td>—</td><td>${escapeHtml(pvrFmt(c.ms))}</td><td class="num">—</td><td class="num">—</td></tr>`)
    .join("");
  return `<div class="table-scroll" style="max-height:420px;"><table class="acu-tabla pvr-pares"><thead><tr><th class="num">N.º real</th><th>Mosto</th><th>Cargue plan</th><th>Cargue real</th><th class="num">Desfase</th><th class="num">hL</th></tr></thead><tbody>${filas}${club}</tbody></table></div>`;
}

function pvrHtmlDetalle(res) {
  // Primero en la ventana filtrada; si no está (p. ej. un «Ver» de cobertura con
  // un cocimiento real posterior a la ventana), en todos los de ese lado.
  const todos = [...res.plan, ...res.real, ...res.planTodos, ...res.realTodos];
  const c = PVR_SEL ? todos.find((x) => x.key === PVR_SEL) : null;
  if (!c)
    return `<div class="acu-card-tit">Detalle</div><p class="empty-note">Haz clic en un cargue de la línea de tiempo, en una fila de las tablas o en «Ver» para comparar el plan y el real de ese cocimiento.</p>`;
  const par = c.par || null;
  const enVentana = res.plan.includes(c) || res.real.includes(c);
  const p = par ? par.plan : c.lado === "plan" ? c : null;
  const r = par ? par.real : c.lado === "real" ? c : null;
  const fila = (k, v) => (v == null || v === "" ? "" : `<div class="pc-dl"><span>${k}</span><b>${v}</b></div>`);
  const nota = (nn) => {
    const v = nn.tipo === "fecha" ? pvrFmt(nn.v) : nn.tipo === "duracion" && typeof fmtHM === "function" ? fmtHM(nn.v) + " h" : nn.tipo === "numero" ? MOD_NF(nn.v, Number.isInteger(nn.v) ? 0 : 2) : escapeHtml(String(nn.v));
    return `<div class="pc-nota"><span class="pc-col">${nn.col}</span><div>${v}</div></div>`;
  };
  const m = pvrInfo(c.mosto);
  const d = par ? par.desfaseH : null;
  const ladoPlan = p
    ? `${fila("Cargue", escapeHtml(pvrFmt(p.ms)))}${fila("Fin de cocina", escapeHtml(pvrFmt(p.fin)))}${fila("Bloque", escapeHtml(p.row.blockLabel || "—"))}${fila("Tren", escapeHtml(String(p.row.tren || "—")))}${fila("Primer envasado", escapeHtml(pvrFmt(p.row.deadline && p.row.deadline.getTime())))}${p.row.violaDeadline ? fila("Ojo", '<span class="pvr-no">FerIA también llega tarde a este bloque</span>') : ""}`
    : `<p class="empty-note">${c.mosto === "club" ? "Club Colombia no está en el catálogo de FerIA." : !enVentana ? "Este cocimiento está fuera de la ventana de comparación: no tiene pareja." : "El plan FerIA no tiene este cocimiento: sobra en el real."}</p>`;
  const x = r ? r.x : null;
  const ladoReal = r
    ? `${fila("N.º", x.n != null ? "#" + x.n : "—")}${fila("Cargue (D)", escapeHtml(pvrFmt(r.ms)))}${fila("Fin (F)", escapeHtml(pvrFmt(x.fin)))}${fila("Equipo destino (G)", x.equipo ? `${escapeHtml(x.equipo)} <small class="pc-sub">· ${escapeHtml(x.grupo || "")}</small>` : "—")}${x.lev ? fila("Levadura", escapeHtml(`${x.lev.tanque}${x.lev.lote ? " · lote " + x.lev.lote : ""}`)) : ""}${x.ef && x.ef.volFrio != null ? fila("Mosto frío (EFICIENCIAS)", MOD_NF(x.ef.volFrio) + " hL") : ""}${fila("Texto en el Excel", escapeHtml(x.texto))}
       <div class="pc-sec">Notas del Excel</div>${x.notas && x.notas.length ? x.notas.map(nota).join("") : '<p class="empty-note">Sin anotaciones.</p>'}${x.comentarios && x.comentarios.length ? x.comentarios.map((cm) => `<div class="pc-nota"><span class="pc-col">${cm.col}</span><div>${escapeHtml(cm.txt)}</div></div>`).join("") : ""}
       <button class="btn small pvr-ir-pc" data-pvr-pc="${r.i}" data-goto="view-programa-cocinas">Abrir en Programa de cocinas →</button>`
    : `<p class="empty-note">${!enVentana ? "Este cocimiento está fuera de la ventana de comparación: no tiene pareja." : "El real no tiene este cocimiento en la ventana: falta."}</p>`;
  return `<div class="acu-card-tit pc-det-tit"><span class="pc-dot ${m.cls}"></span>${escapeHtml(m.nombre)}${par ? ` · n.º ${par.k}` : ""}</div>
    <div class="pvr-desf ${d == null ? "" : par.dentro ? "ok" : "mal"}"><span>Desfase de arranque</span><b>${pvrFmtDesfase(d)}</b><small>${d == null ? (enVentana ? "sin pareja" : "fuera de la ventana") : d > 0 ? "el real arranca después" : d < 0 ? "el real arranca antes" : "a la misma hora"} · tolerancia ±${MOD_NF(PVR_F.tol, 1)} h</small></div>
    <div class="pc-sec">Plan FerIA</div>${ladoPlan}
    <div class="pc-sec">Real (Cocinas)</div>${ladoReal}`;
}

/* --------------------------------------------------------------- eventos */

function pvrSeleccionar(key) {
  PVR_SEL = key;
  const res = PVR_ULTIMO;
  if (!res) return;
  const det = document.getElementById("pvrDetalle");
  if (det) det.innerHTML = pvrHtmlDetalle(res);
  pvrDibujarLinea(res);
  document.querySelectorAll(".pvr-pares .pvr-fila").forEach((tr) => {
    const c = [...res.plan, ...res.real].find((z) => z.key === tr.dataset.pvrVer);
    const par = c && c.par;
    tr.classList.toggle("pvr-fila-sel", tr.dataset.pvrVer === key || !!(par && ((par.plan && par.plan.key === key) || (par.real && par.real.key === key))));
  });
  pvrConectarLinea();
  pvrConectarDetalle();
}

function pvrConectarLinea() {
  const svg = document.querySelector("#pvrLinea svg");
  if (!svg) return;
  const res = PVR_ULTIMO;
  svg.addEventListener("click", (e) => {
    const k = e.target.getAttribute && e.target.getAttribute("data-pvr-key");
    if (k) pvrSeleccionar(k);
  });
  svg.addEventListener("mousemove", (e) => {
    const k = e.target.getAttribute && e.target.getAttribute("data-pvr-key");
    const tip = e.target.getAttribute && e.target.getAttribute("data-pvr-tip");
    if (k) {
      const c = [...res.plan, ...res.real].find((z) => z.key === k);
      if (!c) return;
      const par = c.par;
      const lineas = [{ v: pvrFmt(c.ms), l: c.lado === "plan" ? "cargue plan FerIA" : "cargue real", cls: pvrInfo(c.mosto).cls }];
      if (par && par.plan && par.real) lineas.push({ v: pvrFmt(c.lado === "plan" ? par.real.ms : par.plan.ms), l: c.lado === "plan" ? "cargue real" : "cargue plan" }, { v: pvrFmtDesfase(par.desfaseH), l: "desfase" });
      else lineas.push({ v: c.mosto === "club" ? "solo en el real" : c.lado === "plan" ? "falta en el real" : "sobra en el real", l: "" });
      if (c.lado === "real" && c.x.equipo) lineas.push({ v: c.x.equipo, l: "equipo" });
      pcMostrarTip(e, `${pvrInfo(c.mosto).nombre}${par ? " n.º " + par.k : ""}${c.lado === "real" && c.x.n != null ? " · #" + c.x.n : ""}`, lineas);
    } else if (tip) pcMostrarTip(e, tip, []);
    else pcOcultarTip();
  });
  svg.addEventListener("mouseleave", pcOcultarTip);
}

function pvrConectarDetalle() {
  document.querySelectorAll("#pvrDetalle [data-pvr-pc]").forEach((b) =>
    b.addEventListener("click", () => {
      // Deja elegido ese cocimiento en el módulo del Excel (antes de que el
      // clic llegue al menú y abra la vista).
      const i = Number(b.dataset.pvrPc);
      const x = PC && PC.filas[i];
      if (!x) return;
      if (!PC_F) PC_F = pcFiltrosIniciales();
      const dia = medianocheMs(new Date(x.inicio));
      if (x.inicio < PC_F.desde || x.inicio >= PC_F.hasta) {
        PC_F.desde = Math.max(PC_F.min, dia - 3 * PVR_D);
        PC_F.hasta = Math.min(PC_F.max, dia + 4 * PVR_D);
      }
      PC_SEL = i;
    }),
  );
}

function pvrConectar(res) {
  const re = () => renderPlanVsReal();
  const cont = document.getElementById("planVsRealPanel");
  cont.querySelectorAll("[data-pvr-mosto]").forEach((b) =>
    b.addEventListener("click", () => {
      const m = b.dataset.pvrMosto;
      if (PVR_F.mostos.has(m)) {
        if (PVR_F.mostos.size > 1) PVR_F.mostos.delete(m);
      } else PVR_F.mostos.add(m);
      pvrGuardarPrefs();
      re();
    }),
  );
  const tol = document.getElementById("pvrTol");
  if (tol)
    tol.addEventListener("change", () => {
      const v = Number(tol.value);
      if (v > 0) {
        PVR_F.tol = v;
        pvrGuardarPrefs();
      }
      re();
    });
  const desde = document.getElementById("pvrDesde");
  const hasta = document.getElementById("pvrHasta");
  if (desde)
    desde.addEventListener("change", () => {
      const v = Date.parse(desde.value + "T00:00:00Z");
      if (isFinite(v) && v < PVR_F.hasta) PVR_F.desde = v;
      re();
    });
  if (hasta)
    hasta.addEventListener("change", () => {
      const v = Date.parse(hasta.value + "T00:00:00Z") + PVR_D - 60000;
      if (isFinite(v) && v > PVR_F.desde) PVR_F.hasta = v;
      re();
    });
  const ven = cont.querySelector("[data-pvr-ventana]");
  if (ven)
    ven.addEventListener("click", () => {
      PVR_F.desde = PVR_F.ventana[0];
      PVR_F.hasta = PVR_F.ventana[1];
      re();
    });
  cont.querySelectorAll("[data-pvr-unidad]").forEach((b) =>
    b.addEventListener("click", () => {
      PVR_F.unidad = b.dataset.pvrUnidad;
      pvrGuardarPrefs();
      re();
    }),
  );
  // «Ver»: elige el cocimiento, lo muestra en la línea de tiempo y sube a ella.
  // El contenedor sobrevive a cada repintado: el oyente se pone una sola vez.
  if (!cont.dataset.pvrDelegado) {
    cont.dataset.pvrDelegado = "1";
    cont.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pvr-ver]");
      if (!b) return;
      pvrSeleccionar(b.dataset.pvrVer);
      if (b.tagName !== "TR") {
        const tl = document.getElementById("pvrLinea");
        if (tl) tl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
  const barras = document.querySelector("#pvrBarras svg");
  if (barras) {
    barras.addEventListener("mousemove", (e) => {
      const t = e.target.getAttribute && e.target.getAttribute("data-pvr-tip");
      if (t) pcMostrarTip(e, t, []);
      else pcOcultarTip();
    });
    barras.addEventListener("mouseleave", pcOcultarTip);
  }
  pvrConectarLinea();
  pvrConectarDetalle();
}
