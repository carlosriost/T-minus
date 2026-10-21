/* =========================================================================
   PARSEO DEL EXCEL (Suite 360 + formato heredado) + fusion/clasificacion de bloques
   ========================================================================= */
function findHeaderRow(aoa) {
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (!isBlank(row[c]) && String(row[c]).trim().toUpperCase() === "FECHA")
        return { row: r, col: c };
    }
  }
  return null;
}


/*
 * Detecta automáticamente los dos formatos admitidos:
 * 1. La plantilla tabular histórica, cuya fila principal contiene FECHA y TREN-x.
 * 2. El reporte horizontal de Suite 360, con una hoja "Semana NN", días en la fila 8,
 *    horas en la fila 10 y bloques por TREN en las filas 11/15/19/23.
 */
function parseWorkbook(workbook) {
  // Tolerante a variaciones del nombre real de la hoja: "Semana 1", "SEMANA_1",
  // "Semana1", con espacios o guiones bajos de más — lo único que importa es
  // que empiece por "semana" seguido de un número. Antes exigía una coincidencia
  // EXACTA (incluida la tilde de "LÍNEA" sin acentos variables) y una hoja con
  // el nombre levemente distinto quedaba fuera de la fusión sin ningún aviso.
  const suiteSheetNames = workbook.SheetNames.filter((name) =>
    /^semana[\s_-]*\d+/.test(normalizeText(name)),
  );
  const looksLikeSuite360 = (name) => {
    const ws = workbook.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    return aoa.some((row) =>
      (row || []).some(
        (v) => !isBlank(v) && normalizeText(v).trim() === "turnos en linea",
      ),
    );
  };
  const suite360Names = suiteSheetNames.filter(looksLikeSuite360);
  // Hojas que se llaman "Semana N" pero NO se reconocieron como Suite 360 (no
  // traen "Turnos en línea"): antes quedaban fuera de la fusión sin ningún
  // aviso, dando la impresión de que "faltaban" semanas. Se listan para que el
  // usuario las vea en el mensaje de carga en vez de que desaparezcan solas.
  const sheetsSinReconocer = suiteSheetNames.filter(
    (n) => !suite360Names.includes(n),
  );
  if (suite360Names.length) {
    // Varias hojas "Semana N": se ordenan por número y se fusionan en UNA sola
    // línea de tiempo (cada hoja ya trae sus propias fechas reales, así que
    // solo hay que concatenar los eventos de cada tren).
    const ordered = suite360Names
      .map((name) => ({
        name,
        num: Number((String(name).match(/\d+/) || ["0"])[0]) || 0,
      }))
      .sort((a, b) => a.num - b.num)
      .map((x) => x.name);
    const parsedWeeks = ordered.map((name) => parseSuite360Workbook(workbook, name));
    const merged = mergeSuite360Weeks(parsedWeeks);
    merged.sheetsSinReconocer = sheetsSinReconocer;
    return merged;
  }
  return parseLegacyWorkbook(workbook);
}

// Combina el resultado de parseSuite360Workbook() de una o más hojas "Semana N"
// en un solo objeto "parsed": concatena rawEvents por tren y arma la lista de
// semanas (weeks) para marcar el inicio de cada una en el Gantt de envasado.
function mergeSuite360Weeks(parsedWeeks) {
  const weeks = parsedWeeks.map((p) => ({
    label: p.weekLabel,
    start: p.weekStartDate,
    end: p.explicitWeekEnd,
  }));
  if (parsedWeeks.length === 1) return { ...parsedWeeks[0], weeks };

  const rawEvents = { 5: [], 7: [], 8: [], 9: [] };
  TRAINS.forEach((t) => {
    parsedWeeks.forEach((p) => rawEvents[t].push(...((p.rawEvents || {})[t] || [])));
  });
  const first = parsedWeeks[0];
  const last = parsedWeeks[parsedWeeks.length - 1];
  return {
    weekLabel: weeks.map((w) => w.label).join(" → "),
    headerDate: first.headerDate,
    weekStartDate: first.weekStartDate,
    explicitWeekStart: first.explicitWeekStart,
    explicitWeekEnd: last.explicitWeekEnd,
    rawEvents,
    summary: [],
    weeks,
  };
}

function suiteCellDateUTC(v) {
  // Componentes LOCALES: son los que traen el valor real de la celda (ver la
  // nota sobre SheetJS en utils.js). Leyendo los UTC, en cualquier zona horaria
  // al este de Greenwich la fecha se corría un día.
  if (isDateLike(v)) {
    const f = excelFechaAPlanta(v);
    if (f) return f;
  }
  const dmy = parseDMYStringUTC(v);
  if (dmy) return dmy;
  if (typeof v === "string") {
    const months = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9,
      noviembre: 10, diciembre: 11,
    };
    const n = normalizeText(v);
    const m = n.match(/(\d{1,2})\s+de\s+([a-zñ]+)\s+de\s+(\d{4})/i);
    if (m && months[m[2]] !== undefined)
      return new Date(Date.UTC(Number(m[3]), months[m[2]], Number(m[1])));
  }
  return null;
}

function suiteValueAt(ws, aoa, row, col, mergeIndex) {
  const direct = (aoa[row] || [])[col];
  if (!isBlank(direct)) return direct;
  const rg = mergeIndex.find((m) => row >= m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c);
  return rg ? (aoa[rg.s.r] || [])[rg.s.c] : null;
}

function suiteSpanEnd(row, col, mergeIndex) {
  const rg = mergeIndex.find((m) => row >= m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c);
  return rg ? rg.e.c : col;
}

function suiteDisplayName(product, activity) {
  const p = String(product || "").trim();
  const a = String(activity || "").trim();
  const n = normalizeText(p);
  // Sin anclar al INICIO del texto (antes usaba ^cost, ^ag\b, etc.): un código
  // o prefijo antes del nombre de marca (pasa en algunas semanas del
  // instructivo) hacía que el patrón anclado nunca coincidiera y la marca
  // quedara sin reconocer — y por lo tanto sin homologar a ningún mosto más
  // adelante, desapareciendo del balance sin ningún aviso.
  let brand = p; // si no se reconoce nada, se deja el texto crudo
  if (n.includes("cost")) brand = "Costeñita";
  else if (
    n.includes("aguila light") ||
    n.includes("a light") ||
    n.includes("aguila lig")
  )
    brand = "Águila Light";
  else if (n.includes("poker") || /\bpok\b/.test(n)) brand = "Poker";
  else if (n.includes("pilsen") || /\bpil\b/.test(n)) brand = "Pilsen";
  else if (n.includes("pony") || /\bpmg?\b/.test(n)) brand = "Pony Malta";
  else if (n.includes("aguila") || /\bag\b/.test(n)) brand = "Águila";
  return [brand, a && !/^DPA|^NST/i.test(a) ? a : ""].filter(Boolean).join(" · ");
}

