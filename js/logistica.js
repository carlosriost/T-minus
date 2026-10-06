/* =========================================================================
   ACUERDOS DE SERVICIO — LOGÍSTICA (envasado y filtración)
   -------------------------------------------------------------------------
   Complementa los acuerdos de Elaboración/Utilities (acuerdos.js), que se
   miden sobre la programación de cocinas. Estos se miden sobre el PLAN DE
   ENVASADO cargado (y el plan de filtración, si se llenó):
     L1. No planificar marcas Light al inicio de la semana en una línea.
     L2. No iniciar la semana de una línea con malta (Pony).
     L3. Corridas de línea de más de N hL (por defecto 50.000 hL).
     L4. Máximo N cambios de formato por línea y semana (por defecto 2).
     L5. Corridas en filtro de más de N hL entre CIP (por defecto 1.200.000 hL).
   Ponderaciones y umbrales son criterio de negocio: se editan en la página y
   quedan guardados en este navegador. Mismo cálculo de score que acuerdos.js:
   puntaje = ponderación × cumplimiento, normalizado sobre lo medible.
   ========================================================================= */

const LOG_LS_KEY = "planAcuerdosLogistica";
const LOG_DEFECTO = {
  pond: { L1: 15, L2: 10, L3: 30, L4: 20, L5: 25 },
  umbralLineaHL: 50000,
  maxCambiosFormato: 2,
  umbralFiltroHL: 1200000,
};

function configLogistica() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(LOG_LS_KEY) || "null");
  } catch (_) {}
  const c = JSON.parse(JSON.stringify(LOG_DEFECTO));
  if (g && typeof g === "object") {
    if (g.pond) Object.keys(c.pond).forEach((k) => {
      const v = Number(g.pond[k]);
      if (isFinite(v) && v >= 0) c.pond[k] = v;
    });
    ["umbralLineaHL", "maxCambiosFormato", "umbralFiltroHL"].forEach((k) => {
      const v = Number(g[k]);
      if (isFinite(v) && v >= 0) c[k] = v;
    });
  }
  return c;
}
function guardarConfigLogistica(c) {
  try {
    localStorage.setItem(LOG_LS_KEY, JSON.stringify(c));
  } catch (_) {}
}

// Primer bloque de producción de cada línea en cada semana, y el detalle de
// cada línea-semana (bloques en orden). Base de L1, L2 y L4.
function lineasSemanas() {
  const semanas = semanasDelPlan();
  const prod = bloquesProduccion();
  const out = [];
  TRAINS.forEach((tr) =>
    semanas.forEach((w, si) => {
      const bs = prod.filter((b) => b.tren === tr && b.semana === si);
      if (bs.length) out.push({ tren: tr, semana: si, semanaLabel: w.label, bloques: bs });
    }),
  );
  return out;
}

// Corridas de una línea: producción seguida del mismo mosto (los cambios DPA o
// paros entre bloques del mismo mosto no cortan la corrida).
function corridasDeLinea(tr) {
  const bs = bloquesProduccion().filter((b) => b.tren === tr);
  const out = [];
  bs.forEach((b) => {
    const prev = out[out.length - 1];
    if (prev && prev.familia === b.familia) {
      prev.hl += b.hl;
      prev.end = b.end;
      prev.bloques++;
    } else out.push({ tren: tr, familia: b.familia, hl: b.hl, start: b.start, end: b.end, bloques: 1, semana: b.semana });
  });
  return out;
}

// Corridas de filtración entre CIP, por filtro, según el Gantt de filtración.
function corridasDeFiltro() {
  if (typeof buildFiltracionPlanes !== "function") return null;
  let planes;
  try {
    planes = buildFiltracionPlanes();
  } catch (_) {
    return null;
  }
  if (!planes || !planes.porFiltro) return null;
  const out = [];
  Object.keys(planes.porFiltro).forEach((f) => {
    const p = planes.porFiltro[f];
    if (!p || !p.ok) return;
    let actual = null;
    (p.segments || []).forEach((s) => {
      if (s.tipo === "fil") {
        actual = actual || { filtro: f, hl: 0, cerrada: false };
        actual.hl += Number(s.hl) || 0;
      } else if (s.tipo === "cip" && actual) {
        actual.cerrada = true;
        out.push(actual);
        actual = null;
      }
    });
    if (actual) out.push(actual);
  });
  return out.length ? out : null;
}

