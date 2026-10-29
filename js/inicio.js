/* =========================================================================
   INICIO · resumen de la semana
   -------------------------------------------------------------------------
   Primera pantalla de T-minus. En vez de abrir directamente un Gantt lleno
   de colores, muestra en pocas tarjetas:
     1) qué archivos están cargados y cuáles faltan,
     2) tres cifras por área (envasado, cocinas, servicios) con enlace al
        detalle, y
     3) las pocas cosas que requieren atención (recomendaciones de prioridad
        alta).
   Solo lee lo que ya calcularon los demás módulos; no cambia ningún dato.
   ========================================================================= */
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d) => (v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("es-CO", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  const hayPlan = () => typeof STATE !== "undefined" && STATE && STATE.parsed;
  const TRENES = { 5: "L5", 7: "L7", 8: "L8", 9: "L9" };

  function semanasCortas(label) {
    const n = String(label || "").match(/\d+/g);
    if (!n || !n.length) return "";
    return n.length === 1 ? `Semana ${n[0]}` : `Semanas ${n[0]}–${n[n.length - 1]}`;
  }

  // hL de envasado del plan por línea, desde el I0 (lo que falta por envasar).
  function envasadoPorLinea() {
    const i0 = (typeof getI0Date === "function" && getI0Date()) || null;
    const t0 = i0 ? i0.getTime() : -Infinity;
    const out = { L5: 0, L7: 0, L8: 0, L9: 0 };
    let ini = Infinity, fin = -Infinity;
    Object.entries(STATE.mergedByTrain || {}).forEach(([t, bloques]) => {
      const ln = TRENES[t];
      if (!ln) return;
      (bloques || []).forEach((b) => {
        if (b.type !== "production" || !b.start || !b.end || !(Number(b.hectolitros) > 0)) return;
        const a = b.start.getTime(), z = b.end.getTime();
        if (z <= t0 || z <= a) return;
        const frac = a >= t0 ? 1 : (z - t0) / (z - a);
        out[ln] += Number(b.hectolitros) * frac;
        ini = Math.min(ini, Math.max(a, t0));
        fin = Math.max(fin, z);
      });
    });
    return { porLinea: out, total: Object.values(out).reduce((a, b) => a + b, 0), ini, fin };
  }

  function estadoArchivos() {
    const plan = hayPlan();
    const nombre = (document.getElementById("uploadCompactName") || {}).textContent || "";
    const inv = (typeof INVENTORY_BALANCE !== "undefined" && INVENTORY_BALANCE) || [];
    const foto = inv.map((e) => e && e.fotoEn && Date.parse(e.fotoEn)).filter(isFinite).sort((a, b) => b - a)[0];
    const pc = typeof PC !== "undefined" && PC && Array.isArray(PC.filas) && PC.filas.length;
    const srv = typeof resumenServicios === "function" ? resumenServicios() : null;
    return [
      {
        ok: !!plan,
        req: true,
        t: "Plan de envasado",
        d: plan ? [semanasCortas(STATE.parsed.weekLabel), nombre].filter(Boolean).join(" · ") : "Instructivo Suite 360 (.xlsx). Es lo único obligatorio.",
        ir: "view-datos",
      },
      {
        ok: inv.length > 0,
        t: "Producto en proceso",
        d: inv.length ? `${inv.length} equipos${foto ? " · foto " + fmtDateTime(new Date(foto)) : ""}` : "FV / SV / BBT. Sin él, el plan de cocinas no descuenta lo que ya está en tanques.",
        ir: "view-datos",
      },
      {
        ok: !!pc,
        t: "Programa de cocinas real",
        d: pc ? `${nf(PC.filas.length)} filas leídas` : "Excel de Elaboración. Opcional: habilita Plan vs. real.",
        ir: "view-programa-cocinas",
      },
      {
        ok: !!srv,
        t: "Indicadores de servicios",
        d: srv ? `Modelos de ${srv.archivo || "Excel"}${srv.hasta ? " · datos hasta " + srv.hasta : ""}` : "Excel de MED Servicios (.xlsm). Opcional: consumos de vapor, electricidad y agua.",
        ir: "view-servicios",
      },
    ];
  }

  function tarjeta(area, titulo, ir, cuerpo) {
    return `<article class="ini-card" data-area="${area}">
      <header><h3>${titulo}</h3><button class="ini-link" data-goto="${ir}">Abrir <span aria-hidden="true">→</span></button></header>
      ${cuerpo}
    </article>`;
  }
  const cifra = (v, u, l) => `<div class="ini-cifra"><b>${v}${u ? ` <small>${u}</small>` : ""}</b><span>${l}</span></div>`;

  function cardEnvasado() {
    if (!hayPlan()) return tarjeta("env", "Envasado", "view-datos", `<p class="ini-vacio">Carga el plan de envasado para ver el volumen por línea.</p>`);
    const e = envasadoPorLinea();
    const max = Math.max(1, ...Object.values(e.porLinea));
    const barras = Object.entries(e.porLinea)
      .map(([l, v]) => `<div class="ini-bar"><span>${l}</span><i style="--w:${((v / max) * 100).toFixed(1)}%"></i><em>${nf(v)}</em></div>`)
      .join("");
    const rango = isFinite(e.ini) ? `${fmtDate(new Date(e.ini))} → ${fmtDate(new Date(e.fin))}` : "";
    return tarjeta("env", "Envasado", "view-gantt-plan", `
      <div class="ini-cifras">${cifra(nf(e.total), "hL", "por envasar desde el I0")}</div>
      <div class="ini-bars">${barras}</div>
      ${rango ? `<p class="ini-nota">${esc(rango)}</p>` : ""}`);
  }

  function cardCocinas() {
    const plan = hayPlan() && STATE.plan;
    if (!plan) return tarjeta("coc", "Cocinas", "view-programa-feria", `<p class="ini-vacio">El plan de cocinas se calcula al cargar el plan de envasado.</p>`);
    const res = plan.results || [];
    const coc = res.reduce((a, r) => a + (r.numCocimientos || 0), 0);
    const hl = res.reduce((a, r) => a + (r.volumenCocinar || 0), 0);
    const seq = STATE.seq;
    const tarde = seq ? (seq.capacityWarnings || []).filter((w) => w.tipo === "deadline").length : 0;
    const sinTanque = seq && seq.tankAssignment ? (seq.tankAssignment.sinTanque || []).length : 0;
    return tarjeta("coc", "Cocinas", "view-programa-feria", `
      <div class="ini-cifras">${cifra(nf(coc), "", "cocimientos")}${cifra(nf(hl), "hL", "mosto a cocinar")}</div>
      <ul class="ini-estado">
        <li class="${tarde ? "warn" : "ok"}">${tarde ? `${tarde} bloque(s) llegan tarde a envasado` : "Todo llega a tiempo a envasado"}</li>
        <li class="${sinTanque ? "warn" : "ok"}">${sinTanque ? `${sinTanque} cocimiento(s) sin tanque` : "Todos los cocimientos tienen tanque"}</li>
      </ul>`);
  }

  function cardServicios() {
    const r = typeof resumenServicios === "function" ? resumenServicios() : null;
    if (!r) return tarjeta("srv", "Servicios", "view-servicios", `<p class="ini-vacio">Carga los Indicadores de servicios para estimar vapor, electricidad y agua del plan.</p>`);
    if (!r.plan) return tarjeta("srv", "Servicios", "view-servicios", `<p class="ini-vacio">Modelos listos. Falta el plan de envasado para calcular el consumo esperado.</p>`);
    const p = r.plan;
    return tarjeta("srv", "Servicios", "view-servicios", `
      <div class="ini-cifras ini-tres">
        ${cifra(nf(p.vapor / 1000), "t", "vapor")}
        ${cifra(nf(p.electricidad / 1000), "MWh", "electricidad")}
        ${cifra(nf(p.agua / 10), "m³", "agua")}
      </div>
      <p class="ini-nota">${p.dias} días del plan${p.sinVapor && p.sinVapor.length ? ` · vapor sin ${esc(p.sinVapor.join(", "))} (sin modelo confiable)` : ""}</p>`);
  }

  function atencion() {
    if (!hayPlan() || typeof recomendacionesPlan !== "function") return "";
    let recs = [];
    try { recs = recomendacionesPlan() || []; } catch (e) { console.error(e); return ""; }
    const orden = { alta: 0, media: 1, baja: 2 };
    recs = recs.slice().sort((a, b) => (orden[a.p] ?? 3) - (orden[b.p] ?? 3));
    const altas = recs.filter((r) => r.p === "alta").length;
    const top = recs.slice(0, 3);
    const cuerpo = top.length
      ? `<ul class="ini-recs">${top
          .map((r) => `<li><span class="ini-p ${esc(r.p)}">${esc(r.p)}</span><div><b>${esc(r.titulo)}</b><small>${esc(r.area || "")}${r.impacto ? " · " + esc(r.impacto) : ""}</small></div>${r.ir ? `<button class="ini-link" data-goto="${esc(r.ir)}">Ver <span aria-hidden="true">→</span></button>` : ""}</li>`)
          .join("")}</ul>`
      : `<p class="ini-vacio">Sin recomendaciones: el plan no tiene alertas.</p>`;
    return `<section class="ini-sec">
      <div class="ini-sec-h"><h2>Requiere atención</h2><span>${recs.length ? `${recs.length} recomendación(es)${altas ? ` · ${altas} de prioridad alta` : ""}` : ""}</span>${recs.length > 3 ? `<button class="ini-link" data-goto="view-recomendaciones">Ver todas <span aria-hidden="true">→</span></button>` : ""}</div>
      ${cuerpo}</section>`;
  }

  function renderInicio() {
    const cont = document.getElementById("inicioPanel");
    if (!cont) return;
    const arch = estadoArchivos();
    const faltaPlan = !arch[0].ok;
    const i0 = typeof getI0Date === "function" ? getI0Date() : null;
    cont.innerHTML = `
      <div class="ini">
        <div class="ini-hero">
          <div>
            <h1>${faltaPlan ? "Bienvenido a T-minus" : "Resumen del plan"}</h1>
            <p>${faltaPlan
              ? "Planeación de envasado, cocinas y servicios. Empieza cargando el plan de envasado; el resto es opcional."
              : `${esc(semanasCortas(STATE.parsed.weekLabel))}${i0 ? ` · programado desde el I0 ${esc(fmtDateTime(i0))}` : ""}`}</p>
          </div>
          ${faltaPlan ? `<button class="btn primary" data-goto="view-datos">Cargar plan de envasado</button>` : ""}
        </div>

        ${faltaPlan ? "" : `<div class="ini-grid">${cardEnvasado()}${cardCocinas()}${cardServicios()}</div>${atencion()}`}

        <section class="ini-sec">
          <div class="ini-sec-h"><h2>Archivos</h2><span>${arch.filter((a) => a.ok).length} de ${arch.length} cargados · se procesan en este navegador</span></div>
          <ul class="ini-files">${arch
            .map((a) => `<li class="${a.ok ? "ok" : ""}"><span class="ini-dot" aria-hidden="true">${a.ok ? "✓" : ""}</span><div><b>${esc(a.t)}${a.req ? ' <em class="ini-req">obligatorio</em>' : ""}</b><small>${esc(a.d)}</small></div><button class="btn small" data-goto="${a.ir}">${a.ok ? "Ver" : "Cargar"}</button></li>`)
            .join("")}</ul>
        </section>
      </div>`;
  }

  window.renderInicio = renderInicio;
})();
