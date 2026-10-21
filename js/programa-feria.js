/* =========================================================================
   PROGRAMA DE COCINAS (FerIA) — el plan que FerIA genera desde el
   instructivo de envasado, con las mismas gráficas que el Excel de
   Elaboración (js/programa-cocinas.js).

   Dos escenarios:
   · «Plan actual»: el de todo FerIA, desde el I0 y descontando el
     inventario del Producto en proceso.
   · «Plan completo hacia atrás»: qué había que cocinar, y cuándo, para que
     TODO el instructivo —también lo que se está envasando hoy— se pueda
     envasar a tiempo. Se calcula como si no hubiera inventario y con el I0
     lo bastante atrás para que todo cocimiento alcance su envasado. La
     parte anterior al I0 es el «plan pasado»: se compara con lo que el
     Programa de Cocinas real cocinó en esas mismas fechas.
   Nada de esto cambia el plan de FerIA ni el resto de módulos: el
   escenario hacia atrás se calcula aparte y se descarta al terminar.
   ========================================================================= */

const PF_MOSTOS = [
  { id: "estandar", nombre: "Estándar", cls: "pc-c1" },
  { id: "pilsen", nombre: "Pilsen", cls: "pc-c2" },
  { id: "light", nombre: "Light", cls: "pc-c3" },
  { id: "pony", nombre: "Pony", cls: "pc-c4" },
];
const PF_EVENTOS = [
  { id: "aseo", nombre: "Aseo", cls: "pc-aseo" },
  { id: "paro", nombre: "Cocina sin cargar", cls: "pc-paro" },
];
const PF_GRUPOS = ["FV EXT", "FV 309", "FV 310", "SV Pony", "Sin tanque"];
// Horas sin nada en la cocina a partir de las cuales se marca «sin cargar».
const PF_HUECO_H = 2;
// Para el plan hacia atrás: días antes del primer envasado desde los que se
// deja programar (más que el proceso más largo + adelanto + llenado de FV).
const PF_DIAS_ATRAS = 18;

// Adelanto extra que se le permite a la cerveza en el plan hacia atrás (ver
// pfCalcularHaciaAtras). Se usa solo mientras se calcula ese escenario.
let ENGINE_ADELANTO_EXTRA_DIAS = 0;
// Con los 2 días normales (3 en Light) el plan hacia atrás tiene que cocinar
// en la última semana de octubre también la Pilsen que hoy ya está en
// tanques, y 49 cocimientos salían tarde. En la planta esa cerveza se cocinó
// con más anticipación: con 4 días extra (cerveza hasta 6 días antes, Light
// 7) ninguno llega tarde con los archivos del 20/10.
let PF_ADELANTO_ATRAS_DIAS = 4;
const PCX_FERIA = { fuente: "feria", D: null, F: null, SEL: null, PAG: 0, escenario: "actual", cache: {} };

function pfGrupo(eq, mostoId) {
  const e = normalizeText(eq || "");
  if (!e) return "Sin tanque";
  if (/^ext/.test(e)) return "FV EXT";
  if (/-309/.test(e)) return "FV 309";
  if (/-310/.test(e)) return "FV 310";
  if (/-20\d|-21\d/.test(e)) return esMostoPony(mostoId) ? "SV Pony" : "Sin tanque";
  return "Sin tanque";
}

