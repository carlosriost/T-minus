/* =========================================================================
   MÓDULOS DE SEGUIMIENTO — utilidades compartidas
   -------------------------------------------------------------------------
   Lo que usan los módulos nuevos (Volumen, T-Minus, Acuerdos de logística,
   CIP A/B/C, Recomendaciones): leer los bloques de producción del plan de
   envasado ya cargado (STATE.mergedByTrain), deducir el formato de un SKU,
   ubicar un instante en su semana y pintar tarjetas, barras y anillos con el
   mismo estilo del tablero de acuerdos existente.
   Todo sale de los archivos que ya carga FerIA: no hay datos nuevos.
   ========================================================================= */

const MOD_NF = (x, d) =>
  Number(x || 0).toLocaleString("es-CO", {
    minimumFractionDigits: d || 0,
    maximumFractionDigits: d || 0,
  });

// Formato (presentación) de un SKU a partir de su texto del instructivo:
// envase (PET / Lata / Vidrio) + tamaño ("330 cc", "1,5 L"). Se usa para
// contar cambios de formato y para la distribución por formato.
function formatoDeSKU(texto) {
  const t = String(texto || "");
  const n = normalizeText(t);
  let envase = /\bpet\b/.test(n) ? "PET" : /\blata\b|\bcan\b/.test(n) ? "Lata" : "Vidrio";
  let tam = "";
  const cc = n.match(/(\d+(?:[.,]\d+)?)\s*(cc|ml)\b/);
  if (cc) tam = `${cc[1].replace(".", ",")} cc`;
  else {
    const l = n.match(/(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litro|litros)\b/);
    if (l) tam = `${l[1].replace(".", ",")} L`;
    else {
      // "1 0L" (así viene a veces 1,0 L en el instructivo)
      const l2 = n.match(/\b(\d)\s+(\d)l\b/);
      if (l2) tam = `${l2[1]},${l2[2]} L`;
    }
  }
  return tam ? `${envase} ${tam}` : envase;
}

// Nombre del mosto (familia) de una marca, o null si no está homologada.
function familiaDeMarca(nombre) {
  if (typeof matchMosto !== "function") return null;
  const id = matchMosto(nombre || "", MOSTO_CATALOG);
  const m = id && MOSTO_CATALOG.find((x) => x.id === id);
  return m ? { id: m.id, nombre: m.nombre } : null;
}

// Semanas del plan cargado: [{label, start(ms), end(ms)}]. Si el Excel no las
// trae, se arma una sola semana desde el primer día.
function semanasDelPlan() {
  const p = STATE && STATE.parsed;
  if (!p) return [];
  const ws = (p.weeks && p.weeks.length ? p.weeks : [{ label: p.weekLabel, start: p.weekStartDate }])
    .filter((w) => w && w.start)
    .map((w) => ({ label: w.label || "Semana", start: medianocheMs(w.start) }));
  ws.sort((a, b) => a.start - b.start);
  ws.forEach((w, i) => {
    w.end = ws[i + 1] ? ws[i + 1].start : w.start + 7 * 86400000;
  });
  return ws;
}
function medianocheMs(d) {
  const x = d instanceof Date ? d : new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}
// Índice de la semana a la que pertenece un instante (ms). El día de
// planeación arranca a las 22:00 del día anterior, así que un bloque que
// empieza el domingo a las 22:00 ya es de la semana siguiente.
function semanaIdxDe(ms, semanas) {
  const ajustado = ms + 2 * 3600000;
  for (let i = 0; i < semanas.length; i++)
    if (ajustado >= semanas[i].start && ajustado < semanas[i].end) return i;
  if (semanas.length && ajustado < semanas[0].start) return 0;
  return semanas.length - 1;
}

// Todos los bloques del Gantt de envasado, por tren, ordenados.
function bloquesPorTren() {
  const out = {};
  TRAINS.forEach((t) => {
    out[t] = ((STATE && STATE.mergedByTrain && STATE.mergedByTrain[t]) || [])
      .filter((b) => b && b.start && b.end)
      .slice()
      .sort((a, b) => a.start - b.start);
  });
  return out;
}

