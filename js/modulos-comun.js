/* =========================================================================
   MÓDULOS DE SEGUIMIENTO — utilidades compartidas
   -------------------------------------------------------------------------
   Lo que usan los módulos nuevos (Volumen, T-Minus, Acuerdos de logística,
   CIP A/B/C, Recomendaciones): leer los bloques de producción del plan de
   envasado ya cargado (STATE.mergedByTrain), deducir el formato de un SKU,
   ubicar un instante en su semana y pintar tarjetas, barras y anillos con el
   mismo estilo del tablero de acuerdos existente.
   Todo sale de los archivos que ya carga T-minus: no hay datos nuevos.
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
  // «200ccX30» viene sin espacio antes de la X: la x también cierra el tamaño.
  const cc = n.match(/(\d+(?:[.,]\d+)?)\s*(cc|ml)(?=\b|x\s*\d)/);
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

/* ---- Pliegues: secciones de consulta cerradas por defecto ----
   Una tabla larga o una configuración va en <details data-pliegue="id">; si el
   usuario la abre, sigue abierta cuando la pantalla se vuelve a pintar. */
window.TM_ABIERTOS = window.TM_ABIERTOS || {};
document.addEventListener(
  "toggle",
  (e) => {
    const d = e.target;
    if (d && d.dataset && d.dataset.pliegue) TM_ABIERTOS[d.dataset.pliegue] = d.open;
  },
  true,
);
// Detalles largos en tablas: se ven en dos líneas y se abren con un clic.
document.addEventListener("click", (e) => {
  const d = e.target.closest && e.target.closest(".acu-tabla td div.acu-det");
  if (d) d.classList.toggle("acu-det-abierto");
});
function pliegue(id, titulo, cuerpo, extra) {
  return `<details class="tm-pliegue" data-pliegue="${id}"${TM_ABIERTOS[id] ? " open" : ""}><summary>${titulo}${extra ? ` <small>${extra}</small>` : ""}</summary><div class="tm-pliegue-cuerpo">${cuerpo}</div></details>`;
}

/* ---- Semanas de los acuerdos de servicio ----
   Los acuerdos se califican por semana, como en el registro OK/NOK del SLA
   Planta: lunes a domingo, con el día de planeación que arranca a las 22:00
   (un evento del domingo a las 22:00 ya cuenta en la semana siguiente). Las
   semanas cubren lo programado en envasado y en cocinas, aunque los
   cocimientos empiecen o terminen en otra semana que el plan de envasado. */