// Filas al estilo del Excel (las que leen las gráficas compartidas) a partir
// de un plan ya calculado: secuencia + trazabilidad.
function pfFilas(seq, trz) {
  const filas = [];
  const cocs = [...(trz.cocs || [])].sort((a, b) => a.ms - b.ms);
  const rowPorN = new Map((seq.rows || []).filter((r) => r.tipo === "cocimiento").map((r) => [r.n, r]));
  const mosto = (id) => PF_MOSTOS.find((m) => m.id === id) || { nombre: id };
  cocs.forEach((c, i) => {
    const r = rowPorN.get(c.n) || {};
    const prev = cocs[i - 1];
    const eq = c.fv && c.fv.length ? [...new Set(c.fv.map((f) => f.tanque))].join("+") : c.sv && c.sv.length ? c.sv.join("+") : "";
    const iniEnv = c.consumo.length ? Math.min(...c.consumo.map((x) => x.desde)) : c.necesidad;
    const atraso = r.latestStart ? (c.ms - r.latestStart.getTime()) / PC_H : 0;
    const tarde = !!(c.tarde || c.tardeTanque);
    filas.push({
      fila: i + 1,
      n: c.n,
      texto: `Mosto ${mosto(c.mostoId).nombre}`,
      tipo: "coc",
      id: c.mostoId,
      inicio: c.ms,
      fin: c.fin,
      durMin: Math.round((c.fin - c.ms) / PC_MIN),
      equipo: eq,
      grupo: pfGrupo(eq, c.mostoId),
      lev: null,
      // «Anotación» = llega tarde (para el filtro y el aro en el mapa).
      notas: tarde ? [{ col: "⚠", tipo: "texto", v: `Llega tarde a su envasado${atraso > 0.05 ? ` (cargue ${MOD_NF(atraso, 1)} h después de su a más tardar)` : c.tardeTanque ? ` (el lote del FV queda listo ${MOD_NF(c.atrasoH, 1)} h tarde)` : ""}` }] : [],
      comentarios: [],
      colores: [],
      fechaPropia: true,
      desdeAnterior: prev ? c.ms - prev.ms : null,
      mostoAnterior: prev ? prev.mostoId : null,
      ef: null,
      // Lo propio del plan FerIA.
      destinos: c.consumo,
      listo: c.listo || null,
      trasiego: c.trasiego || null,
      sv: c.sv || [],
      aMasTardar: r.latestStart ? r.latestStart.getTime() : null,
      tarde,
      atrasoH: tarde ? Math.max(atraso, c.atrasoH || 0) : 0,
      diasProceso: iniEnv != null ? (iniEnv - c.ms) / PC_D : null,
      hLEnvasa: c.consumo.reduce((a, x) => a + x.hL, 0),
      buscar: c.consumo.map((x) => `L${x.train} ${x.name}`).join(" ") + " " + (c.sv || []).join(" "),
    });
  });
  // Aseos de la secuencia.
  (seq.rows || [])
    .filter((r) => r.tipo === "aseo" && r.start && r.end)
    .forEach((r) =>
      filas.push({ fila: null, n: null, texto: r.nombre || "Aseo", tipo: "evento", id: "aseo", inicio: r.start.getTime(), fin: r.end.getTime(), durMin: Math.round((r.end - r.start) / PC_MIN), equipo: "", grupo: "", notas: [], comentarios: [], colores: [], fechaPropia: true, buscar: "" }),
    );
  // Huecos con la cocina vacía (ningún cocimiento en proceso ni aseo).
  const ocupado = filas
    .filter((x) => x.inicio != null && x.fin != null)
    .map((x) => [x.inicio, x.fin])
    .sort((a, b) => a[0] - b[0]);
  const union = [];
  ocupado.forEach(([a, z]) => {
    const u = union[union.length - 1];
    if (u && a <= u[1]) u[1] = Math.max(u[1], z);
    else union.push([a, z]);
  });
  for (let i = 1; i < union.length; i++) {
    const a = union[i - 1][1];
    const z = union[i][0];
    if (z - a >= PF_HUECO_H * PC_H)
      filas.push({ fila: null, n: null, texto: "Cocina sin cargar", tipo: "evento", id: "paro", inicio: a, fin: z, durMin: Math.round((z - a) / PC_MIN), equipo: "", grupo: "", notas: [], comentarios: [], colores: [], fechaPropia: true, buscar: "" });
  }
  filas.sort((a, b) => a.inicio - b.inicio);
  return filas;
}

// Cuadre de un plan: lo que pide el instructivo desde el I0 = inventario +
// cocimientos + no alcanzable, por mosto.
function pfCuadre(plan, i0) {
  const o = {};
  const fila = (id) => (o[id] = o[id] || { dem: 0, inv: 0, coc: 0, na: 0 });
  TRAINS.forEach((t) =>
    ((STATE.parsed && STATE.parsed.rawEvents[t]) || []).forEach((e) => {
      if (classify(e) !== "production" || !e.hectolitros) return;
      const id = matchMosto(e.name, MOSTO_CATALOG);
      if (!id) return;
      const a = e.start.getTime();
      const b = e.end.getTime();
      const fr = b <= i0 ? 0 : a >= i0 ? 1 : (b - i0) / (b - a);
      fila(id).dem += e.hectolitros * fr;
    }),
  );
  (plan.cubiertoPorInvTramos || []).forEach((x) => (fila(x.mostoId).inv += x.hL));
  (plan.noAlcanzable || []).forEach((x) => (fila(x.mostoId).na += x.hL));
  (plan.results || []).forEach((r) => {
    if (r.cocimientos && r.cocimientos.length) fila(r.mostoId).coc += r.cocimientos.reduce((a, c) => a + (c.hLProducto || 0), 0);
  });
  Object.values(o).forEach((x) => (x.dif = x.dem - x.inv - x.coc - x.na));
  return o;
}

