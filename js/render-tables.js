/* =========================================================================
   RENDER (tablas) — conflictos, tanques, secuencia, reglas, catalogo, inventario, levadura, aseos
   ========================================================================= */
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
          : w.tipo === "aseocorto"
            ? "Ventana de cocimientos entre aseos"
            : w.tipo === "cocinaparada"
              ? "Horas de cocina sin programar"
              : w.tipo === "corridacorta"
                ? "Corrida de cerveza bajo el mínimo"
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
      wrap.innerHTML = '<p class="empty-note">Sin datos de asignación.</p>';
    return;
  }
  if (count) {
    count.textContent = assignment.sinTanque.length;
    count.style.display = assignment.sinTanque.length ? "inline-block" : "none";
  }
  if (alert) {
    alert.innerHTML = assignment.sinTanque.length
      ? `<div style="border:1px solid rgba(237,28,43,.35); background:rgba(237,28,43,.08); border-radius:4px; padding:10px 14px; margin-bottom:14px; color:var(--danger);"><b>⚠️ ${assignment.sinTanque.length} cocimiento(s) sin tanque.</b> La asignación se detuvo para esos cocimientos porque no existe capacidad suficiente en equipos disponibles con prioridad A → B → C.</div>`
      : '<div style="border:1px solid rgba(76,175,130,.35); background:rgba(76,175,130,.08); border-radius:4px; padding:10px 14px; margin-bottom:14px; color:var(--ok);"><b>✓ Todos los cocimientos tienen tanque asignado.</b> Los FV son solo de fermentación; los SV son solo de maduración; los SV Pony son exclusivos de Pony; los BBT son solo de producto terminado.</div>';
    const preoc = (assignment.tanks || []).filter((t) => t.preocupado);
    if (preoc.length) {
      const ahora = (
        (typeof getI0Date === "function" && getI0Date()) ||
        new Date()
      ).getTime();
      const enProceso = preoc.filter(
        (t) => t.preocupado.hasta.getTime() > ahora + 60000,
      );
      const porLiberar = preoc.length - enProceso.length;
      const partes = [];
      if (enProceso.length)
        partes.push(
          `${enProceso.length} aún en fermentación/maduración (${enProceso
            .map(
              (t) =>
                `${escapeHtml(t.equipo || "?")} → ${fmtDate(t.preocupado.hasta)}`,
            )
            .join(" · ")})`,
        );
      if (porLiberar) partes.push(`${porLiberar} listo(s) para liberar`);
      alert.innerHTML += `<div style="border:1px solid rgba(243,154,45,.35); background:rgba(243,154,45,.08); border-radius:4px; padding:10px 14px; margin-bottom:14px; color:var(--warn); font-size:12.5px;"><b>ℹ️ ${preoc.length} equipo(s) con producto en proceso</b> — ${partes.join(
        "; ",
      )}. Solo se usan los equipos vacíos, respetando la prioridad A → B → C.</div>`;
    }
  }
  if (!assignment.rows.length) {
    wrap.innerHTML = '<p class="empty-note">Sin cocimientos programados.</p>';
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

function renderCocinaPlan(plan, assignment) {
  const wrap = document.getElementById("cocinaTableWrap");
  if (!plan.results.length) {
    wrap.innerHTML =
      '<p class="empty-note">Sin volumen a envasar homologado a ningún mosto esta semana.</p>';
    return;
  }
  // Cocimientos de este bloque que se quedaron sin dónde ir. Se busca por
  // etiqueta —la de la secuencia arrastra la del plan más el sufijo de corrida o
  // de parte— y, si no calza, por mosto.
  const sinEspacioDe = (r) => {
    const todos = (assignment && assignment.sinTanque) || [];
    const porEtiqueta = todos.filter(
      (s) =>
        r.blockLabel &&
        typeof s.blockLabel === "string" &&
        s.blockLabel.startsWith(r.blockLabel),
    );
    return porEtiqueta.length
      ? porEtiqueta
      : todos.filter((s) => s.mostoId === r.mostoId);
  };
  let rows = plan.results
    .map((r) => {
      const startsHtml = r.starts.length
        ? `<div class="starts-list">${r.starts.map((s, i) => `<span>#${i + 1}: ${fmtDateTime(s)} <small style="color:var(--muted);">(${fmtI0Offset(s)})</small></span>`).join("")}</div>`
        : r.cubiertoTotalPorInventario
          ? '<span class="empty-note">Cubierto totalmente por inventario · no requiere cocinar</span>'
          : '<span class="empty-note">Sin fecha de envasado para calcular inicio</span>';
      const marcasHtml = r.marcas
        .map((b) => `<span class="brand-chip">${escapeHtml(b.name)}</span>`)
        .join("");
      const invHtml =
        r.inventarioUsadoHL > 0
          ? `${r.inventarioUsadoHL.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL`
          : '<span style="color:var(--muted);">—</span>';
      // Espacio de almacenamiento: si algún cocimiento del bloque se quedó sin
      // tanque, se dice aquí mismo cuántos, en qué etapa y desde cuándo habrá
      // dónde ponerlo. Solo cuenta el equipo VACÍO; el que tiene producto no
      // está disponible hasta que termine su etapa y pase por aseo.
      const sinEspacio = r.numCocimientos > 0 ? sinEspacioDe(r) : [];
      let espacioHtml;
      if (!r.numCocimientos) {
        espacioHtml = '<span style="color:var(--muted);">—</span>';
      } else if (!sinEspacio.length) {
        espacioHtml =
          '<span style="color:var(--ok);">✓ Hay espacio</span>';
      } else {
        const libres = sinEspacio
          .map((s) => (s.espacioDesde ? s.espacioDesde.getTime() : null))
          .filter(Boolean);
        const etapas = [
          ...new Set(sinEspacio.map((s) => (s.etapa || "").split(" · ")[0])),
        ].join(" y ");
        const hl = sinEspacio.reduce((a, s) => a + (Number(s.volumenHL) || 0), 0);
        const cuando = libres.length
          ? `Habrá espacio desde el ${fmtDateTime(new Date(Math.min(...libres)))}.`
          : "Ningún equipo se libera dentro del horizonte cargado.";
        espacioHtml = `<span style="color:var(--danger); font-weight:650;">⚠️ Sin espacio en ${escapeHtml(etapas)}</span>
          <div style="color:var(--muted); font-size:10.5px; margin-top:2px;">${sinEspacio.length} cocimiento(s) · ${Math.round(hl).toLocaleString("es-CO")} HL sin dónde ir. ${escapeHtml(cuando)}</div>`;
      }
      return `<tr>
      <td>${escapeHtml(r.nombre)}${r.blockLabel ? `<br><span style="color:var(--muted);font-size:10.5px;">${escapeHtml(r.blockLabel)}</span>` : ""}<br>${marcasHtml}</td>
      <td>${r.volumenEnvasar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${invHtml}</td>
      <td>${r.volumenCocinar.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL</td>
      <td>${r.numCocimientos}</td>
      <td>${espacioHtml}</td>
      <td>${startsHtml}</td>
    </tr>`;
    })
    .join("");
  wrap.innerHTML = `<table><thead><tr><th>Mosto</th><th>Volumen a envasar</th><th>Cubierto por inventario</th><th>Volumen a cocinar</th><th>N° Cocimientos</th><th title="Solo cuenta el equipo vacío. Un FV o SV con producto no está disponible hasta que termine su etapa y pase por aseo.">Espacio en tanques</th><th>Inicio de cada cocimiento</th></tr></thead><tbody>${rows}</tbody></table>`;
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
      <td><input type="text" class="cat-input cat-time" data-field="tiempoMaxBBTHoras" value="${formatHMS(m.tiempoMaxBBTHoras)}" placeholder="hh:mm:ss (0 = sin límite)"></td>
      <td class="cat-remove"><button class="btn small" data-remove="${idx}" title="Quitar mosto">✕</button></td>
    </tr>`,
  ).join("");
  wrap.innerHTML = `<table><thead><tr>
      <th>Marca</th><th>Marcas (palabras clave)</th><th>Factor dilución</th><th>Vol. x cocimiento (HL)</th>
      <th>Cargues (hh:mm:ss)</th><th>Cocinas (hh:mm:ss)</th><th>Fermentación (hh:mm:ss)</th><th>Maduración (hh:mm:ss)</th>
      <th title="Tiempo máximo en el BBT (producto terminado) antes de dañarse. Solo Pony (48 h; la programación puede estirarlo hasta 72 h y lo marca en rojo). 0 = sin límite.">Máx. en BBT (hh:mm:ss)</th><th></th>
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
    tiempoMaxBBTHoras: 0,
  });
  renderCatalog();
  renderInventoryBalance(STATE && STATE.plan);
  recompute();
});

