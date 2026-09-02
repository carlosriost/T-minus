/* =========================================================================
   GANTT — lineas de envasado, cocina y filtracion
   ========================================================================= */
/* =========================================================================
   6.5) GANTT — línea de tiempo de las líneas de envasado (TREN-5/7/8/9)
   ========================================================================= */
const GANTT_PX_PER_HOUR = 16;
const TRAIN_EVENT_COLORS = {
  changeover: "#6f63e6",
  idle: "#3226e8",
  other: "#6f63e6",
};

/* Colores del Gantt de ENVASADO por familia/SKU, independientes del color del mosto.
   El orden importa: las coincidencias específicas deben ir antes de las genéricas. */
const PACKAGING_COLOR_RULES = [
  { test: /costeñita|costenita|cost175|3617/i, bg: "#7EAD50", fg: "#000000" },
  { test: /aguila light.*330|a light.*22613|22613/i, bg: "#95DDD2", fg: "#000000" },
  { test: /aguila lig.*1000|9482/i, bg: "#57B9E9", fg: "#000000" },
  { test: /aguila.*1000|ag 9494|9494/i, bg: "#FFF536", fg: "#000000" },
  { test: /aguila rn.*330|3128/i, bg: "#FFF536", fg: "#000000" },
  { test: /poker.*1000|9480/i, bg: "#B22D32", fg: "#000000" },
  { test: /poker.*330|2512/i, bg: "#B22D32", fg: "#000000" },
  { test: /pilsen.*1000|9484/i, bg: "#F2382E", fg: "#000000" },
  { test: /pilsen.*330|2634/i, bg: "#F2382E", fg: "#000000" },
  { test: /pony.*330|2222/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /pony.*2000|21703/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /pony.*200.*30|3810|23211/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /pony.*1[.,]?5|21959|2224/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /pony.*1000|7078/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /pony/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /aguila light|light/i, bg: "#95DDD2", fg: "#000000" },
  { test: /aguila/i, bg: "#FFF536", fg: "#000000" },
  { test: /poker/i, bg: "#B22D32", fg: "#000000" },
  { test: /pilsen/i, bg: "#F2382E", fg: "#000000" },
];
function colorForPackagingEvent(ev) {
  const key = `${ev && ev.codigo ? ev.codigo : ""} ${ev && ev.name ? ev.name : ""}`;
  const rule = PACKAGING_COLOR_RULES.find((r) => r.test.test(key));
  if (rule) return rule;
  const mostoId = matchMosto(ev && ev.name, MOSTO_CATALOG);
  return { bg: mostoId ? colorForMosto(mostoId) : "#C9C9C9", fg: "#000000" };
}
function renderGanttEnvasado(mergedByTrain, weekStartRaw) {
  const container = document.getElementById("ganttContainer");
  if (!container) return;
  const allBlocks = TRAINS.flatMap((t) =>
    (mergedByTrain[t] || []).map((b) => ({ ...b, train: t })),
  );
  if (!allBlocks.length) {
    container.innerHTML =
      '<p class="empty-note">Sin eventos de envasado esta semana.</p>';
    return;
  }
  const weekStart = new Date(
    Date.UTC(
      weekStartRaw.getUTCFullYear(),
      weekStartRaw.getUTCMonth(),
      weekStartRaw.getUTCDate(),
    ),
  );
  const lastEnd = allBlocks.reduce(
    (max, b) => (b.end.getTime() > max ? b.end.getTime() : max),
    allBlocks[0].end.getTime(),
  );
  const firstStart = allBlocks.reduce(
    (min, b) => (b.start.getTime() < min ? b.start.getTime() : min),
    allBlocks[0].start.getTime(),
  );
  const rangeStart =
    firstStart < weekStart.getTime() ? new Date(firstStart) : weekStart;
  const totalHours = Math.max(
    24,
    Math.ceil((lastEnd - rangeStart.getTime()) / 3600000),
  );
  const totalDays = Math.ceil(totalHours / 24);
  const dayWidth = 24 * GANTT_PX_PER_HOUR;
  const totalWidth = totalDays * dayWidth;
  const labelWidth = 96;

  let dayHeaderHtml =
    '<div class="lane-label" style="background:var(--bg2); border-right:1px solid var(--line);"></div>';
  for (let d = 0; d < totalDays; d++) {
    const day = addDays(rangeStart, d);
    dayHeaderHtml += `<div class="day-cell" style="width:${dayWidth}px;"><b>${fmtDate(day)}</b></div>`;
  }

  let dayLinesHtml = "";
  for (let d = 1; d < totalDays; d++) {
    dayLinesHtml += `<div class="day-line" style="left:${d * dayWidth}px;"></div>`;
  }

  const laneRowsHtml = TRAINS.map((t) => {
    const blocks = mergedByTrain[t] || [];
    let blocksHtml = "";
    blocks.forEach((b) => {
      const left =
        ((b.start.getTime() - rangeStart.getTime()) / 3600000) *
        GANTT_PX_PER_HOUR;
      const width = Math.max(
        5,
        ((b.end.getTime() - b.start.getTime()) / 3600000) * GANTT_PX_PER_HOUR,
      );
      const dur = fmtDuration(b.end - b.start);
      const titleAttr = escapeHtml(
        `${b.name || b.codigo || ""} · ${fmtDateTime(b.start)} → ${fmtDateTime(b.end)} (${dur})`,
      );
      if (b.type === "production") {
        const colors = colorForPackagingEvent(b);
        const showText = width >= 46;
        blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${colors.bg}; color:${colors.fg};" title="${titleAttr}">${showText ? `<b style="color:${colors.fg};">${escapeHtml(b.name || b.codigo || "")}</b><span style="color:${colors.fg};">${dur}</span>` : ""}</div>`;
      } else if (b.type === "changeover") {
        blocksHtml += `<div class="block changeover" style="left:${left}px; width:${width}px;" title="${titleAttr}"><b>🧽</b></div>`;
      } else {
        const bg = TRAIN_EVENT_COLORS[b.type] || TRAIN_EVENT_COLORS.other;
        const showText = width >= 46;
        blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${bg};" title="${titleAttr}">${showText ? `<b>${escapeHtml(b.name || b.codigo || "")}</b><span>${dur}</span>` : ""}</div>`;
      }
    });
    return `
        <div class="gantt-row">
          <div class="lane-label">TREN-${t}</div>
          <div class="lane-track" style="width:${totalWidth}px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}</div>
            ${blocksHtml}
          </div>
        </div>`;
  }).join("");

  const legendItems =
    [
      ["Costeñita", "#7EAD50"], ["Águila", "#FFF536"],
      ["Águila Light", "#95DDD2"], ["Águila Light 1000", "#57B9E9"],
      ["Poker", "#B22D32"], ["Pilsen", "#F2382E"], ["Pony Malta", "#E2A1B8"],
    ].map(([label, bg]) => `<div class="item"><span class="sw" style="background:${bg}"></span>${label}</div>`).join("") +
    `<div class="item"><span class="sw" style="background:repeating-linear-gradient(45deg,var(--changeover-c1),var(--changeover-c1) 3px,var(--changeover-c2) 3px,var(--changeover-c2) 6px);"></span>Cambio (DPA)</div>` +
    `<div class="item"><span class="sw" style="background:${TRAIN_EVENT_COLORS.idle};"></span>Paro (NST)</div>` +
    `<div class="item"><span class="sw" style="background:${TRAIN_EVENT_COLORS.other};"></span>Otro</div>`;

  container.innerHTML = `
    <div id="ganttScroll">
      <div id="ganttWrap" style="width:${labelWidth + totalWidth}px;">
        <div class="day-header">${dayHeaderHtml}</div>
        ${laneRowsHtml}
      </div>
    </div>
    <div class="legend">${legendItems}</div>
  `;
}