// PLAN COMPLETO HACIA ATRÁS. Se corre el mismo motor con el I0 corrido
// PF_DIAS_ATRAS días antes del primer envasado, SIN inventario (todo lo
// del instructivo sale de un cocimiento) y con levadura Light disponible
// desde ese I0 (sin inventario no hay de dónde cosecharla). Todo lo que se
// toca se restaura en el finally: el plan de FerIA no cambia.
function pfCalcularHaciaAtras() {
  if (!(STATE && STATE.parsed && STATE.mergedByTrain)) return null;
  const inp = document.getElementById("programI0Input");
  if (!inp) return null;
  const evs = TRAINS.flatMap((t) => (STATE.parsed.rawEvents[t] || []).filter((e) => classify(e) === "production"));
  if (!evs.length) return null;
  const primerEnv = Math.min(...evs.map((e) => e.start.getTime()));
  const i0Atras = medianocheMs(new Date(primerEnv - PF_DIAS_ATRAS * PC_D));
  const guarda = { i0: inp.value, inv: INVENTORY_BALANCE, lev: YEAST_AVAILABILITY, adel: ENGINE_ADELANTO_EXTRA_DIAS };
  try {
    ENGINE_ADELANTO_EXTRA_DIAS = PF_ADELANTO_ATRAS_DIAS;
    inp.value = toInputDateTimeUTC(new Date(i0Atras));
    INVENTORY_BALANCE = [];
    YEAST_AVAILABILITY = [...(guarda.lev || []), { mostoId: "light", origen: "Supuesta (plan hacia atrás: sin inventario)", disponibleDesde: new Date(i0Atras).toISOString(), disponible: true }];
    const brands = buildBrandList(STATE.parsed, STATE.mergedByTrain);
    const plan = computeCocinaPlan(brands, MOSTO_CATALOG, inventoryBatchesByMosto(MOSTO_CATALOG));
    const weekStart = STATE.parsed.weekStartDate || STATE.parsed.headerDate || new Date(i0Atras);
    const seq = sequenceWeek(plan, MOSTO_CATALOG, weekStart, ASEO_MATRIX, ASEO_DEFAULT_HORAS, ASEO_PERIODICO, getI0Date(), TANK_CATALOG);
    seq.tankAssignment = assignTanks(seq, plan, TANK_CATALOG, MOSTO_CATALOG);
    // La trazabilidad lee STATE.plan / STATE.seq: se prestan un momento.
    const real = { plan: STATE.plan, seq: STATE.seq };
    let trz;
    try {
      STATE.plan = plan;
      STATE.seq = seq;
      trz = calcularTrazabilidad(trzConfig());
    } finally {
      STATE.plan = real.plan;
      STATE.seq = real.seq;
    }
    return { plan, seq, trz, i0: i0Atras, cuadre: pfCuadre(plan, i0Atras) };
  } finally {
    inp.value = guarda.i0;
    ENGINE_ADELANTO_EXTRA_DIAS = guarda.adel;
    INVENTORY_BALANCE = guarda.inv;
    YEAST_AVAILABILITY = guarda.lev;
  }
}

function pfDatos(escenario) {
  if (!(STATE && STATE.seq && STATE.plan)) return null;
  const i0d = getI0Date();
  const clave = `${escenario}|${i0d ? i0d.getTime() : ""}`;
  const c = PCX_FERIA.cache;
  if (c.clave === clave && c.seq === STATE.seq && c.datos) return c.datos;
  let base;
  if (escenario === "atras") base = pfCalcularHaciaAtras();
  else base = { plan: STATE.plan, seq: STATE.seq, trz: calcularTrazabilidad(trzConfig()), i0: i0d ? i0d.getTime() : null, cuadre: pfCuadre(STATE.plan, i0d ? i0d.getTime() : -Infinity) };
  if (!base) return null;
  const datos = {
    fuente: "feria",
    escenario,
    archivo: escenario === "atras" ? "Plan FerIA completo hacia atrás" : "Plan FerIA",
    filas: pfFilas(base.seq, base.trz),
    mostos: PF_MOSTOS,
    eventos: PF_EVENTOS,
    grupos: PF_GRUPOS,
    buscarTxt: "Buscar n.º, tanque (EXT 4), línea (L5), SKU…",
    notasTxt: "Solo los que llegan tarde",
    base,
  };
  PCX_FERIA.cache = { clave, seq: STATE.seq, datos };
  return datos;
}

/* ------------------------------------------------------------- render */

function renderProgramaFeria() {
  const cont = document.getElementById("programaFeriaPanel");
  if (!cont) return;
  PCX = PCX_FERIA;
  // Las dos vistas comparten los id de las gráficas: solo una a la vez.
  const otra = document.getElementById("programaCocinasPanel");
  if (otra) otra.innerHTML = "";
  const esc = PCX_FERIA.escenario;
  const datos = pfDatos(esc);
  const i0d = typeof getI0Date === "function" ? getI0Date() : null;
  const cab = `
    <div class="panel">
      <div class="panel-head"><h3>Programa de cocinas (FerIA)</h3>
        <span class="sub">El plan que FerIA genera desde el instructivo de envasado${i0d ? ` · I0 ${escapeHtml(fmtDateTime(i0d))}` : ""}</span>
      </div>
      <div class="panel-body">
        <div class="pf-esc">
          <span class="pc-flab">Escenario</span>
          <button class="pc-chip ${esc === "actual" ? "on" : ""}" data-pf-esc="actual">Plan actual · desde el I0, con inventario</button>
          <button class="pc-chip ${esc === "atras" ? "on" : ""}" data-pf-esc="atras">Plan completo hacia atrás · para que todo el instructivo se pueda envasar</button>
        </div>
        <p class="acu-nota pf-esc-nota">${
          esc === "atras"
            ? `Qué había que cocinar, y cuándo, para que <b>todo</b> lo que pide el instructivo —también lo que se está envasando hoy— tenga cerveza a tiempo. Se calcula sin inventario (todo sale de un cocimiento), con levadura Light disponible y con las mismas reglas del plan, salvo que la cerveza se puede cocinar hasta ${2 + PF_ADELANTO_ATRAS_DIAS} días antes de su inicio ideal (Light ${3 + PF_ADELANTO_ATRAS_DIAS}) en vez de 2 (Light 3): así se cocinó en la planta la cerveza que hoy está en tanques. Lo que queda antes del I0 es el <b>plan pasado</b>. No cambia el plan de FerIA.`
            : "El plan de cocinas de FerIA: desde el I0, descontando lo que ya está en los tanques (Producto en proceso y, si está cargado, el Programa de Cocinas)."
        }</p>
        <div id="pcCuerpo"></div>
      </div>
    </div>`;
  cont.innerHTML = cab;
  cont.querySelectorAll("[data-pf-esc]").forEach((b) =>
    b.addEventListener("click", () => {
      if (PCX_FERIA.escenario === b.dataset.pfEsc) return;
      PCX_FERIA.escenario = b.dataset.pfEsc;
      PCX_FERIA.F = null;
      PCX_FERIA.SEL = null;
      PCX_FERIA.PAG = 0;
      renderProgramaFeria();
    }),
  );
  if (!datos) {
    document.getElementById("pcCuerpo").innerHTML =
      '<p class="empty-note">Todavía no hay plan: carga el instructivo de envasado (y el Producto en proceso) en Datos de entrada.</p><button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button>';
    return;
  }
  const cambio = PCX_FERIA.D !== datos;
  PCX_FERIA.D = datos;
  if (!PCX_FERIA.F || cambio) {
    const prev = PCX_FERIA.F;
    PCX_FERIA.F = pcFiltrosIniciales(datos);
    // Por defecto se ve todo el plan (no solo las últimas 4 semanas).
    PCX_FERIA.F.desde = PCX_FERIA.F.min;
    PCX_FERIA.F.hasta = PCX_FERIA.F.max;
    if (prev && prev.min === PCX_FERIA.F.min && prev.max === PCX_FERIA.F.max) Object.assign(PCX_FERIA.F, { desde: prev.desde, hasta: prev.hasta, mostos: prev.mostos, eventos: prev.eventos, semVista: prev.semVista });
    if (cambio) PCX_FERIA.SEL = null;
  }
  pfRenderCuerpo();
}