renderCatalog();

function renderInventoryBalance(plan) {
  const wrap = document.getElementById("balanceTableWrap");
  if (!wrap) return;

  const totalsByMosto = {};
  if (plan && Array.isArray(plan.results)) {
    plan.results.forEach((r) => {
      const t =
        totalsByMosto[r.mostoId] ||
        (totalsByMosto[r.mostoId] = { envasar: 0, cubierto: 0, cocinar: 0 });
      t.envasar += r.volumenEnvasar;
      t.cubierto += r.inventarioUsadoHL || 0;
      t.cocinar += r.volumenCocinar;
    });
  }

  // ---- Resumen por mosto (se calcula sumando el detalle por lote de abajo) ----
  // plan.results ya trae TODAS las semanas cargadas (si el instructivo trae
  // varias hojas "Semana N" se fusionan en un solo plan, ver parseWorkbook),
  // así que esta suma no es solo de "esta semana": cubre todo lo ingresado.
  const weeksLoaded =
    (STATE && STATE.parsed && STATE.parsed.weeks) || [];
  const alcanceTxt =
    weeksLoaded.length > 1
      ? `${weeksLoaded.length} semanas cargadas: ${weeksLoaded[0].label} (${fmtDate(weeksLoaded[0].start)}) → ${weeksLoaded[weeksLoaded.length - 1].label} (${fmtDate(weeksLoaded[weeksLoaded.length - 1].start)})`
      : weeksLoaded.length === 1
        ? `${weeksLoaded[0].label} (${fmtDate(weeksLoaded[0].start)})`
        : "";
  const disponibleByMosto = inventoryTotalsByMosto(MOSTO_CATALOG);
  const remainingBatches = (plan && plan.remainingInventoryBatches) || {};
  const resumenRows = MOSTO_CATALOG.map((m) => {
    const disponible = disponibleByMosto[m.id] || 0;
    const t = totalsByMosto[m.id] || { envasar: 0, cubierto: 0, cocinar: 0 };
    const sobrante = Math.max(0, disponible - t.cubierto);
    // Todo el inventario cuenta como disponible, esté o no listo ya para
    // envasar. Si aun así sobra inventario Y falta por cocinar, es porque ese
    // HL no puede cubrir la demanda que queda: en Pony, un lote de BBT de una
    // variante (Go / HG) no sirve para la otra.
    let notaHtml = "";
    if (sobrante > 1 && t.cocinar > 1e-6) {
      const lotesSobrantes = (remainingBatches[m.id] || []).filter(
        (l) => l.hL > 1e-6,
      );
      if (lotesSobrantes.length) {
        const variantes = [
          ...new Set(lotesSobrantes.map((l) => l.variante).filter(Boolean)),
        ];
        const motivo = variantes.length
          ? `es de otra variante (${variantes.join(" / ").toUpperCase()}) y no cubre el envasado que falta`
          : `no hay más envasado cargado que lo consuma`;
        notaHtml = `<div style="color:var(--muted); font-size:10.5px; margin-top:2px;">Hay ${Math.round(t.cocinar).toLocaleString("es-CO")} HL por cocinar Y a la vez ${Math.round(sobrante).toLocaleString("es-CO")} HL sobrantes: no se contradicen — ese inventario ${motivo}.</div>`;
      }
    }
    return `<tr>
      <td>${escapeHtml(m.nombre)}</td>
      <td>${Math.round(disponible).toLocaleString("es-CO")} HL</td>
      <td>${Math.round(t.envasar).toLocaleString("es-CO")} HL</td>
      <td>${Math.round(t.cubierto).toLocaleString("es-CO")} HL</td>
      <td>${Math.round(t.cocinar).toLocaleString("es-CO")} HL</td>
      <td>${Math.round(sobrante).toLocaleString("es-CO")} HL${notaHtml}</td>
    </tr>`;
  }).join("");
  const alcanceHtml = alcanceTxt
    ? `<div style="color:var(--muted); font-size:11.5px; margin-bottom:6px;">Balance de ${alcanceTxt} — la suma cubre TODO lo cargado, no solo una semana.</div>`
    : "";
  // Marcas que el Gantt de envasado SÍ pide pero que no homologaron a ningún
  // mosto (texto de marca no reconocido) NUNCA entran a este resumen — con
  // varias semanas fusionadas, una sola fila de un formato/nombre distinto en
  // alguna semana basta para que esa demanda "desaparezca" del balance sin
  // aviso. Se muestra aquí mismo, no solo en la pestaña "Sin homologar".
  const sinHom = (plan && plan.sinHomologar) || [];
  const sinHomTotal = sinHom.reduce((s, b) => s + (Number(b.volumen) || 0), 0);
  const sinHomHtml = sinHom.length
    ? `<div style="border:1px solid rgba(237,28,43,.4); background:rgba(237,28,43,.08); border-radius:4px; padding:8px 14px; margin-bottom:10px; color:var(--danger); font-size:12.5px;">⚠️ ${Math.round(sinHomTotal).toLocaleString("es-CO")} HL pedidos en el Gantt de envasado NO están en este balance porque su marca no homologó a ningún mosto: ${sinHom.map((b) => `${escapeHtml(b.name)} (${Math.round(b.volumen).toLocaleString("es-CO")} HL)`).join(", ")}. Ajusta las palabras clave en el Catálogo de mostos o revisa la pestaña "Sin homologar".</div>`
    : "";
  const resumenHtml = resumenRows
    ? `${alcanceHtml}${sinHomHtml}<table><thead><tr><th>Mosto</th><th>Inventario disponible (HL)</th><th>Volumen a envasar (total cargado)</th><th>Cubierto por inventario</th><th>Pendiente por cocinar</th><th>Inventario sobrante</th></tr></thead><tbody>${resumenRows}</tbody></table>`
    : '<p class="empty-note">Agrega al menos un mosto en el Catálogo de mostos para poder registrar inventario.</p>';

  // ---- Detalle por lote: equipo, marca, días en el equipo y HL normalizados ----
  const catalogById = {};
  MOSTO_CATALOG.forEach((m) => (catalogById[m.id] = m));
  const tankNames = (TANK_CATALOG || []).map((t) => t.equipo).filter(Boolean);

  const TIPOS = ["FV", "SV", "BBT"];
  const detailRows = (INVENTORY_BALANCE || [])
    .map((entry, idx) => {
      const m = catalogById[entry.mostoId];
      const tipo = entry.tipo || ""; // "" = fila antigua sin tipo
      const fermD = m ? (Number(m.tiempoFermentacionHoras) || 0) / 24 : null;
      const madurD = m ? (Number(m.tiempoMaduracionHoras) || 0) / 24 : null;
      let diasReq = null;
      if (m) {
        if (tipo === "FV") diasReq = fermD;
        else if (tipo === "SV") diasReq = madurD;
        else if (tipo === "BBT") diasReq = 0;
        else diasReq = fermD + madurD; // compatibilidad con filas previas
      }
      const dias =
        entry.diasEnEquipo === "" || entry.diasEnEquipo == null
          ? null
          : Math.round(Number(entry.diasEnEquipo) || 0);
      const hLnum = Math.round(Number(entry.hL) || 0);

      // Un equipo con 0 hL y 0 (o ningún) día está vacío → cuenta como
      // disponible ahora mismo para llenarlo con otra cosa.
      const disponibleAhora =
        tipo !== "BBT" &&
        (entry.vacio || (hLnum <= 0 && (dias == null || dias <= 0)));

      // Madurador con levadura guardada (hL sin días registrados): el equipo
      // está ocupado, pero NO es producto en proceso — no cuenta en el
      // inventario disponible ni tiene una fecha de liberación calculable.
      const esLevadura =
        typeof esLevaduraEnMadurador === "function" &&
        esLevaduraEnMadurador(entry);

      // BBT: el tiempo se cuenta en HORAS de almacenamiento (columna "TIEMPO DE
      // ALMACENAMIENTO" de la hoja BBTs) contra el máximo en BBT del catálogo
      // (48 h en Pony; la cerveza no tiene límite).
      const mostoDeLote = MOSTO_CATALOG.find((mm) => mm.id === entry.mostoId);
      const maxBBTh = Number(mostoDeLote && mostoDeLote.tiempoMaxBBTHoras) || 0;
      const horasBBT =
        entry.almacenBBTHoras === "" || entry.almacenBBTHoras == null
          ? null
          : Math.max(0, Number(entry.almacenBBTHoras) || 0);
      const restanBBT =
        tipo === "BBT" && maxBBTh > 0 && horasBBT != null
          ? maxBBTh - horasBBT
          : null;

      // Estado
      let estadoHtml = '<span class="tag warn">Sin datos</span>';
      if (esLevadura) {
        estadoHtml = '<span class="tag warn">Ocupado · levadura (no cuenta en inventario)</span>';
      } else if (disponibleAhora) {
        estadoHtml = '<span class="tag ok">Disponible</span>';
      } else if (tipo === "BBT") {
        if (restanBBT == null) {
          estadoHtml =
            maxBBTh > 0
              ? '<span class="tag warn">Sin tiempo de almacenamiento</span>'
              : '<span class="tag ok">Listo · producto terminado</span>';
        } else if (restanBBT <= 0) {
          estadoHtml = `<span class="tag danger">Vencido en BBT · ${Math.round(horasBBT)} h de ${Math.round(maxBBTh)} h</span>`;
        } else if (restanBBT <= 12) {
          estadoHtml = `<span class="tag warn">Por vencer · quedan ${Math.round(restanBBT)} h</span>`;
        } else {
          estadoHtml = `<span class="tag ok">Listo · quedan ${Math.round(restanBBT)} h</span>`;
        }
      } else if (dias != null && diasReq != null) {
        if (dias >= diasReq) {
          const listoTxt =
            tipo === "FV"
              ? "Listo para madurar"
              : tipo === "SV" || tipo === "SV Pony"
                ? "Listo para diluir"
                : "Listo";
          estadoHtml = `<span class="tag ok">${listoTxt}</span>`;
        } else {
          estadoHtml = `<span class="tag warn">En proceso · faltan ${(diasReq - dias).toFixed(1)} d</span>`;
        }
      }

      // Se libera el equipo: FV al terminar fermentación, SV al terminar
      // maduración. Que la etapa haya terminado NO significa que el tanque
      // esté vacío: sigue con producto hasta que se libere.
      let liberaHtml = "—";
      if (esLevadura) {
        liberaHtml =
          '<span style="color:var(--muted);">Sin fecha · se libera al retirar la levadura del inventario</span>';
      } else if (disponibleAhora) {
        liberaHtml = '<span class="tag ok">Libre ahora</span>';
      } else if (tipo === "BBT") {
        if (restanBBT == null) {
          liberaHtml = '<span class="tag ok">Listo para envase</span>';
        } else {
          // Hora tope para envasarlo antes de pasarse del máximo en BBT.
          const base = getI0Date() || new Date();
          const tope = new Date(base.getTime() + restanBBT * 3600000);
          liberaHtml =
            restanBBT <= 0
              ? `<span style="color:var(--danger);">Debió envasarse ${fmtDateTime(tope)}</span>`
              : `Envasar antes de ${fmtDateTime(tope)}`;
        }
      } else if (dias != null && diasReq != null) {
        const faltanD = Math.max(0, diasReq - dias);
        if (faltanD <= 0) {
          liberaHtml = '<span class="tag ok">Listo para liberar</span>';
        } else {
          const base = getI0Date() || new Date();
          const fecha = new Date(base.getTime() + faltanD * 86400000);
          liberaHtml = `${faltanD.toFixed(1)} d · ${fmtDate(fecha)}`;
        }
      }

      const mostoOpts =
        (!entry.mostoId
          ? `<option value="" selected>${
              entry.marcaTexto
                ? escapeHtml(entry.marcaTexto) + " (sin homologar)"
                : "—"
            }</option>`
          : "") +
        MOSTO_CATALOG.map(
          (mm) =>
            `<option value="${escapeHtml(mm.id)}" ${mm.id === entry.mostoId ? "selected" : ""}>${escapeHtml(mm.nombre)}</option>`,
        ).join("");

      return `<tr data-inv-idx="${idx}">
        <td><input type="text" list="tankEquipoListInv" class="cat-input" data-inv-field="equipo" value="${escapeHtml(entry.equipo || "")}" placeholder="ej: EXT 9 / BBT22"></td>
        <td><select class="cat-input" data-inv-field="tipo" style="width:70px;">${TIPOS.map(
          (t) => `<option value="${t}" ${t === tipo ? "selected" : ""}>${t}</option>`,
        ).join("")}</select></td>
        <td>${
          tipo === "BBT"
            ? // Un BBT es producto TERMINADO: se muestra la MARCA tal cual
              // (Costeñita, Pony Go, Pilsen…), porque solo puede envasarse en
              // la línea de esa marca. Debajo, a qué mosto homologa.
              `<input type="text" class="cat-input" data-inv-field="marcaTexto" value="${escapeHtml(
                entry.marcaTexto || "",
              )}" placeholder="ej: Costeñita / Pony Go" style="width:130px;">
               <div style="color:var(--muted); font-size:10.5px; margin-top:2px;">${
                 entry.mostoId
                   ? escapeHtml(
                       (
                         MOSTO_CATALOG.find((mm) => mm.id === entry.mostoId) ||
                         {}
                       ).nombre || entry.mostoId,
                     )
                   : '<span style="color:var(--danger);">sin homologar</span>'
               }</div>`
            : `<select class="cat-input" data-inv-field="mostoId" title="${escapeHtml(entry.marcaTexto || "")}">${mostoOpts}</select>`
        }</td>
        <td>${
          tipo === "BBT"
            ? // En BBT el tiempo va en HORAS de almacenamiento, no en días.
              `<input type="number" min="0" step="1" class="cat-input" data-inv-field="almacenBBTHoras" value="${
                horasBBT == null ? "" : Math.round(horasBBT)
              }" placeholder="horas" title="Horas que el lote lleva en el BBT (columna TIEMPO DE ALMACENAMIENTO)" style="width:80px;">
               <span style="color:var(--muted); font-size:10.5px;"> h</span>`
            : `<input type="number" min="0" step="1" class="cat-input" data-inv-field="diasEnEquipo" value="${dias == null ? "" : Math.round(dias)}" placeholder="días">`
        }</td>
        <td style="color:var(--muted);">${
          tipo === "BBT"
            ? maxBBTh > 0
              ? `máx. ${Math.round(maxBBTh)} h en BBT`
              : "sin límite"
            : diasReq != null
              ? diasReq.toFixed(1) + " d"
              : "—"
        }</td>
        <td style="color:var(--muted);">${liberaHtml}</td>
        <td><input type="number" min="0" step="1" class="cat-input" data-inv-field="hL" value="${hLnum}"></td>
        <td>${estadoHtml}</td>
        <td><button class="btn small" data-remove-inv="${idx}" title="Quitar lote">✕</button></td>
      </tr>`;
    })
    .join("");

  const detailHtml = `
    <datalist id="tankEquipoListInv">${tankNames.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("")}</datalist>
    <table><thead><tr>
      <th>Equipo / tanque</th><th>Tipo</th><th title="En BBT es la marca terminada (solo sirve para esa línea); en FV/SV es el mosto, que sirve para cualquier marca de ese mosto.">Marca / mosto</th><th title="En BBT son las HORAS de almacenamiento; en FV/SV son los días transcurridos de fermentación/maduración.">Tiempo en el equipo</th><th title="En BBT, el máximo de horas que puede estar el producto terminado; en FV/SV, los días totales de fermentación/maduración.">Límite / tiempo requerido</th><th>Se libera</th><th>HL (normalizados)</th><th>Estado</th><th></th>
    </tr></thead><tbody>${detailRows || `<tr><td colspan="9" class="empty-note">Sin lotes de inventario registrados.</td></tr>`}</tbody></table>
    <div style="margin-top:8px; display:flex; gap:8px;">
      <button class="btn small" id="addInventoryEntryBtn">+ Agregar lote de inventario</button>
      <button class="btn small" id="clearInventoryBtn" ${(INVENTORY_BALANCE || []).length ? "" : "disabled"} style="color:var(--danger);">🗑️ Borrar inventario</button>
    </div>
  `;

  wrap.innerHTML = `
    <div style="margin-bottom:16px;">${resumenHtml}</div>
    <div style="color:var(--muted); font-size:11.5px; margin-bottom:6px;">Detalle por lote — HL ya normalizados (con el factor de dilución aplicado). Los "días en el equipo" son los días transcurridos de fermentación/maduración de ese lote; se comparan contra el total configurado en el catálogo de ese mosto.</div>
    ${detailHtml}
  `;

  wrap.querySelectorAll("[data-inv-field]").forEach((inp) => {
    inp.addEventListener("change", (e) => {
      const idx = +e.target.closest("tr").dataset.invIdx;
      const field = e.target.dataset.invField;
      let val = e.target.value;
      if (field === "diasEnEquipo" || field === "almacenBBTHoras") {
        val = val === "" ? "" : Math.max(0, Math.round(parseFloat(val) || 0));
        if (field === "almacenBBTHoras" && val === "") val = null;
      } else if (field === "hL") {
        val = Math.max(0, Math.round(parseFloat(val) || 0));
      }
      INVENTORY_BALANCE[idx][field] = val;
      if (field === "hL" || field === "diasEnEquipo") {
        // dejó de estar vacío si le ponen producto/días manualmente
        INVENTORY_BALANCE[idx].vacio = false;
      }
      if (field === "marcaTexto") {
        // En un BBT la marca manda: se rehomologa el mosto a partir de ella.
        INVENTORY_BALANCE[idx].mostoId =
          matchMosto(val, MOSTO_CATALOG) || "";
        INVENTORY_BALANCE[idx].vacio = !String(val || "").trim();
      }
      saveInventoryBalance();
      // El tipo, el mosto y los hL/días cambian las columnas derivadas
      // (días requeridos, "se libera", estado) y la ocupación de equipos.
      if (field !== "equipo") {
        renderInventoryBalance(STATE && STATE.plan);
        if (typeof renderTankCatalog === "function") renderTankCatalog();
      if (typeof renderYeastConfig === "function") renderYeastConfig();
      }
      if (typeof recomputeFiltracion === "function") recomputeFiltracion();
      recompute();
    });
  });
  wrap.querySelectorAll("[data-remove-inv]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      INVENTORY_BALANCE.splice(+e.currentTarget.dataset.removeInv, 1);
      saveInventoryBalance();
      renderInventoryBalance(STATE && STATE.plan);
      if (typeof renderTankCatalog === "function") renderTankCatalog();
      if (typeof renderYeastConfig === "function") renderYeastConfig();
      if (typeof recomputeFiltracion === "function") recomputeFiltracion();
      recompute();
    });
  });
  const addBtn = document.getElementById("addInventoryEntryBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      INVENTORY_BALANCE.push({
        id: "inv_" + Date.now(),
        equipo: "",
        mostoId: MOSTO_CATALOG[0] ? MOSTO_CATALOG[0].id : "",
        tipo: "FV",
        diasEnEquipo: "",
        hL: 0,
        vacio: false,
      });
      saveInventoryBalance();
      renderInventoryBalance(STATE && STATE.plan);
      if (typeof renderTankCatalog === "function") renderTankCatalog();
      if (typeof renderYeastConfig === "function") renderYeastConfig();
      if (typeof recomputeFiltracion === "function") recomputeFiltracion();
      recompute();
    });
  }
  const clearBtn = document.getElementById("clearInventoryBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (!INVENTORY_BALANCE.length) return;
      if (
        !confirm(
          `¿Borrar los ${INVENTORY_BALANCE.length} lote(s) de inventario (marcas y HL) cargados? Esta acción no se puede deshacer.`,
        )
      )
        return;
      INVENTORY_BALANCE.length = 0;
      saveInventoryBalance();
      renderInventoryBalance(STATE && STATE.plan);
      if (typeof renderTankCatalog === "function") renderTankCatalog();
      if (typeof renderYeastConfig === "function") renderYeastConfig();
      if (typeof recomputeFiltracion === "function") recomputeFiltracion();
      recompute();
    });
  }
}
renderInventoryBalance(STATE && STATE.plan);