/* =========================================================================
   6.6) GANTT — línea de tiempo de la COCINA (cada cocimiento + aseos)
   ========================================================================= */
function renderGanttCocina(seq, weekStartRaw) {
  const container = document.getElementById("ganttCocinaContainer");
  if (!container) return;
  if (!seq || !seq.rows.length) {
    container.innerHTML =
      '<p class="empty-note">Sin cocimientos programados esta semana.</p>';
    return;
  }
  const weekStart = new Date(
    Date.UTC(
      weekStartRaw.getUTCFullYear(),
      weekStartRaw.getUTCMonth(),
      weekStartRaw.getUTCDate(),
    ),
  );
  const rows = seq.rows;
  const lastEnd = rows.reduce(
    (max, r) => (r.end.getTime() > max ? r.end.getTime() : max),
    rows[0].end.getTime(),
  );
  const firstStart = rows.reduce(
    (min, r) => (r.start.getTime() < min ? r.start.getTime() : min),
    rows[0].start.getTime(),
  );
  // Las fechas límite pueden caer más tarde que el último cocimiento (ese es justo el conflicto),
  // así que el rango del Gantt debe cubrir también todas las fechas límite definidas.
  const deadlines = [];
  rows.forEach((r) => {
    if (r.deadline) deadlines.push(r.deadline.getTime());
  });
  const lastDeadline = deadlines.length ? Math.max(...deadlines) : lastEnd;
  const rangeStart =
    firstStart < weekStart.getTime() ? new Date(firstStart) : weekStart;
  const rangeEndTime = Math.max(lastEnd, lastDeadline);
  const totalHours = Math.max(
    24,
    Math.ceil((rangeEndTime - rangeStart.getTime()) / 3600000),
  );
  const totalDays = Math.ceil(totalHours / 24);
  const dayWidth = 24 * GANTT_PX_PER_HOUR;
  const totalWidth = totalDays * dayWidth;
  const labelWidth = 96;

  let dayHeaderHtml =
    '<div class="lane-label" style="background:var(--bg2); border-right:1px solid var(--line);"></div>';
  for (let d = 0; d < totalDays; d++) {
    const day = addDays(rangeStart, d);
    dayHeaderHtml += `<div class="day-cell" style="width:${dayWidth}px;"><b>${fmtDate(day)}</b></div>`;
  }

  let dayLinesHtml = "";
  for (let d = 1; d < totalDays; d++) {
    dayLinesHtml += `<div class="day-line" style="left:${d * dayWidth}px;"></div>`;
  }

  // Una línea punteada por cada fecha límite única (una por mosto con producción esta semana).
  const deadlineByMosto = {};
  rows.forEach((r) => {
    if (r.mostoId && r.deadline) deadlineByMosto[r.mostoId] = r.deadline;
  });
  let deadlineLinesHtml = "";
  Object.keys(deadlineByMosto).forEach((mostoId) => {
    const dl = deadlineByMosto[mostoId];
    const left =
      ((dl.getTime() - rangeStart.getTime()) / 3600000) * GANTT_PX_PER_HOUR;
    const bg = colorForMosto(mostoId);
    const excedida = seq.capacityWarnings.some(
      (w) => w.mostoId === mostoId && w.tipo === "deadline",
    );
    deadlineLinesHtml += `<div class="deadline-line" style="left:${left}px; border-color:${excedida ? "var(--danger)" : bg};" title="${escapeHtml("Fecha límite de " + (MOSTO_CATALOG.find((m) => m.id === mostoId) || {}).nombre + ": " + fmtDateTime(dl))}">
      <span style="background:${excedida ? "var(--danger)" : bg};">${escapeHtml((MOSTO_CATALOG.find((m) => m.id === mostoId) || {}).nombre || mostoId)} límite</span>
    </div>`;
  });

  let blocksHtml = "";
  rows.forEach((r) => {
    const left =
      ((r.start.getTime() - rangeStart.getTime()) / 3600000) *
      GANTT_PX_PER_HOUR;
    const width = Math.max(
      5,
      ((r.end.getTime() - r.start.getTime()) / 3600000) * GANTT_PX_PER_HOUR,
    );
    const dur = fmtDuration(r.end - r.start);
    if (r.tipo === "aseo") {
      const titleAttr = escapeHtml(
        `${r.nombre} · ${fmtDateTime(r.start)} → ${fmtDateTime(r.end)} (${dur})`,
      );
      blocksHtml += `<div class="block changeover" style="left:${left}px; width:${width}px;" title="${titleAttr}"><b>🧽</b></div>`;
    } else {
      const bg = colorForMosto(r.mostoId);
      const showText = width >= 46;
      const borderStyle = r.violaDeadline
        ? "box-shadow:inset 0 0 0 2px var(--danger); outline:2px solid var(--danger); outline-offset:-2px;"
        : "";
      const extra = r.violaDeadline
        ? ` ⚠️ excede su fecha límite (${fmtDateTime(r.deadline)})`
        : "";
      const titleAttr = escapeHtml(
        `${r.nombre} · Cocimiento ${r.n} · ${fmtDateTime(r.start)} → ${fmtDateTime(r.end)} (${dur})${extra}`,
      );
      blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${bg}; ${borderStyle}" title="${titleAttr}">${showText ? `<b>${escapeHtml(r.nombre)}${r.violaDeadline ? " ⚠️" : ""}</b><span>${dur}</span>` : ""}</div>`;
    }
  });

  const legendItems =
    MOSTO_CATALOG.map(
      (m) =>
        `<div class="item"><span class="sw" style="background:${colorForMosto(m.id)}"></span>${escapeHtml(m.nombre)}</div>`,
    ).join("") +
    `<div class="item"><span class="sw" style="background:repeating-linear-gradient(45deg,var(--changeover-c1),var(--changeover-c1) 3px,var(--changeover-c2) 3px,var(--changeover-c2) 6px);"></span>Aseo (CIP)</div>` +
    `<div class="item"><span class="sw" style="background:var(--danger); outline:2px solid var(--danger);"></span>Excede fecha límite</div>`;

  container.innerHTML = `
    <div id="ganttCocinaScroll" style="overflow-x:auto; padding:0 0 16px;">
      <div style="position:relative; width:${labelWidth + totalWidth}px;">
        <div class="day-header">${dayHeaderHtml}</div>
        <div class="gantt-row">
          <div class="lane-label">COCINA<small>compartida</small></div>
          <div class="lane-track" style="width:${totalWidth}px; height:64px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}${deadlineLinesHtml}</div>
            ${blocksHtml}
          </div>
        </div>
      </div>
    </div>
    <div class="legend">${legendItems}</div>
  `;
}