function pfRenderCuerpo() {
  const cuerpo = document.getElementById("pcCuerpo");
  if (!cuerpo || !PCX.D) return;
  const D = PCX.D;
  const vis = D.filas.filter((x) => pcPasa(x));
  const coc = vis.filter((x) => x.tipo === "coc");
  const ev = vis.filter((x) => x.tipo === "evento");
  const dias = Math.max(1, (PCX.F.hasta - PCX.F.desde) / PC_D);
  const cat = (id) => MOSTO_CATALOG.find((m) => m.id === id) || {};
  const hlMosto = coc.reduce((a, x) => a + (Number(cat(x.id).volumenPorCocimiento) || 0), 0);
  const hlEnv = coc.reduce((a, x) => a + x.hLEnvasa, 0);
  const tarde = coc.filter((x) => x.tarde);
  const gaps = coc.map((x) => x.desdeAnterior).filter((g) => g > 0 && g < 12 * PC_H).sort((a, b) => a - b);
  const mediana = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const nAseo = ev.filter((x) => x.id === "aseo").length;
  const huecos = ev.filter((x) => x.id === "paro");
  const hHuecos = huecos.reduce((a, x) => a + (x.fin - x.inicio), 0) / PC_H;
  const i0 = D.base.i0;
  const antes = D.escenario === "atras" && STATE && getI0Date() ? coc.filter((x) => x.inicio < getI0Date().getTime()).length : null;

  const kpis =
    modKpi("◉", "Cocimientos", MOD_NF(coc.length), `${MOD_NF(coc.length / dias, 1)} por día en el rango${antes != null ? ` · ${antes} antes del I0 actual` : ""}`) +
    modKpi("◍", "Mosto a cocinar", `${MOD_NF(hlMosto)} <small>hL</small>`, `cubren ${MOD_NF(hlEnv)} hL a envasar (con el factor de dilución)`) +
    modKpi("⚠", "Llegan tarde", MOD_NF(tarde.length), tarde.length ? `el peor, ${MOD_NF(Math.max(...tarde.map((x) => x.atrasoH)), 1)} h` : "todos a tiempo", tarde.length ? "var(--danger)" : "var(--ok)") +
    modKpi("⏱", "Tiempo típico entre cargues", mediana ? fmtHM(mediana / PC_MIN) : "—", "Mediana (sin contar huecos de 12 h o más)") +
    modKpi("⟲", "Aseos · cocina sin cargar", `${nAseo} <small>·</small> ${huecos.length}`, `${MOD_NF(hHuecos, 0)} h sin cargar (huecos de ${PF_HUECO_H} h o más)`);

  cuerpo.innerHTML = `
    ${pcHtmlFiltros()}
    <div class="acu-kpis">${kpis}</div>
    <div class="acu-card">
      <div class="acu-card-tit">Cocimientos por semana <small class="pc-sub">· clic en una semana para verla · el recuadro marca el rango elegido · desliza para moverte y acorta las semanas con la barra de abajo</small></div>
      <div id="pcSemanas" class="pc-chart"></div>
      ${pcLeyenda()}
    </div>
    <div class="pc-layout">
      <div class="acu-card">
        <div class="acu-card-tit">Mapa de cargues <small class="pc-sub">· una fila por día, de 00:00 a 24:00 · cada punto es un cargue · lo rayado es un aseo o la cocina sin cargar · con aro = llega tarde · clic para ver el detalle</small></div>
        <div id="pcMapa" class="pc-mapa"></div>
      </div>
      <div>
        <div class="acu-card" id="pcDetalle">${pfHtmlDetalle()}</div>
      </div>
    </div>
    <div class="vol-grid3">
      <div class="acu-card"><div class="acu-card-tit">Mezcla de mostos <small class="pc-sub">· clic para filtrar</small></div><div id="pcMix"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Fermentador de cada cocimiento <small class="pc-sub">· clic para filtrar</small></div><div id="pcEquipos"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Días de cargue a envasado <small class="pc-sub">· por mosto, rango elegido</small></div><div id="pfDias"></div></div>
    </div>
    ${D.escenario === "atras" ? `<div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Plan pasado vs. lo que pasó <small class="pc-sub">· cocimientos antes del I0 actual: lo que pedía el instructivo vs. el Programa de Cocinas real y el Producto en proceso</small></div><div id="pfPasado"></div></div>` : ""}
    <div class="acu-card" style="margin-top:14px;">
      <div class="acu-card-tit">Todos los cocimientos y eventos del rango (${vis.length.toLocaleString("es-CO")})</div>
      <div id="pcTabla"></div>
    </div>
    <div class="vol-grid3">
      <div class="acu-card pc-span2"><div class="acu-card-tit">Tiempos entre cargues al cambiar de marca <small class="pc-sub">· mediana del plan FerIA en el rango${typeof PC !== "undefined" && PC ? " vs. el Programa de Cocinas real (mismo rango)" : ""}</small></div><div id="pfMatriz"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Tiempos por mosto <small class="pc-sub">· catálogo de FerIA</small></div><div id="pfCiclo"></div></div>
    </div>
    <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Cuadre del plan <small class="pc-sub">· envasado del instructivo desde el I0${D.escenario === "atras" ? " del escenario" : ""} = inventario + cocimientos + no alcanzable</small></div><div id="pfCuadre"></div></div>`;

  pcConectarFiltros();
  pcDibujarSemanas();
  pcDibujarMapa(vis);
  pcDibujarMix(vis);
  pcDibujarEquipos(vis);
  pfDibujarDias(coc);
  if (D.escenario === "atras") pfDibujarPasado();
  pfDibujarTabla(vis);
  pfDibujarMatriz(coc);
  pfDibujarCiclo();
  pfDibujarCuadre();
}

