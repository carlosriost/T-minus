/* =========================================================================
   RENDER (nucleo) — init de pestañas, render()/recompute() y KPIs
   ========================================================================= */
/* =========================================================================
   5.6) PESTAÑAS (tabs) — para los paneles de configuración y de resultados
   ========================================================================= */
function initTabs(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const btns = Array.from(
    container.querySelectorAll(":scope > .tab-bar > .tab-btn"),
  );
  const panels = Array.from(container.children).filter((el) =>
    el.classList.contains("tab-panel"),
  );
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.remove("hidden");
    });
  });
}
initTabs("configTabs");
initTabs("resultTabs");

/* =========================================================================
   6) RENDER
   ========================================================================= */
let STATE = null;

function render(parsed) {
  const mergedByTrain = {};
  TRAINS.forEach((t) => (mergedByTrain[t] = mergeEvents(parsed.rawEvents[t])));
  const brands = buildBrandList(parsed, mergedByTrain);

  STATE = { parsed, mergedByTrain, brands };

  const i0 = getI0Date();
  document.getElementById("weekMeta").textContent =
    (parsed.weekLabel || "") +
    (parsed.weekStartDate
      ? "  ·  primer día: " + fmtDate(parsed.weekStartDate)
      : "") +
    (parsed.headerDate
      ? "  ·  plan enviado: " + fmtDate(parsed.headerDate)
      : "") +
    (i0 ? "  ·  I0: " + fmtDateTime(i0) : "");

  // Aquí arriba solo va lo que exige una acción. Lo que salía antes —el aviso
  // verde de las hojas leídas y el del corte en el I0— era confirmación de que
  // todo iba bien: ocupaba media pantalla y no se leía. Las semanas cargadas ya
  // se ven en la cabecera y el I0 está en su propio campo. Se conserva únicamente
  // el aviso de las hojas que NO se pudieron leer, porque esas sí se quedan
  // fuera de la programación y hay que revisarlas.
  const weeksAlertEl = document.getElementById("weeksLoadedAlert");
  if (weeksAlertEl) {
    const sinReconocer = parsed.sheetsSinReconocer || [];
    weeksAlertEl.innerHTML = sinReconocer.length
      ? `<div style="border:1px solid rgba(237,28,43,.4); background:rgba(237,28,43,.08); border-radius:4px; padding:8px 14px; margin-bottom:10px; color:var(--danger); font-size:12.5px;">⚠️ ${sinReconocer.length} hoja(s) quedaron FUERA de la programación: ${sinReconocer.map(escapeHtml).join(", ")}.</div>`
      : "";
  }

  recompute();
  document.getElementById("results").classList.remove("hidden");
  document.getElementById("ganttTopPanel").classList.remove("hidden");
}

function recompute() {
  if (!STATE || !STATE.parsed) return;
  const plan = computeCocinaPlan(
    STATE.brands,
    MOSTO_CATALOG,
    inventoryBatchesByMosto(MOSTO_CATALOG),
  );
  STATE.plan = plan;
  // La tabla "Programación de cocinas" es la fuente de verdad de las fechas:
  // cada inicio se calcula a partir de la fecha/hora real de envasado de la marca.
  // La secuencia semanal NO vuelve a reconstruir el mes/año desde la celda FECHA.
  const weekStart =
    STATE.parsed.weekStartDate || STATE.parsed.headerDate || ahoraPlanta();
  const seq = sequenceWeek(
    plan,
    MOSTO_CATALOG,
    weekStart,
    ASEO_MATRIX,
    ASEO_DEFAULT_HORAS,
    ASEO_PERIODICO,
    getI0Date(),
    TANK_CATALOG,
  );
  seq.tankAssignment = assignTanks(seq, plan, TANK_CATALOG, MOSTO_CATALOG);
  STATE.seq = seq;
  renderKPIs(plan, seq);
  renderCocinaPlan(plan, seq.tankAssignment);
  renderSequence(seq);
  renderTankAssignments(seq.tankAssignment);
  if (typeof renderGanttTanques === "function")
    renderGanttTanques(seq.tankAssignment, weekStart);
  renderGanttEnvasado(STATE.mergedByTrain, weekStart, STATE.parsed.weeks);
  renderGanttCocina(seq, weekStart);
  renderConflictos(seq);
  renderReglas(seq);
  renderRecomendaciones(seq);
  renderSinHomologar(plan.sinHomologar);
  renderInventoryBalance(plan);
  renderYeastStatus(seq);
  // Las cosechas previstas de levadura dependen del plan y del inventario.
  // try/catch: si el recompute se dispara desde el propio evento de edición de
  // una fila de levadura, el navegador puede rechazar el innerHTML sobre un
  // nodo que aún está en su blur (NotFoundError) — no debe abortar el recompute.
  if (typeof renderYeastConfig === "function") {
    try {
      renderYeastConfig();
    } catch (_) {}
  }
  // El Gantt de filtración usa la velocidad de las líneas del instructivo para
  // el desalojo de BBTs: recalcularlo cuando cambie el análisis de envasado.
  if (typeof recomputeFiltracion === "function") recomputeFiltracion();
}