function parseSuite360Workbook(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const merges = ws["!merges"] || [];
  const rawEvents = { 5: [], 7: [], 8: [], 9: [] };

  const HEADER_DAY_ROW = 7;
  const HOUR_ROW = 9;
  const FIRST_TIME_COL = 3;
  const HOURS_IN_WEEK = 168;
  const trainRows = {
    5: { product: 10, activity: 11, units: 12 },
    7: { product: 14, activity: 15, units: 16 },
    8: { product: 18, activity: 19, units: 20 },
    9: { product: 22, activity: 23, units: 24 },
  };

  let firstDay = suiteCellDateUTC((aoa[HEADER_DAY_ROW] || [])[FIRST_TIME_COL]);
  if (!firstDay) {
    for (let c = FIRST_TIME_COL; c < FIRST_TIME_COL + HOURS_IN_WEEK && !firstDay; c++)
      firstDay = suiteCellDateUTC((aoa[HEADER_DAY_ROW] || [])[c]);
  }
  if (!firstDay) throw new Error('No se pudo leer el primer día en la hoja "' + sheetName + '".');

  // La hora inicial de la cuadrícula. Se prefiere el texto ya formateado de la
  // celda (.w = "22:00"): es literalmente lo que muestra Excel, sin intermediarios.
  // El respaldo, cellTimeParts, lee los componentes locales del Date de SheetJS,
  // que traen ese mismo valor (ver la nota sobre SheetJS en utils.js).
  function suiteHourParts(r, c) {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.w) {
      const m = String(cell.w).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (m)
        return {
          h: Number(m[1]) % 24,
          m: Number(m[2]),
          s: Number(m[3] || 0),
        };
    }
    return cellTimeParts((aoa[r] || [])[c]);
  }
  const firstTime =
    suiteHourParts(HOUR_ROW, FIRST_TIME_COL) || { h: 22, m: 0, s: 0 };
  // EL DÍA DE PLANEACIÓN NO ES EL DÍA DE CALENDARIO.
  // El día de planeación va de 22:00 a 21:00, así que el bloque rotulado
  // "jueves 10 de septiembre" arranca en realidad el MIÉRCOLES 9 a las 22:00 y
  // termina el jueves 10 a las 21:00. Las columnas 22:00 y 23:00 son del día
  // ANTERIOR al rótulo; de 00:00 en adelante ya son del día rotulado.
  // Por eso, cuando la cuadrícula abre en la noche, el origen es el día rotulado
  // MENOS UN DÍA. Sin esto todo el plan salía corrido 24 h hacia adelante: una
  // marca que en el instructivo va el miércoles a las 22:00 aparecía el jueves.
  // El calendario en sí no cambia —sigue siendo el real, ver la nota de utils.js—
  // lo que cambia es a qué instante corresponde cada casilla de la cuadrícula.
  const abreEnLaNoche = firstTime.h >= 12;
  const timelineStart = combine(
    abreEnLaNoche ? addDays(firstDay, -1) : firstDay,
    firstTime,
  );

  function brandFamily(text) {
    const n = normalizeText(text);
    if (n.includes("cost")) return "costenita";
    if (n.includes("light") || /a\s+lig/.test(n)) return "aguila light";
    if (n.includes("pilsen") || /^pil\b/.test(n)) return "pilsen";
    if (n.includes("poker") || /^pok\b/.test(n)) return "poker";
    if (n.includes("pony") || /^pmg?\b/.test(n)) return "pony";
    if (n.includes("aguila") || /^ag\b/.test(n)) return "aguila";
    return n;
  }

  /* SKUs VÁLIDOS DE ESTA SEMANA — tabla "Línea | SKU | SAP | Eficiencia | ..."
     que está DENTRO de la propia hoja "Semana N". Es la única lista autorizada:
     la hoja "Velocidad Eficiencia" trae SKUs viejos que ya no existen (p. ej.
     "Pony Malta Vital PET") y hacían aparecer marcas/eficiencias fantasma. */
  const semanaSkus = [];
  {
    // Los encabezados de esta tabla ("Línea | SKU | SAP | Eficiencia | Formato |
    // Referencia | ...") NO están en columnas contiguas: cada campo ocupa una
    // celda combinada de varias columnas. Se localiza la fila que contiene A LA
    // VEZ "línea" y "eficiencia", y luego cada campo por su columna literal.
    const idxOf = (row, want, from) => {
      for (let c = (from || 0); c < row.length; c++)
        if (normalizeText(row[c]).trim() === want) return c;
      return -1;
    };
    let hr = -1;
    for (let r = 0; r < aoa.length && hr < 0; r++) {
      const row = aoa[r] || [];
      if (idxOf(row, "linea") >= 0 && idxOf(row, "eficiencia") >= 0) hr = r;
    }
    if (hr >= 0) {
      const hrow = aoa[hr];
      const cLinea = idxOf(hrow, "linea");
      const cSku = idxOf(hrow, "sku", cLinea); // el SKU que está DESPUÉS de "Línea"
      const cSap = idxOf(hrow, "sap", cLinea);
      const cEfi = idxOf(hrow, "eficiencia");
      const cFmt = idxOf(hrow, "formato", cLinea);
      const cRef = idxOf(hrow, "referencia", cLinea);
      for (let r = hr + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const name = row[cSku];
        if (isBlank(name) || /^total$/i.test(String(name).trim())) break;
        const tm = String(row[cLinea] || "").match(/tren\s*-?\s*(\d+)/i);
        if (!tm) continue;
        let efi = Number(row[cEfi]) || 0;
        if (efi > 1.5) efi = efi / 100; // viene como porcentaje (90 = 90 %)
        semanaSkus.push({
          tren: tm[1],
          name: String(name).trim(),
          sap: String(row[cSap] == null ? "" : row[cSap]).trim(),
          efficiency: efi,
          cc: cFmt >= 0 ? Number(row[cFmt]) || 0 : 0,
          pack: cRef >= 0 ? Number(row[cRef]) || 0 : 0,
          family: brandFamily(name),
        });
      }
    }
  }

  /* Velocidad nominal (hL/h) desde "Velocidad Eficiencia", indexada por código
     SAP. SOLO se usa para poner la velocidad de un SKU que YA está en la lista
     de la semana; nunca para introducir un SKU. */
  const speedBySap = {};
  const speedSheetName = workbook.SheetNames.find(
    (n) => normalizeText(n) === "velocidad eficiencia",
  );
  if (speedSheetName) {
    const sws = workbook.Sheets[speedSheetName];
    const sa = XLSX.utils.sheet_to_json(sws, { header: 1, defval: null, raw: true });
    let hr = sa.findIndex((r) => (r || []).some((v) => normalizeText(v) === "recurso"));
    if (hr >= 0) {
      for (let r = hr + 1; r < sa.length; r++) {
        const row = sa[r] || [];
        const code = String(row[1] == null ? "" : row[1]).trim();
        const speed = Number(row[6]) || 0;
        if (code && speed > 0 && speedBySap[code] == null) speedBySap[code] = speed;
      }
    }
  }

  function identifySku(train, product, formatText) {
    const pool = semanaSkus.filter((x) => x.tren === String(train));
    if (!pool.length) return null;
    const txt = normalizeText(product) + " " + normalizeText(formatText);
    // 1) por código SAP contenido en el texto de la celda (p. ej. "A Light 22613").
    let m = pool.find((x) => x.sap && txt.includes(normalizeText(x.sap)));
    // 2) por familia de marca + tamaño (cc/pack) del texto de "PROGRAMA INICIAL".
    if (!m) {
      const fmt = String(formatText || "");
      const nums = [...fmt.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((g) =>
        Number(g[1].replace(",", ".")),
      );
      const cc = nums[0] || 0;
      const pack = nums[1] || 0;
      const fam = brandFamily(product);
      m = pool.find(
        (x) =>
          x.family === fam &&
          (!cc || x.cc === cc) &&
          (!pack || x.pack === pack),
      );
      if (!m) m = pool.find((x) => x.family === fam);
    }
    if (!m) return null;
    return {
      code: m.sap,
      description: m.name,
      cc: m.cc,
      pack: m.pack,
      speed: speedBySap[m.sap] || 0,
      efficiency: m.efficiency || 0,
    };
  }

  function specialLabel(text) {
    const n = normalizeText(text);
    if (n.includes("sin programacion") || n.includes("sin programación")) return "Sin programación / demanda";
    if (n.includes("programmed maintenance") || n.includes("mantenimiento programado")) return "Mantenimiento programado";
    if (n.includes("primary package") || n.includes("empaque primario")) return "Cambio de empaque primario";
    if (n.includes("liquid changes") || n.includes("cambio de liquido")) return "Cambio de líquido";
    if (n.includes("material / supplier") || n.includes("material/proveedor")) return "Cambio de material/proveedor";
    if (n.includes("ingenieria") || n.includes("innovacion")) return "Actividad de ingeniería / innovación";
    return String(text || "").replace(/^DPA\s*-\s*/i, "").replace(/^NST\s*-\s*/i, "").trim();
  }

  TRAINS.forEach((t) => {
    const rows = trainRows[t];
    const pieces = [];
    let c = FIRST_TIME_COL;
    while (c < FIRST_TIME_COL + HOURS_IN_WEEK) {
      const product = suiteValueAt(ws, aoa, rows.product, c, merges);
      const activity = suiteValueAt(ws, aoa, rows.activity, c, merges);
      const p = String(product || "").trim();
      const a = String(activity || "").trim();
      const special = /^(DPA|NST)\b/i.test(a);
      const production = !isBlank(p) && !special;
      const governingRow = production ? rows.product : rows.activity;
      let endCol = Math.min(suiteSpanEnd(governingRow, c, merges), FIRST_TIME_COL + HOURS_IN_WEEK - 1);
      if (endCol < c) endCol = c;
      if (production || special) {
        let units = 0;
        for (let uc = c; uc <= endCol; uc++) {
          const uv = (aoa[rows.units] || [])[uc];
          if (typeof uv === "number" && isFinite(uv)) units += uv;
        }
        pieces.push({ c, endCol, product: p, activity: a, production, special, units });
      }
      c = endCol + 1;
    }

    /* Consolida segmentos adyacentes del mismo SKU antes de calcular tiempos exactos. */
    const grouped = [];
    for (const x of pieces) {
      const key = x.production ? "P|" + x.product : "S|" + specialLabel(x.activity);
      const last = grouped[grouped.length - 1];
      if (last && last.key === key && x.c <= last.endCol + 1) {
        last.endCol = Math.max(last.endCol, x.endCol);
        last.units += x.units;
        if (!last.activity && x.activity) last.activity = x.activity;
      } else grouped.push({ ...x, key });
    }

    for (const g of grouped) {
      // Cada columna de la cuadrícula = 1 hora real. El instructivo YA es la
      // línea de tiempo: la duración de un bloque son las horas que ocupa en la
      // cuadrícula (no se recalcula por velocidad nominal).
      const start = new Date(
        timelineStart.getTime() + (g.c - FIRST_TIME_COL) * 3600000,
      );
      const gridHours = g.endCol - g.c + 1;
      const end = new Date(start.getTime() + gridHours * 3600000);
      if (g.production) {
        const sku = identifySku(t, g.product, g.activity);
        const cc = sku
          ? sku.cc
          : (String(g.activity).match(/(\d+(?:[.,]\d+)?)\s*[xX]/) || [])[1] || 0;
        // La fila "Hl ENVASADOS" ya viene en hectolitros.
        const hectolitros = Number(g.units) || 0;
        const unidades =
          Number(cc) > 0 ? Math.round((hectolitros * 100000) / Number(cc)) : 0;
        rawEvents[t].push({
          codigo: sku ? sku.code : g.product,
          name: sku ? sku.description : suiteDisplayName(g.product, g.activity),
          start,
          end,
          unidades,
          hectolitros,
          // De la hoja "Velocidad Eficiencia": velocidad nominal (hL/h) y
          // eficiencia de la línea para este SKU (0 si no se encontró).
          velocidad: sku ? Number(sku.speed) || 0 : 0,
          eficiencia: sku ? Number(sku.efficiency) || 0 : 0,
        });
      } else {
        rawEvents[t].push({
          codigo: null,
          name:
            (g.activity.match(/^(DPA|NST)/i) || [""])[0] +
            " - " +
            specialLabel(g.activity),
          start,
          end,
          unidades: 0,
          hectolitros: 0,
        });
      }
    }
  });

  let headerDate = null;
  for (let r = 0; r < Math.min(8, aoa.length) && !headerDate; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length - 1; c++) {
      if (String(row[c] || "").trim().toUpperCase() === "FECHA:") headerDate = suiteCellDateUTC(row[c + 1]);
    }
  }
  headerDate = headerDate || firstDay;
  const weekNumber = (String(sheetName).match(/\d+/) || [""])[0];
  return {
    weekLabel: weekNumber ? "Semana " + weekNumber : sheetName,
    headerDate, weekStartDate: firstDay, explicitWeekStart: firstDay,
    explicitWeekEnd: addDays(firstDay, 6), rawEvents, summary: [],
  };
}