function pfHtmlDetalle() {
  const D = PCX.D;
  if (PCX.SEL == null || !D || !D.filas[PCX.SEL])
    return `<div class="acu-card-tit">Detalle</div><p class="empty-note">Haz clic en un punto del mapa, en una franja rayada o en una fila de la tabla para ver el cocimiento: su fermentador, cuándo queda listo y a qué línea, SKU y horas va.</p>
      <div class="pc-ayuda"><div><span class="pc-dot pc-c1"></span>Punto = cargue de un cocimiento (color = mosto)</div><div><span class="pc-dot pc-aseo"></span>Franja rayada = aseo o cocina sin cargar</div><div><span class="pc-anot-demo"></span>Punto con aro = llega tarde a su envasado</div><div>Bandas: fines de semana más oscuros; la franja clara es el turno 06–14.</div></div>`;
  const x = D.filas[PCX.SEL];
  const fila = (k, v) => (v == null || v === "" ? "" : `<div class="pc-dl"><span>${k}</span><b>${v}</b></div>`);
  const vecinos = (dir) => {
    for (let j = PCX.SEL + dir; j >= 0 && j < D.filas.length; j += dir) if (pcPasa(D.filas[j], true)) return j;
    return null;
  };
  const ant = vecinos(-1);
  const sig = vecinos(1);
  const cab = `<div class="acu-card-tit pc-det-tit"><span class="pc-dot ${pcClaseDe(x)}"></span>${x.n != null ? "Cocimiento n.º " + x.n : escapeHtml(x.texto)}
      <span class="pc-nav"><button class="btn small" data-pc-nav="${ant}" ${ant == null ? "disabled" : ""}>◀</button><button class="btn small" data-pc-nav="${sig}" ${sig == null ? "disabled" : ""}>▶</button></span></div>`;
  if (x.tipo !== "coc")
    return `${cab}<div class="pc-orig">${escapeHtml(x.texto)}</div>${fila("Desde", pcFecha(x.inicio))}${fila("Hasta", pcFecha(x.fin))}${fila("Duración", fmtHM(x.durMin) + " h")}`;
  return `${cab}
    <div class="pc-orig">${escapeHtml(x.texto)}${x.tarde ? ' · <span class="pvr-no">llega tarde</span>' : ""}</div>
    ${fila("Cargue", pcFecha(x.inicio))}
    ${fila("Fin de cocina", pcFecha(x.fin))}
    ${fila("A más tardar", x.aMasTardar ? pcFecha(x.aMasTardar) + (x.tarde && x.atrasoH ? ` <small class="pvr-no">(${MOD_NF(x.atrasoH, 1)} h tarde)</small>` : "") : "")}
    ${fila("Fermenta en", x.equipo ? `${escapeHtml(x.equipo)} <button class="pc-mini" data-pc-equipo="${escapeHtml(x.equipo)}">filtrar</button>` : esMostoPony(x.id) ? "— (la Pony va directo a SV Pony)" : "— (sin FV asignado)")}
    ${fila("Trasiego a maduración", x.trasiego ? pcFecha(x.trasiego) : "")}
    ${fila("Madura en", x.sv && x.sv.length ? escapeHtml(x.sv.join(", ")) : "")}
    ${fila("Listo para envasar", x.listo ? pcFecha(x.listo) : "")}
    ${fila("Días de cargue a envasado", x.diasProceso != null ? MOD_NF(x.diasProceso, 1) + " días" : "")}
    ${x.desdeAnterior ? fila("Desde el cargue anterior", fmtHM(x.desdeAnterior / PC_MIN) + " h" + (x.mostoAnterior && x.mostoAnterior !== x.id ? ` <small class="pc-sub">(venía de ${escapeHtml((PF_MOSTOS.find((m) => m.id === x.mostoAnterior) || {}).nombre || "")})</small>` : "")) : ""}
    <div class="pc-sec">Se envasa en</div>
    ${
      x.destinos.length
        ? x.destinos.map((d) => `<div class="pc-nota"><span class="pc-col">L${escapeHtml(String(d.train))}</span><div>${escapeHtml(d.name)}<br><small class="pc-sub">${escapeHtml(pcFecha(d.desde))} → ${escapeHtml(pcFecha(d.hasta))} · ${MOD_NF(d.hL)} hL</small></div></div>`).join("")
        : '<p class="empty-note">Sin destino calculado.</p>'
    }
    ${PCX.D.escenario === "actual" ? `<button class="btn small as-ver" data-pf-trz="c${x.n}" data-goto="view-trazabilidad">Ver en «Del cocimiento al envasado» →</button>` : ""}`;
}

