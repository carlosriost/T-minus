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
// Cursor de tiempo compartido entre el Gantt de envasado y el de filtración,
// para analizar ambos en el mismo instante. Cada Gantt guarda su rangeStart
// (ms) en el dataset de su contenedor; ganttLinkCursor(ms) coloca la línea
// vertical en los dos a la vez (ms = null la oculta).
let FIL_CURSOR_READOUT = null; // (ms) => string · lo fija renderGanttFiltracion
function ganttLinkCursor(ms) {
  const envC = document.getElementById("ganttContainer");
  const envWrap = document.getElementById("ganttWrap");
  const envLine = envWrap && envWrap.querySelector(".gantt-xcursor");
  if (envWrap && envLine) {
    const rs = envC && Number(envC.dataset.rangeStart);
    if (ms == null || !rs) {
      envLine.hidden = true;
    } else {
      const x = 96 + ((ms - rs) / 3600000) * GANTT_PX_PER_HOUR;
      if (x >= 96 && x <= envWrap.offsetWidth) {
        envLine.hidden = false;
        envLine.style.left = x + "px";
      } else {
        envLine.hidden = true;
      }
    }
  }
  const filC = document.getElementById("ganttFiltracionContainer");
  const filLine = filC && filC.querySelector(".fil-cursor");
  const filTrack = filC && filC.querySelector(".lane-track");
  if (filLine && filTrack) {
    const rs = Number(filC.dataset.rangeStart);
    const w = parseFloat(filTrack.style.width) || 0;
    if (ms == null || !rs) {
      filLine.hidden = true;
    } else {
      const x = ((ms - rs) / 3600000) * GANTT_PX_PER_HOUR;
      if (x >= 0 && x <= w) {
        filLine.hidden = false;
        filLine.style.left = x + "px";
      } else {
        filLine.hidden = true;
      }
    }
  }
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
      const vel = Number(b.velocidad) || 0;
      const efi = Number(b.eficiencia) || 0;
      const velTxt =
        b.type === "production" && vel > 0
          ? `${Math.round(vel).toLocaleString("es-CO")} hL/h` +
            (efi > 0 ? ` · ${Math.round(efi * 100)}% ef` : "")
          : "";
      const titleAttr = escapeHtml(
        `${b.name || b.codigo || ""} · ${fmtDateTime(b.start)} → ${fmtDateTime(b.end)} (${dur})` +
          (velTxt
            ? ` · Velocidad ${Math.round(vel).toLocaleString("es-CO")} hL/h` +
              (efi > 0 ? ` · Eficiencia ${Math.round(efi * 100)}%` : "") +
              (efi > 0
                ? ` · Efectiva ${Math.round(vel * efi).toLocaleString("es-CO")} hL/h`
                : "")
            : ""),
      );
      if (b.type === "production") {
        const colors = colorForPackagingEvent(b);
        const showText = width >= 22;
        const detalle = velTxt ? `${dur} · ${velTxt}` : dur;
        blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${colors.bg}; color:${colors.fg};" title="${titleAttr}">${showText ? `<b style="color:${colors.fg};">${escapeHtml(b.name || b.codigo || "")}</b><span style="color:${colors.fg};">${detalle}</span>` : ""}</div>`;
      } else if (b.type === "changeover") {
        blocksHtml += `<div class="block changeover" style="left:${left}px; width:${width}px;" title="${titleAttr}"><b>🧽</b></div>`;
      } else {
        const bg = TRAIN_EVENT_COLORS[b.type] || TRAIN_EVENT_COLORS.other;
        const showText = width >= 22;
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
        <div class="gantt-xcursor" hidden></div>
      </div>
    </div>
    <div class="legend">${legendItems}</div>
  `;

  // Cursor de tiempo enlazado con el Gantt de filtración.
  container.dataset.rangeStart = rangeStart.getTime();
  const envWrap = document.getElementById("ganttWrap");
  if (envWrap) {
    envWrap.addEventListener("mousemove", (e) => {
      const r = envWrap.getBoundingClientRect();
      const xTrack = e.clientX - r.left - labelWidth;
      if (xTrack < 0) {
        ganttLinkCursor(null);
        return;
      }
      const ms =
        rangeStart.getTime() + (xTrack / GANTT_PX_PER_HOUR) * 3600000;
      ganttLinkCursor(ms);
      const infoEl = document.getElementById("ganttFiltracionCursorInfo");
      if (infoEl && typeof FIL_CURSOR_READOUT === "function")
        infoEl.textContent = FIL_CURSOR_READOUT(ms);
    });
    envWrap.addEventListener("mouseleave", () => {
      ganttLinkCursor(null);
      const infoEl = document.getElementById("ganttFiltracionCursorInfo");
      if (infoEl) infoEl.textContent = "";
    });
  }
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
      const showText = width >= 22;
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
  // Tasa a la que las líneas de envasado vacían los BBTs (hL/h). Si queda en 0
  // y hay un instructivo cargado, se usa la velocidad efectiva real de las
  // líneas activas en cada instante (velocidad × eficiencia).
  desalojoHLh: 0,
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
      FILTRACION_STATE.desalojoHLh = Number(raw.desalojoHLh) || 0;
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

  // Modelo de ciclos: un ciclo se llena SIEMPRE hasta "ciclo" hL, aunque para
  // ello se combinen hL de marcas distintas dentro del mismo ciclo (no se hace
  // cambio de ciclo solo por cambiar de marca). Única excepción: Light.
  //   · de Light  -> otra marca en el mismo ciclo: permitido.
  //   · de otra marca -> Light en el mismo ciclo: NO. Antes de una corrida
  //     Light se cierra el ciclo si ya tiene hL de otra marca.
  const cicloCap = ciclo > 0 ? ciclo : Infinity;
  let capRestante = filtroNuevo
    ? cicloCap
    : Math.min(primerCicloHL > 0 ? primerCicloHL : cicloCap, cicloCap);
  let cicloTieneNoLight = !filtroNuevo && capRestante < cicloCap - 1e-6;
  let nCiclo = 1;
  let prevWasLight = false;

  function cerrarCiclo() {
    if (cambioH > 0) {
      segments.push({
        tipo: "cambio",
        marca: "Cambio de ciclo",
        start: new Date(cursor),
        durH: cambioH,
      });
      cursor += cambioH * 3600000;
      nCambios += 1;
    }
    capRestante = cicloCap;
    cicloTieneNoLight = false;
    nCiclo += 1;
  }

  filas.forEach((f, idx) => {
    const isLight = /\blight\b/.test(normalizeText(f.marca));

    // Regla Light: un ciclo no puede pasar de [otra marca] -> [Light].
    if (
      isLight &&
      Number.isFinite(cicloCap) &&
      cicloTieneNoLight &&
      capRestante < cicloCap - 1e-6
    ) {
      cerrarCiclo();
    }

    // CIP solo al cambiar de [otra marca] -> [Light]. No hay CIP entre Light y
    // Light, ni cuando la filtración arranca directamente con Light (idx 0): se
    // asume que ese aseo ya se hizo antes de I0.
    if (isLight && !prevWasLight && cipH > 0 && idx > 0) {
      segments.push({
        tipo: "cip",
        marca: "CIP cambio a Light",
        start: new Date(cursor),
        durH: cipH,
      });
      cursor += cipH * 3600000;
      nCip += 1;
    }

    let pending = f.hl;
    while (pending > 1e-6) {
      if (capRestante <= 1e-6) cerrarCiclo(); // ciclo lleno -> uno nuevo
      const take = Math.min(pending, capRestante);
      segments.push({
        tipo: "fil",
        marca: f.marca,
        start: new Date(cursor),
        durH: take / flujo,
        hl: take,
        flujo,
        cicloNum: Number.isFinite(cicloCap) ? nCiclo : 0,
      });
      cursor += (take / flujo) * 3600000;
      pending -= take;
      capRestante -= take;
      if (!isLight) cicloTieneNoLight = true;
    }
    prevWasLight = isLight;
  });

  return {
    ok: true,
    segments,
    i0,
    end: new Date(cursor),
    nCip,
    nCambios,
    nCiclos: Number.isFinite(cicloCap) ? nCiclo : 0,
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
    const info = document.getElementById("ganttFiltracionCursorInfo");
    if (info) info.textContent = "";
    const al = document.getElementById("ganttFiltracionAlert");
    if (al) al.innerHTML = "";
    FIL_CURSOR_READOUT = null;
    ganttLinkCursor(null);
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
    const showText = width >= 22;

    if (seg.tipo === "fil") {
      const label =
        seg.cicloNum > 0 ? `${seg.marca} · ciclo ${seg.cicloNum}` : seg.marca;
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

  // ---- Cuánto se ha diluido / falta por diluir en un instante -------------
  const totalHLplan = Math.round(plan.totalHL);
  function diluidoHasta(ms) {
    let d = 0;
    for (const s of segments) {
      if (s.tipo !== "fil") continue;
      const a = s.start.getTime();
      const b = a + s.durH * 3600000;
      if (ms >= b) d += s.hl;
      else if (ms > a) d += (s.hl * (ms - a)) / (b - a);
    }
    return Math.min(totalHLplan, d);
  }
  const faltaPorDiluir = (ms) => Math.max(0, totalHLplan - diluidoHasta(ms));

  // ---- Espacio en BBTs — del simulador tanque por tanque (mismo modelo que
  //      la vista "BBTs en el tiempo"):
  //        · el espacio GENERAL crece a medida que el envasado desaloja;
  //        · el espacio POR MARCA solo cuenta los BBT vacíos + los que ya
  //          tienen ESA misma marca (un BBT de Pilsen no es espacio para Light);
  //        · no hay espacio si, para la marca en curso, no queda capacidad.
  const desalojoManual = Number(FILTRACION_STATE.desalojoHLh) || 0;
  const bbtSim =
    typeof simulateBBTLifecycle === "function"
      ? simulateBBTLifecycle(plan)
      : { ok: false };

  let bbtCapTotal = 0;
  let bbtFill0 = 0;
  let fillMs = null;
  let hlSinDiluir = 0;
  let espacioAt = () => ({ general: 0, marca: 0, brand: null });

  if (bbtSim.ok) {
    bbtCapTotal = bbtSim.tanks.reduce((s, t) => s + t.cap, 0);
    bbtFill0 = bbtSim.tanks.reduce(
      (s, t) => s + ((t.niveles[0] && t.niveles[0].hL) || 0),
      0,
    );
    fillMs = bbtSim.fillMs;
    hlSinDiluir = bbtSim.hlSinDiluir;

    const nivelAt = (niveles, ms) => {
      if (!niveles || !niveles.length) return null;
      if (ms <= niveles[0].ms) return niveles[0];
      const last = niveles[niveles.length - 1];
      if (ms >= last.ms) return last;
      let lo = 0;
      let hi = niveles.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (niveles[mid].ms <= ms) lo = mid;
        else hi = mid;
      }
      return niveles[lo];
    };
    const marcaActivaAt = (ms) => {
      for (const s of segments) {
        if (s.tipo !== "fil") continue;
        const a = s.start.getTime();
        if (ms >= a && ms < a + s.durH * 3600000)
          return (s.marca || "").trim() || null;
      }
      return null;
    };
    // Igualdad de marca laxa: "aguila light" ~ "light".
    const brandEq = (a, b) =>
      !!a && !!b && (a === b || a.includes(b) || b.includes(a));
    espacioAt = (ms) => {
      const brand = marcaActivaAt(ms);
      const bk = brand ? normalizeText(brand) : null;
      let general = 0;
      let marca = 0;
      bbtSim.tanks.forEach((t) => {
        const n = nivelAt(t.niveles, ms) || { hL: 0, marca: null };
        const libre = Math.max(0, t.cap - n.hL);
        general += libre;
        if (!bk) return;
        // Un BBT VACÍO del todo sirve para cualquier marca: cuenta su capacidad.
        // Un BBT CON LÍQUIDO solo cuenta si es de ESTA misma marca, y solo su
        // hueco (cap − hL), porque se puede rellenar con esa misma marca.
        // Un BBT con líquido de otra marca no cuenta hasta quedar vacío.
        if (n.hL <= 1e-6 || brandEq(normalizeText(n.marca || ""), bk))
          marca += libre;
      });
      return { general, marca, brand };
    };
  }
  const xFill = fillMs
    ? ((fillMs - rangeStart.getTime()) / 3600000) * GANTT_PX_PER_HOUR
    : 0;
  const markHtml = fillMs
    ? `<div class="fil-fill-shade" style="left:${xFill}px; width:${Math.max(0, totalWidth - xFill)}px;"></div>` +
      `<div class="fil-fill-mark" style="left:${xFill}px;" title="BBTs llenos"></div>`
    : "";

  container.innerHTML = `
    <div id="ganttFiltracionScroll" style="overflow-x:auto; padding:0 0 16px;">
      <div style="position:relative; width:${labelWidth + totalWidth}px;">
        <div class="day-header">${dayHeaderHtml}</div>
        <div class="gantt-row">
          <div class="lane-label">FILTRACIÓN</div>
          <div class="lane-track" style="width:${totalWidth}px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}</div>
            ${markHtml}
            ${blocksHtml}
            <div class="fil-cursor" hidden></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Aviso de BBTs.
  const alertEl = document.getElementById("ganttFiltracionAlert");
  if (alertEl) {
    if (fillMs) {
      const eF = espacioAt(fillMs);
      alertEl.innerHTML = `<div style="border:1px solid rgba(237,28,43,.4); background:rgba(237,28,43,.08); border-radius:4px; padding:10px 14px; margin:6px 0 12px; color:var(--danger); font-size:12.5px;">
        <b>⚠️ No se puede completar la filtración: no hay BBT para la marca en curso.</b>
        ${bbtSim.tanks.length} BBT · ${Math.round(bbtCapTotal).toLocaleString("es-CO")} HL (${Math.round(bbtFill0).toLocaleString("es-CO")} HL ocupados al inicio)${
          desalojoManual > 0
            ? `, desalojo ${Math.round(desalojoManual).toLocaleString("es-CO")} hL/h`
            : ", desalojo según las líneas del instructivo"
}. Un BBT solo admite su misma marca y solo se libera cuando el envasado lo vacía. Sin espacio${eF.brand ? " para " + escapeHtml(eF.brand) : ""} a partir de <b>${fmtDateTime(new Date(fillMs))}</b> — quedarían <b>${Math.round(hlSinDiluir).toLocaleString("es-CO")} HL</b> sin diluir.</div>`;
    } else if (bbtCapTotal <= 0) {
      alertEl.innerHTML = `<div style="color:var(--muted); font-size:11.5px; padding:4px 0 8px;">Marca BBTs disponibles con capacidad en «Equipos / Tanques» para verificar el espacio de dilución.</div>`;
    } else {
      alertEl.innerHTML = `<div style="border:1px solid rgba(76,175,130,.35); background:rgba(76,175,130,.08); border-radius:4px; padding:8px 14px; margin:6px 0 12px; color:var(--ok); font-size:12px;">✓ Hay BBT para toda la filtración · ${bbtSim.tanks.length} BBT · ${Math.round(bbtCapTotal).toLocaleString("es-CO")} HL · ${Math.round(bbtFill0).toLocaleString("es-CO")} HL ocupados al inicio.</div>`;
    }
  }

  // ---- Línea vertical + lectura al pasar el cursor (enlazada con envasado) --
  container.dataset.rangeStart = rangeStart.getTime();
  const infoEl = document.getElementById("ganttFiltracionCursorInfo");
  FIL_CURSOR_READOUT = (ms) => {
    const e = espacioAt(ms);
    return (
      `${fmtDateTime(new Date(ms))}` +
      `  ·  faltan ${Math.round(faltaPorDiluir(ms)).toLocaleString("es-CO")} HL por diluir` +
      (bbtCapTotal > 0
        ? `  ·  espacio BBTs general: ${Math.round(e.general).toLocaleString("es-CO")} HL` +
          (e.brand
            ? `  ·  espacio BBTs ${e.brand}: ${Math.round(e.marca).toLocaleString("es-CO")} HL`
            : "")
        : "")
    );
  };
  const track = container.querySelector(".lane-track");
  if (track) {
    track.addEventListener("mousemove", (e) => {
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(totalWidth, e.clientX - rect.left));
      const ms = rangeStart.getTime() + (x / GANTT_PX_PER_HOUR) * 3600000;
      ganttLinkCursor(ms);
      if (infoEl) infoEl.textContent = FIL_CURSOR_READOUT(ms);
    });
    track.addEventListener("mouseleave", () => {
      ganttLinkCursor(null);
      if (infoEl) infoEl.textContent = "";
    });
  }

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
      (plan.nCiclos ? `  ·  Ciclos: ${plan.nCiclos}` : "") +
      `  ·  Cambios de ciclo: ${plan.nCambios}` +
      `  ·  CIP cambio a Light: ${plan.nCip}` +
      (plan.filtroNuevo
        ? `  ·  Filtro nuevo en I0`
        : `  ·  Ciclo inicial: ${Math.round(plan.primerCicloHL).toLocaleString("es-CO")} hL restantes`);
  }
}