// ---- Carga del Excel "Producto en Proceso" (.xlsm) ----------------------
// Reemplaza TODO el inventario con lo que traiga el archivo (hojas "Reporte"
// y "BBTs"): equipo, tipo (FV/SV/BBT), marca homologada a mosto, días en el
// equipo y HL diluidos. Los BBTs entran como producto terminado (sin días).
(function initProductoEnProcesoUpload() {
  const input = document.getElementById("ppFileInput");
  const status = document.getElementById("ppStatus");
  const dropZone = document.getElementById("ppDropZone");
  if (!input) return;
  function procesarPP(file) {
    if (!file) return;
    if (status) {
      status.style.color = "var(--muted)";
      status.textContent = "Leyendo " + file.name + "…";
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), {
          type: "array",
          cellDates: true,
        });
        const filas = parseProductoEnProceso(wb);
        if (!filas.length)
          throw new Error(
            'No se encontraron equipos con producto en las hojas "Reporte" y "BBTs".',
          );
        INVENTORY_BALANCE = filas.map((p, i) => ({
          id: "inv_pp_" + Date.now() + "_" + i,
          equipo: p.equipo,
          mostoId: p.vacio ? "" : matchMosto(p.marcaTexto, MOSTO_CATALOG) || "",
          marcaTexto: p.marcaTexto,
          vacio: !!p.vacio,
          tipo: p.tipo,
          diasEnEquipo:
            p.tipo === "BBT" || p.diasEnEquipo == null
              ? ""
              : Math.max(0, Math.round(Number(p.diasEnEquipo) || 0)),
          hL: Math.max(0, Math.round(Number(p.hL) || 0)),
          almacenBBTHoras:
            p.tipo === "BBT" && p.almacenBBTHoras != null
              ? Math.max(0, Number(p.almacenBBTHoras) || 0)
              : null,
        }));
        saveInventoryBalance();
        renderInventoryBalance(STATE && STATE.plan);
        if (typeof renderTankCatalog === "function") renderTankCatalog();
      if (typeof renderYeastConfig === "function") renderYeastConfig();
        if (typeof recomputeFiltracion === "function") recomputeFiltracion();
        if (typeof recompute === "function") recompute();
        if (status) {
          status.style.color = "var(--ok)";
          const nBBT = filas.filter((x) => x.tipo === "BBT").length;
          const nVac = filas.filter((x) => x.vacio).length;
          status.textContent = `✓ ${filas.length} equipos (${filas.length - nBBT - nVac} con producto + ${nVac} disponibles + ${nBBT} BBT) desde ${file.name}`;
        }
      } catch (err) {
        console.error(err);
        if (status) {
          status.style.color = "var(--danger)";
          status.textContent = "Error: " + err.message;
        }
      }
      input.value = "";
    };
    reader.onerror = () => {
      if (status) {
        status.style.color = "var(--danger)";
        status.textContent = "No se pudo leer el archivo.";
      }
    };
    reader.readAsArrayBuffer(file);
  }
  input.addEventListener("change", (e) => {
    procesarPP(e.target.files[0]);
    e.target.value = "";
  });
  if (dropZone) {
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
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) procesarPP(f);
    });
  }
})();