function pfDibujarDias(coc) {
  const el = document.getElementById("pfDias");
  if (!el) return;
  const filas = PF_MOSTOS.map((m) => {
    const v = coc
      .filter((x) => x.id === m.id && x.diasProceso != null)
      .map((x) => x.diasProceso)
      .sort((a, b) => a - b);
    if (!v.length) return "";
    const cat = MOSTO_CATALOG.find((c) => c.id === m.id) || {};
    const minimo = ((Number(cat.tiempoCocinaHoras) || 0) + (Number(cat.tiempoFermentacionHoras) || 0) + (Number(cat.tiempoMaduracionHoras) || 0)) / 24;
    return `<tr><td><span class="pc-dot ${m.cls}"></span>${m.nombre}</td><td class="num">${v.length}</td><td class="num">${MOD_NF(v[0], 1)}</td><td class="num"><b>${MOD_NF(v[Math.floor(v.length / 2)], 1)}</b></td><td class="num">${MOD_NF(v[v.length - 1], 1)}</td><td class="num">${MOD_NF(minimo, 1)}</td></tr>`;
  }).join("");
  el.innerHTML = filas
    ? `<div class="table-scroll mod-noclip"><table class="pc-tabla"><thead><tr><th>Mosto</th><th class="num">Coc.</th><th class="num">Mín.</th><th class="num">Mediana</th><th class="num">Máx.</th><th class="num">Proceso</th></tr></thead><tbody>${filas}</tbody></table></div><p class="acu-nota">Días desde el cargue hasta que empieza el envasado que cubre. «Proceso» = cocina + fermentación + maduración del catálogo: por debajo de eso no alcanza.</p>`
    : '<p class="empty-note">Sin cocimientos en el rango.</p>';
}

function pfDibujarTabla(vis) {
  const el = document.getElementById("pcTabla");
  if (!el) return;
  const POR = 100;
  const pags = Math.max(1, Math.ceil(vis.length / POR));
  PCX.PAG = Math.min(PCX.PAG, pags - 1);
  const idx = new Map(PCX.D.filas.map((x, i) => [x, i]));
  const filas = vis
    .slice(PCX.PAG * POR, PCX.PAG * POR + POR)
    .map((x) => {
      const dest = x.tipo === "coc" ? x.destinos.map((d) => `<span class="pc-tn"><i>L${escapeHtml(String(d.train))}</i>${escapeHtml(d.name)} · ${escapeHtml(fmtDate(new Date(d.desde)))} · ${MOD_NF(d.hL)} hL</span>`).join("") : "";
      return `<tr data-pc-i="${idx.get(x)}" class="${PCX.SEL === idx.get(x) ? "sel" : ""}">
        <td class="num">${x.n != null ? x.n : ""}</td>
        <td><span class="pc-dot ${pcClaseDe(x)}"></span>${escapeHtml(x.tipo === "coc" ? pcNombreDe(x) : x.texto)}</td>
        <td>${pcFecha(x.inicio)}</td>
        <td class="num">${x.durMin != null ? fmtHM(x.durMin) : ""}</td>
        <td>${pcFecha(x.fin)}</td>
        <td>${escapeHtml(x.equipo || "")}</td>
        <td>${x.tipo === "coc" && x.sv && x.sv.length ? escapeHtml(x.sv.join(", ")) : ""}</td>
        <td>${x.tipo === "coc" && x.listo ? pcFecha(x.listo) : ""}</td>
        <td class="num">${x.tipo === "coc" && x.diasProceso != null ? MOD_NF(x.diasProceso, 1) : ""}</td>
        <td>${x.tipo === "coc" ? (x.tarde ? `<span class="pvr-no">tarde${x.atrasoH ? " " + MOD_NF(x.atrasoH, 1) + " h" : ""}</span>` : '<span class="pvr-si">a tiempo</span>') : ""}</td>
        <td class="pc-notas">${dest}</td>
      </tr>`;
    })
    .join("");
  el.innerHTML = `<div class="table-scroll" style="max-height:520px;"><table class="pc-tabla"><thead><tr>
      <th class="num">N.º</th><th>Mosto / evento</th><th>Cargue</th><th class="num">Dur.</th><th>Fin</th><th>Fermenta en</th><th>Madura en</th><th>Listo</th><th class="num">Días</th><th>Estado</th><th>Se envasa en</th>
    </tr></thead><tbody>${filas || '<tr><td colspan="11"><p class="empty-note">Ninguna fila cumple los filtros.</p></td></tr>'}</tbody></table></div>
    <div class="pc-pag"><button class="btn small" data-pc-pag="-1" ${PCX.PAG === 0 ? "disabled" : ""}>◀ Anteriores</button><span>Página ${PCX.PAG + 1} de ${pags} · filas ${vis.length ? PCX.PAG * POR + 1 : 0}–${Math.min(vis.length, (PCX.PAG + 1) * POR)} de ${vis.length}</span><button class="btn small" data-pc-pag="1" ${PCX.PAG >= pags - 1 ? "disabled" : ""}>Siguientes ▶</button></div>`;
  el.querySelectorAll("tr[data-pc-i]").forEach((tr) => tr.addEventListener("click", () => pcSeleccionar(Number(tr.dataset.pcI))));
  el.querySelectorAll("[data-pc-pag]").forEach((b) =>
    b.addEventListener("click", () => {
      PCX.PAG += Number(b.dataset.pcPag);
      pfDibujarTabla(vis);
    }),
  );
}