// Bloques de producción enriquecidos (familia, formato, semana, hL).
function bloquesProduccion() {
  const semanas = semanasDelPlan();
  const porTren = bloquesPorTren();
  const out = [];
  TRAINS.forEach((t) =>
    porTren[t].forEach((b) => {
      if (b.type !== "production") return;
      const fam = familiaDeMarca(b.name || b.codigo);
      out.push({
        tren: t,
        start: b.start,
        end: b.end,
        codigo: b.codigo || "",
        nombre: b.name || b.codigo || "",
        hl: Number(b.hectolitros) || 0,
        familiaId: fam ? fam.id : null,
        familia: fam ? fam.nombre : "Sin homologar",
        formato: formatoDeSKU(b.name),
        semana: semanaIdxDe(b.start.getTime(), semanas),
        bloque: b,
      });
    }),
  );
  return out.sort((a, b) => a.start - b.start);
}

function esFamiliaLight(id) {
  return id === "light";
}
function esFamiliaPony(id) {
  return typeof esMostoPony === "function" ? esMostoPony(id) : /pony/.test(String(id || ""));
}

/* ---- Piezas de interfaz reutilizables (mismas clases del tablero de acuerdos) ---- */
function modKpi(icono, titulo, valor, pie, color) {
  return `<div class="acu-kpi"><div class="acu-kpi-ico" style="color:${color || "var(--accent)"};">${icono}</div><div><div class="acu-kpi-tit">${titulo}</div><div class="acu-kpi-val" style="color:${color || "var(--text)"};">${valor}</div><div class="acu-kpi-pie">${pie || ""}</div></div></div>`;
}

// Barras horizontales: [{label, valor, color, sub}]
function modBarras(items, unidad) {
  const max = Math.max(1, ...items.map((i) => i.valor));
  return `<div class="mod-barras">${items
    .map(
      (i) => `<div class="mod-barra"><div class="mod-barra-l" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</div><div class="mod-barra-t"><span style="width:${(i.valor / max) * 100}%; background:${i.color};"></span></div><div class="mod-barra-v">${MOD_NF(i.valor)}${unidad ? " " + unidad : ""}${i.sub ? `<small>${i.sub}</small>` : ""}</div></div>`,
    )
    .join("")}</div>`;
}

// Anillo por partes: [{label, valor, color}] con total al centro.
function modAnillo(partes, centro, sub) {
  const total = partes.reduce((a, p) => a + p.valor, 0) || 1;
  const R = 52;
  const C = 2 * Math.PI * R;
  let off = 0;
  const arcos = partes
    .map((p) => {
      const l = (p.valor / total) * C;
      const s = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${escapeHtml(p.label)}: ${MOD_NF(p.valor)}</title></circle>`;
      off += l;
      return s;
    })
    .join("");
  const legs = partes
    .map(
      (p) =>
        `<div class="acu-leg"><span class="dot" style="background:${p.color};"></span><span class="l">${escapeHtml(p.label)}</span><span class="p">${Math.round((p.valor / total) * 100)}%</span></div>`,
    )
    .join("");
  return `<div class="acu-donut-wrap"><svg viewBox="0 0 140 140" class="acu-donut"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="16"/>${arcos}<text x="70" y="68" text-anchor="middle" class="acu-donut-n mod-donut-n" fill="var(--text)">${centro}</text><text x="70" y="86" text-anchor="middle" class="acu-donut-s">${sub || ""}</text></svg><div class="acu-legs">${legs}</div></div>`;
}

const MOD_PALETA = ["#74a7ff", "#4caf82", "#f8c84c", "#e2a1b8", "#a68be0", "#6cc5b0", "#f2a65a", "#9fb4c7"];

// Aviso cuando todavía no se ha cargado el plan de envasado.
function modSinDatos(cont, que) {
  cont.innerHTML = `<div class="empty-state"><div class="empty-state-ico">📥</div><h3>Aún no hay datos para ${escapeHtml(que)}</h3><p>Carga el Excel del plan de envasado para empezar.</p><button class="btn primary" data-goto="view-datos">Ir a «Datos de entrada»</button></div>`;
}

// Duración en formato T-HH:MM (horas pueden pasar de 24).
function modTMinus(ms) {
  if (ms == null || !isFinite(ms)) return "—";
  const neg = ms < 0;
  const m = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${neg ? "T+" : "T-"}${String(h).padStart(2, "0")}:${mm}`;
}
