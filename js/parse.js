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
  const suiteSheetName = workbook.SheetNames.find((name) => /^Semana\s+\d+$/i.test(String(name).trim()));
  if (suiteSheetName) {
    const ws = workbook.Sheets[suiteSheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    const looksLikeSuite360 = aoa.some((row) =>
      (row || []).some((v) => !isBlank(v) && String(v).trim().toUpperCase() === "TURNOS EN LÍNEA"),
    );
    if (looksLikeSuite360) return parseSuite360Workbook(workbook, suiteSheetName);
  }
  return parseLegacyWorkbook(workbook);
}

function suiteCellDateUTC(v) {
  if (isDateLike(v)) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
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
  let brand = p;
  if (/^cost/.test(n)) brand = "Costeñita";
  else if (/^a light|aguila light/.test(n)) brand = "Águila Light";
  else if (/^ag\b|^aguila\b/.test(n)) brand = "Águila";
  else if (/^pok/.test(n)) brand = "Poker";
  else if (/^pil/.test(n)) brand = "Pilsen";
  else if (/^pmg|^pm\b|pony/.test(n)) brand = "Pony Malta";
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
  const firstTime = cellTimeParts((aoa[HOUR_ROW] || [])[FIRST_TIME_COL]) || { h: 22, m: 0, s: 0 };
  const timelineStart = combine(firstDay, firstTime);

  /* Catálogo operativo del mismo libro: velocidad nominal y eficiencia por línea/SKU. */
  const speedCatalog = [];
  const speedSheetName = workbook.SheetNames.find((n) => normalizeText(n) === "velocidad eficiencia");
  if (speedSheetName) {
    const sws = workbook.Sheets[speedSheetName];
    const sa = XLSX.utils.sheet_to_json(sws, { header: 1, defval: null, raw: true });
    let hr = sa.findIndex((r) => (r || []).some((v) => normalizeText(v) === "recurso"));
    if (hr >= 0) {
      for (let r = hr + 1; r < sa.length; r++) {
        const row = sa[r] || [];
        const resource = String(row[0] || "").trim();
        const code = String(row[1] || "").trim();
        const description = String(row[2] || "").trim();
        const pack = Number(row[3]) || 0;
        const cc = Number(row[4]) || 0;
        const speed = Number(row[6]) || 0;
        let efficiency = row[7];
        if (typeof efficiency === "string") efficiency = Number(efficiency.replace("%", "").replace(",", ".")) / 100;
        efficiency = Number(efficiency) || 0;
        if (resource && description && speed > 0) speedCatalog.push({ resource, code, description, pack, cc, speed, efficiency });
      }
    }
  }

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

  function identifySku(train, product, formatText) {
    const fmt = String(formatText || "");
    const nums = [...fmt.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(",", ".")));
    const cc = nums[0] || 0;
    const pack = nums[1] || 0;
    const family = brandFamily(product);
    const candidates = speedCatalog.filter((x) =>
      normalizeText(x.resource) === normalizeText("TREN-" + train) &&
      (!cc || x.cc === cc) && (!pack || x.pack === pack) &&
      brandFamily(x.description) === family
    );
    return candidates[0] || null;
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

    let cursor = null;
    for (const g of grouped) {
      const gridStart = new Date(timelineStart.getTime() + (g.c - FIRST_TIME_COL) * 3600000);
      const start = cursor && Math.abs(cursor - gridStart) <= 12 * 3600000 ? new Date(cursor) : gridStart;
      if (g.production) {
        const sku = identifySku(t, g.product, g.activity);
        const rate = sku ? sku.speed * sku.efficiency : 0;
        const gridHours = g.endCol - g.c + 1;
        const durationHours = rate > 0 && g.units > 0 ? g.units / rate : gridHours;
        const end = new Date(start.getTime() + durationHours * 3600000);
        const cc = sku ? sku.cc : ((String(g.activity).match(/(\d+(?:[.,]\d+)?)\s*[xX]/) || [])[1] || 0);
        const hectolitros = Number(cc) > 0 ? g.units * Number(cc) / 100000 : 0;
        rawEvents[t].push({
          codigo: sku ? sku.code : g.product,
          name: sku ? sku.description : suiteDisplayName(g.product, g.activity),
          start, end, unidades: g.units, hectolitros,
        });
        cursor = end;
      } else {
        const durationHours = g.endCol - g.c + 1;
        const end = new Date(start.getTime() + durationHours * 3600000);
        rawEvents[t].push({
          codigo: null, name: (g.activity.match(/^(DPA|NST)/i) || [""])[0] + " - " + specialLabel(g.activity),
          start, end, unidades: 0, hectolitros: 0,
        });
        cursor = end;
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

function parseLegacyWorkbook(workbook) {
  const sheetName = workbook.SheetNames[0];
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
    ? new Date(
        Date.UTC(
          headerDateRaw.getUTCFullYear(),
          headerDateRaw.getUTCMonth(),
          headerDateRaw.getUTCDate(),
        ),
      )
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
      if (isDateLike(dateCell)) {
        // Si la semana viene explícita en el encabezado, se conserva su mes/año y
        // solo se toma el día de la celda cuando corresponda. Esto evita que una
        // fecha de referencia del mes anterior desplace el plan.
        const parsedCellDate = new Date(
          Date.UTC(
            dateCell.getUTCFullYear(),
            dateCell.getUTCMonth(),
            dateCell.getUTCDate(),
          ),
        );
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
      let start = combine(currentDate, tpHi);
      let end = combine(currentDate, tpHt);
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
    weekStartDate: firstDayDate || headerDate,
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
     · FV  → equipo=col C, marca=col D, días=col E, HL Diluidos=col H
     · SV  → equipo=col K, marca=col L, días=col M, HL Diluidos=col P
            (el mismo bloque SV contiene los SV normales y los SV Pony)
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
      const push = (eqCol, maCol, diaCol, hlCol, tipo) => {
        const eq = row[eqCol];
        const ma = row[maCol];
        if (typeof eq !== "string" || typeof ma !== "string") return;
        if (esHeader(norm(eq)) || esHeader(norm(ma))) return;
        // VACIO / PONY / PONY GO / etc. SÍ se incluyen: un equipo vacío cuenta
        // como disponible (0 hL, 0 días) para poder llenarlo con otra cosa.
        const vacio = /^vac[ií]/.test(norm(ma));
        out.push({
          equipo: String(eq).trim(),
          marcaTexto: vacio ? "" : String(ma).trim(),
          vacio,
          tipo,
          diasEnEquipo: row[diaCol] == null ? null : num(row[diaCol]),
          hL: Math.round(num(row[hlCol])),
        });
      };
      push(2, 3, 4, 7, "FV"); // bloque FV: C, D, E, H
      push(10, 11, 12, 15, "SV"); // bloque SV (normal + Pony): K, L, M, P
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
      if (
        typeof bbt === "string" &&
        /^\s*bbt/i.test(bbt) &&
        typeof prod === "string" &&
        prod.trim() &&
        norm(prod) !== "producto"
      ) {
        out.push({
          equipo: bbt.trim(),
          marcaTexto: prod.trim(),
          vacio: false,
          tipo: "BBT",
          diasEnEquipo: null,
          hL: Math.round(num(row[2])),
        });
      }
    });
  }

  return out;
}