function renderYeastConfig() {
  const wrap = document.getElementById("yeastConfigWrap");
  const summary = document.getElementById("yeastSummaryWrap");
  if (!wrap) return;
  const rows = (YEAST_AVAILABILITY || [])
    .map((y, idx) => {
      const d = y.disponibleDesde ? new Date(y.disponibleDesde) : null;
      return `<tr data-yeast-idx="${idx}">
            <td><select class="cat-input" data-yeast-field="mostoId">${MOSTO_CATALOG.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === y.mostoId ? "selected" : ""}>${escapeHtml(m.nombre)}</option>`).join("")}</select></td>
            <td><input type="text" class="cat-input" data-yeast-field="origen" value="${escapeHtml(y.origen || "")}" placeholder="Tanque / fuente"></td>
            <td><input type="datetime-local" class="cat-input" data-yeast-field="disponibleDesde" value="${d && !isNaN(d) ? toInputDateTimeUTC(d) : ""}"></td>
            <td style="text-align:center"><input type="checkbox" data-yeast-field="disponible" ${y.disponible !== false ? "checked" : ""} style="width:17px;height:17px"></td>
            <td><span class="tag ${y.mostoId === "light" ? "ok" : "warn"}">${y.mostoId === "light" ? "Solo Light + marcas generales" : "Marcas no Light"}</span></td>
            <td><button class="btn small" data-remove-yeast="${idx}">✕</button></td>
          </tr>`;
    })
    .join("");
  wrap.innerHTML = rows
    ? `<table><thead><tr><th>Marca cosechada</th><th>Tanque / fuente</th><th>Disponible desde</th><th>Disponible</th><th>Compatibilidad</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty-note">No hay cosechas registradas. Sin una disponibilidad Light, los bloques Light quedarán bloqueados.</p>';
  // ---- Cosechas previstas (calculadas): inventario + bloques programados ----
  const cosechas =
    typeof computedYeastHarvests === "function"
      ? computedYeastHarvests(STATE && STATE.seq && STATE.seq.tankAssignment)
      : [];
  const cosWrap = document.getElementById("yeastCosechasWrap");
  if (cosWrap) {
    if (!cosechas.length) {
      cosWrap.innerHTML =
        '<p class="empty-note">Sin cosechas calculables. Carga el inventario de producto en proceso y/o el plan para ver cuándo estará lista cada levadura.</p>';
    } else {
      const cosRows = cosechas
        .map(
          (c) => `<tr>
            <td>${escapeHtml((MOSTO_CATALOG.find((m) => m.id === c.mostoId) || {}).nombre || c.mostoId)}</td>
            <td><span class="tag ${c.tipo === "light" ? "ok" : "warn"}">${c.tipo === "light" ? "Light" : "General"}</span></td>
            <td>${escapeHtml(c.fuente)}</td>
            <td>${fmtDateTime(c.fechaDisponible)}</td>
          </tr>`,
        )
        .join("");
      cosWrap.innerHTML = `<table><thead><tr><th>Levadura (mosto)</th><th>Tipo</th><th>Fuente</th><th>Disponible desde</th></tr></thead><tbody>${cosRows}</tbody></table>
        <div class="hint" style="margin-top:6px;">Solo de fermentadores EXT, a ${YEAST_HARVEST_DAYS} días.</div>`;
    }
  }

  // Próxima disponibilidad Light = mín. entre lo registrado a mano y lo calculado.
  const lightManual = (YEAST_AVAILABILITY || [])
    .filter(
      (y) =>
        y.mostoId === "light" &&
        y.disponible !== false &&
        yeastAvailableDate(y),
    )
    .map((y) => yeastAvailableDate(y));
  const lightCalc = cosechas
    .filter((c) => c.tipo === "light")
    .map((c) => c.fechaDisponible);
  const proxLight = [...lightManual, ...lightCalc].sort((a, b) => a - b)[0];
  if (summary)
    summary.innerHTML = proxLight
      ? `<div style="border:1px solid rgba(76,175,130,.35);background:rgba(76,175,130,.08);padding:10px 14px;border-radius:4px;color:var(--ok)"><b>✓ Habrá levadura Light.</b> Próxima disponibilidad: ${fmtDateTime(proxLight)}${lightManual.length ? "" : " (cosecha calculada)"}.</div>`
      : '<div style="border:1px solid rgba(237,28,43,.35);background:rgba(237,28,43,.08);padding:10px 14px;border-radius:4px;color:var(--danger)"><b>⚠ No hay levadura Light disponible ni cosechas Light previstas.</b> Los bloques Light no podrán programarse.</div>';
  // Re-render + recálculo DIFERIDOS: si se reemplaza la tabla dentro del propio
  // evento (change dispara al hacer blur del campo), el navegador lanza
  // NotFoundError al setear innerHTML sobre un nodo que aún está en el blur, y
  // el recompute() nunca corría → "no se actualiza al poner una levadura".
  const aplicarCambioLevadura = () => {
    saveYeastAvailability();
    setTimeout(() => {
      try {
        recompute(); // recompute() ya re-renderiza la config de levadura
      } catch (_) {}
      try {
        renderYeastConfig();
      } catch (_) {}
    }, 0);
  };
  wrap.querySelectorAll("[data-yeast-field]").forEach((inp) =>
    inp.addEventListener("change", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      const idx = +tr.dataset.yeastIdx;
      const field = e.target.dataset.yeastField;
      if (!YEAST_AVAILABILITY[idx] || !field) return;
      YEAST_AVAILABILITY[idx][field] =
        field === "disponible" ? !!e.target.checked : e.target.value;
      aplicarCambioLevadura();
    }),
  );
  wrap.querySelectorAll("[data-remove-yeast]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      YEAST_AVAILABILITY.splice(+e.currentTarget.dataset.removeYeast, 1);
      aplicarCambioLevadura();
    }),
  );
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
  if (alert)
    alert.innerHTML = blocked.length
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
  setTimeout(() => recompute(), 0);
});
renderYeastConfig();
function renderTankCatalog() {
  const wrap = document.getElementById("tankTableWrap");
  if (!wrap) return;
  const occ =
    typeof inventoryOccupancyByEquipo === "function"
      ? inventoryOccupancyByEquipo()
      : {};
  const invByEq =
    typeof inventoryEntryByEquipo === "function" ? inventoryEntryByEquipo() : {};
  const hayInventario = (INVENTORY_BALANCE || []).length > 0;
  const mostoNombre = (id) =>
    (MOSTO_CATALOG.find((mm) => mm.id === id) || {}).nombre || id || "";
  const muted = (txt) =>
    `<span style="color:var(--muted);">${escapeHtml(txt)}</span>`;
  // Si el inventario no dice que un equipo esté ocupado, se considera DISPONIBLE
  // (sin dato = disponible), tanto si no se ha cargado inventario como si ese
  // equipo no aparece en él.
  const ocupacionCell = (t) => {
    const tipo = t.tipo;
    const esTanque =
      tipo === "FV" || tipo === "SV" || tipo === "SV Pony" || tipo === "BBT";
    if (!esTanque) return muted("—"); // "Equipo" u otros: no aplica
    const disponible = '<span class="tag ok">Disponible</span>';
    if (!hayInventario) return disponible;

    const key = normalizeText(t.equipo || "");

    if (tipo === "BBT") {
      const e = invByEq[key];
      const hL = e ? Math.round(Number(e.hL) || 0) : 0;
      if (hL > 0) {
        const prod = (e && (e.marcaTexto || mostoNombre(e.mostoId))) || "";
        return `<span class="tag warn">Ocupado${prod ? " · " + escapeHtml(prod) : ""} · ${hL.toLocaleString("es-CO")} HL</span>`;
      }
      return disponible;
    }

    // FV / SV / SV Pony
    const o = occ[key];
    if (!o || o.vacio) return disponible; // vacío o sin dato = disponible
    const mn = o.mostoId ? " · " + escapeHtml(mostoNombre(o.mostoId)) : "";
    // Terminó la etapa pero el producto sigue en el tanque: se puede liberar,
    // no está disponible todavía.
    if (o.faltanDias <= 0)
      return `<span class="tag ok">Listo para liberar${mn}</span>`;
    return `<span class="tag warn">Ocupado${mn} · libre ${fmtDate(o.fecha)}</span>`;
  };
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
    <td style="font-family:var(--sans);">${ocupacionCell(t)}</td>
    <td><button class="btn small" data-remove-tank="${idx}" title="Quitar equipo">✕</button></td>
  </tr>`,
  ).join("");
  wrap.innerHTML = `<table><thead><tr><th>Equipo</th><th>Tipo</th><th>Agua promedio</th><th>Capacidad (HL)</th><th>Índice agua/cap.</th><th>Prioridad</th><th>Aseo después de liberar</th><th>Disponible</th><th>Ocupación (inventario)</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
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
      if (typeof recomputeFiltracion === "function") recomputeFiltracion();
      recompute();
    }),
  );
  wrap.querySelectorAll("[data-remove-tank]").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      TANK_CATALOG.splice(+e.currentTarget.dataset.removeTank, 1);
      renderTankCatalog();
      if (typeof recomputeFiltracion === "function") recomputeFiltracion();
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
const aseoPeriodicoMinInput = document.getElementById("aseoPeriodicoMinInput");
const aseoPeriodicoMaxInput = document.getElementById("aseoPeriodicoMaxInput");
const aseoPeriodicoActivoInput = document.getElementById(
  "aseoPeriodicoActivoInput",
);