// Formato heredado (instructivo con FECHA y TREN-x): antes solo se leía la
// PRIMERA hoja del libro, así que un Excel con una hoja por semana mostraba
// únicamente la primera semana. Ahora se leen TODAS las hojas que tengan el
// formato del plan, se ordenan por fecha y se fusionan en una sola línea de
// tiempo, igual que las hojas "Semana N" de Suite 360.
function parseLegacyWorkbook(workbook) {
  const leidas = [];
  const avisos = [];
  let primerError = null;
  let primerErrorNoEsPlan = true;
  workbook.SheetNames.forEach((name) => {
    try {
      const p = parseLegacySheet(workbook, name);
      const nEventos = TRAINS.reduce(
        (a, t) => a + ((p.rawEvents && p.rawEvents[t]) || []).length,
        0,
      );
      if (!nEventos && !(p.summary || []).length) {
        avisos.push(`${name} (sin datos de envasado)`);
        return;
      }
      p.sheetName = name;
      leidas.push(p);
    } catch (err) {
      // Hojas que no son un plan (portadas, tablas auxiliares…) se ignoran;
      // solo se avisa si la hoja parecía un plan (tenía FECHA) y falló.
      const noEsPlan = /no se encontr[oó] la celda "FECHA"/i.test(err.message);
      if (!primerError || (!noEsPlan && primerErrorNoEsPlan)) {
        primerError = err;
        primerErrorNoEsPlan = noEsPlan;
      }
      if (!noEsPlan) avisos.push(`${name} (${err.message})`);
    }
  });
  if (!leidas.length) throw primerError || new Error("El archivo no tiene hojas con el formato del plan de envasado.");

  // Orden cronológico y sin semanas repetidas (dos hojas con el mismo primer día).
  leidas.sort((a, b) => a.weekStartDate - b.weekStartDate);
  const unicas = [];
  leidas.forEach((p) => {
    const dup = unicas.find(
      (u) => u.weekStartDate.getTime() === p.weekStartDate.getTime(),
    );
    if (dup) avisos.push(`${p.sheetName} (repite la semana de la hoja "${dup.sheetName}"; se usó esa)`);
    else unicas.push(p);
  });

  // Cada fila y cada línea de la tabla resumen recuerdan de qué hoja (semana)
  // salieron: el volumen por semana se cuenta con la hoja del instructivo, no
  // con la fecha (un bloque que cruza de domingo a lunes es de dos semanas).
  unicas.forEach((p, i) => {
    TRAINS.forEach((t) => ((p.rawEvents || {})[t] || []).forEach((ev) => (ev.semanaIdx = i)));
    (p.summary || []).forEach((s) => (s.semanaIdx = i));
  });
  if (unicas.length === 1) {
    const unica = unicas[0];
    return {
      ...unica,
      weeks: [{ label: unica.weekLabel, start: unica.weekStartDate, end: unica.explicitWeekEnd }],
      sheetsSinReconocer: avisos,
    };
  }
  // Con varias semanas, la etiqueta larga de cada hoja ("SEMANA: Del 05 octubre
  // al 11 octubre Semana: 41") se acorta a "Semana 41" para que quepan todas.
  unicas.forEach((p) => {
    const m = normalizeText(p.weekLabel || "").match(/semana\s*:?\s*(\d{1,2})(?!\d|\s*(?:de\s+)?[a-z])/);
    const num = m ? m[1] : (String(p.sheetName).match(/\d+/) || [""])[0];
    p.weekLabel = num ? "Semana " + num : p.sheetName;
  });
  const merged = mergeSuite360Weeks(unicas);
  merged.summary = unicas.flatMap((p) => p.summary || []);
  merged.sheetsSinReconocer = avisos;
  return merged;
}

