/* =========================================================================
   VOLUMEN — vista previa, validación e historial del plan de envasado
   -------------------------------------------------------------------------
   Se muestra en «Datos de entrada» después de cargar el Excel: confirma qué
   se leyó (SKU, semanas, hL), revisa que el plan esté completo antes de usar
   la programación y guarda un historial de las cargas en este navegador.
   ========================================================================= */

const VOL_HIST_KEY = "planVolumenHistorial";
let VOL_ARCHIVO_ACTUAL = "";
let VOL_ULTIMO_PARSED = null;

// Nombre del archivo que se está cargando (lo necesita el historial). Se toma
// del input y del arrastre antes de que termine la lectura.
(function () {
  const inp = document.getElementById("fileInput");
  if (inp)
    inp.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) VOL_ARCHIVO_ACTUAL = f.name;
    });
  const dz = document.getElementById("dropZone");
  if (dz)
    dz.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) VOL_ARCHIVO_ACTUAL = f.name;
    });
})();

function volLeerHistorial() {
  try {
    const h = JSON.parse(localStorage.getItem(VOL_HIST_KEY) || "[]");
    return Array.isArray(h) ? h : [];
  } catch (_) {
    return [];
  }
}
function volGuardarHistorial(h) {
  try {
    localStorage.setItem(VOL_HIST_KEY, JSON.stringify(h.slice(0, 10)));
  } catch (_) {}
}

// Filas de producción tal como vienen en el instructivo, con la hoja (semana)
// de la que salió cada una. Es la fuente del volumen por semana: así cada
// semana suma exactamente lo de su hoja, aunque un bloque cruce de domingo a
// lunes o el rótulo de la hoja no coincida con su primer día.
function volFilasProduccion() {
  const p = STATE && STATE.parsed;
  if (!p || !p.rawEvents) return null;
  const filas = [];
  let sinHoja = false;
  TRAINS.forEach((t) =>
    ((p.rawEvents || {})[t] || []).forEach((ev) => {
      if (classify(ev) !== "production") return;
      if (!Number.isInteger(ev.semanaIdx)) sinHoja = true;
      filas.push({ ...ev, tren: t });
    }),
  );
  return sinHoja ? null : filas;
}

// Resumen del plan cargado: hL por SKU y semana, por familia y por formato,
// y el reparto MALTA (Pony) / CERVEZA de cada semana.
function resumenVolumen() {
  const semanas = semanasDelPlan();
  const prod = bloquesProduccion();
  const porSku = {};
  const crudas = volFilasProduccion();
  // Con filas por hoja (instructivo de varias hojas) se cuenta por hoja; si
  // no, como antes: por la fecha de inicio de cada bloque.
  const fuente = crudas
    ? crudas.map((ev) => {
        const fam = familiaDeMarca(ev.name || ev.codigo);
        return {
          codigo: ev.codigo || "",
          nombre: ev.name || ev.codigo || "",
          familiaId: fam ? fam.id : null,
          familia: fam ? fam.nombre : "Sin homologar",
          formato: formatoDeSKU(ev.name),
          tren: ev.tren,
          semana: ev.semanaIdx,
          hl: Number(ev.hectolitros) || 0,
        };
      })
    : prod;
  fuente.forEach((b) => {
    const k = b.codigo || b.nombre;
    const s = (porSku[k] = porSku[k] || {
      codigo: b.codigo,
      nombre: b.nombre,
      familia: b.familia,
      familiaId: b.familiaId,
      formato: b.formato,
      trenes: new Set(),
      porSemana: semanas.map(() => 0),
      total: 0,
    });
    s.trenes.add(b.tren);
    s.porSemana[b.semana] = (s.porSemana[b.semana] || 0) + b.hl;
    s.total += b.hl;
  });
  const skus = Object.values(porSku).sort((a, b) => b.total - a.total);
  const sumar = (campo) => {
    const o = {};
    skus.forEach((s) => (o[s[campo]] = (o[s[campo]] || 0) + s.total));
    return o;
  };
  const totalSemana = semanas.map((_, i) => skus.reduce((a, s) => a + (s.porSemana[i] || 0), 0));
  // Malta (Pony) vs. cerveza (Estándar, Pilsen, Light…) por semana. Lo que
  // no homologa a ningún mosto se muestra aparte: no es ni lo uno ni lo otro.
  const esMalta = (s) => s.familiaId && esFamiliaPony(s.familiaId);
  const reparto = semanas.map((_, i) => {
    const o = { malta: 0, cerveza: 0, sinMosto: 0, porMosto: {} };
    skus.forEach((s) => {
      const v = s.porSemana[i] || 0;
      if (!v) return;
      if (!s.familiaId) o.sinMosto += v;
      else if (esMalta(s)) o.malta += v;
      else o.cerveza += v;
      if (s.familiaId) o.porMosto[s.familiaId] = (o.porMosto[s.familiaId] || 0) + v;
    });
    o.total = o.malta + o.cerveza + o.sinMosto;
    return o;
  });
  const repartoTotal = reparto.reduce(
    (a, o) => ({ malta: a.malta + o.malta, cerveza: a.cerveza + o.cerveza, sinMosto: a.sinMosto + o.sinMosto, total: a.total + o.total }),
    { malta: 0, cerveza: 0, sinMosto: 0, total: 0 },
  );
  return {
    semanas,
    skus,
    prod,
    porHoja: !!crudas,
    reparto,
    repartoTotal,
    porFamilia: sumar("familia"),
    porFormato: sumar("formato"),
    totalSemana,
    total: skus.reduce((a, s) => a + s.total, 0),
  };
}

