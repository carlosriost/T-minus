/* =========================================================================
   CONSUMOS DE SERVICIOS · 3) Interfaz
   -------------------------------------------------------------------------
   Carga el Excel «Indicadores de servicios», entrena en el navegador
   (servicios-modelos.js) y muestra: consumo esperado del plan de envasado,
   simulador, planificación manual, histórico, evaluación de modelos y
   calidad de datos. Todo queda en este navegador.
   ========================================================================= */
(function () {
  "use strict";
  const LS = "tminus.servicios.paquete";
  const LS_CFG = "tminus.servicios.cfg";
  const SERV = {
    vapor: { nombre: "Vapor", unidad: "kg", esp: "kg/hL", color: "var(--srv-vapor)" },
    electricidad: { nombre: "Electricidad", unidad: "kWh", esp: "kWh/hL", color: "var(--srv-elec)" },
    agua: { nombre: "Agua", unidad: "hL", esp: "hL/hL", color: "var(--srv-agua)" },
  };
  const COLOR_LINEA = { L5: "var(--srv-l5)", L7: "var(--srv-l7)", L8: "var(--srv-l8)", L9: "var(--srv-l9)", AUX: "var(--srv-aux)" };
  const ESC_N = { baja: "Baja", media: "Media", alta: "Alta" };
  const VISTAS = [
    ["plan", "Plan de envasado"],
    ["elaboracion", "Elaboración"],
    ["simulador", "Simulador"],
    ["planificacion", "Planificación manual"],
    ["historico", "Histórico"],
    ["evaluacion", "Evaluación de modelos"],
    ["calidad", "Calidad de datos"],
  ];
  const S = { B: null, vista: "plan", sim: { linea: "L5", cantidad: "", unidad: "hL", res: null }, hist: { linea: "L5", servicio: "vapor" }, ev: { clave: null }, cal: { servicio: "", linea: "", decision: "" }, plan: {}, planRes: null, corte: 22, estado: "", elab: { coc: "", fil: "", env: "", variante: "oficial" } };

  try { const c = JSON.parse(localStorage.getItem(LS_CFG) || "{}"); if ([0, 6, 22].includes(c.corte)) S.corte = c.corte; } catch (_) {}
  function guardarCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify({ corte: S.corte })); } catch (_) {} }

  /* ------------------------------------------------------------ utilidades */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d) => (v == null || !isFinite(v) ? "—" : SrvDatos.numEs(v, d || 0));
  const pct = (v, d) => (v == null || !isFinite(v) ? "—" : SrvDatos.pctEs(v, d === undefined ? 1 : d));
  const msF = (f) => Date.parse(f + "T00:00:00Z");
  const nomL = (l) => (l === "AUX" ? "Auxiliares compartidos" : (S.B && S.B.lineas[l]) || l);
  const claseQ = (q) => (q === "Alta" || q === "Media" ? "ok" : q === "Muy baja" ? "bad" : "warn");
  const decE = (s) => (s === "agua" ? 3 : 2);

  /* ------------------------------------------------------------ carga */
  function cargarGuardado() {
    if (S.B) return;
    try {
      const t = localStorage.getItem(LS);
      if (t) S.B = JSON.parse(t);
    } catch (_) { S.B = null; }
  }
  function guardar() {
    try { localStorage.setItem(LS, JSON.stringify(S.B)); } catch (_) { S.estado = "No se pudo guardar en este navegador (almacenamiento lleno o bloqueado): el modelo se usa solo en esta sesión."; }
  }
  function leerExcel(file) {
    S.estado = `Leyendo ${file.name}…`;
    renderServicios();
    const rd = new FileReader();
    rd.onload = (e) => {
      setTimeout(() => {
        try {
          const datos = new Uint8Array(e.target.result);
          const info = SrvDatos.hojasDelLibro(XLSX, datos, "array");
          const wb = SrvDatos.leerLibro(XLSX, datos, "array");
          S.estado = "Entrenando y validando modelos…";
          renderServicios();
          setTimeout(() => {
            try {
              S.B = SrvModelos.entrenar(wb, { archivo: file.name, hojas: info.hojas, hojas_ocultas: info.ocultas, tamano: file.size });
              try {
                S.B.elaboracion = SrvElab.entrenar(wb, { desde: S.B.fuente.primera_fecha, hasta: S.B.fuente.ultima_fecha });
              } catch (err) {
                console.error(err);
                S.B.elaboracion_error = "No se pudo procesar elaboración: " + err.message;
              }
              S.estado = `Listo: ${file.name} leído; ${Object.keys(S.B.modelos).length} modelos de envasado${S.B.elaboracion ? ` y ${Object.keys(S.B.elaboracion.modelos).length} de elaboración` : ""} validados en ${nf(S.B.segundos + (S.B.elaboracion ? S.B.elaboracion.segundos : 0), 1)} s.`;
              S.ev.clave = null;
              S.sim.res = null;
              S.planRes = null;
              guardar();
            } catch (err) {
              console.error(err);
              S.estado = "Error: " + err.message;
            }
            renderServicios();
          }, 30);
        } catch (err) {
          console.error(err);
          S.estado = "Error al leer el Excel: " + err.message;
          renderServicios();
        }
      }, 30);
    };
    rd.readAsArrayBuffer(file);
  }
  function leerPaquete(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const b = JSON.parse(rd.result);
        if (!b || b.formato !== "prediccion-servicios/1") throw new Error("no es un paquete de modelos de servicios");
        S.B = b;
        guardar();
        S.estado = `Paquete ${b.version} cargado (${file.name}).`;
      } catch (err) { S.estado = "No se pudo cargar: " + err.message; }
      renderServicios();
    };
    rd.readAsText(file);
  }

  /* ------------------------------------------------------------ render principal */
  function renderServicios() {
    const cont = document.getElementById("serviciosPanel");
    if (!cont) return;
    cargarGuardado();
    const B = S.B;
    const hab = B ? Object.values(B.modelos).filter((m) => m.habilitado).length : 0;
    cont.innerHTML = `
      <div class="panel srv">
        <div class="panel-head"><h3>Consumos de servicios</h3><span class="sub">Vapor, electricidad y agua esperados en envasado y elaboración, a partir del volumen</span></div>
        <div class="panel-body">
          <div class="srv-barra">
            <div class="srv-estado">${
              B
                ? `<span class="srv-chip ok">Modelos de ${esc(B.fuente.archivo || "Excel")}</span><span class="srv-chip">Datos ${esc(B.fuente.primera_fecha)} → ${esc(B.fuente.ultima_fecha)}</span><span class="srv-chip">${hab} de ${Object.keys(B.modelos).length} habilitados</span>`
                : '<span class="srv-chip">Sin modelos todavía</span>'
            }</div>
            <div class="srv-acciones">
              <label class="btn ${B ? "small" : "primary"}" for="srvExcel">${B ? "Actualizar con otro Excel" : "Cargar Indicadores de servicios (.xlsm)"}</label>
              <input type="file" id="srvExcel" accept=".xlsm,.xlsx" hidden />
              ${B ? '<button class="btn small" id="srvXls">Exportar resultados (Excel)</button><details class="srv-mas"><summary class="btn small">Más</summary><div><button class="btn small" id="srvJson">Exportar paquete de modelos (.json)</button><label class="btn small" for="srvJsonIn">Cargar paquete (.json)</label><input type="file" id="srvJsonIn" accept=".json" hidden /></div></details>' : ""}
            </div>
          </div>
          ${S.estado ? `<p class="srv-msg ${/^Error|No se pudo/.test(S.estado) ? "bad" : ""}">${esc(S.estado)}</p>` : ""}
          ${B ? `<nav class="srv-tabs" role="tablist">${VISTAS.map(([k, t]) => `<button role="tab" class="srv-tab ${S.vista === k ? "on" : ""}" data-srv-vista="${k}">${t}</button>`).join("")}</nav><div id="srvCuerpo"></div>` : vacio()}
        </div>
      </div>`;
    $("#srvExcel").onchange = (e) => e.target.files[0] && leerExcel(e.target.files[0]);
    if (B) {
      $("#srvXls").onclick = exportarExcel;
      $("#srvJson").onclick = () => descargar(new Blob([JSON.stringify(S.B)], { type: "application/json" }), `modelo_servicios_${S.B.version}.json`);
      $("#srvJsonIn").onchange = (e) => e.target.files[0] && leerPaquete(e.target.files[0]);
      cont.querySelectorAll("[data-srv-vista]").forEach((b) => (b.onclick = () => { S.vista = b.dataset.srvVista; renderServicios(); }));
      ({ plan: vPlan, elaboracion: vElab, simulador: vSim, planificacion: vPlanif, historico: vHist, evaluacion: vEval, calidad: vCal })[S.vista]();
    }
    SrvCharts.conectarTips(cont);
  }
  function vacio() {
    return `<div class="srv-vacio">
      <h4>¿Cuánto vapor, electricidad y agua va a consumir el plan?</h4>
      <p>Carga el Excel <b>«Indicadores de servicios»</b> (el .xlsm de MED Servicios). T-minus lee los consumos diarios de cada línea, revisa la calidad de los datos, compara siete tipos de modelo con validación temporal y se queda con el que mejor predice días que no vio.</p>
      <ul><li>Con el plan de envasado cargado, calcula el consumo esperado de cada día por línea y el de elaboración (cocinas, cavas y filtración).</li><li>Cada número sale con su margen de error real y la evidencia histórica.</li><li>Si un servicio no tiene un modelo confiable, lo dice en vez de inventar.</li></ul>
      <p class="muted">El archivo se procesa en este navegador; no se envía a ningún servidor.</p></div>`;
  }
  function descargar(blob, nombre) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ------------------------------------------------------------ datos de apoyo */
  const hist = (l, s) => S.B.historico.filter((h) => h.l === l && h.s === s);
  function curva(m, xmax) {
    if (!m || !m.habilitado || !m.web) return { curva: [], banda: [] };
    const c = [], b = [], top = Math.max(xmax, m.rango.p_max);
    for (let i = 0; i <= 120; i++) {
      const x = Math.max(1, (top * i) / 120), r = SrvPred.predecirCombinacion(m, x);
      c.push({ x, y: r.estimado });
      b.push({ x, lo: r.intervalo[0], hi: r.intervalo[1] });
    }
    return { curva: c, banda: b };
  }
  function puntos(h, color, todos) {
    const pts = [];
    h.forEach((r) => {
      if (r.C == null || r.P == null) return;
      const base = `${r.f} · ${nf(r.P)} hL → ${nf(r.C)}`;
      if (r.e === "valido") {
        if (r.a) pts.push({ x: r.P, y: r.C, color: "var(--ink)", forma: "anillo", tip: base + " · atípico estadístico (ver Calidad de datos)" });
        else if (r.d) pts.push({ x: r.P, y: r.C, color, forma: "rombo", tip: base + " · " + r.m });
        else pts.push({ x: r.P, y: r.C, color, tip: base });
      } else if (todos && r.e === "excluido") pts.push({ x: Math.max(0, r.P), y: Math.max(0, r.C), color: "var(--muted)", forma: "x", tip: base + " · EXCLUIDO: " + r.m });
      else if (todos && r.e === "sin_produccion") pts.push({ x: 0, y: r.C, color: "var(--muted)", op: 0.35, tip: r.f + " · sin producción · " + nf(r.C) });
    });
    return pts;
  }

  /* ------------------------------------------------------------ PLAN DE ENVASADO */
  // hL de cada línea por día de producción (corte a las S.corte h), a partir
  // de los bloques del plan de envasado cargado.
  function hlPorDia() {
    const st = typeof STATE !== "undefined" ? STATE : null;
    if (!st || !st.mergedByTrain) return null;
    const H = 3600000, Dd = 86400000, c = S.corte * H;
    const trenALinea = { 5: "L5", 7: "L7", 8: "L8", 9: "L9" };
    const dias = new Map();
    let ini = Infinity, fin = -Infinity;
    Object.entries(st.mergedByTrain).forEach(([t, bloques]) => {
      const ln = trenALinea[t];
      if (!ln) return;
      (bloques || []).forEach((b) => {
        if (!b.start || !b.end) return;
        const a = b.start.getTime(), z = b.end.getTime();
        ini = Math.min(ini, a);
        fin = Math.max(fin, z);
        if (b.type !== "production" || !(Number(b.hectolitros) > 0) || z <= a) return;
        let x = a;
        while (x < z) {
          const base = Math.floor((x - c) / Dd) * Dd + c;
          const hasta = Math.min(z, base + Dd);
          // El día lleva la fecha en que termina (corte 22 h → día siguiente).
          const etiqueta = new Date(base + (S.corte > 12 ? Dd : 0)).toISOString().slice(0, 10);
          if (!dias.has(etiqueta)) dias.set(etiqueta, { base, hl: {} });
          const d = dias.get(etiqueta);
          d.hl[ln] = (d.hl[ln] || 0) + (Number(b.hectolitros) * (hasta - x)) / (z - a);
          x = hasta;
        }
      });
    });
    const out = [...dias.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([f, d]) => ({ fecha: f, base: d.base, hl: d.hl, parcial: d.base < ini - 60000 || d.base + Dd > fin + 60000 }));
    return { dias: out, ini, fin };
  }
  function calcularPlanEnvasado() {
    const h = hlPorDia();
    if (!h) return null;
    const filas = h.dias.map((d) => {
      const plan = {};
      S.B && Object.keys(S.B.lineas).forEach((ln) => (plan[ln] = [d.hl[ln] || 0, "hL"]));
      return { ...d, res: SrvPred.planificar(S.B, plan) };
    });
    return { filas, ini: h.ini, fin: h.fin };
  }
  function vPlan() {
    const el = $("#srvCuerpo");
    const R = calcularPlanEnvasado();
    if (!R || !R.filas.length) {
      el.innerHTML = `<div class="srv-vacio"><h4>Falta el plan de envasado</h4><p>Carga el instructivo de envasado en <b>Datos de entrada</b> y aquí verás el vapor, la electricidad y el agua que necesita cada día del plan.</p><button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button></div>`;
      return;
    }
    const lineas = Object.keys(S.B.lineas);
    const tot = { vapor: 0, electricidad: 0, agua: 0 };
    let vaporIncompleto = false, extrap = 0;
    R.filas.forEach((f) => {
      const T = f.res.totales;
      tot.vapor += T.vapor.estimado;
      tot.electricidad += T.electricidad.estimado_con_auxiliares != null ? T.electricidad.estimado_con_auxiliares : T.electricidad.estimado;
      tot.agua += T.agua.estimado;
      if (!T.vapor.completo) vaporIncompleto = true;
      lineas.forEach((ln) => P_SERV.forEach((s) => { const x = f.res.lineas[ln].servicios[s]; if (x && x.extrapolacion) extrap++; }));
    });
    const sinVapor = R.filas.length ? R.filas[0].res.totales.vapor.lineas_sin_modelo : [];
    el.innerHTML = `
      <div class="srv-filtros">
        <div class="srv-campo"><label>Día de producción</label><div class="srv-seg">${[[22, "22:00 a 22:00"], [6, "06:00 a 06:00"], [0, "00:00 a 24:00"]].map(([v, t]) => `<button type="button" data-corte="${v}" class="${S.corte === v ? "on" : ""}">${t}</button>`).join("")}</div></div>
        <p class="muted srv-nota-corte">El de 22:00 es el que mejor cuadra la producción del plan con la del Excel de indicadores (y es el día de planeación de T-minus).</p>
      </div>
      <div class="srv-kpis">
        <div class="srv-kpi"><span>Días del plan</span><b>${R.filas.length}</b><small>${esc(R.filas[0].fecha)} → ${esc(R.filas[R.filas.length - 1].fecha)}</small></div>
        <div class="srv-kpi" style="--c:var(--srv-vapor)"><span>Vapor</span><b>${nf(tot.vapor / 1000, 0)} <small>t</small></b><small>${vaporIncompleto ? `sin ${esc(sinVapor.join(", "))} (sin modelo confiable)` : "todas las líneas"}</small></div>
        <div class="srv-kpi" style="--c:var(--srv-elec)"><span>Electricidad</span><b>${nf(tot.electricidad / 1000, 0)} <small>MWh</small></b><small>con auxiliares compartidos</small></div>
        <div class="srv-kpi" style="--c:var(--srv-agua)"><span>Agua</span><b>${nf(tot.agua / 10, 0)} <small>m³</small></b><small>${nf(tot.agua)} hL</small></div>
      </div>
      ${extrap ? `<div class="srv-aviso">⚠ En ${extrap} caso(s) línea × día la producción del plan está fuera del rango histórico: esos valores son extrapolaciones.</div>` : ""}
      ${P_SERV.map((s) => `<div class="srv-card"><div class="srv-card-t">${SERV[s].nombre} por día <small class="muted">· barras por línea${s === "electricidad" ? " + auxiliares" : ""} · raya = rango conservador del total</small></div><div class="chart" id="srvPlan-${s}"></div>
        <div class="srv-ley">${[...lineas, ...(s === "electricidad" ? ["AUX"] : [])].map((l) => `<span><i style="background:${COLOR_LINEA[l]}"></i>${esc(l === "AUX" ? "Auxiliares" : l)}</span>`).join("")}</div></div>`).join("")}
      <details class="srv-card srv-det"><summary class="srv-card-t">Tabla día por día</summary>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">Producción (hL)</th><th class="n">Vapor (kg)</th><th class="n">Electricidad (kWh)</th><th class="n">Agua (hL)</th><th>Notas</th></tr></thead><tbody>${R.filas
          .map((f) => {
            const T = f.res.totales;
            const hl = lineas.reduce((a, l) => a + (f.hl[l] || 0), 0);
            const notas = [];
            if (f.parcial) notas.push("día parcial (borde del plan)");
            if (!T.vapor.completo) notas.push("vapor sin " + T.vapor.lineas_sin_modelo.join(", "));
            const ex = lineas.filter((l) => P_SERV.some((s) => (f.res.lineas[l].servicios[s] || {}).extrapolacion));
            if (ex.length) notas.push("extrapola en " + ex.join(", "));
            const el2 = T.electricidad.estimado_con_auxiliares != null ? T.electricidad.estimado_con_auxiliares : T.electricidad.estimado;
            return `<tr class="${f.parcial ? "muted" : ""}"><td>${esc(f.fecha)}</td><td class="n">${nf(hl)}</td><td class="n">${nf(T.vapor.estimado)}</td><td class="n">${nf(el2)}</td><td class="n">${nf(T.agua.estimado)}</td><td class="muted">${esc(notas.join(" · "))}</td></tr>`;
          })
          .join("")}</tbody></table></div>
        <p class="muted">Los días sin producción en una línea suman su consumo base (mediana histórica de días parados). La electricidad incluye los auxiliares compartidos de L5, L7 y L8, calculados una vez con la producción conjunta.</p></details>`;
    el.querySelectorAll("[data-corte]").forEach((b) => (b.onclick = () => { S.corte = Number(b.dataset.corte); guardarCfg(); vPlan(); SrvCharts.conectarTips(el); }));
    const cats = R.filas.map((f) => f.fecha.slice(8, 10) + "/" + f.fecha.slice(5, 7));
    P_SERV.forEach((s) => {
      const series = lineas.map((ln) => ({ color: COLOR_LINEA[ln], valores: R.filas.map((f) => (f.res.lineas[ln].servicios[s] || {}).estimado || 0), tips: R.filas.map((f) => { const x = f.res.lineas[ln].servicios[s] || {}; return `${f.fecha} · ${ln}: ${x.habilitado === false ? "sin modelo" : nf(x.estimado) + " " + SERV[s].unidad} con ${nf(f.hl[ln] || 0)} hL`; }) }));
      if (s === "electricidad") series.push({ color: COLOR_LINEA.AUX, valores: R.filas.map((f) => (f.res.totales.electricidad_auxiliares || {}).estimado || 0), tips: R.filas.map((f) => `${f.fecha} · auxiliares: ${nf((f.res.totales.electricidad_auxiliares || {}).estimado)} kWh`) });
      const rangos = R.filas.map((f) => { const t = f.res.totales[s]; const r = s === "electricidad" && t.intervalo_conservador_con_auxiliares ? t.intervalo_conservador_con_auxiliares : t.intervalo_conservador; return r; });
      SrvCharts.apiladas(document.getElementById("srvPlan-" + s), { cats, series, rangos, marcas: R.filas.map((f) => (f.parcial ? "parcial" : "")), yLab: `${SERV[s].unidad}/día`, aria: `${SERV[s].nombre} esperado por día` });
    });
  }
  const P_SERV = ["vapor", "electricidad", "agua"];

  /* ------------------------------------------------------------ ELABORACIÓN */
  // Cocinas, cavas y filtración: consumo esperado según hL cocinados,
  // filtrados y envasados (modelos de servicios-elaboracion.js).
  const NOMBRE_MODELO = { media: "Promedio", ratio: "Proporcional", lineal: "Recta", huber: "Recta robusta", segmentada: "Segmentada", polinomica: "Polinómica", spline: "Spline" };
  const AREA_ORDEN = ["Cocinas", "Cavas y filtración", "Cavas", "Filtración", "Secador", "Elaboración"];
  const TOTAL_ELAB = (v) => ({ vapor: "vapor_elab_" + (v === "contador" ? "medido" : "oficial"), electricidad: "elec_elab", agua: "agua_elab" });
  function seriesVisibles(E, v) {
    return Object.values(E.modelos).filter((m) => m.servicio !== "vapor" || m.variante === v || (m.variante === "contador" && m.area === "Secador"));
  }
  // hL por día de producción a partir de eventos {inicio, fin, hl}, con el mismo corte del plan de envasado.
  function repartirPorDia(eventos) {
    const H = 3600000, Dd = 86400000, c = S.corte * H, out = new Map();
    for (const e of eventos) {
      let x = e.a;
      while (x < e.z) {
        const base = Math.floor((x - c) / Dd) * Dd + c, hasta = Math.min(e.z, base + Dd);
        const f = new Date(base + (S.corte > 12 ? Dd : 0)).toISOString().slice(0, 10);
        out.set(f, (out.get(f) || 0) + (e.hl * (hasta - x)) / (e.z - e.a));
        x = hasta;
      }
    }
    return out;
  }
  function planElaboracion() {
    const st = typeof STATE !== "undefined" ? STATE : null;
    if (!st || !st.seq || !st.seq.rows) return null;
    const coc = repartirPorDia(st.seq.rows.filter((r) => r.tipo === "cocimiento" && r.start && r.end && r.cocVolumenHL > 0).map((r) => ({ a: r.start.getTime(), z: Math.max(r.end.getTime(), r.start.getTime() + 60000), hl: r.cocVolumenHL })));
    if (!coc.size) return null;
    let fil = null, filFuente = "envasado";
    try {
      if (typeof buildFiltracionPlanes === "function") {
        const p = buildFiltracionPlanes();
        const seg = p && p.ok ? (p.segments || []).filter((s) => s.tipo === "fil" && s.hl > 0) : [];
        if (seg.length) { fil = repartirPorDia(seg.map((s) => ({ a: s.start.getTime(), z: s.start.getTime() + Math.max(1, s.durH * 3600000), hl: s.hl }))); filFuente = "plan de filtración"; }
      }
    } catch (e) { console.error(e); }
    const env = new Map((hlPorDia() || { dias: [] }).dias.map((d) => [d.fecha, Object.values(d.hl).reduce((a, b) => a + b, 0)]));
    const fechas = [...coc.keys()].sort();
    const desde = fechas[0], hasta = fechas[fechas.length - 1];
    const dias = [];
    for (let t = Date.parse(desde + "T00:00:00Z"); t <= Date.parse(hasta + "T00:00:00Z"); t += 86400000) {
      const f = new Date(t).toISOString().slice(0, 10);
      const e = env.get(f) || 0;
      const prod = { coc: coc.get(f) || 0, env: e, fil: fil ? fil.get(f) || 0 : e };
      dias.push({ fecha: f, prod, res: SrvElab.predecir(S.B.elaboracion, prod), parcial: f === desde || f === hasta });
    }
    return { dias, filFuente };
  }
  function filaArea(r, uni) {
    const q = r.calidad || "";
    const cl = /Alta|Media/.test(q) ? "ok" : /Sin relación/.test(q) ? "warn" : "bad";
    const marcas = (r.carga_base ? ' <span class="srv-chip warn">carga base</span>' : "") + (r.extrapolacion ? ' <span class="srv-chip warn">fuera de rango</span>' : "") + (cl === "bad" ? ' <span class="srv-chip bad" title="' + esc(q) + '">poco confiable</span>' : "");
    return `<tr><td>${esc(r.area)}${marcas}</td><td class="n">${r.estimado === null ? "—" : nf(r.estimado)} <small class="muted">${uni}</small></td><td class="n">${r.intervalo ? `${nf(r.intervalo[0])} – ${nf(r.intervalo[1])}` : "—"}</td></tr>`;
  }
  function vElab() {
    const el = $("#srvCuerpo"), E = S.B.elaboracion;
    if (!E) {
      el.innerHTML = `<div class="srv-vacio"><h4>Falta procesar elaboración</h4><p>${esc(S.B.elaboracion_error || "Este paquete se creó antes de que existiera el módulo de elaboración.")} Vuelve a cargar el Excel de Indicadores de servicios para calcularlo.</p></div>`;
      return;
    }
    const ev = S.elab, v = ev.variante;
    const vis = seriesVisibles(E, v);
    const P = { coc: ev.coc === "" ? Math.round(E.medias.coc) : Number(ev.coc), fil: ev.fil === "" ? Math.round(E.medias.fil) : Number(ev.fil), env: ev.env === "" ? Math.round(E.medias.env) : Number(ev.env) };
    const res = SrvElab.predecir(E, P);
    const tabla = (s) => {
      const rows = vis.filter((m) => m.servicio === s).sort((a, b) => AREA_ORDEN.indexOf(a.area) - AREA_ORDEN.indexOf(b.area));
      return `<div class="srv-res" style="--c:${SERV[s].color}"><div class="srv-res-cab"><h4>${SERV[s].nombre}</h4></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Área</th><th class="n">Estimado</th><th class="n">Margen 90 %</th></tr></thead><tbody>${rows.map((m) => filaArea(res[m.serie], SERV[s].unidad)).join("").replace(/<tr><td>Elaboración/, '<tr class="srv-total"><td>Elaboración (total)')}</tbody></table></div></div>`;
    };
    const plan = planElaboracion();
    const tot = TOTAL_ELAB(v);
    let planHtml = `<div class="srv-card"><div class="srv-card-t">Proyección del plan</div><p class="muted">Carga el plan de envasado (y el producto en proceso) para proyectar elaboración con el plan de cocinas de T-minus.</p></div>`;
    if (plan) {
      const sumar = (s) => plan.dias.reduce((a, d) => a + (d.res[tot[s]].estimado || 0), 0);
      planHtml = `
        <div class="srv-card"><div class="srv-card-t">Proyección del plan de T-minus <small class="muted">· ${plan.dias.length} días, del ${esc(plan.dias[0].fecha)} al ${esc(plan.dias[plan.dias.length - 1].fecha)}</small></div>
          <div class="srv-kpis">
            <div class="srv-kpi" style="--c:var(--srv-vapor)"><span>Vapor de elaboración (${v})</span><b>${nf(sumar("vapor") / 1000)} <small>t</small></b><small>con los hL cocinados del plan de cocinas</small></div>
            <div class="srv-kpi" style="--c:var(--srv-elec)"><span>Electricidad de elaboración</span><b>${nf(sumar("electricidad") / 1000, 1)} <small>MWh</small></b><small>cocinas + filtración</small></div>
            <div class="srv-kpi" style="--c:var(--srv-agua)"><span>Agua de elaboración</span><b>${nf(sumar("agua") / 10)} <small>m³</small></b><small>cocinas + cavas + filtración</small></div>
          </div>
          <div class="srv-aviso info">Los hL cocinados salen del plan de cocinas de T-minus, que solo incluye lo que pide el plan de envasado descontando el inventario (${nf(plan.dias.reduce((a, d) => a + d.prod.coc, 0) / plan.dias.length)} hL/día en promedio, frente a ${nf(E.medias.coc)} hL/día en el histórico). Si Cocinas cocina más para inventario, use la calculadora con sus hL.</div>
          ${plan.filFuente === "envasado" ? '<div class="srv-aviso info">No hay plan de filtración cargado: los hL filtrados se toman iguales a los envasados del día (en el histórico, envasado explica la filtración casi igual de bien).</div>' : ""}
          <div class="srv-grid3">${P_SERV.map((s) => `<div><div class="srv-card-t" style="margin-top:10px">${SERV[s].nombre} por día <small class="muted">· raya = margen 90 %</small></div><div class="chart" id="srvElabPlan-${s}"></div></div>`).join("")}</div>
          <details class="srv-det"><summary class="srv-card-t">Tabla día por día</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">hL cocinados</th><th class="n">hL filtrados</th><th class="n">hL envasados</th><th class="n">Vapor (kg)</th><th class="n">Electricidad (kWh)</th><th class="n">Agua (hL)</th><th>Notas</th></tr></thead><tbody>${plan.dias
            .map((d) => { const n = []; if (d.parcial) n.push("día parcial"); P_SERV.forEach((s) => { const x = d.res[tot[s]]; if (x.carga_base) n.push(`${SERV[s].nombre.toLowerCase()}: carga base`); if (x.extrapolacion) n.push(`${SERV[s].nombre.toLowerCase()}: fuera de rango`); }); return `<tr class="${d.parcial ? "muted" : ""}"><td>${esc(d.fecha)}</td><td class="n">${nf(d.prod.coc)}</td><td class="n">${nf(d.prod.fil)}</td><td class="n">${nf(d.prod.env)}</td><td class="n">${nf(d.res[tot.vapor].estimado)}</td><td class="n">${nf(d.res[tot.electricidad].estimado)}</td><td class="n">${nf(d.res[tot.agua].estimado)}</td><td class="muted">${esc(n.join(" · "))}</td></tr>`; })
            .join("")}</tbody></table></div></details>
        </div>`;
    }
    const prec = Object.values(E.modelos).filter((m) => m.test);
    el.innerHTML = `
      <div class="srv-filtros">
        <div class="srv-campo"><label>Vapor</label><div class="srv-seg">${[["oficial", "Oficial (Excel)"], ["contador", "Contador sin ajustes"]].map(([k, t]) => `<button type="button" data-ev="${k}" class="${v === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
        <div class="srv-campo"><label>Día de producción</label><div class="srv-seg">${[[22, "22:00 a 22:00"], [6, "06:00 a 06:00"], [0, "00:00 a 24:00"]].map(([x, t]) => `<button type="button" data-corte="${x}" class="${S.corte === x ? "on" : ""}">${t}</button>`).join("")}</div></div>
      </div>
      ${planHtml}
      <div class="srv-card"><div class="srv-card-t">Calculadora de un día</div>
        <form class="srv-form" id="srvFElab">
          <div class="srv-campo"><label for="srvEcoc">hL cocinados</label><input type="number" id="srvEcoc" min="0" step="any" value="${esc(P.coc)}"></div>
          <div class="srv-campo"><label for="srvEfil">hL filtrados</label><input type="number" id="srvEfil" min="0" step="any" value="${esc(P.fil)}"></div>
          <div class="srv-campo"><label for="srvEenv">hL envasados</label><input type="number" id="srvEenv" min="0" step="any" value="${esc(P.env)}"></div>
          <button class="btn primary" type="submit">Calcular</button>
        </form>
        <p class="muted srv-tipicos">Por defecto, el promedio diario de ${esc(E.desde)} a ${esc(E.hasta)}. Por debajo del 10 % de la media del área se usa su carga base medida.</p>
        <div class="srv-elab-res">${P_SERV.map(tabla).join("")}</div>
      </div>
      <div class="srv-card"><div class="srv-card-t">Qué tan certera es la proyección <small class="muted">· prueba final: últimos ${prec[0] ? prec[0].n_test : "—"} días, que no se usaron para elegir</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Área</th><th>Servicio</th><th>Variable que mejor lo explica</th><th>Modelo</th><th class="n">Error diario</th><th class="n">Error semanal</th><th class="n">Cobertura 90 %</th><th>Calidad</th></tr></thead><tbody>${prec
          .map((m) => `<tr><td>${esc(m.area)}</td><td>${esc(SERV[m.servicio].nombre)}${m.variante ? ` <small class="muted">(${esc(m.variante)})</small>` : ""}</td><td>${m.familia === "media" ? "ninguna (consumo fijo)" : esc(SrvElab.NOMBRE_DRIVER[m.drivers])}</td><td title="${esc(m.formula || m.modelo)}">${esc(NOMBRE_MODELO[m.familia] || m.familia)}${m.cols && m.cols.length > 1 ? " múltiple" : ""}</td><td class="n">${pct(m.test.WAPE)}</td><td class="n">${pct(m.test_semanal.WAPE)}</td><td class="n">${pct(m.cobertura, 0)}</td><td><span class="srv-chip ${/Alta|Media/.test(m.calidad) ? "ok" : /Sin relación/.test(m.calidad) ? "warn" : "bad"}">${esc(m.calidad)}</span></td></tr>`)
          .join("")}</tbody></table></div>
        <p class="muted">Error = WAPE (suma de errores sobre consumo real). Se compararon hL cocinados, filtrados y envasados, solos y combinados, con siete tipos de modelo y validación temporal; queda el más simple dentro del 3 % del mejor. En electricidad casi todo es carga fija: el error es bajo porque el consumo cambia poco.</p>
      </div>
      <div class="srv-card"><div class="srv-card-t">Carga base <small class="muted">· consumo con la producción del área por debajo del 10 % de su media</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Área</th><th>Servicio</th><th class="n">Días</th><th class="n">Carga base (mediana)</th><th class="n">Rango</th><th class="n">Fijo con el área operando</th><th class="n">Promedio con producción</th><th class="n">Base / promedio</th></tr></thead><tbody>${Object.values(E.modelos)
          .filter((m) => m.carga_base && m.carga_base.n && m.serie !== "vapor_cyf_medido")
          .map((m) => `<tr><td>${esc(m.area)}${m.naturales[0] === "coc" && m.area !== "Cocinas" ? ' <small class="muted">(días sin cocinar)</small>' : ""}</td><td>${esc(SERV[m.servicio].nombre)}${m.variante ? ` <small class="muted">(${esc(m.variante)})</small>` : ""}</td><td class="n">${m.carga_base.n}</td><td class="n">${nf(m.carga_base.mediana)} ${m.unidad}</td><td class="n">${nf(m.carga_base.min)} a ${nf(m.carga_base.max)}</td><td class="n">${m.fijo_operando != null && m.area !== "Elaboración" && m.area !== "Cavas" ? nf(m.fijo_operando) + " " + m.unidad : "—"}</td><td class="n">${nf(m.media_valida)} ${m.unidad}</td><td class="n">${m.media_valida ? pct(m.carga_base.mediana / m.media_valida, 0) : "—"}</td></tr>`)
          .join("")}</tbody></table></div>
        <p class="muted">«Fijo con el área operando» es el corte de la recta con producción cero: lo que se gasta por estar en marcha. La carga base es lo que queda con el área parada. Con 2 días o menos, la cifra es orientativa.</p>
      </div>
      ${auditoriaElab(E)}`;
    el.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { ev.variante = b.dataset.ev; vElab(); SrvCharts.conectarTips(el); }));
    el.querySelectorAll("[data-corte]").forEach((b) => (b.onclick = () => { S.corte = Number(b.dataset.corte); guardarCfg(); vElab(); SrvCharts.conectarTips(el); }));
    $("#srvFElab").onsubmit = (e) => { e.preventDefault(); ev.coc = $("#srvEcoc").value; ev.fil = $("#srvEfil").value; ev.env = $("#srvEenv").value; vElab(); SrvCharts.conectarTips(el); };
    if (plan) {
      const cats = plan.dias.map((d) => d.fecha.slice(8, 10) + "/" + d.fecha.slice(5, 7));
      P_SERV.forEach((s) => {
        const k = tot[s];
        SrvCharts.apiladas(document.getElementById("srvElabPlan-" + s), { W: 420, H: 230, maxEtiquetas: 6, cats, series: [{ color: SERV[s].color, valores: plan.dias.map((d) => d.res[k].estimado || 0), tips: plan.dias.map((d) => `${d.fecha}: ${nf(d.res[k].estimado)} ${SERV[s].unidad} con ${nf(d.prod.coc)} hL cocinados`) }], rangos: plan.dias.map((d) => d.res[k].intervalo), yLab: `${SERV[s].unidad}/día`, aria: `${SERV[s].nombre} de elaboración por día` });
      });
    }
  }
  function auditoriaElab(E) {
    const a = E.auditoria;
    if (!a) return "";
    const fechas = (l) => l.map((f) => f.slice(8, 10) + "/" + f.slice(5, 7)).join(", ");
    return `<details class="srv-card srv-det"><summary class="srv-card-t">Calidad de los datos de elaboración</summary>
      <ul class="srv-chequeos">
        <li><b>Vapor de cocinas:</b> ${a.cocina.dias_ajuste} de ${a.dias} días tienen números sumados a mano en la fórmula; suman ${nf(a.cocina.suma_t)} t, el ${pct(a.cocina.suma_t / a.cocina.oficial_t, 0)} del vapor oficial de cocinas.${a.cocina.fijos.length ? ` Valores escritos a mano (excluidos): ${esc(fechas(a.cocina.fijos))}.` : ""}</li>
        <li><b>Vapor de cavas y filtración:</b> ${a.cyf.dias_ajuste} de ${a.dias} días con ajuste manual. El contador lee ${nf(a.cyf.contador_antes, 1)} t/día antes del ${esc(fechas([a.cambio_contadores.cyf]))} y ${nf(a.cyf.contador_desde_cambio, 1)} t/día desde entonces, mientras el oficial sigue en ${nf(a.cyf.oficial_desde_cambio, 1)} t/día. El contador de cocina cambió de nivel el ${esc(fechas([a.cambio_contadores.cocina]))}; la suma de los dos se mantiene. Por eso hay dos versiones del vapor: oficial y contador.</li>
        <li><b>Electricidad:</b> ${a.kwh_ajustes.length ? `se quitaron ajustes manuales en ${esc(a.kwh_ajustes.map((x) => fechas([x.fecha]) + " (+" + nf(x.kwh) + " kWh)").join(", "))}` : "sin ajustes manuales"}${a.kwh_fil_fijos.length ? `; kWh/hL de filtración escrito a mano el ${esc(fechas(a.kwh_fil_fijos))} (excluido)` : ""}.</li>
        <li><b>Agua:</b> se usa la suma medida de cocinas + cavas + filtración (cuadra con el contador general de elaboración: ${a.agua_medidor_vs_suma ? pct(a.agua_medidor_vs_suma - 1, 1, true) : "—"} de diferencia). El total del Excel tiene ajustes o valores escritos a mano en ${esc(fechas(a.agua_total_ajustada))}.</li>
      </ul></details>`;
  }

  /* ------------------------------------------------------------ SIMULADOR */
  function tipicos(ln) {
    const m = S.B.modelos["electricidad|" + ln];
    return m && m.escenarios ? m.escenarios.map((e) => ({ e: e.escenario, v: e.volumen_tipico_hL })) : null;
  }
  function vSim() {
    const el = $("#srvCuerpo"), lineas = Object.keys(S.B.lineas), sm = S.sim;
    if (!lineas.includes(sm.linea)) sm.linea = lineas[0];
    const tip = tipicos(sm.linea);
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">¿Cuánto consumirá la línea en un día?</div>
        <form class="srv-form" id="srvFSim">
          <div class="srv-campo"><label for="srvSL">Línea</label><select id="srvSL">${lineas.map((l) => `<option value="${l}" ${l === sm.linea ? "selected" : ""}>${esc(S.B.lineas[l])}</option>`).join("")}</select></div>
          <div class="srv-campo"><label for="srvSC">Producción del día</label><input type="number" id="srvSC" min="0" step="any" value="${esc(sm.cantidad)}" placeholder="${sm.unidad === "L" ? "250000" : "2500"}" required /></div>
          <div class="srv-campo"><label>Unidad</label><div class="srv-seg">${["L", "hL"].map((u) => `<button type="button" data-u="${u}" class="${sm.unidad === u ? "on" : ""}">${u === "L" ? "Litros" : "Hectolitros"}</button>`).join("")}</div></div>
          <button class="btn primary" type="submit">Calcular</button>
        </form>
        ${tip ? `<p class="muted srv-tipicos">Volúmenes típicos: ${tip.map((t) => `<a href="#" data-tipico="${t.v}">${ESC_N[t.e]} ${nf(sm.unidad === "L" ? t.v * 100 : t.v)} ${sm.unidad}</a>`).join(" · ")}</p>` : ""}
        <div id="srvSimEsc"></div></div>
      <div class="srv-grid3" id="srvSimRes"></div>`;
    $("#srvSL").onchange = (e) => { sm.linea = e.target.value; sm.res = null; vSim(); };
    el.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => { const u = b.dataset.u; if (u !== sm.unidad && sm.cantidad !== "" && isFinite(Number(sm.cantidad))) sm.cantidad = String(u === "L" ? Number(sm.cantidad) * 100 : Number(sm.cantidad) / 100); sm.unidad = u; vSim(); }));
    el.querySelectorAll("[data-tipico]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); const v = Number(a.dataset.tipico); sm.cantidad = String(Math.round(sm.unidad === "L" ? v * 100 : v)); calcSim(); }));
    $("#srvFSim").onsubmit = (e) => { e.preventDefault(); sm.cantidad = $("#srvSC").value; calcSim(); };
    if (sm.res) pintarSim();
  }
  function calcSim() {
    try { S.sim.res = SrvPred.predecir(S.B, S.sim.linea, S.sim.cantidad, S.sim.unidad); } catch (e) { S.sim.res = { error: e.message }; }
    vSim();
  }
  function pintarSim() {
    const r = S.sim.res;
    if (r.error) { $("#srvSimEsc").innerHTML = `<div class="srv-aviso bad">${esc(r.error)}</div>`; return; }
    const ref = Object.values(r.servicios).find((x) => x.habilitado && x.escenario);
    const mR = ref && S.B.modelos[ref.servicio + "|" + r.linea];
    $("#srvSimEsc").innerHTML = `<div class="srv-esc"><span class="srv-chip">${nf(r.P_hL, 1)} hL = ${nf(r.P_L)} L</span>${r.P_hL === 0 ? '<span class="srv-chip warn">Día sin producción</span>' : ref ? `<span class="srv-chip ok">Escenario: ${ESC_N[ref.escenario]}</span><span class="muted">baja ≤ ${nf(mR.umbrales[0])} hL &lt; media ≤ ${nf(mR.umbrales[1])} hL &lt; alta</span>` : ""}</div>`;
    $("#srvSimRes").innerHTML = P_SERV.map((s) => tarjeta(s, r.servicios[s], r)).join("");
    P_SERV.forEach((s) => {
      const m = S.B.modelos[s + "|" + r.linea], el = document.getElementById("srvCh-" + s);
      if (!m || !el) return;
      const h = hist(r.linea, s), x = r.servicios[s], cb = curva(m, Math.max(r.P_hL, ...h.map((q) => q.P || 0)));
      SrvCharts.dispersion(el, { W: 420, H: 240, puntos: puntos(h, SERV[s].color, false), curva: cb.curva, banda: cb.banda, marcador: x.habilitado && x.estimado != null && r.P_hL > 0 ? { x: r.P_hL, y: x.estimado, lo: x.intervalo[0], hi: x.intervalo[1], tip: "Tu predicción" } : null, rango: m.rango ? [m.rango.p_min, m.rango.p_max] : null, xLab: "Producción del día (hL)", yLab: `${SERV[s].unidad}/día` });
    });
  }
  function tarjeta(s, x, r) {
    const m = S.B.modelos[s + "|" + r.linea], SV = SERV[s];
    if (!x || !x.habilitado) return `<div class="srv-res" style="--c:${SV.color}"><div class="srv-res-cab"><h4>${SV.nombre}</h4><span class="srv-chip bad">Sin predicción</span></div><div class="srv-cifra muted">No disponible</div><div class="srv-aviso bad">${esc((x && x.motivo) || "Sin modelo.")}</div>${m ? `<div class="chart" id="srvCh-${s}"></div>` : ""}</div>`;
    if (x.sin_produccion) return `<div class="srv-res" style="--c:${SV.color}"><div class="srv-res-cab"><h4>${SV.nombre}</h4><span class="srv-chip warn">Consumo base</span></div><div class="srv-cifra">${nf(x.estimado)}<small>${SV.unidad}</small></div>${x.intervalo ? `<div class="muted">P10–P90: ${nf(x.intervalo[0])} – ${nf(x.intervalo[1])}</div>` : ""}<div class="srv-aviso info">${esc(x.nota)}</div><div class="chart" id="srvCh-${s}"></div></div>`;
    const t = m.test || {};
    const extra = s === "agua" ? ` <span class="muted">= ${nf(x.estimado_m3, 1)} m³</span>` : s === "vapor" ? ` <span class="muted">= ${nf(x.estimado / 1000, 1)} t</span>` : "";
    return `<div class="srv-res" style="--c:${SV.color}">
      <div class="srv-res-cab"><h4>${SV.nombre}</h4><span class="srv-chip ${claseQ(x.calidad)}" title="${esc(x.calidad_nota)}">${esc(x.calidad)}</span></div>
      <div class="srv-cifra">${nf(x.estimado)}<small>${SV.unidad}</small>${extra}</div>
      <div class="muted">Intervalo ${pct(x.nivel_intervalo, 0)}: ${nf(x.intervalo[0])} – ${nf(x.intervalo[1])} ${SV.unidad}</div>
      ${x.aviso ? `<div class="srv-aviso">⚠ ${esc(x.aviso)}</div>` : ""}
      ${/relación/.test(x.calidad || "") ? `<div class="srv-aviso">${esc(x.calidad_nota)}</div>` : ""}
      <dl class="srv-kv"><dt>Consumo específico</dt><dd>${nf(x.especifico, decE(s))} ${SV.esp}</dd><dt>Modelo</dt><dd>${esc(x.modelo)}</dd><dt>Error real</dt><dd>${t.WAPE != null ? `${pct(t.WAPE)} en ${t.n} días de prueba` : "—"}</dd><dt>Cobertura real</dt><dd>${t.cobertura_intervalo != null ? `${pct(t.cobertura_intervalo, 0)} de los días cayó en el intervalo` : "—"}</dd><dt>Entrenado con</dt><dd>${nf(m.n_validos)} días · ${nf(m.rango.p_min)}–${nf(m.rango.p_max)} hL</dd></dl>
      <div class="chart" id="srvCh-${s}"></div></div>`;
  }

  /* ------------------------------------------------------------ PLANIFICACIÓN MANUAL */
  function vPlanif() {
    const el = $("#srvCuerpo"), lineas = Object.keys(S.B.lineas);
    lineas.forEach((l) => (S.plan[l] = S.plan[l] || ["", "hL"]));
    el.innerHTML = `<div class="srv-card"><div class="srv-card-t">Producción de cada línea en un mismo día</div>
      <div class="srv-tabla-wrap"><table class="srv-tabla srv-plan"><thead><tr><th>Línea</th><th>Producción</th><th>Unidad</th></tr></thead><tbody>${lineas.map((l) => `<tr><td>${esc(S.B.lineas[l])}</td><td><input type="number" min="0" step="any" data-pl="${l}" value="${esc(S.plan[l][0])}" placeholder="0"></td><td><select data-pu="${l}">${["hL", "L"].map((u) => `<option ${S.plan[l][1] === u ? "selected" : ""}>${u}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
      <div class="srv-form"><button class="btn primary" id="srvPlCalc">Calcular consumos</button><button class="btn small" id="srvPlXls" ${S.planRes ? "" : "disabled"}>Exportar a Excel</button></div><div id="srvPlErr"></div></div><div id="srvPlRes"></div>`;
    el.querySelectorAll("[data-pl]").forEach((i) => (i.oninput = () => (S.plan[i.dataset.pl][0] = i.value)));
    el.querySelectorAll("[data-pu]").forEach((i) => (i.onchange = () => (S.plan[i.dataset.pu][1] = i.value)));
    $("#srvPlCalc").onclick = () => {
      const p = {};
      lineas.forEach((l) => (p[l] = [S.plan[l][0] === "" ? 0 : S.plan[l][0], S.plan[l][1]]));
      try { S.planRes = SrvPred.planificar(S.B, p); } catch (e) { S.planRes = null; $("#srvPlErr").innerHTML = `<div class="srv-aviso bad">${esc(e.message)}</div>`; return; }
      vPlanif();
    };
    $("#srvPlXls").onclick = exportarPlan;
    if (S.planRes) pintarPlanif();
  }
  function filasPlan(res) {
    const out = [];
    for (const [l, x] of Object.entries(res.lineas)) for (const s of P_SERV) {
      const y = x.servicios[s];
      out.push({ linea: S.B.lineas[l], produccion_hL: x.P_hL, servicio: SERV[s].nombre, unidad: SERV[s].unidad, estimado: y.habilitado ? y.estimado : null, intervalo_inf: y.intervalo ? y.intervalo[0] : null, intervalo_sup: y.intervalo ? y.intervalo[1] : null, escenario: y.escenario ? ESC_N[y.escenario] : x.P_hL === 0 ? "Sin producción" : "", modelo: y.modelo || "", calidad: y.calidad || "", nota: y.motivo || y.aviso || y.nota || "" });
    }
    const a = res.totales.electricidad_auxiliares;
    if (a) out.push({ linea: S.B.auxiliares.nombre, produccion_hL: a.P_hL, servicio: "Electricidad", unidad: "kWh", estimado: a.estimado, intervalo_inf: a.intervalo && a.intervalo[0], intervalo_sup: a.intervalo && a.intervalo[1], escenario: a.escenario ? ESC_N[a.escenario] : "", modelo: a.modelo || "", calidad: a.calidad || "", nota: "Compartido por L5, L7 y L8: se suma una vez" });
    return out;
  }
  function pintarPlanif() {
    const r = S.planRes, T = r.totales, f = filasPlan(r);
    const tot = (s) => { const t = T[s]; return `<tr class="srv-total"><td colspan="3">Total ${SERV[s].nombre.toLowerCase()}${t.completo ? "" : ` <span class="warn-t">(incompleto: sin modelo en ${esc(t.lineas_sin_modelo.join(", "))})</span>`}</td><td class="n">${nf(s === "electricidad" && t.estimado_con_auxiliares != null ? t.estimado_con_auxiliares : t.estimado)} ${SERV[s].unidad}${s === "electricidad" && t.estimado_con_auxiliares != null ? " <small class='muted'>con auxiliares</small>" : ""}</td><td class="n">${nf((s === "electricidad" && t.intervalo_conservador_con_auxiliares ? t.intervalo_conservador_con_auxiliares : t.intervalo_conservador)[0])} – ${nf((s === "electricidad" && t.intervalo_conservador_con_auxiliares ? t.intervalo_conservador_con_auxiliares : t.intervalo_conservador)[1])}</td><td colspan="2"></td></tr>`; };
    $("#srvPlRes").innerHTML = `<div class="srv-card"><div class="srv-card-t">Consumos proyectados</div><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Línea</th><th class="n">Producción</th><th>Servicio</th><th class="n">Estimado</th><th class="n">Intervalo 90 %</th><th>Modelo · calidad</th><th>Nota</th></tr></thead><tbody>
      ${f.map((x) => `<tr><td>${esc(x.linea)}</td><td class="n">${nf(x.produccion_hL, 1)} hL</td><td>${esc(x.servicio)}</td><td class="n">${x.estimado == null ? "—" : nf(x.estimado) + " " + x.unidad}</td><td class="n">${x.intervalo_inf == null ? "—" : nf(x.intervalo_inf) + " – " + nf(x.intervalo_sup)}</td><td>${esc(x.modelo)}${x.calidad ? ` · <span class="${claseQ(x.calidad)}-t">${esc(x.calidad)}</span>` : ""}</td><td class="muted">${esc(x.nota)}</td></tr>`).join("")}
      ${P_SERV.map(tot).join("")}</tbody></table></div><p class="muted">${esc(r.nota_intervalos)}</p></div>`;
  }
  function exportarPlan() {
    if (!S.planRes) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasPlan(S.planRes)), "Proyeccion");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trazabilidad()), "Trazabilidad");
    XLSX.writeFile(wb, `proyeccion_consumos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }
  function trazabilidad() {
    const B = S.B;
    return [
      { campo: "Generado", valor: new Date().toISOString() },
      { campo: "Versión de los modelos", valor: B.version },
      { campo: "Archivo fuente", valor: B.fuente.archivo || "" },
      { campo: "Período de datos", valor: `${B.fuente.primera_fecha} a ${B.fuente.ultima_fecha}` },
      { campo: "Prueba final desde", valor: B.corte_test },
      ...Object.entries(B.modelos).map(([k, m]) => ({ campo: "Modelo " + k, valor: m.habilitado ? `${m.nombre_modelo} · ${m.formula || "no lineal"} · calidad ${m.calidad}` : "Deshabilitado: " + m.motivo })),
    ];
  }

  /* ------------------------------------------------------------ HISTÓRICO */
  function vHist() {
    const el = $("#srvCuerpo"), H = S.hist;
    const opc = [...Object.keys(S.B.lineas), ...(H.servicio === "electricidad" ? ["AUX"] : [])];
    if (!opc.includes(H.linea)) H.linea = opc[0];
    const s = H.servicio, l = H.linea, m = S.B.modelos[s + "|" + l], h = hist(l, s), val = h.filter((r) => r.e === "valido"), c = (m && m.correlaciones) || {};
    const color = l === "AUX" ? COLOR_LINEA.AUX : SERV[s].color;
    el.innerHTML = `
      <div class="srv-filtros"><div class="srv-campo"><label>Servicio</label><div class="srv-seg">${P_SERV.map((x) => `<button type="button" data-s="${x}" class="${x === s ? "on" : ""}">${SERV[x].nombre}</button>`).join("")}</div></div>
        <div class="srv-campo"><label for="srvHL">Línea</label><select id="srvHL">${opc.map((x) => `<option value="${x}" ${x === l ? "selected" : ""}>${esc(nomL(x))}</option>`).join("")}</select></div></div>
      <div class="srv-kpis">
        <div class="srv-kpi"><span>Días válidos</span><b>${nf(val.length)}</b></div>
        <div class="srv-kpi"><span>Excluidos · sin producción</span><b>${nf(h.filter((r) => r.e === "excluido").length)} · ${nf(h.filter((r) => r.e === "sin_produccion").length)}</b></div>
        <div class="srv-kpi"><span>Consumo específico</span><b>${nf(c.consumo_especifico, decE(s))}</b><small>${l === "AUX" ? "kWh/hL (L5+L7+L8)" : SERV[s].esp}</small></div>
        <div class="srv-kpi"><span>Correlación con el volumen</span><b>${nf(c.pearson, 2)}</b><small>Pearson · Spearman ${nf(c.spearman, 2)}</small></div>
      </div>
      <div class="srv-grid2">
        <div class="srv-card"><div class="srv-card-t">Producción vs. consumo</div><div class="chart" id="srvHD"></div><div class="srv-ley"><span><i style="background:${color}"></i>válido</span><span><i class="anillo"></i>atípico</span><span><i class="rombo" style="border-color:${color}"></i>ajuste manual</span><span>✕ excluido</span><span><i class="banda"></i>intervalo</span></div>${m && !m.habilitado ? `<div class="srv-aviso bad">${esc(m.motivo)}</div>` : ""}</div>
        <div class="srv-card"><div class="srv-card-t">Consumo diario en el tiempo <small class="muted">· la línea punteada marca la prueba final</small></div><div class="chart" id="srvHT"></div></div>
      </div>
      ${m && m.escenarios && m.escenarios.length ? `<details class="srv-card srv-det"><summary class="srv-card-t">Escenarios de producción (bajo, medio, alto)</summary>${tablaEsc(m, s)}</details>` : ""}`;
    el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { H.servicio = b.dataset.s; vHist(); SrvCharts.conectarTips(el); }));
    $("#srvHL").onchange = (e) => { H.linea = e.target.value; vHist(); SrvCharts.conectarTips(el); };
    const cb = curva(m, Math.max(1, ...h.map((r) => r.P || 0)));
    SrvCharts.dispersion($("#srvHD"), { puntos: puntos(h, color, true), curva: cb.curva, banda: cb.banda, xLab: l === "AUX" ? "Producción L5+L7+L8 (hL)" : "Producción del día (hL)", yLab: `${SERV[s].unidad}/día` });
    SrvCharts.lineas($("#srvHT"), { series: [{ tipo: "puntos", color, puntos: val.map((r) => ({ x: msF(r.f), y: r.C, color: r.a ? "var(--ink)" : color, tip: `${r.f}: ${nf(r.C)} ${SERV[s].unidad} con ${nf(r.P)} hL` })) }], corte: msF(S.B.corte_test), yLab: `${SERV[s].unidad}/día` });
  }
  function tablaEsc(m, s) {
    const u = SERV[s].unidad;
    return `<div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Escenario</th><th class="n">Rango (hL)</th><th class="n">Días</th><th class="n">Volumen típico</th><th class="n">Consumo medio</th><th class="n">Específico</th><th class="n">Predicción al típico</th><th class="n">Error en prueba</th></tr></thead><tbody>${m.escenarios.map((e) => `<tr><td>${ESC_N[e.escenario]}</td><td class="n">${nf(e.rango_hL[0])} – ${nf(e.rango_hL[1])}</td><td class="n">${e.n}</td><td class="n">${nf(e.volumen_tipico_hL)} hL</td><td class="n">${nf(e.consumo_medio)} ${u}</td><td class="n">${nf(e.consumo_especifico, decE(s))} ${SERV[s].esp}</td><td class="n">${nf(e.prediccion_volumen_tipico)} ${u}</td><td class="n">${e.test_WAPE != null ? pct(e.test_WAPE) + ` (${e.test_n} d)` : "—"}</td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ------------------------------------------------------------ EVALUACIÓN */
  function vEval() {
    const el = $("#srvCuerpo"), claves = Object.keys(S.B.modelos);
    if (!S.ev.clave || !S.B.modelos[S.ev.clave]) S.ev.clave = claves[0];
    const m = S.B.modelos[S.ev.clave], SV = SERV[m.servicio], t = m.test || {}, cv = m.cv || {};
    el.innerHTML = `
      <div class="srv-filtros"><div class="srv-campo"><label for="srvEC">Línea × servicio</label><select id="srvEC">${claves.map((k) => { const x = S.B.modelos[k]; return `<option value="${k}" ${k === S.ev.clave ? "selected" : ""}>${esc(nomL(x.linea))} · ${SERV[x.servicio].nombre}${x.habilitado ? "" : " (sin predicción)"}</option>`; }).join("")}</select></div></div>
      ${m.habilitado ? "" : `<div class="srv-aviso bad">${esc(m.motivo)}</div>`}
      ${m.familia ? `
      <div class="srv-kpis">
        <div class="srv-kpi"><span>Modelo elegido</span><b class="srv-kpi-txt">${esc(m.nombre_modelo)}</b><small class="${claseQ(m.calidad)}-t">${esc(m.calidad)}</small></div>
        <div class="srv-kpi"><span>Error en validación</span><b>${pct(cv.WAPE)}</b><small>${cv.n} días · ${cv.bloques} bloques</small></div>
        <div class="srv-kpi"><span>Error en la prueba final</span><b>${pct(t.WAPE)}</b><small>${t.n} días desde ${esc(m.corte_test)}</small></div>
        <div class="srv-kpi"><span>Cobertura del intervalo 90 %</span><b>${pct(t.cobertura_intervalo, 0)}</b><small>medida en la prueba final</small></div>
      </div>
      <div class="srv-card"><div class="srv-card-t">Cómo se eligió</div><p>${esc(m.regla_seleccion)} ${esc(m.calidad_nota)}</p><p class="muted">Fórmula (P en hL): <code>${esc(m.formula || "no lineal (rejilla exportada)")}</code></p></div>
      <div class="srv-grid2">
        <div class="srv-card"><div class="srv-card-t">Prueba final: real vs. predicho <small class="muted">· ✕ = fuera del intervalo</small></div><div class="chart" id="srvER"></div></div>
        <div class="srv-card"><div class="srv-card-t">Errores en el tiempo <small class="muted">· gris validación, color prueba final</small></div><div class="chart" id="srvEE"></div></div>
      </div>
      <details class="srv-card srv-det"><summary class="srv-card-t">Los ${m.candidatos.length} modelos comparados</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th></th><th>Modelo</th><th class="n">Complejidad</th><th class="n">WAPE validación</th><th class="n">MAE</th><th class="n">R²</th><th>Físico</th><th class="n">WAPE prueba</th></tr></thead><tbody>${m.candidatos.slice().sort((a, b) => a.cv_WAPE - b.cv_WAPE).map((c) => `<tr class="${c.seleccionado ? "sel" : ""}"><td>${c.seleccionado ? "✓" : ""}</td><td>${esc(c.modelo)}</td><td class="n">${c.complejidad}</td><td class="n">${pct(c.cv_WAPE)}</td><td class="n">${nf(c.cv_MAE)}</td><td class="n">${nf(c.cv_R2, 2)}</td><td class="${c.fisico_ok ? "ok-t" : "bad-t"}" title="${esc(c.fisico_nota || "")}">${c.fisico_ok ? "OK" : "No"}</td><td class="n">${pct(c.test_WAPE)}</td></tr>`).join("")}</tbody></table></div><p class="muted">Validación temporal (rolling-origin, bloques de 14 días). La prueba final es informativa: no se usó para elegir.</p></details>
      <details class="srv-card srv-det"><summary class="srv-card-t">Valores atípicos: con y sin</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Entrenamiento</th><th class="n">WAPE</th><th class="n">MAE</th></tr></thead><tbody>${Object.entries(m.comparacion_politicas || {}).map(([p, v]) => `<tr class="${p === m.politica_atipicos ? "sel" : ""}"><td>${{ todos: "Todos los días válidos", sin_atipicos: "Sin atípicos estadísticos", sin_marcados: "Sin valores con ajuste manual" }[p]}</td><td class="n">${pct(v.WAPE)}</td><td class="n">${nf(v.MAE)}</td></tr>`).join("")}</tbody></table></div><p class="muted">Se valida siempre sobre los días sin filtrar; otra política se adopta solo si baja el error al menos 3 %.</p></details>` : ""}`;
    $("#srvEC").onchange = (e) => { S.ev.clave = e.target.value; vEval(); SrvCharts.conectarTips(el); };
    if (!m.familia) return;
    const tp = m.test_predicciones || [];
    SrvCharts.dispersion($("#srvER"), { puntos: tp.map((r) => { const den = r.y >= r.lo && r.y <= r.hi; return { x: r.y, y: r.pred, color: den ? SV.color : "var(--ink)", forma: den ? null : "x", tip: `${r.fecha}: real ${nf(r.y)} · predicho ${nf(r.pred)}` }; }), diagonal: true, xLab: `Real (${SV.unidad})`, yLab: `Predicho (${SV.unidad})` });
    const rv = (m.cv_residuos || []).map((r) => ({ x: msF(r.fecha), y: r.y - r.pred, color: "var(--muted)" })), rt = tp.map((r) => ({ x: msF(r.fecha), y: r.y - r.pred, color: SV.color, tip: `${r.fecha}: ${nf(r.y - r.pred)}` }));
    SrvCharts.lineas($("#srvEE"), { series: [{ tipo: "puntos", color: "var(--muted)", puntos: rv }, { tipo: "puntos", color: SV.color, puntos: rt }], corte: msF(m.corte_test), cero: true, yMin: Math.min(0, ...rv.concat(rt).map((p) => p.y)), yLab: SV.unidad });
  }

  /* ------------------------------------------------------------ CALIDAD */
  function vCal() {
    const el = $("#srvCuerpo"), Q = S.B.calidad, f = S.cal;
    const aud = Q.auditoria.filter((a) => (!f.servicio || a.variable.startsWith(f.servicio)) && (!f.linea || a.linea === f.linea) && (!f.decision || a.decision === f.decision));
    const decs = [...new Set(Q.auditoria.map((a) => a.decision))];
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Calidad por variable</div><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Servicio</th><th>Línea</th><th class="n">Días</th><th class="n">Válidos</th><th class="n">Sin producción</th><th class="n">Excluidos</th><th>Motivo</th><th class="n">Ajuste manual</th><th class="n">Cobertura</th></tr></thead><tbody>${Q.resumen.map((r) => {
        const mot = [["residuo", r.excl_residuo], ["imputado", r.excl_imputado], ["sin dato", r.excl_sin_dato], ["negativo", r.excl_negativo], ["cero con producción", r.excl_cero_con_produccion]].filter((x) => x[1]).map((x) => `${x[0]}: ${x[1]}`).join(", ");
        return `<tr><td>${SERV[r.servicio].nombre}</td><td>${esc(nomL(r.linea))}</td><td class="n">${r.dias}</td><td class="n">${r.validos_con_produccion}</td><td class="n">${r.sin_produccion}</td><td class="n">${r.excluidos}</td><td class="muted">${esc(mot || "—")}</td><td class="n">${r.con_ajuste_manual + r.valor_escrito_a_mano}</td><td class="n ${r.cobertura_valida_pct < 90 ? "warn-t" : "ok-t"}">${nf(r.cobertura_valida_pct, 1)} %</td></tr>`;
      }).join("")}</tbody></table></div></div>
      <div class="srv-card"><div class="srv-card-t">Validaciones cruzadas</div><ul class="srv-chequeos">${Q.chequeos.map((c) => `<li><span class="${c.resultado === "OK" ? "ok-t" : "warn-t"}">${c.resultado === "OK" ? "✓" : "!"} ${esc(c.resultado)}</span> <b>${esc(c.chequeo)}</b><br><span class="muted">${esc(c.detalle)}</span></li>`).join("")}</ul></div>
      <details class="srv-card srv-det"><summary class="srv-card-t">Auditoría de valores excluidos, marcados y atípicos (${Q.auditoria.length})</summary>
        <div class="srv-filtros"><div class="srv-campo"><label>Servicio</label><select id="srvCS"><option value="">Todos</option>${P_SERV.map((s) => `<option value="${s}" ${f.servicio === s ? "selected" : ""}>${SERV[s].nombre}</option>`).join("")}</select></div>
          <div class="srv-campo"><label>Línea</label><select id="srvCL"><option value="">Todas</option>${[...Object.keys(S.B.lineas), "AUX"].map((l) => `<option value="${l}" ${f.linea === l ? "selected" : ""}>${esc(nomL(l))}</option>`).join("")}</select></div>
          <div class="srv-campo"><label>Decisión</label><select id="srvCD"><option value="">Todas</option>${decs.map((d) => `<option ${f.decision === d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div></div>
        <div class="srv-scroll"><table class="srv-tabla"><thead><tr><th>Fecha</th><th>Línea</th><th>Variable</th><th class="n">Valor</th><th>Criterio</th><th>Decisión</th><th>Justificación</th></tr></thead><tbody>${aud.map((a) => `<tr><td>${esc(a.fecha)}</td><td>${esc(a.linea)}</td><td>${esc(a.variable)}</td><td class="n">${nf(a.valor_original)}</td><td>${esc(a.criterio)}</td><td class="${/Excluido/.test(a.decision) ? "bad-t" : ""}">${esc(a.decision)}</td><td class="muted">${esc(a.justificacion)}</td></tr>`).join("")}</tbody></table></div></details>`;
    if ($("#srvCS")) {
      $("#srvCS").onchange = (e) => { f.servicio = e.target.value; vCal(); $(".srv-det", el).open = true; };
      $("#srvCL").onchange = (e) => { f.linea = e.target.value; vCal(); el.querySelectorAll(".srv-det").forEach((d) => (d.open = true)); };
      $("#srvCD").onchange = (e) => { f.decision = e.target.value; vCal(); el.querySelectorAll(".srv-det").forEach((d) => (d.open = true)); };
    }
  }

  /* ------------------------------------------------------------ exporte */
  function exportarExcel() {
    const B = S.B, wb = XLSX.utils.book_new();
    const met = [], cand = [], escs = [];
    for (const [k, m] of Object.entries(B.modelos)) {
      const t = m.test || {}, cv = m.cv || {};
      met.push({ servicio: m.servicio, linea: m.linea, habilitado: m.habilitado ? "sí" : "no", calidad: m.calidad || "", modelo: m.nombre_modelo || "", formula: m.formula || "", cv_WAPE: cv.WAPE, cv_MAE: cv.MAE, test_n: t.n, test_WAPE: t.WAPE, test_MAE: t.MAE, test_RMSE: t.RMSE, test_R2: t.R2, test_sesgo: t.sesgo, cobertura_intervalo: t.cobertura_intervalo, mejora_vs_media: m.mejora_vs_media, politica_atipicos: m.politica_atipicos || "", nota: m.calidad_nota || m.motivo });
      (m.candidatos || []).forEach((c) => cand.push({ servicio: m.servicio, linea: m.linea, ...c }));
      (m.escenarios || []).forEach((e) => escs.push({ servicio: m.servicio, linea: m.linea, ...e, rango_hL: e.rango_hL.join(" – "), intervalo_volumen_tipico: e.intervalo_volumen_tipico ? e.intervalo_volumen_tipico.join(" – ") : "" }));
    }
    const hojas = [["Metricas", met], ["Modelos_evaluados", cand], ["Escenarios", escs], ["Calidad", B.calidad.resumen], ["Chequeos", B.calidad.chequeos], ["Auditoria", B.calidad.auditoria], ["Historico", B.historico.map((h) => ({ fecha: h.f, linea: h.l, servicio: h.s, produccion_hL: h.P, consumo: h.C, estado: h.e, atipico: h.a, marcado: h.d, motivo: h.m }))], ["Trazabilidad", trazabilidad()]];
    const R = calcularPlanEnvasado();
    if (R && R.filas.length) hojas.splice(1, 0, ["Plan_envasado", R.filas.map((f) => { const T = f.res.totales; return { dia: f.fecha, parcial: f.parcial ? "sí" : "", ...Object.fromEntries(Object.keys(B.lineas).map((l) => ["hL_" + l, f.hl[l] || 0])), vapor_kg: T.vapor.estimado, vapor_completo: T.vapor.completo ? "sí" : "no", electricidad_kWh_con_aux: T.electricidad.estimado_con_auxiliares, agua_hL: T.agua.estimado }; })]);
    const E = B.elaboracion;
    if (E) {
      hojas.push(["Elab_modelos", Object.values(E.modelos).map((m) => ({ serie: m.serie, area: m.area, servicio: m.servicio, variante: m.variante, unidad: m.unidad, variable: m.familia === "media" ? "ninguna" : SrvElab.NOMBRE_DRIVER[m.drivers] || "", modelo: m.modelo || "", formula: m.formula || (m.web && m.web.tipo === "multi" ? `C = ${m.web.b0} + ${m.web.b.join(" , ")} · (${(m.cols || []).join(", ")})` : ""), cv_WAPE: m.cv && m.cv.WAPE, test_WAPE: m.test && m.test.WAPE, test_WAPE_semanal: m.test_semanal && m.test_semanal.WAPE, cobertura_90: m.cobertura, calidad: m.calidad, margen_inf: m.q && m.q[0], margen_sup: m.q && m.q[1], carga_base_dias: m.carga_base.n, carga_base_mediana: m.carga_base.mediana, fijo_operando: m.fijo_operando, promedio_con_produccion: m.media_valida }))]);
      hojas.push(["Elab_comparados", Object.values(E.modelos).flatMap((m) => (m.candidatos || []).map((c) => Object.assign({ serie: m.serie }, c)))]);
      hojas.push(["Elab_historico", Object.values(E.modelos).flatMap((m) => m.historico.map((h) => ({ serie: m.serie, fecha: h.f, consumo: h.c, estado: h.e, motivo: h.m })))]);
      try {
        const pl = planElaboracion();
        if (pl) { const t = TOTAL_ELAB(S.elab.variante); hojas.push(["Elab_plan", pl.dias.map((d) => ({ dia: d.fecha, hL_cocinados: d.prod.coc, hL_filtrados: d.prod.fil, hL_envasados: d.prod.env, vapor_kg: d.res[t.vapor].estimado, electricidad_kWh: d.res[t.electricidad].estimado, agua_hL: d.res[t.agua].estimado, filtrados_desde: pl.filFuente }))]); }
      } catch (e) { console.error(e); }
    }
    hojas.forEach(([n, d]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.length ? d : [{ sin_datos: "" }]), n));
    XLSX.writeFile(wb, `consumos_servicios_${B.version}.xlsx`);
  }

  // Resumen para la vista «Inicio»: totales del plan de envasado cargado.
  // null si no hay modelos; { …, plan: null } si falta el plan.
  function resumenServicios() {
    cargarGuardado();
    if (!S.B) return null;
    const out = { archivo: S.B.fuente && S.B.fuente.archivo, hasta: S.B.fuente && S.B.fuente.ultima_fecha, plan: null };
    let R = null;
    try { R = calcularPlanEnvasado(); } catch (e) { console.error(e); }
    if (!R || !R.filas.length) return out;
    const tot = { vapor: 0, electricidad: 0, agua: 0, dias: R.filas.length, desde: R.filas[0].fecha, hastaPlan: R.filas[R.filas.length - 1].fecha };
    R.filas.forEach((f) => {
      const T = f.res.totales;
      tot.vapor += T.vapor.estimado;
      tot.electricidad += T.electricidad.estimado_con_auxiliares != null ? T.electricidad.estimado_con_auxiliares : T.electricidad.estimado;
      tot.agua += T.agua.estimado;
    });
    tot.sinVapor = R.filas[0].res.totales.vapor.lineas_sin_modelo || [];
    out.plan = tot;
    try {
      const pl = S.B.elaboracion ? planElaboracion() : null;
      if (pl) {
        const t = TOTAL_ELAB("oficial");
        out.elab = { dias: pl.dias.length };
        for (const k of P_SERV) out.elab[k] = pl.dias.reduce((a, d) => a + (d.res[t[k]].estimado || 0), 0);
      }
    } catch (e) { console.error(e); }
    return out;
  }

  window.renderServicios = renderServicios;
  window.resumenServicios = resumenServicios;
  window.__srv = S;
})();