function parseLegacySheet(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  const head = findHeaderRow(aoa);
  if (!head)
    throw new Error(
      'No se encontró la celda "FECHA" — el archivo no tiene el formato esperado del plan de envasado.',
    );
  const dayCol = head.col; // col with day name ("lunes"...) / later "CÓDIGO"
  const dateCol = head.col + 1; // col with reference date / day number
  const headerRow = head.row;
  const headerDateRaw = aoa[headerRow][dateCol];
  const headerDate = isDateLike(headerDateRaw)
    ? excelFechaAPlanta(headerDateRaw)
    : parseDMYStringUTC(headerDateRaw);
  if (!headerDate)
    throw new Error('No se pudo leer la fecha de referencia junto a "FECHA".');

  // locate TREN-x columns on the header row
  const trainCols = {};
  const headRowVals = aoa[headerRow];
  for (let c = 0; c < headRowVals.length; c++) {
    const v = headRowVals[c];
    if (isBlank(v)) continue;
    const m = String(v)
      .trim()
      .match(/^TREN-(\d+)$/i);
    // Nota: en celdas combinadas, algunos exports del plan repiten el mismo texto
    // ("TREN-5") en TODAS las columnas del rango fusionado, no solo en la celda ancla.
    // Por eso se conserva la PRIMERA columna encontrada (la de CÓDIGO) y se ignoran las
    // siguientes repeticiones; si se sobreescribiera con la última, se apuntaría a la
    // columna de Hectolitros en vez de a la de CÓDIGO.
    if (m && TRAINS.includes(m[1]) && trainCols[m[1]] === undefined)
      trainCols[m[1]] = c;
  }
  TRAINS.forEach((t) => {
    if (trainCols[t] === undefined)
      throw new Error(
        'No se encontró la columna "TREN-' + t + '" en el archivo.',
      );
  });

  // week label
  // Nota: algunos exports repiten el texto de celdas fusionadas ("Semana: ", su valor,
  // etc.) en cada celda del rango combinado; se descartan pares (etiqueta, valor)
  // ya vistos para no duplicar el texto mostrado al usuario.
  let weekLabel = "";
  const seenWeekPairs = new Set();
  for (let r = 0; r < headerRow; r++) {
    for (let c = 0; c < (aoa[r] || []).length; c++) {
      const v = aoa[r][c];
      if (!isBlank(v) && /semana/i.test(String(v))) {
        let next = null;
        for (let cc = c + 1; cc < (aoa[r] || []).length; cc++) {
          const nv = aoa[r][cc];
          if (isBlank(nv) || /semana/i.test(String(nv))) continue;
          next = nv;
          break;
        }
        if (!isBlank(next)) {
          const pairKey = String(v).trim() + "|" + String(next).trim();
          if (!seenWeekPairs.has(pairKey)) {
            seenWeekPairs.add(pairKey);
            weekLabel += String(v).trim() + " " + String(next).trim() + "  ";
          }
        }
      }
    }
  }

  // Si el encabezado contiene explícitamente el rango de la semana (por ejemplo,
  // "SEMANA 17 al 23 de agosto de 2026"), esa referencia es la fuente correcta
  // para reconstruir las fechas de los días del plan. La celda FECHA puede ser solo
  // la fecha de envío del plan y no necesariamente pertenece al mismo mes de la
  // semana programada. Antes se usaba FECHA como mes/año base y eso podía desplazar
  // toda la secuencia un mes completo.
  let explicitWeekStart = null;
  let explicitWeekEnd = null;
  const wl = normalizeText(weekLabel);
  const months = {
    enero: 0,
    febrero: 1,
    marzo: 2,
    abril: 3,
    mayo: 4,
    junio: 5,
    julio: 6,
    agosto: 7,
    septiembre: 8,
    setiembre: 8,
    octubre: 9,
    noviembre: 10,
    diciembre: 11,
  };
  // Formato real más común en esta plantilla: "Del 30 agosto al 06 septiembre" — dos
  // meses distintos (la semana cruza de un mes a otro) y SIN año explícito. Se valida
  // que ambas palabras capturadas sean meses reales (si no, no es este formato) y el
  // año se ancla con el de la celda FECHA, retrocediendo un año en el raro caso de que
  // la semana cruce diciembre → enero.
  const wm3 = wl.match(
    /(\d{1,2})\s*(?:de\s+)?([a-zñ]+)\s+(?:al|a|-)\s+(\d{1,2})\s*(?:de\s+)?([a-zñ]+)/i,
  );
  if (
    wm3 &&
    months[wm3[2]] !== undefined &&
    months[wm3[4]] !== undefined &&
    headerDate
  ) {
    const startMonth = months[wm3[2]];
    const endMonth = months[wm3[4]];
    const endYear = headerDate.getUTCFullYear();
    const startYear = startMonth > endMonth ? endYear - 1 : endYear;
    explicitWeekStart = new Date(
      Date.UTC(startYear, startMonth, Number(wm3[1])),
    );
    explicitWeekEnd = new Date(Date.UTC(endYear, endMonth, Number(wm3[3])));
  } else {
    const wm = wl.match(
      /(\d{1,2})\s*(?:al|a|-)\s*(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/i,
    );
    if (wm && months[wm[3]] !== undefined) {
      explicitWeekStart = new Date(
        Date.UTC(Number(wm[4]), months[wm[3]], Number(wm[1])),
      );
      explicitWeekEnd = new Date(
        Date.UTC(Number(wm[4]), months[wm[3]], Number(wm[2])),
      );
    } else {
      const wm2 = wl.match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/i);
      if (wm2 && months[wm2[2]] !== undefined) {
        explicitWeekStart = new Date(
          Date.UTC(Number(wm2[3]), months[wm2[2]], Number(wm2[1])),
        );
        explicitWeekEnd = addDays(explicitWeekStart, 6);
      }
    }
  }

  /* ---- daily events per train ---- */
  const rawEvents = { 5: [], 7: [], 8: [], 9: [] };
  let dayIndex = 0;
  let currentDate = headerDate;
  let dataStartRow = headerRow + 3; // header, subheader(CÓDIGO/SKU/ENVASADORAS/PRODUCCIÓN), subheader(Hr Inicia...)
  let summaryHeaderRow = null;

  // El número junto a cada día (lunes/martes/...) es el DÍA DEL MES real de envasado
  // (p.ej. 24, 25, 26) — NO es un offset desde la fecha verde de "FECHA" (que es solo
  // la fecha en que se envía el plan). Se reconstruye la fecha completa usando ese
  // día del mes, partiendo del mes/año de la fecha de referencia y avanzando de mes
  // automáticamente si la numeración da la vuelta (p.ej. 30, 31, 1, 2...).
  // Preferir el rango explícito de SEMANA cuando exista; FECHA queda como respaldo.
  let curMonth = (explicitWeekStart || headerDate).getUTCMonth();
  let curYear = (explicitWeekStart || headerDate).getUTCFullYear();
  let prevDayNum = null;
  let firstDayDate = explicitWeekStart
    ? new Date(explicitWeekStart.getTime())
    : null;
  if (explicitWeekStart) {
    currentDate = new Date(explicitWeekStart.getTime());
  }

  // fecha real del primer día de envasado; si la semana está explícita, no se reemplaza
  // por el mes de la celda FECHA.

  // EL DÍA DEL INSTRUCTIVO ARRANCA A LAS 22:00 DEL DÍA ANTERIOR (igual que en
  // Suite 360, ver parseSuite360Workbook). Las filas de "viernes 23" son:
  // 22:00→06:00 (turno de noche, que empieza el JUEVES 22 a las 22:00),
  // 06:00→14:00 y 14:00→22:00. Antes la fila de 22:00 se pegaba al mismo día
  // del rótulo y todo el turno de noche quedaba corrido 24 h hacia adelante:
  // un tercio del envasado aparecía un día tarde y se cruzaba con el lavado
  // de la mañana siguiente. Regla: dentro de cada día y de cada tren, una fila
  // que empieza a las 22:00 o después y aparece ANTES de cualquier fila
  // diurna es del día anterior. Si el instructivo trajera el turno de 22:00 al
  // final del día (formato calendario), esas filas ya vienen después de las
  // diurnas y se quedan en su día.
  let diaFilasMs = null;
  const yaHuboDiurna = {};
  // Primer día que de verdad trae filas. El rótulo de la hoja no siempre
  // coincide: «Semana 46 · Del 10 noviembre al 15 noviembre» arranca con el
  // lunes 09, y con el rótulo ese lunes quedaba contado en la semana 45.
  let primerDiaFilas = null;
  for (let r = dataStartRow; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const dayCell = row[dayCol];
    if (
      !isBlank(dayCell) &&
      String(dayCell).trim().toUpperCase() === "CÓDIGO"
    ) {
      summaryHeaderRow = r;
      break;
    }
    if (!isBlank(dayCell)) {
      const dateCell = row[dateCol];
      if (isDateLike(dateCell) && excelFechaAPlanta(dateCell)) {
        // Si la semana viene explícita en el encabezado, se conserva su mes/año y
        // solo se toma el día de la celda cuando corresponda. Esto evita que una
        // fecha de referencia del mes anterior desplace el plan.
        const parsedCellDate = excelFechaAPlanta(dateCell);
        if (explicitWeekStart) {
          const dayNum = parsedCellDate.getUTCDate();
          if (prevDayNum !== null && dayNum < prevDayNum) {
            curMonth++;
            if (curMonth > 11) {
              curMonth = 0;
              curYear++;
            }
          }
          currentDate = new Date(Date.UTC(curYear, curMonth, dayNum));
          prevDayNum = dayNum;
        } else {
          currentDate = parsedCellDate;
          prevDayNum = currentDate.getUTCDate();
          curMonth = currentDate.getUTCMonth();
          curYear = currentDate.getUTCFullYear();
        }
      } else {
        const dayNum = Number(dateCell);
        if (!isBlank(dateCell) && !isNaN(dayNum) && dayNum > 0) {
          if (prevDayNum !== null && dayNum < prevDayNum) {
            curMonth++;
            if (curMonth > 11) {
              curMonth = 0;
              curYear++;
            }
          }
          currentDate = new Date(Date.UTC(curYear, curMonth, dayNum));
          prevDayNum = dayNum;
        } else {
          // Respaldo si la celda no trae un número de día válido: sigue consecutivo.
          currentDate = addDays(currentDate, 1);
        }
      }
      dayIndex++;
      if (firstDayDate === null) firstDayDate = currentDate;
      if (primerDiaFilas === null) primerDiaFilas = currentDate;
    }
    TRAINS.forEach((t) => {
      const base = trainCols[t];
      const codigo = row[base],
        sku = row[base + 1],
        hi = row[base + 2],
        ht = row[base + 3],
        un = row[base + 4],
        hl = row[base + 5];
      if (isBlank(codigo) && isBlank(sku) && isBlank(hi) && isBlank(ht)) return;
      const tpHi = cellTimeParts(hi),
        tpHt = cellTimeParts(ht);
      if (!tpHi || !tpHt) return;
      if (diaFilasMs !== currentDate.getTime()) {
        diaFilasMs = currentDate.getTime();
        TRAINS.forEach((tt) => (yaHuboDiurna[tt] = false));
      }
      const esNocheDelDiaAnterior = tpHi.h >= 22 && !yaHuboDiurna[t];
      if (tpHi.h < 22) yaHuboDiurna[t] = true;
      const diaBase = esNocheDelDiaAnterior ? addDays(currentDate, -1) : currentDate;
      let start = combine(diaBase, tpHi);
      let end = combine(diaBase, tpHt);
      if (end.getTime() <= start.getTime())
        end = new Date(end.getTime() + 24 * 3600 * 1000);
      rawEvents[t].push({
        codigo: isBlank(codigo) ? null : String(codigo).trim(),
        name: isBlank(sku) ? "" : String(sku).trim(),
        start,
        end,
        unidades: Number(un) || 0,
        hectolitros: Number(hl) || 0,
      });
    });
  }

  /* ---- summary table (per-brand Hl / BBTs / tanques) ---- */
  const summary = [];
  if (summaryHeaderRow !== null) {
    const groupRow = aoa[summaryHeaderRow];
    const groups = {};
    for (let c = 0; c < groupRow.length; c++) {
      const v = groupRow[c];
      if (isBlank(v)) continue;
      const label = String(v).trim().toUpperCase();
      if (
        (/^TREN-(5|7|8|9)$/.test(label) ||
          label === "TOTAL" ||
          label === "TANQUES") &&
        groups[label] === undefined
      ) {
        // Igual que con TREN-x arriba: quedarse con la primera columna (la de
        // "Unidades") y no con la última repetición del texto fusionado.
        groups[label] = c;
      }
    }
    let r = summaryHeaderRow + 2;
    while (r < aoa.length) {
      const row = aoa[r] || [];
      const codigo = row[dayCol];
      if (isBlank(codigo)) break;
      if (String(codigo).trim().toUpperCase() === "TOTAL") break;
      const marca = row[dayCol + 1];
      const perTrain = {};
      TRAINS.forEach((t) => {
        const gc = groups["TREN-" + t];
        perTrain[t] =
          gc === undefined
            ? { unidades: 0, hlDeposito: 0, hlBBTs: 0 }
            : {
                unidades: Number(row[gc]) || 0,
                hlDeposito: Number(row[gc + 1]) || 0,
                hlBBTs: Number(row[gc + 2]) || 0,
              };
      });
      const totalCol = groups["TOTAL"];
      const total =
        totalCol === undefined
          ? null
          : {
              unidades: Number(row[totalCol]) || 0,
              hlDeposito: Number(row[totalCol + 1]) || 0,
              hlBBTs: Number(row[totalCol + 2]) || 0,
            };
      const tanquesCol = groups["TANQUES"];
      const tanques =
        tanquesCol === undefined ? null : Number(row[tanquesCol]) || 0;
      summary.push({
        codigo: String(codigo).trim(),
        marca: isBlank(marca) ? "" : String(marca).trim(),
        perTrain,
        total,
        tanques,
      });
      r++;
    }
  }

  return {
    weekLabel: weekLabel.trim(),
    headerDate,
    weekStartDate: primerDiaFilas || firstDayDate || headerDate,
    explicitWeekStart,
    explicitWeekEnd,
    rawEvents,
    summary,
  };
}