// Cuadre de cada hoja contra SU PROPIA tabla resumen («Hl, Depósito» por
// SKU): lo que piden y lo que quedó programado en las filas por día. Si no
// cuadra, la programación diaria no cubre (o pasa) lo que la semana pide.
function cuadreTablaResumen(r) {
  const p = (STATE && STATE.parsed) || {};
  const resumen = (p.summary || []).filter((x) => Number.isInteger(x.semanaIdx));
  if (!resumen.length || !r.porHoja) return null;
  const difs = [];
  let revisados = 0;
  resumen.forEach((x) => {
    const pedido = TRAINS.reduce((a, t) => a + ((x.perTrain && x.perTrain[t] && Number(x.perTrain[t].hlDeposito)) || 0), 0);
    if (!(pedido > 0)) return; // reempaque u otros sin hL de línea
    revisados++;
    const sku = r.skus.find((s) => String(s.codigo) === String(x.codigo));
    const programado = sku ? sku.porSemana[x.semanaIdx] || 0 : 0;
    if (Math.abs(programado - pedido) >= 1)
      difs.push({ semana: (r.semanas[x.semanaIdx] || {}).label || "Semana", codigo: x.codigo, marca: x.marca, pedido, programado, dif: programado - pedido });
  });
  return { revisados, difs };
}

// Revisión del plan: lo que conviene confirmar antes de usar la programación.
function validarPlanVolumen(r) {
  const p = STATE.parsed || {};
  const checks = [];
  const fuera = p.sheetsSinReconocer || [];
  checks.push({
    ok: r.semanas.length > 0 && r.prod.length > 0,
    tit: "Formato del archivo",
    det: r.prod.length
      ? `Plan de envasado reconocido: ${r.semanas.length} semana(s), ${r.prod.length} bloques de producción.`
      : "No se encontraron bloques de producción en el archivo.",
  });
  checks.push({
    ok: !fuera.length,
    warn: true,
    tit: "Hojas leídas",
    det: fuera.length
      ? `${fuera.length} hoja(s) quedaron fuera: ${fuera.join(", ")}.`
      : "Todas las hojas con plan se leyeron y se unieron.",
  });
  const sinHom = (STATE.plan && STATE.plan.sinHomologar) || [];
  const skusSinFam = r.skus.filter((s) => !s.familiaId);
  checks.push({
    ok: !skusSinFam.length,
    tit: "SKU homologados",
    det: skusSinFam.length
      ? `${skusSinFam.length} SKU no coinciden con ningún mosto del catálogo (${skusSinFam
          .slice(0, 3)
          .map((s) => s.nombre)
          .join(", ")}${skusSinFam.length > 3 ? "…" : ""}). Revisa «Sin homologar».`
      : `Los ${r.skus.length} SKU tienen mosto en el catálogo${sinHom.length ? "" : ""}.`,
  });
  const sinHl = r.prod.filter((b) => !(b.hl > 0));
  checks.push({
    ok: !sinHl.length,
    tit: "Volúmenes completos",
    det: sinHl.length
      ? `${sinHl.length} bloque(s) de producción sin hL: no suman a la programación de cocinas.`
      : "Todos los bloques de producción traen sus hL.",
  });
  // Solapes en un mismo tren (dos productos a la vez en la misma línea).
  let solapes = 0;
  TRAINS.forEach((t) => {
    const bs = r.prod.filter((b) => b.tren === t);
    for (let i = 1; i < bs.length; i++) if (bs[i].start < bs[i - 1].end - 60000) solapes++;
  });
  checks.push({
    ok: !solapes,
    tit: "Sin solapes por línea",
    det: solapes
      ? `${solapes} cruce(s): una línea tiene dos productos al mismo tiempo.`
      : "Ninguna línea tiene dos productos a la vez.",
  });
  const cuadre = cuadreTablaResumen(r);
  if (cuadre)
    checks.push({
      ok: !cuadre.difs.length,
      warn: true,
      tit: "Cuadre con la tabla resumen del instructivo",
      det: cuadre.difs.length
        ? `${cuadre.difs.length} de ${cuadre.revisados} SKU-semana no cuadran: las filas por día programan ${MOD_NF(Math.abs(cuadre.difs.reduce((a, d) => a + d.dif, 0)))} hL ${cuadre.difs.reduce((a, d) => a + d.dif, 0) < 0 ? "menos" : "más"} de lo que pide la tabla resumen de cada hoja. Detalle abajo.`
        : `Los ${cuadre.revisados} SKU-semana programados por día suman lo mismo que la tabla resumen de cada hoja.`,
    });
  const desde = r.semanas[0] ? new Date(r.semanas[0].start) : null;
  const hasta = r.semanas.length ? new Date(r.semanas[r.semanas.length - 1].end - 86400000) : null;
  checks.push({
    ok: r.semanas.length >= 1,
    tit: "Horizonte de planeación",
    det: desde ? `${r.semanas.length} semana(s): ${fmtDate(desde)} a ${fmtDate(hasta)}.` : "Sin fechas.",
  });
  return checks;
}

