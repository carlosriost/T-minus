/* =========================================================================
   SERVICIOS INDUSTRIALES · interfaz (módulo aparte)
   -------------------------------------------------------------------------
   Refrigeración, aire comprimido, planta de CO2, calderas, sistema de agua,
   BTS, maquinaria auxiliar y periféricos: cuánto pesan en la planta, cuánto
   se espera que consuman con el plan, una calculadora de un día, qué tan
   certeros son los modelos, cuánto es fijo y qué datos se corrigieron.
   Usa los modelos de servicios-industriales.js, entrenados al cargar el
   Excel «Indicadores de servicios» en «Consumos de servicios».
   ========================================================================= */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d) => (v == null || !isFinite(v) ? "—" : SrvDatos.numEs(v, d || 0));
  const pct = (v, d) => (v == null || !isFinite(v) ? "—" : SrvDatos.pctEs(v, d === undefined ? 1 : d));
  const fc = (f) => f.slice(8, 10) + "/" + f.slice(5, 7);
  const U = { vista: "resumen", variante: "oficial", coc: "", fil: "", env: "", hist: "elec_refrigeracion" };
  const VISTAS = [["resumen", "Resumen"], ["plan", "Proyección del plan"], ["indicadores", "Indicadores por hL"], ["calc", "Calculadora"], ["precision", "Precisión"], ["fijo", "Fijo y carga base"], ["historico", "Histórico"], ["calidad", "Calidad de datos"]];
  const NOMBRE_MODELO = { media: "Promedio", ratio: "Proporcional", lineal: "Recta", huber: "Recta robusta", segmentada: "Segmentada", polinomica: "Polinómica", spline: "Spline" };
  const SERV = {
    electricidad: { nombre: "Electricidad", u: "kWh", color: "var(--srv-elec)", g: [1000, "MWh", 1] },
    agua: { nombre: "Agua", u: "hL", color: "var(--srv-agua)", g: [10, "m³", 0] },
    vapor: { nombre: "Vapor", u: "kg", color: "var(--srv-vapor)", g: [1000, "t", 0] },
    "térmica": { nombre: "Térmica", u: "MJ", color: "var(--srv-term)", g: [1000, "GJ", 0] },
    "térmica comprada": { nombre: "Térmica comprada", u: "MJ", color: "var(--srv-term)", g: [1000, "GJ", 0] },
    "agua reciclada": { nombre: "Agua reciclada", u: "hL", color: "var(--srv-agua)", g: [10, "m³", 0] },
    "CO2 recolectado": { nombre: "CO2 recolectado", u: "kg", color: "var(--srv-co2)", g: [1000, "t", 1] },
    "CO2 consumido": { nombre: "CO2 consumido", u: "kg", color: "var(--srv-co2)", g: [1000, "t", 1] },
  };
  // Composición de los gráficos apilados. Refrigeración en electricidad va
  // siempre por contador (solo compresores): la versión oficial ya incluye
  // parte de maquinaria auxiliar y se contaría dos veces.
  const PILA = {
    electricidad: [["elec_refrigeracion", "Refrigeración (compresores)", "#5b8fd1", "contador"], ["elec_maquinaria", "Maquinaria auxiliar", "#9aa0a7"], ["elec_aire", "Aire comprimido", "#4aa3a0"], ["elec_co2", "Planta de CO2", "#8a7bc8"], ["elec_calderas", "Calderas", "#d08a4c"], ["elec_sistema_agua", "Sistema de agua", "#7fb3d5"]],
    agua: [["agua_refrigeracion", "Refrigeración", "#5b8fd1"], ["agua_aire", "Aire comprimido", "#4aa3a0"], ["agua_co2", "Planta de CO2", "#8a7bc8"], ["agua_calderas", "Calderas", "#d08a4c"], ["agua_bts", "BTS", "#c9a227"]],
  };
  const COLUMNAS = ["electricidad", "agua", "vapor", "térmica", "térmica comprada", "CO2 consumido", "CO2 recolectado", "agua reciclada"];

  const bundle = () => (typeof srvCargar === "function" ? srvCargar() : null);
  const clave = (I, base, v) => SrvInd.clave(I, base, v || U.variante);
  const baseDe = (s) => s.replace(/_(oficial|medido)$/, "");
  const chipQ = (q) => `<span class="srv-chip ${/Alta|Media/.test(q) ? "ok" : /Sin relación con/.test(q) ? "warn" : "bad"}" title="${esc(q)}">${esc(q)}</span>`;
  function seriesVis(I) {
    // Una por (sistema, servicio): la de la variante elegida, o la única que hay.
    const vistas = new Map();
    for (const m of Object.values(I.modelos)) {
      const b = baseDe(m.serie), k = clave(I, b);
      if (k && !vistas.has(b)) vistas.set(b, I.modelos[k]);
    }
    return [...vistas.values()].sort((a, b) => SrvInd.SISTEMAS.indexOf(a.sistema) - SrvInd.SISTEMAS.indexOf(b.sistema) || COLUMNAS.indexOf(a.servicio) - COLUMNAS.indexOf(b.servicio));
  }
  const etqV = (m) => (m.variante ? ` <small class="muted">(${esc(m.variante)})</small>` : "");

  /* ------------------------------------------------------------ render */
  // Se pinta dentro de «Consumos de servicios» (pestaña «Servicios industriales», contenedor #srvInd).
  function renderIndustriales() {
    const cont = document.getElementById("srvInd");
    if (!cont) return;
    const B = bundle(), I = B && B.industriales;
    cont.innerHTML = `
      <div>${
          !I
            ? `<div class="srv-vacio"><h4>Falta procesar los servicios industriales</h4><p>${esc((B && B.industriales_error) || "Este paquete se creó antes de que existiera este módulo.")} Vuelve a cargar el Excel <b>«Indicadores de servicios»</b> arriba: con el mismo archivo se entrenan también estos modelos (en este navegador).</p></div>`
            : `<p class="muted" style="margin:0 0 10px">Refrigeración, aire comprimido, CO2, calderas, sistema de agua, BTS y periféricos: cuánto pesan en la planta y cuánto se espera que consuman. ${Object.values(I.modelos).filter((m) => m.habilitado).length} de ${Object.keys(I.modelos).length} series con modelo confiable.</p>
               <div class="srv-filtros">
                 <div class="srv-campo"><label>Versión de los datos</label><div class="srv-seg">${[["oficial", "Oficial (Excel)"], ["contador", "Contador sin ajustes"]].map(([k, t]) => `<button type="button" data-iv="${k}" class="${U.variante === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
                 <div class="srv-campo"><label>Día de producción</label><div class="srv-seg">${[[22, "22:00 a 22:00"], [6, "06:00 a 06:00"], [0, "00:00 a 24:00"]].map(([x, t]) => `<button type="button" data-icorte="${x}" class="${srvCorte() === x ? "on" : ""}">${t}</button>`).join("")}</div></div>
               </div>
               <nav class="srv-subtabs" role="tablist">${VISTAS.map(([k, t]) => `<button role="tab" class="srv-subtab ${U.vista === k ? "on" : ""}" data-ivista="${k}">${t}</button>`).join("")}</nav><div id="indCuerpo"></div>`
        }</div>`;
    if (!I) return;
    cont.querySelectorAll("[data-iv]").forEach((b) => (b.onclick = () => { U.variante = b.dataset.iv; renderIndustriales(); }));
    cont.querySelectorAll("[data-icorte]").forEach((b) => (b.onclick = () => { srvCorte(Number(b.dataset.icorte)); renderIndustriales(); }));
    cont.querySelectorAll("[data-ivista]").forEach((b) => (b.onclick = () => { U.vista = b.dataset.ivista; renderIndustriales(); }));
    const el = $("#indCuerpo");
    try { ({ resumen: vResumen, plan: vPlan, indicadores: vIndicadores, calc: vCalc, precision: vPrecision, fijo: vFijo, historico: vHist, calidad: vCalidad })[U.vista](el, I); }
    catch (e) { console.error(e); el.innerHTML = `<p class="srv-msg bad">Error al mostrar esta vista: ${esc(e.message)}</p>`; }
    SrvCharts.conectarTips(cont);
  }

  /* ------------------------------------------------------------ resumen */
  function vResumen(el, I) {
    const vis = seriesVis(I);
    const planta = { electricidad: I.modelos[clave(I, "elec_planta")], agua: I.modelos.agua_planta, vapor: I.modelos[clave(I, "vapor_planta")], "térmica": I.modelos[clave(I, "termica_planta")] };
    // Una tabla por servicio: sistema, promedio diario, parte de la planta y si se puede proyectar.
    const grupo = (servs, titulo, nota) => {
      const filas = vis.filter((m) => servs.includes(m.servicio) && m.sistema !== "Planta");
      if (!filas.length) return "";
      return `<div><div class="srv-card-t" style="margin-top:6px">${esc(titulo)}</div>
        <div class="srv-tabla-wrap"><table class="srv-tabla srv-ind-mapa"><thead><tr><th>Sistema</th><th class="n">Promedio diario</th><th>Parte de la planta</th><th>Se puede proyectar</th></tr></thead><tbody>${filas
          .map((m) => {
            const sv = SERV[m.servicio], p = planta[m.servicio];
            const fuera = /Fuera de planta|EEPPMM/.test(m.sistema);
            const q = p && !fuera && p.media_valida ? m.media_valida / p.media_valida : null;
            return `<tr class="${m.sistema === "Total servicios" ? "srv-total" : ""}"><td title="${esc(m.descripcion)}">${esc(m.sistema)}${servs.length > 1 ? ` <small class="muted">· ${esc(sv.nombre.toLowerCase())}</small>` : ""}${etqV(m)}</td><td class="n">${nf(m.media_valida / sv.g[0], sv.g[2])} <small class="muted">${sv.g[1]}</small></td><td>${q != null ? `<span class="ind-bar"><i style="width:${Math.min(100, q * 100).toFixed(1)}%;background:${sv.color}"></i></span> ${pct(q, 0)}` : `<small class="muted">${fuera ? "aparte de la planta" : "—"}</small>`}</td><td>${chipQ(m.calidad)}</td></tr>`;
          })
          .join("")}</tbody></table></div>${nota ? `<p class="muted">${nota}</p>` : ""}</div>`;
    };
    const P = planta.electricidad, S = I.modelos[clave(I, "elec_servicios")];
    const PA = planta.agua, SA = I.modelos.agua_servicios;
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Cuánto pesa cada servicio <small class="muted">· promedio diario de los días válidos, ${esc(I.desde)} a ${esc(I.hasta)}</small></div>
        <div class="srv-kpis">
          <div class="srv-kpi" style="--c:var(--srv-elec)"><span>Electricidad de la planta</span><b>${nf(P.media_valida / 1000, 1)} <small>MWh/día</small></b><small>servicios ≈ ${S ? pct(S.media_valida / P.media_valida, 0) : "—"} (${S ? nf(S.media_valida / 1000, 1) : "—"} MWh/día)</small></div>
          <div class="srv-kpi" style="--c:var(--srv-agua)"><span>Agua de la planta</span><b>${nf(PA.media_valida / 10)} <small>m³/día</small></b><small>servicios ≈ ${SA ? pct(SA.media_valida / PA.media_valida, 0) : "—"} (${SA ? nf(SA.media_valida / 10) : "—"} m³/día)</small></div>
          <div class="srv-kpi" style="--c:var(--srv-vapor)"><span>Vapor de la planta${etqV(planta.vapor)}</span><b>${nf(planta.vapor.media_valida / 1000)} <small>t/día</small></b><small>${nf(planta.vapor.media_valida / Math.max(1, I.medias.env), 1)} kg por hL envasado</small></div>
          <div class="srv-kpi" style="--c:var(--srv-term)"><span>Energía térmica${etqV(planta["térmica"])}</span><b>${nf(planta["térmica"].media_valida / 1000)} <small>GJ/día</small></b><small>${nf(planta["térmica"].media_valida / Math.max(1, I.medias.env), 1)} MJ por hL envasado (gas, biogás y GLP)</small></div>
        </div>
        <div class="srv-grid2">
          ${grupo(["electricidad"], "Electricidad por sistema", U.variante === "oficial" ? "Refrigeración oficial ya incluye una parte de maquinaria auxiliar: las filas no se suman. El total de servicios cuenta cada contador una vez." : "")}
          ${grupo(["agua"], "Agua por sistema", "Periféricos = casino, taller, edificios dentro de la planta. «Entrada EEPPMM» es la suma de contadores que da el agua de la planta; «fuera de planta» se resta.")}
        </div>
        ${grupo(["CO2 consumido", "CO2 recolectado", "agua reciclada"], "Planta de CO2 y agua reciclada", "")}
        <p class="muted">«Se puede proyectar» = qué tan bien se puede proyectar ese consumo con los hL cocinados, filtrados y envasados (prueba con los últimos días, que el modelo no vio). «Sin relación con el volumen» = el consumo es casi fijo: se proyecta con su promedio. Pasa el cursor por el nombre del sistema para ver qué contadores incluye.</p>
      </div>
      <div class="srv-card"><div class="srv-card-t">Lo principal</div><ul class="srv-chequeos">${hallazgos(I).map((h) => `<li>${h}</li>`).join("")}</ul></div>`;
  }
  function hallazgos(I) {
    const m = I.modelos, a = I.auditoria, out = [];
    const v = (k) => m[clave(I, k)];
    const P = v("elec_planta"), S = v("elec_servicios");
    if (P && S) out.push(`<b>Electricidad:</b> los servicios industriales gastan ≈ ${pct(S.media_valida / P.media_valida, 0)} de la planta. Lo que más pesa es refrigeración (${nf(v("elec_refrigeracion").media_valida / 1000, 1)} MWh/día${U.variante === "oficial" ? ", con su parte de maquinaria" : ", solo compresores"}), luego maquinaria auxiliar (${nf(m.elec_maquinaria.media_valida / 1000, 1)}) y aire comprimido (${nf(v("elec_aire").media_valida / 1000, 1)}).`);
    const fijo = (k) => { const x = v(k); return x && x.fijo_operando != null && x.media_valida ? x.fijo_operando / x.media_valida : null; };
    out.push(`<b>Mucho es fijo:</b> con la planta en marcha pero sin producción se gastaría ≈ ${pct(fijo("elec_planta"), 0)} de la electricidad promedio, ${pct(fijo("agua_planta"), 0)} del agua y ${pct(fijo("vapor_planta"), 0)} del vapor (corte de la recta en cero). Bajar volumen no baja el consumo en la misma proporción.`);
    const sinRel = Object.values(m).filter((x) => x.familia === "media" && !/no confiable/.test(x.calidad)).map((x) => x.sistema + " (" + x.servicio + ")");
    if (sinRel.length) out.push(`<b>No dependen del volumen:</b> ${esc([...new Set(sinRel)].join(", "))}. Se proyectan con su promedio diario.`);
    const malos = Object.values(m).filter((x) => /no confiable/i.test(x.calidad)).map((x) => x.sistema + " (" + x.servicio + ")");
    if (malos.length) out.push(`<b>Sin proyección confiable:</b> ${esc([...new Set(malos)].join(", "))}: el consumo diario salta demasiado (lecturas intermitentes o días en cero) y ni el promedio lo predice bien. Se muestran, pero no conviene planear con ellos.`);
    if (a.doble_conteo_kwh_dia) out.push(`<b>Ojo con el TOTAL SERVICIOS del Excel:</b> suma maquinaria auxiliar y además la parte de maquinaria que ya está dentro de refrigeración; cuenta dos veces ≈ ${nf(a.doble_conteo_kwh_dia)} kWh/día. Aquí cada contador se suma una sola vez.`);
    if (a.vapor_oficial_vs_contador) out.push(`<b>Vapor:</b> el oficial de planta es ${pct(a.vapor_oficial_vs_contador, 1, true)} mayor que lo que marcan los contadores (números sumados a mano, sobre todo en cocinas y cavas). Use la versión «Contador sin ajustes» para ver lo medido.`);
    return out;
  }

  /* ------------------------------------------------------------ proyección del plan */
  function prodDias(I) {
    const pp = typeof srvProdPlan === "function" ? srvProdPlan() : null;
    if (!pp) return null;
    pp.dias.forEach((d) => (d.r = SrvInd.predecir(I, d.prod)));
    return pp;
  }
  function vPlan(el, I) {
    const pp = prodDias(I);
    if (!pp) { el.innerHTML = `<div class="srv-card"><div class="srv-card-t">Proyección del plan</div><p class="muted">Carga el plan de envasado (y el producto en proceso) para proyectar los servicios con el plan de cocinas y de envasado de T-minus. Mientras tanto, usa la calculadora.</p></div>`; return; }
    const sum = (k) => pp.dias.reduce((a, d) => a + ((d.r[k] && d.r[k].estimado) || 0), 0);
    const kpi = (base, titulo, nota) => {
      const k = clave(I, base); if (!k) return "";
      const m = I.modelos[k], sv = SERV[m.servicio];
      return `<div class="srv-kpi" style="--c:${sv.color}"><span>${esc(titulo)}${etqV(m)}</span><b>${nf(sum(k) / sv.g[0], sv.g[2])} <small>${sv.g[1]}</small></b><small>${esc(nota)} · ${esc(m.calidad)}</small></div>`;
    };
    const fuera = pp.dias.filter((d) => Object.values(d.r).some((x) => x.extrapolacion)).length;
    const pilaK = (s) => PILA[s].map(([b, t, c, v]) => [clave(I, b, v), t, c]).filter((x) => x[0]);
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Proyección del plan de T-minus <small class="muted">· ${pp.dias.length} días, del ${esc(pp.dias[0].fecha)} al ${esc(pp.dias[pp.dias.length - 1].fecha)}</small></div>
        <div class="srv-kpis ind-k3">
          ${kpi("elec_servicios", "Electricidad de servicios", "cada contador una vez")}
          ${kpi("agua_servicios", "Agua de servicios", "calderas + maquinaria")}
          ${kpi("co2_consumo", "CO2 consumido", "vaporizador + directo")}
          ${kpi("termica_planta", "Térmica (calderas)", "gas, biogás y GLP de toda la planta")}
          ${kpi("elec_planta", "Electricidad de la planta", "referencia")}
          ${kpi("agua_planta", "Agua de la planta", "referencia")}
        </div>
        ${fuera ? `<div class="srv-aviso info">En ${fuera} de ${pp.dias.length} días la producción del plan queda fuera del rango histórico (el plan de cocinas de T-minus cocina solo lo que pide envasado: ${nf(pp.dias.reduce((a, d) => a + d.prod.coc, 0) / pp.dias.length)} hL/día frente a ${nf(I.medias.coc)} en el histórico). Esos días la cifra es una extrapolación.</div>` : ""}
        ${pp.filFuente === "envasado" ? '<div class="srv-aviso info">No hay plan de filtración cargado: los hL filtrados se toman iguales a los envasados del día.</div>' : ""}
        <div class="srv-grid2">${["electricidad", "agua"].map((s) => `<div><div class="srv-card-t" style="margin-top:10px">${SERV[s].nombre} de servicios por día</div><div class="chart" id="indPila-${s}"></div><div class="srv-ley">${pilaK(s).map(([, t, c]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join("")}</div>${s === "agua" ? '<p class="muted">Suma de sistemas medidos; incluye BTS, que el «total de servicios» del Excel no cuenta.</p>' : ""}</div>`).join("")}</div>
        <details class="srv-det"><summary class="srv-card-t">Tabla día por día</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">hL coc.</th><th class="n">hL fil.</th><th class="n">hL env.</th>${pilaK("electricidad").map(([, t]) => `<th class="n">${esc(t)} (kWh)</th>`).join("")}${pilaK("agua").map(([, t]) => `<th class="n">${esc(t)} (hL)</th>`).join("")}<th>Notas</th></tr></thead><tbody>${pp.dias
          .map((d) => { const n = []; if (d.parcial) n.push("día parcial"); if (Object.values(d.r).some((x) => x.extrapolacion)) n.push("fuera de rango"); if (Object.values(d.r).some((x) => x.carga_base)) n.push("carga base"); return `<tr class="${d.parcial ? "muted" : ""}"><td>${esc(d.fecha)}</td><td class="n">${nf(d.prod.coc)}</td><td class="n">${nf(d.prod.fil)}</td><td class="n">${nf(d.prod.env)}</td>${pilaK("electricidad").concat(pilaK("agua")).map(([k]) => `<td class="n">${nf(d.r[k].estimado)}</td>`).join("")}<td class="muted">${esc(n.join(" · "))}</td></tr>`; })
          .join("")}</tbody></table></div></details>
      </div>`;
    const cats = pp.dias.map((d) => fc(d.fecha));
    ["electricidad", "agua"].forEach((s) => {
      SrvCharts.apiladas(document.getElementById("indPila-" + s), {
        W: 620, H: 260, maxEtiquetas: 10, cats,
        series: pilaK(s).map(([k, t, c]) => ({ color: c, valores: pp.dias.map((d) => d.r[k].estimado || 0), tips: pp.dias.map((d) => `${d.fecha} · ${t}: ${nf(d.r[k].estimado)} ${SERV[s].u}${d.r[k].intervalo ? ` (margen ${nf(d.r[k].intervalo[0])} – ${nf(d.r[k].intervalo[1])})` : ""}`) })),
        yLab: `${SERV[s].u}/día`, aria: `${SERV[s].nombre} de servicios por día y sistema`,
      });
    });
  }

  /* ------------------------------------------------------------ indicadores por hL */
  // Indicador = consumo de la planta / hL envasados. Para un periodo se suman consumos y hL
  // (no se promedian los indicadores diarios, que se disparan en días de poco envasado).
  const IND = [
    ["elec_planta", "Electricidad", "kWh/hL", "var(--srv-elec)", 2],
    ["agua_planta", "Agua", "hL/hL", "var(--srv-agua)", 2],
    ["termica_comprada", "Térmica comprada", "MJ/hL", "var(--srv-term)", 1],
    ["termica_planta", "Térmica total (con biogás)", "MJ/hL", "var(--srv-term)", 1],
    ["vapor_planta", "Vapor", "kg/hL", "var(--srv-vapor)", 1],
  ];
  function historicoIndicador(I, B, k) {
    const env = new Map((B.produccion_diaria || []).map((r) => [r[0], r[3]]));
    const mes = new Map();
    let C = 0, H = 0;
    for (const h of I.modelos[k].historico) {
      const e = env.get(h.f);
      if (h.c === null || !(e > 0) || (h.e !== "valido" && h.e !== "carga_base")) continue;
      const m = h.f.slice(0, 7);
      if (!mes.has(m)) mes.set(m, [0, 0]);
      mes.get(m)[0] += h.c; mes.get(m)[1] += e; C += h.c; H += e;
    }
    return { total: H ? C / H : null, mes };
  }
  function vIndicadores(el, I) {
    const B = bundle();
    if (!B.produccion_diaria) { el.innerHTML = `<div class="srv-vacio"><h4>Falta recalcular</h4><p>Vuelve a cargar el Excel de Indicadores de servicios una vez para guardar la producción diaria; con eso se calculan los indicadores por hL.</p></div>`; return; }
    const ks = IND.map(([b]) => clave(I, b)).filter(Boolean);
    const hist = Object.fromEntries(ks.map((k) => [k, historicoIndicador(I, B, k)]));
    const pp = prodDias(I);
    let planHtml = `<div class="srv-card"><div class="srv-card-t">Indicadores esperados con el plan</div><p class="muted">Carga el plan de envasado para proyectar los indicadores del plan. Abajo están los históricos.</p></div>`;
    if (pp) {
      // Los días parciales (primero y último del plan) se dejan fuera: con medio día de
      // producción el consumo fijo pesa el doble y el indicador saldría inflado.
      const completos = pp.dias.filter((d) => !d.parcial);
      const dd = completos.length ? completos : pp.dias;
      const env = dd.reduce((a, d) => a + d.prod.env, 0);
      const kpis = IND.map(([b, t, u, c, dec]) => {
        const k = clave(I, b); if (!k) return "";
        const m = I.modelos[k];
        const est = dd.reduce((a, d) => a + (d.r[k].estimado || 0), 0), lo = dd.reduce((a, d) => a + (d.r[k].intervalo ? d.r[k].intervalo[0] : 0), 0), hi = dd.reduce((a, d) => a + (d.r[k].intervalo ? d.r[k].intervalo[1] : 0), 0);
        const h = hist[k].total;
        return `<div class="srv-kpi" style="--c:${c}"><span>${esc(t)}${etqV(m)}</span><b>${nf(env ? est / env : null, dec)} <small>${u}</small></b><small>margen ${nf(lo / env, dec)} – ${nf(hi / env, dec)} · histórico ${nf(h, dec)} ${u}</small></div>`;
      }).join("");
      planHtml = `<div class="srv-card"><div class="srv-card-t">Indicadores esperados con el plan <small class="muted">· ${dd.length} días completos, ${nf(env)} hL envasados${dd.length < pp.dias.length ? " (sin el primer y el último día, que son parciales)" : ""}</small></div>
        <div class="srv-kpis">${kpis}</div>
        ${(() => { const c = pp.dias.reduce((a, d) => a + d.prod.coc, 0) / pp.dias.length; return c < 0.7 * I.medias.coc ? `<div class="srv-aviso info">El plan de cocinas de T-minus cocina ${SrvDatos.numEs(c, 0)} hL/día (en el histórico, ${SrvDatos.numEs(I.medias.coc, 0)}): solo lo que pide envasado, sin reponer inventario. Con menos cocción la planta gasta menos y el indicador por hL envasado sale más bajo que el histórico. Si Cocinas va a cocinar lo habitual, el indicador real quedará más cerca del histórico.</div>` : ""; })()}
        <p class="muted">Consumo total esperado de la planta dividido por los hL envasados del plan. «Térmica comprada» es el indicador oficial de la hoja MAESTRA (gas y GLP comprados, sin biogás). El margen suma los márgenes diarios (es conservador). Si el plan envasa menos que lo habitual, el indicador sube: una parte grande del consumo es fija.</p>
        <details class="srv-det"><summary class="srv-card-t">Día por día</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">hL envasados</th>${IND.map(([b, t, u]) => (clave(I, b) ? `<th class="n">${esc(t.split(" (")[0])} (${u})</th>` : "")).join("")}<th>Notas</th></tr></thead><tbody>${pp.dias
          .map((d) => `<tr class="${d.parcial ? "muted" : ""}"><td>${esc(d.fecha)}</td><td class="n">${nf(d.prod.env)}</td>${IND.map(([b, , , , dec]) => { const k = clave(I, b); return k ? `<td class="n">${d.prod.env > 0 ? nf(d.r[k].estimado / d.prod.env, dec) : "—"}</td>` : ""; }).join("")}<td class="muted">${d.parcial ? "día parcial" : d.prod.env < 0.3 * I.medias.env ? "poco envasado: indicador alto" : ""}</td></tr>`)
          .join("")}</tbody></table></div></details></div>`;
    }
    const meses = [...new Set(ks.flatMap((k) => [...hist[k].mes.keys()]))].sort();
    const ofi = new Map((I.oficiales || []).map((o) => [o.mes, o]));
    const kE = clave(I, "elec_planta"), kA = clave(I, "agua_planta"), kT = clave(I, "termica_comprada") || clave(I, "termica_planta"), kV = clave(I, "vapor_planta");
    const r = (k, m, dec) => { const x = k && hist[k].mes.get(m); return x && x[1] ? nf(x[0] / x[1], dec) : "—"; };
    const prec = IND.map(([b, t, u]) => { const k = clave(I, b); const m = k && I.modelos[k]; return m && m.test ? `<tr><td>${esc(t)}${etqV(m)}</td><td class="n">${pct(m.test.WAPE)}</td><td class="n">${pct(m.test_semanal.WAPE)}</td><td>${chipQ(m.calidad)}</td></tr>` : ""; }).join("");
    el.innerHTML = `${planHtml}
      <div class="srv-card"><div class="srv-card-t">Qué tan certero es el indicador <small class="muted">· días de prueba que el modelo no vio</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Indicador</th><th class="n">Error diario</th><th class="n">Error semanal</th><th>Calidad</th></tr></thead><tbody>${prec}</tbody></table></div>
        <p class="muted">El error del indicador es el mismo del consumo (se divide por los mismos hL). Para planear por semana, mire el error semanal.</p></div>
      <div class="srv-card"><div class="srv-card-t">Histórico mensual <small class="muted">· consumo del mes / hL envasados del mes (días con dato)</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Mes</th><th class="n">hL envasados</th><th class="n">kWh/hL</th><th class="n">Agua hL/hL</th><th class="n">Agua oficial (G)</th><th class="n">Térmica comprada MJ/hL${kT && I.modelos[kT].variante ? ` <small class="muted">(${esc(I.modelos[kT].variante)})</small>` : ""}</th><th class="n">Térmica oficial (V)</th><th class="n">Vapor kg/hL</th></tr></thead><tbody>${meses
          .map((m) => { const o = ofi.get(m) || {}; return `<tr><td>${esc(m)}</td><td class="n">${nf(o.env)}</td><td class="n">${r(kE, m, 2)}</td><td class="n">${r(kA, m, 2)}</td><td class="n">${nf(o.agua_hl_hl, 2)}</td><td class="n">${r(kT, m, 1)}</td><td class="n">${nf(o.termica_mj_hl, 1)}</td><td class="n">${r(kV, m, 1)}</td></tr>`; })
          .join("")}<tr class="srv-total"><td>Periodo</td><td></td><td class="n">${nf(kE && hist[kE].total, 2)}</td><td class="n">${nf(kA && hist[kA].total, 2)}</td><td></td><td class="n">${nf(kT && hist[kT].total, 1)}</td><td></td><td class="n">${nf(kV && hist[kV].total, 1)}</td></tr></tbody></table></div>
        <p class="muted">«Oficial» = indicadores diarios de la hoja MAESTRA (G y V) ponderados por los hL de cada día. El agua oficial incluye la variación de tanques (y a veces un ajuste a mano en la columna G); la de este módulo no.${U.variante === "contador" ? " Con «Contador sin ajustes», la térmica comprada quita los ajustes del GLP, así que no tiene por qué coincidir con la oficial." : ""} La térmica comprada no incluye el biogás propio (≈ 1 a 3 MJ/hL según el mes); la térmica total sí. La electricidad oficial del Excel es un acumulado del año (hoja «informe») y no se compara aquí.</p></div>`;
  }

  /* ------------------------------------------------------------ calculadora */
  function vCalc(el, I) {
    const P = { coc: U.coc === "" ? Math.round(I.medias.coc) : Number(U.coc), fil: U.fil === "" ? Math.round(I.medias.fil) : Number(U.fil), env: U.env === "" ? Math.round(I.medias.env) : Number(U.env) };
    const r = SrvInd.predecir(I, P);
    const vis = seriesVis(I);
    const sistemas = SrvInd.SISTEMAS.filter((s) => vis.some((m) => m.sistema === s));
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Calculadora de un día</div>
        <form class="srv-form" id="indF">
          <div class="srv-campo"><label for="indCoc">hL cocinados</label><input type="number" id="indCoc" min="0" step="any" value="${esc(P.coc)}"></div>
          <div class="srv-campo"><label for="indFil">hL filtrados</label><input type="number" id="indFil" min="0" step="any" value="${esc(P.fil)}"></div>
          <div class="srv-campo"><label for="indEnv">hL envasados</label><input type="number" id="indEnv" min="0" step="any" value="${esc(P.env)}"></div>
          <button class="btn primary" type="submit">Calcular</button>
        </form>
        <p class="muted srv-tipicos">Por defecto, el promedio diario de ${esc(I.desde)} a ${esc(I.hasta)}. Si envasado y cocción quedan por debajo del 5 % de su media se usa la carga base medida (hay muy pocos días así).</p>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Sistema</th><th>Servicio</th><th class="n">Estimado</th><th class="n">Margen 90 %</th><th>Calidad</th></tr></thead><tbody>${sistemas
          .flatMap((s) => vis.filter((m) => m.sistema === s).map((m) => {
            const x = r[m.serie], sv = SERV[m.servicio];
            const marcas = (x.carga_base ? ' <span class="srv-chip warn">carga base</span>' : "") + (x.extrapolacion ? ' <span class="srv-chip warn">fuera de rango</span>' : "");
            return `<tr class="${s === "Planta" || s === "Total servicios" ? "srv-total" : ""}"><td>${esc(s)}</td><td>${esc(sv.nombre)}${etqV(m)}${marcas}</td><td class="n">${x.estimado == null ? "—" : nf(x.estimado)} <small class="muted">${sv.u}</small></td><td class="n">${x.intervalo ? `${nf(x.intervalo[0])} – ${nf(x.intervalo[1])}` : "—"}</td><td>${chipQ(m.calidad)}</td></tr>`;
          }))
          .join("")}</tbody></table></div>
      </div>`;
    $("#indF").onsubmit = (e) => { e.preventDefault(); U.coc = $("#indCoc").value; U.fil = $("#indFil").value; U.env = $("#indEnv").value; renderIndustriales(); };
  }

  /* ------------------------------------------------------------ precisión */
  function vPrecision(el, I) {
    const ms = Object.values(I.modelos).sort((a, b) => SrvInd.SISTEMAS.indexOf(a.sistema) - SrvInd.SISTEMAS.indexOf(b.sistema) || COLUMNAS.indexOf(a.servicio) - COLUMNAS.indexOf(b.servicio));
    const n0 = ms.find((m) => m.n_test);
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Qué tan certera es la proyección <small class="muted">· prueba final: últimos ${n0 ? n0.n_test : "—"} días válidos, que no se usaron para elegir el modelo</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Sistema</th><th>Servicio</th><th>Variable que mejor lo explica</th><th>Modelo</th><th class="n">Error diario</th><th class="n">Error semanal</th><th class="n">Cobertura 90 %</th><th class="n">Días válidos</th><th>Calidad</th></tr></thead><tbody>${ms
          .map((m) => `<tr><td>${esc(m.sistema)}</td><td>${esc(SERV[m.servicio].nombre)}${etqV(m)}</td><td>${!m.test ? "—" : m.familia === "media" ? "ninguna (consumo fijo)" : esc(SrvElab.NOMBRE_DRIVER[m.drivers])}</td><td title="${esc(m.formula || m.modelo || "")}">${m.test ? esc(NOMBRE_MODELO[m.familia] || m.familia) + (m.cols && m.cols.length > 1 ? " múltiple" : "") + (m.politica === "reciente" ? ' <small class="muted" title="Entrenado solo con los últimos 120 días: mejoró el error de validación al menos 3 %">· últimos 120 días</small>' : "") : "—"}</td><td class="n">${m.test ? pct(m.test.WAPE) : "—"}</td><td class="n">${m.test ? pct(m.test_semanal.WAPE) : "—"}</td><td class="n">${m.test ? pct(m.cobertura, 0) : "—"}</td><td class="n">${m.n_estados.valido || 0}${m.n_estados.excluido ? ` <small class="muted">(${m.n_estados.excluido} excl.)</small>` : ""}</td><td>${chipQ(m.calidad)}</td></tr>`)
          .join("")}</tbody></table></div>
        <p class="muted">Error = WAPE (suma de errores absolutos sobre consumo real) en los días de prueba. Error semanal = lo mismo sumando por semana (lo que importa para planear). Se compararon hL cocinados, filtrados y envasados, solos y combinados, con siete tipos de modelo y validación temporal; queda el más simple dentro del 3 % del mejor. Las cifras coinciden con una réplica independiente en Python.</p>
      </div>`;
  }

  /* ------------------------------------------------------------ fijo y carga base */
  function vFijo(el, I) {
    const vis = seriesVis(I).filter((m) => m.media_valida);
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Cuánto es fijo <small class="muted">· consumo con la planta en marcha y producción cero (corte de la recta) frente al promedio</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Sistema</th><th>Servicio</th><th class="n">Fijo en marcha</th><th class="n">Promedio con producción</th><th class="n">Fijo / promedio</th><th class="n">Días con planta parada*</th><th class="n">Consumo esos días</th></tr></thead><tbody>${vis
          .map((m) => { const sv = SERV[m.servicio], cte = m.familia === "media", f = cte ? m.media_valida : m.fijo_operando != null ? Math.max(0, m.fijo_operando) : null; return `<tr><td>${esc(m.sistema)}</td><td>${esc(sv.nombre)}${etqV(m)}</td><td class="n">${nf(f)} ${sv.u}</td><td class="n">${nf(m.media_valida)} ${sv.u}</td><td class="n">${cte ? '<small class="muted">todo: no depende del volumen</small>' : f != null ? pct(Math.min(1, f / m.media_valida), 0) : "—"}</td><td class="n">${m.carga_base.n || 0}</td><td class="n">${m.carga_base.n ? nf(m.carga_base.mediana) + " " + sv.u : "—"}</td></tr>`; })
          .join("")}</tbody></table></div>
        <p class="muted">* Envasado y cocción por debajo del 5 % de su media el mismo día (para CO2 recolectado, solo cocción). La planta casi nunca para del todo (en el histórico solo pasa el 1 de enero, un día parcial), así que la carga base medida es orientativa; el «fijo en marcha» sale de todos los días y es la cifra más útil. Un fijo cercano al 100 % significa que ese consumo no depende del volumen.</p>
      </div>`;
  }

  /* ------------------------------------------------------------ histórico */
  function vHist(el, I) {
    const vis = seriesVis(I);
    if (!vis.some((m) => baseDe(m.serie) === U.hist)) U.hist = baseDe(vis[0].serie);
    const m = I.modelos[clave(I, U.hist)], sv = SERV[m.servicio];
    const h = m.historico;
    const cats = h.map((x) => fc(x.f));
    const EST = { valido: "válido", carga_base: "carga base", excluido: "excluido" };
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Histórico diario</div>
        <div class="srv-filtros"><div class="srv-campo"><label for="indHs">Serie</label><select id="indHs">${vis.map((x) => `<option value="${esc(baseDe(x.serie))}" ${baseDe(x.serie) === U.hist ? "selected" : ""}>${esc(x.sistema)} · ${esc(SERV[x.servicio].nombre)}</option>`).join("")}</select></div></div>
        <p class="muted">${esc(m.descripcion)}${m.variante ? ` · versión ${esc(m.variante)}` : ""}. ${m.n_estados.valido || 0} días válidos, ${m.n_estados.excluido || 0} excluidos${m.n_estados.carga_base ? `, ${m.n_estados.carga_base} de carga base` : ""}.</p>
        <div class="chart" id="indHist"></div>
        <div class="srv-ley"><span><i style="background:${sv.color}"></i>válido</span><span><i style="background:color-mix(in srgb, ${sv.color} 35%, transparent)"></i>excluido o carga base (pasa el cursor para ver el motivo)</span></div>
        ${h.some((x) => x.e === "excluido") ? `<details class="srv-det"><summary class="srv-card-t">Días excluidos y motivo</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">Valor</th><th>Motivo</th></tr></thead><tbody>${h.filter((x) => x.e === "excluido").map((x) => `<tr><td>${esc(x.f)}</td><td class="n">${nf(x.c)}</td><td>${esc(x.m)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
      </div>`;
    $("#indHs").onchange = (e) => { U.hist = e.target.value; renderIndustriales(); };
    SrvCharts.apiladas($("#indHist"), {
      W: 900, H: 260, maxEtiquetas: 12, cats,
      series: [
        { color: sv.color, valores: h.map((x) => (x.e === "valido" ? x.c || 0 : 0)), tips: h.map((x) => `${x.f}: ${nf(x.c)} ${sv.u}${x.m ? " · " + x.m : ""}`) },
        { color: `color-mix(in srgb, ${sv.color} 35%, transparent)`, valores: h.map((x) => (x.e !== "valido" ? Math.max(0, x.c || 0) : 0)), tips: h.map((x) => `${x.f}: ${nf(x.c)} ${sv.u} · ${EST[x.e] || x.e}${x.m ? " · " + x.m : ""}`) },
      ],
      yLab: `${sv.u}/día`, aria: `Histórico diario de ${m.sistema}, ${sv.nombre}`,
    });
  }

  /* ------------------------------------------------------------ calidad de datos */
  function vCalidad(el, I) {
    const a = I.auditoria, m = I.modelos;
    const nombre = (k) => { const x = m[k]; return x ? `${x.sistema} · ${SERV[x.servicio].nombre}${x.variante ? " (" + x.variante + ")" : ""}` : k; };
    const tramos = (t) => t.map(([x, y]) => (x === y ? fc(x) : `${fc(x)} a ${fc(y)}`)).join(", ");
    const COL = { V: "S/E 220 V (maquinaria)", AT: "S/E vapor 220 V (calderas)", CQ: "taller industrial (periféricos; contador cambiado el 01/10)", AB: "Elliot 2 (aire)", DS: "maquinaria auxiliar" };
    const fact = (a.factores || []).filter((f) => f.dias > 1);
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Qué se revisó y qué se corrigió</div>
        <ul class="srv-chequeos">
          <li><b>Dos versiones:</b> «oficial» es la celda resumen del Excel tal cual. «Contador» suma los contadores sin los números sumados o restados a mano en sus fórmulas; en vapor usa la diferencia de lecturas, que no depende del total escrito. Lo escrito a mano sin fórmula se excluye de la versión contador.</li>
          <li><b>Refrigeración (oficial):</b> el Excel le suma un porcentaje de maquinaria auxiliar que cambia según el día: ${esc((a.refrigeracion_pct || []).map((x) => `${x.pct} (${x.dias} ${x.dias === 1 ? "día" : "días"})`).join(", "))}. Por eso la versión contador usa solo los compresores Mycom, y el total de servicios cuenta maquinaria aparte, una vez.</li>
          ${a.doble_conteo_kwh_dia ? `<li><b>TOTAL SERVICIOS del Excel:</b> suma maquinaria auxiliar completa y además la parte que ya está en refrigeración: cuenta dos veces ≈ ${nf(a.doble_conteo_kwh_dia)} kWh/día. Aquí no se usa esa celda.</li>` : ""}
          ${fact.length ? `<li><b>Factores raros en contadores:</b> ${fact.map((f) => `${esc(COL[f.columna] || f.columna)}: ${esc(f.detalle.replace(/^\w+: /, ""))} — ${esc(tramos(f.tramos))} (${f.dias} días)`).join("; ")}. Esos días se excluyen de las series que usan ese contador (oficial y contador); el taller también deja marcada la electricidad de planta de octubre (≈ 0,7 % del día).</li>` : ""}
          <li><b>Ajustes manuales en la versión oficial:</b> ${Object.entries(a.ajustes || {}).map(([k, x]) => `${esc(nombre(k))}: ${x.dias} días, ${pct(x.suma / x.oficial, 1, true)} del total`).join("; ") || "ninguno"}.</li>
          ${a.vapor_oficial_vs_contador ? `<li><b>Vapor de planta:</b> el oficial es ${pct(a.vapor_oficial_vs_contador, 1, true)} mayor que los contadores (lo mismo que se vio en cocinas y cavas). El casino (≈ 0,1 %) no tiene lecturas confiables y no entra en la versión contador.</li>` : ""}
          <li><b>Agua de planta:</b> la columna «EEPPMM» del Excel no es una lectura propia: es la suma de los contadores de elaboración, envase y perímetros, con números sumados a mano en muchos días; a eso se le resta lo que va fuera de planta. No hay versión contador para el agua de planta. La suma de consumos por área difiere de la entrada en ${nf(a.agua_areas_menos_entrada_hl_dia)} hL/día en promedio; ${a.agua_dias_variacion_tanques} días tienen variación de tanques. La potabilizadora propia no operó en el periodo.</li>
          <li><b>Otros ajustes a mano detectados:</b> el «ajuste autorizado» de electricidad (ISAGEN) en ${a.ajustes && a.ajustes.elec_planta_oficial ? a.ajustes.elec_planta_oficial.dias : 0} días (la versión contador lo quita); ajustes autorizados de gas natural (esos días se excluyen de la térmica por contador); algunas lecturas «anterior» corregidas a mano y el secador en febrero restando dos días atrás (efecto pequeño, no corregido).</li>
          <li><b>Valores escritos a mano (excluidos):</b> ${Object.entries(a.escritos || {}).map(([k, l]) => `${esc(nombre(k))}: ${l.length} día(s)`).join("; ") || "ninguno"}.</li>
          <li><b>Sin proyección confiable:</b> ${esc(Object.values(m).filter((x) => /no confiable/i.test(x.calidad)).map((x) => nombre(x.serie)).join("; ") || "ninguna")}. BTS tiene muchos días en cero (uso intermitente); agua de calderas tiene días en cero seguidos de días altos (lecturas atrasadas).</li>
          <li><b>Carga base:</b> la planta casi nunca para (envasado y cocción por debajo del 5 % de su media a la vez solo el 1 de enero), así que se usa el consumo fijo en marcha (corte de la recta) para hablar de base.</li>
        </ul>
      </div>`;
  }

  window.renderIndustriales = renderIndustriales;
})();