/* =========================================================================
   2) FUSIÓN DE BLOQUES CONTIGUOS + CLASIFICACIÓN
   ========================================================================= */
function classify(ev) {
  if (ev.codigo && /^\d+$/.test(ev.codigo)) return "production";
  if (/^DPA/i.test(ev.name)) return "changeover";
  if (/^NST/i.test(ev.name)) return "idle";
  return "other";
}
function mergeEvents(events) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const ev of sorted) {
    const key = ev.codigo || ev.name;
    const last = merged[merged.length - 1];
    if (
      last &&
      (last.codigo || last.name) === key &&
      Math.abs(last.end.getTime() - ev.start.getTime()) < 2 * 60000
    ) {
      last.end = ev.end > last.end ? ev.end : last.end;
      last.unidades += ev.unidades;
      last.hectolitros += ev.hectolitros;
      last.rawCount++;
    } else {
      merged.push({ ...ev, rawCount: 1, type: classify(ev) });
    }
  }
  merged.forEach((b) => (b.type = classify(b)));
  return merged;
}

/* =========================================================================
   PARSEO DEL EXCEL "PRODUCTO EN PROCESO" (.xlsm) — inventario por equipo
   Hoja "Reporte": dos bloques fijos por columnas
     · FV  → equipo=col C, marca=col D, días=col E, HL=col F, HL Diluidos=col H
     · SV  → equipo=col K, marca=col L, días=col M, HL=col N, HL Diluidos=col P
            (el mismo bloque SV contiene los SV normales y los SV Pony)
   Se leen las DOS columnas de volumen. La diluida es la que se compara con el
   plan de envasado, pero la sin diluir hace falta para reconocer la levadura
   guardada en un madurador: esas filas traen hL sin diluir y la diluida en 0.
   Hoja "BBTs": BBT=col A, PRODUCTO=col B, CANTIDAD=col C (producto terminado,
   sin tiempo). Devuelve [{equipo, marcaTexto, tipo:"FV"|"SV"|"BBT",
   diasEnEquipo, hL}].
   ========================================================================= */
