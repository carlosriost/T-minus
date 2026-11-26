/* =========================================================================
   HISTORIAL DE PLANES DE ENVASADO
   -------------------------------------------------------------------------
   Cada vez que se carga un instructivo, T-minus guarda en este navegador
   (IndexedDB) una copia compacta de sus bloques por línea: tipo, inicio,
   fin, SKU, hL, velocidad y eficiencia. No guarda el Excel.
   Con eso:
     · «GLY · LEF · OSE» puede sumar el mes completo con lo planificado: para
       cada día de producción usa el último plan cargado que cubre ese día.
     · «Comparación de plan» compara el plan de principio de mes con cada
       actualización: volumen, formatos, paradas y arranques, horas.
   El mismo archivo cargado dos veces se guarda una sola vez. El historial
   solo vive en este navegador; se puede exportar e importar (JSON) para
   llevarlo a otro computador.
   ========================================================================= */
(function () {
  "use strict";
  const CLAVE = "historial.planes";
  const H = 3600000;
  const DIA = 24 * H;
  const DESFASE = 2 * H; // el día de producción va de 22:00 a 22:00
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  let HIST = [];
  let LISTO = null;
  const SEL = { mes: null, base: null, comp: null };
  let MSG = "";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d) => MOD_NF(v, d || 0);
  const fdt = (ms) => fmtDateTime(new Date(ms));
  const fd = (ms) => fmtDate(new Date(ms));
  // Hora real de carga → texto en hora de planta (Colombia, UTC−5).
  const fCarga = (iso) => {
    const t = Date.parse(iso);
    return isFinite(t) ? fdt(t - 5 * H) : "—";
  };

  /* ------------------------------------------------------------ almacén */
  // Lee el historial una sola vez. Si la lectura falla, no se marca como
  // leído y NO se deja guardar: así nunca se pisa el historial guardado con
  // una lista vacía.
  let LEIDO = false;
  function cargar() {
    if (LISTO) return LISTO;
    if (!window.TMAlmacen) return Promise.resolve();
    LISTO = TMAlmacen.leer(CLAVE)
      .then((v) => {
        HIST = Array.isArray(v) ? v.filter((s) => s && s.id && s.lineas) : [];
        LEIDO = true;
      })
      .catch((e) => {
        console.error(e);
        LISTO = null;
      });
    return LISTO;
  }
  function guardar() {
    if (!window.TMAlmacen || !LEIDO) return Promise.reject(new Error("no se pudo leer el historial guardado; no se guarda para no borrarlo"));
    return TMAlmacen.escribir(CLAVE, HIST);
  }

  function hash(txt) {
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      h1 = (h1 * 33) ^ c;
      h2 = (h2 * 33) ^ c;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + txt.length.toString(36);
  }

  function fotoActual() {
    const m = (typeof STATE !== "undefined" && STATE && STATE.mergedByTrain) || null;
    if (!m) return null;
    const lineas = {};
    let desde = Infinity, hasta = -Infinity;
    TRAINS.forEach((t) => {
      lineas[t] = (m[t] || [])
        .filter((b) => b.start && b.end && b.end > b.start)
        .map((b) => {
          desde = Math.min(desde, b.start.getTime());
          hasta = Math.max(hasta, b.end.getTime());
          return [b.type, b.start.getTime(), b.end.getTime(), b.name || b.codigo || "", Number(b.hectolitros) || 0, Number(b.velocidad) || 0, Number(b.eficiencia) || 0];
        });
    });
    if (!isFinite(desde)) return null;
    return { id: hash(JSON.stringify(lineas)), desde, hasta, lineas };
  }

  // Se llama después de pintar un instructivo (js/ui.js).
  function registrar(nombre, opts) {
    opts = opts || {};
    const f = fotoActual();
    if (!f) return Promise.resolve();
    return cargar().then(() => {
      if (!LEIDO || HIST.some((s) => s.id === f.id)) return;
      const c = opts.cargado ? new Date(typeof opts.cargado === "number" ? opts.cargado : Date.parse(opts.cargado)) : new Date();
      HIST.push(Object.assign(f, { archivo: nombre || "instructivo", cargado: isNaN(c) ? new Date().toISOString() : c.toISOString() }));
      HIST.sort((a, b) => Date.parse(a.cargado) - Date.parse(b.cargado));
      return guardar().catch((e) => console.error("No se pudo guardar el historial de planes", e));
    }).then(() => {
      // Las vistas que usan el historial se vuelven a pintar con el plan nuevo.
      ["renderIndicadoresEnvasado", "renderComparacionPlan"].forEach((f) => {
        const v = { renderIndicadoresEnvasado: "view-envasado-kpi", renderComparacionPlan: "view-comparacion-plan" }[f];
        const el = document.getElementById(v);
        if (typeof window[f] === "function" && el && !el.hidden && el.offsetParent !== null) window[f]();
      });
    });
  }

  // Suma planes de otro historial (importado o del paquete de la semana).
  function fusionar(planes) {
    return cargar().then(() => {
      const validos = (Array.isArray(planes) ? planes : []).filter(
        (s) => s && typeof s.id === "string" && s.lineas && typeof s.lineas === "object" && isFinite(s.desde) && isFinite(s.hasta) && typeof s.cargado === "string" && TRAINS.every((t) => !s.lineas[t] || Array.isArray(s.lineas[t])),
      );
      const nuevos = validos.filter((s) => !HIST.some((x) => x.id === s.id));
      if (!nuevos.length) return { validos: validos.length, nuevos: 0 };
      HIST = HIST.concat(nuevos).sort((a, b) => Date.parse(a.cargado) - Date.parse(b.cargado));
      return guardar().then(() => ({ validos: validos.length, nuevos: nuevos.length }));
    });
  }

  /* ------------------------------------------------------------ consultas */
  // Bloques de una foto con la forma de STATE.mergedByTrain.
  function aMerged(s) {
    const out = {};
    TRAINS.forEach((t) => {
      out[t] = (s.lineas[t] || []).map((x) => ({ type: x[0], start: new Date(x[1]), end: new Date(x[2]), name: x[3], hectolitros: x[4], velocidad: x[5], eficiencia: x[6] }));
    });
    return out;
  }
  const cache = new Map();
  function merged(s) {
    if (!cache.has(s.id)) cache.set(s.id, aMerged(s));
    return cache.get(s.id);
  }

  // Ventana [a, z) del día de producción con fecha (UTC) dia.
  const ventanaDia = (dia) => [dia - DESFASE, dia + DIA - DESFASE];
  function diasDelMes(clave) {
    const [y, m] = clave.split("-").map(Number);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => Date.UTC(y, m - 1, i + 1));
  }
  function mesDe(ms) {
    const d = new Date(ms + DESFASE);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const nombreMes = (clave) => {
    const [y, m] = clave.split("-").map(Number);
    return `${MESES[m - 1]} ${y}`;
  };
  function mesesConPlan() {
    const set = new Set();
    HIST.forEach((s) => {
      for (let t = s.desde; t < s.hasta; t += DIA) set.add(mesDe(t));
      set.add(mesDe(s.hasta - 1));
    });
    return [...set].sort();
  }
  const ventanaMes = (clave) => {
    const d = diasDelMes(clave);
    return [ventanaDia(d[0])[0], ventanaDia(d[d.length - 1])[1]];
  };
  const tocaMes = (s, clave) => {
    const [a, z] = ventanaMes(clave);
    return s.desde < z && s.hasta > a;
  };

  // Para cada día del mes, el último plan cargado que lo cubre.
  // → [{ dia, a, z, snap }] con a–z recortado a lo que cubre ese plan.
  function planCosido(clave) {
    return diasDelMes(clave).map((dia) => {
      const [a, z] = ventanaDia(dia);
      const cand = HIST.filter((s) => s.desde < z && s.hasta > a);
      if (!cand.length) return { dia, a, z, snap: null };
      const completos = cand.filter((s) => s.desde <= a && s.hasta >= z);
      const pool = completos.length ? completos : cand;
      const snap = pool.reduce((m, s) => (Date.parse(s.cargado) > Date.parse(m.cargado) ? s : m));
      return { dia, a: Math.max(a, snap.desde), z: Math.min(z, snap.hasta), snap };
    });
  }

  /* --------------------------------------------------------- resúmenes */
  const cacheParadas = new Map();
  function paradasDe(s) {
    if (cacheParadas.has(s.id)) return cacheParadas.get(s.id);
    let out = [];
    if (typeof calcularModulacion === "function" && typeof modlConfig === "function") {
      try {
        out = calcularModulacion(merged(s), modlConfig()).paradas.map((p) => ({ tren: p.tren, para: p.para, arranca: p.arranca, dur: p.arranca - p.para, motivo: p.motivo, desdeInicio: p.desdeInicio, hastaFin: p.hastaFin }));
      } catch (e) {
        console.error(e);
      }
    }
    cacheParadas.set(s.id, out);
    return out;
  }

  // Semanas de producción (lunes 22:00 del domingo anterior → domingo 22:00)
  // que tocan el mes elegido, con su número ISO.
  function semanasDelMes(clave) {
    const [ma, mz] = ventanaMes(clave);
    const out = [];
    for (let lun = lunesDe(ma); lun - DESFASE < mz; lun += 7 * DIA) {
      const a = lun - DESFASE, z = lun + 7 * DIA - DESFASE;
      out.push({ num: numSemanaIso(lun), lun, a, z, txt: `${fmtDate(new Date(lun)).slice(4)} al ${fmtDate(new Date(lun + 6 * DIA)).slice(4)}` });
    }
    return out;
  }

  function resumen(s, a, z) {
    const m = merged(s);
    const IE = window.IndicadoresEnvasado;
    const porLinea = {};
    const porSku = {};
    TRAINS.forEach((t) => {
      const r = IE ? IE.indicadores(IE.tiempos(t, a, z, m[t])) : null;
      let cambios = 0;
      (m[t] || []).forEach((b) => {
        const x = Math.max(a, b.start.getTime());
        const y = Math.min(z, b.end.getTime());
        if (y <= x) return;
        if (b.type === "production") {
          const hl = (b.hectolitros || 0) * ((y - x) / (b.end - b.start));
          const k = t + "|" + b.name;
          if (!porSku[k]) porSku[k] = { tren: t, sku: b.name, hl: 0 };
          porSku[k].hl += hl;
        } else if (b.type === "changeover" && b.start.getTime() >= a) cambios++;
      });
      // Cambios de formato (mismo criterio que el acuerdo L4 de Logística):
      // dos bloques de producción seguidos de la línea con distinto formato;
      // cuenta en la ventana donde arranca el bloque nuevo.
      let cambiosFormato = 0;
      const prod = (m[t] || []).filter((b) => b.type === "production").sort((x, y) => x.start - y.start);
      for (let i = 1; i < prod.length; i++) {
        const ini = prod[i].start.getTime();
        if (ini >= a && ini < z && formatoDeSKU(prod[i].name) !== formatoDeSKU(prod[i - 1].name)) cambiosFormato++;
      }
      // Paradas (la línea para) y arranques (vuelve a arrancar) de 2 h o más
      // que caen en la ventana.
      const pl = paradasDe(s).filter((p) => p.tren === t);
      const paradasN = pl.filter((p) => !p.desdeInicio && p.para >= a && p.para < z).length;
      const arranquesN = pl.filter((p) => !p.hastaFin && p.arranca >= a && p.arranca < z).length;
      porLinea[t] = Object.assign({ cambios, cambiosFormato, paradasN, arranquesN }, r || {});
    });
    // Las paradas que empiezan con el plan o siguen hasta su final no se
    // comparan: cada plan cubre fechas distintas y saldrían «movidas».
    const paradas = paradasDe(s).filter((p) => !p.desdeInicio && !p.hastaFin && p.para < z && p.arranca > a);
    const tot = (k) => TRAINS.reduce((acc, t) => acc + (porLinea[t][k] || 0), 0);
    const hlPony = Object.values(porSku)
      .filter((x) => /pony|\bpm\b|malta/i.test(x.sku))
      .reduce((acc, x) => acc + x.hl, 0);
    return { porLinea, porSku, paradas, hlPony, cambiosFormato: tot("cambiosFormato"), paradasN: tot("paradasN"), arranquesN: tot("arranquesN"), hlCerveza: tot("hl") - hlPony, hl: tot("hl"), prod: tot("prod"), dpa: tot("dpa"), nst: tot("nst"), cambios: tot("cambios"), planta: IE ? IE.indicadores(IE.sumar(TRAINS.map((t) => porLinea[t]))) : null };
  }

  // Empareja paradas por línea: misma parada si se traslapan.
  function compararParadas(pb, pc) {
    const usadas = new Set();
    const out = [];
    pb.forEach((b) => {
      const i = pc.findIndex((c, j) => !usadas.has(j) && c.tren === b.tren && c.para < b.arranca && c.arranca > b.para);
      if (i < 0) return out.push({ tipo: "quitada", b });
      usadas.add(i);
      const c = pc[i];
      const igual = Math.abs(c.para - b.para) < H && Math.abs(c.arranca - b.arranca) < H;
      out.push({ tipo: igual ? "igual" : "movida", b, c });
    });
    pc.forEach((c, j) => {
      if (!usadas.has(j)) out.push({ tipo: "nueva", c });
    });
    return out.sort((x, y) => (x.b || x.c).para - (y.b || y.c).para || String((x.b || x.c).tren).localeCompare(String((y.b || y.c).tren)));
  }

  /* ------------------------------------------------------------ vista */
  const pct = (v) => (v == null ? "—" : `${nf(v * 100, 1)} %`);
  function delta(b, c, dec, unidad) {
    const d = c - b;
    if (Math.abs(d) < Math.pow(10, -(dec || 0)) / 2) return `<span class="cp-igual">sin cambio</span>`;
    const p = b ? ` (${d > 0 ? "+" : ""}${nf((d / b) * 100, 1)} %)` : "";
    return `<span class="${d > 0 ? "cp-mas" : "cp-menos"}">${d > 0 ? "+" : "−"}${nf(Math.abs(d), dec)}${unidad || ""}${p}</span>`;
  }
  function deltaPp(b, c) {
    if (b == null || c == null) return "—";
    const d = (c - b) * 100;
    if (Math.abs(d) < 0.05) return `<span class="cp-igual">sin cambio</span>`;
    return `<span class="${d > 0 ? "cp-mas" : "cp-menos"}">${d > 0 ? "+" : "−"}${nf(Math.abs(d), 1)} pp</span>`;
  }
  const etiqueta = (s) => `${esc(s.archivo)} · cargado ${esc(fCarga(s.cargado))}`;

  function renderComparacionPlan() {
    const cont = document.getElementById("comparacionPlanPanel");
    if (!cont) return;
    cargar().then(() => pintar(cont));
  }

  function pintar(cont) {
    const meses = mesesConPlan();
    const acciones = `<div class="acx-acc">
        <button class="btn small" id="cpExportar" ${HIST.length ? "" : "disabled"}>Exportar historial</button>
        <label class="btn small" for="cpImportar">Importar historial</label><input type="file" id="cpImportar" accept=".json" hidden />
      </div>`;
    const intro = `<div class="gantt-intro">
        <p><b>Qué es.</b> Cada vez que se carga un plan de envasado, T-minus guarda una copia en este navegador. Aquí se compara el plan con que arrancó el mes con cada actualización que se cargó después: cuánto volumen cambió, qué formatos entraron o salieron, y qué paradas y arranques de línea se movieron.</p>
        <p class="gantt-intro-pie">La comparación se hace solo en los días que cubren los dos planes y que caen en el mes elegido. El historial vive en este navegador: para llevarlo a otro computador, expórtelo e impórtelo.</p>
      </div>`;
    if (!meses.length) {
      cont.innerHTML = `<div class="panel"><div class="panel-head"><h3>Comparación de plan</h3></div><div class="panel-body">${intro}${MSG ? `<div class="dc-msg">${esc(MSG)}</div>` : ""}<p class="empty-note">Todavía no hay planes guardados. Desde ahora, cada instructivo que se cargue queda en el historial.</p>${acciones}</div></div>`;
      return conectar(cont);
    }
    if (!SEL.mes || !meses.includes(SEL.mes)) SEL.mes = meses.includes(mesDe(Date.now() - 5 * H)) ? mesDe(Date.now() - 5 * H) : meses[meses.length - 1];
    const delMes = HIST.filter((s) => tocaMes(s, SEL.mes));
    if (!delMes.some((s) => s.id === SEL.base)) SEL.base = delMes[0].id;
    if (!delMes.some((s) => s.id === SEL.comp)) SEL.comp = delMes[delMes.length - 1].id;
    const B = delMes.find((s) => s.id === SEL.base);
    const C = delMes.find((s) => s.id === SEL.comp);
    const [ma, mz] = ventanaMes(SEL.mes);
    const a = Math.max(ma, B.desde, C.desde);
    const z = Math.min(mz, B.hasta, C.hasta);
    const opts = (sel) => delMes.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${etiqueta(s)} (${esc(fd(s.desde))} → ${esc(fd(s.hasta - 1))})</option>`).join("");
    const selectores = `<div class="cp-sel">
        <label>Mes <select class="pc-sel" id="cpMes">${meses.map((m) => `<option value="${m}" ${m === SEL.mes ? "selected" : ""}>${esc(nombreMes(m))}</option>`).join("")}</select></label>
        <label>Plan base <select class="pc-sel" id="cpBase">${opts(SEL.base)}</select></label>
        <label>Comparar con <select class="pc-sel" id="cpComp">${opts(SEL.comp)}</select></label>
      </div>`;
    let cuerpo;
    if (!(z > a)) cuerpo = `<p class="empty-note">Esos dos planes no tienen días en común dentro de ${esc(nombreMes(SEL.mes))}.</p>`;
    else if (B.id === C.id) cuerpo = `<p class="empty-note">Solo hay un plan cargado para ${esc(nombreMes(SEL.mes))} (o eligió el mismo dos veces). Cuando se cargue una actualización, aquí se verá qué cambió.</p>${tablaEvolucion(delMes, B)}${matrizSemanas(delMes)}`;
    else cuerpo = comparar(B, C, a, z) + tablaEntreVersiones(delMes) + tablaEvolucion(delMes, B) + matrizSemanas(delMes);
    cont.innerHTML = `<div class="panel"><div class="panel-head"><h3>Comparación de plan</h3><span class="sub">${HIST.length} plan(es) guardado(s) en este navegador</span></div><div class="panel-body">${intro}${MSG ? `<div class="dc-msg">${esc(MSG)}</div>` : ""}${selectores}${cuerpo}${pliegue("cp-hist", "Planes guardados", tablaHistorial(), `${HIST.length}`)}${acciones}</div></div>`;
    conectar(cont);
  }

  function comparar(B, C, a, z) {
    const rb = resumen(B, a, z);
    const rc = resumen(C, a, z);
    const hParadas = (r) => r.paradas.reduce((x, p) => x + (Math.min(z, p.arranca) - Math.max(a, p.para)), 0) / H;
    const kpi = (tit, vb, vc, dec, u, d) => `<div class="cp-kpi"><div class="cp-kpi-t">${tit}</div><div class="cp-kpi-v">${nf(vb, dec)}${u || ""} <span aria-hidden="true">→</span> <b>${nf(vc, dec)}${u || ""}</b></div><div class="cp-kpi-d">${d}</div></div>`;
    const kpis = `<div class="cp-kpis">
        ${kpi("Volumen a envasar", rb.hl, rc.hl, 0, " hL", delta(rb.hl, rc.hl, 0, " hL"))}
        ${kpi("Horas de producción", rb.prod, rc.prod, 1, " h", delta(rb.prod, rc.prod, 1, " h"))}
        ${kpi("Paradas de línea", rb.paradas.length, rc.paradas.length, 0, "", Math.abs(hParadas(rc) - hParadas(rb)) < 0.05 ? '<span class="cp-igual">mismas horas de parada</span>' : `${delta(hParadas(rb), hParadas(rc), 1, " h")} de parada`)}
        ${kpi("Cambios de formato", rb.cambiosFormato, rc.cambiosFormato, 0, "", delta(rb.cambiosFormato, rc.cambiosFormato, 0))}
        ${kpi("Arranques de línea", rb.arranquesN, rc.arranquesN, 0, "", delta(rb.arranquesN, rc.arranquesN, 0))}
        <div class="cp-kpi"><div class="cp-kpi-t">LEF planta</div><div class="cp-kpi-v">${pct(rb.planta && rb.planta.lef)} <span aria-hidden="true">→</span> <b>${pct(rc.planta && rc.planta.lef)}</b></div><div class="cp-kpi-d">${deltaPp(rb.planta && rb.planta.lef, rc.planta && rc.planta.lef)}</div></div>
      </div>`;
    const filasLinea = TRAINS.map((t) => {
      const b = rb.porLinea[t], c = rc.porLinea[t];
      const pb = rb.paradas.filter((p) => p.tren === t).length, pc = rc.paradas.filter((p) => p.tren === t).length;
      return `<tr><td class="ie-lin">TREN-${t}</td><td class="num">${nf(b.hl)}</td><td class="num">${nf(c.hl)}</td><td>${delta(b.hl, c.hl, 0)}</td><td class="num">${nf(b.prod, 1)} → ${nf(c.prod, 1)}</td><td class="num">${pb} → ${pc}</td><td class="num">${b.cambios} → ${c.cambios}</td><td class="num">${pct(b.lef)} → ${pct(c.lef)}</td></tr>`;
    }).join("");
    const tablaLinea = `<h4 class="acx-sub">Por línea</h4><div class="table-scroll"><table class="acu-tabla cp-tabla"><thead><tr><th>Línea</th><th class="num">hL base</th><th class="num">hL actual</th><th>Diferencia</th><th class="num">Horas producción</th><th class="num">Paradas</th><th class="num">Cambios</th><th class="num">LEF</th></tr></thead><tbody>${filasLinea}</tbody></table></div>`;
    const claves = [...new Set([...Object.keys(rb.porSku), ...Object.keys(rc.porSku)])];
    const skus = claves
      .map((k) => ({ k, s: rb.porSku[k] || rc.porSku[k], b: rb.porSku[k] ? rb.porSku[k].hl : 0, c: rc.porSku[k] ? rc.porSku[k].hl : 0 }))
      .filter((x) => Math.abs(x.c - x.b) >= 1)
      .sort((x, y) => Math.abs(y.c - y.b) - Math.abs(x.c - x.b));
    const tablaSku = `<h4 class="acx-sub">Formatos (SKU) que cambiaron <small>${skus.length} de ${claves.length}</small></h4>${skus.length
      ? `<div class="table-scroll" style="max-height:360px;"><table class="acu-tabla cp-tabla"><thead><tr><th>Línea</th><th>SKU</th><th class="num">hL base</th><th class="num">hL actual</th><th>Diferencia</th></tr></thead><tbody>${skus
          .map((x) => `<tr><td class="ie-lin">L${esc(x.s.tren)}</td><td>${esc(x.s.sku)} ${!x.b ? '<span class="acx-tag acx-nuevo">Entra</span>' : !x.c ? '<span class="acx-tag acx-quita">Sale</span>' : ""}</td><td class="num">${nf(x.b)}</td><td class="num">${nf(x.c)}</td><td>${delta(x.b, x.c, 0)}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="empty-note">Los mismos formatos con los mismos hL.</p>`}`;
    const par = compararParadas(rb.paradas, rc.paradas);
    const cambiaron = par.filter((p) => p.tipo !== "igual");
    const tt = { nueva: ["Nueva", "acx-nuevo"], quitada: ["Se quitó", "acx-quita"], movida: ["Se movió", "acx-cambia"] };
    const tiempo = (p) => `${esc(fdt(p.para))} → ${esc(fdt(p.arranca))} <small>(${esc(modlDur(p.dur))})</small>`;
    const tablaPar = `<h4 class="acx-sub">Paradas y arranques de línea que cambiaron <small>${cambiaron.length} de ${par.length} · paradas de 2 h o más</small></h4>${cambiaron.length
      ? `<div class="table-scroll" style="max-height:360px;"><table class="acu-tabla cp-tabla"><thead><tr><th></th><th>Línea</th><th>Plan base: para → arranca</th><th>Plan actual: para → arranca</th></tr></thead><tbody>${cambiaron
          .map((p) => `<tr><td><span class="acx-tag ${tt[p.tipo][1]}">${tt[p.tipo][0]}</span></td><td class="ie-lin">L${esc((p.b || p.c).tren)}</td><td>${p.b ? tiempo(p.b) : "—"}</td><td>${p.c ? tiempo(p.c) : "—"}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="empty-note">Las paradas y arranques son los mismos (con diferencias menores a 1 h).</p>`}`;
    return `<p class="cp-ventana">Se comparan los días ${esc(fdt(a))} → ${esc(fdt(z))}, que cubren los dos planes.</p>${kpis}${tablaSemanas(B, C)}${tablasSemanaLinea(B, C)}${tablaLinea}${tablaSku}${tablaPar}`;
  }

  // Semana a semana: plan base vs. el plan con que se compara.
  function tablaSemanas(B, C) {
    const filas = semanasDelMes(SEL.mes)
      .map((w) => {
        const a = Math.max(w.a, B.desde, C.desde), z = Math.min(w.z, B.hasta, C.hasta);
        const lbl = `<b>S${w.num}</b> <small>${esc(w.txt)}</small>`;
        if (!(z > a)) return `<tr><td>${lbl}</td><td colspan="7" class="cp-igual">Algún plan no cubre esta semana</td></tr>`;
        const parcial = a > w.a || z < w.z;
        const rb = resumen(B, a, z), rc = resumen(C, a, z);
        return `<tr><td>${lbl}${parcial ? ` <span class="acx-tag acx-cambia" title="Solo se comparan ${esc(fdt(a))} → ${esc(fdt(z))}">parcial</span>` : ""}</td>
          <td class="num">${nf(rb.hlCerveza)} → ${nf(rc.hlCerveza)}<br>${delta(rb.hlCerveza, rc.hlCerveza, 0)}</td>
          <td class="num">${nf(rb.hlPony)} → ${nf(rc.hlPony)}<br>${delta(rb.hlPony, rc.hlPony, 0)}</td>
          <td class="num"><b>${nf(rb.hl)} → ${nf(rc.hl)}</b><br>${delta(rb.hl, rc.hl, 0)}</td>
          <td class="num">${nf(rb.prod, 1)} → ${nf(rc.prod, 1)}</td>
          <td class="num">${rb.paradas.length} → ${rc.paradas.length}</td>
          <td class="num">${rb.cambios} → ${rc.cambios}</td>
          <td class="num">${pct(rb.planta && rb.planta.lef)} → ${pct(rc.planta && rc.planta.lef)}<br>${deltaPp(rb.planta && rb.planta.lef, rc.planta && rc.planta.lef)}</td></tr>`;
      })
      .join("");
    return `<h4 class="acx-sub">Semana a semana <small>plan base → plan comparado</small></h4><div class="table-scroll"><table class="acu-tabla cp-tabla cp-sem"><thead><tr><th>Semana</th><th class="num">Cerveza (hL)</th><th class="num">Pony Malta (hL)</th><th class="num">Total (hL)</th><th class="num">Horas producción</th><th class="num">Paradas</th><th class="num">Cambios</th><th class="num">LEF planta</th></tr></thead><tbody>${filas}</tbody></table></div><p class="acu-nota">La semana va de lunes a domingo, con el día de producción de 22:00 a 22:00. «Parcial»: uno de los planes no cubre la semana completa y solo se comparan los días en común.</p>`;
  }

  // Por semana y por línea: cuánto cambian los hL, los cambios de formato y
  // las paradas y arranques entre el plan base y el comparado.
  function tablasSemanaLinea(B, C) {
    const sem = semanasDelMes(SEL.mes)
      .map((w) => {
        const a = Math.max(w.a, B.desde, C.desde), z = Math.min(w.z, B.hasta, C.hasta);
        return z > a ? { w, parcial: a > w.a || z < w.z, rb: resumen(B, a, z), rc: resumen(C, a, z) } : null;
      })
      .filter(Boolean);
    if (!sem.length) return "";
    const cols = TRAINS.map((t) => `<th class="num">L${t}</th>`).join("") + `<th class="num">Total</th>`;
    const lbl = (x) => `<td><b>S${x.w.num}</b> <small>${esc(x.w.txt)}</small>${x.parcial ? ' <span class="acx-tag acx-cambia">parcial</span>' : ""}</td>`;
    const cuenta = (b, c) => {
      const d = c - b;
      return `${b} → ${c}${d ? ` <span class="${d > 0 ? "cp-menos" : "cp-mas"}">(${d > 0 ? "+" : "−"}${Math.abs(d)})</span>` : ""}`;
    };
    const hlCel = (b, c) => `<td class="num" title="${nf(b)} → ${nf(c)} hL">${delta(b, c, 0)}<br><small class="cp-igual">${nf(b)} → ${nf(c)}</small></td>`;
    const tabla = (tit, nota, celda, total) => `<h4 class="acx-sub">${tit}</h4><div class="table-scroll"><table class="acu-tabla cp-tabla cp-sem"><thead><tr><th>Semana</th>${cols}</tr></thead><tbody>${sem
      .map((x) => `<tr>${lbl(x)}${TRAINS.map((t) => celda(x.rb.porLinea[t], x.rc.porLinea[t])).join("")}${total(x.rb, x.rc)}</tr>`)
      .join("")}</tbody></table></div>${nota ? `<p class="acu-nota">${nota}</p>` : ""}`;
    return (
      tabla("Hectolitros por semana y línea <small>cuánto aumentó o disminuyó</small>", "", (b, c) => hlCel(b.hl, c.hl), (b, c) => hlCel(b.hl, c.hl)) +
      tabla(
        "Cambios de formato por semana y línea <small>plan base → plan comparado</small>",
        "Cambio de formato: dos producciones seguidas de la línea con distinto envase o tamaño (mismo criterio del acuerdo L4 de Logística).",
        (b, c) => `<td class="num">${cuenta(b.cambiosFormato, c.cambiosFormato)}</td>`,
        (b, c) => `<td class="num"><b>${cuenta(b.cambiosFormato, c.cambiosFormato)}</b></td>`,
      ) +
      tabla(
        "Paradas y arranques por semana y línea <small>P = la línea para · A = vuelve a arrancar</small>",
        "Paradas de 2 h o más por mantenimiento programado o sin programación (las de la modulación de equipos). En rojo, las que hay de más en el plan comparado.",
        (b, c) => `<td class="num">P ${cuenta(b.paradasN, c.paradasN)}<br>A ${cuenta(b.arranquesN, c.arranquesN)}</td>`,
        (b, c) => `<td class="num"><b>P ${cuenta(b.paradasN, c.paradasN)}<br>A ${cuenta(b.arranquesN, c.arranquesN)}</b></td>`,
      )
    );
  }

  // Entre cada versión del plan y la siguiente, en los días que cubren las dos.
  function tablaEntreVersiones(delMes) {
    if (delMes.length < 2) return "";
    const [ma, mz] = ventanaMes(SEL.mes);
    const filas = [];
    for (let i = 1; i < delMes.length; i++) {
      const P = delMes[i - 1], N = delMes[i];
      const a = Math.max(ma, P.desde, N.desde), z = Math.min(mz, P.hasta, N.hasta);
      if (!(z > a)) {
        filas.push(`<tr><td><b>V${i} → V${i + 1}</b></td><td colspan="${TRAINS.length + 5}" class="cp-igual">No tienen días en común en el mes</td></tr>`);
        continue;
      }
      const rp = resumen(P, a, z), rn = resumen(N, a, z);
      const dc = (b, c) => {
        const d = c - b;
        return d ? `<span class="${d > 0 ? "cp-menos" : "cp-mas"}">${d > 0 ? "+" : "−"}${Math.abs(d)}</span>` : `<span class="cp-igual">0</span>`;
      };
      filas.push(`<tr><td><b>V${i} → V${i + 1}</b><br><small>${esc(fCarga(N.cargado))}</small></td><td><small>${esc(fd(a))} → ${esc(fd(z - 1))}</small></td>${TRAINS.map(
        (t) => `<td class="num">${delta(rp.porLinea[t].hl, rn.porLinea[t].hl, 0)}</td>`,
      ).join("")}<td class="num"><b>${delta(rp.hl, rn.hl, 0)}</b></td><td class="num">${dc(rp.cambiosFormato, rn.cambiosFormato)}</td><td class="num">${dc(rp.paradasN, rn.paradasN)}</td><td class="num">${dc(rp.arranquesN, rn.arranquesN)}</td></tr>`);
    }
    return `<h4 class="acx-sub">Entre cada versión del plan <small>qué cambió de una actualización a la siguiente</small></h4><div class="table-scroll"><table class="acu-tabla cp-tabla cp-sem"><thead><tr><th>Versiones</th><th>Días comparados</th>${TRAINS.map((t) => `<th class="num">hL L${t}</th>`).join("")}<th class="num">hL total</th><th class="num">Cambios de formato</th><th class="num">Paradas</th><th class="num">Arranques</th></tr></thead><tbody>${filas.join("")}</tbody></table></div><p class="acu-nota">${delMes.map((s, i) => `V${i + 1} = ${esc(s.archivo)} (cargado ${esc(fCarga(s.cargado))})`).join(" · ")}. Cambios, paradas y arranques: cuántos hay de más (+) o de menos (−) en la versión nueva.</p>`;
  }

  // Cada semana del mes en cada versión del plan (hL a envasar).
  function matrizSemanas(delMes) {
    const sem = semanasDelMes(SEL.mes);
    const cab = delMes.map((s, i) => `<th class="num" title="${esc(s.archivo)}">V${i + 1}<br><small>${esc(fCarga(s.cargado))}</small></th>`).join("");
    const filas = sem
      .map((w) => {
        let prev = null;
        const celdas = delMes
          .map((s) => {
            const a = Math.max(w.a, s.desde), z = Math.min(w.z, s.hasta);
            if (!(z > a)) return `<td class="num cp-igual">—</td>`;
            const r = resumen(s, a, z);
            const parcial = a > w.a || z < w.z;
            const d = prev != null && !parcial && !prev.parcial ? `<br>${delta(prev.hl, r.hl, 0)}` : "";
            prev = { hl: r.hl, parcial };
            return `<td class="num">${nf(r.hl)}${parcial ? ' <small class="cp-igual" title="Este plan no cubre la semana completa">(parcial)</small>' : ""}${d}</td>`;
          })
          .join("");
        return `<tr><td><b>S${w.num}</b> <small>${esc(w.txt)}</small></td>${celdas}</tr>`;
      })
      .join("");
    return `<h4 class="acx-sub">Cada semana en cada versión del plan <small>hL a envasar · la diferencia es contra la versión anterior</small></h4><div class="table-scroll"><table class="acu-tabla cp-tabla cp-sem"><thead><tr><th>Semana</th>${cab}</tr></thead><tbody>${filas}</tbody></table></div><p class="acu-nota">${delMes.map((s, i) => `V${i + 1} = ${esc(s.archivo)}`).join(" · ")}</p>`;
  }

  function tablaEvolucion(delMes, B) {
    const [ma, mz] = ventanaMes(SEL.mes);
    const filas = delMes
      .map((s) => {
        const a = Math.max(ma, s.desde, B.desde), z = Math.min(mz, s.hasta, B.hasta);
        const comun = z > a;
        const r = comun ? resumen(s, a, z) : null;
        const rb = comun ? resumen(B, a, z) : null;
        return `<tr class="${s.id === B.id ? "cp-base" : ""}"><td>${esc(s.archivo)}${s.id === B.id ? ' <span class="acx-tag acx-nuevo">Base</span>' : ""}</td><td>${esc(fCarga(s.cargado))}</td><td>${esc(fd(s.desde))} → ${esc(fd(s.hasta - 1))}</td><td class="num">${comun ? nf(r.hl) : "—"}</td><td>${comun && s.id !== B.id ? delta(rb.hl, r.hl, 0, " hL") : "—"}</td><td class="num">${comun ? r.paradas.length : "—"}</td></tr>`;
      })
      .join("");
    return `<h4 class="acx-sub">Cómo fue cambiando el plan del mes</h4><div class="table-scroll"><table class="acu-tabla cp-tabla"><thead><tr><th>Plan</th><th>Cargado</th><th>Cubre</th><th class="num">hL (días en común con la base)</th><th>Vs. base</th><th class="num">Paradas</th></tr></thead><tbody>${filas}</tbody></table></div>`;
  }

  function tablaHistorial() {
    if (!HIST.length) return `<p class="empty-note">Sin planes guardados.</p>`;
    return `<div class="table-scroll"><table class="acu-tabla cp-tabla"><thead><tr><th>Plan</th><th>Cargado</th><th>Cubre</th><th></th></tr></thead><tbody>${HIST.slice()
      .reverse()
      .map((s) => `<tr><td>${esc(s.archivo)}</td><td>${esc(fCarga(s.cargado))}</td><td>${esc(fd(s.desde))} → ${esc(fd(s.hasta - 1))}</td><td><button class="btn small" data-cp-borrar="${esc(s.id)}">Quitar</button></td></tr>`)
      .join("")}</tbody></table></div><p class="acu-nota">Quitar un plan lo saca del historial (comparación y acumulado del mes); no cambia el plan cargado hoy.</p>`;
  }

  function conectar(cont) {
    const $ = (id) => cont.querySelector("#" + id);
    ["cpMes", "cpBase", "cpComp"].forEach((id) => {
      const el = $(id);
      if (el)
        el.onchange = () => {
          if (id === "cpMes") {
            SEL.mes = el.value;
            SEL.base = SEL.comp = null;
          } else SEL[id === "cpBase" ? "base" : "comp"] = el.value;
          MSG = "";
          pintar(cont);
        };
    });
    cont.querySelectorAll("[data-cp-borrar]").forEach((b) => {
      b.onclick = () => {
        const s = HIST.find((x) => x.id === b.dataset.cpBorrar);
        if (!s || !confirm(`¿Quitar del historial «${s.archivo}» (cargado ${fCarga(s.cargado)})?`)) return;
        HIST = HIST.filter((x) => x.id !== s.id);
        cache.delete(s.id);
        guardar()
          .then(() => (MSG = `Se quitó «${s.archivo}» del historial.`))
          .catch((e) => (MSG = "No se pudo guardar: " + e.message))
          .then(() => pintar(cont));
      };
    });
    const ex = $("cpExportar");
    if (ex)
      ex.onclick = () => {
        const blob = new Blob([JSON.stringify({ formato: "tminus-historial-planes/1", planes: HIST })], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const aEl = document.createElement("a");
        aEl.href = url;
        aEl.download = `T-minus_historial_planes_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(aEl);
        aEl.click();
        aEl.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    const im = $("cpImportar");
    if (im)
      im.onchange = (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (!f) return;
        f.text()
          .then((txt) => {
            const j = JSON.parse(txt);
            if (!j || j.formato !== "tminus-historial-planes/1" || !Array.isArray(j.planes)) throw new Error("no es un historial de planes de T-minus");
            return fusionar(j.planes).then((r) => (MSG = `Se importaron ${r.nuevos} plan(es) nuevos (${r.validos - r.nuevos} ya estaban).`));
          })
          .catch((err) => (MSG = "No se pudo importar: " + err.message))
          .then(() => {
            pintar(cont);
            if (typeof window.renderIndicadoresEnvasado === "function") window.renderIndicadoresEnvasado();
          });
      };
  }

  window.HistorialPlanes = { registrar, cargar, fusionar, planCosido, mesesConPlan, nombreMes, merged, lista: () => HIST.slice() };
  window.renderComparacionPlan = renderComparacionPlan;
})();