// Hallazgos por línea y semana (los usa T-Minus y Recomendaciones).
function hallazgosLogistica() {
  if (!STATE || !STATE.mergedByTrain) return [];
  const cfg = configLogistica();
  const out = [];
  lineasSemanas().forEach((ls) => {
    const primero = ls.bloques[0];
    if (esFamiliaLight(primero.familiaId))
      out.push({ acuerdo: "L1", tren: ls.tren, semana: ls.semana, grave: false, texto: `${ls.semanaLabel} arranca con Light (${primero.nombre}).` });
    if (esFamiliaPony(primero.familiaId))
      out.push({ acuerdo: "L2", tren: ls.tren, semana: ls.semana, grave: false, texto: `${ls.semanaLabel} arranca con malta (${primero.nombre}).` });
    let cambios = 0;
    for (let i = 1; i < ls.bloques.length; i++) if (ls.bloques[i].formato !== ls.bloques[i - 1].formato) cambios++;
    ls.cambios = cambios;
    if (cambios > cfg.maxCambiosFormato)
      out.push({
        acuerdo: "L4",
        tren: ls.tren,
        semana: ls.semana,
        grave: cambios - cfg.maxCambiosFormato >= 2,
        texto: `${cambios} cambios de formato en ${ls.semanaLabel} (máximo ${cfg.maxCambiosFormato}).`,
      });
  });
  return out;
}