const SEM_MS = 7 * 86400000;
function lunesDe(ms) {
  const d = new Date(ms + 2 * 3600000);
  const dia = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia);
}
function numSemanaIso(lunesMs) {
  const jueves = new Date(lunesMs + 3 * 86400000);
  const ene1 = Date.UTC(jueves.getUTCFullYear(), 0, 1);
  return 1 + Math.floor((jueves.getTime() - ene1) / SEM_MS);
}
function enSemana(fecha, w) {
  if (!w) return true;
  if (!fecha) return false;
  const ms = (fecha instanceof Date ? fecha.getTime() : Number(fecha)) + 2 * 3600000;
  return ms >= w.start && ms < w.end;
}
function semanasAcuerdos() {
  const t = [];
  const add = (d) => {
    const ms = d instanceof Date ? d.getTime() : Number(d);
    if (isFinite(ms)) t.push(ms);
  };
  if (STATE && STATE.mergedByTrain) bloquesProduccion().forEach((b) => add(b.start));
  const seq = STATE && STATE.seq;
  ((seq && seq.rows) || []).forEach((r) => r.tipo === "cocimiento" && add(r.start));
  if (!t.length) return [];
  const lunes = [...new Set(t.map(lunesDe))].sort((a, b) => a - b);
  const dd = (ms) => {
    const d = new Date(ms);
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const out = [];
  for (let s = lunes[0]; s <= lunes[lunes.length - 1] && out.length < 26; s += SEM_MS) {
    const n = numSemanaIso(s);
    out.push({ start: s, end: s + SEM_MS, num: n, corto: `S${n}`, label: `Semana ${n} · ${dd(s)} al ${dd(s + 6 * 86400000)}` });
  }
  return out;
}

// Junta la calificación de cada semana en una fila por acuerdo: el
// cumplimiento del periodo es el promedio de las semanas en que se pudo medir,
// y la fila guarda sus semanas para la tabla semana a semana.
// Acuerdos de servicio cargados desde Excel (js/acuerdos-excel.js): permiten
// cambiar el texto, quitar (Activo = No o fila borrada) y agregar acuerdos.
// Cada motor de acuerdos recorre listaAcuerdos(...) en vez de su lista fija.
// Un acuerdo nuevo queda en la lista sin calificar (no hay regla para medirlo).
const ACU_EXCEL_KEY = "planAcuerdosExcel";
function acuerdosExcelGuardados() {
  try {
    const g = JSON.parse(localStorage.getItem(ACU_EXCEL_KEY) || "null");
    return g && Array.isArray(g.filas) ? g : null;
  } catch (_) {
    return null;
  }
}
function listaAcuerdos(area, base, idKey) {
  const g = acuerdosExcelGuardados();
  const filas = g ? g.filas.filter((f) => f.area === area) : [];
  if (!filas.length) return base;
  const porId = new Map(filas.map((f) => [String(f.id), f]));
  const out = [];
  base.forEach((a) => {
    const f = porId.get(String(a[idKey]));
    if (!f || f.activo === false) return;
    out.push(f.texto ? { ...a, texto: f.texto } : a);
  });
  const numerico = base.length && typeof base[0][idKey] === "number";
  filas.forEach((f) => {
    if (f.activo === false || base.some((a) => String(a[idKey]) === String(f.id))) return;
    const id = numerico && isFinite(Number(f.id)) ? Number(f.id) : String(f.id);
    out.push({ [idKey]: id, texto: f.texto || `Acuerdo ${f.id}`, nuevo: true, historico: "", impacto: "" });
  });
  return out;
}
const DETALLE_ACUERDO_NUEVO = "Acuerdo nuevo cargado desde Excel: T-minus todavía no tiene la regla para medirlo, así que queda en la lista sin calificar.";

// Acuerdos de servicio: cada acuerdo se cumple o no se cumple. Vale 100 % si
// se cumple del todo y 0 % si no; la «medida» y el detalle dicen por cuánto.
function cumplimientoBinario(c) {
  return c == null ? null : c >= 100 ? 100 : 0;
}
function estadoBinario(c) {
  return c == null ? "sin-datos" : c >= 100 ? "cumple" : "critico";
}

function resumirFilaSemanal(id, porSemana, detalleVacio) {
  const semanas = porSemana.map(({ semana, ev }) => {
    const f = ev.filas.find((x) => x.id === id) || {};
    return { semana, medible: !!f.medible, cumplimiento: f.medible ? f.cumplimiento : null, estado: f.estado || "sin-datos", medida: f.medida || "—", detalle: f.detalle || "" };
  });
  const med = semanas.filter((s) => s.medible);
  if (!med.length) return { medible: false, cumplimiento: null, estado: "sin-datos", medida: "—", detalle: detalleVacio, semanas };
  // Todas las semanas: el acuerdo se cumple solo si se cumple en cada semana
  // medida (100 % o 0 %, igual que cada semana).
  const ok = med.filter((s) => s.cumplimiento >= 100);
  const cumplimiento = ok.length === med.length ? 100 : 0;
  const peor = med.reduce((m, s) => (s.cumplimiento < m.cumplimiento ? s : m), med[0]);
  return {
    medible: true,
    cumplimiento,
    estado: estadoBinario(cumplimiento),
    medida: `${ok.length} de ${med.length} semana${med.length === 1 ? "" : "s"} cumple${ok.length === 1 ? "" : "n"}`,
    detalle:
      ok.length === med.length
        ? `Cumple en todas las semanas medidas (${med.map((s) => s.semana.corto).join(", ")}).`
        : `No cumple en ${med.filter((s) => s.cumplimiento < 100).map((s) => s.semana.corto).join(", ")}. ${peor.semana.corto}: ${peor.medida}. ${peor.detalle}`,
    semanas,
  };
}
// Score del periodo = promedio de los scores semanales.
function scorePromedioSemanas(porSemana) {
  const s = porSemana.map((p) => p.ev.score).filter((x) => x != null);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

// Semana elegida en el módulo de acuerdos ("todas" o el inicio de la semana).
let ACUERDOS_SEMANA = (() => {
  try {
    return localStorage.getItem("planAcuerdosSemana") || "todas";
  } catch (_) {
    return "todas";
  }
})();
function semanaAcuerdosElegida(porSemana) {
  if (!porSemana || !porSemana.length) return null;
  return porSemana.find((p) => String(p.semana.start) === ACUERDOS_SEMANA) || null;
}
function selectorSemanasAcuerdos(porSemana) {
  if (!porSemana || !porSemana.length) return "";
  const sel = semanaAcuerdosElegida(porSemana);
  const b = (v, txt, on, title) => `<button data-acu-sem="${v}" class="${on ? "active" : ""}" aria-pressed="${on ? "true" : "false"}"${title ? ` title="${escapeHtml(title)}"` : ""}>${txt}</button>`;
  return `<div class="acu-semanas"><span>Periodo</span><div class="filtro-equipos" style="margin:0;">${b("todas", `Todas (${porSemana.length} semanas)`, !sel)}${porSemana
    .map((p) => b(p.semana.start, p.semana.corto, sel === p, p.semana.label))
    .join("")}</div><span class="acu-sem-lbl">${sel ? escapeHtml(sel.semana.label) : `Promedio de ${escapeHtml(porSemana[0].semana.corto)} a ${escapeHtml(porSemana[porSemana.length - 1].semana.corto)}`}</span></div>`;
}
function conectarSelectorSemanas(cont, rerender) {
  cont.querySelectorAll("[data-acu-sem]").forEach((el) =>
    el.addEventListener("click", () => {
      ACUERDOS_SEMANA = el.dataset.acuSem;
      try {
        localStorage.setItem("planAcuerdosSemana", ACUERDOS_SEMANA);
      } catch (_) {}
      rerender();
    }),
  );
}
// Tabla acuerdo × semana. filas: [{id, rotulo, corto, texto}] en el orden a mostrar.
function matrizSemanalAcuerdos(filas, porSemana) {
  if (!porSemana || !porSemana.length) return "";
  const sel = semanaAcuerdosElegida(porSemana);
  const EST = typeof ACUERDOS_ESTADO !== "undefined" ? ACUERDOS_ESTADO : {};
  const on = (p) => (sel === p ? " acu-sem-on" : "");
  const cab = porSemana
    .map((p) => `<th class="acu-c${on(p)}"><button class="acu-sem-th" data-acu-sem="${p.semana.start}" title="${escapeHtml(p.semana.label)}">${p.semana.corto}</button></th>`)
    .join("");
  // Los acuerdos que no se pueden medir en ninguna semana no ocupan filas.
  const todas = filas.length;
  filas = filas.filter((f) => porSemana.some((p) => (p.ev.filas.find((y) => y.id === f.id) || {}).medible));
  const ocultos = todas - filas.length;
  const cuerpo = filas
    .map((f) => {
      const celdas = porSemana
        .map((p) => {
          const x = p.ev.filas.find((y) => y.id === f.id) || {};
          if (!x.medible) return `<td class="acu-c${on(p)}"><span class="acu-sem sin" title="${escapeHtml(`${p.semana.corto}: ${x.detalle || "sin datos"}`)}">—</span></td>`;
          const e = EST[x.estado] || {};
          return `<td class="acu-c${on(p)}"><span class="acu-sem ${x.estado}" title="${escapeHtml(`${p.semana.corto} · ${e.txt || ""} · ${x.medida}. ${x.detalle}`)}">${MOD_NF(x.cumplimiento)}</span></td>`;
        })
        .join("");
      return `<tr><td class="acu-nom" title="${escapeHtml(f.texto)}"><b>${escapeHtml(String(f.rotulo))}.</b> ${escapeHtml(f.corto)}</td>${celdas}</tr>`;
    })
    .join("");
  const pie = porSemana
    .map((p) => {
      const s = p.ev.score == null ? null : Math.round(p.ev.score);
      return `<td class="acu-c${on(p)}"><b style="color:${colorScore(s)};">${s == null ? "—" : s}</b></td>`;
    })
    .join("");
  return `<div class="acu-card"><div class="acu-card-tit">Semana a semana <small style="color:var(--muted);font-weight:400;">· 100 = el acuerdo se cumple esa semana, 0 = no se cumple; pase el mouse por una celda para ver el detalle o haga clic en una semana para abrirla</small></div>
    <div class="table-scroll mod-noclip"><table class="acu-tabla acu-matriz"><thead><tr><th>Acuerdo</th>${cab}</tr></thead><tbody>${cuerpo}</tbody>
    <tfoot><tr><td><b>Score de la semana</b></td>${pie}</tr></tfoot></table></div>
    <div class="acu-nota">Semanas de lunes a domingo; el día arranca a las 22:00, como en el instructivo. Cada cocimiento, corrida, parada, maduración o ciclo de filtración cuenta entero en la semana en que empieza. «—»: ese acuerdo no tiene qué medir esa semana y no pesa en su score.${ocultos ? ` ${ocultos} acuerdo(s) sin datos para medir en ninguna semana no se muestran aquí; están en el detalle.` : ""}</div></div>`;
}
// Tramos del Gantt de filtración (filtrado, cambios de ciclo y CIP) de todos
// los filtros, en orden de tiempo. Vacío si no se llenó el Gantt.
function tramosFiltracion() {
  if (typeof buildFiltracionPlanes !== "function") return [];
  let planes = null;
  try {
    planes = buildFiltracionPlanes();
  } catch (_) {
    return [];
  }
  if (!planes || !planes.porFiltro) return [];
  const out = [];
  Object.keys(planes.porFiltro).forEach((f) => {
    const p = planes.porFiltro[f];
    if (p && p.ok) (p.segments || []).forEach((s) => s.start && out.push({ ...s, filtro: f }));
  });
  return out.filter((s) => s.tipo === "fil").sort((a, b) => a.start - b.start);
}

// Primera frase de un texto, para nombrar el acuerdo en una tabla angosta.
function textoCortoAcuerdo(t) {
  const s = String(t || "").split(/(?<=\.)\s|\s\(/)[0].replace(/\.$/, "");
  return s.length > 90 ? s.slice(0, 88).replace(/\s+\S*$/, "") + "…" : s;
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

/* ------------------------------------------------ archivos de la misma semana
   Cada archivo se carga por separado y queda guardado en el navegador, así
   que es fácil cargar el plan de envasado nuevo y quedarse con el producto en
   proceso (y su I0) o el Programa de cocinas de semanas pasadas. Los cálculos
   no fallan, pero salen vacíos o raros. Esto solo compara fechas y avisa; no
   cambia ningún dato. */
const DIA_MS_FECHAS = 86400000;
function avisosFechasDatos() {
  const out = [];
  if (typeof STATE === "undefined" || !STATE || !STATE.parsed) return out;
  const f = (ms) => fmtDateTime(new Date(ms));
  const dias = (ms) => Math.round(ms / DIA_MS_FECHAS);
  let envIni = Infinity;
  try {
    bloquesProduccion().forEach((b) => {
      if (b.hl > 0 && b.start) envIni = Math.min(envIni, b.start.getTime());
    });
  } catch (e) {
    console.error(e);
  }
  const i0d = typeof getI0Date === "function" ? getI0Date() : null;
  const i0 = i0d && !isNaN(i0d) ? i0d.getTime() : null;
  if (i0 != null && isFinite(envIni)) {
    if (envIni - i0 > 7 * DIA_MS_FECHAS)
      out.push({
        t: `El I0 (${f(i0)}) es ${dias(envIni - i0)} días anterior al plan de envasado, que empieza el ${f(envIni)}.`,
        d: "El I0 sale de la foto del producto en proceso: parece que ese archivo es de otra semana. Cargue el producto en proceso de esta semana.",
      });
    else if (i0 - envIni > 10 * DIA_MS_FECHAS)
      out.push({
        t: `El plan de envasado empieza el ${f(envIni)}, ${dias(i0 - envIni)} días antes del I0 (${f(i0)}).`,
        d: "Puede ser el instructivo de semanas pasadas. Cargue el de esta semana.",
      });
  }
  const pc = typeof PC !== "undefined" && PC && Array.isArray(PC.filas) ? PC.filas : null;
  if (pc) {
    const ult = pc.reduce((m, x) => (x.tipo === "coc" && x.inicio != null && x.inicio > m ? x.inicio : m), -Infinity);
    const coc = ((STATE.seq && STATE.seq.rows) || []).filter((r) => r.tipo === "cocimiento" && r.start);
    const primero = coc.length ? Math.min(...coc.map((r) => r.start.getTime())) : null;
    if (isFinite(ult) && primero != null && ult < primero)
      out.push({
        t: `El Programa de cocinas real llega hasta el ${f(ult)} y el plan T-minus empieza a cocinar el ${f(primero)}.`,
        d: "No se cruzan, así que «Plan vs. real» no tiene nada que comparar. Cargue el Programa de cocinas de esta semana.",
      });
  }
  return out;
}

function htmlAvisosFechas(boton) {
  const av = avisosFechasDatos();
  if (!av.length) return "";
  const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<div class="tm-aviso-fechas" role="status"><b>Los archivos cargados no son de la misma semana</b><ul>${av
    .map((a) => `<li>${e(a.t)} <small>${e(a.d)}</small></li>`)
    .join("")}</ul>${boton ? `<button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button>` : ""}</div>`;
}