/* ====================================================================== *
 *  BBTs EN EL TIEMPO — ciclo de vida de cada BBT (tanque por tanque)
 *  Solo para visualización: no toca la alerta ni el cálculo por marca.
 *    · un BBT se llena hasta SU capacidad (no un pool);
 *    · solo admite producto de SU MISMA marca (marca real del inventario,
 *      no el mosto: Costeñita ≠ Poker aunque compartan mosto);
 *    · llenar y enviar a envase no ocurren a la vez en un mismo BBT.
 * ====================================================================== */
function simulateBBTLifecycle(plan) {
  // Se calcula una vez por ciclo de recálculo: lo usan tanto renderGanttFiltracion
  // (espacio en BBTs + aviso) como renderBBTTimeline (Gantt por tanque + gauges).
  if (plan && plan.__bbtSim) return plan.__bbtSim;
  const _memo = (r) => {
    if (plan) {
      try {
        Object.defineProperty(plan, "__bbtSim", { value: r, enumerable: false });
      } catch (_) {}
    }
    return r;
  };
  if (!plan || !plan.ok) {
    return _memo({
      ok: false,
      error:
        (plan && plan.error) ||
        "Completa los parámetros de filtración para simular los BBTs.",
    });
  }
  const nText = (x) => normalizeText(String(x || ""));
  const segments = plan.segments || [];
  const cambioEnvaseMs = (Number(FILTRACION_STATE.cambioEnvaseH) || 0) * 3600000;
  const desalojoManual = Number(FILTRACION_STATE.desalojoHLh) || 0;
  const trainsBlocks =
    (typeof STATE !== "undefined" && STATE && STATE.mergedByTrain) || {};
  const i0ms = plan.i0.getTime();
  const endMs = plan.end.getTime();
  const totalHLplan = Math.round(plan.totalHL || 0);

  const capByKey = {};
  const nameByKey = {};
  if (typeof TANK_CATALOG !== "undefined") {
    (TANK_CATALOG || [])
      .filter((t) => t.tipo === "BBT" && t.disponible !== false)
      .forEach((t) => {
        const k = nText(t.equipo);
        capByKey[k] = Number(t.capacidadHL) || 0;
        nameByKey[k] = t.equipo;
      });
  }
  const capVals = Object.values(capByKey).filter((v) => v > 0);
  const capDefault = capVals.length ? Math.max(...capVals) : 1300;

  const slots = [];
  const invKeys = new Set();
  if (typeof INVENTORY_BALANCE !== "undefined") {
    (INVENTORY_BALANCE || [])
      .filter((e) => e.tipo === "BBT")
      .forEach((e, idx) => {
        const k = nText(e.equipo);
        invKeys.add(k);
        const cap = capByKey[k] || Math.max(Number(e.hL) || 0, capDefault);
        slots.push({
          equipo: e.equipo || nameByKey[k] || "BBT " + (idx + 1),
          cap,
          hL: Math.max(0, Math.round(Number(e.hL) || 0)),
          brandKey: nText(e.marcaTexto) || null,
          marca: (e.marcaTexto || "").trim() || null,
          mostoId: matchMosto(e.marcaTexto, MOSTO_CATALOG),
          estado: "envase",
          libreEn: i0ms,
        });
      });
  }
  Object.keys(capByKey).forEach((k) => {
    if (invKeys.has(k)) return;
    slots.push({
      equipo: nameByKey[k] || k.toUpperCase(),
      cap: capByKey[k],
      hL: 0,
      brandKey: null,
      marca: null,
      mostoId: null,
      estado: "vacio",
      libreEn: i0ms,
    });
  });
  if (!slots.length) {
    return {
      ok: false,
      error:
        "No hay BBTs disponibles en «Equipos / Tanques» ni en el inventario de producto en proceso.",
    };
  }

  function filAt(ms) {
    for (const s of segments) {
      if (s.tipo !== "fil") continue;
      const a = s.start.getTime();
      const b = a + s.durH * 3600000;
      if (ms >= a && ms < b)
        return {
          flujo: Number(s.flujo) || 0,
          marca: (s.marca || "").trim() || null,
          mostoId: matchMosto(s.marca, MOSTO_CATALOG),
        };
    }
    return { flujo: 0, marca: null, mostoId: null };
  }
  function packAt(ms) {
    const out = [];
    Object.keys(trainsBlocks).forEach((k) => {
      (trainsBlocks[k] || []).forEach((bl) => {
        if (bl.type !== "production") return;
        if (!(bl.start.getTime() <= ms && ms < bl.end.getTime())) return;
        const rate = (Number(bl.velocidad) || 0) * (Number(bl.eficiencia) || 0);
        if (rate > 0)
          out.push({
            nkey: nText(bl.name || bl.codigo),
            mostoId: matchMosto(bl.name || bl.codigo, MOSTO_CATALOG),
            rate,
          });
      });
    });
    return out;
  }
  const packMatches = (slot, p) =>
    slot.brandKey
      ? p.nkey.includes(slot.brandKey) || slot.brandKey.includes(p.nkey)
      : !!slot.mostoId && p.mostoId === slot.mostoId;

  const estadoVis = (s, drained) => {
    if (s.estado === "vacio") return "vacío";
    if (s.estado === "llenando") return "llenando";
    if (s.estado === "postllenado") return "lleno";
    if (s.estado === "aseo") return "aseo";
    return drained ? "enviando" : "lleno";
  };

  const dtMs = 5 * 60000;
  const tanks = slots.map((s) => ({ equipo: s.equipo, cap: s.cap, hist: [], niveles: [] }));
  const prev = slots.map(() => null);
  let llenando = null;
  let fillMs = null;
  let hlFiltrados = 0;

  for (let ms = i0ms; ms <= endMs + dtMs; ms += dtMs) {
    slots.forEach((s) => {
      if (s.estado === "postllenado" && s.libreEn <= ms) s.estado = "envase";
      if (s.estado === "aseo" && s.libreEn <= ms) {
        s.estado = "vacio";
        s.brandKey = null;
        s.marca = null;
        s.mostoId = null;
        s.hL = 0;
      }
    });

    const drained = slots.map(() => false);
    const lineas =
      desalojoManual > 0 ? [{ global: true, rate: desalojoManual }] : packAt(ms);
    lineas.forEach((p) => {
      let out = (p.rate * dtMs) / 3600000;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (out <= 1e-6) break;
        if (s.estado !== "envase" || s.hL <= 1e-6) continue;
        if (!p.global && !packMatches(s, p)) continue;
        const take = Math.min(out, s.hL);
        s.hL -= take;
        out -= take;
        drained[i] = true;
        if (s.hL <= 1e-6) {
          s.estado = "aseo";
          s.libreEn = ms + cambioEnvaseMs;
        }
      }
    });

    const f = filAt(ms);
    if (f.flujo > 0) {
      let need = (f.flujo * dtMs) / 3600000;
      let guard = 0;
      while (need > 1e-6 && guard++ < 128) {
        if (!llenando || llenando.estado !== "llenando") {
          llenando =
            slots.find((s) => s.estado === "llenando") ||
            slots.find((s) => s.estado === "vacio" && s.libreEn <= ms) ||
            null;
          if (llenando) {
            llenando.estado = "llenando";
            llenando.mostoId = f.mostoId;
            llenando.marca = f.marca;
            llenando.brandKey = f.marca ? nText(f.marca) : null;
          }
        }
        if (!llenando) {
          if (fillMs == null) fillMs = ms;
          break;
        }
        const room = llenando.cap - llenando.hL;
        const take = Math.min(need, room);
        llenando.hL += take;
        hlFiltrados += take;
        need -= take;
        if (llenando.hL >= llenando.cap - 1e-6) {
          llenando.estado = "postllenado";
          llenando.libreEn = ms + cambioEnvaseMs;
          llenando = null;
        }
      }
    }

    slots.forEach((s, i) => {
      const ev = estadoVis(s, drained[i]);
      const mk = s.marca || null;
      tanks[i].niveles.push({ ms, hL: Math.round(s.hL), estadoVis: ev, marca: mk });
      const p = prev[i];
      if (!p || p.ev !== ev || p.mk !== mk) {
        if (p) p.seg.endMs = ms;
        const seg = { estadoVis: ev, marca: mk, startMs: ms, endMs: ms + dtMs };
        tanks[i].hist.push(seg);
        prev[i] = { ev, mk, seg };
      } else {
        p.seg.endMs = ms + dtMs;
      }
    });
  }
  tanks.forEach((t) =>
    t.hist.forEach((h) => (h.endMs = Math.min(h.endMs, endMs))),
  );

  return _memo({
    ok: true,
    i0ms,
    endMs,
    dtMs,
    tanks,
    fillMs,
    hlSinDiluir: Math.max(0, totalHLplan - Math.round(hlFiltrados)),
  });
}