aseoPeriodicoTiempoInput.value = formatHMS(ASEO_PERIODICO.duracionHoras);
aseoPeriodicoMinInput.value = ASEO_PERIODICO.cocimientosMin;
aseoPeriodicoMaxInput.value = ASEO_PERIODICO.cocimientosMax;
aseoPeriodicoActivoInput.checked = ASEO_PERIODICO.activo;

aseoPeriodicoTiempoInput.addEventListener("change", () => {
  ASEO_PERIODICO.duracionHoras = parseHMS(aseoPeriodicoTiempoInput.value);
  aseoPeriodicoTiempoInput.value = formatHMS(ASEO_PERIODICO.duracionHoras);
  recompute();
});
// El máximo nunca puede quedar por debajo del mínimo: si se baja, arrastra al otro.
aseoPeriodicoMinInput.addEventListener("change", () => {
  ASEO_PERIODICO.cocimientosMin = Math.max(
    1,
    parseInt(aseoPeriodicoMinInput.value) || 1,
  );
  ASEO_PERIODICO.cocimientosMax = Math.max(
    ASEO_PERIODICO.cocimientosMin,
    ASEO_PERIODICO.cocimientosMax,
  );
  aseoPeriodicoMinInput.value = ASEO_PERIODICO.cocimientosMin;
  aseoPeriodicoMaxInput.value = ASEO_PERIODICO.cocimientosMax;
  recompute();
});
aseoPeriodicoMaxInput.addEventListener("change", () => {
  ASEO_PERIODICO.cocimientosMax = Math.max(
    1,
    parseInt(aseoPeriodicoMaxInput.value) || 1,
  );
  ASEO_PERIODICO.cocimientosMin = Math.min(
    ASEO_PERIODICO.cocimientosMin,
    ASEO_PERIODICO.cocimientosMax,
  );
  aseoPeriodicoMinInput.value = ASEO_PERIODICO.cocimientosMin;
  aseoPeriodicoMaxInput.value = ASEO_PERIODICO.cocimientosMax;
  recompute();
});
aseoPeriodicoActivoInput.addEventListener("change", () => {
  ASEO_PERIODICO.activo = aseoPeriodicoActivoInput.checked;
  recompute();
});