function evaluarAcuerdosLogistica() {
  const cfg = configLogistica();
  const ls = lineasSemanas();
  const medido = {};

  // L1 y L2: línea-semanas que NO arrancan con Light / malta.
  if (ls.length) {
    const conLight = ls.filter((x) => esFamiliaLight(x.bloques[0].familiaId));
    const conPony = ls.filter((x) => esFamiliaPony(x.bloques[0].familiaId));
    medido.L1 = {
      cumplimiento: Math.round(((ls.length - conLight.length) / ls.length) * 100),
      medida: `${conLight.length} de ${ls.length} línea-semanas`,
      detalle: conLight.length
        ? `Arrancan con Light: ${conLight.map((x) => `TREN-${x.tren} (${x.semanaLabel})`).join(", ")}.`
        : "Ninguna línea arranca la semana con Light.",
    };
    medido.L2 = {
      cumplimiento: Math.round(((ls.length - conPony.length) / ls.length) * 100),
      medida: `${conPony.length} de ${ls.length} línea-semanas`,
      detalle: conPony.length
        ? `Arrancan con malta: ${conPony.map((x) => `TREN-${x.tren} (${x.semanaLabel})`).join(", ")}.`
        : "Ninguna línea arranca la semana con malta.",
    };
  }

  // L3: corridas de línea sobre el umbral, ponderadas por volumen.
  const corridas = TRAINS.flatMap((t) => corridasDeLinea(t));
  const totalHL = corridas.reduce((a, c) => a + c.hl, 0);
  if (totalHL > 0) {
    const largas = corridas.filter((c) => c.hl >= cfg.umbralLineaHL);
    const hlLargas = largas.reduce((a, c) => a + c.hl, 0);
    const mayor = corridas.reduce((m, c) => (c.hl > m.hl ? c : m), corridas[0]);
    medido.L3 = {
      cumplimiento: Math.round((hlLargas / totalHL) * 100),
      medida: `${largas.length} de ${corridas.length} corridas`,
      detalle: `${MOD_NF((hlLargas / totalHL) * 100)}% del volumen va en corridas de ${MOD_NF(cfg.umbralLineaHL)} hL o más. La más larga: ${mayor.familia} en TREN-${mayor.tren}, ${MOD_NF(mayor.hl)} hL.`,
    };
  }

  // L4: cambios de formato por línea-semana.
  if (ls.length) {
    let suma = 0;
    const exceden = [];
    ls.forEach((x) => {
      let cambios = 0;
      for (let i = 1; i < x.bloques.length; i++) if (x.bloques[i].formato !== x.bloques[i - 1].formato) cambios++;
      const exceso = Math.max(0, cambios - cfg.maxCambiosFormato);
      suma += Math.max(0, 100 - exceso * 25);
      if (exceso) exceden.push(`TREN-${x.tren} ${x.semanaLabel}: ${cambios}`);
    });
    medido.L4 = {
      cumplimiento: Math.round(suma / ls.length),
      medida: `${exceden.length} de ${ls.length} línea-semanas exceden`,
      detalle: exceden.length
        ? `Más de ${cfg.maxCambiosFormato} cambios de formato — ${exceden.join("; ")}. Cada cambio de más resta 25 puntos a esa línea-semana.`
        : `Todas las líneas quedan en ${cfg.maxCambiosFormato} cambios de formato o menos por semana.`,
    };
  }

  // L5: corridas de filtro entre CIP (solo si hay plan de filtración).
  const cf = corridasDeFiltro();
  if (cf) {
    const total = cf.reduce((a, c) => a + c.hl, 0);
    const cuentan = cf.filter((c) => c.cerrada || c.hl >= cfg.umbralFiltroHL);
    const totalCuentan = cuentan.reduce((a, c) => a + c.hl, 0);
    const ok = cuentan.filter((c) => c.hl >= cfg.umbralFiltroHL).reduce((a, c) => a + c.hl, 0);
    medido.L5 = cuentan.length
      ? {
          cumplimiento: Math.round((ok / totalCuentan) * 100),
          medida: `${cuentan.filter((c) => c.hl >= cfg.umbralFiltroHL).length} de ${cuentan.length} corridas`,
          detalle: `Corridas cerradas por CIP: ${cuentan.map((c) => `${c.filtro} ${MOD_NF(c.hl)} hL`).join("; ")}.`,
        }
      : {
          cumplimiento: null,
          medida: `${MOD_NF(total)} hL en curso`,
          detalle: "La filtración programada aún no cierra ninguna corrida con CIP: no se puede medir todavía.",
        };
  }

  const DEF = [
    { id: "L1", texto: "No planificar marcas Light al inicio de la semana" },
    { id: "L2", texto: "No iniciar la semana con malta (Pony)" },
    { id: "L3", texto: `Hacer corridas de líneas de más de ${MOD_NF(cfg.umbralLineaHL)} hL` },
    { id: "L4", texto: `Máximo ${cfg.maxCambiosFormato} cambios de formato por línea y semana` },
    { id: "L5", texto: `Corridas en filtro de más de ${MOD_NF(cfg.umbralFiltroHL)} hL` },
  ];
  const filas = DEF.map((d) => {
    const e = medido[d.id];
    const medible = !!e && e.cumplimiento != null;
    const ponderacion = medible ? Number(cfg.pond[d.id]) || 0 : 0;
    const cumplimiento = medible ? e.cumplimiento : null;
    return {
      id: d.id,
      texto: d.texto,
      medible,
      ponderacion,
      pondConfig: Number(cfg.pond[d.id]) || 0,
      cumplimiento,
      puntaje: medible ? (ponderacion * cumplimiento) / 100 : 0,
      estado: !medible ? "sin-datos" : cumplimiento >= 90 ? "cumple" : cumplimiento >= 60 ? "parcial" : "critico",
      medida: e ? e.medida : "—",
      detalle: e
        ? e.detalle
        : d.id === "L5"
          ? "Llena el Gantt de filtración (flujo, I0 y secuencia) para medir este acuerdo."
          : "Carga el plan de envasado para medir este acuerdo.",
    };
  });
  const medibles = filas.filter((f) => f.medible);
  const pondTotal = medibles.reduce((a, f) => a + f.ponderacion, 0);
  const puntajeTotal = medibles.reduce((a, f) => a + f.puntaje, 0);
  return {
    filas,
    medibles,
    sinDatos: filas.filter((f) => !f.medible),
    pondTotal,
    puntajeTotal,
    score: pondTotal > 0 ? (puntajeTotal / pondTotal) * 100 : null,
    cumplidos: medibles.filter((f) => f.estado === "cumple").length,
    parciales: medibles.filter((f) => f.estado === "parcial").length,
    criticos: medibles.filter((f) => f.estado === "critico").length,
    cfg,
  };
}

