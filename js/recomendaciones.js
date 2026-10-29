/* =========================================================================
   RECOMENDACIONES PARA MEJORAR EL PLAN
   -------------------------------------------------------------------------
   Reúne en una sola lista priorizada lo que T-minus ya detecta en distintos
   lugares, con una acción sugerida y a dónde ir para revisarlo:
     · Alertas de la secuencia de cocina (fechas límite, BBT, Pony, levadura…)
     · Cocimientos sin tanque y marcas sin homologar
     · Acuerdos de Elaboración y de Logística en estado crítico o parcial
     · Cambios de formato de más y arranques de semana con Light o malta
     · Uso de tanques categoría C (más agua de CIP) con A/B libres
     · Arranques cortos de la caldera alterna (Utilidades)
   Son reglas sobre los datos cargados, no un modelo de IA: cada hallazgo se
   puede rastrear hasta su origen. No modifica el plan; el planeador decide.
   ========================================================================= */

const REC_PRIORIDAD = {
  alta: { txt: "Alta", color: "var(--danger)", orden: 0 },
  media: { txt: "Media", color: "var(--warn)", orden: 1 },
  baja: { txt: "Baja", color: "var(--muted)", orden: 2 },
};

// Plantillas por tipo de alerta de la secuencia de cocina.
const REC_ALERTA = {
  deadline: { p: "alta", area: "Secuencia de cocina", ir: "view-secuencia", acc: "Adelantar el bloque o mover el envasado: el producto no alcanza a estar listo." },
  bbt: { p: "alta", area: "Secuencia de cocina", ir: "view-secuencia", acc: "Acercar la cocción de Pony a su envasado para no pasar el máximo en BBT." },
  levadura: { p: "alta", area: "Levadura", ir: "view-levadura", acc: "Registrar o asegurar una cosecha de levadura Light antes de este bloque." },
  ponyseguidas: { p: "media", area: "Secuencia de cocina", ir: "view-secuencia", acc: "Separar la racha de Pony con cerveza de la semana siguiente o mover envasados de Pony." },
  ponysinespacio: { p: "media", area: "Tanques", ir: "view-tanques", acc: "Liberar SV Pony antes o reprogramar la corrida de Pony." },
  corridacorta: { p: "media", area: "Secuencia de cocina", ir: "view-secuencia", acc: "Juntar más volumen por marca para no partir corridas." },
  cocinaparada: { p: "media", area: "Secuencia de cocina", ir: "view-gantt-cocina", acc: "Traer cocimientos de la semana siguiente para no dejar la cocina parada." },
  aseocorto: { p: "baja", area: "Aseos", ir: "view-aseo-periodico", acc: "Agrupar más cocimientos por marca para que los aseos caigan dentro de la ventana." },
};