/* =========================================================================
   6.7) GANTT — FILTRACIÓN (entrada manual)
        El usuario ya NO carga un Excel: ingresa a mano
          · por fila: hL por diluir, marca y orden de dilución
          · global : tamaño de ciclo (hL), duración del cambio de ciclo,
                     duración del CIP de cambio a Light, flujo de filtración
                     (hL/h) y el tiempo cero I0 (arranque de la filtración).
        A partir de eso se calcula la línea de tiempo: se ordenan las filas por
        "orden de dilución", se arranca en I0 y para cada bloque de marca se
        filtran sus hL al flujo indicado, insertando un "cambio de ciclo" cada
        vez que se completa un ciclo y un "CIP cambio a Light" antes de cada
        marca Light. Se dibuja con las mismas clases/colores que los demás Gantt.
   ========================================================================= */

// Reglas de color específicas de Filtración (categorías más generales que las
// del Gantt de envasado: ESTANDAR, LIGHT, PILSEN, PONY, ASEO...). Se intenta
// primero reutilizar PACKAGING_COLOR_RULES para que, cuando coincida una marca
// exacta, el color sea IDÉNTICO al usado en el Gantt de envasado.
const FILTRACION_ASEO_RE = /\baseo\b|\blimpieza\b|\bcip\b|\bsanitiz|cambio de ciclo/;
const FILTRACION_BRAND_FALLBACK = [
  { test: /estandar|standard/i, bg: "#FFF536", fg: "#000000" },
  { test: /\blight\b/i, bg: "#95DDD2", fg: "#000000" },
  { test: /pilsen/i, bg: "#F2382E", fg: "#000000" },
  { test: /pony/i, bg: "#E2A1B8", fg: "#000000" },
  { test: /poker/i, bg: "#B22D32", fg: "#000000" },
  { test: /cost/i, bg: "#7EAD50", fg: "#000000" },
];
// Paleta de respaldo tomada de los acentos ya definidos en :root de style.css,
// para cualquier marca que no calce con ninguna regla anterior.
const FILTRACION_PALETTE = [
  "#74a7ff",
  "#f8c84c",
  "#4caf82",
  "#f39a2d",
  "#c98f5e",
  "#9fb8d8",
];
function colorForFiltracion(marca, cache) {
  const norm = normalizeText(marca);
  if (FILTRACION_ASEO_RE.test(norm)) return { aseo: true };
  const packagingRule = PACKAGING_COLOR_RULES.find((r) => r.test.test(marca));
  if (packagingRule)
    return { bg: packagingRule.bg, fg: packagingRule.fg, aseo: false };
  const fallbackRule = FILTRACION_BRAND_FALLBACK.find((r) => r.test.test(marca));
  if (fallbackRule)
    return { bg: fallbackRule.bg, fg: fallbackRule.fg, aseo: false };
  const mostoId = matchMosto(marca, MOSTO_CATALOG);
  if (mostoId) return { bg: colorForMosto(mostoId), fg: "#000000", aseo: false };
  if (!cache.map) cache.map = {};
  const key = norm || "—";
  if (!(key in cache.map)) {
    const idx = Object.keys(cache.map).length % FILTRACION_PALETTE.length;
    cache.map[key] = { bg: FILTRACION_PALETTE[idx], fg: "#000000", aseo: false };
  }
  return cache.map[key];
}