// ---- Botón "Refrescar análisis": vuelve a calcular todo con los valores editados actuales ----
// Lee de vuelta TODOS los campos editables de los catálogos hacia el modelo en
// memoria (sin depender de que haya saltado el evento "change" de cada input) y
// recalcula. Así, aunque el usuario haya escrito en una celda y no haya salido
// de ella, "Refrescar análisis" aplica de verdad lo que se ve en pantalla.
function commitCatalogInputsFromDOM() {
  const numOr = (v, d) => {
    const n = Number(v);
    return isFinite(n) ? n : d;
  };
  // tabla genérica: tr[data-idx] con .cat-input[data-field] → MODEL[idx][field]
  const commitTable = (wrapId, model, fieldAttr) => {
    const wrap = document.getElementById(wrapId);
    if (!wrap || !Array.isArray(model)) return;
    wrap.querySelectorAll("tr[data-idx]").forEach((tr) => {
      const idx = +tr.dataset.idx;
      if (!model[idx]) return;
      tr.querySelectorAll("[" + fieldAttr + "]").forEach((inp) => {
        const field = inp.getAttribute(fieldAttr);
        let val = inp.type === "checkbox" ? inp.checked : inp.value;
        if (inp.classList.contains("cat-time")) val = parseHMS(inp.value);
        else if (inp.type === "number")
          val = inp.value === "" ? "" : numOr(inp.value, model[idx][field]);
        model[idx][field] = val;
      });
    });
  };
  commitTable("catalogTableWrap", MOSTO_CATALOG, "data-field");
  commitTable("aseoTableWrap", ASEO_MATRIX, "data-field");
  // Disponibilidad de levadura registrada a mano (tr[data-yeast-idx]).
  if (typeof YEAST_AVAILABILITY !== "undefined") {
    const yw = document.getElementById("yeastConfigWrap");
    if (yw) {
      yw.querySelectorAll("tr[data-yeast-idx]").forEach((tr) => {
        const idx = +tr.dataset.yeastIdx;
        if (!YEAST_AVAILABILITY[idx]) return;
        tr.querySelectorAll("[data-yeast-field]").forEach((inp) => {
          const field = inp.dataset.yeastField;
          YEAST_AVAILABILITY[idx][field] =
            inp.type === "checkbox" ? inp.checked : inp.value;
        });
      });
      if (typeof saveYeastAvailability === "function") saveYeastAvailability();
    }
  }
  if (typeof TANK_CATALOG !== "undefined")
    commitTable("tankTableWrap", TANK_CATALOG, "data-field");
  if (typeof INVENTORY_BALANCE !== "undefined") {
    commitTable("balanceTableWrap", INVENTORY_BALANCE, "data-inv-field");
    if (typeof saveInventoryBalance === "function") saveInventoryBalance();
  }
  // Inputs sueltos de aseos.
  const aseoDef = document.getElementById("aseoDefaultInput");
  if (aseoDef) ASEO_DEFAULT_HORAS = parseHMS(aseoDef.value);
  const apT = document.getElementById("aseoPeriodicoTiempoInput");
  const apMin = document.getElementById("aseoPeriodicoMinInput");
  const apMax = document.getElementById("aseoPeriodicoMaxInput");
  const apA = document.getElementById("aseoPeriodicoActivoInput");
  if (apT) ASEO_PERIODICO.duracionHoras = parseHMS(apT.value);
  if (apMin)
    ASEO_PERIODICO.cocimientosMin = Math.max(1, parseInt(apMin.value, 10) || 1);
  if (apMax)
    ASEO_PERIODICO.cocimientosMax = Math.max(
      ASEO_PERIODICO.cocimientosMin,
      parseInt(apMax.value, 10) || 1,
    );
  if (apA) ASEO_PERIODICO.activo = apA.checked;
}

document.getElementById("refreshAnalysisBtn").addEventListener("click", () => {
  const btn = document.getElementById("refreshAnalysisBtn");
  const original = btn.textContent;
  const active = document.activeElement;
  if (active && active !== btn && typeof active.blur === "function")
    active.blur();
  commitCatalogInputsFromDOM();
  // Re-render de los catálogos para que muestren los valores ya normalizados.
  if (typeof renderCatalog === "function") renderCatalog();
  if (typeof renderAseoCatalog === "function") renderAseoCatalog();
  if (typeof renderTankCatalog === "function") renderTankCatalog();
  recompute();
  btn.textContent = "✓ Análisis actualizado";
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
});

