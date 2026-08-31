 /* =========================================================================
   1) PARSEO DEL EXCEL
   ========================================================================= */
      const TRAINS = ["5", "7", "8", "9"];
      const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

      function addDays(date, n) {
        const d = new Date(
          Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate(),
          ),
        );
        d.setUTCDate(d.getUTCDate() + n);
        return d;
      }
      function isDateLike(v) {
        return v instanceof Date;
      }
      function cellTimeParts(v) {
        // returns {h,m,s} from a Date (time-only cells still parse as Date via cellDates:true)
        if (isDateLike(v))
          return {
            h: v.getUTCHours(),
            m: v.getUTCMinutes(),
            s: v.getUTCSeconds(),
          };
        if (typeof v === "string") {
          const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (m) return { h: +m[1], m: +m[2], s: +(m[3] || 0) };
        }
        return null;
      }
      function combine(dateBase, timeParts) {
        const d = new Date(
          Date.UTC(
            dateBase.getUTCFullYear(),
            dateBase.getUTCMonth(),
            dateBase.getUTCDate(),
            timeParts.h,
            timeParts.m,
            timeParts.s,
          ),
        );
        return d;
      }
      function fmtDate(d) {
        return (
          DAY_NAMES[d.getUTCDay()] +
          " " +
          String(d.getUTCDate()).padStart(2, "0") +
          "/" +
          String(d.getUTCMonth() + 1).padStart(2, "0")
        );
      }
      function fmtDateTime(d) {
        return (
          fmtDate(d) +
          " " +
          String(d.getUTCHours()).padStart(2, "0") +
          ":" +
          String(d.getUTCMinutes()).padStart(2, "0")
        );
      }
      function parseInputDateUTC(value) {
        if (!value) return null;
        const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      }
      // Igual que parseInputDateUTC pero también acepta el valor de un input
      // datetime-local ("YYYY-MM-DDTHH:mm"), conservando la hora para poder usarla
      // como piso mínimo de arranque del primer cocimiento (programar "enseguida").
      function parseInputDateTimeUTC(value) {
        if (!value) return null;
        const m = String(value).match(
          /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/,
        );
        if (!m) return null;
        return new Date(
          Date.UTC(
            Number(m[1]),
            Number(m[2]) - 1,
            Number(m[3]),
            Number(m[4]) || 0,
            Number(m[5]) || 0,
          ),
        );
      }
      function toInputDateUTC(d) {
        if (!d || isNaN(d.getTime())) return "";
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      }
      function toInputDateTimeUTC(d) {
        if (!d || isNaN(d.getTime())) return "";
        return `${toInputDateUTC(d)}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      }
      function getI0Date() {
        const input = document.getElementById("programI0Input");
        return input ? parseInputDateTimeUTC(input.value) : null;
      }
      function fmtI0Offset(date, i0 = getI0Date()) {
        if (!date || !i0) return "—";
        const days = Math.round(
          (new Date(date).getTime() - i0.getTime()) / 86400000,
        );
        return days === 0 ? "I0" : days > 0 ? `I+${days}` : `I${days}`;
      }
      function fmtDuration(ms) {
        const totalMin = Math.round(ms / 60000);
        const h = Math.floor(totalMin / 60),
          m = totalMin % 60;
        return String(h).padStart(3, "0") + ":" + String(m).padStart(2, "0");
      }
      function isBlank(v) {
        return v === null || v === undefined || String(v).trim() === "";
      }

      function findHeaderRow(aoa) {
        for (let r = 0; r < aoa.length; r++) {
          const row = aoa[r] || [];
          for (let c = 0; c < row.length; c++) {
            if (
              !isBlank(row[c]) &&
              String(row[c]).trim().toUpperCase() === "FECHA"
            )
              return { row: r, col: c };
          }
        }
        return null;
      }

      function parseWorkbook(workbook) {
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
          : null;
        if (!headerDate)
          throw new Error(
            'No se pudo leer la fecha de referencia junto a "FECHA".',
          );

        // locate TREN-x columns on the header row
        const trainCols = {};
        const headRowVals = aoa[headerRow];
        for (let c = 0; c < headRowVals.length; c++) {
          const v = headRowVals[c];
          if (isBlank(v)) continue;
          const m = String(v)
            .trim()
            .match(/^TREN-(\d+)$/i);
          if (m && TRAINS.includes(m[1])) trainCols[m[1]] = c;
        }
        TRAINS.forEach((t) => {
          if (trainCols[t] === undefined)
            throw new Error(
              'No se encontró la columna "TREN-' + t + '" en el archivo.',
            );
        });

        // week label
        let weekLabel = "";
        for (let r = 0; r < headerRow; r++) {
          for (let c = 0; c < (aoa[r] || []).length; c++) {
            const v = aoa[r][c];
            if (!isBlank(v) && /semana/i.test(String(v))) {
              const next = aoa[r][c + 1];
              if (!isBlank(next))
                weekLabel +=
                  String(v).trim() + " " + String(next).trim() + "  ";
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
            if (isBlank(codigo) && isBlank(sku) && isBlank(hi) && isBlank(ht))
              return;
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
              /^TREN-(5|7|8|9)$/.test(label) ||
              label === "TOTAL" ||
              label === "TANQUES"
            ) {
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
   3) CATÁLOGO DE MOSTOS (editable) — homologación marca → mosto
   ========================================================================= */
      // "palabras" = palabras clave (separadas por coma) para homologar una marca a un mosto,
      // por texto contenido en el nombre de la marca — ignora deliberadamente el tamaño del envase
      // (ej. "Águila 330ml Retornable" y "Águila Lata 269ml" homologan igual a "Águila").
      // Los tiempos se editan en formato hh:mm:ss (horas:minutos:segundos) y se guardan internamente en horas.
      // IMPORTANTE: "Light" va antes que "Estandar" en la lista para que "Águila Light" homologue a
      // Mosto Light y no quede capturada primero por la palabra clave genérica "aguila" de Estandar.
      let MOSTO_CATALOG = [
        {
          id: "light",
          nombre: "Light",
          palabras: "aguila light, aguila lig, light",
          factorDilucion: 2.2,
          volumenPorCocimiento: 560,
          tiempoCocinaHoras: parseHMS("8:50:00"),
          tiempoFermentacionHoras: parseHMS("168:00:00"),
          tiempoMaduracionHoras: parseHMS("72:00:00"),
          tiempoEntreCarguesHoras: parseHMS("2:50:00"),
        },
        {
          id: "pilsen",
          nombre: "Pilsen",
          palabras: "pilsen",
          factorDilucion: 1.93,
          volumenPorCocimiento: 600,
          tiempoCocinaHoras: parseHMS("8:55:00"),
          tiempoFermentacionHoras: parseHMS("204:00:00"),
          tiempoMaduracionHoras: parseHMS("72:00:00"),
          tiempoEntreCarguesHoras: parseHMS("2:50:00"),
        },
        {
          id: "pony",
          nombre: "Pony",
          palabras: "pony",
          factorDilucion: 3.23,
          volumenPorCocimiento: 600,
          tiempoCocinaHoras: parseHMS("8:15:00"),
          tiempoFermentacionHoras: parseHMS("0"),
          tiempoMaduracionHoras: parseHMS("24:00:00"),
          tiempoEntreCarguesHoras: parseHMS("2:50:00"),
        },
        {
          id: "estandar",
          nombre: "Estandar",
          palabras: "costeñita, aguila, poker",
          factorDilucion: 1.95,
          volumenPorCocimiento: 600,
          tiempoCocinaHoras: parseHMS("8:55:00"),
          tiempoFermentacionHoras: parseHMS("204:00:00"),
          tiempoMaduracionHoras: parseHMS("72:00:00"),
          tiempoEntreCarguesHoras: parseHMS("2:50:00"),
        },
      ];

      // Catálogo de aseos (CIP) entre cambios de marca: duración según marca de origen → marca de destino.
      // "origen" y "destino" se homologan contra el catálogo de mostos igual que las marcas del Excel
      // (mismo matchMosto), así "Aguila" homologa a Estandar salvo que diga "Aguila Light".
      // Si una combinación no está definida, se usa ASEO_DEFAULT_HORAS (o el inverso, si existe).
      // Reglas fijas (no requieren fila en la matriz): no se programa aseo cuando origen y destino son
      // la misma marca, ni cuando el origen es Pony (ver getAseoDuracion).
      let ASEO_MATRIX = [
        {
          origen: "Pilsen",
          destino: "Estandar",
          duracionHoras: parseHMS("3:50:00"),
        },
        {
          origen: "Light",
          destino: "Estandar",
          duracionHoras: parseHMS("3:50:00"),
        },
        {
          origen: "Estandar",
          destino: "Pony",
          duracionHoras: parseHMS("4:40:00"),
        },
        {
          origen: "Pilsen",
          destino: "Light",
          duracionHoras: parseHMS("4:40:00"),
        },
        {
          origen: "Light",
          destino: "Pony",
          duracionHoras: parseHMS("4:40:00"),
        },
        {
          origen: "Estandar",
          destino: "Light",
          duracionHoras: parseHMS("4:40:00"),
        },
        {
          origen: "Pilsen",
          destino: "Pony",
          duracionHoras: parseHMS("4:40:00"),
        },
      ];
      let ASEO_DEFAULT_HORAS = parseHMS("3:50:00");

      // Aseo periódico (general): un aseo (CIP) adicional que se inserta automáticamente cada N
      // cocimientos consecutivos en la secuencia semanal, independientemente del mosto o de si hay
      // cambio de marca. Totalmente editable desde el panel "Aseo periódico (general)".
      let ASEO_PERIODICO = {
        activo: false,
        duracionHoras: parseHMS("3:50:00"),
        cocimientosEntreAseos: 18,
      };

      // Balance Semanal: inventario de cerveza YA DISPONIBLE para esta semana, por mosto
      // (mismas unidades HL que "volumen a envasar"). Se guarda como mapa mostoId -> HL.
      // Se persiste en localStorage para no tener que reescribirlo cada vez que se abre
      // el archivo. Se consume en computeCocinaPlan() para reducir el volumen que hay
      // que cocinar de nuevo.
      let INVENTORY_BALANCE = {};
      try {
        INVENTORY_BALANCE =
          JSON.parse(localStorage.getItem("planCocinasInventario") || "{}") ||
          {};
      } catch (_) {
        INVENTORY_BALANCE = {};
      }
      function saveInventoryBalance() {
        try {
          localStorage.setItem(
            "planCocinasInventario",
            JSON.stringify(INVENTORY_BALANCE),
          );
        } catch (_) {}
      }
      // Disponibilidad de levadura. Cada fila representa una cosecha utilizable para
      // sembrar un bloque. La única compatibilidad exclusiva es Light -> Light para
      // producir Light. Para los demás mostos se admite levadura general o Light.
      let YEAST_AVAILABILITY = [];
      try {
        YEAST_AVAILABILITY = JSON.parse(
          localStorage.getItem("planCocinasLevadura") || "[]",
        ) || [];
      } catch (_) {
        YEAST_AVAILABILITY = [];
      }
      function saveYeastAvailability() {
        try {
          localStorage.setItem(
            "planCocinasLevadura",
            JSON.stringify(YEAST_AVAILABILITY),
          );
        } catch (_) {}
      }
      function yeastTypeForMosto(mostoId) {
        return mostoId === "light" ? "light" : "general";
      }
      function yeastCompatible(sourceMostoId, targetMostoId) {
        if (targetMostoId === "light") return sourceMostoId === "light";
        return true;
      }
      function yeastAvailableDate(row) {
        if (!row || row.disponible === false) return null;
        if (!row.disponibleDesde) return getI0Date() || new Date();
        const d = new Date(row.disponibleDesde);
        return isNaN(d.getTime()) ? null : d;
      }

      // Inventario real de equipos/tanques cargado desde la matriz proporcionada.
      // AguaPromedio e indiceAguaCapacidad son informativos; la asignación utiliza capacidad,
      // prioridad, tipo y disponibilidad. Todos quedan disponibles inicialmente y pueden
      // desmarcarse desde la tabla.
      let TANK_CATALOG = [
        // FV — equipos EXT nuevos del inventario físico. Se les asigna prioridad A
        // por su mayor capacidad, para favorecer lotes más grandes y reducir CIP pequeños.
        {
          id: "fv_ext1",
          equipo: "EXT 1",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 7200,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_ext2",
          equipo: "EXT 2",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 4800,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_ext3",
          equipo: "EXT 3",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 7200,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_ext4",
          equipo: "EXT 4",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 7200,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_ext5",
          equipo: "EXT 5",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 4800,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_ext6",
          equipo: "EXT 6",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 7200,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_ext8",
          equipo: "EXT 8",
          tipo: "FV",
          aguaPromedio: 0,
          capacidadHL: 4800,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_45_309",
          equipo: "45-309",
          tipo: "FV",
          aguaPromedio: 58.25,
          capacidadHL: 900,
          indiceAguaCapacidad: 0.065,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_41_309",
          equipo: "41-309",
          tipo: "FV",
          aguaPromedio: 63.8,
          capacidadHL: 900,
          indiceAguaCapacidad: 0.071,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_43_309",
          equipo: "43-309",
          tipo: "FV",
          aguaPromedio: 64.88,
          capacidadHL: 900,
          indiceAguaCapacidad: 0.072,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_42_309",
          equipo: "42-309",
          tipo: "FV",
          aguaPromedio: 71.45,
          capacidadHL: 900,
          indiceAguaCapacidad: 0.079,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_46_309",
          equipo: "46-309",
          tipo: "FV",
          aguaPromedio: 72.55,
          capacidadHL: 900,
          indiceAguaCapacidad: 0.081,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_44_309",
          equipo: "44-309",
          tipo: "FV",
          aguaPromedio: 73.38,
          capacidadHL: 900,
          indiceAguaCapacidad: 0.082,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_51_309a",
          equipo: "51-309A",
          tipo: "FV",
          aguaPromedio: 76.0,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.101,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_50_309a",
          equipo: "50-309A",
          tipo: "FV",
          aguaPromedio: 76.45,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.102,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_47_309a",
          equipo: "47-309A",
          tipo: "FV",
          aguaPromedio: 80.25,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.107,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_52_310",
          equipo: "52-310",
          tipo: "FV",
          aguaPromedio: 84.11,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.112,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_53_310",
          equipo: "53-310",
          tipo: "FV",
          aguaPromedio: 85.5,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.114,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_55_310",
          equipo: "55-310",
          tipo: "FV",
          aguaPromedio: 87.5,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.117,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_56_310",
          equipo: "56-310",
          tipo: "FV",
          aguaPromedio: 87.5,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.117,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_57_310",
          equipo: "57-310",
          tipo: "FV",
          aguaPromedio: 88.38,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.118,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_49_309a",
          equipo: "49-309A",
          tipo: "FV",
          aguaPromedio: 90.92,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.121,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_58_310",
          equipo: "58-310",
          tipo: "FV",
          aguaPromedio: 96.63,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.129,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_54_310",
          equipo: "54-310",
          tipo: "FV",
          aguaPromedio: 102.0,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.136,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "fv_48_309a",
          equipo: "48-309A",
          tipo: "FV",
          aguaPromedio: 108.75,
          capacidadHL: 750,
          indiceAguaCapacidad: 0.145,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        // SV — equipos EXT nuevos del inventario físico. Se les asigna prioridad A
        // por su mayor capacidad, para favorecer tanques llenos y reducir CIP pequeños.
        {
          id: "sv_ext7",
          equipo: "EXT 7",
          tipo: "SV",
          aguaPromedio: 0,
          capacidadHL: 3200,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_ext9",
          equipo: "EXT 9",
          tipo: "SV",
          aguaPromedio: 0,
          capacidadHL: 5300,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_ext10",
          equipo: "EXT 10",
          tipo: "SV",
          aguaPromedio: 0,
          capacidadHL: 8500,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_ext11",
          equipo: "EXT 11",
          tipo: "SV",
          aguaPromedio: 0,
          capacidadHL: 8500,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_ext14",
          equipo: "EXT 14",
          tipo: "SV",
          aguaPromedio: 0,
          capacidadHL: 820,
          indiceAguaCapacidad: 0,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_17_210",
          equipo: "17-210",
          tipo: "SV",
          aguaPromedio: 63.63,
          capacidadHL: 820,
          indiceAguaCapacidad: 0.078,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_16_210",
          equipo: "16-210",
          tipo: "SV",
          aguaPromedio: 68.0,
          capacidadHL: 820,
          indiceAguaCapacidad: 0.083,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_15_210",
          equipo: "15-210",
          tipo: "SV",
          aguaPromedio: 74.75,
          capacidadHL: 820,
          indiceAguaCapacidad: 0.091,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_9_209",
          equipo: "9-209",
          tipo: "SV",
          aguaPromedio: 104.75,
          capacidadHL: 1000,
          indiceAguaCapacidad: 0.105,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_6_209",
          equipo: "6-209",
          tipo: "SV",
          aguaPromedio: 90.75,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.106,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_7_209",
          equipo: "7-209",
          tipo: "SV",
          aguaPromedio: 98.83,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.115,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_18_210",
          equipo: "18-210",
          tipo: "SV",
          aguaPromedio: 111.05,
          capacidadHL: 820,
          indiceAguaCapacidad: 0.135,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_8_209",
          equipo: "8-209",
          tipo: "SV",
          aguaPromedio: 119.13,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.139,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "sv_19_210",
          equipo: "19-210",
          tipo: "SV",
          aguaPromedio: 115.0,
          capacidadHL: 820,
          indiceAguaCapacidad: 0.14,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        // SV Pony
        {
          id: "svpony_4_209",
          equipo: "4-209",
          tipo: "SV Pony",
          aguaPromedio: 85.9,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.1,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "svpony_2_209",
          equipo: "2-209",
          tipo: "SV Pony",
          aguaPromedio: 88.1,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.102,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "svpony_3_209",
          equipo: "3-209",
          tipo: "SV Pony",
          aguaPromedio: 88.7,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.103,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "svpony_1_209",
          equipo: "1-209",
          tipo: "SV Pony",
          aguaPromedio: 89.9,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.105,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "svpony_5_209",
          equipo: "5-209",
          tipo: "SV Pony",
          aguaPromedio: 93.2,
          capacidadHL: 860,
          indiceAguaCapacidad: 0.108,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        // BBT
        {
          id: "bbt19",
          equipo: "BBT19",
          tipo: "BBT",
          aguaPromedio: 37.42,
          capacidadHL: 1300,
          indiceAguaCapacidad: 0.029,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt22",
          equipo: "BBT22",
          tipo: "BBT",
          aguaPromedio: 52.56,
          capacidadHL: 1300,
          indiceAguaCapacidad: 0.04,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt24",
          equipo: "BBT24",
          tipo: "BBT",
          aguaPromedio: 62.21,
          capacidadHL: 1300,
          indiceAguaCapacidad: 0.048,
          prioridad: "A",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt20",
          equipo: "BBT20",
          tipo: "BBT",
          aguaPromedio: 75.75,
          capacidadHL: 1300,
          indiceAguaCapacidad: 0.058,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt2",
          equipo: "BBT2",
          tipo: "BBT",
          aguaPromedio: 53.79,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.067,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt1",
          equipo: "BBT1",
          tipo: "BBT",
          aguaPromedio: 57.03,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.071,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt7",
          equipo: "BBT7",
          tipo: "BBT",
          aguaPromedio: 57.56,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.072,
          prioridad: "B",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt3",
          equipo: "BBT3",
          tipo: "BBT",
          aguaPromedio: 60.58,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.076,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt5",
          equipo: "BBT5",
          tipo: "BBT",
          aguaPromedio: 62.88,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.079,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt4",
          equipo: "BBT4",
          tipo: "BBT",
          aguaPromedio: 63.63,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.08,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
        {
          id: "bbt6",
          equipo: "BBT6",
          tipo: "BBT",
          aguaPromedio: 71.64,
          capacidadHL: 800,
          indiceAguaCapacidad: 0.09,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        },
      ];

      function escapeHtml(s) {
        return String(s == null ? "" : s).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        );
      }
      function normalizeText(str) {
        return (str || "")
          .toString()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim();
      }
      // Convierte "hh:mm:ss", "hh:mm" o un número simple de horas a horas decimales.
      function parseHMS(str) {
        if (str === null || str === undefined) return 0;
        const s = String(str).trim();
        if (!s) return 0;
        const parts = s.split(":").map((p) => parseFloat(p));
        if (parts.some((p) => isNaN(p))) return 0;
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return parts[0] + parts[1] / 60;
        return parts[0] + parts[1] / 60 + parts[2] / 3600;
      }
      // Convierte horas decimales a "hh:mm:ss" para mostrar en el input.
      function formatHMS(hoursFloat) {
        const totalSeconds = Math.max(
          0,
          Math.round((Number(hoursFloat) || 0) * 3600),
        );
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }

      /* =========================================================================
   4) DATOS POR MARCA (volumen a envasar + fecha/hora "lista desde")
   ========================================================================= */
      function buildBrandList(parsed, mergedByTrain) {
        // El plan de envasado define BLOQUES físicos. Filas consecutivas del mismo
        // mosto/marca pertenecen al mismo bloque de cocina y se deben programar
        // juntas. Si la misma marca reaparece después de otra marca, se crea un
        // bloque nuevo y puede ejecutarse más tarde.
        const events = [];
        let order = 0;
        TRAINS.forEach((t) => {
          (mergedByTrain[t] || [])
            .filter((b) => b.type === "production" && b.codigo)
            .forEach((b) => {
              events.push({
                codigo: b.codigo,
                name: b.name || b.codigo,
                earliest: new Date(b.start.getTime()),
                end: b.end ? new Date(b.end.getTime()) : null,
                volumen: Number(b.hectolitros) || 0,
                train: t,
                sequenceOrder: order++,
              });
            });
        });

        // Orden del plan de envasado. No usamos aquí las fechas de cocina calculadas.
        // La primera fecha/hora de envasado determina el orden temporal de los bloques.
        // Una vez ordenados los eventos, renumeramos la posición para que el bloque conserve
        // exactamente este orden al pasar a Programación de cocinas y Secuencia semanal.
        events.sort(
          (a, b) =>
            a.earliest - b.earliest || a.sequenceOrder - b.sequenceOrder,
        );
        events.forEach((e, i) => {
          e.sequenceOrder = i;
        });

        const summaryMap = {};
        (parsed.summary || []).forEach((s) => (summaryMap[s.codigo] = s));

        const brands = [];
        let current = null;
        let blockIndex = 0;

        function flush() {
          if (!current || !(current.volumen > 0)) return;
          brands.push({
            codigo: current.codigo,
            name: current.name,
            earliest: current.earliest,
            end: current.end,
            volumen: current.volumen,
            train: current.train,
            sequenceOrder: current.sequenceOrder,
            blockLabel: `${current.name} · bloque ${blockIndex + 1}`,
            marcas: current.marcas,
          });
          blockIndex++;
          current = null;
        }

        events.forEach((e) => {
          let volumen = e.volumen;
          if (!(volumen > 0)) {
            const summary = summaryMap[e.codigo];
            volumen =
              summary && summary.total && Number(summary.total.hlBBTs) > 0
                ? Number(summary.total.hlBBTs)
                : 0;
          }
          if (!(volumen > 0)) return;

          const mostoId = matchMosto(e.name, MOSTO_CATALOG);
          const currentMostoId = current
            ? matchMosto(current.name, MOSTO_CATALOG)
            : null;

          // Agrupar SOLO filas consecutivas del mismo mosto. Nunca juntar dos
          // apariciones separadas de la misma marca.
          if (!current || mostoId !== currentMostoId) {
            flush();
            current = {
              codigo: e.codigo,
              name: e.name,
              earliest: new Date(e.earliest.getTime()),
              end: e.end ? new Date(e.end.getTime()) : null,
              volumen,
              train: e.train,
              sequenceOrder: e.sequenceOrder,
              marcas: [e],
            };
          } else {
            current.volumen += volumen;
            if (e.earliest && e.earliest < current.earliest)
              current.earliest = new Date(e.earliest.getTime());
            if (e.end && (!current.end || e.end > current.end))
              current.end = new Date(e.end.getTime());
            current.marcas.push(e);
          }
        });
        flush();

        if (!brands.length) {
          (parsed.summary || []).forEach((s, idx) => {
            const volumen = Number(s.total && s.total.hlBBTs) || 0;
            if (!(volumen > 0)) return;
            brands.push({
              codigo: s.codigo,
              name: s.marca || s.codigo,
              earliest: null,
              end: null,
              volumen,
              train: null,
              sequenceOrder: idx,
              blockLabel: `${s.marca || s.codigo} · bloque ${idx + 1}`,
              marcas: [s],
            });
          });
        }
        return brands;
      }

      /* =========================================================================
   5) HOMOLOGACIÓN + CÁLCULO DE PROGRAMACIÓN DE COCINAS
   ========================================================================= */
      function matchMosto(brandName, catalog) {
        const n = normalizeText(brandName);
        for (const m of catalog) {
          // El nombre propio del mosto (p.ej. "Estandar") también debe reconocerse, además de sus
          // palabras clave de homologación (p.ej. "costeñita, aguila, poker") — si no, un aseo definido
          // como "Estandar → Light" no encuentra el mosto "Estandar" porque su nombre no está entre sus
          // propias palabras clave (esas son solo las marcas que homologan a él, no su nombre).
          const keys = [
            normalizeText(m.nombre),
            ...(m.palabras || "").split(",").map((k) => normalizeText(k)),
          ].filter(Boolean);
          if (keys.some((k) => n.includes(k))) return m.id;
        }
        return null;
      }

      function computeCocimientoStarts(fechaEnvasadoMinima, numCocimientos, m) {
        if (!fechaEnvasadoMinima || numCocimientos <= 0) return [];
        // La fecha de envasado, menos maduración y fermentación, marca el instante en que el
        // ÚLTIMO cocimiento debe estar listo (fin de cocina = inicio de fermentación).
        const deadline = new Date(
          fechaEnvasadoMinima.getTime() -
            (Number(m.tiempoFermentacionHoras) || 0) * 3600 * 1000 -
            (Number(m.tiempoMaduracionHoras) || 0) * 3600 * 1000,
        );
        const cocinaMs = (Number(m.tiempoCocinaHoras) || 0) * 3600 * 1000;
        const gapMs = (Number(m.tiempoEntreCarguesHoras) || 0) * 3600 * 1000;

        // La diferencia entre INICIOS de cocimientos es siempre el tiempo entre cargues.
        // La duración de cocina solo determina cuánto antes del fin de fermentación debe
        // comenzar el último cocimiento.
        // El ÚLTIMO inicio se obtiene restando SOLO el tiempo de cocina al fin de cocina requerido.
        // A partir de ahí, cada inicio anterior se separa exactamente por el tiempo ENTRE CARGUES.
        // En el catálogo operativo ese valor es 2:50 h, salvo que el usuario lo cambie manualmente.
        const lastStartMs = deadline.getTime() - cocinaMs;
        const firstStartMs =
          lastStartMs - Math.max(0, numCocimientos - 1) * gapMs;
        const starts = Array.from(
          { length: numCocimientos },
          (_, i) => new Date(firstStartMs + i * gapMs),
        );

        // Validación estructural: la separación entre inicios debe ser exactamente
        // el tiempo entre cargues; la duración de cocina NO interviene entre inicios.
        for (let i = 1; i < starts.length; i++) {
          const delta = starts[i].getTime() - starts[i - 1].getTime();
          if (Math.abs(delta - gapMs) > 1) {
            throw new Error(
              `Error de programación: la separación entre cocimientos de ${m.nombre} no coincide con el tiempo entre cargues.`,
            );
          }
        }
        return starts;
      }

      function computeCocinaPlan(brands, catalog, inventoryBalance) {
        const sinHomologar = [];
        const results = [];

        // Balance Semanal: copia consumible del inventario disponible por mosto. Se va
        // descontando en el orden en que aparecen los bloques del plan de envasado, así
        // que el inventario cubre primero el bloque más próximo de esa marca.
        const remainingInv = {};
        (catalog || []).forEach((m) => {
          remainingInv[m.id] = Math.max(
            0,
            Number((inventoryBalance || {})[m.id]) || 0,
          );
        });

        // IMPORTANTE: no se agrupan todos los registros de una misma marca/mosto.
        // Cada bloque de envasado conserva su propia fecha de necesidad y volumen,
        // de modo que una misma marca puede volver a aparecer más tarde como otro
        // bloque, siempre completo y sin intercalar cocimientos de otras marcas.
        (brands || []).forEach((b, blockIndex) => {
          const mostoId = matchMosto(b.name, catalog);
          if (!mostoId) {
            if (b.volumen > 0) sinHomologar.push(b);
            return;
          }
          const m = catalog.find((x) => x.id === mostoId) || {};
          const volumenEnvasar = Number(b.volumen) || 0;
          if (!(volumenEnvasar > 0)) return;
          const factor = Number(m.factorDilucion) || 1;

          // El inventario disponible se descuenta del volumen que hay que COCINAR, no del
          // volumen a envasar: el compromiso de envasado no cambia, solo cuánto de eso sale
          // de un cocimiento nuevo vs. de cerveza que ya está lista en inventario.
          const invDisponible = remainingInv[mostoId] || 0;
          const cubiertoPorInventario = Math.min(invDisponible, volumenEnvasar);
          remainingInv[mostoId] = invDisponible - cubiertoPorInventario;
          const volumenEnvasarPendiente =
            volumenEnvasar - cubiertoPorInventario;

          const volumenCocinar = volumenEnvasarPendiente / factor;
          const volXCoc = Number(m.volumenPorCocimiento) || 1;
          let numCocimientos =
            volumenCocinar > 1e-9
              ? Math.max(1, Math.ceil(volumenCocinar / volXCoc))
              : 0;

          // Regla 4 (acuerdo de servicio): los bloques de producción de Pony Malta deben
          // contemplar como mínimo DOS cocimientos consecutivos, aunque el volumen a
          // cocinar quepa completo en un solo cocimiento. Si el cálculo por volumen dio
          // solo 1, se fuerza a 2 y se reparte el volumen entre ambos (en vez de dejar
          // el primero lleno y el segundo en 0 hL).
          let volumenPorCocimientoOverride = null;
          if (mostoId === "pony" && numCocimientos === 1) {
            numCocimientos = 2;
            if (volumenCocinar <= volXCoc) {
              volumenPorCocimientoOverride = volumenCocinar / 2;
            }
          }

          let starts = [];
          if (b.earliest && numCocimientos > 0) {
            starts = computeCocimientoStarts(b.earliest, numCocimientos, m);
          }

          results.push({
            mostoId,
            nombre: m.nombre,
            volumenEnvasar,
            volumenCocinar,
            numCocimientos,
            volumenPorCocimientoOverride,
            starts,
            fechaEnvasadoMinima: b.earliest,
            fechaEnvasadoFin: b.end || null,
            codigo: b.codigo,
            tren: b.train,
            sequenceOrder: Number.isFinite(b.sequenceOrder)
              ? b.sequenceOrder
              : blockIndex,
            blockLabel:
              b.blockLabel || `${m.nombre} · bloque ${blockIndex + 1}`,
            marcas: [b],
            inventarioUsadoHL: cubiertoPorInventario,
            cubiertoTotalPorInventario:
              numCocimientos === 0 && cubiertoPorInventario > 0,
          });
        });

        // Mantener el orden de bloques del plan de envasado. NO ordenar por start de cocina.
        results.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        return { results, sinHomologar };
      }

      /* =========================================================================
   5.5) REGLAS OPERATIVAS DE PROGRAMACIÓN + RECOMENDACIONES + SECUENCIACIÓN
   ========================================================================= */
      const REGLAS_OPERATIVAS = [
        {
          id: 1,
          texto:
            "Garantizar la ejecución de aseos con una frecuencia máxima de 14 días. Programar máximo 81.000 hL; si se prioriza cerveza, máximo 66.000 hL de cerveza y 15.000 hL de Pony; si se prioriza Pony, máximo 23.600 hL de Pony y 57.400 hL de cerveza.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 2,
          texto:
            "Los cambios de marca deben programarse previamente y mantenerse conforme al plan congelado de 1 semana, definido en la reunión W+1.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 3,
          texto: "Evitar finalizar la producción con la marca Pony.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 4,
          texto:
            "Los bloques de producción de Pony Malta deberán contemplar como mínimo dos cocimientos consecutivos (4.100 hL mínimo).",
          impacto: "HEAT/AGUA",
        },
        {
          id: 5,
          texto:
            "No desprogramar las líneas de tal manera que las paradas sean superiores a dos días, con el fin de evitar consumos de CO₂ sin producción.",
          impacto: "CO2",
        },
        {
          id: 6,
          texto:
            "El volumen programado de Pony Malta no deberá superar los 23.600 hL por semana.",
          impacto: "CO2",
        },
        {
          id: 7,
          texto:
            "El tiempo de maduración no deberá exceder los 4 días. Garantizar que se filtre un bloque completo de cada marca.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 8,
          texto:
            "Cumplir estrictamente las ventanas de mantenimiento establecidas. Seguir la fecha fija asignada y solo cambiar con aviso mínimo de tres turnos laborales (24 horas) para programación.",
          impacto: "EE/HEAT/AGUA",
        },
        {
          id: 9,
          texto:
            "Ejecutar la filtración en bloques completos por marca, finalizando la totalidad del volumen programado de Estándar, Pilsen y Águila Light antes de iniciar la filtración de una marca diferente. No se permiten filtraciones intermedias de otras marcas dentro de un mismo bloque.",
          impacto: "EE/HEAT/AGUA",
        },
        {
          id: 10,
          texto:
            "No mezclar formatos grandes de Pony Malta con filtración de Águila Light.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 11,
          texto:
            "Mantener actualizada la programación en SUITE360, informando cambios y secuencias a las áreas implicadas (Elaboración y Envase), para garantizar tiempos de proceso y secuencias de arranque.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 12,
          texto:
            "Realizar un único bloque semanal de filtración de Águila Light.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 13,
          texto:
            "Contar con un inventario máximo en BBT de 5.000 hL de una marca diferente antes de iniciar la filtración de otro SKU.",
          impacto: "HEAT/AGUA",
        },
        {
          id: 14,
          texto:
            "Actualizar las eficiencias de las líneas de envasado según su variación real en el salón de embotellado.",
          impacto: "CO2",
        },
      ];
      // Reglas que SÍ se pueden validar con los datos de este archivo (volúmenes y horarios de cocinas + aseos CIP).
      // El resto depende de datos de líneas de envasado, filtración, mantenimiento o SUITE360 que no están aquí.
      const REGLAS_VERIFICABLES = new Set([1, 3, 4, 5, 6, 7, 12]);

      const RECOMENDACIONES = [
        {
          id: "r1",
          texto:
            "Iniciar la producción semanal con Pony para aprovechar los aseos semanales y optimizar los consumos asociados a arranques y cambios de proceso.",
          impacto: "EE/HEAT/AGUA",
        },
        {
          id: "r2",
          texto:
            "Planificar la producción de forma que los bloques de Pony queden cercanos a los aseos programados, reduciendo cambios operativos y consumos de recursos.",
          impacto: "EE/HEAT/AGUA",
        },
      ];

      function computeDeadline(fechaEnvasadoMinima, m) {
        if (!fechaEnvasadoMinima) return null;
        return new Date(
          fechaEnvasadoMinima.getTime() -
            (Number(m.tiempoFermentacionHoras) || 0) * 3600 * 1000 -
            (Number(m.tiempoMaduracionHoras) || 0) * 3600 * 1000,
        );
      }
      function dateKey(d) {
        return (
          d.getUTCFullYear() + "-" + d.getUTCMonth() + "-" + d.getUTCDate()
        );
      }

      // Resuelve la duración de aseo (CIP) para una transición de mosto → mosto, usando ASEO_MATRIX
      // homologada contra el catálogo de mostos (misma lógica que matchMosto para las marcas del Excel).
      function resolveAseoMatrix(matrix, catalog) {
        return matrix.map((a) => ({
          ...a,
          origenId: matchMosto(a.origen, catalog),
          destinoId: matchMosto(a.destino, catalog),
        }));
      }
      function getAseoDuracion(
        fromMostoId,
        toMostoId,
        resolvedMatrix,
        defaultHoras,
      ) {
        // Regla fija: no se programa aseo hacia la misma marca.
        if (fromMostoId && toMostoId && fromMostoId === toMostoId) {
          return { horas: 0, definido: true, sinAseo: true };
        }
        // Regla fija: no se programa aseo cuando se sale de Pony hacia cualquier otra marca.
        if (fromMostoId === "pony") {
          return { horas: 0, definido: true, sinAseo: true };
        }
        let m = resolvedMatrix.find(
          (a) => a.origenId === fromMostoId && a.destinoId === toMostoId,
        );
        if (m) return { horas: Number(m.duracionHoras) || 0, definido: true };
        m = resolvedMatrix.find(
          (a) => a.origenId === toMostoId && a.destinoId === fromMostoId,
        );
        if (m) return { horas: Number(m.duracionHoras) || 0, definido: true };
        return { horas: Number(defaultHoras) || 0, definido: false };
      }

      // Construye la secuencia real de cocimientos (una sola cocina compartida) respetando bloques
      // independientes del plan de envasado. Una misma marca/mosto puede reaparecer en otro bloque
      // más tarde si el plan la necesita de nuevo, pero nunca se intercalan marcas dentro de un bloque.
      // - regla 3: evitar terminar la semana con Pony (se intercambia de posición si es posible).
      // - recomendación 1: intentar iniciar la semana con Pony, solo si no rompe ninguna fecha límite.
      // - regla 4: bloque de Pony con mínimo de cocimientos necesario para cubrir 4.100 hL.
      // - regla 5: alerta si queda un hueco > 2 días entre bloques.
      // - reglas 6 y 1: alertas de volumen semanal de Pony / cerveza.
      // - regla 7: alerta si la maduración configurada supera 4 días.
      // - un evento de ASEO (CIP) programado en cada cambio de marca, con duración según ASEO_MATRIX.
      function assignTanks(seq, plan, tankCatalog, catalog) {
        /*
    MODELO FISICO DE EQUIPOS
    ------------------------
    FV       = FERMENTACIÓN. Recibe mosto directamente desde cocina.
    SV       = MADURACIÓN. NO recibe cocimiento de cocina; recibe producto
               transferido desde FV después de terminar la fermentación.
    SV Pony  = MADURACIÓN EXCLUSIVA DE PONY. Pony no usa SV normales.
    BBT      = PRODUCTO TERMINADO. No participa en fermentación ni maduración.

    En FV y SV se procura llenar la capacidad con producto de una sola marca.
    Un FV parcialmente lleno permanece abierto y NO se pasa al siguiente FV mientras
    todavía pueda recibir otro cocimiento COMPLETO de la misma marca. Varios cocimientos
    se acumulan en el mismo tanque hasta llenarlo. Un cocimiento no se fracciona entre
    dos tanques. Solo al llenarse se cierra el lote y comienza la fermentación.
    En SV se aplica la misma regla para los lotes transferidos desde FV. Se respeta
    A → B → C sin mezclar marcas.
  */
        const tanks = (tankCatalog || [])
          .map((t, idx) => ({
            ...t,
            idx,
            capacidadHL: Number(t.capacidadHL) || 0,
            prioridad: ["A", "B", "C"].includes(
              String(t.prioridad).toUpperCase(),
            )
              ? String(t.prioridad).toUpperCase()
              : "C",
            disponible: t.disponible !== false,
            volumenAsignado: 0,
            mostoId: null,
            releaseTime: null,
            loteCerrado: false,
          }))
          .sort(
            (a, b) =>
              ({ A: 0, B: 1, C: 2 })[a.prioridad] -
                { A: 0, B: 1, C: 2 }[b.prioridad] || a.idx - b.idx,
          );

        const cookRows = ((seq && seq.rows) || []).filter(
          (r) => r.tipo === "cocimiento",
        );
        // El orden recibido ya representa bloques completos por marca: no se intercalan marcas.
        // Mantener este orden es obligatorio para que un tanque se llene con cocimientos consecutivos
        // de la misma marca antes de abrir otro bloque de marca.
        const resultRows = [];
        const sinTanque = [];
        const transferencias = [];

        const mById = (id) => (catalog || []).find((x) => x.id === id);
        const isPony = (id) => id === "pony";
        const isFV = (t) => t.tipo === "FV";
        const isSV = (t) => t.tipo === "SV" || t.tipo === "SV Pony";
        const canFV = (t, mostoId) =>
          t.disponible && isFV(t) && t.capacidadHL > 0 && !isPony(mostoId);
        const canSV = (t, mostoId) =>
          t.disponible &&
          isSV(t) &&
          t.capacidadHL > 0 &&
          (t.tipo !== "SV Pony" ? !isPony(mostoId) : isPony(mostoId));

        function releaseFinished(now) {
          tanks.forEach((t) => {
            if (
              t.releaseTime &&
              now &&
              now.getTime() >= t.releaseTime.getTime()
            ) {
              // El equipo se libera al terminar la etapa. Antes de volver a usarlo
              // debe pasar por aseo; por eso conservamos el último mosto para
              // calcular el tiempo de CIP al momento de la siguiente asignación.
              t.volumenAsignado = 0;
              t.ultimoMostoId = t.mostoId || t.ultimoMostoId || null;
              t.ultimoReleaseTime = t.releaseTime;
              t.mostoId = null;
              t.releaseTime = null;
              t.loteCerrado = false;
              t.__loteFV = null;
            }
          });
        }

        function limpiezaNecesaria(t, nuevoMostoId) {
          // El aseo de reutilización lo define el usuario POR EQUIPO en el catálogo.
          // La matriz ASEO_MATRIX sigue siendo exclusivamente para aseos de cocina
          // entre cambios de marca; no se usa para liberar FV/SV.
          const h = Number(t && t.aseoHoras);
          return Number.isFinite(h) && h >= 0
            ? h
            : Number(ASEO_DEFAULT_HORAS) || 0;
        }

        function equipoDisponibleEn(t, now, nuevoMostoId) {
          if (t.releaseTime && now && now.getTime() < t.releaseTime.getTime())
            return false;
          if (!t.ultimoMostoId) return true;
          const base = t.releaseTime || t.ultimoReleaseTime || now;
          if (!base || !now) return true;
          const aseoH = limpiezaNecesaria(t, nuevoMostoId);
          const listo = new Date(base.getTime() + aseoH * 3600000);
          return now.getTime() >= listo.getTime();
        }

        // 1) ASIGNACIÓN A FV: cada cocimiento entra a fermentación.
        // Pony tiene 0 h de fermentación y pasa directamente a SV Pony.
        cookRows.forEach((r, idx) => {
          // PONY NO PASA POR FV: sale de cocina y entra directamente a SV Pony para maduración.
          // Se registra en el bloque específico de transferencias Pony más abajo.
          if (r.mostoId === "pony") return;
          const m = mById(r.mostoId);
          const fermentHoras = Number(m && m.tiempoFermentacionHoras) || 0;
          let restante = Math.max(0, Number(r.cocVolumenHL) || 0);
          if (restante <= 0) {
            const sin = {
              ...r,
              cocimientoNumero: idx + 1,
              etapa: "FV · Fermentación",
              volumenHL: 0,
              tanque: null,
              estado: "sin tanque",
              motivo: "Cocimiento sin volumen calculable",
            };
            resultRows.push(sin);
            sinTanque.push(sin);
            return;
          }

          releaseFinished(r.start);
          const asignaciones = [];

          // Para el mismo mosto: primero tanques FV ya abiertos; luego vacíos, siempre A→B→C.
          while (restante > 1e-9) {
            const candidatos = tanks
              .filter((t) => {
                if (!canFV(t, r.mostoId)) return false;
                if (!equipoDisponibleEn(t, r.start, r.mostoId)) return false;
                const libre = t.capacidadHL - t.volumenAsignado;
                // Un cocimiento completo se mantiene en UN solo tanque.
                // Varios cocimientos de la misma marca pueden compartir el tanque,
                // pero no se parte un cocimiento entre dos FV.
                if (libre + 1e-9 < restante || t.loteCerrado) return false;
                if (t.mostoId && t.mostoId !== r.mostoId) return false;
                return true;
              })
              .sort((a, b) => {
                const aa = a.mostoId === r.mostoId ? 0 : 1,
                  bb = b.mostoId === r.mostoId ? 0 : 1;
                return (
                  aa - bb ||
                  { A: 0, B: 1, C: 2 }[a.prioridad] -
                    { A: 0, B: 1, C: 2 }[b.prioridad] ||
                  a.idx - b.idx
                );
              });
            const tank = candidatos[0];
            if (!tank) break;
            // El cocimiento completo entra al mismo tanque; nunca se fracciona.
            const carga = restante;
            tank.volumenAsignado += carga;
            tank.mostoId = r.mostoId;
            tank.ultimoMostoId = null;
            tank.ultimoReleaseTime = null;
            const lleno = tank.volumenAsignado >= tank.capacidadHL - 1e-9;
            const fermentEnd = new Date(
              r.end.getTime() + fermentHoras * 3600000,
            );
            // IMPORTANTE: un FV parcialmente lleno NO empieza a fermentar/liberarse todavía.
            // Se mantiene abierto para que los siguientes cocimientos de la MISMA marca
            // continúen llenándolo. Solo cuando llega a su capacidad se cierra el lote y
            // comienza a correr la fermentación desde el último cocimiento que lo llenó.
            if (lleno) {
              tank.releaseTime = fermentEnd;
              tank.loteCerrado = true;
            } else {
              tank.releaseTime = null;
              tank.loteCerrado = false;
            }
            asignaciones.push({ tank, carga, lleno, fermentEnd });
            restante -= carga;
          }

          if (restante > 1e-9) {
            const sin = {
              ...r,
              cocimientoNumero: idx + 1,
              etapa: "FV · Fermentación",
              volumenHL: Math.max(0, Number(r.cocVolumenHL) || 0),
              tanque: null,
              estado: "sin tanque",
              motivo: `Faltan ${restante.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL de capacidad en FV disponibles. Los SV son solo de maduración y los BBT solo de producto terminado.`,
            };
            resultRows.push(sin);
            sinTanque.push(sin);
            return;
          }

          asignaciones.forEach((a, subIdx) => {
            const t = a.tank;
            resultRows.push({
              ...r,
              cocimientoNumero: idx + 1,
              subAsignacion: subIdx + 1,
              etapa: "FV · Fermentación",
              volumenHL: a.carga,
              tanque: t.equipo || `Equipo ${t.idx + 1}`,
              tanqueId: t.id,
              tanqueTipo: "FV",
              prioridad: t.prioridad,
              capacidadHL: t.capacidadHL,
              acumuladoHL: t.volumenAsignado,
              restanteHL: Math.max(0, t.capacidadHL - t.volumenAsignado),
              tanqueLleno: a.lleno,
              estado: "Asignado",
            });
            // La transferencia FV→SV se registra sobre el LOTE del FV, no sobre cada cocimiento.
            // Así varios cocimientos que llenan el mismo FV pasan juntos a maduración.
            if (!t.__loteFV) {
              t.__loteFV = {
                mostoId: r.mostoId,
                nombre: r.nombre,
                volumenHL: 0,
                fermentEnd: a.fermentEnd,
                cocimientoNumero: idx + 1,
                maduracionHoras: Number(m && m.tiempoMaduracionHoras) || 0,
                transferida: false,
              };
            }
            t.__loteFV.volumenHL += a.carga;
            t.__loteFV.fermentEnd = a.fermentEnd;
            t.__loteFV.cocimientoNumero = idx + 1;
            t.__loteFV.maduracionHoras =
              Number(m && m.tiempoMaduracionHoras) || 0;
            if (a.lleno && !t.__loteFV.transferida) {
              transferencias.push({
                fecha: t.__loteFV.fermentEnd,
                mostoId: t.__loteFV.mostoId,
                nombre: t.__loteFV.nombre,
                volumenHL: t.__loteFV.volumenHL,
                origen: t,
                cocimientoNumero: t.__loteFV.cocimientoNumero,
                fermentEnd: t.__loteFV.fermentEnd,
                maduracionHoras: t.__loteFV.maduracionHoras,
              });
              t.__loteFV.transferida = true;
            }
          });
        });

        // Cerrar los FV que quedaron parcialmente llenos al terminar la secuencia de cocina.
        // No se deja producto indefinidamente en FV: el último cocimiento de ese lote determina
        // el fin de fermentación y el paso a SV.
        tanks.forEach((t) => {
          if (
            t.__loteFV &&
            !t.__loteFV.transferida &&
            t.volumenAsignado > 1e-9
          ) {
            const lote = t.__loteFV;
            // Si el FV quedó parcialmente lleno al finalizar la secuencia, se cierra
            // con el último cocimiento asignado y recién ahí empieza su fermentación.
            t.releaseTime = lote.fermentEnd;
            t.loteCerrado = true;
            transferencias.push({
              fecha: lote.fermentEnd,
              mostoId: lote.mostoId,
              nombre: lote.nombre,
              volumenHL: t.volumenAsignado,
              origen: t,
              cocimientoNumero: lote.cocimientoNumero,
              fermentEnd: lote.fermentEnd,
              maduracionHoras: lote.maduracionHoras,
            });
            lote.transferida = true;
          }
        });

        // Pony no requiere fermentación en FV (su tiempo de fermentación configurado es 0):
        // pasa directamente a SV Pony para maduración.
        cookRows.forEach((r, idx) => {
          if (r.mostoId !== "pony") return;
          const m = mById(r.mostoId);
          transferencias.push({
            fecha: r.end,
            mostoId: r.mostoId,
            nombre: r.nombre,
            volumenHL: Math.max(0, Number(r.cocVolumenHL) || 0),
            origen: null,
            cocimientoNumero: idx + 1,
            fermentEnd: r.end,
            maduracionHoras: Number(m && m.tiempoMaduracionHoras) || 0,
            ponyDirect: true,
          });
        });

        // 2) MADURACIÓN EN SV: se ejecuta cuando cada lote termina fermentación.
        // Se procesa cronológicamente y llena SV hasta capacidad. Pony SOLO puede usar SV Pony.
        transferencias.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
        transferencias.forEach((tr) => {
          releaseFinished(tr.fecha);
          let restante = tr.volumenHL;
          const asignaciones = [];
          while (restante > 1e-9) {
            const candidatos = tanks
              .filter((t) => {
                if (!canSV(t, tr.mostoId)) return false;
                if (!equipoDisponibleEn(t, tr.fecha, tr.mostoId)) return false;
                const libre = t.capacidadHL - t.volumenAsignado;
                // Cada lote transferido desde FV entra completo en un solo SV.
                // Varios lotes de la misma marca pueden compartir el SV hasta llenarlo,
                // pero no se parte un lote entre dos SV.
                if (libre + 1e-9 < restante || t.loteCerrado) return false;
                if (t.mostoId && t.mostoId !== tr.mostoId) return false;
                return true;
              })
              .sort((a, b) => {
                const aa = a.mostoId === tr.mostoId ? 0 : 1,
                  bb = b.mostoId === tr.mostoId ? 0 : 1;
                return (
                  aa - bb ||
                  { A: 0, B: 1, C: 2 }[a.prioridad] -
                    { A: 0, B: 1, C: 2 }[b.prioridad] ||
                  a.idx - b.idx
                );
              });
            const tank = candidatos[0];
            if (!tank) break;
            // El lote completo permanece en un solo SV; no se fracciona entre tanques.
            const carga = restante;
            tank.volumenAsignado += carga;
            tank.mostoId = tr.mostoId;
            tank.ultimoMostoId = null;
            tank.ultimoReleaseTime = null;
            const lleno = tank.volumenAsignado >= tank.capacidadHL - 1e-9;
            tank.releaseTime = new Date(
              tr.fecha.getTime() + tr.maduracionHoras * 3600000,
            );
            tank.loteCerrado = lleno;
            asignaciones.push({ tank, carga, lleno });
            restante -= carga;
          }

          if (restante > 1e-9) {
            const sin = {
              ...tr,
              etapa: "SV · Maduración",
              start: tr.fecha,
              end: new Date(tr.fecha.getTime() + tr.maduracionHoras * 3600000),
              volumenHL: restante,
              tanque: null,
              estado: "sin tanque",
              motivo: `Faltan ${restante.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL de capacidad en SV habilitados para maduración. Los BBT no se utilizan para maduración.`,
            };
            resultRows.push(sin);
            sinTanque.push(sin);
          }
          asignaciones.forEach((a, subIdx) => {
            const t = a.tank;
            resultRows.push({
              cocimientoNumero: tr.cocimientoNumero,
              nombre: tr.nombre,
              mostoId: tr.mostoId,
              etapa: "SV · Maduración",
              start: tr.fecha,
              end: new Date(tr.fecha.getTime() + tr.maduracionHoras * 3600000),
              subAsignacion: subIdx + 1,
              volumenHL: a.carga,
              tanque: t.equipo || `Equipo ${t.idx + 1}`,
              tanqueId: t.id,
              tanqueTipo: t.tipo,
              prioridad: t.prioridad,
              capacidadHL: t.capacidadHL,
              acumuladoHL: t.volumenAsignado,
              restanteHL: Math.max(0, t.capacidadHL - t.volumenAsignado),
              tanqueLleno: a.lleno,
              estado: "Asignado",
            });
          });
        });

        return {
          rows: resultRows,
          sinTanque,
          tanks,
          totalCocimientos: cookRows.length,
          transferencias,
        };
      }

      function sequenceWeek(
        plan,
        catalog,
        weekStart,
        aseoMatrix,
        aseoDefaultHoras,
        aseoPeriodico,
        i0FloorDate,
      ) {
        /*
     SECUENCIA OPERATIVA FLEXIBLE, SIN INTERCALAR MARCAS
     ----------------------------------------------------
     1) Cada bloque de envasado recibe sus inicios definitivos de computeCocinaPlan().
        sequenceWeek NO vuelve a calcular la distancia entre cocimientos: solo puede
        desplazar el bloque completo hacia adelante si la secuencia física lo requiere.
     2) Los bloques se ejecutan en el ORDEN DEL PLAN DE ENVASADO, no por la fecha de
        inicio de cocina calculada.
     3) Un bloque completo puede adelantarse si la cocina queda libre antes; la fecha calculada
        desde envasado es la ÚLTIMA hora permitida de inicio. Nunca se inserta otra marca dentro del bloque.
     4) Entre bloques se programa el CIP correspondiente y, terminado el CIP, el siguiente bloque
        arranca inmediatamente: no se dejan huecos artificiales.
     5) Si aun así la secuencia obliga a terminar el proceso después de su fecha límite, se marca el conflicto;
        no se intercalan marcas para ocultarlo.
  */
        const catalogById = {};
        (catalog || []).forEach((m) => (catalogById[m.id] = m));
        const aseoPeriodicoActivo = !!(aseoPeriodico && aseoPeriodico.activo);
        const aseoPeriodicoHoras =
          Number(aseoPeriodico && aseoPeriodico.duracionHoras) || 0;
        const aseoPeriodicoCada = Math.max(
          1,
          parseInt(aseoPeriodico && aseoPeriodico.cocimientosEntreAseos) || 1,
        );
        const reglaWarnings = [];
        const capacityWarnings = [];
        const yeastEvents = [];
        const yeastPool = (YEAST_AVAILABILITY || [])
          .filter((y) => y.disponible !== false && yeastAvailableDate(y))
          .map((y, index) => ({
            id: y.id || `levadura_${index}`,
            sourceMostoId: y.mostoId || "estandar",
            fechaDisponible: yeastAvailableDate(y),
            origen: y.origen || "Disponibilidad registrada",
            consumida: false,
            automatica: false,
          }))
          .sort((a, b) => a.fechaDisponible - b.fechaDisponible);
        const resolvedAseo = resolveAseoMatrix(aseoMatrix || [], catalog);

        let blocks = (plan && plan.results ? plan.results : [])
          .filter((r) => Array.isArray(r.starts) && r.starts.length > 0)
          .map((r, sourceIndex) => {
            const m = catalogById[r.mostoId] || {};
            const starts = r.starts.map(
              (d) => new Date(d.getTime ? d.getTime() : new Date(d).getTime()),
            );
            return {
              blockId: `${r.mostoId}__${sourceIndex}`,
              sourceIndex,
              sequenceOrder: Number.isFinite(r.sequenceOrder)
                ? r.sequenceOrder
                : sourceIndex,
              codigo: r.codigo || "",
              tren: r.tren || "",
              blockLabel:
                r.blockLabel || `${r.nombre} · bloque ${sourceIndex + 1}`,
              mostoId: r.mostoId,
              nombre: r.nombre,
              numCocimientos: starts.length,
              volumenEnvasar: Number(r.volumenEnvasar) || 0,
              volumenCocinar: Number(r.volumenCocinar) || 0,
              volumenPorCocimiento:
                (r.volumenPorCocimientoOverride != null
                  ? Number(r.volumenPorCocimientoOverride)
                  : Number(m.volumenPorCocimiento)) || 0,
              cocinaHoras: Number(m.tiempoCocinaHoras) || 0,
              gapHoras: Number(m.tiempoEntreCarguesHoras) || 0,
              fermentacionHoras: Number(m.tiempoFermentacionHoras) || 0,
              maduracionHoras: Number(m.tiempoMaduracionHoras) || 0,
              latestStarts: starts,
              // Fecha límite del bloque = INICIO DEL PRIMER ENVASADO de ese bloque.
              // No se usa la fecha de fin del bloque ni la fecha de envío del plan.
              deadline: r.fechaEnvasadoMinima
                ? new Date(r.fechaEnvasadoMinima.getTime())
                : null,
              firstPackagingStart: r.fechaEnvasadoMinima
                ? new Date(r.fechaEnvasadoMinima.getTime())
                : null,
              actualStarts: [],
              shiftHours: 0,
            };
          });

        if (!blocks.length) {
          return {
            rows: [],
            reglaWarnings,
            capacityWarnings,
            recomendaciones: { iniciaConPony: false, ponyJuntoAseo: null },
            resumen: null,
            ordenBloques: [],
            yeastEvents,
            yeastPool,
            yeastBlocked: [],
          };
        }

        blocks.sort(
          (a, b) =>
            a.sequenceOrder - b.sequenceOrder || a.sourceIndex - b.sourceIndex,
        );

        const rows = [];
        const transitionCips = [];
        const scheduledBlocks = [];
        let prevBlock = null;
        let prevBlockEnd = null;
        let prevLastStart = null;
        let ponyJuntoAseo = false;
        let globalCocCount = 0;
        const totalCocimientos = blocks.reduce(
          (a, b) => a + b.numCocimientos,
          0,
        );

        // -----------------------------------------------------------------------
        // SECUENCIA CONTINUA DE BLOQUES
        // -----------------------------------------------------------------------
        // La fecha calculada en Programación de cocinas es la "última hora permitida"
        // para arrancar cada bloque. Si la cocina queda libre antes de esa hora, el bloque
        // se adelanta y se ejecuta inmediatamente, manteniendo el orden del plan.
        //
        // Regla clave: una vez que se elige un bloque, TODOS sus cocimientos se ejecutan
        // consecutivamente y con la separación fija entre inicios (2:50 h por defecto).
        // Nunca se intercala otra marca dentro del bloque.
        // -----------------------------------------------------------------------
        const pending = new Set(blocks.map((_, i) => i));
        let cursorTime = null;
        const EPS = 1000;

        function getCipHours(prev, next) {
          if (!prev) return { horas: 0, definido: true, sinAseo: true };
          const info = getAseoDuracion(
            prev.mostoId,
            next.mostoId,
            resolvedAseo,
            aseoDefaultHoras,
          );
          return {
            horas: info.sinAseo ? 0 : Math.max(0, Number(info.horas) || 0),
            definido: info.definido,
            sinAseo: !!info.sinAseo,
          };
        }

        while (pending.size) {
          // Disponibilidad real de la cocina antes del CIP del siguiente bloque.
          const readyBase =
            cursorTime === null ? null : new Date(cursorTime.getTime());

          // La secuencia operativa sigue SIEMPRE el orden solicitado del plan.
          // No se intercalan marcas ni se reordenan bloques para perseguir sus fechas
          // calculadas. Si el siguiente bloque todavía no necesita comenzar, se adelanta
          // y se ejecuta inmediatamente cuando la cocina queda libre; el hueco se evita.
          let chosenIdx;
          const remaining = [...pending].sort(
            (ia, ib) =>
              blocks[ia].sequenceOrder - blocks[ib].sequenceOrder || ia - ib,
          );
          chosenIdx = remaining[0];

          const block = blocks[chosenIdx];
          pending.delete(chosenIdx);

          const firstLatest = block.latestStarts[0];
          const cipInfo = getCipHours(prevBlock, block);
          const cipHours = cipInfo.horas;

          // Los cocimientos se traslapan: mientras uno cocina, el siguiente cargue ya
          // arrancó en macerado/filtración. Por eso, cuando NO hay que hacer aseo entre
          // marcas, el inicio del nuevo bloque simplemente continúa la cadencia normal
          // (último inicio anterior + tiempo entre cargues) y NO espera a que termine de
          // cocinar el cargue anterior. El tiempo de cocción completo (prevBlockEnd) solo
          // se usa como referencia cuando SÍ hay que hacer un aseo (CIP) entre marcas,
          // porque el aseo requiere que la cocina haya quedado realmente libre.
          // Para el primer bloque de todo el plan (prevBlock aún null): firstLatest es la
          // "última hora permitida" de inicio, NO la hora en que debe iniciar. Si hay I0
          // definido y cae antes de firstLatest, hay un hueco de tiempo disponible entre
          // "ahora" (I0) y esa fecha límite — se aprovecha adelantando el arranque hasta I0
          // en vez de dejar la cocina parada esperando innecesariamente. Si I0 cae después
          // de firstLatest, igual se usa I0 (no se puede programar en el pasado). Sin I0
          // definido, se usa firstLatest tal cual, sin adelantar.
          const earliestFeasible = prevBlock
            ? cipInfo.sinAseo
              ? new Date(prevLastStart.getTime() + prevBlock.gapHoras * 3600000)
              : new Date(prevBlockEnd.getTime() + cipHours * 3600000)
            : i0FloorDate
              ? new Date(i0FloorDate.getTime())
              : new Date(firstLatest.getTime());

          // El primer cocimiento puede adelantarse hasta el momento en que la cocina queda
          // realmente disponible. A PARTIR DE ESE INICIO, todos los cocimientos del bloque
          // se construyen exclusivamente con la separación entre INICIOS configurada.
          // El tiempo de cocina (8:15, 8:50, 8:55, etc.) NO interviene en la separación
          // entre inicios.
          let actualFirst = new Date(earliestFeasible.getTime());
          // Restricción de levadura: Light solo puede arrancar con una cosecha Light.
          // Si existe una cosecha futura, el bloque se desplaza hasta esa fecha. Si no
          // existe ninguna, el bloque queda bloqueado y no entra a la secuencia física.
          let yeastUsed = null;
          if (block.mostoId === "light") {
            const compatibles = yeastPool
              .filter((y) => !y.consumida && yeastCompatible(y.sourceMostoId, block.mostoId))
              .sort((a, b) => a.fechaDisponible - b.fechaDisponible);
            yeastUsed = compatibles.find((y) => y.fechaDisponible <= actualFirst) || compatibles[0] || null;
            if (!yeastUsed) {
              block.yeastBlocked = true;
              const warning = {
                tipo: "levadura",
                mostoId: "light",
                nombre: block.nombre,
                blockLabel: block.blockLabel,
                deadline: block.deadline,
                detalle: "No existe levadura Light disponible. El bloque no se programa porque Light solo puede sembrarse con una cosecha proveniente de un tanque Light.",
              };
              capacityWarnings.push(warning);
              yeastEvents.push({
                blockLabel: block.blockLabel,
                mostoId: block.mostoId,
                estado: "BLOQUEADO",
                requerida: "Light",
                fuente: "—",
                disponibleDesde: null,
                inicio: null,
                detalle: warning.detalle,
              });
              continue;
            }
            if (yeastUsed.fechaDisponible > actualFirst) {
              actualFirst = new Date(yeastUsed.fechaDisponible.getTime());
              capacityWarnings.push({
                tipo: "levadura",
                mostoId: "light",
                nombre: block.nombre,
                blockLabel: block.blockLabel,
                blockStart: actualFirst,
                deadline: block.deadline,
                detalle: `El bloque Light fue desplazado hasta ${fmtDateTime(actualFirst)} por disponibilidad de levadura Light.`,
              });
            }
            yeastUsed.consumida = true;
          }
          block.yeastUsed = yeastUsed;
          block.shiftHours =
            (actualFirst.getTime() - firstLatest.getTime()) / 3600000;
          block.actualStarts = Array.from(
            { length: block.numCocimientos },
            (_, i) =>
              new Date(actualFirst.getTime() + i * (block.gapHoras * 3600000)),
          );

          if (block.mostoId === "light") {
            yeastEvents.push({
              blockLabel: block.blockLabel,
              mostoId: block.mostoId,
              estado: "APTO",
              requerida: "Light",
              fuente: block.yeastUsed ? block.yeastUsed.origen : "—",
              disponibleDesde: block.yeastUsed ? block.yeastUsed.fechaDisponible : null,
              inicio: block.actualStarts[0],
              detalle: block.yeastUsed && block.yeastUsed.fechaDisponible > earliestFeasible
                ? "Programado desde la primera disponibilidad compatible."
                : "Levadura Light disponible al inicio.",
            });
            const lastStartForHarvest = block.actualStarts[block.actualStarts.length - 1];
            const harvestDate = new Date(
              lastStartForHarvest.getTime() +
                (block.cocinaHoras + block.fermentacionHoras) * 3600000,
            );
            yeastPool.push({
              id: `auto_${block.blockId}`,
              sourceMostoId: "light",
              fechaDisponible: harvestDate,
              origen: `Cosecha automática de ${block.blockLabel}`,
              consumida: false,
              automatica: true,
            });
            yeastPool.sort((a, b) => a.fechaDisponible - b.fechaDisponible);
          } else {
            yeastEvents.push({
              blockLabel: block.blockLabel,
              mostoId: block.mostoId,
              estado: "APTO",
              requerida: "General / mezcla",
              fuente: "Compatible sin exclusividad Light",
              disponibleDesde: actualFirst,
              inicio: actualFirst,
              detalle: "Puede usar levaduras cosechadas de marcas no Light mezcladas entre sí o levadura Light.",
            });
          }
          // Validación: dentro de cada bloque la diferencia entre inicios debe ser exactamente
          // el tiempo entre cargues. Si no se cumple, detener el cálculo en lugar de mostrar una
          // secuencia físicamente inconsistente.
          for (let i = 1; i < block.actualStarts.length; i++) {
            const deltaH =
              (block.actualStarts[i].getTime() -
                block.actualStarts[i - 1].getTime()) /
              3600000;
            if (Math.abs(deltaH - block.gapHoras) > 1e-9) {
              throw new Error(
                `Error de secuencia en ${block.nombre}: el cocimiento #${i + 1} no está separado ${block.gapHoras.toFixed(2)} h del anterior.`,
              );
            }
          }

          if (prevBlock) {
            const cipStart = new Date(prevBlockEnd.getTime());
            const cipEnd = new Date(
              prevBlockEnd.getTime() + cipHours * 3600000,
            );
            if (!cipInfo.sinAseo) {
              transitionCips.push({
                n: 0,
                tipo: "aseo",
                mostoId: null,
                blockId: block.blockId,
                afterBlockId: prevBlock.blockId,
                nombre: `ASEO ${blocksNombre(prevBlock.mostoId, catalogById)} → ${blocksNombre(block.mostoId, catalogById)}`,
                start: cipStart,
                end: cipEnd,
                definido: cipInfo.definido,
              });
              if (prevBlock.mostoId === "pony" || block.mostoId === "pony")
                ponyJuntoAseo = true;
            }

            const gapDespuesCip =
              (actualFirst.getTime() - cipEnd.getTime()) / 3600000;
            if (gapDespuesCip > 48) {
              reglaWarnings.push({
                ids: [5],
                text: `Regla 5: hueco de ${gapDespuesCip.toFixed(1)} h sin cocimientos entre el bloque de ${prevBlock.nombre} y el bloque de ${block.nombre} (más de 2 días).`,
              });
            }
          }

          // Bloque completo: se conservan TODOS los cocimientos y sus fechas relativas.
          block.actualStarts.forEach((startDate, i) => {
            const start = new Date(startDate.getTime());
            const end = new Date(start.getTime() + block.cocinaHoras * 3600000);
            const volXCoc = block.volumenPorCocimiento;
            const restante = Math.max(0, block.volumenCocinar - i * volXCoc);
            const cocVolumenHL = Math.min(volXCoc, restante);
            rows.push({
              n: 0,
              tipo: "cocimiento",
              blockId: block.blockId,
              mostoId: block.mostoId,
              nombre: block.nombre,
              codigo: block.codigo,
              tren: block.tren,
              blockLabel: block.blockLabel,
              start,
              end,
              latestStart: new Date(block.latestStarts[i].getTime()),
              shiftHours: block.shiftHours,
              firstPackagingStart: block.firstPackagingStart
                ? new Date(block.firstPackagingStart.getTime())
                : null,
              blockStart: i === 0,
              blockEnd: i === block.actualStarts.length - 1,
              deadline: block.deadline,
              violaDeadline: false,
              cocVolumenHL,
            });
            globalCocCount++;

            if (
              aseoPeriodicoActivo &&
              i < block.actualStarts.length - 1 &&
              globalCocCount % aseoPeriodicoCada === 0
            ) {
              const nextStart = block.actualStarts[i + 1];
              const hueco = (nextStart.getTime() - end.getTime()) / 3600000;
              if (hueco + 1e-9 >= aseoPeriodicoHoras) {
                rows.push({
                  n: 0,
                  tipo: "aseo",
                  mostoId: null,
                  blockId: block.blockId,
                  nombre: `ASEO periódico (cada ${aseoPeriodicoCada} cocimientos)`,
                  start: new Date(
                    nextStart.getTime() - aseoPeriodicoHoras * 3600000,
                  ),
                  end: new Date(nextStart.getTime()),
                  definido: true,
                  periodico: true,
                });
              } else {
                reglaWarnings.push({
                  ids: [1],
                  text: `Aseo periódico: no cabe entre los cocimientos ${globalCocCount} y ${globalCocCount + 1} sin alterar sus fechas internas; la secuencia se conserva.`,
                });
              }
            }
          });

          scheduledBlocks.push(block);
          prevBlock = block;
          prevLastStart = new Date(
            block.actualStarts[block.actualStarts.length - 1].getTime(),
          );
          prevBlockEnd = new Date(
            prevLastStart.getTime() + block.cocinaHoras * 3600000,
          );
          // El cursor para el siguiente bloque debe reflejar la cadencia real de la cocina,
          // no el fin de cocción: si el próximo bloque no requiere aseo, puede arrancar en
          // cuanto la cocina quede libre para macerar/filtrar (prevLastStart + gap), que es
          // normalmente mucho antes de prevBlockEnd. Usamos el más temprano de los dos como
          // base de "disponibilidad", y la lógica de earliestFeasible arriba decide cuál
          // aplica según si hay o no aseo.
          cursorTime = new Date(
            Math.min(
              prevLastStart.getTime() + block.gapHoras * 3600000,
              prevBlockEnd.getTime(),
            ),
          );
        }

        // Reemplazamos el orden de análisis por el orden físico realmente ejecutado.
        // Los cocimientos de un bloque siguen siempre consecutivos y su CIP queda
        // inmediatamente después del bloque que acaba de terminar.
        const executionBlocks = scheduledBlocks;
        const grouped = [];
        for (const block of executionBlocks) {
          const blockRows = rows.filter((r) => r.blockId === block.blockId);
          grouped.push(...blockRows);
          const cips = transitionCips.filter(
            (r) => r.afterBlockId === block.blockId,
          );
          grouped.push(...cips);
        }
        rows.length = 0;
        rows.push(...grouped);
        rows.forEach((r, idx) => (r.n = idx + 1));

        // Para las reglas/recomendaciones, usar el orden físico ejecutado.
        blocks = executionBlocks;
        // Verificación final de fecha límite usando LAS FECHAS ACTUALES de la secuencia.
        // Si un bloque tuvo que desplazarse porque el bloque anterior todavía ocupaba la cocina,
        // ese desplazamiento puede convertirlo en incumplimiento.
        blocks.forEach((block) => {
          if (!block.deadline) return;
          const blockRows = rows.filter(
            (r) => r.blockId === block.blockId && r.tipo === "cocimiento",
          );
          if (!blockRows.length) return;
          const lastCookEnd = blockRows[blockRows.length - 1].end;
          const blockEnd = new Date(
            lastCookEnd.getTime() +
              (block.fermentacionHoras + block.maduracionHoras) * 3600000,
          );
          if (blockEnd.getTime() > block.deadline.getTime() + 1) {
            const retrasoHoras =
              (blockEnd.getTime() - block.deadline.getTime()) / 3600000;
            blockRows.forEach((r) => (r.violaDeadline = true));
            capacityWarnings.push({
              mostoId: block.mostoId,
              nombre: block.nombre,
              blockStart: blockRows[0].start,
              blockEnd,
              deadline: block.deadline,
              retrasoHoras,
              tipo: "deadline",
              detalle: `El bloque tuvo que iniciar ${Math.max(0, block.shiftHours).toFixed(1)} h después de su último inicio permitido para respetar la secuencia de bloques.`,
            });
          }
        });

        const ponyBlocks = blocks.filter((b) => b.mostoId === "pony");
        const totalHL = blocks.reduce((a, b) => a + b.volumenEnvasar, 0);
        const ponyHL = ponyBlocks.reduce((a, b) => a + b.volumenEnvasar, 0);
        const cervezaHL = totalHL - ponyHL;
        if (ponyHL > 23600) {
          reglaWarnings.push({
            ids: [6],
            text: `Regla 6: volumen semanal de Pony ${ponyHL.toLocaleString("es-CO", { maximumFractionDigits: 0 })} hL supera 23.600 hL.`,
          });
        }
        const escenarioCerveza = cervezaHL <= 66000 && ponyHL <= 15000;
        const escenarioPony = ponyHL <= 23600 && cervezaHL <= 57400;
        if (totalHL > 81000 || (!escenarioCerveza && !escenarioPony)) {
          reglaWarnings.push({
            ids: [1],
            text: `Regla 1: volumen semanal total ${totalHL.toLocaleString("es-CO", { maximumFractionDigits: 0 })} hL no cabe en ninguno de los escenarios de aseo permitidos.`,
          });
        }
        blocks.forEach((b) => {
          if (b.maduracionHoras > 96)
            reglaWarnings.push({
              ids: [7],
              text: `Regla 7: la maduración configurada para ${b.nombre} supera 4 días.`,
            });
        });

        // Regla 4: los bloques de Pony deben contemplar como mínimo dos cocimientos
        // consecutivos (4.100 hL mínimo). Se valida aquí sobre el resultado final ya
        // secuenciado, como respaldo por si algún ajuste manual del catálogo o del
        // inventario terminara dejando un bloque de Pony con un solo cocimiento.
        blocks.forEach((b) => {
          if (b.mostoId !== "pony") return;
          if (b.numCocimientos < 2) {
            reglaWarnings.push({
              ids: [4],
              text: `Regla 4: el bloque de Pony "${b.blockLabel || b.nombre}" solo tiene ${b.numCocimientos} cocimiento(s) programado(s); el acuerdo de servicio exige mínimo dos cocimientos consecutivos (4.100 hL mínimo).`,
            });
          }
        });

        return {
          rows,
          reglaWarnings,
          capacityWarnings,
          recomendaciones: {
            iniciaConPony: blocks.length > 0 && blocks[0].mostoId === "pony",
            ponyJuntoAseo: ponyBlocks.length ? ponyJuntoAseo : null,
          },
          resumen: { totalHL, ponyHL, cervezaHL },
          ordenBloques: blocks.map((b) => b.blockLabel),
          yeastEvents,
          yeastPool,
          yeastBlocked: yeastEvents.filter((e) => e.estado === "BLOQUEADO"),
        };
      }

      function blocksNombre(mostoId, catalogById) {
        const m = catalogById[mostoId];
        return m ? m.nombre : mostoId;
      }

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
        TRAINS.forEach(
          (t) => (mergedByTrain[t] = mergeEvents(parsed.rawEvents[t])),
        );
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
          INVENTORY_BALANCE,
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
        );
        seq.tankAssignment = assignTanks(
          seq,
          plan,
          TANK_CATALOG,
          MOSTO_CATALOG,
        );
        STATE.seq = seq;
        renderKPIs(plan, seq);
        renderCocinaPlan(plan);
        renderSequence(seq);
        renderTankAssignments(seq.tankAssignment);
        renderGanttEnvasado(STATE.mergedByTrain, weekStart);
        renderGanttCocina(seq, weekStart);
        renderConflictos(seq);
        renderReglas(seq);
        renderRecomendaciones(seq);
        renderSinHomologar(plan.sinHomologar);
        renderInventoryBalance(plan);
        renderYeastStatus(seq);
        document.getElementById("promptBox").value = buildPrompt(
          STATE.parsed,
          plan,
          STATE.mergedByTrain,
        );
      }

      function renderKPIs(plan, seq) {
        const el = document.getElementById("kpiRow");
        const totalEnvasar = plan.results.reduce(
          (a, r) => a + r.volumenEnvasar,
          0,
        );
        const totalCubiertoInv = plan.results.reduce(
          (a, r) => a + (r.inventarioUsadoHL || 0),
          0,
        );
        const totalCocinar = plan.results.reduce(
          (a, r) => a + r.volumenCocinar,
          0,
        );
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
        const nextLightYeast = seq && seq.yeastPool
          ? seq.yeastPool.filter((y) => y.sourceMostoId === "light" && !y.consumida).sort((a,b) => a.fechaDisponible-b.fechaDisponible)[0]
          : null;
        const items = [
          { n: plan.results.length, l: "Bloques de producción", cls: "" },
          { n: yeastBlocked, l: "Bloques Light bloqueados", cls: yeastBlocked ? "danger" : "ok" },
          { n: nextLightYeast ? fmtDateTime(nextLightYeast.fechaDisponible) : "No disponible", l: "Próxima levadura Light", cls: nextLightYeast ? "ok" : "warn" },
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
            l: "Alertas de reglas/capacidad/tanques",
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

      /* =========================================================================
   6.5) GANTT — línea de tiempo de las líneas de envasado (TREN-5/7/8/9)
   ========================================================================= */
      const GANTT_PX_PER_HOUR = 16;
      const TRAIN_EVENT_COLORS = {
        changeover: "#c9c9c9",
        idle: "#4a4a4a",
        other: "#7a7a7a",
      };
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
              ((b.end.getTime() - b.start.getTime()) / 3600000) *
                GANTT_PX_PER_HOUR,
            );
            const dur = fmtDuration(b.end - b.start);
            const titleAttr = escapeHtml(
              `${b.name || b.codigo || ""} · ${fmtDateTime(b.start)} → ${fmtDateTime(b.end)} (${dur})`,
            );
            if (b.type === "production") {
              const mostoId = matchMosto(b.name, MOSTO_CATALOG);
              const bg = mostoId ? colorForMosto(mostoId) : "#c9c9c9";
              const showText = width >= 46;
              blocksHtml += `<div class="block" style="left:${left}px; width:${width}px; background:${bg};" title="${titleAttr}">${showText ? `<b>${escapeHtml(b.name || b.codigo || "")}</b><span>${dur}</span>` : ""}</div>`;
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
          MOSTO_CATALOG.map(
            (m) =>
              `<div class="item"><span class="sw" style="background:${colorForMosto(m.id)}"></span>${escapeHtml(m.nombre)}</div>`,
          ).join("") +
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
        const lastDeadline = deadlines.length
          ? Math.max(...deadlines)
          : lastEnd;
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
            ((dl.getTime() - rangeStart.getTime()) / 3600000) *
            GANTT_PX_PER_HOUR;
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
            ((r.end.getTime() - r.start.getTime()) / 3600000) *
              GANTT_PX_PER_HOUR,
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

      function fmtDurationHoras(h) {
        const totalMin = Math.round(h * 60);
        const dias = Math.floor(totalMin / 1440);
        const restoMin = totalMin - dias * 1440;
        const horas = Math.floor(restoMin / 60);
        const min = restoMin % 60;
        const partes = [];
        if (dias) partes.push(`${dias} d`);
        if (horas || dias) partes.push(`${horas} h`);
        partes.push(`${min} min`);
        return partes.join(" ");
      }
      function formatCapacityWarning(w) {
        if (w && w.tipo === "deadline") {
          return `Conflicto de capacidad: el proceso de ${w.nombre} termina el ${fmtDateTime(w.blockEnd)} — ${fmtDurationHoras(w.retrasoHoras)} (${w.retrasoHoras.toFixed(1)} h) después de su límite (${fmtDateTime(w.deadline)}), por la secuencia y disponibilidad de la cocina compartida.`;
        }
        if (w && w.tipo === "solapamiento") {
          return `Conflicto de capacidad: ${w.detalle || `el cocimiento de ${w.nombre} se solapa con otro cocimiento`}.`;
        }
        if (w && w.tipo === "aseo") {
          return `Conflicto de aseo: ${w.detalle || `el aseo asociado a ${w.nombre} no cabe en el espacio disponible`}.`;
        }
        return w && w.detalle
          ? w.detalle
          : `Conflicto de capacidad en ${w && w.nombre ? w.nombre : "el programa"}.`;
      }

      function renderConflictos(seq) {
        const wrap = document.getElementById("conflictosWrap");
        const countEl = document.getElementById("conflictosCount");
        const warns = seq ? seq.capacityWarnings : [];
        if (countEl) {
          if (warns.length) {
            countEl.textContent = warns.length;
            countEl.style.display = "inline-block";
          } else {
            countEl.style.display = "none";
          }
        }
        if (!warns.length) {
          wrap.innerHTML =
            '<p class="empty-note">Sin conflictos de capacidad esta semana — todos los bloques terminan dentro de su fecha límite de envasado.</p>';
          return;
        }
        const rows = warns
          .map((w) => {
            const bg = colorForMosto(w.mostoId);
            const esDeadline = w.tipo === "deadline";
            const esAseo = w.tipo === "aseo";
            const titulo = esDeadline
              ? "Conflicto de fecha límite"
              : esAseo
                ? "Conflicto de aseo"
                : "Conflicto de secuencia";
            const detalle = formatCapacityWarning(w);
            return `<tr style="background:${bg}22;">
      <td style="border-left:4px solid var(--danger); color:var(--text); font-family:var(--sans);"><b>${escapeHtml(w.nombre)}</b><span style="display:block;color:var(--muted);font-size:10px;">${titulo}</span></td>
      <td>${w.blockStart ? fmtDateTime(w.blockStart) : "—"}</td>
      <td style="color:${esDeadline ? "var(--danger)" : "var(--text)"}; font-weight:650;">${w.blockEnd ? fmtDateTime(w.blockEnd) : "—"}</td>
      <td>${w.deadline ? fmtDateTime(w.deadline) : "—"}</td>
      <td style="color:${esDeadline ? "var(--danger)" : "var(--text)"};"><b>${esDeadline && Number.isFinite(w.retrasoHoras) ? fmtDurationHoras(w.retrasoHoras) : "—"}</b><span style="color:var(--muted); font-size:10.5px; display:block; max-width:520px;">${escapeHtml(detalle)}</span></td>
    </tr>`;
          })
          .join("");
        wrap.innerHTML = `<table><thead><tr>
      <th>Mosto / bloque</th><th>Inicio</th><th>Fin / evento</th><th>Fecha límite</th><th>Detalle</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderTankAssignments(assignment) {
        const wrap = document.getElementById("tanquesTableWrap");
        const alert = document.getElementById("tanquesAlertWrap");
        const count = document.getElementById("sinTanqueCount");
        if (!assignment) {
          if (wrap)
            wrap.innerHTML =
              '<p class="empty-note">Sin datos de asignación.</p>';
          return;
        }
        if (count) {
          count.textContent = assignment.sinTanque.length;
          count.style.display = assignment.sinTanque.length
            ? "inline-block"
            : "none";
        }
        if (alert) {
          alert.innerHTML = assignment.sinTanque.length
            ? `<div style="border:1px solid rgba(237,28,43,.35); background:rgba(237,28,43,.08); border-radius:4px; padding:10px 14px; margin-bottom:14px; color:var(--danger);"><b>⚠️ ${assignment.sinTanque.length} cocimiento(s) sin tanque.</b> La asignación se detuvo para esos cocimientos porque no existe capacidad suficiente en equipos disponibles con prioridad A → B → C.</div>`
            : '<div style="border:1px solid rgba(76,175,130,.35); background:rgba(76,175,130,.08); border-radius:4px; padding:10px 14px; margin-bottom:14px; color:var(--ok);"><b>✓ Todos los cocimientos tienen tanque asignado.</b> Los FV son solo de fermentación; los SV son solo de maduración; los SV Pony son exclusivos de Pony; los BBT son solo de producto terminado.</div>';
        }
        if (!assignment.rows.length) {
          wrap.innerHTML =
            '<p class="empty-note">Sin cocimientos programados.</p>';
          return;
        }
        const rows = assignment.rows
          .map((r) => {
            const ok = r.estado === "Asignado";
            return `<tr style="background:${ok ? "transparent" : "rgba(237,28,43,.08)"};">
      <td>${r.cocimientoNumero}</td><td style="font-family:var(--sans);">${escapeHtml(r.nombre)}</td><td>${fmtDateTime(r.start)}</td><td>${fmtDateTime(r.end)}</td>
      <td>${r.volumenHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${r.tanque ? escapeHtml(r.tanque) : "—"}</td><td>${r.tanqueTipo ? escapeHtml(r.tanqueTipo) : "—"}</td>
      <td>${r.prioridad ? `<span class="tank-priority ${r.prioridad}">${r.prioridad}</span>` : "—"}</td>
      <td>${r.capacidadHL ? `${r.capacidadHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL` : "—"}</td>
      <td>${r.acumuladoHL != null ? `${r.acumuladoHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL` : "—"}</td>
      <td>${r.restanteHL != null ? `${r.restanteHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL` : "—"}</td>
      <td><span class="tank-status ${ok ? "ok" : "danger"}">${ok ? "Asignado" : "SIN TANQUE"}</span></td>
    </tr>`;
          })
          .join("");
        wrap.innerHTML = `<table><thead><tr><th>#</th><th>Mosto</th><th>Inicio</th><th>Fin</th><th>Volumen</th><th>Equipo</th><th>Tipo</th><th>Prioridad</th><th>Capacidad</th><th>Acumulado</th><th>Restante</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderSequence(seq) {
        const alertWrap = document.getElementById("capacidadAlertWrap");
        const wrap = document.getElementById("secuenciaTableWrap");
        if (!seq || !seq.rows.length) {
          if (alertWrap) alertWrap.innerHTML = "";
          wrap.innerHTML =
            '<p class="empty-note">Sin cocimientos programados esta semana.</p>';
          return;
        }
        if (seq.capacityWarnings.length) {
          alertWrap.innerHTML = `<div style="border:1px solid rgba(237,28,43,.35); background:rgba(237,28,43,.08); border-radius:4px; padding:10px 14px; margin-bottom:14px; font-size:12.5px; color:var(--danger);">
      ${seq.capacityWarnings.map((w) => `<div>⚠️ ${escapeHtml(formatCapacityWarning(w))}</div>`).join("")}
    </div>`;
        } else {
          alertWrap.innerHTML = "";
        }
        let rows = seq.rows
          .map((r) => {
            const dur = fmtDuration(r.end - r.start);
            if (r.tipo === "aseo") {
              const faltaDato =
                r.definido === false
                  ? " · ⚠️ sin dato definido (usa el valor por defecto)"
                  : "";
              return `<tr style="background:repeating-linear-gradient(45deg, var(--aseo-row-c1), var(--aseo-row-c1) 6px, var(--aseo-row-c2) 6px, var(--aseo-row-c2) 12px);">
        <td>${r.n}</td>
        <td style="border-left:4px solid var(--accent); color:var(--accent); font-family:var(--sans);"><b>🧽 ${escapeHtml(r.nombre)}</b><span style="color:var(--muted); font-size:10.5px;">${faltaDato}</span></td>
        <td>${fmtDateTime(r.start)}</td>
        <td>${dur}</td>
        <td>${fmtDateTime(r.end)}</td>
      </tr>`;
            }
            const bg = colorForMosto(r.mostoId);
            const tags =
              (r.blockStart ? " · inicio de bloque" : "") +
              (r.blockEnd ? " · fin de bloque" : "") +
              (r.shiftHours > 0.05
                ? ` · desplazado +${r.shiftHours.toFixed(1)} h`
                : "") +
              (r.violaDeadline ? " · ⚠️ excede fecha límite" : "");
            return `<tr style="background:${bg}22; ${r.violaDeadline ? "box-shadow:inset 0 0 0 1px var(--danger);" : ""}">
      <td>${r.n}</td>
      <td style="border-left:4px solid ${r.violaDeadline ? "var(--danger)" : bg}; color:var(--text); font-family:var(--sans);"><b>${escapeHtml(r.nombre)}</b><span style="color:${r.violaDeadline ? "var(--danger)" : "var(--muted)"}; font-size:10.5px;">${tags}</span></td>
      <td>${fmtDateTime(r.start)}</td>
      <td>${dur}</td>
      <td>${fmtDateTime(r.end)}</td>
    </tr>`;
          })
          .join("");
        wrap.innerHTML = `<table><thead><tr><th>#</th><th>Mosto / evento</th><th>Inicio</th><th>Duración</th><th>Fin</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderRecomendaciones(seq) {
        const wrap = document.getElementById("recomendacionesWrap");
        const rec = seq ? seq.recomendaciones : null;
        const rows = RECOMENDACIONES.map((r) => {
          let estado, cls, detalle;
          if (!rec) {
            estado = "Sin datos";
            cls = "warn";
            detalle = "Carga un archivo para evaluar esta recomendación.";
          } else if (r.id === "r1") {
            if (rec.iniciaConPony) {
              estado = "Aplicada";
              cls = "ok";
              detalle = "La secuencia calculada inicia con el bloque de Pony.";
            } else {
              estado = "No aplicada";
              cls = "warn";
              detalle =
                "No fue posible ubicar a Pony al inicio de la semana sin incumplir alguna fecha límite de envasado (o no hay producción de Pony esta semana).";
            }
          } else {
            if (rec.ponyJuntoAseo === null) {
              estado = "No aplica";
              cls = "warn";
              detalle = "No hay producción de Pony esta semana.";
            } else if (rec.ponyJuntoAseo) {
              estado = "Aplicada";
              cls = "ok";
              detalle =
                "El bloque de Pony queda junto a un aseo (CIP), ya que el motor programa un aseo en cada cambio de marca.";
            } else {
              estado = "No aplicada";
              cls = "warn";
              detalle = "El bloque de Pony no quedó junto a un aseo detectado.";
            }
          }
          return `<tr>
      <td style="font-family:var(--sans); color:var(--text);">${escapeHtml(r.texto)}</td>
      <td>${r.impacto}</td>
      <td><span class="tag ${cls}">${estado}</span></td>
      <td style="font-family:var(--sans); color:var(--muted); font-size:11.5px;">${escapeHtml(detalle)}</td>
    </tr>`;
        }).join("");
        wrap.innerHTML = `<table><thead><tr><th>Recomendación</th><th>Impacto</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderReglas(seq) {
        const wrap = document.getElementById("reglasWrap");
        const warns = seq ? seq.reglaWarnings : [];
        let rows = REGLAS_OPERATIVAS.map((r) => {
          const rel = warns.filter((w) => w.ids.includes(r.id));
          let estado, cls, detalle;
          if (!REGLAS_VERIFICABLES.has(r.id)) {
            estado = "No verificable";
            cls = "warn";
            detalle =
              "Requiere datos de líneas de envasado, filtración, mantenimiento o SUITE360 no incluidos en este archivo.";
          } else if (rel.length) {
            estado = "Advertencia";
            cls = "danger";
            detalle = rel.map((w) => w.text).join(" ");
          } else {
            estado = "Aplicada";
            cls = "ok";
            detalle = "Sin conflictos detectados con los datos de esta semana.";
          }
          return `<tr>
      <td>${r.id}</td>
      <td style="font-family:var(--sans); color:var(--text);">${escapeHtml(r.texto)}</td>
      <td>${r.impacto}</td>
      <td><span class="tag ${cls}">${estado}</span></td>
      <td style="font-family:var(--sans); color:var(--muted); font-size:11.5px;">${escapeHtml(detalle)}</td>
    </tr>`;
        }).join("");
        wrap.innerHTML = `<table><thead><tr><th>#</th><th>Regla</th><th>Impacto</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderCocinaPlan(plan) {
        const wrap = document.getElementById("cocinaTableWrap");
        if (!plan.results.length) {
          wrap.innerHTML =
            '<p class="empty-note">Sin volumen a envasar homologado a ningún mosto esta semana.</p>';
          return;
        }
        let rows = plan.results
          .map((r) => {
            const startsHtml = r.starts.length
              ? `<div class="starts-list">${r.starts.map((s, i) => `<span>#${i + 1}: ${fmtDateTime(s)} <small style="color:var(--muted);">(${fmtI0Offset(s)})</small></span>`).join("")}</div>`
              : r.cubiertoTotalPorInventario
                ? '<span class="empty-note">Cubierto totalmente por inventario · no requiere cocinar</span>'
                : '<span class="empty-note">Sin fecha de envasado para calcular inicio</span>';
            const marcasHtml = r.marcas
              .map(
                (b) => `<span class="brand-chip">${escapeHtml(b.name)}</span>`,
              )
              .join("");
            const invHtml =
              r.inventarioUsadoHL > 0
                ? `${r.inventarioUsadoHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL`
                : '<span style="color:var(--muted);">—</span>';
            return `<tr>
      <td>${escapeHtml(r.nombre)}${r.blockLabel ? `<br><span style="color:var(--muted);font-size:10.5px;">${escapeHtml(r.blockLabel)}</span>` : ""}<br>${marcasHtml}</td>
      <td>${r.volumenEnvasar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${invHtml}</td>
      <td>${r.volumenCocinar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${r.numCocimientos}</td>
      <td>${startsHtml}</td>
    </tr>`;
          })
          .join("");
        wrap.innerHTML = `<table><thead><tr><th>Mosto</th><th>Volumen a envasar</th><th>Cubierto por inventario</th><th>Volumen a cocinar</th><th>N° Cocimientos</th><th>Inicio de cada cocimiento</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderSinHomologar(list) {
        const wrap = document.getElementById("sinHomologarWrap");
        const countEl = document.getElementById("sinHomologarCount");
        if (!list.length) {
          wrap.innerHTML =
            '<p class="empty-note">Todas las marcas con volumen homologaron a algún mosto del catálogo.</p>';
          if (countEl) {
            countEl.style.display = "none";
            countEl.textContent = "";
          }
          return;
        }
        if (countEl) {
          countEl.style.display = "inline-block";
          countEl.textContent = list.length;
        }
        let rows = list
          .map(
            (b) =>
              `<tr><td>${escapeHtml(b.codigo)}</td><td>${escapeHtml(b.name)}</td><td>${b.volumen.toLocaleString("es-CO")} HL</td></tr>`,
          )
          .join("");
        wrap.innerHTML = `<table><thead><tr><th>Código</th><th>Marca</th><th>Volumen (HL)</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function renderCatalog() {
        const wrap = document.getElementById("catalogTableWrap");
        let rows = MOSTO_CATALOG.map(
          (m, idx) => `
    <tr data-idx="${idx}">
      <td><input type="text" class="cat-input" data-field="nombre" value="${escapeHtml(m.nombre)}"></td>
      <td><input type="text" class="cat-input" data-field="palabras" value="${escapeHtml(m.palabras)}" placeholder="ej: costeñita, aguila, poker"></td>
      <td><input type="number" step="0.01" min="0.01" class="cat-input" data-field="factorDilucion" value="${m.factorDilucion}"></td>
      <td><input type="number" step="1" min="1" class="cat-input" data-field="volumenPorCocimiento" value="${m.volumenPorCocimiento}"></td>
      <td><input type="text" class="cat-input cat-time" data-field="tiempoEntreCarguesHoras" value="${formatHMS(m.tiempoEntreCarguesHoras)}" placeholder="hh:mm:ss"></td>
      <td><input type="text" class="cat-input cat-time" data-field="tiempoCocinaHoras" value="${formatHMS(m.tiempoCocinaHoras)}" placeholder="hh:mm:ss"></td>
      <td><input type="text" class="cat-input cat-time" data-field="tiempoFermentacionHoras" value="${formatHMS(m.tiempoFermentacionHoras)}" placeholder="hh:mm:ss"></td>
      <td><input type="text" class="cat-input cat-time" data-field="tiempoMaduracionHoras" value="${formatHMS(m.tiempoMaduracionHoras)}" placeholder="hh:mm:ss"></td>
      <td class="cat-remove"><button class="btn small" data-remove="${idx}" title="Quitar mosto">✕</button></td>
    </tr>`,
        ).join("");
        wrap.innerHTML = `<table><thead><tr>
      <th>Marca</th><th>Marcas (palabras clave)</th><th>Factor dilución</th><th>Vol. x cocimiento (HL)</th>
      <th>Cargues (hh:mm:ss)</th><th>Cocinas (hh:mm:ss)</th><th>Fermentación (hh:mm:ss)</th><th>Maduración (hh:mm:ss)</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>`;

        wrap.querySelectorAll(".cat-input").forEach((inp) => {
          inp.addEventListener("change", (e) => {
            const tr = e.target.closest("tr");
            const idx = +tr.dataset.idx;
            const field = e.target.dataset.field;
            let val = e.target.value;
            if (e.target.type === "number") {
              val = parseFloat(val) || 0;
            } else if (e.target.classList.contains("cat-time")) {
              val = parseHMS(val);
              e.target.value = formatHMS(val); // normaliza lo que escribió el usuario
            }
            MOSTO_CATALOG[idx][field] = val;
            recompute();
          });
        });
        wrap.querySelectorAll("[data-remove]").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const idx = +e.currentTarget.dataset.remove;
            MOSTO_CATALOG.splice(idx, 1);
            renderCatalog();
            renderInventoryBalance(STATE && STATE.plan);
            recompute();
          });
        });
      }

      document.getElementById("addMostoBtn").addEventListener("click", () => {
        MOSTO_CATALOG.push({
          id: "mosto_" + Date.now(),
          nombre: "Nuevo mosto",
          palabras: "",
          factorDilucion: 1,
          volumenPorCocimiento: 500,
          tiempoCocinaHoras: parseHMS("8:00:00"),
          tiempoFermentacionHoras: parseHMS("168:00:00"),
          tiempoMaduracionHoras: parseHMS("48:00:00"),
          tiempoEntreCarguesHoras: parseHMS("2:50:00"),
        });
        renderCatalog();
        renderInventoryBalance(STATE && STATE.plan);
        recompute();
      });

      renderCatalog();

      function renderInventoryBalance(plan) {
        const wrap = document.getElementById("balanceTableWrap");
        if (!wrap) return;
        // Totales de esta semana por mosto, tomados del plan ya calculado (recompute()
        // vuelve a correr computeCocinaPlan() completo cada vez, así que estos totales
        // ya reflejan cualquier inventario ingresado).
        const totalsByMosto = {};
        if (plan && Array.isArray(plan.results)) {
          plan.results.forEach((r) => {
            const t =
              totalsByMosto[r.mostoId] ||
              (totalsByMosto[r.mostoId] = {
                envasar: 0,
                cubierto: 0,
                cocinar: 0,
              });
            t.envasar += r.volumenEnvasar;
            t.cubierto += r.inventarioUsadoHL || 0;
            t.cocinar += r.volumenCocinar;
          });
        }
        const rows = MOSTO_CATALOG.map((m) => {
          const disponible = Number(INVENTORY_BALANCE[m.id]) || 0;
          const t = totalsByMosto[m.id] || {
            envasar: 0,
            cubierto: 0,
            cocinar: 0,
          };
          const sobrante = Math.max(0, disponible - t.cubierto);
          return `<tr data-mosto-id="${escapeHtml(m.id)}">
      <td>${escapeHtml(m.nombre)}</td>
      <td><input type="number" min="0" step="0.1" class="cat-input" data-inv-mosto="${escapeHtml(m.id)}" value="${disponible}"></td>
      <td>${t.envasar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${t.cubierto.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${t.cocinar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${sobrante.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
    </tr>`;
        }).join("");
        wrap.innerHTML = rows
          ? `<table><thead><tr><th>Mosto</th><th>Inventario disponible (HL)</th><th>Volumen a envasar esta semana</th><th>Cubierto por inventario</th><th>Pendiente por cocinar</th><th>Inventario sobrante</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="empty-note">Agrega al menos un mosto en el Catálogo de mostos para poder registrar inventario.</p>';
        wrap.querySelectorAll("[data-inv-mosto]").forEach((inp) => {
          inp.addEventListener("change", (e) => {
            const mostoId = e.target.dataset.invMosto;
            const val = Math.max(0, parseFloat(e.target.value) || 0);
            INVENTORY_BALANCE[mostoId] = val;
            e.target.value = val;
            saveInventoryBalance();
            recompute();
          });
        });
      }
      renderInventoryBalance(STATE && STATE.plan);

      function renderYeastConfig() {
        const wrap = document.getElementById("yeastConfigWrap");
        const summary = document.getElementById("yeastSummaryWrap");
        if (!wrap) return;
        const rows = (YEAST_AVAILABILITY || []).map((y, idx) => {
          const d = y.disponibleDesde ? new Date(y.disponibleDesde) : null;
          return `<tr data-yeast-idx="${idx}">
            <td><select class="cat-input" data-yeast-field="mostoId">${MOSTO_CATALOG.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === y.mostoId ? "selected" : ""}>${escapeHtml(m.nombre)}</option>`).join("")}</select></td>
            <td><input type="text" class="cat-input" data-yeast-field="origen" value="${escapeHtml(y.origen || "")}" placeholder="Tanque / fuente"></td>
            <td><input type="datetime-local" class="cat-input" data-yeast-field="disponibleDesde" value="${d && !isNaN(d) ? toInputDateTimeUTC(d) : ""}"></td>
            <td style="text-align:center"><input type="checkbox" data-yeast-field="disponible" ${y.disponible !== false ? "checked" : ""} style="width:17px;height:17px"></td>
            <td><span class="tag ${y.mostoId === "light" ? "ok" : "warn"}">${y.mostoId === "light" ? "Solo Light + marcas generales" : "Marcas no Light"}</span></td>
            <td><button class="btn small" data-remove-yeast="${idx}">✕</button></td>
          </tr>`;
        }).join("");
        wrap.innerHTML = rows ? `<table><thead><tr><th>Marca cosechada</th><th>Tanque / fuente</th><th>Disponible desde</th><th>Disponible</th><th>Compatibilidad</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty-note">No hay cosechas registradas. Sin una disponibilidad Light, los bloques Light quedarán bloqueados.</p>';
        const lightRows = (YEAST_AVAILABILITY || []).filter((y) => y.mostoId === "light" && y.disponible !== false && yeastAvailableDate(y)).sort((a,b)=>yeastAvailableDate(a)-yeastAvailableDate(b));
        if (summary) summary.innerHTML = lightRows.length
          ? `<div style="border:1px solid rgba(76,175,130,.35);background:rgba(76,175,130,.08);padding:10px 14px;border-radius:4px;color:var(--ok)"><b>✓ Levadura Light registrada.</b> Próxima disponibilidad: ${fmtDateTime(yeastAvailableDate(lightRows[0]))}.</div>`
          : '<div style="border:1px solid rgba(237,28,43,.35);background:rgba(237,28,43,.08);padding:10px 14px;border-radius:4px;color:var(--danger)"><b>⚠ No hay levadura Light disponible.</b> Los bloques Light no podrán programarse.</div>';
        wrap.querySelectorAll("[data-yeast-field]").forEach((inp) => inp.addEventListener("change", (e) => {
          const idx = +e.target.closest("tr").dataset.yeastIdx;
          const field = e.target.dataset.yeastField;
          YEAST_AVAILABILITY[idx][field] = field === "disponible" ? !!e.target.checked : e.target.value;
          saveYeastAvailability();
          renderYeastConfig();
          recompute();
        }));
        wrap.querySelectorAll("[data-remove-yeast]").forEach((btn) => btn.addEventListener("click", (e) => {
          YEAST_AVAILABILITY.splice(+e.currentTarget.dataset.removeYeast, 1);
          saveYeastAvailability();
          renderYeastConfig();
          recompute();
        }));
      }
      function renderYeastStatus(seq) {
        const wrap = document.getElementById("yeastStatusWrap");
        const alert = document.getElementById("yeastAlertWrap");
        const count = document.getElementById("yeastBlockedCount");
        if (!wrap) return;
        const events = seq && seq.yeastEvents ? seq.yeastEvents : [];
        const blocked = events.filter((e) => e.estado === "BLOQUEADO");
        if (count) {
          count.textContent = blocked.length;
          count.style.display = blocked.length ? "inline-block" : "none";
        }
        if (alert) alert.innerHTML = blocked.length
          ? `<div style="border:1px solid rgba(237,28,43,.35);background:rgba(237,28,43,.08);padding:10px 14px;margin-bottom:14px;border-radius:4px;color:var(--danger)"><b>⚠ ${blocked.length} bloque(s) Light bloqueado(s).</b> Registra una cosecha Light disponible o una fecha futura para habilitar su programación.</div>`
          : '<div style="border:1px solid rgba(76,175,130,.35);background:rgba(76,175,130,.08);padding:10px 14px;margin-bottom:14px;border-radius:4px;color:var(--ok)"><b>✓ Validación de levadura superada.</b> No hay bloques Light bloqueados.</div>';
        if (!events.length) {
          wrap.innerHTML = '<p class="empty-note">Sin bloques para evaluar.</p>';
          return;
        }
        wrap.innerHTML = `<table><thead><tr><th>Bloque</th><th>Requerida</th><th>Fuente</th><th>Disponible desde</th><th>Inicio permitido</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${events.map((e) => `<tr style="background:${e.estado === "BLOQUEADO" ? "rgba(237,28,43,.08)" : "transparent"}"><td>${escapeHtml(e.blockLabel || "")}</td><td>${escapeHtml(e.requerida)}</td><td>${escapeHtml(e.fuente)}</td><td>${e.disponibleDesde ? fmtDateTime(e.disponibleDesde) : "—"}</td><td>${e.inicio ? fmtDateTime(e.inicio) : "—"}</td><td><span class="tag ${e.estado === "BLOQUEADO" ? "danger" : "ok"}">${e.estado}</span></td><td style="font-family:var(--sans);color:var(--muted)">${escapeHtml(e.detalle || "")}</td></tr>`).join("")}</tbody></table>`;
      }
      document.getElementById("addYeastBtn").addEventListener("click", () => {
        YEAST_AVAILABILITY.push({
          id: "levadura_" + Date.now(),
          mostoId: "light",
          origen: "",
          disponibleDesde: toInputDateTimeUTC(getI0Date() || new Date()),
          disponible: true,
        });
        saveYeastAvailability();
        renderYeastConfig();
        recompute();
      });
      renderYeastConfig();
      function renderTankCatalog() {
        const wrap = document.getElementById("tankTableWrap");
        if (!wrap) return;
        const rows = TANK_CATALOG.map(
          (t, idx) => `<tr data-idx="${idx}">
    <td><input type="text" class="cat-input" data-tank-field="equipo" value="${escapeHtml(t.equipo)}" placeholder="FV-01"></td>
    <td><select class="cat-input" data-tank-field="tipo"><option ${t.tipo === "FV" ? "selected" : ""}>FV</option><option ${t.tipo === "SV" ? "selected" : ""}>SV</option><option ${t.tipo === "SV Pony" ? "selected" : ""}>SV Pony</option><option ${t.tipo === "BBT" ? "selected" : ""}>BBT</option><option ${t.tipo === "Equipo" ? "selected" : ""}>Equipo</option></select></td>
    <td><input type="number" min="0" step="0.01" class="cat-input" data-tank-field="aguaPromedio" value="${Number(t.aguaPromedio) || 0}"></td>
    <td><input type="number" min="0" step="0.001" class="cat-input" data-tank-field="capacidadHL" value="${Number(t.capacidadHL) || 0}"></td>
    <td><input type="number" min="0" step="0.001" class="cat-input" data-tank-field="indiceAguaCapacidad" value="${Number(t.indiceAguaCapacidad) || 0}"></td>
    <td><select class="cat-input" data-tank-field="prioridad"><option ${t.prioridad === "A" ? "selected" : ""}>A</option><option ${t.prioridad === "B" ? "selected" : ""}>B</option><option ${t.prioridad === "C" ? "selected" : ""}>C</option></select></td>
    <td><input type="text" class="cat-input cat-time" data-tank-field="aseoHoras" value="${formatHMS(Number(t.aseoHoras) || 0)}" placeholder="hh:mm:ss"></td>
    <td style="text-align:center;"><input type="checkbox" data-tank-field="disponible" ${t.disponible !== false ? "checked" : ""} style="width:17px;height:17px;"></td>
    <td><button class="btn small" data-remove-tank="${idx}" title="Quitar equipo">✕</button></td>
  </tr>`,
        ).join("");
        wrap.innerHTML = `<table><thead><tr><th>Equipo</th><th>Tipo</th><th>Agua promedio</th><th>Capacidad (HL)</th><th>Índice agua/cap.</th><th>Prioridad</th><th>Aseo después de liberar</th><th>Disponible</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
        wrap.querySelectorAll("[data-tank-field]").forEach((inp) =>
          inp.addEventListener("change", (e) => {
            const tr = e.target.closest("tr"),
              idx = +tr.dataset.idx,
              field = e.target.dataset.tankField;
            TANK_CATALOG[idx][field] =
              field === "capacidadHL"
                ? parseFloat(e.target.value) || 0
                : field === "aseoHoras"
                  ? parseHMS(e.target.value)
                  : field === "disponible"
                    ? !!e.target.checked
                    : e.target.value;
            if (field === "aseoHoras")
              e.target.value = formatHMS(TANK_CATALOG[idx].aseoHoras);
            recompute();
          }),
        );
        wrap.querySelectorAll("[data-remove-tank]").forEach((btn) =>
          btn.addEventListener("click", (e) => {
            TANK_CATALOG.splice(+e.currentTarget.dataset.removeTank, 1);
            renderTankCatalog();
            recompute();
          }),
        );
      }

      document.getElementById("addTankBtn").addEventListener("click", () => {
        TANK_CATALOG.push({
          id: "equipo_" + Date.now(),
          equipo: "",
          tipo: "Equipo",
          aguaPromedio: 0,
          capacidadHL: 0,
          indiceAguaCapacidad: 0,
          prioridad: "C",
          disponible: true,
          aseoHoras: parseHMS("1:00:00"),
        });
        renderTankCatalog();
        recompute();
      });
      renderTankCatalog();

      function renderAseoCatalog() {
        const wrap = document.getElementById("aseoTableWrap");
        let rows = ASEO_MATRIX.map(
          (a, idx) => `
    <tr data-idx="${idx}">
      <td><input type="text" class="cat-input" data-field="origen" value="${escapeHtml(a.origen)}" placeholder="ej: Pilsen"></td>
      <td><input type="text" class="cat-input" data-field="destino" value="${escapeHtml(a.destino)}" placeholder="ej: Pony"></td>
      <td><input type="text" class="cat-input cat-time" data-field="duracionHoras" value="${formatHMS(a.duracionHoras)}" placeholder="hh:mm:ss"></td>
      <td class="cat-remove"><button class="btn small" data-remove-aseo="${idx}" title="Quitar aseo">✕</button></td>
    </tr>`,
        ).join("");
        wrap.innerHTML = rows
          ? `<table><thead><tr><th>Marca origen</th><th>Marca destino</th><th>Duración CIP (hh:mm:ss)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p class="empty-note">Sin combinaciones definidas — se usará el aseo por defecto en todos los cambios de marca.</p>';

        wrap.querySelectorAll(".cat-input").forEach((inp) => {
          inp.addEventListener("change", (e) => {
            const tr = e.target.closest("tr");
            const idx = +tr.dataset.idx;
            const field = e.target.dataset.field;
            let val = e.target.value;
            if (e.target.classList.contains("cat-time")) {
              val = parseHMS(val);
              e.target.value = formatHMS(val);
            }
            ASEO_MATRIX[idx][field] = val;
            recompute();
          });
        });
        wrap.querySelectorAll("[data-remove-aseo]").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            const idx = +e.currentTarget.dataset.removeAseo;
            ASEO_MATRIX.splice(idx, 1);
            renderAseoCatalog();
            recompute();
          });
        });
      }

      document.getElementById("addAseoBtn").addEventListener("click", () => {
        ASEO_MATRIX.push({
          origen: "",
          destino: "",
          duracionHoras: ASEO_DEFAULT_HORAS,
        });
        renderAseoCatalog();
        recompute();
      });

      const aseoDefaultInput = document.getElementById("aseoDefaultInput");
      aseoDefaultInput.value = formatHMS(ASEO_DEFAULT_HORAS);
      aseoDefaultInput.addEventListener("change", () => {
        ASEO_DEFAULT_HORAS = parseHMS(aseoDefaultInput.value);
        aseoDefaultInput.value = formatHMS(ASEO_DEFAULT_HORAS);
        recompute();
      });

      renderAseoCatalog();

      // ---- Aseo periódico (general): tiempo y N° de cocimientos, editables ----
      const aseoPeriodicoTiempoInput = document.getElementById(
        "aseoPeriodicoTiempoInput",
      );
      const aseoPeriodicoCocimientosInput = document.getElementById(
        "aseoPeriodicoCocimientosInput",
      );
      const aseoPeriodicoActivoInput = document.getElementById(
        "aseoPeriodicoActivoInput",
      );

      aseoPeriodicoTiempoInput.value = formatHMS(ASEO_PERIODICO.duracionHoras);
      aseoPeriodicoCocimientosInput.value =
        ASEO_PERIODICO.cocimientosEntreAseos;
      aseoPeriodicoActivoInput.checked = ASEO_PERIODICO.activo;

      aseoPeriodicoTiempoInput.addEventListener("change", () => {
        ASEO_PERIODICO.duracionHoras = parseHMS(aseoPeriodicoTiempoInput.value);
        aseoPeriodicoTiempoInput.value = formatHMS(
          ASEO_PERIODICO.duracionHoras,
        );
        recompute();
      });
      aseoPeriodicoCocimientosInput.addEventListener("change", () => {
        ASEO_PERIODICO.cocimientosEntreAseos = Math.max(
          1,
          parseInt(aseoPeriodicoCocimientosInput.value) || 1,
        );
        aseoPeriodicoCocimientosInput.value =
          ASEO_PERIODICO.cocimientosEntreAseos;
        recompute();
      });
      aseoPeriodicoActivoInput.addEventListener("change", () => {
        ASEO_PERIODICO.activo = aseoPeriodicoActivoInput.checked;
        recompute();
      });

      // ---- Botón "Refrescar análisis": vuelve a calcular todo con los valores editados actuales ----
      document
        .getElementById("refreshAnalysisBtn")
        .addEventListener("click", () => {
          const btn = document.getElementById("refreshAnalysisBtn");
          const original = btn.textContent;
          recompute();
          btn.textContent = "✓ Análisis actualizado";
          setTimeout(() => {
            btn.textContent = original;
          }, 1500);
        });

      /* =========================================================================
   7) PROMPT — solo lo necesario para programar cocinas
   ========================================================================= */
      function buildPrompt(parsed, plan, mergedByTrain) {
        const lines = [];
        const i0 = getI0Date();
        lines.push(
          `I0 (momento de programación): ${i0 ? fmtDateTime(i0) : "(no definido)"}  ·  SEMANA: ${parsed.weekLabel || "(no especificada)"}  \u00b7  Inicio real de envasado: ${parsed.weekStartDate ? fmtDate(parsed.weekStartDate) : "(sin fecha)"}  \u00b7  Plan enviado: ${parsed.headerDate ? fmtDate(parsed.headerDate) : "(sin fecha)"}`,
        );
        lines.push("");
        lines.push(
          "====================================================================",
        );
        lines.push("PROGRAMACI\u00d3N DE COCIMIENTOS POR MOSTO");
        lines.push(
          "====================================================================",
        );
        if (!plan.results.length)
          lines.push(
            "Sin volumen a envasar homologado a ning\u00fan mosto esta semana.",
          );
        plan.results.forEach((r) => {
          lines.push("");
          lines.push(`MOSTO: ${r.nombre}`);
          lines.push(
            `  Volumen a envasar: ${r.volumenEnvasar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL`,
          );
          if (r.inventarioUsadoHL > 0)
            lines.push(
              `  Cubierto por inventario (Balance Semanal): ${r.inventarioUsadoHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL`,
            );
          lines.push(
            `  Volumen a cocinar: ${r.volumenCocinar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL`,
          );
          lines.push(`  N\u00famero de cocimientos: ${r.numCocimientos}`);
          lines.push("  Fechas y horas de inicio de cada cocimiento:");
          if (!r.starts.length) {
            lines.push(
              r.cubiertoTotalPorInventario
                ? "    (cubierto totalmente por inventario, no requiere cocinar)"
                : "    (sin fecha de envasado registrada para calcular el inicio)",
            );
          } else {
            r.starts.forEach((s, i) =>
              lines.push(
                `    Cocimiento ${i + 1}: ${fmtDateTime(s)}  ·  posición respecto a I0: ${fmtI0Offset(s)}`,
              ),
            );
          }
        });

        if (plan.sinHomologar.length) {
          lines.push("");
          lines.push(
            "====================================================================",
          );
          lines.push(
            `MARCAS SIN HOMOLOGAR A UN MOSTO (${plan.sinHomologar.length}) \u2014 no incluidas arriba`,
          );
          lines.push(
            "====================================================================",
          );
          plan.sinHomologar.forEach((b) => {
            lines.push(
              `- ${b.name} [${b.codigo}] | ${b.volumen.toLocaleString("es-CO")} HL`,
            );
          });
        }

        lines.push("");
        const rangeStart = parsed.weekStartDate || parsed.headerDate;
        const rangeEndExclusive = addDays(rangeStart, 7);
        lines.push(
          "====================================================================",
        );
        lines.push(
          `SECUENCIA DE ENVASADO DEL ${fmtDate(rangeStart)} AL ${fmtDate(addDays(rangeEndExclusive, -1))}`,
        );
        lines.push(
          "====================================================================",
        );
        const rangeStartTime = rangeStart;
        const rangeEnd = rangeEndExclusive;
        const bloques = [];
        if (mergedByTrain) {
          TRAINS.forEach((t) => {
            (mergedByTrain[t] || []).forEach((b) => {
              if (b.type !== "production") return;
              if (
                b.end.getTime() <= rangeStartTime.getTime() ||
                b.start.getTime() >= rangeEnd.getTime()
              )
                return;
              bloques.push({
                train: t,
                nombre: b.name || b.codigo || "",
                hl: b.hectolitros || 0,
                start: b.start,
                end: b.end,
              });
            });
          });
        }
        bloques.sort((a, b) => a.start.getTime() - b.start.getTime());
        if (!bloques.length) {
          lines.push("Sin bloques de envasado en ese rango de fechas.");
        } else {
          bloques.forEach((b) => {
            lines.push(
              `TREN-${b.train} | ${b.nombre} | ${b.hl.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL | ${fmtDateTime(b.start)} \u2192 ${fmtDateTime(b.end)}`,
            );
          });
        }

        lines.push("");
        lines.push(
          "====================================================================",
        );
        lines.push("ASIGNACIÓN DE TANQUES / EQUIPOS");
        lines.push(
          "====================================================================",
        );
        lines.push("INVENTARIO CONFIGURADO (prioridad A → B → C):");
        (TANK_CATALOG || []).forEach((t) =>
          lines.push(
            `- ${t.equipo || "(sin nombre)"} | Tipo: ${t.tipo || "Equipo"} | Agua promedio: ${(Number(t.aguaPromedio) || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })} | Capacidad: ${(Number(t.capacidadHL) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL | Índice agua/capacidad: ${(Number(t.indiceAguaCapacidad) || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 })} | Prioridad: ${t.prioridad || "C"} | Aseo después de liberar: ${formatHMS(Number(t.aseoHoras) || 0)} | Disponible: ${t.disponible !== false ? "Sí" : "No"}`,
          ),
        );
        lines.push(
          "Regla de asignación: FV = SOLO fermentación y recibe mosto desde cocina; SV = SOLO maduración y recibe producto transferido desde FV; SV Pony = SOLO Pony; BBT/Equipo = SOLO producto terminado; se llena la capacidad disponible por etapa con producto de una sola marca, sin mezclar marcas; se prioriza A → B → C; si no existe capacidad suficiente en FV para fermentación o en SV para maduración, marcar SIN TANQUE.",
        );
        const assignment = STATE && STATE.seq ? STATE.seq.tankAssignment : null;
        if (!assignment || !assignment.rows.length)
          lines.push("Sin cocimientos para asignar.");
        else
          assignment.rows.forEach((r) => {
            lines.push(
              `Cocimiento ${r.cocimientoNumero} | ${r.nombre} | ${r.volumenHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL | ${r.tanque || "SIN TANQUE"} | Prioridad ${r.prioridad || "—"} | ${r.estado}${r.motivo ? " | " + r.motivo : ""}`,
            );
          });
        if (assignment && assignment.sinTanque.length) {
          lines.push(`TOTAL SIN TANQUE: ${assignment.sinTanque.length}`);
          lines.push(
            "Regla: mantener varios cocimientos de la misma marca en el mismo tanque hasta llenarlo; no dividir un cocimiento entre tanques. Si ningún tanque puede recibir el cocimiento/lote completo, marcarlo como sin tanque.",
          );
        }

        lines.push("");
        lines.push("====================================================================");
        lines.push("DISPONIBILIDAD Y VALIDACIÓN DE LEVADURA");
        lines.push("====================================================================");
        lines.push("Regla: Light solo puede sembrarse con levadura cosechada de Light. Las demás marcas pueden mezclar levaduras entre sí y también usar levadura Light.");
        const yeastEvents = STATE && STATE.seq && STATE.seq.yeastEvents ? STATE.seq.yeastEvents : [];
        if (!yeastEvents.length) lines.push("Sin bloques para evaluar.");
        yeastEvents.forEach((e) => lines.push(`${e.blockLabel} | Requerida: ${e.requerida} | Fuente: ${e.fuente} | Disponible desde: ${e.disponibleDesde ? fmtDateTime(e.disponibleDesde) : "—"} | Estado: ${e.estado} | ${e.detalle || ""}`));
        return lines.join("\n");
      }

      /* =========================================================================
   7) EVENTOS DE UI
   ========================================================================= */
      const fileInput = document.getElementById("fileInput");
      const dropZone = document.getElementById("dropZone");
      const statusEl = document.getElementById("status");

      const uploadCompact = document.getElementById("uploadCompact");
      const uploadCompactName = document.getElementById("uploadCompactName");
      const changeFileBtn = document.getElementById("changeFileBtn");
      const programI0Input = document.getElementById("programI0Input");
      const i0Badge = document.getElementById("i0Badge");

      // I0 se guarda localmente para que no tengas que escribirlo cada vez que abras el HTML.
      // El valor por defecto toma la fecha Y HORA actuales (hora de pared local), para poder
      // programar cocimientos enseguida el mismo día I0 sin tener que ajustar la hora a mano.
      const savedI0 = localStorage.getItem("planCocinasI0");
      const todayUTC = new Date();
      const defaultI0 =
        savedI0 ||
        toInputDateTimeUTC(
          new Date(
            Date.UTC(
              todayUTC.getFullYear(),
              todayUTC.getMonth(),
              todayUTC.getDate(),
              todayUTC.getHours(),
              todayUTC.getMinutes(),
            ),
          ),
        );
      programI0Input.value = defaultI0;
      function refreshI0Badge() {
        const d = getI0Date();
        i0Badge.textContent = d ? `I0: ${fmtDateTime(d)}` : "I0: —";
        if (STATE && STATE.parsed) {
          const meta = document.getElementById("weekMeta");
          meta.textContent =
            (STATE.parsed.weekLabel || "") +
            (STATE.parsed.weekStartDate
              ? "  ·  primer día: " + fmtDate(STATE.parsed.weekStartDate)
              : "") +
            (STATE.parsed.headerDate
              ? "  ·  plan enviado: " + fmtDate(STATE.parsed.headerDate)
              : "") +
            (d ? "  ·  I0: " + fmtDateTime(d) : "");
          recompute();
        }
      }
      programI0Input.addEventListener("change", () => {
        const d = getI0Date();
        if (!d) return;
        localStorage.setItem("planCocinasI0", programI0Input.value);
        refreshI0Badge();
      });
      refreshI0Badge();

      function handleFile(file) {
        if (!file) return;
        statusEl.classList.remove("error");
        statusEl.textContent = "Leyendo " + file.name + "...";
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {
              type: "array",
              cellDates: true,
            });
            const parsed = parseWorkbook(workbook);
            render(parsed);
            statusEl.textContent =
              "Listo — " + file.name + " procesado correctamente.";
            // Oculta la zona de arrastre y muestra la barra compacta con el nombre del archivo
            dropZone.classList.add("hidden");
            uploadCompactName.textContent = file.name;
            uploadCompact.classList.remove("hidden");
          } catch (err) {
            console.error(err);
            statusEl.classList.add("error");
            statusEl.textContent = "Error: " + err.message;
            document.getElementById("results").classList.add("hidden");
            document.getElementById("ganttTopPanel").classList.add("hidden");
          }
        };
        reader.onerror = () => {
          statusEl.classList.add("error");
          statusEl.textContent = "No se pudo leer el archivo.";
        };
        reader.readAsArrayBuffer(file);
      }

      fileInput.addEventListener("change", (e) =>
        handleFile(e.target.files[0]),
      );
      ["dragenter", "dragover"].forEach((ev) =>
        dropZone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropZone.classList.add("drag");
        }),
      );
      ["dragleave", "drop"].forEach((ev) =>
        dropZone.addEventListener(ev, (e) => {
          e.preventDefault();
          dropZone.classList.remove("drag");
        }),
      );
      dropZone.addEventListener("drop", (e) => {
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
      });

      changeFileBtn.addEventListener("click", () => {
        uploadCompact.classList.add("hidden");
        dropZone.classList.remove("hidden");
      });

      // ---- Ocultar/mostrar el panel de catálogos hacia el lado ----
      const configTabsEl = document.getElementById("configTabs");
      const catalogsBar = document.getElementById("catalogsBar");
      const toggleCatalogsBtn = document.getElementById("toggleCatalogsBtn");
      const sideCatalogsTab = document.getElementById("sideCatalogsTab");
      function collapseCatalogs() {
        configTabsEl.classList.add("hidden");
        catalogsBar.classList.add("hidden");
        sideCatalogsTab.classList.remove("hidden");
      }
      function expandCatalogs() {
        configTabsEl.classList.remove("hidden");
        catalogsBar.classList.remove("hidden");
        sideCatalogsTab.classList.add("hidden");
      }
      toggleCatalogsBtn.addEventListener("click", collapseCatalogs);
      sideCatalogsTab.addEventListener("click", expandCatalogs);

      // ---- Modo oscuro / claro ----
      const THEME_KEY = "envasado-theme";
      const themeToggleBtn = document.getElementById("themeToggleBtn");
      function applyTheme(theme) {
        document.body.classList.toggle("theme-light", theme === "light");
        if (themeToggleBtn)
          themeToggleBtn.textContent =
            theme === "light" ? "🌙 Modo oscuro" : "☀️ Modo claro";
      }
      let currentTheme = "dark";
      try {
        currentTheme = localStorage.getItem(THEME_KEY) || "dark";
      } catch (_) {}
      applyTheme(currentTheme);
      if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", () => {
          currentTheme = currentTheme === "light" ? "dark" : "light";
          applyTheme(currentTheme);
          try {
            localStorage.setItem(THEME_KEY, currentTheme);
          } catch (_) {}
        });
      }

      // ---- Envío a Copilot (agente propio configurado por el usuario) ----
      const COPILOT_URL = "https://copilot.microsoft.com/";
      const AGENT_URL_KEY = "envasado-agent-copilot-agent-url";
      const agentUrlInput = document.getElementById("agentUrlInput");

      try {
        agentUrlInput.value = localStorage.getItem(AGENT_URL_KEY) || "";
      } catch (_) {}
      agentUrlInput.addEventListener("change", () => {
        try {
          localStorage.setItem(AGENT_URL_KEY, agentUrlInput.value.trim());
        } catch (_) {}
      });
      function getAgentUrl() {
        return (agentUrlInput.value || "").trim() || COPILOT_URL;
      }
      async function copyPromptText() {
        const box = document.getElementById("promptBox");
        try {
          await navigator.clipboard.writeText(box.value);
          return true;
        } catch (e) {
          box.select();
          return document.execCommand("copy");
        }
      }

      document.getElementById("copyBtn").addEventListener("click", async () => {
        const ok = await copyPromptText();
        const fb = document.getElementById("copyFeedback");
        fb.textContent = ok
          ? "✓ Copiado — pégalo en el chat de tu agente de Copilot"
          : "⚠️ No se pudo copiar automáticamente.";
        setTimeout(() => (fb.textContent = ""), 4000);
      });
      document.getElementById("openAgentBtn").addEventListener("click", () => {
        window.open(getAgentUrl(), "_blank", "noopener,noreferrer");
      });
      document
        .getElementById("analyzeBtn")
        .addEventListener("click", async () => {
          const box = document.getElementById("promptBox");
          if (!box.value.trim()) {
            const fb = document.getElementById("copyFeedback");
            fb.textContent =
              "⚠️ Carga un archivo primero para generar el prompt.";
            setTimeout(() => (fb.textContent = ""), 4000);
            return;
          }
          const ok = await copyPromptText();
          const fb = document.getElementById("copyFeedback");
          fb.textContent = ok
            ? "✓ Datos copiados. Se abrió tu agente — pega con Ctrl+V."
            : "⚠️ No se pudo copiar automáticamente.";
          setTimeout(() => (fb.textContent = ""), 4000);
          window.open(getAgentUrl(), "_blank", "noopener,noreferrer");
        });
      document.getElementById("downloadBtn").addEventListener("click", () => {
        const box = document.getElementById("promptBox");
        const blob = new Blob([box.value], {
          type: "text/plain;charset=utf-8",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "prompt_plan_envasado.txt";
        a.click();
      });