/* ---- Estado editable (se guarda en este navegador) --------------------- */
const FILTRACION_LS_KEY = "planFiltracion";
// Marcas seleccionables en la tabla de filtración (lista fija).
const FILTRACION_MARCAS = ["Estandar", "Light", "Pilsen", "Pony"];
const FILTRACION_STATE = {
  i0: "",
  flujoHLh: 0,
  cicloHL: 0,
  cambioCicloH: 0,
  cipLightH: 0,
  // true  = el filtro arranca nuevo en I0 → el primer ciclo tiene capacidad
  //         completa (cicloHL) antes del primer cambio de ciclo.
  // false = el filtro ya venía usado → "restanteCicloHL" dice cuántos hL le
  //         quedan al ciclo actual, así el primer cambio de ciclo se adelanta.
  filtroNuevo: true,
  restanteCicloHL: 0,
  filas: [{ orden: 1, marca: "", hl: 0 }],
  // true = se oculta la configuración (parámetros + tabla) para dejar el Gantt
  // de filtración pegado debajo del de envasado y poder compararlos.
  cfgOculta: false,
};
(function loadFiltracionState() {
  try {
    const raw = JSON.parse(localStorage.getItem(FILTRACION_LS_KEY) || "null");
    if (raw && typeof raw === "object") {
      FILTRACION_STATE.i0 = typeof raw.i0 === "string" ? raw.i0 : "";
      FILTRACION_STATE.flujoHLh = Number(raw.flujoHLh) || 0;
      FILTRACION_STATE.cicloHL = Number(raw.cicloHL) || 0;
      FILTRACION_STATE.cambioCicloH = Number(raw.cambioCicloH) || 0;
      FILTRACION_STATE.cipLightH = Number(raw.cipLightH) || 0;
      FILTRACION_STATE.filtroNuevo = raw.filtroNuevo !== false;
      FILTRACION_STATE.restanteCicloHL = Number(raw.restanteCicloHL) || 0;
      FILTRACION_STATE.cfgOculta = !!raw.cfgOculta;
      if (Array.isArray(raw.filas) && raw.filas.length) {
        FILTRACION_STATE.filas = raw.filas.map((f, i) => ({
          orden: f.orden === "" || f.orden == null ? i + 1 : Number(f.orden),
          marca: String(f.marca || ""),
          hl: Number(f.hl) || 0,
        }));
      }
    }
  } catch (_) {}
})();
function saveFiltracionState() {
  try {
    localStorage.setItem(FILTRACION_LS_KEY, JSON.stringify(FILTRACION_STATE));
  } catch (_) {}
}

