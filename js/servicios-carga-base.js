/* =========================================================================
   CARGA BASE · consumo nominal con un área parada
   -------------------------------------------------------------------------
   Para cada área (planta, envasado y cada línea, elaboración, cocinas,
   filtración) busca los días en que su producción fue menor que un
   porcentaje (5 % por defecto) de su promedio diario y resume lo que se
   consumió esos días: electricidad, vapor, agua y térmica.

   Usa lo que ya quedó guardado al cargar el Excel «Indicadores de
   servicios» (históricos depurados de cada serie y la producción diaria),
   así que se puede recalcular con otro umbral sin volver a leer el Excel.
   Queda guardado en este navegador hasta que se cargue otro Excel o se
   pulse «Limpiar datos».
   ========================================================================= */
(function (raiz) {
  "use strict";
  const enNode = typeof module !== "undefined" && module.exports;

  // Áreas: qué producción tiene que estar por debajo del umbral (todas a la vez).
  const AREAS = [
    { id: "planta", nombre: "Planta completa", parada: ["env", "coc", "fil"], texto: "sin envasar, sin cocinar y sin filtrar" },
    { id: "envasado", nombre: "Envasado (todas las líneas)", parada: ["env"], texto: "sin envasar" },
    { id: "L5", nombre: "Línea 5", parada: ["L5"], texto: "línea 5 parada" },
    { id: "L7", nombre: "Línea 7", parada: ["L7"], texto: "línea 7 parada" },
    { id: "L8", nombre: "Línea 8", parada: ["L8"], texto: "línea 8 parada" },
    { id: "L9", nombre: "Línea 9 (PET)", parada: ["L9"], texto: "línea 9 parada" },
    { id: "elaboracion", nombre: "Elaboración", parada: ["coc", "fil"], texto: "sin cocinar y sin filtrar" },
    { id: "cocinas", nombre: "Cocinas", parada: ["coc"], texto: "sin cocinar" },
    { id: "filtracion", nombre: "Filtración y cavas", parada: ["fil"], texto: "sin filtrar" },
  ];
  // [área, servicio, fuente, clave, unidad, nota]
  //   fuente: ind = servicios-industriales, elab = elaboración, env = envasado (por línea), envsum = suma de líneas
  const SERIES = [
    ["planta", "electricidad", "ind", "elec_planta_oficial", "kWh", "ISAGEN menos perímetros"],
    ["planta", "vapor", "ind", "vapor_planta_oficial", "kg", "Gran total de Contadores vapor"],
    ["planta", "agua", "ind", "agua_planta", "hL", ""],
    ["planta", "térmica", "ind", "termica_planta_oficial", "MJ", "gas + biogás + GLP"],
    ["planta", "electricidad de servicios", "ind", "elec_servicios_medido", "kWh", "refrigeración, aire, CO2, calderas, agua y maquinaria"],
    ["envasado", "electricidad", "envsum", "electricidad", "kWh", "4 líneas + auxiliares"],
    ["envasado", "vapor", "envsum", "vapor", "kg", "4 líneas"],
    ["envasado", "agua", "envsum", "agua", "hL", "4 líneas"],
    ["envasado", "electricidad de toda la planta", "ind", "elec_planta_oficial", "kWh", "lo que gasta la planta esos días"],
    ["elaboracion", "electricidad", "elab", "elec_elab", "kWh", "cocinas + filtración"],
    ["elaboracion", "vapor", "elab", "vapor_elab_oficial", "kg", "cocinas + cavas y filtración + secador"],
    ["elaboracion", "agua", "elab", "agua_elab", "hL", "cocinas + cavas + filtración"],
    ["cocinas", "electricidad", "elab", "elec_cocinas", "kWh", ""],
    ["cocinas", "vapor", "elab", "vapor_cocina_oficial", "kg", ""],
    ["cocinas", "agua", "elab", "agua_cocinas", "hL", ""],
    ["cocinas", "electricidad de toda la planta", "ind", "elec_planta_oficial", "kWh", "lo que gasta la planta esos días"],
    ["filtracion", "electricidad", "elab", "elec_filtracion", "kWh", "filtración"],
    ["filtracion", "vapor", "elab", "vapor_cyf_oficial", "kg", "cavas y filtración"],
    ["filtracion", "agua", "elab", "agua_filtracion", "hL", "filtración"],
  ];
  for (const l of ["L5", "L7", "L8", "L9"]) for (const [s, u] of [["electricidad", "kWh"], ["vapor", "kg"], ["agua", "hL"]]) SERIES.push([l, s, "env", s, u, s === "electricidad" ? "contador de la línea, sin auxiliares" : ""]);

  function cuantil(a, q) {
    if (!a.length) return null;
    const b = a.slice().sort((x, y) => x - y), p = (b.length - 1) * q, i = Math.floor(p), f = p - i;
    return i + 1 < b.length ? b[i] * (1 - f) + b[i + 1] * f : b[i];
  }
  const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

  // Producción por día y área: { fecha: { coc, fil, env, L5, L7, L8, L9 } } y promedios del periodo.
  function produccion(B) {
    const prod = new Map();
    for (const [f, coc, fil, env] of B.produccion_diaria || []) prod.set(f, { coc, fil, env });
    for (const h of B.historico || []) {
      if (h.s !== "electricidad" || !/^L\d$/.test(h.l) || !prod.has(h.f)) continue;
      prod.get(h.f)[h.l] = h.P || 0;
    }
    const dias = [...prod.keys()].sort();
    const medias = {};
    for (const k of ["coc", "fil", "env", "L5", "L7", "L8", "L9"]) medias[k] = media(dias.map((f) => prod.get(f)[k] || 0));
    return { prod, dias, medias };
  }
  // Valores de una serie por día (sin los días excluidos por mala lectura).
  function valores(B, fuente, clave) {
    const out = new Map();
    const usar = (e) => e !== "excluido" && e !== "fuera_de_periodo";
    if (fuente === "ind" || fuente === "elab") {
      const M = fuente === "ind" ? B.industriales : B.elaboracion;
      const m = M && M.modelos[clave];
      if (!m) return null;
      for (const h of m.historico) if (h.c !== null && usar(h.e)) out.set(h.f, h.c);
      return out;
    }
    if (fuente === "envsum") {
      const lineas = clave === "electricidad" ? ["L5", "L7", "L8", "L9", "AUX"] : ["L5", "L7", "L8", "L9"];
      const g = new Map();
      for (const h of B.historico || []) {
        if (h.s !== clave || !lineas.includes(h.l)) continue;
        if (!g.has(h.f)) g.set(h.f, {});
        g.get(h.f)[h.l] = h.C !== null && usar(h.e) ? h.C : null;
      }
      for (const [f, x] of g) if (lineas.every((l) => x[l] !== null && x[l] !== undefined)) out.set(f, lineas.reduce((s, l) => s + x[l], 0));
      return out;
    }
    return out;
  }

  function calcular(B, umbral) {
    if (!B || !B.produccion_diaria) return null;
    const u = umbral || 0.05;
    const { prod, dias, medias } = produccion(B);
    const filas = [];
    for (const A of AREAS) {
      const parados = dias.filter((f) => A.parada.every((k) => (prod.get(f)[k] || 0) < u * medias[k]));
      const operando = new Set(dias.filter((f) => A.parada.every((k) => (prod.get(f)[k] || 0) >= u * medias[k])));
      for (const [area, servicio, fuente, clave, unidad, nota] of SERIES) {
        if (area !== A.id) continue;
        let v = null;
        if (fuente === "env") {
          v = new Map();
          for (const h of B.historico || []) if (h.l === area && h.s === clave && h.C !== null && h.e !== "excluido") v.set(h.f, h.C);
        } else v = valores(B, fuente, clave);
        if (!v) continue;
        const base = parados.filter((f) => v.has(f)).map((f) => ({ f, c: v.get(f) }));
        const op = [...operando].filter((f) => v.has(f)).map((f) => v.get(f));
        const c = base.map((x) => x.c);
        // Referencia cuando casi no hay días parados: consumo fijo con el área en marcha (corte de la recta).
        let fijo = null;
        const M = fuente === "ind" ? B.industriales : fuente === "elab" ? B.elaboracion : null;
        if (M && M.modelos[clave] && M.modelos[clave].fijo_operando != null) fijo = Math.max(0, M.modelos[clave].fijo_operando);
        filas.push({
          area: A.id, area_nombre: A.nombre, condicion: A.texto, servicio, unidad, nota,
          dias_parada: parados.length, n: c.length, mediana: cuantil(c, 0.5), p10: cuantil(c, 0.1), p90: cuantil(c, 0.9),
          min: c.length ? Math.min(...c) : null, max: c.length ? Math.max(...c) : null, media: media(c),
          operando: media(op), n_operando: op.length, fijo_en_marcha: fijo, detalle: base,
        });
      }
    }
    return { umbral: u, medias, desde: dias[0], hasta: dias[dias.length - 1], filas };
  }

  /* ------------------------------------------------------------ interfaz */
  const U = { umbral: 0.05, area: "planta" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d) => (v == null || !isFinite(v) ? "—" : raiz.SrvDatos.numEs(v, d || 0));
  const pct = (v, d) => (v == null || !isFinite(v) ? "—" : raiz.SrvDatos.pctEs(v, d === undefined ? 0 : d));
  const fc = (f) => f.slice(8, 10) + "/" + f.slice(5, 7);
  const GRANDE = { kWh: [1000, "MWh", 1], kg: [1000, "t", 1], hL: [10, "m³", 0], MJ: [1000, "GJ", 0] };
  const COLOR = { electricidad: "var(--srv-elec)", "electricidad de servicios": "var(--srv-elec)", "electricidad de toda la planta": "var(--srv-elec)", vapor: "var(--srv-vapor)", agua: "var(--srv-agua)", "térmica": "var(--srv-term)" };

  function renderCargaBase() {
    const cont = raiz.document && document.getElementById("cargaBasePanel");
    if (!cont) return;
    const B = typeof raiz.srvCargar === "function" ? raiz.srvCargar() : null;
    const R = B ? calcular(B, U.umbral) : null;
    let cuerpo;
    if (!B) cuerpo = `<div class="srv-vacio"><h4>Sin datos de servicios todavía</h4><p>Carga el Excel <b>«Indicadores de servicios»</b> en «Consumos de servicios». La carga base se calcula con el mismo archivo y queda guardada en este navegador hasta que cargues otro o pulses «Limpiar datos».</p><button class="btn primary" data-goto-cb="view-servicios">Ir a Consumos de servicios</button></div>`;
    else if (!R) cuerpo = `<div class="srv-vacio"><h4>Falta recalcular</h4><p>Los modelos guardados se crearon antes de este módulo. Vuelve a cargar el Excel de Indicadores de servicios una vez para guardar también la producción diaria.</p><button class="btn primary" data-goto-cb="view-servicios">Ir a Consumos de servicios</button></div>`;
    else cuerpo = vista(B, R);
    cont.innerHTML = `
      <div class="panel srv">
        <div class="panel-head"><h3>Carga base</h3><span class="sub">Consumo nominal de cada área cuando está parada (producción por debajo del ${pct(U.umbral)} de su promedio)</span></div>
        <div class="panel-body">${cuerpo}</div>
      </div>`;
    cont.querySelectorAll("[data-goto-cb]").forEach((b) => (b.onclick = () => { const x = document.querySelector(`.sb-item[data-view="${b.dataset.gotoCb}"]`); if (x) x.click(); }));
    cont.querySelectorAll("[data-cbu]").forEach((b) => (b.onclick = () => { U.umbral = Number(b.dataset.cbu); renderCargaBase(); }));
    cont.querySelectorAll("[data-cba]").forEach((b) => (b.onclick = () => { U.area = b.dataset.cba; renderCargaBase(); }));
    const lim = cont.querySelector("#cbLimpiar");
    if (lim) lim.onclick = () => { U.confirmar = true; renderCargaBase(); };
    const si = cont.querySelector("#cbLimpiarSi"), no = cont.querySelector("#cbLimpiarNo");
    if (si) si.onclick = () => { U.confirmar = false; if (typeof raiz.srvLimpiar === "function") raiz.srvLimpiar(); };
    if (no) no.onclick = () => { U.confirmar = false; renderCargaBase(); };
    if (R && raiz.SrvCharts) raiz.SrvCharts.conectarTips(cont);
  }

  function vista(B, R) {
    const areas = AREAS.filter((A) => R.filas.some((f) => f.area === A.id));
    const sel = R.filas.filter((f) => f.area === U.area);
    const A = AREAS.find((a) => a.id === U.area) || AREAS[0];
    const guardado = B.guardado_en ? new Date(B.guardado_en).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    // Una fila por área y una columna por servicio: carga base (mediana de los días parados)
    // y cuánto es frente al promedio con el área operando.
    const COLS = [["electricidad", "Electricidad"], ["vapor", "Vapor"], ["agua", "Agua"]];
    const celda = (f) => {
      if (!f) return '<td class="n muted">—</td>';
      if (!f.n) return `<td class="n"><span class="muted">sin días</span>${f.fijo_en_marcha != null ? `<br><small class="muted" title="Fijo con el área en marcha (corte de la recta), no es una medición con el área parada">fijo ≈ ${nf(f.fijo_en_marcha)} ${f.unidad}</small>` : ""}</td>`;
      return `<td class="n" title="${f.n} día(s) · rango ${nf(f.p10)} – ${nf(f.p90)} ${f.unidad}">${nf(f.mediana)} <small class="muted">${f.unidad}</small>${f.operando ? `<br><small class="muted">${pct(f.mediana / f.operando)} de operando (${nf(f.operando)})</small>` : ""}</td>`;
    };
    const resumen = areas.map((a) => {
      const fs = R.filas.filter((f) => f.area === a.id);
      const d = fs[0] ? fs[0].dias_parada : 0;
      return `<tr class="${a.id === U.area ? "sel" : ""}"><td><button class="srv-link" data-cba="${a.id}">${esc(a.nombre)}</button><br><small class="muted">${esc(a.texto)}</small></td><td class="n">${d}</td>${COLS.map(([s]) => celda(fs.find((f) => f.servicio === s))).join("")}</tr>`;
    }).join("");
    const det = sel.map((f) => {
      const ref = f.n ? f.mediana : f.operando;
      const g = ref != null && Math.abs(ref) < 10 * GRANDE[f.unidad][0] ? [1, f.unidad, 0] : GRANDE[f.unidad];
      return `<div class="srv-kpi" style="--c:${COLOR[f.servicio] || "var(--srv-aux)"}"><span>${esc(f.servicio[0].toUpperCase() + f.servicio.slice(1))}${f.nota ? ` <small class="muted">· ${esc(f.nota)}</small>` : ""}</span>
        <b>${f.n ? nf(f.mediana / g[0], g[2]) : "—"} <small>${g[1]}/día</small></b>
        <small>${f.n ? `${f.n} día(s) · rango ${nf(f.p10 / g[0], g[2])} – ${nf(f.p90 / g[0], g[2])} ${g[1]}` : "ningún día con el área parada"}${f.operando ? ` · operando ${nf(f.operando / g[0], g[2])} ${g[1]}/día` : ""}${!f.n && f.fijo_en_marcha != null ? ` · fijo en marcha ≈ ${nf(f.fijo_en_marcha / g[0], g[2])} ${g[1]}` : ""}</small></div>`;
    }).join("");
    const dias = [...new Set(sel.flatMap((f) => f.detalle.map((x) => x.f)))].sort();
    const tablaDias = dias.length ? `<div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th>${sel.map((f) => `<th class="n">${esc(f.servicio)} (${f.unidad})</th>`).join("")}</tr></thead><tbody>${dias.map((d) => `<tr><td>${esc(d)}</td>${sel.map((f) => { const x = f.detalle.find((y) => y.f === d); return `<td class="n">${x ? nf(x.c) : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>` : "";
    return `
      <div class="srv-barra">
        <div class="srv-estado"><span class="srv-chip ok">Datos ${esc(R.desde)} → ${esc(R.hasta)}</span>${guardado ? `<span class="srv-chip ok" title="Queda en este navegador hasta que cargues otro Excel o pulses «Limpiar datos».">Guardado en este navegador · ${esc(guardado)}</span>` : ""}</div>
        <div class="srv-acciones">${U.confirmar ? '<span class="srv-confirma">¿Borrar los modelos y la carga base guardados en este navegador? <button class="btn small danger" id="cbLimpiarSi">Sí, borrar</button><button class="btn small" id="cbLimpiarNo">Cancelar</button></span>' : '<button class="btn small" id="cbLimpiar">Limpiar datos</button>'}</div>
      </div>
      <div class="srv-filtros"><div class="srv-campo"><label>Área parada si su producción es menor que</label><div class="srv-seg">${[[0.05, "5 % del promedio"], [0.1, "10 % del promedio"]].map(([x, t]) => `<button type="button" data-cbu="${x}" class="${U.umbral === x ? "on" : ""}">${t}</button>`).join("")}</div></div></div>
      <div class="srv-card"><div class="srv-card-t">Consumo con el área parada <small class="muted">· mediana por día de los días parados; elige un área para ver el detalle, la planta y los días</small></div>
        <div class="srv-tabla-wrap" style="max-height:none"><table class="srv-tabla"><thead><tr><th>Área</th><th class="n">Días parada</th>${COLS.map(([, t]) => `<th class="n">${t}</th>`).join("")}</tr></thead><tbody>${resumen}</tbody></table></div>
        <p class="muted">Promedio de producción del periodo: envasado ${nf(R.medias.env)} hL/día, cocinados ${nf(R.medias.coc)}, filtrados ${nf(R.medias.fil)}; L5 ${nf(R.medias.L5)}, L7 ${nf(R.medias.L7)}, L8 ${nf(R.medias.L8)}, L9 ${nf(R.medias.L9)}. Un área cuenta como parada el día en que su producción queda por debajo del ${pct(R.umbral)} de ese promedio.</p>
      </div>
      <div class="srv-card"><div class="srv-card-t">${esc(A.nombre)} parada <small class="muted">· ${esc(A.texto)} · ${sel[0] ? sel[0].dias_parada : 0} día(s) en el periodo</small></div>
        <div class="srv-kpis">${det}</div>
        ${sel.length && !sel.some((f) => f.n) ? `<div class="srv-aviso info">En el periodo no hubo ningún día con esta área parada. «Fijo en marcha» es el consumo que queda al llevar la recta a producción cero: sirve de referencia, no es una medición con el área parada.</div>` : ""}
        ${sel.some((f) => f.n && f.n <= 2) ? '<div class="srv-aviso info">Con 2 días o menos, la cifra es orientativa: puede ser un día festivo o de arranque.</div>' : ""}
        ${tablaDias ? `<details class="srv-det"><summary class="srv-card-t">Días con el área parada</summary>${tablaDias}</details>` : ""}
      </div>
      <p class="muted">Se usan los valores depurados de «Consumos de servicios» y «Servicios industriales» (sin lecturas excluidas por error). Electricidad de las líneas: contador de cada línea, sin los auxiliares compartidos. Envasado completo: las cuatro líneas más auxiliares, solo los días con todas las lecturas.</p>`;
  }

  const api = { AREAS, SERIES, calcular };
  if (enNode) module.exports = api;
  else { raiz.SrvBase = api; raiz.renderCargaBase = renderCargaBase; }
})(typeof window !== "undefined" ? window : globalThis);