function recomendacionesPlan() {
  const out = [];
  const seq = STATE && STATE.seq;
  const plan = STATE && STATE.plan;
  const add = (r) => out.push(r);

  // 1) Alertas de la secuencia: se agrupan por tipo para no repetir.
  const porTipo = {};
  ((seq && seq.capacityWarnings) || []).forEach((w) => (porTipo[w.tipo] = porTipo[w.tipo] || []).push(w));
  Object.keys(porTipo).forEach((tipo) => {
    const ws = porTipo[tipo];
    const pl = REC_ALERTA[tipo] || { p: "media", area: "Secuencia de cocina", ir: "view-secuencia", acc: "Revisar la secuencia." };
    const ej = ws[0];
    add({
      p: pl.p,
      area: pl.area,
      ir: pl.ir,
      titulo: pl.acc,
      detalle: (ws.length > 1 ? `${ws.length} casos. Ej.: ` : "") + (ej.detalle || ej.blockLabel || ""),
      impacto: tipo === "deadline" && ws.some((w) => w.retrasoHoras)
        ? `Hasta ${MOD_NF(Math.max(...ws.map((w) => w.retrasoHoras || 0)))} h de retraso`
        : `${ws.length} alerta(s)`,
      origen: "Secuencia de cocina",
      regla: `secuencia:${tipo}`,
    });
  });

  // 2) Cocimientos sin tanque.
  const sinT = (seq && seq.tankAssignment && seq.tankAssignment.sinTanque) || [];
  if (sinT.length)
    add({
      p: "alta",
      area: "Tanques",
      ir: "view-tanques",
      titulo: "Hay cocimientos sin fermentador o madurador disponible.",
      detalle: `${sinT.length} cocimiento(s) no encontraron tanque libre. Revisa la ocupación y los equipos marcados como no disponibles.`,
      impacto: `${sinT.length} cocimiento(s)`,
      origen: "Asignación de tanques",
      regla: "tanques:sin-tanque",
    });

  // 3) Marcas sin homologar.
  const sh = (plan && plan.sinHomologar) || [];
  if (sh.length)
    add({
      p: "media",
      area: "Datos",
      ir: "view-sin-homologar",
      titulo: "Homologar marcas que no tienen mosto en el catálogo.",
      detalle: `${sh.length} marca(s) quedan fuera de la programación de cocinas hasta que se homologuen.`,
      impacto: `${sh.length} marca(s)`,
      origen: "Catálogo de mostos",
      regla: "datos:sin-homologar",
    });

  // 4) Acuerdos de Elaboración y de Logística.
  const acuerdos = [];
  if (typeof evaluarAcuerdos === "function" && plan) {
    const ev = evaluarAcuerdos(plan, seq);
    ev.medibles.forEach((f) => acuerdos.push({ ...f, set: "Elaboración", ir: "view-reglas", nombre: acuerdoTitulo(f.texto) }));
  }
  if (typeof evaluarAcuerdosLogistica === "function") {
    const ev = evaluarAcuerdosLogistica();
    ev.medibles.forEach((f) => acuerdos.push({ ...f, set: "Logística", ir: "view-logistica", nombre: f.texto }));
  }
  if (typeof evaluarSLA === "function") {
    // Los SLA que repiten un acuerdo de Elaboración no se duplican.
    evaluarSLA()
      .medibles.filter((f) => !(typeof SLA_A_REGLA !== "undefined" && SLA_A_REGLA[f.n]))
      .forEach((f) =>
        acuerdos.push({ ...f, set: "SLA Planta", ir: "view-logistica", nombre: `SLA ${f.n}: ${f.texto}`, ponderacion: 100, puntaje: f.cumplimiento }),
      );
  }
  acuerdos
    .filter((f) => f.estado === "critico" || f.estado === "parcial")
    .forEach((f) =>
      add({
        p: f.estado === "critico" ? "alta" : "media",
        area: `Acuerdos · ${f.set}`,
        ir: f.ir,
        titulo: `Mejorar el cumplimiento: ${f.nombre}`,
        detalle: f.detalle,
        impacto: f.set === "SLA Planta" ? `${MOD_NF(f.cumplimiento)}% de cumplimiento` : `${MOD_NF(f.cumplimiento)}% → +${MOD_NF(f.ponderacion - f.puntaje, 1)} pts posibles`,
        origen: `Acuerdo ${f.id}`,
        regla: `acuerdo:${f.set}:${f.id != null ? f.id : f.n}`,
      }),
    );

  // 5) Hallazgos de logística por línea (cambios de formato, arranques).
  if (typeof hallazgosLogistica === "function") {
    const semanas = semanasDelPlan();
    hallazgosLogistica()
      .filter((h) => h.acuerdo === "L4")
      .forEach((h) =>
        add({
          p: h.grave ? "alta" : "media",
          area: "Líneas de envasado",
          ir: "view-tminus",
          titulo: `Agrupar formatos en TREN-${h.tren} (${semanas[h.semana] ? semanas[h.semana].label : ""}).`,
          detalle: h.texto + " Cada cambio de formato es un DPA más: menos tiempo envasando y más CIP en línea.",
          impacto: "Menos cambios de formato",
          origen: "Acuerdo L4",
          regla: `logistica:L4:tren-${h.tren}`,
        }),
      );
  }

  // 6) Tanques categoría C usados con A/B libres (agua de CIP).
  const asg = seq && seq.tankAssignment;
  if (asg && typeof ocupacionesPorEquipo === "function") {
    const occ = ocupacionesPorEquipo(asg);
    ["FV", "SV", "SV Pony"].forEach((tp) => {
      const eqs = TANK_CATALOG.filter((t) => t.tipo === tp);
      const usos = (t) => (occ[t.equipo] || []).filter((b) => !b.inventario).length;
      const c = eqs.filter((t) => String(t.prioridad).toUpperCase() === "C" && usos(t) > 0);
      const libres = eqs.filter((t) => String(t.prioridad).toUpperCase() !== "C" && t.disponible !== false && usos(t) === 0);
      if (c.length && libres.length) {
        const agua = c.reduce((a, t) => a + usos(t) * (Number(t.aguaPromedio) || 0), 0);
        add({
          p: "baja",
          area: "CIP / agua",
          ir: "view-cip",
          titulo: `Preferir ${tp} categoría A/B en lugar de ${c.map((t) => t.equipo).join(", ")}.`,
          detalle: `${libres.length} ${tp} de categoría A/B no reciben carga en este plan mientras se usan equipos C, que gastan más agua por hL en su CIP.`,
          impacto: agua ? `${MOD_NF(agua)} de agua CIP en equipos C` : "Menos agua de CIP",
          origen: "CIP A/B/C",
          regla: `cip:${tp}`,
        });
      }
    });
  }

  // 7) Arranques cortos de la caldera alterna (menos de 4 h con 2+ líneas).
  if (typeof calcularUtilidades === "function" && STATE && STATE.mergedByTrain) {
    const u = calcularUtilidades(STATE.mergedByTrain);
    const cortos = u.calderas.filter((t) => t.lineasMax >= 2 && t.end - t.start < 4 * 3600000);
    if (cortos.length)
      add({
        p: "baja",
        area: "Utilities",
        ir: "view-gantt-plan",
        titulo: "Evitar arranques cortos de la caldera alterna.",
        detalle: `${cortos.length} tramo(s) de menos de 4 h con 2 o más líneas obligan a prender la caldera alterna por poco tiempo. Juntar esas líneas en el mismo horario, o separarlas, ahorra arranques.`,
        impacto: `${cortos.length} arranque(s) corto(s)`,
        origen: "Utilidades",
        regla: "utilidades:caldera-corta",
      });
  }

  // Con las calificaciones (estrellas) de planes ANTERIORES: dentro de la
  // misma prioridad van primero los tipos mejor calificados. Las de este plan
  // no reordenan (la fila no salta al calificarla). La prioridad no cambia y
  // no se esconde ninguna recomendación.
  const cal = recCalResumenPorRegla(recCalContexto().planId);
  const nota = (r) => (REC_ORDENAR_CON_CAL && cal[r.regla] ? cal[r.regla].prom : 3);
  out.forEach((r, i) => (r._i = i));
  return out.sort((a, b) => REC_PRIORIDAD[a.p].orden - REC_PRIORIDAD[b.p].orden || nota(b) - nota(a) || a._i - b._i);
}