/* ---- Cálculo de la línea de tiempo ----------------------------------- */
// Parte un total de hL en tramos de "ciclo" hL (el último tramo puede ser menor).
// "primerTramo" (opcional) limita solo el primer tramo: sirve para cuando el
// filtro no está nuevo y al ciclo actual le quedan menos hL disponibles.
function chunkHLFiltracion(total, ciclo, primerTramo) {
  if (!(ciclo > 0)) return [total];
  const out = [];
  let left = total;
  let cap = primerTramo > 0 ? Math.min(primerTramo, ciclo) : ciclo;
  while (left > 1e-6) {
    const c = Math.min(cap, left);
    out.push(c);
    left -= c;
    cap = ciclo;
  }
  return out.length ? out : [total];
}

function buildFiltracionPlan(st) {
  const i0 = parseInputDateTimeUTC(st.i0);
  const flujo = Number(st.flujoHLh) || 0;
  const ciclo = Number(st.cicloHL) || 0;
  const cambioH = Number(st.cambioCicloH) || 0;
  const cipH = Number(st.cipLightH) || 0;
  const filtroNuevo = st.filtroNuevo !== false;
  // Capacidad del primer ciclo: completa si el filtro está nuevo; si no, los hL
  // que el usuario indica que le faltan al ciclo actual (acotado a [1, cicloHL]).
  let primerCicloHL = ciclo;
  if (!filtroNuevo && ciclo > 0) {
    const r = Number(st.restanteCicloHL);
    primerCicloHL = r > 0 ? Math.min(r, ciclo) : ciclo;
  }

  const filas = (st.filas || [])
    .map((f, i) => ({
      orden: Number(f.orden),
      marca: String(f.marca || "").trim(),
      hl: Number(f.hl) || 0,
      _i: i,
    }))
    .filter((f) => f.marca && f.hl > 0)
    .sort(
      (a, b) =>
        (isNaN(a.orden) ? 1e9 : a.orden) - (isNaN(b.orden) ? 1e9 : b.orden) ||
        a._i - b._i,
    );

  if (!i0)
    return {
      ok: false,
      error: "Ingresa el tiempo cero (I0) para ubicar el inicio de la filtración.",
    };
  if (!(flujo > 0))
    return {
      ok: false,
      error: "Ingresa el flujo de filtración (hL/h) para calcular las duraciones.",
    };
  if (!filas.length)
    return {
      ok: false,
      error: "Agrega al menos una fila con marca y hL por diluir.",
    };

  const segments = [];
  let cursor = i0.getTime();
  let nCip = 0;
  let nCambios = 0;
  // Se inserta un "cambio de ciclo" antes de cada corrida de filtración que
  // venga después de otra corrida de filtración: sea porque una misma marca
  // supera un ciclo (varios tramos) o porque cambia de marca. NO se inserta
  // antes de la primera corrida ni cuando justo antes hubo un CIP a Light.
  let prevFueFiltracion = false;
  let primeraCorrida = true;

  filas.forEach((f) => {
    const isLight = /\blight\b/.test(normalizeText(f.marca));
    if (isLight && cipH > 0) {
      segments.push({
        tipo: "cip",
        marca: "CIP cambio a Light",
        start: new Date(cursor),
        durH: cipH,
      });
      cursor += cipH * 3600000;
      nCip += 1;
      prevFueFiltracion = false;
    }
    const chunks = chunkHLFiltracion(
      f.hl,
      ciclo,
      primeraCorrida ? primerCicloHL : ciclo,
    );
    primeraCorrida = false;
    chunks.forEach((c, idx) => {
      if (prevFueFiltracion && cambioH > 0) {
        segments.push({
          tipo: "cambio",
          marca: "Cambio de ciclo",
          start: new Date(cursor),
          durH: cambioH,
        });
        cursor += cambioH * 3600000;
        nCambios += 1;
      }
      const durH = c / flujo;
      segments.push({
        tipo: "fil",
        marca: f.marca,
        start: new Date(cursor),
        durH,
        hl: c,
        flujo,
        ciclo: chunks.length > 1 ? idx + 1 : 0,
        ciclos: chunks.length,
      });
      cursor += durH * 3600000;
      prevFueFiltracion = true;
    });
  });

  return {
    ok: true,
    segments,
    i0,
    end: new Date(cursor),
    nCip,
    nCambios,
    totalHL: filas.reduce((s, f) => s + f.hl, 0),
    filas: filas.length,
    filtroNuevo,
    primerCicloHL: ciclo > 0 ? primerCicloHL : 0,
  };
}