let BBT_TL = null; // {sim, colCache} para el scrubber

function renderBBTTimeline(plan) {
  const gaugesEl = document.getElementById("bbtGauges");
  if (!gaugesEl) return;
  const legendEl = document.getElementById("bbtTimelineLegend");
  const alertEl = document.getElementById("bbtTimelineAlert");
  const info = document.getElementById("bbtTimeInfo");
  const slider = document.getElementById("bbtTimeSlider");

  const sim = simulateBBTLifecycle(plan);
  if (!sim.ok) {
    gaugesEl.innerHTML = `<p class="empty-note">${escapeHtml(sim.error || "Sin datos.")}</p>`;
    if (legendEl) legendEl.innerHTML = "";
    if (alertEl) alertEl.innerHTML = "";
    if (info) info.textContent = "";
    BBT_TL = null;
    return;
  }

  if (legendEl) {
    legendEl.innerHTML =
      `<div class="item"><span class="sw" style="background:repeating-linear-gradient(45deg,var(--changeover-c1),var(--changeover-c1) 3px,var(--changeover-c2) 3px,var(--changeover-c2) 6px);"></span>aseo / cambio</div>` +
      `<div class="item" style="color:var(--muted);">·  el color del tanque es la marca</div>`;
  }

  if (alertEl) {
    alertEl.innerHTML = sim.fillMs
      ? `<div style="border:1px solid rgba(237,28,43,.4); background:rgba(237,28,43,.08); border-radius:4px; padding:8px 14px; margin:6px 0 10px; color:var(--danger); font-size:12px;">Sin BBT libre para recibir a partir de <b>${fmtDateTime(new Date(sim.fillMs))}</b> — quedarían <b>${Math.round(sim.hlSinDiluir).toLocaleString("es-CO")} HL</b> sin diluir.</div>`
      : `<div style="color:var(--muted); font-size:11.5px; padding:2px 0 8px;">${sim.tanks.length} BBT simulados · arrastra la línea de tiempo (o pulsa ▶) para ver el nivel y la marca de cada tanque en cada momento.</div>`;
  }

  BBT_TL = { sim, colCache: {} };
  if (slider) {
    const keep = Number(slider.dataset.frac || 0);
    slider.value = Math.round(Math.max(0, Math.min(1, keep)) * 1000);
  }
  bbtScrubTo(slider ? Number(slider.value) : 0);
}