/* ---- Calificación de las recomendaciones (1 a 5 estrellas) ----
   Cada calificación se guarda con la recomendación tal como se mostró y el
   contexto del plan (semana, I0, score, cuántas había), para poder entrenar
   después un modelo que aprenda qué recomendaciones sirven. Por ahora se usa
   para ordenar (dentro de la misma prioridad) y se exporta en JSON / CSV.
   Queda en este navegador: para juntar las de varias personas, exportar e
   importar. */
const REC_CAL_KEY = "planRecCalificaciones";
const REC_CAL_ORDEN_KEY = "planRecOrdenarConCal";
let REC_ORDENAR_CON_CAL = (() => {
  try {
    return localStorage.getItem(REC_CAL_ORDEN_KEY) !== "0";
  } catch (_) {
    return true;
  }
})();
let REC_CAL_CACHE = null;
function recCalLeer() {
  if (REC_CAL_CACHE) return REC_CAL_CACHE;
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(REC_CAL_KEY) || "null");
  } catch (_) {}
  REC_CAL_CACHE = g && g.items && typeof g.items === "object" ? g : { v: 1, items: {} };
  return REC_CAL_CACHE;
}
function recCalGuardar(db) {
  REC_CAL_CACHE = db;
  try {
    localStorage.setItem(REC_CAL_KEY, JSON.stringify(db));
    return true;
  } catch (_) {
    return false;
  }
}
// Contexto del plan en que se calificó (lo que identifica «esta» corrida).
function recCalContexto(extra) {
  const p = STATE && STATE.parsed;
  const i0 = typeof getI0Date === "function" ? getI0Date() : null;
  const ws = p && (p.weekStartDate || p.headerDate);
  let semanas = [];
  try {
    semanas = typeof semanasDelPlan === "function" ? semanasDelPlan().map((x) => x.label) : [];
  } catch (_) {}
  return {
    planId: `${ws ? new Date(ws).toISOString().slice(0, 10) : "sin-semana"}|${i0 && !isNaN(i0) ? i0.toISOString().slice(0, 16) : "sin-i0"}`,
    semanaInicio: ws ? new Date(ws).toISOString().slice(0, 10) : null,
    i0: i0 && !isNaN(i0) ? i0.toISOString().slice(0, 16) : null,
    semanas,
    cocimientos: STATE && STATE.seq ? (STATE.seq.rows || []).filter((r) => r.tipo === "cocimiento").length : null,
    ...(extra || {}),
  };
}
function recHuella(r) {
  return `${r.regla || r.origen}|${normalizeText(r.titulo || "")}`;
}
function recCalId(r, ctx) {
  return `${recHuella(r)}@${ctx.planId}`;
}
function recCalDe(r, ctx) {
  return recCalLeer().items[recCalId(r, ctx)] || null;
}
// La última calificación de la misma regla en otros planes (para orientar).
function recCalAnterior(r, ctx) {
  const it = Object.values(recCalLeer().items).filter((x) => x.regla === r.regla && x.contexto && x.contexto.planId !== ctx.planId);
  return it.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0] || null;
}
function recCalificar(r, estrellas, ctx) {
  const db = recCalLeer();
  const id = recCalId(r, ctx);
  if (!estrellas) delete db.items[id];
  else {
    const prev = db.items[id];
    db.items[id] = {
      id,
      regla: r.regla || r.origen,
      huella: recHuella(r),
      estrellas,
      comentario: prev ? prev.comentario || "" : "",
      fecha: new Date().toISOString(),
      recomendacion: { prioridad: r.p, area: r.area, origen: r.origen, titulo: r.titulo, detalle: r.detalle, impacto: r.impacto, ir: r.ir },
      contexto: ctx,
    };
  }
  return recCalGuardar(db);
}
function recCalComentar(r, txt, ctx) {
  const db = recCalLeer();
  const it = db.items[recCalId(r, ctx)];
  if (!it) return false;
  it.comentario = String(txt || "").slice(0, 500);
  it.fecha = new Date().toISOString();
  return recCalGuardar(db);
}
function recCalResumenPorRegla(excluirPlanId) {
  const o = {};
  Object.values(recCalLeer().items).forEach((x) => {
    if (excluirPlanId && x.contexto && x.contexto.planId === excluirPlanId) return;
    const k = x.regla;
    const a = (o[k] = o[k] || { regla: k, n: 0, suma: 0, area: (x.recomendacion || {}).area || "", ejemplo: (x.recomendacion || {}).titulo || "" });
    a.n++;
    a.suma += Number(x.estrellas) || 0;
  });
  Object.values(o).forEach((a) => (a.prom = a.suma / a.n));
  return o;
}
function recCalExportar(formato) {
  const items = Object.values(recCalLeer().items).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
  let txt, tipo, ext;
  if (formato === "csv") {
    const cols = ["fecha", "estrellas", "comentario", "regla", "prioridad", "area", "origen", "titulo", "detalle", "impacto", "planId", "semanaInicio", "i0", "scorePlan", "nRecomendaciones", "cocimientos"];
    const esc = (v) => {
      const t = v == null ? "" : String(v);
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    txt =
      "\ufeff" +
      cols.join(";") +
      "\n" +
      items
        .map((x) => {
          const r = x.recomendacion || {};
          const c = x.contexto || {};
          return [x.fecha, x.estrellas, x.comentario, x.regla, r.prioridad, r.area, r.origen, r.titulo, r.detalle, r.impacto, c.planId, c.semanaInicio, c.i0, c.scorePlan, c.nRecomendaciones, c.cocimientos].map(esc).join(";");
        })
        .join("\n");
    tipo = "text/csv;charset=utf-8";
    ext = "csv";
  } else {
    txt = JSON.stringify(
      {
        formato: "T-minus · calificaciones de recomendaciones",
        version: 1,
        exportado: new Date().toISOString(),
        descripcion: "Cada ítem: la recomendación como se mostró (recomendacion), cuántas estrellas le dieron (1 = no sirve, 5 = muy útil), el comentario y el contexto del plan (semana, I0, score, cuántas recomendaciones había). «regla» agrupa las recomendaciones del mismo tipo.",
        items,
      },
      null,
      2,
    );
    tipo = "application/json";
    ext = "json";
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: tipo }));
  a.download = `T-minus_calificaciones_recomendaciones_${new Date().toISOString().slice(0, 10)}.${ext}`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  return items.length;
}
// Junta un JSON exportado (de otra persona o navegador): por id, gana la más reciente.
function recCalImportar(texto) {
  const g = JSON.parse(texto);
  const lista = Array.isArray(g) ? g : g && Array.isArray(g.items) ? g.items : null;
  if (!lista) throw new Error("El archivo no trae calificaciones de T-minus.");
  const db = recCalLeer();
  let nuevas = 0;
  let actualizadas = 0;
  lista.forEach((x) => {
    const e = Math.round(Number(x && x.estrellas));
    if (!x || !x.id || !x.regla || !(e >= 1 && e <= 5)) return;
    const prev = db.items[x.id];
    if (!prev) nuevas++;
    else if (String(x.fecha) > String(prev.fecha)) actualizadas++;
    else return;
    db.items[x.id] = { ...x, estrellas: e, comentario: String(x.comentario || "").slice(0, 500) };
  });
  recCalGuardar(db);
  return { nuevas, actualizadas };
}