function parseProductoEnProceso(workbook) {
  const out = [];
  const norm = (v) => (v == null ? "" : normalizeText(v));
  const num = (v) => {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  };
  // Distingue "sin dato" de cero: una celda vacía o con texto devuelve null.
  const numOrNull = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (s === "") return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  };
  const sheet = (want) => {
    const w = norm(want);
    const name = (workbook.SheetNames || []).find((s) => norm(s) === w);
    return name ? workbook.Sheets[name] : null;
  };
  // Palabras que NO son un equipo/marca real, sino encabezados o rótulos de los
  // bloques de la hoja "Reporte".
  const HEADER = new Set([
    "",
    "fv",
    "sv",
    "marca",
    "total",
    "capacidad",
    "hl",
    "hl diluidos",
    "hl ",
    "ocupacion",
  ]);
  const esHeader = (s) => HEADER.has(s) || /^d[ií]as/.test(s);

  const wsR = sheet("Reporte");
  if (wsR) {
    const aoa = XLSX.utils.sheet_to_json(wsR, {
      header: 1,
      defval: null,
      raw: true,
    });
    aoa.forEach((row) => {
      row = row || [];
      const push = (eqCol, maCol, diaCol, hlSinDilCol, hlCol, tipo) => {
        const eq = row[eqCol];
        const ma = row[maCol];
        if (typeof eq !== "string" || typeof ma !== "string") return;
        if (esHeader(norm(eq)) || esHeader(norm(ma))) return;
        // VACIO / PONY / PONY GO / etc. SÍ se incluyen: un equipo vacío cuenta
        // como disponible (0 hL, 0 días) para poder llenarlo con otra cosa.
        const vacio = /^vac[ií]/.test(norm(ma));
        const dias = numOrNull(row[diaCol]);
        out.push({
          equipo: String(eq).trim(),
          marcaTexto: vacio ? "" : String(ma).trim(),
          vacio,
          tipo,
          // Celda de días en blanco = SIN días, no cero. La levadura guardada se
          // reconoce justamente por venir sin días; leyéndola como 0 pasaba por
          // un equipo recién cargado.
          // Con decimales: el Excel trae 2,35 días y redondear a 2 corría la
          // fecha en que el tanque queda listo hasta 12 horas.
          diasEnEquipo: dias == null ? null : Math.round(dias * 100) / 100,
          hL: Math.round(num(row[hlCol])),
          hLSinDiluir: Math.round(num(row[hlSinDilCol])),
        });
      };
      push(2, 3, 4, 5, 7, "FV"); // bloque FV: C, D, E, F, H
      push(10, 11, 12, 13, 15, "SV"); // bloque SV (normal + Pony): K, L, M, N, P
    });
  }

  const wsB = sheet("BBTs");
  if (wsB) {
    const aoa = XLSX.utils.sheet_to_json(wsB, {
      header: 1,
      defval: null,
      raw: true,
    });
    aoa.forEach((row) => {
      row = row || [];
      const bbt = row[0];
      const prod = row[1];
      if (typeof bbt !== "string" || !/^\s*bbt/i.test(bbt)) return;
      const prodTexto = typeof prod === "string" ? prod.trim() : "";
      if (norm(prodTexto) === "producto") return; // fila de encabezado
      // Un BBT SIN producto está VACÍO, no ausente: es el más disponible que hay,
      // porque acepta cualquier marca. Antes se exigía que la celda PRODUCTO
      // viniera diligenciada, así que los vacíos se caían del inventario y el
      // programa no los veía como espacio libre. Se tratan igual que un FV o un
      // SV vacío, que sí se incluían.
      const vacio = prodTexto === "";
      out.push({
        equipo: bbt.trim(),
        // PRODUCTO es la MARCA terminada (COSTEÑITA, PILSEN, PONY GO…), no el
        // mosto: un BBT solo puede envasar esa marca.
        marcaTexto: vacio ? "" : prodTexto,
        vacio,
        tipo: "BBT",
        diasEnEquipo: null,
        // Col. D "TIEMPO DE ALMACENAMIENTO": horas que el lote lleva ya en el
        // BBT. Solo viene diligenciada para Pony y sirve para saber cuál se
        // acerca a su máximo de 48 h.
        almacenBBTHoras: row[3] == null ? null : num(row[3]),
        hL: Math.round(num(row[2])),
      });
    });
  }

  // Hoja «Control diario»: la hora en que se tomó la foto (celda A1, la misma
  // contra la que se cuentan los días de cada equipo), cuándo se cocinó lo que
  // hay en cada tanque y los tiempos mínimos de fermentación de la planta.
  const ctl = leerControlDiario(sheet("Control diario"));
  if (ctl) {
    out.forEach((e) => {
      const c = ctl.porEquipo[normalizeText(e.equipo)];
      if (!c || e.vacio) return;
      if (c.cocinadoEn) {
        e.cocinadoEn = c.cocinadoEn;
        e.cocinadoNota = c.nota;
      }
      if (c.vacioMinEn && e.tipo === "FV") e.vacioMinEn = c.vacioMinEn;
    });
    out.foto = ctl.foto;
    out.tiemposMinimos = ctl.tiemposMinimos;
    out.factores = ctl.factores;
  }
  return out;
}

