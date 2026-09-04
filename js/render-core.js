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

  recompute();
  document.getElementById("results").classList.remove("hidden");
  document.getElementById("ganttTopPanel").classList.remove("hidden");
}

function recompute() {
  if (!STATE || !STATE.parsed) return;
  const plan = computeCocinaPlan(
    STATE.brands,
    MOSTO_CATALOG,
    inventoryTotalsByMosto(MOSTO_CATALOG),
  );
  STATE.plan = plan;
  // La tabla "Programación de cocinas" es la fuente de verdad de las fechas:
  // cada inicio se calcula a partir de la fecha/hora real de envasado de la marca.
  // La secuencia semanal NO vuelve a reconstruir el mes/año desde la celda FECHA.
  const weekStart =
    STATE.parsed.weekStartDate || STATE.parsed.headerDate || new Date();
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
  renderCocinaPlan(plan);
  renderSequence(seq);
  renderTankAssignments(seq.tankAssignment);
  renderGanttEnvasado(STATE.mergedByTrain, weekStart, STATE.parsed.weeks);
  renderGanttCocina(seq, weekStart);
  renderConflictos(seq);
  renderReglas(seq);
  renderRecomendaciones(seq);
  renderSinHomologar(plan.sinHomologar);
  renderInventoryBalance(plan);
  renderYeastStatus(seq);
  // Las cosechas previstas de levadura dependen del plan y del inventario.
  if (typeof renderYeastConfig === "function") renderYeastConfig();
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
  const nextLightYeast =
    seq && seq.yeastPool
      ? seq.yeastPool
          .filter((y) => y.sourceMostoId === "light" && !y.consumida)
          .sort((a, b) => a.fechaDisponible - b.fechaDisponible)[0]
      : null;
  const items = [
    { n: plan.results.length, l: "Bloques de producción", cls: "" },
    {
      n: yeastBlocked,
      l: "Bloques Light bloqueados",
      cls: yeastBlocked ? "danger" : "ok",
    },
    {
      n: nextLightYeast
        ? fmtDateTime(nextLightYeast.fechaDisponible)
        : "No disponible",
      l: "Próxima levadura Light",
      cls: nextLightYeast ? "ok" : "warn",
    },
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