function bbtNivelAt(niveles, ms) {
  if (!niveles || !niveles.length) return null;
  if (ms <= niveles[0].ms) return niveles[0];
  const last = niveles[niveles.length - 1];
  if (ms >= last.ms) return last;
  let lo = 0;
  let hi = niveles.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (niveles[mid].ms <= ms) lo = mid;
    else hi = mid;
  }
  return niveles[lo];
}

function bbtScrubTo(sliderVal) {
  if (!BBT_TL) return;
  const { sim, colCache } = BBT_TL;
  const frac = Math.max(0, Math.min(1, (Number(sliderVal) || 0) / 1000));
  const ms = sim.i0ms + frac * (sim.endMs - sim.i0ms);
  const slider = document.getElementById("bbtTimeSlider");
  if (slider) slider.dataset.frac = frac;
  const info = document.getElementById("bbtTimeInfo");
  const gaugesEl = document.getElementById("bbtGauges");

  // Mueve también el cursor de los Gantt de envasado/filtración al mismo instante.
  if (typeof ganttLinkCursor === "function") ganttLinkCursor(ms);

  let conProd = 0;
  let libres = 0;
  const cards = sim.tanks
    .map((t) => {
      const n =
        bbtNivelAt(t.niveles, ms) || { hL: 0, estadoVis: "vacío", marca: null };
      const pct = t.cap > 0 ? Math.max(0, Math.min(100, (n.hL / t.cap) * 100)) : 0;
      if (n.hL > 0) conProd++;
      else libres++;
      const fillBg =
        n.estadoVis === "aseo"
          ? "repeating-linear-gradient(45deg,var(--changeover-c1),var(--changeover-c1) 3px,var(--changeover-c2) 3px,var(--changeover-c2) 6px)"
          : n.marca
            ? colorForFiltracion(n.marca, colCache).bg
            : "var(--line)";
      return `<div class="bbt-gauge">
        <div class="name" title="${escapeHtml(t.equipo)}">${escapeHtml(t.equipo)}</div>
        <div class="tank"><div class="fill" style="height:${pct.toFixed(1)}%; background:${fillBg};"></div></div>
        <div class="val">${Math.round(n.hL).toLocaleString("es-CO")}/${Math.round(t.cap).toLocaleString("es-CO")}</div>
        <div class="cap-label" title="${escapeHtml(n.marca || "")}">${n.marca ? escapeHtml(n.marca) : "—"}</div>
        <div class="cap-label" style="color:var(--accent2);">${n.estadoVis}</div>
      </div>`;
    })
    .join("");
  if (gaugesEl) gaugesEl.innerHTML = cards;
  if (info)
    info.textContent = `${fmtDateTime(new Date(ms))}  ·  ${conProd} con producto · ${libres} libres`;
}

