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
   6.7) GANTT — FILTRACIÓN (registro horario: Fecha / Flujo de dilución /
        Total diluido / Marca). Panel independiente con su propia carga de
        Excel, pero dibujado con exactamente las mismas clases CSS y colores
        que los Gantt de envasado y cocina (panel, lane-label, lane-track,
        day-header, block, legend, etc. — definidos en style.css).
   ========================================================================= */

// Reglas de color específicas de Filtración (categorías más generales que las
// del Gantt de envasado: ESTANDAR, LIGHT, PILSEN, PONY, ASEO...). Se intenta
// primero reutilizar PACKAGING_COLOR_RULES para que, cuando coincida una marca
// exacta, el color sea IDÉNTICO al usado en el Gantt de envasado.
const FILTRACION_ASEO_RE = /\baseo\b|\blimpieza\b|\bcip\b|\bsanitiz/;
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

// Parseo flexible de fecha+hora para la columna "FECHA" del registro de
// filtración: acepta celdas de fecha reales de Excel (cellDates:true) o texto
// en formato dd/mm/aaaa hh:mm[:ss] / aaaa-mm-dd hh:mm[:ss].
function parseFiltracionDateTimeUTC(v) {
  if (isDateLike(v)) {
    return new Date(
      Date.UTC(
        v.getUTCFullYear(),
        v.getUTCMonth(),
        v.getUTCDate(),
        v.getUTCHours(),
        v.getUTCMinutes(),
        v.getUTCSeconds(),
      ),
    );
  }
  if (isBlank(v)) return null;
  const s = String(v).trim();
  let m = s.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (m)
    return new Date(
      Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)),
    );
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m)
    return new Date(
      Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)),
    );
  const dOnly = parseDMYStringUTC(s);
  if (dOnly) return dOnly;
  const generic = new Date(s);
  return isNaN(generic.getTime()) ? null : generic;
}

// Localiza la fila de encabezados y las columnas FECHA / FLUJO / TOTAL / MARCA
// buscando por nombre (en vez de asumir posiciones fijas), igual que
// findHeaderRow() hace para la plantilla tabular histórica.
function findFiltracionHeaderRow(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 20); r++) {
    const row = aoa[r] || [];
    const norm = row.map((v) => (isBlank(v) ? "" : normalizeText(v)));
    const fecha = norm.indexOf("fecha");
    const marca = norm.findIndex((v) => v.includes("marca"));
    if (fecha !== -1 && marca !== -1) {
      const flujo = norm.findIndex((v) => v.includes("flujo"));
      const total = norm.findIndex((v) => v.includes("total"));
      return { row: r, fecha, flujo, total, marca };
    }
  }
  return null;
}

function parseFiltracionWorkbook(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      raw: true,
    });
    const header = findFiltracionHeaderRow(aoa);
    if (!header) continue;
    const rows = [];
    for (let r = header.row + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const fecha = row[header.fecha];
      const marca = row[header.marca];
      if (isBlank(fecha) || isBlank(marca)) continue;
      rows.push([
        fecha,
        header.flujo !== -1 ? row[header.flujo] : null,
        header.total !== -1 ? row[header.total] : null,
        marca,
      ]);
    }
    return rows;
  }
  return [];
}

// Un segmento por bloque consecutivo de la misma marca (se fusionan las horas),
// igual que en la herramienta original de Filtración.
function buildFiltracionSegments(rows) {
  const clean = rows
    .map((r) => ({
      t: parseFiltracionDateTimeUTC(r[0]),
      flujo: isBlank(r[1]) ? 0 : Number(r[1]),
      total: isBlank(r[2]) ? 0 : Number(r[2]),
      marca: String(r[3]).trim(),
    }))
    .filter((r) => r.t && r.marca)
    .sort((a, b) => a.t - b.t);

  const segments = [];
  let cur = null;
  for (const r of clean) {
    if (!cur || cur.marca !== r.marca) {
      if (cur) segments.push(cur);
      cur = {
        marca: r.marca,
        start: r.t,
        end: r.t,
        hours: 1,
        hl: r.total,
        flujoSum: r.flujo,
        flujoCount: r.flujo > 0 ? 1 : 0,
        flujoMin: r.flujo,
        flujoMax: r.flujo,
      };
    } else {
      cur.end = r.t;
      cur.hl = r.total;
      cur.hours += 1;
      cur.flujoSum += r.flujo;
      if (r.flujo > 0) cur.flujoCount += 1;
      cur.flujoMin = Math.min(cur.flujoMin, r.flujo);
      cur.flujoMax = Math.max(cur.flujoMax, r.flujo);
    }
  }
  if (cur) segments.push(cur);
  segments.forEach((s) => {
    s.flujoAvg = s.flujoCount > 0 ? s.flujoSum / s.flujoCount : 0;
  });
  return segments;
}