// Mediana de tiempo entre cargues por cambio de marca (de → a).
function pfMedianasCambio(lista, idDe) {
  const real = {};
  lista.forEach((x) => {
    if (!x.desdeAnterior || !x.mostoAnterior || x.desdeAnterior > 12 * PC_H) return;
    const k = idDe(x.mostoAnterior) + ">" + idDe(x.id);
    (real[k] = real[k] || []).push(x.desdeAnterior / PC_MIN);
  });
  const med = {};
  Object.keys(real).forEach((k) => {
    const s = real[k].sort((a, b) => a - b);
    med[k] = { v: s[Math.floor(s.length / 2)], n: s.length };
  });
  return med;
}
function pfDibujarMatriz(coc) {
  const el = document.getElementById("pfMatriz");
  if (!el) return;
  const fe = pfMedianasCambio(coc, (id) => id);
  // Lo real en el mismo rango (Pony GO/HG del Excel = Pony en FerIA).
  let re = null;
  if (typeof PC !== "undefined" && PC && PC.filas) {
    const enRango = PC.filas.filter((x) => x.tipo === "coc" && x.inicio != null && x.inicio >= PCX.F.desde && x.inicio < PCX.F.hasta);
    re = pfMedianasCambio(enRango, (id) => (/^pony/.test(id) ? "pony" : id));
  }
  const ids = PF_MOSTOS.map((m) => m.id);
  const celda = (a, b) => {
    const k = a + ">" + b;
    const f = fe[k];
    const r = re && re[k];
    if (!f && !r) return '<td class="pc-mz vac">—</td>';
    return `<td class="pc-mz" style="--t:${f ? Math.min(1, f.v / 480).toFixed(2) : 0}" title="De ${a} a ${b}${f ? ` · FerIA ${fmtHM(f.v)} h (${f.n})` : ""}${r ? ` · real ${fmtHM(r.v)} h (${r.n})` : ""}"><b>${f ? fmtHM(f.v) : "—"}</b>${r ? `<small>real ${fmtHM(r.v)}</small>` : ""}</td>`;
  };
  el.innerHTML = `<div class="table-scroll mod-noclip"><table class="pc-matriz"><thead><tr><th>De ↓ / A →</th>${PF_MOSTOS.map((m) => `<th>${m.nombre}</th>`).join("")}</tr></thead><tbody>${PF_MOSTOS.map((m) => `<tr><th>${m.nombre}</th>${ids.map((b) => celda(m.id, b)).join("")}</tr>`).join("")}</tbody></table></div><p class="acu-nota">Horas:minutos entre un cargue y el siguiente (incluye el aseo cuando cambia la marca). Mediana del rango elegido; entre paréntesis en el globo, cuántos cambios. Más oscuro = más tiempo.</p>`;
}

function pfDibujarCiclo() {
  const el = document.getElementById("pfCiclo");
  if (!el) return;
  const hm = (h) => fmtHM((Number(h) || 0) * 60);
  el.innerHTML = `<div class="table-scroll mod-noclip"><table class="pc-tabla"><thead><tr><th>Mosto</th><th class="num">Cocina</th><th class="num">Entre cargues</th><th class="num">Ferm.</th><th class="num">Mad.</th><th class="num">hL/coc.</th><th class="num">Factor</th></tr></thead><tbody>${MOSTO_CATALOG.map(
    (m) => `<tr><td>${escapeHtml(m.nombre)}</td><td class="num">${hm(m.tiempoCocinaHoras)}</td><td class="num">${hm(m.tiempoEntreCarguesHoras)}</td><td class="num">${hm(m.tiempoFermentacionHoras)}</td><td class="num">${hm(m.tiempoMaduracionHoras)}</td><td class="num">${MOD_NF(m.volumenPorCocimiento)}</td><td class="num">${MOD_NF(m.factorDilucion, 3)}</td></tr>`,
  ).join("")}</tbody></table></div><p class="acu-nota">Aseo al entrar a Light o Pony: ${fmtHM((ASEO_MATRIX[0] && ASEO_MATRIX[0].duracionHoras * 60) || 0)} h. Se editan en Catálogo.</p>`;
}