/* ---- Panel de UI: parámetros + tabla editable ------------------------- */
function recomputeFiltracion() {
  saveFiltracionState();
  const plan = buildFiltracionPlan(FILTRACION_STATE);
  renderGanttFiltracion(plan);
  if (typeof renderBBTTimeline === "function") renderBBTTimeline(plan);
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
            <label class="field" style="display:flex;align-items:center;gap:8px;min-height:31px;">
              <input type="checkbox" id="filFiltroNuevo" style="width:16px;height:16px;" />
              Filtro nuevo en I0
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
          <div class="fil-field">
            <label class="field">Desalojo de BBTs (hL/h) — 0 = usar instructivo</label>
            <input type="number" min="0" step="1" class="cat-input" id="filDesalojo" placeholder="auto" />
          </div>
        </div>
        <div class="table-scroll" id="filtracionFilasWrap"></div>
        <div style="margin-top:12px;">
          <button class="btn small" id="filtracionAddFilaBtn" type="button">+ Agregar fila</button>
        </div>
        <div id="filtracionStatus" style="font-family:var(--mono); font-size:12px; color:var(--muted); margin-top:10px; min-height:16px;"></div>
      </div>
      <div id="ganttFiltracionAlert" style="padding:0 20px;"></div>
      <div id="ganttFiltracionContainer" class="hidden"></div>
      <div id="ganttFiltracionCursorInfo" style="font-family:var(--mono); font-size:12px; color:var(--accent2); padding:2px 20px 0; min-height:18px;"></div>
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

  // Sub-panel: BBTs en el tiempo (visualización dinámica, tanque por tanque).
  const bbtPanel = document.createElement("section");
  bbtPanel.id = "bbtTimelinePanel";
  bbtPanel.className = "panel";
  bbtPanel.style.marginTop = "14px";
  bbtPanel.innerHTML = `
    <div class="panel-head"><h3>BBTs en el tiempo</h3></div>
    <div class="panel-body">
      <div id="bbtTimelineAlert" style="padding:0 20px;"></div>
      <div style="display:flex; align-items:center; gap:12px; padding:8px 20px;">
        <button class="btn small" id="bbtPlayBtn" type="button">▶ Reproducir</button>
        <input type="range" id="bbtTimeSlider" min="0" max="1000" value="0" step="1" style="flex:1;" />
        <span id="bbtTimeInfo" style="font-family:var(--mono); font-size:12px; color:var(--accent2); min-width:250px; text-align:right;"></span>
      </div>
      <div id="bbtGauges" style="display:flex; flex-wrap:wrap; gap:14px; padding:6px 20px 16px;"></div>
      <div class="legend" id="bbtTimelineLegend" style="padding:0 20px 14px;"></div>
    </div>`;
  (filtracionHost || document.querySelector(".container") || document.body).appendChild(
    bbtPanel,
  );

  const bbtSlider = document.getElementById("bbtTimeSlider");
  const bbtPlayBtn = document.getElementById("bbtPlayBtn");
  let bbtPlayTimer = null;
  if (bbtSlider) {
    bbtSlider.addEventListener("input", () => bbtScrubTo(Number(bbtSlider.value)));
  }
  if (bbtPlayBtn && bbtSlider) {
    bbtPlayBtn.addEventListener("click", () => {
      if (bbtPlayTimer) {
        clearInterval(bbtPlayTimer);
        bbtPlayTimer = null;
        bbtPlayBtn.textContent = "▶ Reproducir";
        return;
      }
      const max = Number(bbtSlider.max) || 1000;
      if (Number(bbtSlider.value) >= max) bbtSlider.value = 0;
      bbtPlayBtn.textContent = "❚❚ Pausar";
      bbtPlayTimer = setInterval(() => {
        let v = Number(bbtSlider.value) + 4;
        if (v >= max) {
          v = max;
          clearInterval(bbtPlayTimer);
          bbtPlayTimer = null;
          bbtPlayBtn.textContent = "▶ Reproducir";
        }
        bbtSlider.value = v;
        bbtScrubTo(v);
      }, 90);
    });
  }

  const i0Input = document.getElementById("filI0");
  const flujoInput = document.getElementById("filFlujo");
  const cicloInput = document.getElementById("filCiclo");
  const cambioInput = document.getElementById("filCambioCiclo");
  const cipInput = document.getElementById("filCipLight");
  const filtroNuevoInput = document.getElementById("filFiltroNuevo");
  const restanteInput = document.getElementById("filRestanteCiclo");
  const restanteField = document.getElementById("filRestanteField");
  const desalojoInput = document.getElementById("filDesalojo");

  i0Input.value = FILTRACION_STATE.i0 || "";
  flujoInput.value = FILTRACION_STATE.flujoHLh || "";
  cicloInput.value = FILTRACION_STATE.cicloHL || "";
  desalojoInput.value = FILTRACION_STATE.desalojoHLh || "";
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
  desalojoInput.addEventListener("input", () => {
    FILTRACION_STATE.desalojoHLh = Number(desalojoInput.value) || 0;
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