function colorScore(score) {
  return score == null ? "var(--muted)" : score >= 90 ? "var(--ok)" : score >= 60 ? "var(--warn)" : "var(--danger)";
}

function renderAcuerdosLogistica() {
  const cont = document.getElementById("logisticaPanel");
  if (!cont) return;
  if (!STATE || !STATE.mergedByTrain) return modSinDatos(cont, "los acuerdos de logística");
  const ev = evaluarAcuerdosLogistica();
  const score = ev.score == null ? null : Math.round(ev.score);
  const col = colorScore(score);
  const nMed = ev.medibles.length;
  const EST = typeof ACUERDOS_ESTADO !== "undefined" ? ACUERDOS_ESTADO : {};

  const kpis =
    modKpi("◎", "Score de logística", score == null ? "—" : `${score} <small>/ 100</small>`, "Envasado y filtración", col) +
    modKpi("✓", "Acuerdos cumplidos", `${ev.cumplidos} <small>de ${nMed}</small>`, nMed ? `${Math.round((ev.cumplidos / nMed) * 100)}% de los medibles` : "—", "var(--ok)") +
    modKpi("⚠", "Críticos", String(ev.criticos), nMed ? `${Math.round((ev.criticos / nMed) * 100)}% de los medibles` : "—", ev.criticos ? "var(--danger)" : "var(--muted)") +
    modKpi("▤", "Sin datos para medir", String(ev.sinDatos.length), `de ${ev.filas.length} acuerdos`, "var(--muted)");

  const filasHtml = ev.filas
    .map((f) => {
      const e = EST[f.estado] || { txt: f.estado, color: "var(--muted)", icono: "" };
      return `<tr title="${escapeHtml(f.texto)}"><td class="acu-nom"><b>${f.id}.</b> ${escapeHtml(f.texto)}<div class="acu-det">${f.medida && f.medida !== "—" ? escapeHtml(f.medida) + " · " : ""}${escapeHtml(f.detalle)}</div></td>
        <td class="acu-c"><input type="number" class="acu-pond" data-log-pond="${f.id}" min="0" max="100" step="1" value="${f.pondConfig}" />%</td>
        <td class="acu-c">${f.medible ? `<div class="acu-bar"><span style="width:${f.cumplimiento}%;background:${e.color};"></span></div><small>${MOD_NF(f.cumplimiento)}%</small>` : '<span style="color:var(--muted);">—</span>'}</td>
        <td class="acu-c">${f.medible ? MOD_NF(f.puntaje, 1) : "—"}</td>
        <td class="acu-c"><span class="acu-tag" style="color:${e.color};border-color:${e.color};">${e.icono} ${e.txt}</span></td></tr>`;
    })
    .join("");

  const reparto = modAnillo(
    [
      { label: "Cumple", valor: ev.cumplidos, color: "var(--ok)" },
      { label: "Parcial", valor: ev.parciales, color: "var(--warn)" },
      { label: "Crítico", valor: ev.criticos, color: "var(--danger)" },
      { label: "Sin datos", valor: ev.sinDatos.length, color: "var(--muted)" },
    ].filter((p) => p.valor > 0),
    score == null ? "—" : String(score),
    "/ 100",
  );

  const hall = ev.medibles
    .slice()
    .sort((a, b) => a.cumplimiento - b.cumplimiento)
    .slice(0, 3)
    .map((f, i) => {
      const e = EST[f.estado] || { color: "var(--muted)" };
      return `<div class="acu-hall"><div class="n" style="border-color:${e.color};color:${e.color};">${i + 1}</div><div><b>${escapeHtml(f.texto)}</b><div>${MOD_NF(f.cumplimiento)}% de cumplimiento. ${escapeHtml(f.detalle)}</div></div></div>`;
    })
    .join("");

  const c = ev.cfg;
  cont.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Acuerdos de servicio — Logística</h3><span class="sub">Medidos sobre el plan de envasado y el de filtración</span></div>
      <div class="panel-body">
        <div class="acu-kpis">${kpis}</div>
        <div class="acu-grid">
          <div class="acu-card">
            <div class="acu-card-tit">Detalle de acuerdos de logística</div>
            <div class="table-scroll"><table class="acu-tabla"><thead><tr><th>Acuerdo</th><th class="acu-c">Ponderación</th><th class="acu-c">Cumplimiento</th><th class="acu-c">Puntaje</th><th class="acu-c">Estado</th></tr></thead>
            <tbody>${filasHtml}</tbody>
            <tfoot><tr><td><b>Total medible</b></td><td class="acu-c"><b>${MOD_NF(ev.pondTotal)}%</b></td><td class="acu-c">—</td><td class="acu-c"><b>${MOD_NF(ev.puntajeTotal, 1)}</b></td><td class="acu-c"><b style="color:${col};">${score == null ? "—" : score + " / 100"}</b></td></tr></tfoot></table></div>
            <div class="log-umbrales">
              <label>Corrida de línea mínima <input type="number" class="acu-pond log-umbral" data-log-umbral="umbralLineaHL" min="0" step="1000" value="${c.umbralLineaHL}"> hL</label>
              <label>Cambios de formato máx. por semana <input type="number" class="acu-pond log-umbral" data-log-umbral="maxCambiosFormato" min="0" step="1" value="${c.maxCambiosFormato}"></label>
              <label>Corrida de filtro mínima <input type="number" class="acu-pond log-umbral" data-log-umbral="umbralFiltroHL" min="0" step="10000" value="${c.umbralFiltroHL}"> hL</label>
            </div>
          </div>
          <div>
            <div class="acu-card"><div class="acu-card-tit">Score global de logística</div>${reparto}
              <div class="acu-nota">El score se normaliza sobre los acuerdos que sí se pueden medir. Formato de un SKU = envase + tamaño leídos del nombre (p. ej. «Vidrio 330 cc», «PET 1,5 L»).</div></div>
            <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Hallazgos clave</div>${hall || '<p class="empty-note">Sin acuerdos medibles todavía.</p>'}</div>
          </div>
        </div>
      </div>
    </div>`;

  const rerender = () => {
    renderAcuerdosLogistica();
    if (typeof renderRecomendacionesPlan === "function") renderRecomendacionesPlan();
    if (typeof renderTminus === "function") renderTminus();
  };
  cont.querySelectorAll("[data-log-pond]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const cfg = configLogistica();
      const v = Number(inp.value);
      cfg.pond[inp.dataset.logPond] = isFinite(v) && v >= 0 ? v : 0;
      guardarConfigLogistica(cfg);
      rerender();
    }),
  );
  cont.querySelectorAll("[data-log-umbral]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const cfg = configLogistica();
      const v = Number(inp.value);
      cfg[inp.dataset.logUmbral] = isFinite(v) && v >= 0 ? v : LOG_DEFECTO[inp.dataset.logUmbral];
      guardarConfigLogistica(cfg);
      rerender();
    }),
  );
}
