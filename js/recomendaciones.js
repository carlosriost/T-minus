/* =========================================================================
   RECOMENDACIONES PARA MEJORAR EL PLAN
   -------------------------------------------------------------------------
   Reúne en una sola lista priorizada lo que FerIA ya detecta en distintos
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
      });
  }

  return out.sort((a, b) => REC_PRIORIDAD[a.p].orden - REC_PRIORIDAD[b.p].orden);
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

  const filas = recs.length
    ? recs
        .map((r) => {
          const P = REC_PRIORIDAD[r.p];
          return `<tr><td class="acu-c"><span class="acu-tag" style="color:${P.color};border-color:${P.color};">${P.txt}</span></td>
          <td class="acu-nom"><b>${escapeHtml(r.titulo)}</b><div class="acu-det">${escapeHtml(r.detalle)}</div></td>
          <td class="rec-imp">${escapeHtml(r.impacto)}</td><td class="rec-imp">${escapeHtml(r.area)}<div class="acu-det">${escapeHtml(r.origen)}</div></td>
          <td class="acu-c"><button class="btn small" data-goto="${r.ir}">Revisar →</button></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="5"><p class="empty-note">Sin hallazgos: el plan cumple las reglas que FerIA puede medir.</p></td></tr>';

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
            <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Cómo se generan</div>
              <p class="acu-nota" style="margin-top:0;">Cada recomendación sale de una regla sobre los datos cargados (secuencia de cocina, asignación de tanques, acuerdos de Elaboración y Logística, CIP A/B/C y Utilidades) y dice de dónde viene. No cambian el plan: «Revisar» lleva a la pantalla donde se ve el detalle. El score del plan es el promedio de los scores de Elaboración y Logística.</p>
            </div>
          </div>
        </div>
      </div>
    </div>`;
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
}
// Al abrir una vista del menú se repinta su módulo, para que tome cambios
// hechos en otras pantallas (p. ej. el plan de filtración o el catálogo).
function alAbrirVista(view) {
  const m = {
    "view-tminus": renderTminus,
    "view-logistica": renderAcuerdosLogistica,
    "view-recomendaciones": renderRecomendacionesPlan,
    "view-cip": renderCipABC,
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