function renderVolumen() {
  const cont = document.getElementById("volumenPanel");
  if (!cont) return;
  if (!STATE || !STATE.parsed) {
    cont.innerHTML = "";
    return;
  }
  const r = resumenVolumen();

  // Historial: se agrega una entrada por cada archivo nuevo procesado.
  let hist = volLeerHistorial();
  if (STATE.parsed !== VOL_ULTIMO_PARSED) {
    VOL_ULTIMO_PARSED = STATE.parsed;
    hist.unshift({
      archivo: VOL_ARCHIVO_ACTUAL || "Plan de envasado",
      cargado: new Date().toISOString(),
      semanas: r.semanas.map((s) => s.label).join(" → "),
      skus: r.skus.length,
      totalHL: Math.round(r.total),
    });
    volGuardarHistorial(hist);
    hist = volLeerHistorial();
  }
  const previa = hist[1];
  const delta = previa && previa.totalHL > 0 ? ((r.total - previa.totalHL) / previa.totalHL) * 100 : null;
  const deltaTxt =
    delta == null
      ? "Primera carga registrada"
      : `${delta >= 0 ? "▲" : "▼"} ${MOD_NF(Math.abs(delta), 1)}% vs. carga anterior`;

  const checks = validarPlanVolumen(r);
  const errores = checks.filter((c) => !c.ok).length;

  const kpis =
    modKpi("▣", "SKU cargados", String(r.skus.length), `${r.prod.length} bloques de producción`) +
    modKpi("◍", "Volumen total a envasar", `${MOD_NF(r.total)} <small>hL</small>`, deltaTxt) +
    modKpi("▤", "Cargas registradas", String(hist.length), "Historial en este navegador") +
    modKpi(
      "▦",
      "Inicio del plan",
      r.semanas[0] ? fmtDate(new Date(r.semanas[0].start)) : "—",
      `${r.semanas.length} semana(s) en el archivo`,
    );

  const checksHtml = checks
    .map(
      (c) =>
        `<div class="vol-check"><span class="vol-check-ico ${c.ok ? "ok" : "bad"}">${c.ok ? "✓" : "!"}</span><div><b>${escapeHtml(c.tit)}</b><div>${escapeHtml(c.det)}</div></div></div>`,
    )
    .join("");

  const thSem = r.semanas.map((s) => `<th class="num">${escapeHtml(s.label)} (hL)</th>`).join("");
  const filas = r.skus
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.codigo || "—")}</td><td style="font-family:var(--sans);color:var(--text);">${escapeHtml(s.nombre)}</td><td>${s.familiaId ? `<span class="vol-dot" style="background:${colorForMosto(s.familiaId)}"></span>` : ""}${escapeHtml(s.familia)}</td><td>${escapeHtml(s.formato)}</td><td>${[...s.trenes].sort().map((t) => "T" + t).join(", ")}</td>${s.porSemana
          .map((v) => `<td class="num">${v ? MOD_NF(v) : "—"}</td>`)
          .join("")}<td class="num"><b>${MOD_NF(s.total)}</b></td></tr>`,
    )
    .join("");
  const pct = (v, t) => (t > 0 ? MOD_NF((v / t) * 100, 1) + " %" : "—");
  const filaReparto = (tit, campo, color) =>
    `<tr class="vol-reparto"><td colspan="5"><span class="vol-dot" style="background:${color}"></span>${tit}</td>${r.reparto
      .map((o) => `<td class="num"><b>${pct(o[campo], o.total)}</b><small>${MOD_NF(o[campo])} hL</small></td>`)
      .join("")}<td class="num"><b>${pct(r.repartoTotal[campo], r.repartoTotal.total)}</b><small>${MOD_NF(r.repartoTotal[campo])} hL</small></td></tr>`;
  const pie =
    `<tr class="vol-total"><td colspan="5"><b>Total</b></td>${r.totalSemana
      .map((v) => `<td class="num"><b>${MOD_NF(v)}</b></td>`)
      .join("")}<td class="num"><b>${MOD_NF(r.total)}</b></td></tr>` +
    filaReparto("Malta (Pony)", "malta", colorForMosto("pony")) +
    filaReparto("Cerveza (Estándar, Pilsen, Light)", "cerveza", "var(--accent)") +
    (r.repartoTotal.sinMosto > 0 ? filaReparto("Sin homologar", "sinMosto", "#c9c9c9") : "");

  // Tarjeta malta vs. cerveza: una barra apilada por semana.
  const nomMosto = (id) => (MOSTO_CATALOG.find((m) => m.id === id) || {}).nombre || id;
  const maltaHtml = `<div class="vol-mc">${r.reparto
    .map((o, i) => {
      const t = o.total || 1;
      const cervezas = Object.entries(o.porMosto)
        .filter(([id]) => !esFamiliaPony(id))
        .sort((a, b) => b[1] - a[1])
        .map(([id, v]) => `${nomMosto(id)} ${MOD_NF((v / t) * 100, 1)} %`)
        .join(" · ");
      const detalle = cervezas ? `Cerveza, como % del total de la semana: ${cervezas}` : "";
      return `<div class="vol-mc-fila"><div class="vol-mc-sem">${escapeHtml(r.semanas[i].label)}<small>${MOD_NF(o.total)} hL</small></div><div class="vol-mc-barra" title="${escapeHtml(`${r.semanas[i].label}: malta ${pct(o.malta, o.total)} (${MOD_NF(o.malta)} hL) · cerveza ${pct(o.cerveza, o.total)} (${MOD_NF(o.cerveza)} hL)`)}"><span class="vol-mc-m" style="width:${(o.malta / t) * 100}%;background:${colorForMosto("pony")};">${o.malta / t >= 0.12 ? pct(o.malta, o.total) : ""}</span><span class="vol-mc-c" style="width:${(o.cerveza / t) * 100}%;">${o.cerveza / t >= 0.12 ? pct(o.cerveza, o.total) : ""}</span>${o.sinMosto ? `<span style="width:${(o.sinMosto / t) * 100}%;background:#c9c9c9;"></span>` : ""}</div><div class="vol-mc-det">${escapeHtml(detalle)}</div></div>`;
    })
    .join("")}<div class="vol-mc-fila vol-mc-tot"><div class="vol-mc-sem">Todo el plan<small>${MOD_NF(r.repartoTotal.total)} hL</small></div><div class="vol-mc-barra"><span class="vol-mc-m" style="width:${(r.repartoTotal.malta / (r.repartoTotal.total || 1)) * 100}%;background:${colorForMosto("pony")};">${pct(r.repartoTotal.malta, r.repartoTotal.total)}</span><span class="vol-mc-c" style="width:${(r.repartoTotal.cerveza / (r.repartoTotal.total || 1)) * 100}%;">${pct(r.repartoTotal.cerveza, r.repartoTotal.total)}</span></div><div class="vol-mc-det">${r.porHoja ? "Cada semana suma las filas de su hoja del instructivo." : "Semanas por fecha de inicio de cada bloque."}</div></div></div>`;

  // Detalle del cuadre contra la tabla resumen de cada hoja.
  const cuadre = cuadreTablaResumen(r);
  const cuadreHtml =
    cuadre && cuadre.difs.length
      ? `<div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Lo que pide la tabla resumen vs. lo programado por día <small style="color:var(--muted);font-weight:400;">(misma hoja del instructivo)</small></div><div class="table-scroll"><table><thead><tr><th>Semana</th><th>Código</th><th>SKU</th><th class="num">Tabla resumen (hL)</th><th class="num">Filas por día (hL)</th><th class="num">Diferencia</th></tr></thead><tbody>${cuadre.difs
          .map(
            (d) =>
              `<tr><td>${escapeHtml(d.semana)}</td><td>${escapeHtml(d.codigo)}</td><td style="font-family:var(--sans);color:var(--text);">${escapeHtml(d.marca)}</td><td class="num">${MOD_NF(d.pedido)}</td><td class="num">${MOD_NF(d.programado)}</td><td class="num" style="color:${d.dif < 0 ? "var(--danger)" : "var(--warn)"};"><b>${d.dif > 0 ? "+" : "−"}${MOD_NF(Math.abs(d.dif))}</b></td></tr>`,
          )
          .join("")}</tbody></table></div><p class="acu-nota">T-minus programa las cocinas con las filas por día (lo que de verdad se va a envasar y cuándo). Si la tabla resumen es la que vale, hay que corregir las filas del instructivo.</p></div>`
      : "";

  const famItems = Object.entries(r.porFamilia)
    .sort((a, b) => b[1] - a[1])
    .map(([f, v]) => {
      const m = MOSTO_CATALOG.find((x) => x.nombre === f);
      return { label: f, valor: v, color: m ? colorForMosto(m.id) : "#c9c9c9" };
    });
  const fmtPartes = Object.entries(r.porFormato)
    .sort((a, b) => b[1] - a[1])
    .map(([f, v], i) => ({ label: f, valor: v, color: MOD_PALETA[i % MOD_PALETA.length] }));

  const histHtml = hist
    .map(
      (h, i) =>
        `<tr><td>${i === 0 ? '<span class="tag ok">Actual</span>' : i + 1}</td><td style="font-family:var(--sans);color:var(--text);">${escapeHtml(h.archivo)}</td><td>${escapeHtml(new Date(h.cargado).toLocaleString("es-CO"))}</td><td>${escapeHtml(h.semanas || "")}</td><td class="num">${h.skus}</td><td class="num">${MOD_NF(h.totalHL)}</td></tr>`,
    )
    .join("");

  cont.innerHTML = `
    <div class="panel" style="margin-top:18px;">
      <div class="panel-head"><h3>Plan de volumen cargado</h3><span class="sub">Lo que T-minus leyó del instructivo, antes de programar</span></div>
      <div class="panel-body">
        <div class="acu-kpis">${kpis}</div>
        <div class="acu-card">
          <div class="acu-card-tit">Vista previa por SKU</div>
          <div class="table-scroll" style="max-height:420px;"><table class="vol-tabla"><thead><tr><th>Código</th><th>SKU</th><th>Mosto</th><th>Formato</th><th>Líneas</th>${thSem}<th class="num">Total (hL)</th></tr></thead><tbody>${filas}${pie}</tbody></table></div>
        </div>
        <div class="vol-grid3">
          <div class="acu-card"><div class="acu-card-tit">Estado de validación ${errores ? `<span class="acu-tag" style="color:var(--warn);border-color:var(--warn);margin-left:6px;">${errores} por revisar</span>` : `<span class="acu-tag" style="color:var(--ok);border-color:var(--ok);margin-left:6px;">✓ Validado</span>`}</div>${checksHtml}</div>
          <div class="acu-card"><div class="acu-card-tit">Volumen por mosto (familia)</div>${modBarras(famItems, "hL")}</div>
          <div class="acu-card"><div class="acu-card-tit">Distribución por formato</div>${modAnillo(fmtPartes, MOD_NF(r.total / 1000, 1) + "k", "hL total")}</div>
        </div>
        <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Malta vs. cerveza a envasar por semana</div>${maltaHtml}</div>
        ${cuadreHtml}
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Historial de cargas <small style="color:var(--muted);font-weight:400;">(últimas 10, guardadas solo en este navegador)</small></div>
          <div class="table-scroll"><table><thead><tr><th>#</th><th>Archivo</th><th>Cargado</th><th>Semanas</th><th class="num">SKU</th><th class="num">hL</th></tr></thead><tbody>${histHtml}</tbody></table></div>
        </div>
      </div>
    </div>`;
}
