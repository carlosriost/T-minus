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
    ["general", "General (planta)"],
    ["plan", "Plan de envasado"],
    ["elaboracion", "Elaboración"],
    ["industriales", "Servicios industriales"],
    ["simulador", "Simulador"],
    ["planificacion", "Planificación manual"],
    ["historico", "Histórico"],
    ["evaluacion", "Evaluación de modelos"],
    ["calidad", "Calidad de datos"],
    ["formulas", "Fórmulas"],
  ];
  const S = { B: null, vista: "general", sim: { linea: "L5", cantidad: "", unidad: "hL", res: null }, hist: { linea: "L5", servicio: "vapor" }, ev: { clave: null }, cal: { servicio: "", linea: "", decision: "" }, plan: {}, planRes: null, corte: 22, estado: "", elab: { coc: "", fil: "", env: "", variante: "oficial" }, coccion: "auto" };

  try { const c = JSON.parse(localStorage.getItem(LS_CFG) || "{}"); if ([0, 6, 22].includes(c.corte)) S.corte = c.corte; if (["auto", "plan", "habitual"].includes(c.coccion)) S.coccion = c.coccion; } catch (_) {}
  function guardarCfg() { try { localStorage.setItem(LS_CFG, JSON.stringify({ corte: S.corte, coccion: S.coccion })); } catch (_) {} }

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
  // Los modelos se guardan en el almacén local del navegador (IndexedDB, js/almacen.js):
  // quedan hasta que se cargue otro Excel o se pulse «Limpiar datos». Las versiones
  // anteriores usaban localStorage (se migra solo).
  const CLAVE_IDB = "servicios.paquete";
  // Sube cuando cambia cómo se leen o modelan los datos: los paquetes viejos piden recargar el Excel.
  const MOTOR = 6;
  S.almacen = { estado: "cargando", guardado_en: null };
  function cargarGuardado() {
    if (S.B || S.borrado) return;
    try {
      const t = localStorage.getItem(LS);
      if (t) S.B = JSON.parse(t);
    } catch (_) { S.B = null; }
  }
  // Modelos guardados antes de la estimación de respaldo (o con una copia vieja de la
  // página): si una línea no tiene modelo validado ni respaldo, se calcula ahora con el
  // histórico guardado en el mismo paquete. Solo con paquetes que ya leen L9 desde PET
  // (motor ≥ 4); los anteriores tienen otro dato de L9 y deben recargar el Excel.
  function completarRespaldos(B) {
    if (!B || !B.modelos || !B.historico || (B.motor || 0) < 4 || !window.SrvModelos || !SrvModelos.respaldoReciente) return;
    for (const m of Object.values(B.modelos)) {
      if (m.habilitado || m.respaldo || m.respaldo_revisado) continue;
      const x = B.historico.filter((h) => h.l === m.linea && h.s === m.servicio && h.e === "valido" && h.P !== null && h.C !== null)
        .sort((a, b) => (a.f < b.f ? -1 : 1)).map((h) => ({ fecha: h.f, produccion_hL: h.P, consumo: h.C }));
      try { m.respaldo = SrvModelos.respaldoReciente(x); } catch (e) { console.error(e); m.respaldo = null; }
      if (m.respaldo) m.respaldo.al_abrir = true;
      m.respaldo_revisado = true;
    }
  }
  function repintarTodo() {
    completarRespaldos(S.B);
    [renderServicios, window.renderCargaBase, window.renderInicio].forEach((f) => { if (typeof f === "function") try { f(); } catch (e) { console.error(e); } });
  }
  function guardar() {
    if (!S.B) return Promise.resolve(false);
    S.B.guardado_en = S.B.guardado_en || new Date().toISOString();
    const b = S.B;
    if (!window.TMAlmacen) {
      try { localStorage.setItem(LS, JSON.stringify(b)); S.almacen = { estado: "ok", guardado_en: b.guardado_en, donde: "localStorage" }; return Promise.resolve(true); }
      catch (_) { S.estado = "No se pudo guardar en este navegador (almacenamiento lleno o bloqueado): el modelo se usa solo en esta sesión."; return Promise.resolve(false); }
    }
    return TMAlmacen.escribir(CLAVE_IDB, b).then(() => {
      try { localStorage.removeItem(LS); } catch (_) {}
      S.almacen = { estado: "ok", guardado_en: b.guardado_en, donde: "IndexedDB" };
      TMAlmacen.pedirPersistencia().then(() => repintarTodo());
      return true;
    }).catch((err) => {
      console.error(err);
      // La copia anterior en IndexedDB ya no vale: se borra para que no vuelva al recargar.
      TMAlmacen.borrar(CLAVE_IDB).catch(() => {});
      try { localStorage.setItem(LS, JSON.stringify(b)); S.almacen = { estado: "ok", guardado_en: b.guardado_en, donde: "localStorage" }; return true; }
      catch (_) { S.almacen = { estado: "error" }; S.estado = "No se pudo guardar en este navegador (almacenamiento lleno o bloqueado): el modelo se usa solo en esta sesión."; repintarTodo(); return false; }
    });
  }
  function limpiarDatos() {
    S.B = null; S.borrado = true; S.planRes = null; S.sim.res = null; S.ev.clave = null; S.confirmarLimpiar = false;
    try { localStorage.removeItem(LS); } catch (_) {}
    const fin = () => { S.almacen = { estado: "vacio" }; S.estado = "Datos borrados de este navegador. Carga el Excel de Indicadores de servicios cuando necesites una predicción nueva."; repintarTodo(); };
    if (window.TMAlmacen) TMAlmacen.borrar(CLAVE_IDB).then(fin, fin); else fin();
  }
  // Al abrir la página: lee el paquete guardado (o migra el de localStorage).
  if (window.TMAlmacen) {
    TMAlmacen.leer(CLAVE_IDB).then((b) => {
      if (S.borrado) return;
      cargarGuardado(); // copia de localStorage (versiones anteriores o si IndexedDB falló)
      const ls = S.B;
      if (b && (!ls || (b.guardado_en || "") >= (ls.guardado_en || ""))) { S.B = b; S.almacen = { estado: "ok", guardado_en: b.guardado_en, donde: "IndexedDB" }; }
      else if (ls) { S.almacen = { estado: "ok", guardado_en: ls.guardado_en, donde: "localStorage" }; guardar(); }
      else S.almacen = { estado: "vacio" };
      TMAlmacen.revisarPersistencia().then(() => repintarTodo());
      repintarTodo();
    }).catch((err) => { console.error(err); cargarGuardado(); S.almacen = S.B ? { estado: "ok", guardado_en: S.B.guardado_en, donde: "localStorage" } : { estado: "sin_idb" }; repintarTodo(); });
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
              try {
                // Producción diaria (cocinados, filtrados, envasados): la usan la carga base y los indicadores por hL.
                S.B.produccion_diaria = SrvElab.leer(wb, S.B.fuente.primera_fecha, S.B.fuente.ultima_fecha).map((r) => [r.fecha, r.coc || 0, r.fil || 0, r.env || 0]);
                // Hojas eléctricas por línea (C «kWh día», E «Hl env d») para comparar con las fórmulas de la planta.
                if (window.SrvBase) S.B.referencia_electrica = SrvBase.leerReferencia(wb, S.B.fuente.primera_fecha, S.B.fuente.ultima_fecha);
              } catch (err) { console.error(err); }
              try {
                S.B.industriales = SrvInd.entrenar(wb, { desde: S.B.fuente.primera_fecha, hasta: S.B.fuente.ultima_fecha });
              } catch (err) {
                console.error(err);
                S.B.industriales_error = "No se pudo procesar planta y servicios industriales: " + err.message;
              }
              S.estado = `Listo: ${file.name} leído; ${Object.keys(S.B.modelos).length} modelos de envasado${S.B.elaboracion ? `, ${Object.keys(S.B.elaboracion.modelos).length} de elaboración` : ""}${S.B.industriales ? ` y ${Object.keys(S.B.industriales.modelos).length} de planta y servicios industriales` : ""} validados en ${nf(S.B.segundos + (S.B.elaboracion ? S.B.elaboracion.segundos : 0) + (S.B.industriales ? S.B.industriales.segundos : 0), 1)} s.`;
              S.ev.clave = null;
              S.sim.res = null;
              S.planRes = null;
              S.borrado = false;
              S.B.motor = MOTOR;
              S.B.guardado_en = new Date().toISOString();
              guardar().then(() => renderServicios());
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
        S.borrado = false;
        S.B.guardado_en = new Date().toISOString();
        guardar().then(() => renderServicios());
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
    completarRespaldos(S.B);
    const B = S.B;
    const hab = B ? Object.values(B.modelos).filter((m) => m.habilitado).length : 0;
    cont.innerHTML = `
      <div class="panel srv">
        <div class="panel-head"><h3>Consumos de servicios</h3><span class="sub">Vapor, electricidad y agua esperados en envasado y elaboración, a partir del volumen</span></div>
        <div class="panel-body">
          <div class="srv-barra">
            <div class="srv-estado">${
              B
                ? `<span class="srv-chip ok">Modelos de ${esc(B.fuente.archivo || "Excel")}</span><span class="srv-chip">Datos ${esc(B.fuente.primera_fecha)} → ${esc(B.fuente.ultima_fecha)}</span><span class="srv-chip">${hab} de ${Object.keys(B.modelos).length} habilitados</span>${chipGuardado()}`
                : '<span class="srv-chip">Sin modelos todavía</span>'
            }</div>
            <div class="srv-acciones">
              <label class="btn ${B ? "small" : "primary"}" for="srvExcel">${B ? "Actualizar con otro Excel" : "Cargar Indicadores de servicios (.xlsm)"}</label>
              <input type="file" id="srvExcel" accept=".xlsm,.xlsx" hidden />
              ${B ? '<button class="btn small" id="srvXls">Exportar resultados (Excel)</button><details class="srv-mas"><summary class="btn small">Más</summary><div><button class="btn small" id="srvJson">Exportar paquete de modelos (.json)</button><label class="btn small" for="srvJsonIn">Cargar paquete (.json)</label><input type="file" id="srvJsonIn" accept=".json" hidden /></div></details>' : '<label class="btn small" for="srvJsonIn">Cargar paquete (.json)</label><input type="file" id="srvJsonIn" accept=".json" hidden />'}
              ${B ? (S.confirmarLimpiar ? '<span class="srv-confirma">¿Borrar los modelos guardados en este navegador? <button class="btn small danger" id="srvLimpiarSi">Sí, borrar</button><button class="btn small" id="srvLimpiarNo">Cancelar</button></span>' : '<button class="btn small" id="srvLimpiar" title="Borra de este navegador los modelos, la carga base y las predicciones guardadas">Limpiar datos</button>') : ""}
            </div>
          </div>
          ${B && (B.motor || 0) < MOTOR ? '<div class="srv-aviso info"><b>Hay mejoras en la lectura de los datos</b> (revisión de datos: versión contador del agua de planta, ajustes a mano grandes fuera del entrenamiento, secador de febrero, lecturas faltantes). Estos modelos se guardaron con una versión anterior: vuelve a cargar el Excel de Indicadores de servicios para aplicarlas.</div>' : ""}
          ${S.estado ? `<p class="srv-msg ${/^Error|No se pudo/.test(S.estado) ? "bad" : ""}">${esc(S.estado)}</p>` : ""}
          ${B ? `<nav class="srv-tabs" role="tablist">${VISTAS.map(([k, t]) => `<button role="tab" class="srv-tab ${S.vista === k ? "on" : ""}" data-srv-vista="${k}">${t}</button>`).join("")}</nav><div id="srvCuerpo"></div>` : vacio()}
        </div>
      </div>`;
    $("#srvExcel").onchange = (e) => e.target.files[0] && leerExcel(e.target.files[0]);
    if (!B && $("#srvJsonIn")) $("#srvJsonIn").onchange = (e) => e.target.files[0] && leerPaquete(e.target.files[0]);
    if (B) {
      if ($("#srvLimpiar")) $("#srvLimpiar").onclick = () => { S.confirmarLimpiar = true; renderServicios(); };
      if ($("#srvLimpiarNo")) $("#srvLimpiarNo").onclick = () => { S.confirmarLimpiar = false; renderServicios(); };
      if ($("#srvLimpiarSi")) $("#srvLimpiarSi").onclick = limpiarDatos;
      $("#srvXls").onclick = exportarExcel;
      $("#srvJson").onclick = () => descargar(new Blob([JSON.stringify(S.B)], { type: "application/json" }), `modelo_servicios_${S.B.version}.json`);
      $("#srvJsonIn").onchange = (e) => e.target.files[0] && leerPaquete(e.target.files[0]);
      cont.querySelectorAll("[data-srv-vista]").forEach((b) => (b.onclick = () => { S.vista = b.dataset.srvVista; renderServicios(); }));
      ({ general: vGeneral, plan: vPlan, elaboracion: vElab, industriales: vIndustriales, simulador: vSim, planificacion: vPlanif, historico: vHist, evaluacion: vEval, calidad: vCal, formulas: vFormulas })[S.vista]();
    }
    SrvCharts.conectarTips(cont);
  }
  function chipGuardado() {
    const a = S.almacen || {};
    const f = (S.B && S.B.guardado_en) || a.guardado_en;
    const fecha = f ? new Date(f).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    if (a.estado === "error") return '<span class="srv-chip bad">No quedó guardado: se pierde al cerrar</span>';
    if (a.estado !== "ok") return "";
    const per = window.TMAlmacen && TMAlmacen.esPersistente();
    return `<span class="srv-chip ok" title="Queda en este navegador hasta que cargues otro Excel o pulses «Limpiar datos». ${per ? "El navegador lo marcó como almacenamiento persistente." : "Si limpias los datos de navegación de este sitio, se borra."}">Guardado en este navegador${fecha ? " · " + esc(fecha) : ""}</span>`;
  }
  // Todas las fórmulas con las que T-minus calcula (las del último Excel cargado).
  const VAR = { coc: "COC", fil: "FIL", env: "ENV" };
  function formulaDe(m, varUna) {
    if (!m) return "—";
    if (m.web && m.web.tipo === "multi") {
      const t = m.web.b.map((b, j) => `${b < 0 ? "−" : "+"} ${SrvDatos.numEs(Math.abs(b), Math.abs(b) < 0.01 ? 5 : 4)}·${VAR[m.cols[j]] || m.cols[j]}`).join(" ");
      return `C = ${SrvDatos.numEs(m.web.b0, 1)} ${t}`;
    }
    if (m.formula) return m.formula.replace(/\bP\b/g, varUna || (m.cols && m.cols.length === 1 ? VAR[m.cols[0]] : "P")).replace(/\+\s*-\s*/g, "− ");
    return m.nombre_modelo || m.modelo || "—";
  }
  function vFormulas() {
    const el = $("#srvCuerpo"), B = S.B, E = B.elaboracion, I = B.industriales;
    const fila = (cols) => `<tr>${cols.map((c, i) => `<td${i === 2 ? ' class="srv-formula"' : ""}>${c}</td>`).join("")}</tr>`;
    const env = Object.values(B.modelos).map((m) => {
      const R = m.respaldo;
      const f = m.habilitado ? formulaDe(m, "P") : R ? (R.tipo === "media" ? `C = ${SrvDatos.numEs(R.media, 0)} (respaldo: promedio últimos 60 días)` : `C = ${SrvDatos.numEs(R.k, 3)}·P (respaldo: últimos 60 días)`) : "sin modelo";
      return fila([esc(m.servicio), esc(m.linea === "AUX" ? "Auxiliares (P = hL de L5+L7+L8)" : nomL(m.linea)), esc(f), esc(m.unidad), !m.habilitado && R ? pct(R.wape_validacion) + " *" : m.test && m.test.WAPE != null ? pct(m.test.WAPE) : "—", esc(m.habilitado ? m.calidad : R ? "Respaldo (baja confianza)" : "—")]);
    }).join("");
    const tabla = (M, titulo, nota) => !M ? "" : `<div class="srv-card"><div class="srv-card-t">${titulo}</div><div class="srv-tabla-wrap" style="max-height:none"><table class="srv-tabla"><thead><tr><th>Área / sistema</th><th>Servicio</th><th>Fórmula</th><th>Unidad</th><th class="n">Error prueba</th><th>Calidad</th></tr></thead><tbody>${Object.values(M.modelos).filter((m) => m.test || m.web).map((m) => fila([esc(m.area || m.sistema), esc(m.servicio + (m.variante ? " (" + m.variante + ")" : "")), esc(formulaDe(m)), esc(m.unidad), m.test ? pct(m.test.WAPE) : "—", esc(m.calidad)])).join("")}</tbody></table></div><p class="muted">${nota}</p></div>`;
    el.innerHTML = `
      <div class="srv-card"><div class="srv-card-t">Cómo leer las fórmulas</div>
        <p>C = consumo del día (en la unidad de la tabla). P = hL envasados de la línea ese día. COC, FIL y ENV = hL cocinados, filtrados y envasados de la planta ese día. max(0, P − k) = solo la parte de P que pasa de k. Las fórmulas se recalculan cada vez que se carga un Excel nuevo; estas salen de ${esc(B.fuente.archivo || "el último Excel")} (${esc(B.fuente.primera_fecha)} a ${esc(B.fuente.ultima_fecha)}). «Error prueba» = error en los últimos días, que el modelo no vio al ajustarse.</p></div>
      <div class="srv-card"><div class="srv-card-t">Envasado, por línea</div><div class="srv-tabla-wrap" style="max-height:none"><table class="srv-tabla"><thead><tr><th>Servicio</th><th>Línea</th><th>Fórmula</th><th>Unidad</th><th class="n">Error prueba</th><th>Calidad</th></tr></thead><tbody>${env}</tbody></table></div>
        <p class="muted">* Respaldo: error medido en las últimas 3 semanas. Electricidad de cada línea: contador de la línea sin los auxiliares compartidos (los auxiliares tienen su propia fórmula). Días sin producción: se usa el consumo base medido, no la fórmula.</p></div>
      ${tabla(E, "Elaboración (cocinas, cavas y filtración)", "Por debajo del 5 % del promedio de producción del área se usa la carga base medida en vez de la fórmula.")}
      ${tabla(I, "Planta completa y servicios industriales", "La versión «contador» quita los números sumados a mano en el Excel; «oficial» es la cifra del Excel.")}`;
  }

  /* ------------------------------------------------------------ GENERAL (PLANTA) */
  // Vapor, agua y electricidad de toda la planta: histórico real, reparto entre
  // envasado, elaboración y el resto (servicios industriales y demás) y proyección del plan.
  // Todo sale de las mismas series que usan los otros módulos (mismas reglas de datos).
  const G_SERV = ["vapor", "agua", "electricidad"];
  const G_ENV_LINEAS = { vapor: ["L5", "L7", "L8", "L9"], agua: ["L5", "L7", "L8", "L9"], electricidad: ["L5", "L7", "L8", "L9", "AUX"] };
  const G_COL = {
    env: (s) => `color-mix(in srgb, ${PLANTA[s].color} 100%, transparent)`,
    elab: (s) => `color-mix(in srgb, ${PLANTA[s].color} 55%, var(--panel))`,
    resto: (s) => `color-mix(in srgb, ${PLANTA[s].color} 24%, transparent)`,
  };
  const gLeyenda = (s) => `<div class="srv-ley"><span><i style="background:${G_COL.env(s)}"></i>Envasado${s === "electricidad" ? " (con auxiliares)" : ""}</span><span><i style="background:${G_COL.elab(s)}"></i>Elaboración</span><span><i style="background:${G_COL.resto(s)}"></i>Resto (servicios industriales y demás)</span></div>`;
  const usable = (e) => e === "valido" || e === "carga_base";
  // Serie diaria real de la planta: solo días válidos o de carga base (los excluidos tienen un motivo).
  function gPlanta(I, s, v) {
    const k = clavePlanta(I, s, v);
    if (!k) return null;
    const h = I.modelos[k].historico.filter((x) => x.c !== null && usable(x.e));
    return { k, m: I.modelos[k], h, excluidos: I.modelos[k].historico.filter((x) => x.e === "excluido").length };
  }
  // Reparto diario real: planta, envasado (suma de líneas) y elaboración en los días con los tres datos.
  function gReparto(I, E, s, v) {
    const P = gPlanta(I, s, v);
    if (!P || !E) return null;
    const ke = TOTAL_ELAB(v)[s];
    const el = new Map(E.modelos[ke].historico.filter((x) => x.c !== null && x.e !== "excluido").map((x) => [x.f, x.c]));
    const env = new Map();
    for (const h of S.B.historico) {
      if (h.s !== s || h.C === null || h.e === "excluido" || !G_ENV_LINEAS[s].includes(h.l)) continue;
      const x = env.get(h.f) || { n: 0, c: 0 };
      x.n++; x.c += h.C; env.set(h.f, x);
    }
    const n = G_ENV_LINEAS[s].length;
    return P.h.filter((x) => el.has(x.f) && env.has(x.f) && env.get(x.f).n === n).map((x) => ({ f: x.f, planta: x.c, env: env.get(x.f).c, elab: el.get(x.f) }));
  }
  function vGeneral() {
    const el = $("#srvCuerpo"), I = S.B.industriales, E = S.B.elaboracion, v = S.elab.variante;
    if (!I) { el.innerHTML = `<div class="srv-vacio"><h4>Falta procesar la planta</h4><p>${esc(S.B.industriales_error || "Vuelve a cargar el Excel de Indicadores de servicios para calcular el consumo de toda la planta.")}</p></div>`; return; }
    const envDia = new Map((S.B.produccion_diaria || []).map((r) => [r[0], r[3]]));
    const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const etqMes = (m) => MES[Number(m.slice(5, 7)) - 1] + " " + m.slice(2, 4);
    const G = {};
    for (const s of G_SERV) {
      const P = gPlanta(I, s, v);
      if (!P || !P.h.length) continue;
      const h = P.h, fin = msF(h[h.length - 1].f);
      const ult = h.filter((x) => fin - msF(x.f) < 30 * 86400000), prev = h.filter((x) => fin - msF(x.f) >= 30 * 86400000 && fin - msF(x.f) < 60 * 86400000);
      const prom = (a) => (a.length ? a.reduce((t, x) => t + x.c, 0) / a.length : null);
      const porHl = (a) => { let c = 0, e = 0; a.forEach((x) => { const q = envDia.get(x.f); if (q > 0) { c += x.c; e += q; } }); return e ? c / e : null; };
      const R = gReparto(I, E, s, v) || [];
      const meses = new Map();
      R.forEach((r) => { const m = r.f.slice(0, 7); const x = meses.get(m) || { n: 0, planta: 0, env: 0, elab: 0 }; x.n++; x.planta += r.planta; x.env += r.env; x.elab += r.elab; meses.set(m, x); });
      const tot = R.reduce((a, r) => ({ planta: a.planta + r.planta, env: a.env + r.env, elab: a.elab + r.elab }), { planta: 0, env: 0, elab: 0 });
      G[s] = { P, ult, prev, m30: prom(ult), m30p: prom(prev), anio: prom(h), hl30: porHl(ult), hlAnio: porHl(h), R, meses, tot, negativos: R.filter((r) => r.env + r.elab > r.planta).length };
    }
    const g = (s, x) => (x == null ? null : x / PLANTA[s].grande[0]);
    const uG = (s) => PLANTA[s].grande[1];
    const dG = (s) => PLANTA[s].grande[2];
    const espU = { vapor: "kg/hL", agua: "hL/hL", electricidad: "kWh/hL" };
    const kpis = G_SERV.filter((s) => G[s]).map((s) => {
      const x = G[s], ch = x.m30p ? x.m30 / x.m30p - 1 : null;
      return `<div class="srv-kpi" style="--c:${PLANTA[s].color}"><span>${PLANTA[s].nombre} de la planta${x.P.m.variante ? ` (${esc(x.P.m.variante)})` : ""}</span><b>${nf(g(s, x.m30), dG(s))} <small>${uG(s)}/día</small></b><small>últimos 30 días con dato (hasta ${esc(x.ult[x.ult.length - 1].f)}) · ${nf(x.hl30, 2)} ${espU[s]} envasado${ch != null ? ` · ${ch >= 0 ? "+" : ""}${pct(ch, 1)} vs. los 30 anteriores` : ""} · año ${nf(g(s, x.anio), dG(s))} ${uG(s)}/día</small></div>`;
    }).join("");
    // Proyección del plan
    const pp = prodPlan(), PE = calcularPlanEnvasado();
    let planHtml = `<div class="srv-card"><div class="srv-card-t">Proyección del plan</div><p class="muted">Carga el plan de envasado en <b>Datos de entrada</b> para proyectar el vapor, el agua y la electricidad de toda la planta.</p></div>`;
    let dias = null;
    if (pp && E) {
      const envF = new Map(((PE && PE.filas) || []).map((f) => [f.fecha, f]));
      dias = pp.dias.map((d) => {
        const re = predElab(E, d), ri = predInd(I, d), fe = envF.get(d.fecha);
        const o = { fecha: d.fecha, parcial: d.parcial, prod: d.prod, s: {} };
        for (const s of G_SERV) {
          const kp = clavePlanta(I, s, v), xp = kp && ri[kp];
          const xe = re[TOTAL_ELAB(v)[s]];
          const T = fe ? fe.res.totales[s] : null;
          const env = T ? (s === "electricidad" && T.estimado_con_auxiliares != null ? T.estimado_con_auxiliares : T.estimado) : 0;
          const planta = xp && xp.estimado != null ? xp.estimado : null;
          const elab = xe && xe.estimado != null ? xe.estimado : 0;
          o.s[s] = { planta, intervalo: xp && xp.intervalo, env, elab, resto: planta == null ? null : planta - env - elab, env_incompleto: T ? !T.completo : false, extrapola: !!(xp && xp.extrapolacion) };
        }
        return o;
      });
      const base = dias; // en los días de borde el fijo ya va prorrateado
      const envTot = base.reduce((a, d) => a + d.prod.env, 0);
      const kp = G_SERV.map((s) => {
        const t = dias.reduce((a, d) => a + (d.s[s].planta || 0), 0), tb = base.reduce((a, d) => a + (d.s[s].planta || 0), 0);
        const lo = dias.reduce((a, d) => a + (d.s[s].intervalo ? d.s[s].intervalo[0] : 0), 0), hi = dias.reduce((a, d) => a + (d.s[s].intervalo ? d.s[s].intervalo[1] : 0), 0);
        const x = G[s];
        return `<div class="srv-kpi" style="--c:${PLANTA[s].color}"><span>${PLANTA[s].nombre} de la planta · plan</span><b>${nf(g(s, t), dG(s))} <small>${uG(s)}</small></b><small>${nf(g(s, t / dias.length), dG(s))} ${uG(s)}/día · margen ${nf(g(s, lo), dG(s))} – ${nf(g(s, hi), dG(s))} · ${nf(envTot ? tb / envTot : null, 2)} ${espU[s]}${x && x.hl30 != null ? ` (últimos 30 días: ${nf(x.hl30, 2)})` : ""}</small></div>`;
      }).join("");
      const neg = G_SERV.map((s) => [s, dias.filter((d) => d.s[s].resto != null && d.s[s].resto < 0).length]).filter((x) => x[1]);
      const sinEnv = dias.filter((d) => !envF.has(d.fecha)).length;
      const extrap = dias.filter((d) => G_SERV.some((s) => d.s[s].extrapola)).length;
      planHtml = `<div class="srv-card"><div class="srv-card-t">Proyección del plan <small class="muted">· ${dias.length} días, del ${esc(dias[0].fecha)} al ${esc(dias[dias.length - 1].fecha)}</small></div>
        ${avisoCoccion(pp)}
        <div class="srv-kpis">${kp}</div>
        ${extrap ? `<div class="srv-aviso info">En ${extrap} de ${dias.length} días la producción del plan queda fuera del rango histórico de la planta: esos días el total es una extrapolación.</div>` : ""}
        ${sinEnv ? `<div class="srv-aviso info">${sinEnv} día(s) tienen cocción pero no envasado en el plan: ahí envasado cuenta 0.</div>` : ""}
        ${neg.length ? `<div class="srv-aviso info">Envasado + elaboración superan el total de la planta en ${neg.map(([s, n]) => `${n} día(s) de ${PLANTA[s].nombre.toLowerCase()}`).join(", ")}: son modelos distintos (por línea, por área y de planta) y no cuadran exacto día a día. Esos días el «resto» se muestra en cero.</div>` : ""}
        <div class="srv-grid3">${G_SERV.map((s) => `<div><div class="srv-card-t" style="margin-top:10px">${PLANTA[s].nombre} por día <small class="muted">· ${uG(s)}/día · raya = margen 90 % de la planta</small></div><div class="chart" id="gPlan-${s}"></div>${gLeyenda(s)}</div>`).join("")}</div>
        <details class="srv-det"><summary class="srv-card-t">Tabla día por día</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">hL cocinados</th><th class="n">hL envasados</th>${G_SERV.map((s) => `<th class="n">${PLANTA[s].nombre} planta (${uG(s)})</th><th class="n">envasado</th><th class="n">elaboración</th>`).join("")}<th>Notas</th></tr></thead><tbody>${dias
          .map((d) => { const n = []; if (d.parcial) n.push("día parcial"); if (G_SERV.some((s) => d.s[s].extrapola)) n.push("fuera de rango"); if (d.s.vapor.env_incompleto) n.push("vapor de envasado incompleto"); return `<tr class="${d.parcial ? "muted" : ""}"><td>${esc(d.fecha)}</td><td class="n">${nf(d.prod.coc)}</td><td class="n">${nf(d.prod.env)}</td>${G_SERV.map((s) => `<td class="n">${nf(g(s, d.s[s].planta), dG(s))}</td><td class="n">${nf(g(s, d.s[s].env), dG(s))}</td><td class="n">${nf(g(s, d.s[s].elab), dG(s))}</td>`).join("")}<td class="muted">${esc(n.join(" · "))}</td></tr>`; })
          .join("")}</tbody></table></div></details>
      </div>`;
    } else if (pp && !E) planHtml = `<div class="srv-card"><div class="srv-card-t">Proyección del plan</div><p class="muted">Vuelve a cargar el Excel de Indicadores de servicios para calcular elaboración.</p></div>`;
    // Reparto histórico
    const repTabla = G_SERV.filter((s) => G[s] && G[s].R.length).map((s) => {
      const x = G[s], t = x.tot, resto = t.planta - t.env - t.elab;
      return `<tr><td>${PLANTA[s].nombre}${x.P.m.variante ? ` <small class="muted">(${esc(x.P.m.variante)})</small>` : ""}</td><td class="n">${x.R.length}</td><td class="n">${nf(g(s, t.planta / x.R.length), dG(s))} ${uG(s)}</td><td class="n">${pct(t.env / t.planta, 0)}</td><td class="n">${pct(t.elab / t.planta, 0)}</td><td class="n">${pct(resto / t.planta, 0)}</td><td class="n">${x.negativos}</td></tr>`;
    }).join("");
    const meses = [...new Set(G_SERV.flatMap((s) => (G[s] ? [...G[s].P.h.map((x) => x.f.slice(0, 7))] : [])))].sort();
    const mesTabla = meses.map((m) => {
      const cel = G_SERV.map((s) => { if (!G[s]) return "<td></td><td></td>"; const a = G[s].P.h.filter((x) => x.f.startsWith(m)); let c = 0, e = 0; a.forEach((x) => { const q = envDia.get(x.f); if (q > 0) { c += x.c; e += q; } }); return `<td class="n">${a.length ? nf(g(s, a.reduce((t, x) => t + x.c, 0) / a.length), dG(s)) : "—"}</td><td class="n">${e ? nf(c / e, 2) : "—"}</td>`; }).join("");
      const ed = [...envDia].filter(([f]) => f.startsWith(m));
      return `<tr><td>${esc(etqMes(m))}</td><td class="n">${ed.length ? nf(ed.reduce((a, [, q]) => a + q, 0) / ed.length) : "—"}</td>${cel}</tr>`;
    }).join("");
    el.innerHTML = `
      <div class="srv-filtros">
        <div class="srv-campo"><label>Versión de los datos</label><div class="srv-seg">${[["oficial", "Oficial (Excel)"], ["contador", "Contador sin ajustes"]].map(([k, t]) => `<button type="button" data-gv="${k}" class="${v === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
        <div class="srv-campo"><label>Día de producción</label><div class="srv-seg">${[[22, "22:00 a 22:00"], [6, "06:00 a 06:00"], [0, "00:00 a 24:00"]].map(([x, t]) => `<button type="button" data-corte="${x}" class="${S.corte === x ? "on" : ""}">${t}</button>`).join("")}</div></div>
      </div>
      <div class="srv-card"><div class="srv-card-t">Consumo de la planta <small class="muted">· datos reales del Excel, ${esc(I.desde)} a ${esc(I.hasta)}</small></div>
        <div class="srv-kpis">${kpis}</div>
        <div class="srv-grid3">${G_SERV.filter((s) => G[s]).map((s) => `<div><div class="srv-card-t" style="margin-top:6px">${PLANTA[s].nombre} diario <small class="muted">· ${uG(s)}/día · línea = promedio de 7 días</small></div><div class="chart" id="gHist-${s}"></div><p class="muted" style="margin:2px 0 0">Gráfica: últimos ${Math.min(180, G[s].P.h.length)} días. ${G[s].P.h.length} días con dato en total${G[s].P.excluidos ? `, ${G[s].P.excluidos} excluidos por calidad (ver «Servicios industriales → Histórico»)` : ""}.</p></div>`).join("")}</div>
        <p class="muted">Agua de la planta = entrada EEPPMM menos lo que va fuera de planta (columna T de DATOS SEMANA). Vapor = gran total de «Contadores vapor». Electricidad = ISAGEN 44 kV menos perímetros. ${v === "contador" ? "Versión contador: sin los números sumados a mano en las fórmulas; en agua, con los contadores de elaboración, envase y perímetros en vez de la «lectura» EEPPMM." : "Versión oficial: la celda del Excel tal cual, con sus ajustes a mano. En agua, la «lectura» EEPPMM lleva un número escrito a mano casi todos los días (de mayo a octubre, 7 a 10 % del agua de planta): use «Contador sin ajustes» para ver lo medido."}</p>
      </div>
      ${planHtml}
      <div class="srv-card"><div class="srv-card-t">Cómo se reparte <small class="muted">· días con dato de planta, envasado y elaboración a la vez</small></div>
        <div class="srv-grid3">${G_SERV.filter((s) => G[s] && G[s].meses.size).map((s) => `<div><div class="srv-card-t" style="margin-top:6px">${PLANTA[s].nombre} por mes <small class="muted">· promedio diario, ${uG(s)}/día</small></div><div class="chart" id="gRep-${s}"></div>${gLeyenda(s)}</div>`).join("")}</div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Servicio</th><th class="n">Días</th><th class="n">Planta (promedio)</th><th class="n">Envasado</th><th class="n">Elaboración</th><th class="n">Resto</th><th class="n">Días con envasado + elaboración &gt; planta</th></tr></thead><tbody>${repTabla}</tbody></table></div>
        <p class="muted">Envasado = suma de las líneas (vapor: columnas de MAESTRA; electricidad: medidores de línea más auxiliares; agua: DATOS SEMANA). Elaboración = cocinas + cavas + filtración (vapor y agua) o cocinas + filtración (electricidad). El resto incluye refrigeración, aire comprimido, CO2, calderas, periféricos y lo que no tiene medidor propio; en agua (versión oficial) es sobre todo el número escrito a mano en la «lectura» EEPPMM. Cada parte viene de contadores distintos, así que algunos días no cuadran con el total; en el mes se compensan.</p>
      </div>
      <div class="srv-card"><div class="srv-card-t">Histórico mensual <small class="muted">· promedio diario de los días con dato y consumo por hL envasado</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Mes</th><th class="n">hL envasados/día</th>${G_SERV.map((s) => (G[s] ? `<th class="n">${PLANTA[s].nombre} (${uG(s)}/día)</th><th class="n">${espU[s]}</th>` : "")).join("")}</tr></thead><tbody>${mesTabla}</tbody></table></div>
      </div>`;
    el.querySelectorAll("[data-gv]").forEach((b) => (b.onclick = () => { S.elab.variante = b.dataset.gv; vGeneral(); SrvCharts.conectarTips(el); }));
    el.querySelectorAll("[data-corte]").forEach((b) => (b.onclick = () => { S.corte = Number(b.dataset.corte); guardarCfg(); vGeneral(); SrvCharts.conectarTips(el); }));
    conectarCoccion(el, () => { vGeneral(); SrvCharts.conectarTips(el); });
    // Gráficas
    for (const s of G_SERV) {
      const x = G[s];
      if (!x) continue;
      const h = x.P.h.slice(-180), f0 = h.length ? msF(h[0].f) : 0;
      const media7 = h.map((p) => { const t = msF(p.f); const w = x.P.h.filter((q) => msF(q.f) <= t && t - msF(q.f) < 7 * 86400000); return { x: t, y: g(s, w.reduce((a, q) => a + q.c, 0) / w.length) }; });
      SrvCharts.lineas(document.getElementById("gHist-" + s), {
        W: 420, H: 230, yLab: `${uG(s)}/día`, aria: `${PLANTA[s].nombre} diario de la planta`,
        series: [
          { tipo: "puntos", color: `color-mix(in srgb, ${PLANTA[s].color} 60%, transparent)`, r: 2.2, puntos: h.map((p) => ({ x: msF(p.f), y: g(s, p.c), tip: `${p.f}: ${nf(g(s, p.c), dG(s) + 1)} ${uG(s)}${p.e === "carga_base" ? " · carga base" : ""}${p.m ? " · " + p.m : ""}` })) },
          { color: PLANTA[s].color, ancho: 2.2, puntos: media7.filter((p) => p.x >= f0) },
        ],
      });
      if (x.meses.size) {
        const ms = [...x.meses.keys()].sort();
        const val = (k) => ms.map((m) => { const q = x.meses.get(m); return g(s, Math.max(0, k === "resto" ? q.planta - q.env - q.elab : q[k]) / q.n); });
        SrvCharts.apiladas(document.getElementById("gRep-" + s), {
          W: 420, H: 230, maxEtiquetas: 12, cats: ms.map((m) => (new Set(ms.map((q) => q.slice(0, 4))).size > 1 ? etqMes(m) : MES[Number(m.slice(5, 7)) - 1])), yLab: `${uG(s)}/día`, aria: `Reparto mensual del ${PLANTA[s].nombre.toLowerCase()}`,
          series: [["env", "envasado"], ["elab", "elaboración"], ["resto", "resto"]].map(([k, t]) => ({ color: G_COL[k](s), valores: val(k), tips: ms.map((m) => { const q = x.meses.get(m), vv = k === "resto" ? q.planta - q.env - q.elab : q[k]; return `${etqMes(m)} · ${t}: ${nf(g(s, vv / q.n), dG(s))} ${uG(s)}/día (${pct(vv / q.planta, 0)} de la planta, ${q.n} días)`; }) })),
        });
      }
      if (dias) {
        SrvCharts.apiladas(document.getElementById("gPlan-" + s), {
          W: 420, H: 230, maxEtiquetas: 7, cats: dias.map((d) => d.fecha.slice(8, 10) + "/" + d.fecha.slice(5, 7)), yLab: `${uG(s)}/día`, aria: `${PLANTA[s].nombre} de la planta por día del plan`,
          rangos: dias.map((d) => (d.s[s].intervalo ? d.s[s].intervalo.map((q) => g(s, q)) : null)), marcas: dias.map((d) => (d.parcial ? "parcial" : "")),
          series: [["env", "envasado"], ["elab", "elaboración"], ["resto", "resto"]].map(([k, t]) => ({ color: G_COL[k](s), valores: dias.map((d) => g(s, Math.max(0, d.s[s][k] || 0))), tips: dias.map((d) => `${d.fecha} · ${t}: ${nf(g(s, d.s[s][k]), dG(s) + 1)} ${uG(s)} · planta ${nf(g(s, d.s[s].planta), dG(s) + 1)} ${uG(s)}${d.s[s].intervalo ? ` (margen ${nf(g(s, d.s[s].intervalo[0]), dG(s))} – ${nf(g(s, d.s[s].intervalo[1]), dG(s))})` : ""}`) })),
        });
      }
    }
  }
  function vIndustriales() {
    $("#srvCuerpo").innerHTML = '<div id="srvInd"></div>';
    if (typeof window.renderIndustriales === "function") window.renderIndustriales();
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
    const etq = (base) => new Date(base + (S.corte > 12 ? Dd : 0)).toISOString().slice(0, 10);
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
          const etiqueta = etq(base);
          if (!dias.has(etiqueta)) dias.set(etiqueta, { base, hl: {} });
          const d = dias.get(etiqueta);
          d.hl[ln] = (d.hl[ln] || 0) + (Number(b.hectolitros) * (hasta - x)) / (z - a);
          x = hasta;
        }
      });
    });
    if (!isFinite(ini)) return { dias: [], ini, fin };
    // Todos los días que toca el plan, también los que no tienen producción (líneas paradas:
    // cuentan su carga base). frac = parte del día que cubre el plan (días de borde < 1).
    const out = [];
    for (let base = Math.floor((ini - c) / Dd) * Dd + c; base < fin; base += Dd) {
      const f = etq(base), d = dias.get(f) || { base, hl: {} };
      const frac = Math.max(0, Math.min(base + Dd, fin) - Math.max(base, ini)) / Dd;
      if (frac < 1 / 96 && !Object.keys(d.hl).length) continue; // menos de 15 min y sin producción
      out.push({ fecha: f, base, hl: d.hl, frac: frac > 0.999 ? 1 : frac, parcial: frac <= 0.999 });
    }
    return { dias: out, ini, fin };
  }
  // Día de borde (el plan cubre solo una parte del día): el consumo fijo del día también
  // es solo esa parte. Se proyecta con la producción llevada a ritmo de día completo
  // (P / frac) y el resultado se multiplica por frac: C = frac · f(P / frac).
  // En una recta a + b·P eso da frac·a + b·P (fijo proporcional a las horas, variable a lo producido).
  function escalarObj(x, frac) {
    if (!x || typeof x !== "object") return;
    for (const k of ["estimado", "estimado_con_auxiliares", "estimado_m3"]) if (typeof x[k] === "number") x[k] *= frac;
    for (const k of ["intervalo", "intervalo_conservador", "intervalo_conservador_con_auxiliares"]) if (Array.isArray(x[k])) x[k] = x[k].map((v) => (typeof v === "number" ? v * frac : v));
  }
  function escalarRes(res, frac) {
    if (frac >= 1 || !res) return res;
    if (res.lineas) {
      for (const ln of Object.keys(res.lineas)) { const L = res.lineas[ln]; for (const s of Object.keys(L.servicios || {})) escalarObj(L.servicios[s], frac); }
      for (const k of Object.keys(res.totales || {})) escalarObj(res.totales[k], frac);
      res.frac = frac;
    } else for (const k of Object.keys(res)) escalarObj(res[k], frac);
    return res;
  }
  // Solo se llevan a ritmo de día completo las cantidades que ya son de las horas que cubre el
  // plan (envasado; cocción habitual y filtración estimada, que van × frac). Los cocimientos del
  // plan de cocinas y la filtración del plan de filtración son del día entero: se toman como
  // ritmo del día tal cual, y al multiplicar por frac cuenta la parte que cae en las horas del plan.
  const aRitmo = (prod, frac, enteros) => (frac < 1 && frac > 0 ? { coc: enteros && enteros.coc ? prod.coc : prod.coc / frac, fil: enteros && enteros.fil ? prod.fil : prod.fil / frac, env: prod.env / frac } : prod);
  const predElab = (E, d) => escalarRes(SrvElab.predecir(E, aRitmo(d.prod, d.frac || 1, d.enteros)), d.frac || 1);
  const predInd = (I, d) => escalarRes(SrvInd.predecir(I, aRitmo(d.prod, d.frac || 1, d.enteros)), d.frac || 1);
  function calcularPlanEnvasado() {
    const h = hlPorDia();
    if (!h || !h.dias.length) return null;
    const filas = h.dias.map((d) => {
      const plan = {};
      S.B && Object.keys(S.B.lineas).forEach((ln) => (plan[ln] = [(d.hl[ln] || 0) / (d.frac < 1 && d.frac > 0 ? d.frac : 1), "hL"]));
      const res = escalarRes(SrvPred.planificar(S.B, plan), d.frac);
      if (d.frac < 1) Object.keys(res.lineas).forEach((ln) => (res.lineas[ln].P_hL = d.hl[ln] || 0));
      return { ...d, res };
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
    const respVapor = [...new Set(R.filas.flatMap((f) => f.res.totales.vapor.lineas_respaldo || []))];
    el.innerHTML = `
      <div class="srv-filtros">
        <div class="srv-campo"><label>Día de producción</label><div class="srv-seg">${[[22, "22:00 a 22:00"], [6, "06:00 a 06:00"], [0, "00:00 a 24:00"]].map(([v, t]) => `<button type="button" data-corte="${v}" class="${S.corte === v ? "on" : ""}">${t}</button>`).join("")}</div></div>
        <p class="muted srv-nota-corte">El de 22:00 coincide con los días del instructivo de envasado (el día «martes 20» empieza el lunes a las 22:00) y es el día de planeación de T-minus. Los cocimientos se cuentan en el día calendario en que terminan, como en el Excel.</p>
      </div>
      <div class="srv-kpis">
        <div class="srv-kpi"><span>Días del plan</span><b>${R.filas.length}</b><small>${esc(R.filas[0].fecha)} → ${esc(R.filas[R.filas.length - 1].fecha)}</small></div>
        <div class="srv-kpi" style="--c:var(--srv-vapor)"><span>Vapor</span><b>${nf(tot.vapor / 1000, 0)} <small>t</small></b><small>${vaporIncompleto ? `sin ${esc(sinVapor.join(", "))} · ${(S.B.motor || 0) < 4 ? "modelos guardados con una versión anterior: vuelve a cargar el Excel" : "sin modelo confiable ni datos recientes suficientes"}` : respVapor.length ? `todas las líneas · ${esc(respVapor.join(", "))} con estimación de respaldo (baja confianza)` : "todas las líneas"}</small></div>
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
            if (f.parcial) notas.push(`día parcial: el plan cubre ${nf(f.frac * 24, 1)} h de 24 (el consumo fijo se cuenta solo por esas horas)`);
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
  // Relaciones históricas cocinado / envasado y filtrado / envasado (últimos 120 días con
  // envasado). Cocinado = MAESTRA EB + ED, en hL de cerveza (como cuenta el Excel).
  function relacionCocEnv() {
    const pd = (S.B && S.B.produccion_diaria) || [];
    if (!pd.length) return null;
    const fin = Date.parse(pd[pd.length - 1][0] + "T00:00:00Z");
    const rec = pd.filter((r) => fin - Date.parse(r[0] + "T00:00:00Z") < 120 * 86400000 && r[3] > 0);
    const c = rec.reduce((a, r) => a + (r[1] || 0), 0), fl = rec.reduce((a, r) => a + (r[2] || 0), 0), e = rec.reduce((a, r) => a + r[3], 0);
    return e > 0 && rec.length >= 30 ? { r: c / e, rFil: fl > 0 ? fl / e : 1, n: rec.length, desde: rec[0][0], hasta: rec[rec.length - 1][0], coc_dia: c / rec.length } : null;
  }
  // Factor mosto → cerveza de un cocimiento. El plan de cocinas da hL de MOSTO concentrado
  // (600 por cocimiento, 560 la Light); el Excel cuenta los hL cocinados como cerveza:
  // cerveza = mosto × factor de dilución del catálogo (≈ 1.145 hL por cocimiento de 600 a 1,91,
  // como se ve en MAESTRA EB). La Pony el Excel la cuenta a 2.050 hL por cocimiento
  // (columna ED, siempre múltiplos de 2.050), es decir × 3,42 sobre 600 hL de mosto.
  const PONY_EXCEL_HL = 2050;
  function factorCerveza(mostoId, volumen) {
    const cat = typeof MOSTO_CATALOG !== "undefined" ? MOSTO_CATALOG.find((m) => m.id === mostoId) : null;
    if (mostoId === "pony") return PONY_EXCEL_HL / ((cat && cat.volumenPorCocimiento) || 600);
    return cat && cat.factorDilucion > 0 ? cat.factorDilucion : null;
  }
  // hL cocinados, filtrados y envasados por día del plan (sin modelos): lo usan
  // elaboración, la vista general, Inicio y el módulo de servicios industriales.
  // Los días son los del plan de envasado (con su corte y sus días de borde).
  // Cocción:
  //  · «plan de cocinas»: los cocimientos de T-minus en hL de cerveza, cada uno en el día
  //    calendario en que termina (así los cuenta el Excel). Solo existen los cocimientos que
  //    pide el plan de envasado cargado: hacia el final del plan faltan los de las semanas siguientes.
  //  · «habitual»: lo envasado en todo el plan × relación histórica cocinado/envasado,
  //    repartido parejo por día (en el histórico la cocción de un día no sigue al envasado del mismo día).
  function prodPlan() {
    const st = typeof STATE !== "undefined" ? STATE : null;
    const hd = hlPorDia();
    if (!hd || !hd.dias.length) return null;
    const env = new Map(hd.dias.map((d) => [d.fecha, Object.values(d.hl).reduce((a, b) => a + b, 0)]));
    const rows = st && st.seq && st.seq.rows ? st.seq.rows.filter((r) => r.tipo === "cocimiento" && r.end && r.cocVolumenHL > 0) : [];
    const coc = new Map(), enPlan = new Set(hd.dias.map((d) => d.fecha));
    let sinFactor = 0, mostoTot = 0, cervezaTot = 0, nCoc = 0, fueraPlan = 0;
    for (const r of rows) {
      const k = factorCerveza(r.mostoId, r.cocVolumenHL);
      if (!k) { sinFactor++; continue; }
      const f = r.end.toISOString().slice(0, 10);
      if (!enPlan.has(f)) { fueraPlan++; continue; } // termina fuera de los días del plan de envasado
      coc.set(f, (coc.get(f) || 0) + r.cocVolumenHL * k);
      mostoTot += r.cocVolumenHL; cervezaTot += r.cocVolumenHL * k; nCoc++;
    }
    const rel = relacionCocEnv();
    let fil = null, filFuente = rel ? "envasado × relación histórica" : "envasado", filRango = null;
    try {
      if (typeof buildFiltracionPlanes === "function") {
        const p = buildFiltracionPlanes();
        const seg = p && p.ok ? (p.segments || []).filter((s) => s.tipo === "fil" && s.hl > 0) : [];
        if (seg.length) {
          fil = repartirPorDia(seg.map((s) => ({ a: s.start.getTime(), z: s.start.getTime() + Math.max(1, s.durH * 3600000), hl: s.hl })));
          const fs = [...fil.keys()].sort(); filRango = [fs[0], fs[fs.length - 1]]; filFuente = "plan de filtración";
        }
      }
    } catch (e) { console.error(e); }
    // Chequeo del plan de cocinas: por semana del plan, cocción planeada / envasado.
    const semanas = [];
    hd.dias.forEach((d, i) => { const w = Math.floor(i / 7); semanas[w] = semanas[w] || { desde: d.fecha, hasta: d.fecha, coc: 0, env: 0 }; semanas[w].hasta = d.fecha; semanas[w].coc += coc.get(d.fecha) || 0; semanas[w].env += env.get(d.fecha) || 0; });
    const envTot = [...env.values()].reduce((a, b) => a + b, 0), cocTot = hd.dias.reduce((a, d) => a + (coc.get(d.fecha) || 0), 0);
    const rPlan = envTot > 0 ? cocTot / envTot : null;
    const lejos = !coc.size || (rel && rPlan != null && (rPlan < 0.7 * rel.r || rPlan > 1.3 * rel.r));
    let modo = S.coccion === "auto" ? (lejos && rel ? "habitual" : "plan") : S.coccion;
    const sinRelacion = modo === "habitual" && !rel;
    if (sinRelacion) modo = "plan";
    // Sin relación histórica y sin plan de cocinas no hay con qué proyectar la cocción.
    if (modo === "plan" && !coc.size) return null;
    const sumFrac = hd.dias.reduce((a, d) => a + d.frac, 0);
    const cocRitmo = rel && sumFrac > 0 ? (envTot * rel.r) / sumFrac : 0; // hL cocinados por día completo
    const dias = hd.dias.map((d) => {
      const e = env.get(d.fecha) || 0, cp = coc.get(d.fecha) || 0;
      const c = modo === "habitual" ? cocRitmo * d.frac : cp;
      const enFil = fil && d.fecha >= filRango[0] && d.fecha <= filRango[1];
      const fl = enFil ? fil.get(d.fecha) || 0 : e * (rel ? rel.rFil : 1);
      return { fecha: d.fecha, frac: d.frac, parcial: d.parcial, prod: { coc: c, env: e, fil: fl }, coc_plan: cp, fil_de_plan: !!enFil, enteros: { coc: modo === "plan", fil: !!enFil } };
    });
    return { dias, filFuente, filRango, coccion: { modo, elegido: S.coccion, lejos: !!lejos, r_plan: rPlan, rel, coc_plan_dia: cocTot / Math.max(1, sumFrac), env_dia: envTot / Math.max(1, sumFrac), semanas, hay_plan_cocinas: rows.length > 0, n_cocimientos: nCoc, fuera_plan: fueraPlan, mosto_hl: mostoTot, cerveza_hl: cervezaTot, sin_factor: sinFactor, coc_ritmo: cocRitmo, sin_relacion: sinRelacion } };
  }
  function conectarCoccion(el, repintar) {
    el.querySelectorAll("[data-coccion]").forEach((b) => (b.onclick = () => { S.coccion = b.dataset.coccion; guardarCfg(); repintar(); }));
  }
  // Aviso y selector de la cocción usada en las proyecciones (mismo texto en todas las vistas).
  function avisoCoccion(pp) {
    const c = pp && pp.coccion;
    if (!c) return "";
    const pctR = (x) => (x == null ? "—" : SrvDatos.pctEs(x, 0));
    const n0 = (x) => SrvDatos.numEs(x, 0);
    const sem = (c.semanas || []).map((w, i) => `semana ${i + 1}: ${pctR(w.env ? w.coc / w.env : null)}`).join(" · ");
    const txt = !c.hay_plan_cocinas
      ? "No hay plan de cocinas cargado."
      : `El plan de cocinas de T-minus tiene ${n0(c.n_cocimientos)} cocimientos: ${n0(c.mosto_hl)} hL de mosto, que son ${n0(c.cerveza_hl)} hL de cerveza con el factor de dilución de cada mosto (así cuenta el Excel los hL cocinados). Eso es ${pctR(c.r_plan)} de lo que envasa el plan (${sem}).` + (c.rel ? ` En el histórico la planta cocinó ${pctR(c.rel.r)} de lo que envasó (${n0(c.rel.coc_dia)} hL/día, ${esc(c.rel.desde)} a ${esc(c.rel.hasta)}).` : "") + (c.lejos ? " El plan de cocinas solo trae los cocimientos que necesita el plan de envasado cargado: los de las semanas siguientes todavía no están, por eso la cocción planeada cae hacia el final y la elaboración saldría baja." : "") + (c.sin_factor ? ` ${c.sin_factor} cocimiento(s) sin mosto reconocido no se cuentan.` : "") + (c.fuera_plan ? ` ${c.fuera_plan} cocimiento(s) terminan fuera de los días del plan de envasado y no se cuentan.` : "") + (c.sin_relacion ? " No hay relación histórica cocinado/envasado (vuelve a cargar el Excel): se usa el plan de cocinas." : "");
    const usada = c.modo === "habitual" ? `Se usa la <b>cocción habitual</b>: lo envasado en el plan × ${c.rel ? SrvDatos.numEs(c.rel.r, 2) : "—"}, parejo por día (${n0(c.coc_ritmo)} hL/día).` : "Se usa el <b>plan de cocinas</b> (en hL de cerveza).";
    return `<div class="srv-aviso ${c.lejos && c.modo === "plan" ? "warn" : "info"} srv-coccion"><div>${txt} ${usada}</div>
      <div class="srv-campo"><label>Cocción para proyectar</label><div class="srv-seg">${[["auto", "Automática"], ["plan", "Plan de cocinas"], ["habitual", "Habitual (según envasado)"]].map(([k, t]) => `<button type="button" data-coccion="${k}" class="${S.coccion === k ? "on" : ""}">${t}</button>`).join("")}</div></div></div>`;
  }
  function avisoFiltracion(pp) {
    if (!pp) return "";
    if (pp.filFuente === "plan de filtración") return `<div class="srv-aviso info">hL filtrados del plan de filtración del ${esc(pp.filRango[0])} al ${esc(pp.filRango[1])}; los demás días, envasado × ${pp.coccion.rel ? SrvDatos.numEs(pp.coccion.rel.rFil, 2) : "1"} (relación histórica).</div>`;
    return `<div class="srv-aviso info">No hay plan de filtración cargado: los hL filtrados se toman como lo envasado del día × ${pp.coccion.rel ? SrvDatos.numEs(pp.coccion.rel.rFil, 2) : "1"} (relación histórica filtrado/envasado).</div>`;
  }
  function planElaboracion() {
    const pp = prodPlan();
    if (!pp) return null;
    const I = S.B.industriales;
    pp.dias.forEach((d) => { d.res = predElab(S.B.elaboracion, d); if (I) d.ind = predInd(I, d); });
    return pp;
  }
  function filaArea(r, uni) {
    const q = r.calidad || "";
    const cl = /Alta|Media/.test(q) ? "ok" : /Sin relación/.test(q) ? "warn" : "bad";
    const marcas = (r.carga_base ? ' <span class="srv-chip warn">carga base</span>' : "") + (r.extrapolacion ? ' <span class="srv-chip warn">fuera de rango</span>' : "") + (cl === "bad" ? ' <span class="srv-chip bad" title="' + esc(q) + '">poco confiable</span>' : "");
    return `<tr><td>${esc(r.area)}${marcas}</td><td class="n">${r.estimado === null ? "—" : nf(r.estimado)} <small class="muted">${uni}</small></td><td class="n">${r.intervalo ? `${nf(r.intervalo[0])} – ${nf(r.intervalo[1])}` : "—"}</td></tr>`;
  }
  // Planta completa (servicios-industriales.js): mismo plan y misma calculadora.
  const PLANTA = {
    vapor: { nombre: "Vapor", unidad: "kg", color: "var(--srv-vapor)", grande: [1000, "t", 0] },
    electricidad: { nombre: "Electricidad", unidad: "kWh", color: "var(--srv-elec)", grande: [1000, "MWh", 1] },
    agua: { nombre: "Agua", unidad: "hL", color: "var(--srv-agua)", grande: [10, "m³", 0] },
    "térmica": { nombre: "Térmica", unidad: "MJ", color: "var(--srv-term)", grande: [1000, "GJ", 0] },
  };
  const BASE_PLANTA = { vapor: "vapor_planta", electricidad: "elec_planta", agua: "agua_planta", "térmica": "termica_planta" };
  const clavePlanta = (I, s, v) => (I ? SrvInd.clave(I, BASE_PLANTA[s], v) : null);
  function vElab() {
    const el = $("#srvCuerpo"), E = S.B.elaboracion, I = S.B.industriales;
    if (!E) {
      el.innerHTML = `<div class="srv-vacio"><h4>Falta procesar elaboración</h4><p>${esc(S.B.elaboracion_error || "Este paquete se creó antes de que existiera el módulo de elaboración.")} Vuelve a cargar el Excel de Indicadores de servicios para calcularlo.</p></div>`;
      return;
    }
    const ev = S.elab, v = ev.variante;
    const vis = seriesVisibles(E, v);
    const P = { coc: ev.coc === "" ? Math.round(E.medias.coc) : Number(ev.coc), fil: ev.fil === "" ? Math.round(E.medias.fil) : Number(ev.fil), env: ev.env === "" ? Math.round(E.medias.env) : Number(ev.env) };
    const res = SrvElab.predecir(E, P);
    const resI = I ? SrvInd.predecir(I, P) : null;
    const tablaPlanta = () => {
      if (!I) return `<div class="srv-res"><div class="srv-res-cab"><h4>Planta completa</h4></div><p class="muted">${esc(S.B.industriales_error || "Vuelve a cargar el Excel de Indicadores de servicios para calcular el consumo de toda la planta.")}</p></div>`;
      const filas = Object.keys(PLANTA).map((s) => {
        const k = clavePlanta(I, s, v), r = k && resI[k];
        if (!r) return "";
        const ke = TOTAL_ELAB(v)[s], re = ke ? res[ke] : null;
        const parte = re && re.estimado != null && r.estimado ? pct(re.estimado / r.estimado, 0) : "—";
        return filaArea(Object.assign({}, r, { area: PLANTA[s].nombre + (I.modelos[k].variante ? ` (${I.modelos[k].variante})` : "") }), PLANTA[s].unidad).replace("</tr>", `<td class="n">${parte}</td></tr>`);
      }).join("");
      return `<div class="srv-res" style="--c:var(--srv-term)"><div class="srv-res-cab"><h4>Planta completa</h4></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Servicio</th><th class="n">Estimado</th><th class="n">Margen 90 %</th><th class="n">Elaboración</th></tr></thead><tbody>${filas}</tbody></table></div></div>`;
    };
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
      const sumarP = (s) => { const k = clavePlanta(I, s, v); return k ? plan.dias.reduce((a, d) => a + (d.ind[k].estimado || 0), 0) : null; };
      const fueraP = I ? plan.dias.filter((d) => Object.keys(PLANTA).some((s) => { const k = clavePlanta(I, s, v); return k && d.ind[k].extrapolacion; })).length : 0;
      const kpiP = I ? `<div class="srv-card-t" style="margin-top:6px">Planta completa <small class="muted">· elaboración, envasado, servicios y demás áreas</small></div>
          <div class="srv-kpis">${Object.entries(PLANTA).map(([s, x]) => { const t = sumarP(s), e = TOTAL_ELAB(v)[s] ? sumar(s) : null; const k = clavePlanta(I, s, v); return `<div class="srv-kpi" style="--c:${x.color}"><span>${x.nombre} de la planta${I.modelos[k].variante ? ` (${I.modelos[k].variante})` : ""}</span><b>${nf(t / x.grande[0], x.grande[2])} <small>${x.grande[1]}</small></b><small>${e != null && t ? `elaboración ≈ ${pct(e / t, 0)} · ` : ""}${esc(I.modelos[k].calidad)}</small></div>`; }).join("")}</div>
          ${fueraP ? `<div class="srv-aviso info">En ${fueraP} de ${plan.dias.length} días la producción del plan queda fuera del rango histórico de la planta${plan.coccion.modo === "plan" ? " (sobre todo por los pocos hL cocinados)" : ""}: esos días el total de planta es una extrapolación de la recta.</div>` : ""}` : `<div class="srv-aviso info">${esc(S.B.industriales_error || "Para ver el consumo de toda la planta, vuelve a cargar el Excel de Indicadores de servicios.")}</div>`;
      planHtml = `
        <div class="srv-card"><div class="srv-card-t">Proyección del plan de T-minus <small class="muted">· ${plan.dias.length} días, del ${esc(plan.dias[0].fecha)} al ${esc(plan.dias[plan.dias.length - 1].fecha)}</small></div>
          <div class="srv-kpis">
            <div class="srv-kpi" style="--c:var(--srv-vapor)"><span>Vapor de elaboración (${v})</span><b>${nf(sumar("vapor") / 1000)} <small>t</small></b><small>${plan.coccion.modo === "habitual" ? "con la cocción habitual" : "con los hL cocinados del plan de cocinas"}</small></div>
            <div class="srv-kpi" style="--c:var(--srv-elec)"><span>Electricidad de elaboración</span><b>${nf(sumar("electricidad") / 1000, 1)} <small>MWh</small></b><small>cocinas + filtración</small></div>
            <div class="srv-kpi" style="--c:var(--srv-agua)"><span>Agua de elaboración</span><b>${nf(sumar("agua") / 10)} <small>m³</small></b><small>cocinas + cavas + filtración</small></div>
          </div>
          ${kpiP}
          ${avisoCoccion(plan)}
          ${avisoFiltracion(plan)}
          <div class="srv-grid3">${P_SERV.map((s) => `<div><div class="srv-card-t" style="margin-top:10px">${SERV[s].nombre} por día <small class="muted">· raya = margen 90 %${I ? " de la planta" : ""}</small></div><div class="chart" id="srvElabPlan-${s}"></div>${I ? `<div class="srv-ley"><span><i style="background:${SERV[s].color}"></i>Elaboración</span><span><i style="background:color-mix(in srgb, ${SERV[s].color} 32%, transparent)"></i>Resto de la planta</span></div>` : ""}</div>`).join("")}</div>
          <details class="srv-det"><summary class="srv-card-t">Tabla día por día</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Día</th><th class="n">hL cocinados${plan.coccion.modo === "habitual" ? " (habitual)" : ""}</th>${plan.coccion.modo === "habitual" && plan.coccion.hay_plan_cocinas ? '<th class="n">Plan de cocinas (hL de cerveza)</th>' : ""}<th class="n">hL filtrados</th><th class="n">hL envasados</th><th class="n">Vapor (kg)</th><th class="n">Electricidad (kWh)</th><th class="n">Agua (hL)</th>${I ? Object.entries(PLANTA).map(([s, x]) => `<th class="n">Planta ${x.nombre.toLowerCase()} (${x.unidad})</th>`).join("") : ""}<th>Notas</th></tr></thead><tbody>${plan.dias
            .map((d) => { const n = []; if (d.parcial) n.push("día parcial"); P_SERV.forEach((s) => { const x = d.res[tot[s]]; if (x.carga_base) n.push(`${SERV[s].nombre.toLowerCase()}: carga base`); if (x.extrapolacion) n.push(`${SERV[s].nombre.toLowerCase()}: fuera de rango`); }); return `<tr class="${d.parcial ? "muted" : ""}"><td>${esc(d.fecha)}</td><td class="n">${nf(d.prod.coc)}</td>${plan.coccion.modo === "habitual" && plan.coccion.hay_plan_cocinas ? `<td class="n">${nf(d.coc_plan)}</td>` : ""}<td class="n">${nf(d.prod.fil)}</td><td class="n">${nf(d.prod.env)}</td><td class="n">${nf(d.res[tot.vapor].estimado)}</td><td class="n">${nf(d.res[tot.electricidad].estimado)}</td><td class="n">${nf(d.res[tot.agua].estimado)}</td>${I ? Object.keys(PLANTA).map((s) => { const k = clavePlanta(I, s, v); const x = k && d.ind[k]; if (x && x.extrapolacion && !n.includes("planta: fuera de rango")) n.push("planta: fuera de rango"); return `<td class="n">${x ? nf(x.estimado) : "—"}</td>`; }).join("") : ""}<td class="muted">${esc(n.join(" · "))}</td></tr>`; })
            .join("")}</tbody></table></div></details>
        </div>`;
    }
    const prec = Object.values(E.modelos).filter((m) => m.test);
    const precP = I ? Object.keys(PLANTA).flatMap((s) => [SrvInd.clave(I, BASE_PLANTA[s], "oficial"), SrvInd.clave(I, BASE_PLANTA[s], "contador")]).filter((k, i, a) => k && a.indexOf(k) === i).map((k) => I.modelos[k]).filter((m) => m.test) : [];
    el.innerHTML = `
      <div class="srv-filtros">
        <div class="srv-campo"><label>Vapor y térmica</label><div class="srv-seg">${[["oficial", "Oficial (Excel)"], ["contador", "Contador sin ajustes"]].map(([k, t]) => `<button type="button" data-ev="${k}" class="${v === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
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
        <p class="muted srv-tipicos">Por defecto, el promedio diario de ${esc(E.desde)} a ${esc(E.hasta)}. Por debajo del 5 % de la media del área se usa su carga base medida.</p>
        <div class="srv-elab-res">${P_SERV.map(tabla).join("")}</div><div class="srv-elab-planta">${tablaPlanta()}</div>
      </div>
      <div class="srv-card"><div class="srv-card-t">Qué tan certera es la proyección <small class="muted">· prueba final: últimos ${prec[0] ? prec[0].n_test : "—"} días, que no se usaron para elegir</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Área</th><th>Servicio</th><th>Variable que mejor lo explica</th><th>Modelo</th><th class="n">Error diario</th><th class="n">Error semanal</th><th class="n">Cobertura 90 %</th><th>Calidad</th></tr></thead><tbody>${prec
          .map((m) => `<tr><td>${esc(m.area)}</td><td>${esc(SERV[m.servicio].nombre)}${m.variante ? ` <small class="muted">(${esc(m.variante)})</small>` : ""}</td><td>${m.familia === "media" ? "ninguna (consumo fijo)" : esc(SrvElab.NOMBRE_DRIVER[m.drivers])}</td><td title="${esc(m.formula || m.modelo)}">${esc(NOMBRE_MODELO[m.familia] || m.familia)}${m.cols && m.cols.length > 1 ? " múltiple" : ""}${m.politica === "reciente" ? ' <small class="muted" title="Entrenado solo con los últimos 120 días: mejoró el error de validación al menos 3 %">· últimos 120 días</small>' : ""}</td><td class="n">${pct(m.test.WAPE)}</td><td class="n">${pct(m.test_semanal.WAPE)}</td><td class="n">${pct(m.cobertura, 0)}</td><td><span class="srv-chip ${/Alta|Media/.test(m.calidad) ? "ok" : /Sin relación/.test(m.calidad) ? "warn" : "bad"}">${esc(m.calidad)}</span></td></tr>`)
          .join("")}${precP
          .map((m) => `<tr class="srv-total"><td>Planta completa</td><td>${esc(PLANTA[m.servicio].nombre)}${m.variante ? ` <small class="muted">(${esc(m.variante)})</small>` : ""}</td><td>${m.familia === "media" ? "ninguna (consumo fijo)" : esc(SrvElab.NOMBRE_DRIVER[m.drivers])}</td><td title="${esc(m.formula || m.modelo)}">${esc(NOMBRE_MODELO[m.familia] || m.familia)}${m.cols && m.cols.length > 1 ? " múltiple" : ""}${m.politica === "reciente" ? ' <small class="muted" title="Entrenado solo con los últimos 120 días: mejoró el error de validación al menos 3 %">· últimos 120 días</small>' : ""}</td><td class="n">${pct(m.test.WAPE)}</td><td class="n">${pct(m.test_semanal.WAPE)}</td><td class="n">${pct(m.cobertura, 0)}</td><td><span class="srv-chip ${/Alta|Media/.test(m.calidad) ? "ok" : /Sin relación/.test(m.calidad) ? "warn" : "bad"}">${esc(m.calidad)}</span></td></tr>`)
          .join("")}</tbody></table></div>
        <p class="muted">Error = WAPE (suma de errores sobre consumo real). Se compararon hL cocinados, filtrados y envasados, solos y combinados, con siete tipos de modelo y validación temporal; queda el más simple dentro del 3 % del mejor. En electricidad casi todo es carga fija: el error es bajo porque el consumo cambia poco.</p>
      </div>
      <div class="srv-card"><div class="srv-card-t">Carga base <small class="muted">· consumo con la producción del área por debajo del 5 % de su media</small></div>
        <div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Área</th><th>Servicio</th><th class="n">Días</th><th class="n">Carga base (mediana)</th><th class="n">Rango</th><th class="n">Fijo con el área operando</th><th class="n">Promedio con producción</th><th class="n">Base / promedio</th></tr></thead><tbody>${Object.values(E.modelos)
          .filter((m) => m.carga_base && m.carga_base.n && m.serie !== "vapor_cyf_medido")
          .map((m) => `<tr><td>${esc(m.area)}${m.naturales[0] === "coc" && m.area !== "Cocinas" ? ' <small class="muted">(días sin cocinar)</small>' : ""}</td><td>${esc(SERV[m.servicio].nombre)}${m.variante ? ` <small class="muted">(${esc(m.variante)})</small>` : ""}</td><td class="n">${m.carga_base.n}</td><td class="n">${nf(m.carga_base.mediana)} ${m.unidad}</td><td class="n">${nf(m.carga_base.min)} a ${nf(m.carga_base.max)}</td><td class="n">${m.fijo_operando != null && m.area !== "Elaboración" && m.area !== "Cavas" ? nf(m.fijo_operando) + " " + m.unidad : "—"}</td><td class="n">${nf(m.media_valida)} ${m.unidad}</td><td class="n">${m.media_valida ? pct(m.carga_base.mediana / m.media_valida, 0) : "—"}</td></tr>`)
          .join("")}</tbody></table></div>
        <p class="muted">«Fijo con el área operando» es el corte de la recta con producción cero: lo que se gasta por estar en marcha. La carga base es lo que queda con el área parada. Con 2 días o menos, la cifra es orientativa.</p>
      </div>
      ${auditoriaElab(E)}`;
    el.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { ev.variante = b.dataset.ev; vElab(); SrvCharts.conectarTips(el); }));
    el.querySelectorAll("[data-corte]").forEach((b) => (b.onclick = () => { S.corte = Number(b.dataset.corte); guardarCfg(); vElab(); SrvCharts.conectarTips(el); }));
    conectarCoccion(el, () => { vElab(); SrvCharts.conectarTips(el); });
    $("#srvFElab").onsubmit = (e) => { e.preventDefault(); ev.coc = $("#srvEcoc").value; ev.fil = $("#srvEfil").value; ev.env = $("#srvEenv").value; vElab(); SrvCharts.conectarTips(el); };
    if (plan) {
      const cats = plan.dias.map((d) => d.fecha.slice(8, 10) + "/" + d.fecha.slice(5, 7));
      P_SERV.forEach((s) => {
        const k = tot[s];
        const kp = clavePlanta(I, s, v);
        const series = [{ color: SERV[s].color, valores: plan.dias.map((d) => d.res[k].estimado || 0), tips: plan.dias.map((d) => `${d.fecha}: ${nf(d.res[k].estimado)} ${SERV[s].unidad} de elaboración con ${nf(d.prod.coc)} hL cocinados`) }];
        if (kp) series.push({ color: `color-mix(in srgb, ${SERV[s].color} 32%, transparent)`, valores: plan.dias.map((d) => Math.max(0, (d.ind[kp].estimado || 0) - (d.res[k].estimado || 0))), tips: plan.dias.map((d) => `${d.fecha}: planta completa ${nf(d.ind[kp].estimado)} ${SERV[s].unidad} (margen ${d.ind[kp].intervalo ? nf(d.ind[kp].intervalo[0]) + " – " + nf(d.ind[kp].intervalo[1]) : "—"})`) });
        SrvCharts.apiladas(document.getElementById("srvElabPlan-" + s), { W: 420, H: 230, maxEtiquetas: 6, cats, series, rangos: plan.dias.map((d) => (kp ? d.ind[kp].intervalo : d.res[k].intervalo)), marcas: plan.dias.map((d) => (d.parcial ? "parcial" : "")), yLab: `${SERV[s].unidad}/día`, aria: `${SERV[s].nombre} de elaboración${kp ? " y del resto de la planta" : ""} por día` });
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
      <details class="srv-card srv-det"><summary class="srv-card-t">Qué días se usan para entrenar</summary><div class="srv-tabla-wrap"><table class="srv-tabla"><thead><tr><th>Entrenamiento</th><th class="n">WAPE</th><th class="n">MAE</th></tr></thead><tbody>${Object.entries(m.comparacion_politicas || {}).map(([p, v]) => `<tr class="${p === m.politica_atipicos ? "sel" : ""}"><td>${{ todos: "Todos los días válidos", sin_atipicos: "Sin atípicos estadísticos", sin_marcados: "Sin valores con ajuste manual", reciente: "Solo los últimos 120 días" }[p]}</td><td class="n">${pct(v.WAPE)}</td><td class="n">${nf(v.MAE)}</td></tr>`).join("")}</tbody></table></div><p class="muted">Se valida siempre sobre los días sin filtrar; otra política se adopta solo si baja el error al menos 3 %.</p></details>` : ""}`;
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
    const I = B.industriales;
    if (I) {
      hojas.push(["Ind_modelos", Object.values(I.modelos).map((m) => ({ serie: m.serie, sistema: m.sistema, servicio: m.servicio, variante: m.variante, unidad: m.unidad, descripcion: m.descripcion, variable: m.familia === "media" ? "ninguna" : SrvElab.NOMBRE_DRIVER[m.drivers] || "", modelo: m.modelo || "", formula: m.formula || (m.web && m.web.tipo === "multi" ? `C = ${m.web.b0} + ${m.web.b.join(" , ")} · (${(m.cols || []).join(", ")})` : ""), cv_WAPE: m.cv && m.cv.WAPE, test_WAPE: m.test && m.test.WAPE, test_WAPE_semanal: m.test_semanal && m.test_semanal.WAPE, cobertura_90: m.cobertura, calidad: m.calidad, margen_inf: m.q && m.q[0], margen_sup: m.q && m.q[1], carga_base_dias: m.carga_base.n, carga_base_mediana: m.carga_base.mediana, fijo_operando: m.fijo_operando, promedio_con_produccion: m.media_valida, dias_validos: m.n_estados.valido || 0, dias_excluidos: m.n_estados.excluido || 0 }))]);
      hojas.push(["Ind_historico", Object.values(I.modelos).flatMap((m) => m.historico.map((h) => ({ serie: m.serie, fecha: h.f, consumo: h.c, estado: h.e, motivo: h.m })))]);
      try {
        const pl = prodPlan();
        if (pl) hojas.push(["Ind_plan", pl.dias.flatMap((d) => { const r = predInd(I, d); return Object.values(r).map((x) => ({ dia: d.fecha, hL_cocinados: d.prod.coc, hL_filtrados: d.prod.fil, hL_envasados: d.prod.env, serie: x.serie, sistema: x.sistema, servicio: x.servicio, variante: x.variante, unidad: x.unidad, estimado: x.estimado, margen_inf: x.intervalo && x.intervalo[0], margen_sup: x.intervalo && x.intervalo[1], carga_base: x.carga_base ? "sí" : "", fuera_de_rango: x.extrapolacion ? "sí" : "", calidad: x.calidad })); })]);
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
        out.elab = { dias: pl.dias.length, coccion: pl.coccion.modo };
        for (const k of P_SERV) out.elab[k] = pl.dias.reduce((a, d) => a + (d.res[t[k]].estimado || 0), 0);
        const I = S.B.industriales;
        if (I) {
          out.planta = { dias: pl.dias.length, env: pl.dias.reduce((a, d) => a + d.prod.env, 0) };
          for (const k of Object.keys(PLANTA)) { const c = clavePlanta(I, k, "oficial"); out.planta[k] = c ? pl.dias.reduce((a, d) => a + (d.ind[c].estimado || 0), 0) : null; }
          const ct = SrvInd.clave(I, "termica_comprada", "oficial");
          out.planta.termica_comprada = ct ? pl.dias.reduce((a, d) => a + (d.ind[ct].estimado || 0), 0) : null;
        }
      }
    } catch (e) { console.error(e); }
    return out;
  }

  window.renderServicios = renderServicios;
  window.resumenServicios = resumenServicios;
  window.__srv = S;
  window.srvCargar = () => { cargarGuardado(); return S.B; };
  window.srvLimpiar = limpiarDatos;
  window.srvProdPlan = () => (S.B ? prodPlan() : null);
  window.srvAvisoCoccion = avisoCoccion;
  window.srvAvisoFiltracion = avisoFiltracion;
  window.srvPredInd = predInd;
  window.srvConectarCoccion = conectarCoccion;
  window.srvCorte = (c) => { if (c !== undefined && [0, 6, 22].includes(c)) { S.corte = c; guardarCfg(); } return S.corte; };
})();