// Dibuja el Gantt de Filtración usando exactamente las mismas clases/variables
// CSS que renderGanttEnvasado/renderGanttCocina (una sola línea "FILTRACIÓN").
function renderGanttFiltracion(segments) {
  const container = document.getElementById("ganttFiltracionContainer");
  if (!container) return;
  if (!segments.length) {
    container.classList.remove("hidden");
    container.innerHTML =
      '<p class="empty-note">Sin datos de filtración cargados.</p>';
    return;
  }

  const rangeStart = new Date(
    Date.UTC(
      segments[0].start.getUTCFullYear(),
      segments[0].start.getUTCMonth(),
      segments[0].start.getUTCDate(),
    ),
  );
  const lastSeg = segments[segments.length - 1];
  const lastEndTime = new Date(
    lastSeg.end.getTime() + 3600 * 1000,
  ).getTime(); // fin exclusivo (+1h de la última lectura)
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
    const left =
      ((seg.start.getTime() - rangeStart.getTime()) / 3600000) *
      GANTT_PX_PER_HOUR;
    const width = Math.max(5, seg.hours * GANTT_PX_PER_HOUR);
    const dur = fmtDuration(seg.hours * 3600000);
    const segEndTime = new Date(seg.start.getTime() + seg.hours * 3600000);
    const flujoTxt =
      seg.flujoAvg > 0
        ? `${Math.round(seg.flujoAvg).toLocaleString("es-CO")} L/h`
        : null;
    const detalleParts = [];
    if (seg.hl > 0) detalleParts.push(`${Math.round(seg.hl).toLocaleString("es-CO")} HL`);
    if (flujoTxt) detalleParts.push(flujoTxt);
    detalleParts.push(dur);
    const detalle = detalleParts.join(" · ");
    const titleAttr = escapeHtml(
      `${seg.marca} · ${fmtDateTime(seg.start)} → ${fmtDateTime(segEndTime)} (${dur})` +
        (seg.hl > 0 ? ` · Total diluido: ${Math.round(seg.hl).toLocaleString("es-CO")} HL` : "") +
        (flujoTxt ? ` · Flujo prom: ${flujoTxt} (${Math.round(seg.flujoMin).toLocaleString("es-CO")}–${Math.round(seg.flujoMax).toLocaleString("es-CO")} L/h)` : ""),
    );
    const col = colorForFiltracion(seg.marca, colorCache);
    const showText = width >= 46;
    if (col.aseo) {
      blocksHtml += `<div class="block changeover" style="left:${left}px; width:${width}px;" title="${titleAttr}">${showText ? `<b>${escapeHtml(seg.marca)}</b><span>${detalle}</span>` : `<b>🧽</b>`}</div>`;
    } else {
      blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${col.bg}; color:${col.fg};" title="${titleAttr}">${showText ? `<b style="color:${col.fg};">${escapeHtml(seg.marca)}</b><span style="color:${col.fg};">${detalle}</span>` : ""}</div>`;
    }
  });

  container.classList.remove("hidden");
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

  // Leyenda + totales, con el mismo estilo (.legend/.item/.sw) que los demás Gantt.
  const legendMap = {};
  segments.forEach((s) => {
    const key = normalizeText(s.marca);
    if (!(key in legendMap)) legendMap[key] = { label: s.marca, col: colorForFiltracion(s.marca, colorCache) };
  });
  const legendItems = Object.values(legendMap)
    .map(({ label, col }) => {
      const sw = col.aseo
        ? "background:repeating-linear-gradient(45deg,var(--changeover-c1),var(--changeover-c1) 3px,var(--changeover-c2) 3px,var(--changeover-c2) 6px);"
        : `background:${col.bg};`;
      return `<div class="item"><span class="sw" style="${sw}"></span>${escapeHtml(label)}</div>`;
    })
    .join("");
  const legendEl = document.getElementById("ganttFiltracionLegend");
  if (legendEl) legendEl.innerHTML = legendItems;

  const totalHL = segments.reduce((s, x) => s + (x.hl || 0), 0);
  const totalDurH = segments.reduce((s, x) => s + x.hours, 0);
  const flujoSumGlobal = segments.reduce((s, x) => s + (x.flujoSum || 0), 0);
  const flujoCountGlobal = segments.reduce((s, x) => s + (x.flujoCount || 0), 0);
  const flujoAvgGlobal = flujoCountGlobal > 0 ? flujoSumGlobal / flujoCountGlobal : 0;
  const totalsEl = document.getElementById("ganttFiltracionTotals");
  if (totalsEl) {
    totalsEl.textContent =
      `Periodo: ${fmtDateTime(rangeStart)} → ${fmtDateTime(new Date(lastEndTime))}` +
      `  ·  Duración total: ${fmtDuration(totalDurH * 3600000)}` +
      `  ·  Bloques: ${segments.length}` +
      (totalHL > 0 ? `  ·  Total diluido: ${Math.round(totalHL).toLocaleString("es-CO")} HL` : "") +
      (flujoAvgGlobal > 0 ? `  ·  Flujo de dilución promedio: ${Math.round(flujoAvgGlobal).toLocaleString("es-CO")} L/h` : "");
  }
}

