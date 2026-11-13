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
    const nombre = window.DatosEntrada ? DatosEntrada.nombre("instructivo") : "";
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
        ok: !!srv,
        t: "Indicadores de servicios",
        d: srv ? `Modelos de ${srv.archivo || "Excel"}${srv.hasta ? " · datos hasta " + srv.hasta : ""}` : "Excel de MED Servicios (.xlsm). Opcional: consumos de vapor, electricidad y agua.",
        ir: "view-datos",
      },
      {
        ok: !!pc,
        t: "Programa de cocinas real",
        d: pc ? `${nf(PC.filas.length)} filas leídas` : "Excel de Elaboración. Opcional: habilita Plan vs. real.",
        ir: "view-datos",
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

  // Cocimientos programados (los de la secuencia: ya descuentan lo que hay en
  // tanques y lo que el programa real cocinó y el reporte aún no trae).
  function cocimientos() {
    const rows = (STATE && STATE.seq && STATE.seq.rows) || [];
    return rows.filter((r) => r.tipo === "cocimiento" && r.start).sort((a, b) => a.start - b.start);
  }
  const mosto = (id) => (typeof MOSTO_CATALOG !== "undefined" && MOSTO_CATALOG.find((m) => m.id === id)) || {};
  const esPony = (id) => (typeof esMostoPony === "function" ? esMostoPony(id) : /pony/.test(String(id || "")));
  // hL de producto que salen del cocimiento (el mosto ya diluido).
  const hlProducto = (r) => (Number(r.cocVolumenHL) || 0) * (Number(mosto(r.mostoId).factorDilucion) || 1);

  function cardCocinas() {
    const plan = hayPlan() && STATE.plan;
    if (!plan) return tarjeta("coc", "Cocinas", "view-programa-feria", `<p class="ini-vacio">El plan de cocinas se calcula al cargar el plan de envasado.</p>`);
    const coc = cocimientos();
    const porMarca = {};
    coc.forEach((r) => {
      const k = r.mostoId || "?";
      const m = (porMarca[k] = porMarca[k] || { nombre: mosto(k).nombre || r.nombre || k, n: 0, hl: 0 });
      m.n++;
      m.hl += hlProducto(r);
    });
    const marcas = Object.values(porMarca).sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...marcas.map((m) => m.n));
    const seq = STATE.seq;
    const tarde = seq ? (seq.capacityWarnings || []).filter((w) => w.tipo === "deadline").length : 0;
    const sinTanque = seq && seq.tankAssignment ? (seq.tankAssignment.sinTanque || []).length : 0;
    const total = marcas.reduce((a, m) => a + m.hl, 0);
    return tarjeta("coc", "Cocinas", "view-programa-feria", `
      <div class="ini-cifras">${cifra(nf(coc.length), "", "cocimientos")}${cifra(nf(total), "hL", "de producto (ya diluido)")}</div>
      <div class="ini-bars ini-bars-marca">${marcas
        .map((m) => `<div class="ini-bar"><span>${esc(m.nombre)}</span><i style="--w:${((m.n / max) * 100).toFixed(1)}%"></i><em>${nf(m.n)} · ${nf(m.hl)} hL</em></div>`)
        .join("")}</div>
      <ul class="ini-estado">
        <li class="${tarde ? "warn" : "ok"}">${tarde ? `${tarde} bloque(s) llegan tarde a envasado` : "Todo llega a tiempo a envasado"}</li>
        <li class="${sinTanque ? "warn" : "ok"}">${sinTanque ? `${sinTanque} cocimiento(s) sin tanque` : "Todos los cocimientos tienen tanque"}</li>
      </ul>`);
  }

  // Semana a semana: envasado (semana completa del instructivo) y cocinado
  // (cocimientos que arrancan en la semana), separando cerveza y Pony Malta.
  function porSemana() {
    if (!hayPlan() || typeof semanasAcuerdos !== "function") return "";
    const sem = semanasAcuerdos();
    if (!sem.length) return "";
    const prod = typeof bloquesProduccion === "function" ? bloquesProduccion() : [];
    const coc = cocimientos();
    const filas = sem.map((w) => {
      const p = prod.filter((b) => enSemana(b.start, w));
      const c = coc.filter((r) => enSemana(r.start, w));
      const envP = p.filter((b) => esPony(b.familiaId)).reduce((a, b) => a + b.hl, 0);
      const envC = p.reduce((a, b) => a + b.hl, 0) - envP;
      const cP = c.filter((r) => esPony(r.mostoId));
      const cC = c.filter((r) => !esPony(r.mostoId));
      return { w, envC, envP, nC: cC.length, nP: cP.length, hlC: cC.reduce((a, r) => a + hlProducto(r), 0), hlP: cP.reduce((a, r) => a + hlProducto(r), 0) };
    });
    const T = filas.reduce((t, f) => {
      ["envC", "envP", "nC", "nP", "hlC", "hlP"].forEach((k) => (t[k] = (t[k] || 0) + f[k]));
      return t;
    }, {});
    const celda = (n, hl) => (n ? `${nf(hl)} <small>· ${nf(n)} coc.</small>` : `<span class="ini-cero">—</span>`);
    const fila = (lbl, f, cls) => `<tr class="${cls || ""}"><td>${lbl}</td><td class="num">${f.envC ? nf(f.envC) : "—"}</td><td class="num">${f.envP ? nf(f.envP) : "—"}</td><td class="num">${celda(f.nC, f.hlC)}</td><td class="num">${celda(f.nP, f.hlP)}</td></tr>`;
    return `<section class="ini-sec">
      <div class="ini-sec-h"><h2>Semana a semana</h2><span>Envasado: la semana completa del instructivo. Cocinado: los cocimientos que arrancan en la semana, en hL de producto ya diluido (comparables con lo envasado).</span></div>
      <div class="table-scroll ini-tabla-wrap"><table class="ini-tabla">
        <thead><tr><th rowspan="2">Semana</th><th colspan="2" class="grp">Envasado (hL)</th><th colspan="2" class="grp">Cocinado (hL)</th></tr>
        <tr><th class="num">Cerveza</th><th class="num">Pony Malta</th><th class="num">Cerveza</th><th class="num">Pony Malta</th></tr></thead>
        <tbody>${filas.map((f) => fila(`<b>${esc(f.w.corto)}</b> <small>${esc(f.w.label.replace(/^Semana \d+ · /, ""))}</small>`, f)).join("")}</tbody>
        <tfoot>${fila("<b>Total</b>", T, "tot")}</tfoot>
      </table></div></section>`;
  }

  // Eventos de modulación: paradas de líneas (las mismas de la modulación de
  // equipos: 2 h o más sin envasar por mantenimiento o sin programación) y
  // cocinas sin cocimientos 12 h o más. Solo lo que sigue desde el I0.
  function durTxt(ms) {
    const m = Math.round(ms / 60000);
    if (m >= 24 * 60) {
      const h = Math.round(m / 60);
      return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ""}`;
    }
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  }
  function eventosModulacion() {
    if (!hayPlan()) return "";
    const i0 = (typeof getI0Date === "function" && getI0Date()) || null;
    const t0 = i0 ? i0.getTime() : -Infinity;
    const ev = [];
    if (typeof calcularModulacion === "function") {
      let r = null;
      try {
        r = calcularModulacion(STATE.mergedByTrain);
      } catch (e) {
        console.error(e);
      }
      ((r && r.paradas) || []).forEach((p) => {
        if (p.arranca <= t0) return;
        ev.push({
          ms: Math.max(p.para, t0),
          area: TRENES[p.tren] || "L" + p.tren,
          dur: p.hastaFin ? null : p.arranca - Math.max(p.para, t0),
          desde: p.para < t0,
          hasta: p.hastaFin,
          que: p.por === "sin programación" ? "Sin programación" : p.por === "mantenimiento (DPA)" ? "Mantenimiento" : "Mantenimiento y sin programación",
          det: p.motivo,
        });
      });
    }
    const coc = cocimientos();
    const aseos = ((STATE.seq && STATE.seq.rows) || []).filter((r) => r.tipo === "aseo");
    const LIM = 12 * 3600000;
    const huecos = [];
    if (coc.length && coc[0].start.getTime() - t0 >= LIM && isFinite(t0)) huecos.push([t0, coc[0].start.getTime(), true]);
    for (let i = 1; i < coc.length; i++) {
      const a = coc[i - 1].end.getTime();
      const z = coc[i].start.getTime();
      if (z - a >= LIM && z > t0) huecos.push([Math.max(a, t0), z, a < t0]);
    }
    huecos.forEach(([a, z, desde]) => {
      const n = aseos.filter((x) => x.start.getTime() < z && x.end.getTime() > a).length;
      ev.push({ ms: a, area: "Cocinas", dur: z - a, desde, que: "Sin cocimientos", det: n ? `${n} aseo(s) en ese tiempo` : "" });
    });
    ev.sort((x, y) => x.ms - y.ms || x.area.localeCompare(y.area));
    const ultimo = coc.length ? coc[coc.length - 1].end : null;
    const filas = ev
      .map((e) => `<tr><td>${esc(fmtDateTime(new Date(e.ms)))}${e.desde ? ' <small>(viene de antes del I0)</small>' : ""}</td><td><span class="ini-area ${e.area === "Cocinas" ? "coc" : ""}">${esc(e.area)}</span></td><td class="num">${e.dur == null ? "hasta el fin del plan" : esc(durTxt(e.dur))}</td><td>${esc(e.que)}${e.det ? `<small>${esc(e.det)}</small>` : ""}</td></tr>`)
      .join("");
    return `<section class="ini-sec">
      <div class="ini-sec-h"><h2>Eventos de modulación</h2><span>Paradas de líneas de 2 h o más y cocinas sin cocimientos 12 h o más, desde el I0.</span><button class="ini-link" data-goto="view-gantt-plan">Ver en el Gantt <span aria-hidden="true">→</span></button></div>
      ${ev.length
        ? `<div class="table-scroll ini-tabla-wrap"><table class="ini-tabla ini-eventos"><thead><tr><th>Desde</th><th>Línea / área</th><th class="num">Duración</th><th>Motivo</th></tr></thead><tbody>${filas}</tbody></table></div>`
        : `<p class="ini-vacio">No hay paradas de líneas ni de cocinas en lo que queda del plan.</p>`}
      ${ultimo ? `<p class="ini-nota ini-nota-sep">El plan de cocinas termina con el cocimiento del ${esc(fmtDateTime(ultimo))}: después no trae más cocimientos porque solo cocina lo que pide el envasado cargado.</p>` : ""}
    </section>`;
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
          ${faltaPlan ? `<div class="ini-hero-acc"><button class="btn primary" data-goto="view-datos">Cargar los archivos de la semana</button><small>¿Le pasaron el paquete de la semana? También se carga en «Datos de entrada».</small></div>` : ""}
        </div>

        ${faltaPlan ? "" : `<div class="ini-grid ini-grid-2">${cardEnvasado()}${cardCocinas()}</div>${porSemana()}${eventosModulacion()}${atencion()}`}

        ${(() => {
          // La lista completa está en «Datos de entrada»; aquí solo lo que falta.
          const faltan = arch.filter((a) => !a.ok);
          return faltaPlan || !faltan.length
            ? ""
            : `<p class="ini-faltan">Sin cargar: ${faltan.map((a) => esc(a.t)).join(", ")} · <button class="ini-link" data-goto="view-datos">Ir a Datos de entrada <span aria-hidden="true">→</span></button></p>`;
        })()}
      </div>`;
  }

  window.renderInicio = renderInicio;
})();
