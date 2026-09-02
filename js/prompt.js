/* =========================================================================
   PROMPT para el agente de Copilot
   ========================================================================= */
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
  lines.push("");
  lines.push(
    "====================================================================",
  );
  lines.push(
    "BALANCE SEMANAL — INVENTARIO POR LOTE (equipo, marca, días y HL normalizados)",
  );
  lines.push(
    "====================================================================",
  );
  if (!INVENTORY_BALANCE.length) {
    lines.push("Sin lotes de inventario registrados.");
  }
  INVENTORY_BALANCE.forEach((e) => {
    const m = MOSTO_CATALOG.find((mm) => mm.id === e.mostoId);
    const diasReq = m
      ? ((Number(m.tiempoFermentacionHoras) || 0) +
          (Number(m.tiempoMaduracionHoras) || 0)) /
        24
      : null;
    const dias =
      e.diasEnEquipo === "" || e.diasEnEquipo == null
        ? null
        : Number(e.diasEnEquipo);
    const estado =
      dias != null && diasReq != null
        ? dias >= diasReq
          ? "Listo"
          : `En proceso (faltan ${(diasReq - dias).toFixed(1)} d)`
        : "Sin datos de días";
    lines.push(
      `${e.equipo || "(sin equipo)"} | ${m ? m.nombre : e.mostoId} | ${dias != null ? dias.toFixed(1) + " d" : "—"} de ${diasReq != null ? diasReq.toFixed(1) + " d" : "—"} | ${(Number(e.hL) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL | ${estado}`,
    );
  });
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
  lines.push(
    "====================================================================",
  );
  lines.push("DISPONIBILIDAD Y VALIDACIÓN DE LEVADURA");
  lines.push(
    "====================================================================",
  );
  lines.push(
    "Regla: Light solo puede sembrarse con levadura cosechada de Light. Las demás marcas pueden mezclar levaduras entre sí y también usar levadura Light.",
  );
  const yeastEvents =
    STATE && STATE.seq && STATE.seq.yeastEvents ? STATE.seq.yeastEvents : [];
  if (!yeastEvents.length) lines.push("Sin bloques para evaluar.");
  yeastEvents.forEach((e) =>
    lines.push(
      `${e.blockLabel} | Requerida: ${e.requerida} | Fuente: ${e.fuente} | Disponible desde: ${e.disponibleDesde ? fmtDateTime(e.disponibleDesde) : "—"} | Estado: ${e.estado} | ${e.detalle || ""}`,
    ),
  );
  return lines.join("\n");
}

