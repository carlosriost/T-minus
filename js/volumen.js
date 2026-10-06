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

// Resumen del plan cargado: hL por SKU y semana, por familia y por formato.
function resumenVolumen() {
  const semanas = semanasDelPlan();
  const prod = bloquesProduccion();
  const porSku = {};
  prod.forEach((b) => {
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
  return {
    semanas,
    skus,
    prod,
    porFamilia: sumar("familia"),
    porFormato: sumar("formato"),
    totalSemana,
    total: skus.reduce((a, s) => a + s.total, 0),
  };
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
  const pie = `<tr class="vol-total"><td colspan="5"><b>Total</b></td>${r.totalSemana
    .map((v) => `<td class="num"><b>${MOD_NF(v)}</b></td>`)
    .join("")}<td class="num"><b>${MOD_NF(r.total)}</b></td></tr>`;

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
      <div class="panel-head"><h3>Plan de volumen cargado</h3><span class="sub">Lo que FerIA leyó del instructivo, antes de programar</span></div>
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
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Historial de cargas <small style="color:var(--muted);font-weight:400;">(últimas 10, guardadas solo en este navegador)</small></div>
          <div class="table-scroll"><table><thead><tr><th>#</th><th>Archivo</th><th>Cargado</th><th>Semanas</th><th class="num">SKU</th><th class="num">hL</th></tr></thead><tbody>${histHtml}</tbody></table></div>
        </div>
      </div>
    </div>`;
}