function recHtmlEstrellas(i, actual) {
  let h = `<div class="rec-stars" role="radiogroup" aria-label="Calidad de la recomendación">`;
  for (let k = 1; k <= 5; k++) h += `<button type="button" class="rec-star ${actual && k <= actual ? "on" : ""}" role="radio" aria-checked="${actual === k}" aria-label="${k} estrella${k > 1 ? "s" : ""}" title="${["", "No sirve", "Poco útil", "Más o menos", "Útil", "Muy útil"][k]}" data-rec-star="${i}|${k}">★</button>`;
  return h + "</div>";
}

function renderRecomendacionesPlan() {
  const cont = document.getElementById("recomendacionesPanel");
  if (!cont) return;
  if (!STATE || !STATE.mergedByTrain) return modSinDatos(cont, "las recomendaciones");
  const recs = recomendacionesPlan();
  const scoreEl = typeof evaluarAcuerdos === "function" && STATE.plan ? evaluarAcuerdos(STATE.plan, STATE.seq).score : null;
  const scoreLog = typeof evaluarAcuerdosLogistica === "function" ? evaluarAcuerdosLogistica().score : null;
  const scores = [scoreEl, scoreLog].filter((s) => s != null);
  const scorePlan = scores.length ? Math.round(scores.reduce((a, s) => a + s, 0) / scores.length) : null;
  const n = (p) => recs.filter((r) => r.p === p).length;

  const kpis =
    modKpi("◎", "Score del plan", scorePlan == null ? "—" : `${scorePlan} <small>/ 100</small>`, `Elaboración ${scoreEl == null ? "—" : Math.round(scoreEl)} · Logística ${scoreLog == null ? "—" : Math.round(scoreLog)}`, colorScore(scorePlan)) +
    modKpi("!", "Prioridad alta", String(n("alta")), "Afectan el cumplimiento del plan", n("alta") ? "var(--danger)" : "var(--muted)") +
    modKpi("–", "Prioridad media", String(n("media")), "Mejoran acuerdos y secuencia", n("media") ? "var(--warn)" : "var(--muted)") +
    modKpi("·", "Prioridad baja", String(n("baja")), "Ahorros de agua y Utilities", "var(--muted)");

  const ctx = recCalContexto({ scorePlan, nRecomendaciones: recs.length });
  const porRegla = recCalResumenPorRegla();
  const filas = recs.length
    ? recs
        .map((r, i) => {
          const P = REC_PRIORIDAD[r.p];
          const c = recCalDe(r, ctx);
          const ant = c ? null : recCalAnterior(r, ctx);
          const pr = porRegla[r.regla];
          return `<tr><td class="acu-c"><span class="acu-tag" style="color:${P.color};border-color:${P.color};">${P.txt}</span></td>
          <td class="acu-nom"><b>${escapeHtml(r.titulo)}</b><div class="acu-det">${escapeHtml(r.detalle)}</div>
            <div class="rec-cal"><span class="rec-cal-lab">¿Qué tan útil fue?</span>${recHtmlEstrellas(i, c ? c.estrellas : 0)}${
              c
                ? `<input type="text" class="rec-com" data-rec-com="${i}" maxlength="500" placeholder="¿Por qué? (opcional)" value="${escapeHtml(c.comentario || "")}"><button type="button" class="pc-mini" data-rec-borrar="${i}" title="Quitar mi calificación">quitar</button>`
                : `<span class="acu-det">${ant ? `la última vez: ${"★".repeat(ant.estrellas)}` : "sin calificar"}</span>`
            }${pr ? `<span class="acu-det">· este tipo: ${MOD_NF(pr.prom, 1)} ★ (${pr.n})</span>` : ""}</div></td>
          <td class="rec-imp">${escapeHtml(r.impacto)}</td><td class="rec-imp">${escapeHtml(r.area)}<div class="acu-det">${escapeHtml(r.origen)}</div></td>
          <td class="acu-c"><button class="btn small" data-goto="${r.ir}">Revisar →</button></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="5"><p class="empty-note">Sin hallazgos: el plan cumple las reglas que T-minus puede medir.</p></td></tr>';
  const todas = Object.values(recCalLeer().items);
  const nCal = todas.length;
  const promCal = nCal ? todas.reduce((a, x) => a + (Number(x.estrellas) || 0), 0) / nCal : null;
  const calificadasAhora = recs.filter((r) => recCalDe(r, ctx)).length;
  const reglasOrden = Object.values(porRegla).sort((a, b) => b.prom - a.prom || b.n - a.n);
  const htmlReglas = reglasOrden.length
    ? `<div class="table-scroll mod-noclip"><table class="acu-tabla rec-tcal"><thead><tr><th>Tipo de recomendación</th><th class="num">Promedio</th><th class="num">Calif.</th></tr></thead><tbody>${reglasOrden
        .map((a) => `<tr><td class="rec-imp">${escapeHtml(a.area)}<div class="acu-det">${escapeHtml(a.ejemplo)}</div></td><td class="num"><span class="rec-prom" style="--p:${(a.prom / 5) * 100}%">${MOD_NF(a.prom, 1)} ★</span>${a.n >= 3 && a.prom <= 2 ? '<div class="acu-det pvr-no">poco útil</div>' : a.n >= 3 && a.prom >= 4 ? '<div class="acu-det pvr-si">muy útil</div>' : ""}</td><td class="num">${a.n}</td></tr>`)
        .join("")}</tbody></table></div>`
    : '<p class="empty-note">Todavía no hay calificaciones. Dale de 1 a 5 estrellas a cada recomendación según qué tan útil fue.</p>';

  // Reparto por área.
  const porArea = {};
  recs.forEach((r) => (porArea[r.area] = (porArea[r.area] || 0) + 1));
  const areas = Object.entries(porArea)
    .sort((a, b) => b[1] - a[1])
    .map(([a, v], i) => ({ label: a, valor: v, color: MOD_PALETA[i % MOD_PALETA.length] }));

  cont.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Recomendaciones para mejorar el plan</h3><span class="sub">Hallazgos automáticos a partir de las reglas, los acuerdos y los datos cargados</span></div>
      <div class="panel-body">
        <div class="acu-kpis">${kpis}</div>
        <div class="acu-grid">
          <div class="acu-card"><div class="acu-card-tit">Recomendaciones priorizadas (${recs.length})</div>
            <div class="table-scroll mod-noclip"><table class="acu-tabla"><thead><tr><th class="acu-c">Prioridad</th><th>Recomendación</th><th>Impacto</th><th>Área</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>
          </div>
          <div>
            <div class="acu-card"><div class="acu-card-tit">Hallazgos por área</div>${areas.length ? modBarras(areas, "") : '<p class="empty-note">Sin hallazgos.</p>'}</div>
            <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Calificaciones <small class="pc-sub">· ${nCal} en total${promCal != null ? ` · promedio ${MOD_NF(promCal, 1)} ★` : ""} · ${calificadasAhora} de ${recs.length} de este plan</small></div>
              ${htmlReglas}
              <label class="rec-orden"><input type="checkbox" data-rec-orden ${REC_ORDENAR_CON_CAL ? "checked" : ""}> Dentro de cada prioridad, mostrar primero los tipos mejor calificados en planes anteriores</label>
              <div class="rec-acc">
                <button type="button" class="btn small" data-rec-exp="json" ${nCal ? "" : "disabled"}>Exportar JSON</button>
                <button type="button" class="btn small" data-rec-exp="csv" ${nCal ? "" : "disabled"}>Exportar CSV</button>
                <label class="btn small" for="recCalImp">Importar JSON</label><input type="file" id="recCalImp" accept=".json,application/json" hidden>
                <button type="button" class="btn small rec-borrar" data-rec-limpiar ${nCal ? "" : "disabled"}>Borrar todas</button>
              </div>
              <p class="acu-nota" id="recCalEstado">Cada calificación se guarda con la recomendación y el contexto del plan (semana, I0, score), en este navegador. Es la base para que más adelante una IA aprenda qué recomendaciones sirven: exporta el JSON para juntarlas o entrenar; para sumar las de otra persona, importa su JSON.</p>
            </div>
            <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Cómo se generan</div>
              <p class="acu-nota" style="margin-top:0;">Cada recomendación sale de una regla sobre los datos cargados (secuencia de cocina, asignación de tanques, acuerdos de Elaboración y Logística, CIP A/B/C y Utilidades) y dice de dónde viene. No cambian el plan: «Revisar» lleva a la pantalla donde se ve el detalle. El score del plan es el promedio de los scores de Elaboración y Logística.</p>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  recConectarCalificaciones(cont, recs, ctx);
}

function recConectarCalificaciones(cont, recs, ctx) {
  const estado = (t, error) => {
    const el = cont.querySelector("#recCalEstado");
    if (el) {
      el.textContent = t;
      el.classList.toggle("pvr-no", !!error);
    }
  };
  const repintar = () => {
    const y = window.scrollY;
    renderRecomendacionesPlan();
    window.scrollTo(0, y);
  };
  cont.querySelectorAll("[data-rec-star]").forEach((b) =>
    b.addEventListener("click", () => {
      const [i, k] = b.dataset.recStar.split("|").map(Number);
      const r = recs[i];
      if (!r) return;
      const actual = recCalDe(r, ctx);
      // Clic en la misma estrella = se mantiene (para quitar está «quitar»).
      if (!(actual && actual.estrellas === k) && !recCalificar(r, k, ctx)) return estado("No se pudo guardar: el navegador no deja usar el almacenamiento local.", true);
      repintar();
      const com = document.querySelector(`[data-rec-com="${i}"]`);
      if (com && !com.value) com.focus();
    }),
  );
  cont.querySelectorAll("[data-rec-com]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const r = recs[Number(inp.dataset.recCom)];
      if (r && !recCalComentar(r, inp.value, ctx)) estado("No se pudo guardar el comentario.", true);
    }),
  );
  cont.querySelectorAll("[data-rec-borrar]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = recs[Number(b.dataset.recBorrar)];
      if (r) recCalificar(r, 0, ctx);
      repintar();
    }),
  );
  const orden = cont.querySelector("[data-rec-orden]");
  if (orden)
    orden.addEventListener("change", () => {
      REC_ORDENAR_CON_CAL = orden.checked;
      try {
        localStorage.setItem(REC_CAL_ORDEN_KEY, orden.checked ? "1" : "0");
      } catch (_) {}
      repintar();
    });
  cont.querySelectorAll("[data-rec-exp]").forEach((b) =>
    b.addEventListener("click", () => {
      const n = recCalExportar(b.dataset.recExp);
      estado(`Se exportaron ${n} calificaciones (${b.dataset.recExp.toUpperCase()}).`);
    }),
  );
  const imp = cont.querySelector("#recCalImp");
  if (imp)
    imp.addEventListener("change", () => {
      const f = imp.files && imp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const r = recCalImportar(String(rd.result));
          repintar();
          estado(`Importadas: ${r.nuevas} nuevas y ${r.actualizadas} actualizadas desde ${f.name}.`);
        } catch (e) {
          estado("No se pudo importar: " + e.message, true);
        }
      };
      rd.readAsText(f);
    });
  const limpiar = cont.querySelector("[data-rec-limpiar]");
  if (limpiar)
    limpiar.addEventListener("click", () => {
      // Dos clics para borrar: el primero pide confirmación en el mismo botón.
      if (limpiar.dataset.confirmar !== "1") {
        limpiar.dataset.confirmar = "1";
        limpiar.textContent = "¿Seguro? Clic otra vez para borrar";
        setTimeout(() => {
          if (limpiar.isConnected) {
            limpiar.dataset.confirmar = "";
            limpiar.textContent = "Borrar todas";
          }
        }, 4000);
        return;
      }
      recCalGuardar({ v: 1, items: {} });
      repintar();
      estado("Se borraron todas las calificaciones de este navegador.");
    });
}

/* ---- Enlace con el resto de la app ---- */
// Se llama al final de recompute(): repinta los módulos de seguimiento.
function renderModulosSeguimiento() {
  const seguro = (fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  };
  seguro(renderVolumen);
  seguro(renderTminus);
  seguro(renderAcuerdosLogistica);
  seguro(renderCipABC);
  seguro(renderRecomendacionesPlan);
  if (typeof renderPlanVsReal === "function") seguro(renderPlanVsReal);
  if (typeof renderTrazabilidad === "function") seguro(renderTrazabilidad);
  if (typeof renderServicios === "function") seguro(renderServicios);
  if (typeof renderInicio === "function") seguro(renderInicio);
}
// Al abrir una vista del menú se repinta su módulo, para que tome cambios
// hechos en otras pantallas (p. ej. el plan de filtración o el catálogo).
function alAbrirVista(view) {
  const m = {
    "view-tminus": renderTminus,
    "view-logistica": renderAcuerdosLogistica,
    "view-recomendaciones": renderRecomendacionesPlan,
    "view-cip": renderCipABC,
    "view-programa-cocinas": typeof renderProgramaCocinas === "function" ? renderProgramaCocinas : null,
    "view-programa-feria": typeof renderProgramaFeria === "function" ? renderProgramaFeria : null,
    // Setpoints: si cambió el plan de cocinas desde el último dibujo, se redibuja el Gantt.
    "view-gantt-plan": () => {
      if (typeof spNecesitaRedibujar === "function" && typeof redibujarGanttEnvasado === "function" && spNecesitaRedibujar()) redibujarGanttEnvasado();
    },
    "view-plan-vs-real": typeof renderPlanVsReal === "function" ? renderPlanVsReal : null,
    "view-trazabilidad": typeof renderTrazabilidad === "function" ? renderTrazabilidad : null,
    "view-servicios": typeof renderServicios === "function" ? renderServicios : null,
    "view-inicio": typeof renderInicio === "function" ? renderInicio : null,
  }[view];
  if (m)
    try {
      m();
    } catch (e) {
      console.error(e);
    }
}
// El catálogo de equipos existe sin Excel: la vista CIP se puede ver de una.
renderCipABC();