function renderKPIs(plan, seq) {
  const el = document.getElementById("kpiRow");
  if (!el) return; // los KPIs solo viven dentro de la vista "Gantt de cocina"
  const totalEnvasar = plan.results.reduce((a, r) => a + r.volumenEnvasar, 0);
  const totalCubiertoInv = plan.results.reduce(
    (a, r) => a + (r.inventarioUsadoHL || 0),
    0,
  );
  const totalCocinar = plan.results.reduce((a, r) => a + r.volumenCocinar, 0);
  const totalCocimientos = plan.results.reduce(
    (a, r) => a + r.numCocimientos,
    0,
  );
  const numAlertas = seq
    ? seq.reglaWarnings.length +
      seq.capacityWarnings.length +
      ((seq.tankAssignment && seq.tankAssignment.sinTanque) || []).length
    : 0;
  const sinTanque =
    seq && seq.tankAssignment ? seq.tankAssignment.sinTanque.length : 0;
  const yeastBlocked = seq && seq.yeastBlocked ? seq.yeastBlocked.length : 0;
  // Fecha límite para envasar lo que ya está en BBT, según "Máx. en BBT"
  // del Catálogo de mostos. Solo Pony (48 h); la cerveza no tiene límite.
  const limBBT =
    typeof proximoLimiteBBT === "function"
      ? proximoLimiteBBT(MOSTO_CATALOG)
      : { pony: null, cerveza: null };
  const i0 = getI0Date() || ahoraPlanta();
  const vencItem = (fecha, label) => ({
    n: fecha ? fmtDateTime(fecha) : "Sin límite en BBT",
    l: label,
    cls: !fecha ? "" : fecha.getTime() <= i0.getTime() ? "danger" : "warn",
  });
  const items = [
    { n: plan.results.length, l: "Bloques de producción", cls: "" },
    {
      n: yeastBlocked,
      l: "Bloques Light bloqueados",
      cls: yeastBlocked ? "danger" : "ok",
    },
    vencItem(limBBT.pony, "Límite BBT Pony (máx 48 h)"),
    {
      n: totalEnvasar.toLocaleString("es-CO", {
        maximumFractionDigits: 0,
      }),
      l: "HL a envasar (total)",
      cls: "",
    },
    {
      n: totalCubiertoInv.toLocaleString("es-CO", {
        maximumFractionDigits: 0,
      }),
      l: "HL cubiertos por inventario",
      cls: totalCubiertoInv > 0 ? "ok" : "",
    },
    {
      n: totalCocinar.toLocaleString("es-CO", {
        maximumFractionDigits: 0,
      }),
      l: "HL a cocinar (total)",
      cls: "",
    },
    { n: totalCocimientos, l: "Cocimientos totales", cls: "" },
    {
      n: numAlertas,
      l: "Alertas",
      cls: numAlertas ? "danger" : "ok",
    },
    {
      n: sinTanque,
      l: "Cocimientos sin tanque",
      cls: sinTanque ? "danger" : "ok",
    },
    {
      n: plan.sinHomologar.length,
      l: "Marcas sin homologar",
      cls: plan.sinHomologar.length ? "warn" : "ok",
    },
  ];
  el.innerHTML = items
    .map(
      (i) =>
        `<div class="kpi ${i.cls}"><div class="n">${i.n}</div><div class="l">${i.l}</div></div>`,
    )
    .join("");
}

const MOSTO_COLORS = {
  light: "#8fd6a8",
  pilsen: "#8fbfe0",
  pony: "#f2b6c6",
  estandar: "#e0d18f",
};
function colorForMosto(mostoId) {
  return MOSTO_COLORS[mostoId] || "#c9c9c9";
}