function leerControlDiario(ws) {
  if (!ws) return null;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (!aoa.length) return null;
  let foto = isDateLike((aoa[0] || [])[0]) ? excelFechaHoraAPlanta(aoa[0][0]) : null;
  // Al minuto: el I0 se escribe en minutos y los segundos dejaban 43 s de
  // envasado «sin cubrir» justo en el arranque.
  if (foto) foto = new Date(Math.floor(foto.getTime() / 60000) * 60000);
  // Columnas por su encabezado (fila 1), no por posición fija.
  const head = (aoa[0] || []).map((v) => (v == null ? "" : normalizeText(String(v))));
  const col = (re) => head.findIndex((h) => re.test(h));
  const cLlenado = col(/inicio fermentacion/);
  const cIniMad = col(/inicio maduracion/);
  const cCubaJoven = col(/menor tiempo de proceso/);
  const cVacioMin = col(/tanque vacio min/);
  const fecha = (v) => (isDateLike(v) ? excelFechaHoraAPlanta(v) : null);
  const porEquipo = {};
  aoa.forEach((row, r) => {
    if (r < 2 || !row) return;
    const eq = row[0];
    if (typeof eq !== "string" && typeof eq !== "number") return;
    const key = normalizeText(String(eq));
    if (!key) return;
    const llenado = cLlenado >= 0 ? fecha(row[cLlenado]) : null;
    const cubaJoven = cCubaJoven >= 0 ? fecha(row[cCubaJoven]) : null;
    const iniMad = cIniMad >= 0 ? fecha(row[cIniMad]) : null;
    // FV: «inicio fermentación / fecha llenado desde cocinas» es cuando el
    // tanque TERMINÓ de llenarse (unas 10 h después del arranque del último
    // cocimiento que recibió). Madurador: la cuba bombeada más reciente; la Pony no
    // fermenta y entra al madurador directo de la cocina, así que ahí vale
    // el inicio de maduración.
    let cocinadoEn = null;
    let nota = "";
    if (llenado) {
      cocinadoEn = llenado;
      nota = "fin del llenado desde cocinas";
    } else if (cubaJoven) {
      cocinadoEn = cubaJoven;
      nota = "cocimiento más reciente del madurador";
    } else if (iniMad) {
      cocinadoEn = iniMad;
      nota = "entrada al madurador";
    }
    // «FECHA TANQUE VACIO MÍN» de un FV: lo más pronto que la planta lo deja
    // pasar al madurador. Cuenta la fermentación desde que TERMINA de llenarse
    // (204 h + las ~18 h de llenado de un EXT), no desde el primer cocimiento.
    const vacioMin = cVacioMin >= 0 && llenado ? fecha(row[cVacioMin]) : null;
    porEquipo[key] = {
      cocinadoEn: cocinadoEn ? cocinadoEn.toISOString() : null,
      nota,
      vacioMinEn: vacioMin ? vacioMin.toISOString() : null,
    };
  });
  // «Tiempo mínimo de fermentación»: rótulo arriba, marcas y horas debajo.
  const tiemposMinimos = {};
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const c = row.findIndex((v) => typeof v === "string" && /tiempo m[ií]nimo de ferm/i.test(v));
    if (c < 1) continue;
    for (let k = r + 1; k <= r + 4 && k < aoa.length; k++) {
      const lab = (aoa[k] || [])[c - 1];
      const val = Number((aoa[k] || [])[c]);
      if (typeof lab !== "string" || !(val > 0)) continue;
      const n = normalizeText(lab);
      if (/light/.test(n)) tiemposMinimos.light = val;
      if (/std|estandar/.test(n)) tiemposMinimos.estandar = val;
      if (/pilsen/.test(n)) tiemposMinimos.pilsen = val;
    }
    break;
  }
  // «FACTOR DILUCIÓN» por marca (bloque COCINA / BBT / FACTOR DILUCIÓN, con
  // la marca a la izquierda de COCINA). Es el mismo factor con el que el
  // archivo calcula sus «HL diluidos», así que el plan y el inventario
  // quedan en las mismas unidades.
  const factores = {};
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const c = row.findIndex((v) => typeof v === "string" && /factor\s+diluci/i.test(v));
    if (c < 1) continue;
    let marca = "";
    for (let k = r; k >= Math.max(0, r - 3) && !marca; k--) {
      const v = (aoa[k] || [])[c - 1];
      if (typeof v === "string" && v.trim()) marca = normalizeText(v);
    }
    const val = row.slice(c + 1).find((v) => typeof v === "number" && v > 0);
    if (!marca || !val) continue;
    if (/pony/.test(marca)) factores.pony = val;
    else if (/light/.test(marca)) factores.light = val;
    else if (/pilsen/.test(marca)) factores.pilsen = val;
    else if (/estandar|aguila/.test(marca)) factores.estandar = val;
  }
  return { foto: foto ? foto.toISOString() : null, porEquipo, tiemposMinimos, factores };
}