/* ---- Dibujo del Gantt (mismas clases CSS que envasado/cocina) --------- */
function renderGanttFiltracion(plan) {
  const container = document.getElementById("ganttFiltracionContainer");
  const legendEl = document.getElementById("ganttFiltracionLegend");
  const totalsEl = document.getElementById("ganttFiltracionTotals");
  if (!container) return;
  container.classList.remove("hidden");

  if (!plan || !plan.ok) {
    container.innerHTML = `<p class="empty-note">${escapeHtml(
      (plan && plan.error) || "Completa los parámetros de filtración.",
    )}</p>`;
    if (legendEl) legendEl.innerHTML = "";
    if (totalsEl) totalsEl.textContent = "";
    return;
  }

  const segments = plan.segments;
  const rangeStart = new Date(
    Date.UTC(
      plan.i0.getUTCFullYear(),
      plan.i0.getUTCMonth(),
      plan.i0.getUTCDate(),
    ),
  );
  const lastEndTime = plan.end.getTime();
  const totalHours = Math.max(
    24,
    Math.ceil((lastEndTime - rangeStart.getTime()) / 3600000),
  );
  const totalDays = Math.ceil(totalHours / 24);
  const dayWidth = 24 * GANTT_PX_PER_HOUR;
  const totalWidth = totalDays * dayWidth;
  const labelWidth = 96;

  let dayHeaderHtml =
    '<div class="lane-label" style="background:var(--bg2); border-right:1px solid var(--line);"></div>';
  for (let d = 0; d < totalDays; d++) {
    const day = addDays(rangeStart, d);
    dayHeaderHtml += `<div class="day-cell" style="width:${dayWidth}px;"><b>${fmtDate(day)}</b></div>`;
  }

  let dayLinesHtml = "";
  for (let d = 1; d < totalDays; d++) {
    dayLinesHtml += `<div class="day-line" style="left:${d * dayWidth}px;"></div>`;
  }

  const colorCache = {};
  let blocksHtml = "";
  segments.forEach((seg) => {
    const endTime = new Date(seg.start.getTime() + seg.durH * 3600000);
    const left =
      ((seg.start.getTime() - rangeStart.getTime()) / 3600000) *
      GANTT_PX_PER_HOUR;
    const width = Math.max(4, seg.durH * GANTT_PX_PER_HOUR);
    const dur = fmtDuration(seg.durH * 3600000);
    const showText = width >= 46;

    if (seg.tipo === "fil") {
      const label =
        seg.ciclo > 0 ? `${seg.marca} · ciclo ${seg.ciclo}/${seg.ciclos}` : seg.marca;
      const detalle = `${Math.round(seg.hl).toLocaleString("es-CO")} HL · ${Math.round(
        seg.flujo,
      ).toLocaleString("es-CO")} hL/h · ${dur}`;
      const titleAttr = escapeHtml(
        `${label} · ${fmtDateTime(seg.start)} → ${fmtDateTime(endTime)} (${dur}) · ${Math.round(
          seg.hl,
        ).toLocaleString("es-CO")} HL a ${Math.round(seg.flujo).toLocaleString("es-CO")} hL/h`,
      );
      const col = colorForFiltracion(seg.marca, colorCache);
      blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${col.bg}; color:${col.fg};" title="${titleAttr}">${
        showText
          ? `<b style="color:${col.fg};">${escapeHtml(label)}</b><span style="color:${col.fg};">${detalle}</span>`
          : ""
      }</div>`;
    } else {
      const icon = seg.tipo === "cip" ? "🧼" : "🔁";
      const titleAttr = escapeHtml(
        `${seg.marca} · ${fmtDateTime(seg.start)} → ${fmtDateTime(endTime)} (${dur})`,
      );
      blocksHtml += `<div class="block changeover" style="left:${left}px; width:${width}px;" title="${titleAttr}">${
        showText ? `<b>${escapeHtml(seg.marca)}</b><span>${dur}</span>` : `<b>${icon}</b>`
      }</div>`;
    }
  });

  container.innerHTML = `
    <div id="ganttFiltracionScroll" style="overflow-x:auto; padding:0 0 16px;">
      <div style="position:relative; width:${labelWidth + totalWidth}px;">
        <div class="day-header">${dayHeaderHtml}</div>
        <div class="gantt-row">
          <div class="lane-label">FILTRACIÓN</div>
          <div class="lane-track" style="width:${totalWidth}px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}</div>
            ${blocksHtml}
          </div>
        </div>
      </div>
    </div>
  `;

  // Leyenda (mismas clases .legend/.item/.sw que los demás Gantt).
  const legendMap = {};
  segments.forEach((s) => {
    const key = normalizeText(s.marca);
    if (!(key in legendMap))
      legendMap[key] = { label: s.marca, col: colorForFiltracion(s.marca, colorCache) };
  });
  const legendItems = Object.values(legendMap)
    .map(({ label, col }) => {
      const sw = col.aseo
        ? "background:repeating-linear-gradient(45deg,var(--changeover-c1),var(--changeover-c1) 3px,var(--changeover-c2) 3px,var(--changeover-c2) 6px);"
        : `background:${col.bg};`;
      return `<div class="item"><span class="sw" style="${sw}"></span>${escapeHtml(label)}</div>`;
    })
    .join("");
  if (legendEl) legendEl.innerHTML = legendItems;

  if (totalsEl) {
    const durTotal = fmtDuration(lastEndTime - plan.i0.getTime());
    totalsEl.textContent =
      `Inicio (I0): ${fmtDateTime(plan.i0)} → Fin: ${fmtDateTime(plan.end)}` +
      `  ·  Duración total: ${durTotal}` +
      `  ·  Bloques de marca: ${plan.filas}` +
      `  ·  Total a diluir: ${Math.round(plan.totalHL).toLocaleString("es-CO")} HL` +
      `  ·  Cambios de ciclo: ${plan.nCambios}` +
      `  ·  CIP cambio a Light: ${plan.nCip}` +
      (plan.filtroNuevo
        ? `  ·  Filtro nuevo en I0`
        : `  ·  Ciclo inicial: ${Math.round(plan.primerCicloHL).toLocaleString("es-CO")} hL restantes`);
  }
}

/* ---- Panel de UI: parámetros + tabla editable ------------------------- */
function recomputeFiltracion() {
  saveFiltracionState();
  renderGanttFiltracion(buildFiltracionPlan(FILTRACION_STATE));
}

function renderFiltracionFilas() {
  const wrap = document.getElementById("filtracionFilasWrap");
  if (!wrap) return;
  const rows = FILTRACION_STATE.filas
    .map((f, i) => {
      const marca = String(f.marca || "");
      const opciones = FILTRACION_MARCAS.slice();
      if (marca && !opciones.includes(marca)) opciones.push(marca);
      const optionsHtml =
        `<option value="">— Marca —</option>` +
        opciones
          .map(
            (m) =>
              `<option value="${escapeHtml(m)}"${m === marca ? " selected" : ""}>${escapeHtml(m)}</option>`,
          )
          .join("");
      return `
      <tr>
        <td><input type="number" step="1" class="cat-input" style="width:80px;"
              data-fil-field="orden" data-fil-idx="${i}" value="${f.orden ?? ""}" /></td>
        <td><select class="cat-input" style="min-width:150px;"
              data-fil-field="marca" data-fil-idx="${i}">${optionsHtml}</select></td>
        <td><input type="number" step="1" min="0" class="cat-input" style="width:120px;"
              data-fil-field="hl" data-fil-idx="${i}" value="${f.hl || ""}" /></td>
        <td class="cat-remove"><button class="btn small" type="button"
              data-fil-remove="${i}" title="Quitar fila">✕</button></td>
      </tr>`;
    })
    .join("");
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Orden de dilución</th><th>Marca</th><th>hL por diluir</th><th></th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="empty-note">Sin filas. Agrega la primera.</td></tr>'}</tbody>
    </table>`;

  wrap.querySelectorAll("[data-fil-field]").forEach((inp) => {
    const evt = inp.tagName === "SELECT" ? "change" : "input";
    inp.addEventListener(evt, () => {
      const idx = Number(inp.dataset.filIdx);
      const field = inp.dataset.filField;
      if (!FILTRACION_STATE.filas[idx]) return;
      FILTRACION_STATE.filas[idx][field] =
        field === "marca" ? inp.value : inp.value === "" ? "" : Number(inp.value);
      recomputeFiltracion();
    });
  });
  wrap.querySelectorAll("[data-fil-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      FILTRACION_STATE.filas.splice(Number(btn.dataset.filRemove), 1);
      renderFiltracionFilas();
      recomputeFiltracion();
    });
  });
}