function pfDibujarCuadre() {
  const el = document.getElementById("pfCuadre");
  if (!el) return;
  const cu = PCX.D.base.cuadre || {};
  const filas = Object.entries(cu)
    .sort((a, b) => b[1].dem - a[1].dem)
    .map(
      ([k, x]) =>
        `<tr><td><span class="pc-dot ${(PF_MOSTOS.find((m) => m.id === k) || {}).cls || ""}"></span>${escapeHtml((PF_MOSTOS.find((m) => m.id === k) || {}).nombre || k)}</td><td class="num">${MOD_NF(x.dem)}</td><td class="num">${MOD_NF(x.inv)}</td><td class="num">${MOD_NF(x.coc)}</td><td class="num">${x.na >= 1 ? `<span class="pvr-no">${MOD_NF(x.na)}</span>` : "0"}</td><td class="num">${Math.abs(x.dif) < 1 ? '<span class="pvr-si">✓ cuadra</span>' : `<span class="pvr-no">${MOD_NF(x.dif)}</span>`}</td></tr>`,
    )
    .join("");
  el.innerHTML = `<div class="table-scroll mod-noclip"><table class="pc-tabla"><thead><tr><th>Mosto</th><th class="num">Envasado desde el I0 (hL)</th><th class="num">Inventario</th><th class="num">Cocimientos</th><th class="num">No alcanzable</th><th class="num">Cuadre</th></tr></thead><tbody>${filas}</tbody></table></div><p class="acu-nota">I0 ${escapeHtml(pcFecha(PCX.D.base.i0))}. «Cocimientos» = hL a envasar que cubren los cocimientos (rinden factor × hL por cocimiento; lo que sobra del último no se cuenta). Si algo no cuadra, el plan está perdiendo o inventando cerveza.</p>`;
}

// Plan pasado (antes del I0 actual) vs. lo que pasó: Programa de Cocinas
// real en las mismas fechas y lo que hay en tanques (Producto en proceso).
function pfDibujarPasado() {
  const el = document.getElementById("pfPasado");
  if (!el) return;
  const i0d = getI0Date();
  if (!i0d) {
    el.innerHTML = '<p class="empty-note">Sin I0.</p>';
    return;
  }
  const i0 = i0d.getTime();
  const antes = PCX.D.filas.filter((x) => x.tipo === "coc" && x.inicio < i0);
  if (!antes.length) {
    el.innerHTML = '<p class="empty-note">Con el instructivo cargado no hacía falta cocinar nada antes del I0.</p>';
    return;
  }
  const desde = Math.min(...antes.map((x) => x.inicio));
  const realEn = typeof PC !== "undefined" && PC && PC.filas ? PC.filas.filter((x) => x.tipo === "coc" && x.inicio != null && x.inicio >= desde && x.inicio < i0) : null;
  const inv = typeof inventoryBatchesByMosto === "function" ? inventoryBatchesByMosto(MOSTO_CATALOG) : {};
  const filas = PF_MOSTOS.map((m) => {
    const plan = antes.filter((x) => x.id === m.id);
    const real = realEn ? realEn.filter((x) => (/^pony/.test(x.id) ? "pony" : x.id) === m.id) : null;
    const hlInv = (inv[m.id] || []).reduce((a, l) => a + l.hL, 0);
    const cat = MOSTO_CATALOG.find((c) => c.id === m.id) || {};
    const rinde = (Number(cat.factorDilucion) || 1) * (Number(cat.volumenPorCocimiento) || 0);
    if (!plan.length && !(real && real.length)) return "";
    return `<tr><td><span class="pc-dot ${m.cls}"></span>${m.nombre}</td><td class="num"><b>${plan.length}</b></td><td>${plan.length ? `${escapeHtml(fmtDateTime(new Date(plan[0].inicio)))} → ${escapeHtml(fmtDateTime(new Date(plan[plan.length - 1].inicio)))}` : "—"}</td><td class="num">${real ? real.length : "—"}</td><td class="num">${MOD_NF(hlInv)}</td><td class="num">${rinde ? MOD_NF(hlInv / rinde, 1) : "—"}</td></tr>`;
  }).join("");
  el.innerHTML = `<div class="table-scroll mod-noclip"><table class="pc-tabla"><thead><tr><th>Mosto</th><th class="num">Plan pasado (coc.)</th><th>Cargues del plan pasado</th><th class="num">Programa real (coc.)</th><th class="num">En tanques hoy (hL)</th><th class="num">≈ cocimientos</th></tr></thead><tbody>${filas}</tbody></table></div><p class="acu-nota">Plan pasado = cocimientos de este escenario que caen antes del I0 actual (${escapeHtml(fmtDateTime(i0d))}), desde el ${escapeHtml(fmtDateTime(new Date(desde)))}. «Programa real» = cocimientos del Excel de Elaboración en esas mismas fechas${realEn ? "" : " (no está cargado)"}. «En tanques hoy» = Producto en proceso (y cocimientos del Programa que aún no aparecen en él), en hL a envasar; «≈ cocimientos» lo pasa a cocimientos con el rendimiento del catálogo. Donde el plan pasado pide más de lo que hay, ese envasado es el que sale «no alcanzable» en el plan actual. El Programa real también trae lo que se cocinó para envasado anterior al instructivo (por eso puede ser mayor, sobre todo en Pony, que se envasa a los 2–4 días).</p>`;
}