/* ---- Panel de UI (auto-inyectado) para cargar el Excel de Filtración ---- */
function initFiltracionPanel() {
  if (document.getElementById("ganttFiltracionPanel")) return;

  const panel = document.createElement("section");
  panel.id = "ganttFiltracionPanel";
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-head">
      <h3>Gantt de Filtración</h3>
      <span class="sub">Bloques generados a partir del registro horario (Fecha · Flujo de dilución · Total diluido · Marca)</span>
    </div>
    <div class="panel-body">
      <div class="upload-zone" id="filtracionDropZone">
        <h2>📄 Cargar Excel de Filtración</h2>
        <p>Arrastra el archivo aquí o selecciónalo manualmente.</p>
        <label class="btn primary" for="filtracionFileInput" style="cursor:pointer;">Elegir archivo</label>
        <input type="file" id="filtracionFileInput" accept=".xlsx,.xls" />
      </div>
      <div class="upload-compact hidden" id="filtracionUploadCompact">
        <div class="uc-file"><b>✓</b><span class="uc-name" id="filtracionUploadName"></span></div>
        <button class="btn small" id="filtracionChangeFileBtn" type="button">Cambiar archivo</button>
      </div>
      <div id="filtracionStatus" style="font-family:var(--mono); font-size:12px; color:var(--muted); margin-top:10px; min-height:16px;"></div>
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

  const filtracionFileInput = document.getElementById("filtracionFileInput");
  const filtracionDropZone = document.getElementById("filtracionDropZone");
  const filtracionStatus = document.getElementById("filtracionStatus");
  const filtracionUploadCompact = document.getElementById("filtracionUploadCompact");
  const filtracionUploadName = document.getElementById("filtracionUploadName");
  const filtracionChangeFileBtn = document.getElementById("filtracionChangeFileBtn");

  function handleFiltracionFile(file) {
    if (!file) return;
    filtracionStatus.classList.remove("error");
    filtracionStatus.textContent = "Leyendo " + file.name + "...";
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const rows = parseFiltracionWorkbook(workbook);
        const segments = buildFiltracionSegments(rows);
        if (!segments.length) throw new Error("No se encontraron filas válidas (se esperan columnas Fecha, Flujo de dilución, Total diluido y Marca).");
        renderGanttFiltracion(segments);
        filtracionStatus.textContent = "Listo — " + file.name + " procesado correctamente.";
        filtracionDropZone.classList.add("hidden");
        filtracionUploadName.textContent = file.name;
        filtracionUploadCompact.classList.remove("hidden");
      } catch (err) {
        console.error(err);
        filtracionStatus.classList.add("error");
        filtracionStatus.style.color = "var(--danger)";
        filtracionStatus.textContent = "Error: " + err.message;
        document.getElementById("ganttFiltracionContainer").classList.add("hidden");
      }
    };
    reader.onerror = () => {
      filtracionStatus.classList.add("error");
      filtracionStatus.style.color = "var(--danger)";
      filtracionStatus.textContent = "No se pudo leer el archivo.";
    };
    reader.readAsArrayBuffer(file);
  }

  filtracionFileInput.addEventListener("change", (e) =>
    handleFiltracionFile(e.target.files[0]),
  );
  ["dragenter", "dragover"].forEach((ev) =>
    filtracionDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      filtracionDropZone.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    filtracionDropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      filtracionDropZone.classList.remove("drag");
    }),
  );
  filtracionDropZone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFiltracionFile(f);
  });
  filtracionChangeFileBtn.addEventListener("click", () => {
    filtracionUploadCompact.classList.add("hidden");
    filtracionDropZone.classList.remove("hidden");
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFiltracionPanel);
} else {
  initFiltracionPanel();
}