function initFiltracionPanel() {
  if (document.getElementById("ganttFiltracionPanel")) return;

  const panel = document.createElement("section");
  panel.id = "ganttFiltracionPanel";
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-head">
      <h3>Gantt de Filtración</h3>
      <button class="btn small" id="filtracionToggleCfgBtn" type="button">▾ Ocultar configuración</button>
    </div>
    <div class="panel-body">
      <div id="filtracionConfigWrap">
        <div class="fil-params">
          <div class="fil-field">
            <label class="field">Tiempo cero I0 (inicio de filtración)</label>
            <input type="datetime-local" id="filI0" />
          </div>
          <div class="fil-field">
            <label class="field">Flujo de filtración (hL/h)</label>
            <input type="number" min="0" step="1" class="cat-input" id="filFlujo" placeholder="p. ej. 700" />
          </div>
          <div class="fil-field">
            <label class="field">Tamaño de ciclo (hL que dura un ciclo)</label>
            <input type="number" min="0" step="1" class="cat-input" id="filCiclo" placeholder="p. ej. 3000" />
          </div>
          <div class="fil-field">
            <label class="field">Filtro nuevo en I0</label>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;min-height:31px;">
              <input type="checkbox" id="filFiltroNuevo" style="width:16px;height:16px;" />
              <span>Sí, arranca nuevo</span>
            </label>
          </div>
          <div class="fil-field" id="filRestanteField">
            <label class="field">hL que faltan del ciclo actual</label>
            <input type="number" min="0" step="1" class="cat-input" id="filRestanteCiclo" placeholder="p. ej. 1200" />
          </div>
          <div class="fil-field">
            <label class="field">Duración cambio de ciclo (hh:mm:ss)</label>
            <input type="text" class="cat-input cat-time" id="filCambioCiclo" placeholder="0:30:00" />
          </div>
          <div class="fil-field">
            <label class="field">Duración CIP cambio a Light (hh:mm:ss)</label>
            <input type="text" class="cat-input cat-time" id="filCipLight" placeholder="8:00:00" />
          </div>
        </div>
        <div class="table-scroll" id="filtracionFilasWrap"></div>
        <div style="margin-top:12px;">
          <button class="btn small" id="filtracionAddFilaBtn" type="button">+ Agregar fila</button>
        </div>
        <div id="filtracionStatus" style="font-family:var(--mono); font-size:12px; color:var(--muted); margin-top:10px; min-height:16px;"></div>
      </div>
      <div id="ganttFiltracionContainer" class="hidden"></div>
      <div class="legend" id="ganttFiltracionLegend"></div>
      <div id="ganttFiltracionTotals" style="font-family:var(--mono); font-size:12px; color:var(--muted); padding:0 20px 14px;"></div>
    </div>
  `;

  const filtracionHost = document.getElementById("view-gantt-filtracion");
  const anchor = document.getElementById("ganttTopPanel");
  if (filtracionHost) {
    filtracionHost.appendChild(panel);
  } else if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
  } else {
    (document.querySelector(".container") || document.body).appendChild(panel);
  }

  const i0Input = document.getElementById("filI0");
  const flujoInput = document.getElementById("filFlujo");
  const cicloInput = document.getElementById("filCiclo");
  const cambioInput = document.getElementById("filCambioCiclo");
  const cipInput = document.getElementById("filCipLight");
  const filtroNuevoInput = document.getElementById("filFiltroNuevo");
  const restanteInput = document.getElementById("filRestanteCiclo");
  const restanteField = document.getElementById("filRestanteField");

  i0Input.value = FILTRACION_STATE.i0 || "";
  flujoInput.value = FILTRACION_STATE.flujoHLh || "";
  cicloInput.value = FILTRACION_STATE.cicloHL || "";
  filtroNuevoInput.checked = FILTRACION_STATE.filtroNuevo !== false;
  restanteInput.value = FILTRACION_STATE.restanteCicloHL || "";
  function applyFiltroNuevo() {
    restanteField.classList.toggle("hidden", filtroNuevoInput.checked);
  }
  applyFiltroNuevo();
  cambioInput.value = FILTRACION_STATE.cambioCicloH
    ? formatHMS(FILTRACION_STATE.cambioCicloH)
    : "";
  cipInput.value = FILTRACION_STATE.cipLightH
    ? formatHMS(FILTRACION_STATE.cipLightH)
    : "";

  i0Input.addEventListener("change", () => {
    FILTRACION_STATE.i0 = i0Input.value;
    recomputeFiltracion();
  });
  flujoInput.addEventListener("input", () => {
    FILTRACION_STATE.flujoHLh = Number(flujoInput.value) || 0;
    recomputeFiltracion();
  });
  cicloInput.addEventListener("input", () => {
    FILTRACION_STATE.cicloHL = Number(cicloInput.value) || 0;
    recomputeFiltracion();
  });
  filtroNuevoInput.addEventListener("change", () => {
    FILTRACION_STATE.filtroNuevo = filtroNuevoInput.checked;
    applyFiltroNuevo();
    recomputeFiltracion();
  });
  restanteInput.addEventListener("input", () => {
    FILTRACION_STATE.restanteCicloHL = Number(restanteInput.value) || 0;
    recomputeFiltracion();
  });
  cambioInput.addEventListener("change", () => {
    FILTRACION_STATE.cambioCicloH = parseHMS(cambioInput.value);
    cambioInput.value = FILTRACION_STATE.cambioCicloH
      ? formatHMS(FILTRACION_STATE.cambioCicloH)
      : "";
    recomputeFiltracion();
  });
  cipInput.addEventListener("change", () => {
    FILTRACION_STATE.cipLightH = parseHMS(cipInput.value);
    cipInput.value = FILTRACION_STATE.cipLightH
      ? formatHMS(FILTRACION_STATE.cipLightH)
      : "";
    recomputeFiltracion();
  });
  document
    .getElementById("filtracionAddFilaBtn")
    .addEventListener("click", () => {
      const maxOrden = FILTRACION_STATE.filas.reduce(
        (m, f) => Math.max(m, Number(f.orden) || 0),
        0,
      );
      FILTRACION_STATE.filas.push({ orden: maxOrden + 1, marca: "", hl: 0 });
      renderFiltracionFilas();
      recomputeFiltracion();
    });

  // Ocultar/mostrar la configuración para comparar los dos Gantt uno sobre otro.
  const cfgWrap = document.getElementById("filtracionConfigWrap");
  const toggleCfgBtn = document.getElementById("filtracionToggleCfgBtn");
  function applyCfgOculta() {
    cfgWrap.classList.toggle("hidden", FILTRACION_STATE.cfgOculta);
    toggleCfgBtn.textContent = FILTRACION_STATE.cfgOculta
      ? "▸ Mostrar configuración"
      : "▾ Ocultar configuración";
  }
  toggleCfgBtn.addEventListener("click", () => {
    FILTRACION_STATE.cfgOculta = !FILTRACION_STATE.cfgOculta;
    applyCfgOculta();
    saveFiltracionState();
  });
  applyCfgOculta();

  renderFiltracionFilas();
  recomputeFiltracion();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFiltracionPanel);
} else {
  initFiltracionPanel();
}
