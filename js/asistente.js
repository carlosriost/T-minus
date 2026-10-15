/* =========================================================================
   ASISTENTE DE FerIA (chatbot)
   -------------------------------------------------------------------------
   Responde preguntas sobre el plan cargado. Dos modos:
   · Respuestas de FerIA (siempre): se calculan aquí mismo con los datos de
     la app —plan de cocinas, trazabilidad, tanques, setpoints, frío, alertas—,
     así que son exactas y no salen del navegador.
   · Respuestas con IA (opcional): si Utilities lo activa con su propia clave
     de la API de Claude, la pregunta se manda junto con un resumen del plan y
     la respuesta calculada por FerIA, para que la IA redacte o razone sobre
     preguntas más abiertas. Apagado por defecto: activarlo envía datos del plan
     a la API de Anthropic, y así se le dice al usuario.
   ========================================================================= */

const AS_LS_KEY = "planAsistente";
const AS_H = 3600000;
const AS_D = 86400000;
const AS_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const AS_EJEMPLOS = [
  "¿Qué se está cocinando ahora?",
  "Si se cocina el 01/10 a las 4:28, ¿a dónde va?",
  "¿De qué cocimientos sale la línea 5 el 05/10 a las 5 pm?",
  "¿Cuándo se cocina la Pony?",
  "¿Qué cocimientos llegan tarde?",
  "¿Cuándo sube la demanda de frío?",
  "¿Qué setpoint de vapor y aire hay el 07/10 a las 19:00?",
  "¿Cuántos cocimientos y hL hay por mosto?",
  "¿Qué reglas usa el plan de cocinas?",
  "¿Por qué no aparece el plan real de cocinas?",
];
let AS = { abierto: false, msgs: [], cargando: false };

function asConfig() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(AS_LS_KEY) || "null");
  } catch (_) {}
  return { ia: !!(g && g.ia), clave: (g && g.clave) || "", modelo: (g && g.modelo) || "claude-sonnet-5-5" };
}
function asGuardar(c) {
  try {
    localStorage.setItem(AS_LS_KEY, JSON.stringify(c));
  } catch (_) {}
}

/* ------------------------------------------------------- lectura de la pregunta */

function asNorm(t) {
  return typeof normalizeText === "function" ? normalizeText(t) : String(t || "").toLowerCase();
}
function asAhora() {
  return typeof trzAhoraMs === "function" ? trzAhoraMs() : Date.now();
}
// Año de referencia: el del plan cargado (o el actual).
function asAnio() {
  const p = STATE && STATE.parsed;
  const d = p && (p.weekStartDate || (p.weeks && p.weeks[0] && p.weeks[0].start));
  return d ? new Date(d).getUTCFullYear() : new Date().getFullYear();
}
// Fecha y hora mencionadas: {dia (ms a medianoche) | null, min (minutos del día) | null}.
function asFechaHora(q) {
  const n = asNorm(q);
  let dia = null;
  const hoy = asAhora();
  const med = (ms) => Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), new Date(ms).getUTCDate());
  let m = n.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{2,4}))?\b/);
  if (m) {
    let y = m[3] ? Number(m[3]) : asAnio();
    if (y < 100) y += 2000;
    dia = Date.UTC(y, Number(m[2]) - 1, Number(m[1]));
  } else if ((m = n.match(/\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/))) {
    const mes = m[2] === "setiembre" ? 8 : AS_MESES.indexOf(m[2]);
    dia = Date.UTC(asAnio(), mes, Number(m[1]));
  } else if (/\bpasado manana\b/.test(n)) dia = med(hoy) + 2 * AS_D;
  else if (/\bmanana\b/.test(n) && !/\bde la manana\b/.test(n)) dia = med(hoy) + AS_D;
  else if (/\bayer\b/.test(n)) dia = med(hoy) - AS_D;
  else if (/\bhoy\b/.test(n)) dia = med(hoy);
  // Hora: «4:28», «16h30», «a las 5 pm», «5 p.m.», «a las 4 y 28», «a las 5 de la tarde».
  let min = null;
  const ampm = (h, suf) => {
    if (!suf) return h;
    if (/p|tarde|noche/.test(suf) && h < 12) return h + 12;
    if (/a|manana|madrugada/.test(suf) && h === 12) return 0;
    return h;
  };
  const SUF = "(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|am|pm|p\\b|de la tarde|de la noche|de la manana|de la madrugada)?";
  if ((m = n.match(new RegExp(`\\b(\\d{1,2})\\s*[:h]\\s*(\\d{2})\\s*${SUF}`)))) min = ampm(Number(m[1]), m[3]) * 60 + Number(m[2]);
  else if ((m = n.match(new RegExp(`\\ba las?\\s+(\\d{1,2})(?:\\s+y\\s+(\\d{1,2}))?\\s*${SUF}`)))) min = ampm(Number(m[1]), m[3]) * 60 + Number(m[2] || 0);
  else if ((m = n.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)/))) min = ampm(Number(m[1]), m[2]) * 60;
  if (min != null && (min < 0 || min >= 1440)) min = null;
  return { dia, min };
}
function asInstante(q, porDefectoAhora) {
  const { dia, min } = asFechaHora(q);
  const hoy = asAhora();
  const base = dia != null ? dia : Date.UTC(new Date(hoy).getUTCFullYear(), new Date(hoy).getUTCMonth(), new Date(hoy).getUTCDate());
  if (dia == null && min == null) return porDefectoAhora ? { ms: hoy, explicito: false } : null;
  return { ms: base + (min != null ? min * 60000 : 12 * AS_H), explicito: true, sinHora: min == null };
}
function asMosto(q) {
  const n = asNorm(q);
  if (/light/.test(n)) return "light";
  if (/pony|malta/.test(n)) return "pony";
  if (/pilsen/.test(n)) return "pilsen";
  if (/estandar|costenita|aguila|poker/.test(n)) return "estandar";
  return null;
}
function asLinea(q) {
  const m = asNorm(q).match(/\b(?:linea|tren|l)\s*-?\s*(5|7|8|9)\b/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------- respuestas */

const asF = (ms) => (ms == null ? "—" : fmtDateTime(new Date(ms)));
const asNom = (id) => (typeof trzNombreMosto === "function" ? trzNombreMosto(id) : id);
const asHL = (v) => `${MOD_NF(v)} hL`;
const asEsc = (t) => escapeHtml(String(t == null ? "" : t));

function asDatos() {
  if (!(STATE && STATE.seq && (STATE.seq.rows || []).length)) return null;
  return calcularTrazabilidad(trzConfig());
}
function asVer(key, txt) {
  return `<button class="btn small as-ver" data-as-trz="${asEsc(key)}" data-goto="view-trazabilidad">${asEsc(txt || "Ver en «Del cocimiento al envasado»")}</button>`;
}
function asDestinos(c) {
  if (!c.consumo.length) return "<p>No tiene destino calculado.</p>";
  return `<ul>${c.consumo.map((x) => `<li><b>Línea ${asEsc(x.train)}</b> · ${asEsc(x.name)}: del ${asEsc(asF(x.desde))} al ${asEsc(asF(x.hasta))} (${asHL(x.hL)})</li>`).join("")}</ul>`;
}
function asFichaCoc(c, t) {
  const e = trzEstado(c, t != null ? t : asAhora());
  const fv = c.fv && c.fv.length ? c.fv.map((x) => x.tanque).join(", ") : c.mostoId === "pony" ? "— (la Pony no fermenta: va directo a SV Pony)" : "— (sin FV asignado)";
  return `<p><b>${asEsc(asNom(c.mostoId))} · cocimiento n.º ${c.n}</b> — cargue ${asEsc(asF(c.ms))}, fin de cocina ${asEsc(asF(c.fin))}.</p>
    <p>Fermenta en <b>${asEsc(fv)}</b>, se trasiega a maduración el ${asEsc(asF(c.trasiego))}${c.sv && c.sv.length ? ` (${asEsc(c.sv.join(", "))})` : ""} y queda listo el ${asEsc(asF(c.listo))}.${c.tarde || c.tardeTanque ? ' <span class="pvr-no">⚠ Llega tarde a su envasado.</span>' : ""}</p>
    <p>Se envasa en:</p>${asDestinos(c)}<p class="as-sub">Estado a las ${asEsc(asF(t != null ? t : asAhora()))}: ${asEsc(e.txt)}.</p>${asVer(c.key)}`;
}

// Motor local: devuelve {html, texto} con la respuesta calculada.
function asResponderLocal(q) {
  const n = asNorm(q);
  const d = asDatos();
  const sinPlan = '<p>Todavía no hay un plan cargado. Carga el plan de envasado en «Datos de entrada» y revisa el I0: con eso FerIA calcula el plan de cocinas y puedo responder.</p><button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button>';

  if (/^(hola|buenas|buenos dias|buenas tardes)\b/.test(n) && n.length < 25)
    return { html: `<p>¡Hola! Pregúntame por el plan de cocinas: qué se está cocinando, a dónde va cada cocimiento, de dónde sale un envasado, alertas, frío o setpoints.</p>${asHtmlEjemplos()}` };
  if (/ayuda|que puedo preguntar|que puedes|ejemplo/.test(n)) return { html: `<p>Algunas preguntas que puedo responder con el plan cargado:</p>${asHtmlEjemplos()}` };

  // Reglas del modelo (no necesitan plan).
  if (/regla|parametro|como (se )?calcula|criterio|modelo/.test(n)) return { html: asHtmlReglas() };

  if (!d) return { html: sinPlan };
  const t = asInstante(q, true);

  // Cocimiento por número.
  let m = n.match(/cocimiento\s*(?:n\.?\s*o\.?|no\.?|numero|#|n\.?º)?\s*(\d{1,4})\b/);
  if (m) {
    const c = d.cocs.find((x) => x.n === Number(m[1]));
    return { html: c ? asFichaCoc(c, t.ms) : `<p>No encuentro el cocimiento n.º ${asEsc(m[1])} en el plan (hay ${d.cocs.length}).</p>` };
  }

  // ¿De dónde sale un envasado? (línea + momento)
  const linea = asLinea(q);
  if (linea && (/de donde|de que cocimiento|que cocimiento|sale|alimenta|viene/.test(n) || !/cocin/.test(n))) {
    const b = d.envasado.find((x) => String(x.train) === linea && x.ms <= t.ms && t.ms < x.fin);
    if (!b) return { html: `<p>La línea ${asEsc(linea)} no tiene un bloque el ${asEsc(asF(t.ms))} en el plan cargado.</p>` };
    if (b.tipo !== "production") return { html: `<p>El ${asEsc(asF(t.ms))} la línea ${asEsc(linea)} está en <b>${asEsc(b.name)}</b> (${asEsc(asF(b.ms))} → ${asEsc(asF(b.fin))}): no envasa.</p>` };
    const fuentes = d.cocs.filter((c) => c.consumo.some((z) => String(z.train) === linea && z.desde <= t.ms && z.hasta > t.ms));
    const delBloque = d.cocs.filter((c) => c.consumo.some((z) => String(z.train) === linea && z.desde < b.fin && z.hasta > b.ms));
    return {
      html: `<p>El ${asEsc(asF(t.ms))} la <b>línea ${asEsc(linea)}</b> envasa <b>${asEsc(b.name)}</b> (bloque del ${asEsc(asF(b.ms))} al ${asEsc(asF(b.fin))}).</p>
        ${fuentes.length ? `<p>En ese momento sale de: ${fuentes.map((c) => `<b>${asEsc(asNom(c.mostoId))} n.º ${c.n}</b> (cargado el ${asEsc(asF(c.ms))}, ${c.fv ? `fermentó en ${asEsc(c.fv[0].tanque)}` : c.mostoId === "pony" ? "la Pony no fermenta: va directo a SV Pony" : "sin FV asignado"})`).join("; ")}.</p>` : "<p>En ese momento lo cubre el inventario (no hay cocimiento del plan asignado).</p>"}
        <p class="as-sub">Todo el bloque sale de ${delBloque.length} cocimiento(s): ${delBloque.map((c) => `n.º ${c.n}`).join(", ") || "ninguno (inventario)"}.</p>${asVer(`e${linea}|${b.ms}`, "Ver el bloque")}`,
    };
  }

  // ¿A dónde va lo que se cocina en tal momento? / ¿qué se cocina ahora?
  if (/a donde|para donde|donde se envasa|a que linea|destino|se va|va a ir|ahora|en este momento|se esta cocinando|que se cocina|que hay en (la )?cocina/.test(n) || (/cocin/.test(n) && t.explicito && !/cuando/.test(n))) {
    // Con cargues cada ~2:50 y 9 h de cocina, a una hora dada suele haber
    // varios cocimientos en proceso: se toma el de cargue más cercano a la hora
    // preguntada («lo que se cocinó a las 4:28») y se nombran los demás.
    const enProceso = d.cocs.filter((x) => x.ms <= t.ms && t.ms < x.fin);
    const cerca = [...d.cocs].sort((a, b) => Math.abs(a.ms - t.ms) - Math.abs(b.ms - t.ms))[0];
    let c = null;
    let nota = "";
    if (cerca && Math.abs(cerca.ms - t.ms) <= 3 * AS_H) c = cerca;
    else if (enProceso.length) c = enProceso[enProceso.length - 1];
    if (c && Math.abs(c.ms - t.ms) > 5 * 60000)
      nota += `<p class="as-sub">Es el cargue más cercano a esa hora (${asEsc(asF(c.ms))}).</p>`;
    const otros = enProceso.filter((x) => x !== c);
    if (otros.length)
      nota += `<p class="as-sub">También estaban en la cocina: ${otros.map((x) => `${asEsc(asNom(x.mostoId))} n.º ${x.n} (cargue ${asEsc(asF(x.ms))})`).join(", ")}.</p>`;
    if (!c) return { html: `<p>El ${asEsc(asF(t.ms))} no hay ningún cocimiento en la cocina según el plan FerIA${t.ms < d.desde || t.ms > d.hasta ? ` (el plan cargado va del ${asEsc(asF(d.desde))} al ${asEsc(asF(d.hasta))})` : ""}.</p>` };
    return { html: `<p>El ${asEsc(asF(t.ms))} en la cocina está:</p>${nota}${asFichaCoc(c, t.ms)}` };
  }

  // Alertas / tarde.
  if (/tarde|alerta|riesgo|conflicto|atras|problema|rojo/.test(n)) {
    const tarde = d.cocs.filter((c) => c.tarde || c.tardeTanque);
    const warns = (STATE.seq.capacityWarnings || []).slice(0, 8);
    return {
      html: `<p><b>${tarde.length}</b> de ${d.cocs.length} cocimientos llegan tarde a su envasado.</p>${
        tarde.length
          ? `<ul>${tarde.slice(0, 10).map((c) => `<li>${asEsc(asNom(c.mostoId))} n.º ${c.n} · cargue ${asEsc(asF(c.ms))} · se envasa desde ${asEsc(asF(c.consumo[0] ? c.consumo[0].desde : c.necesidad))}${c.tardeTanque ? ` · listo ${MOD_NF(c.atrasoH, 1)} h tarde por el tanque` : ""}</li>`).join("")}${tarde.length > 10 ? `<li>… y ${tarde.length - 10} más</li>` : ""}</ul>`
          : ""
      }${warns.length ? `<p>Avisos del motor:</p><ul>${warns.map((w) => `<li>${asEsc(w.detalle || w.tipo)}</li>`).join("")}</ul>` : ""}<button class="btn small" data-goto="view-conflictos">Ver Conflictos de capacidad →</button>`,
    };
  }

  // Frío.
  if (/frio|compresor|amoniaco|refrigera|enfria/.test(n)) {
    const desde = t.ms;
    const prox = d.subidas.filter((s) => s.t >= desde).slice(0, 8);
    return {
      html: prox.length
        ? `<p>Próximas subidas de la demanda de frío después del ${asEsc(asF(desde))} (índice estimado):</p><ul>${prox.map((s) => `<li><b>${asEsc(asF(s.t))}</b>: ${MOD_NF(s.de, 1)} → ${MOD_NF(s.a, 1)} — ${asEsc(s.motivos.slice(0, 2).join(" · "))}</li>`).join("")}</ul><p class="as-sub">Es una estimación desde el plan de cocinas y los tanques; los pesos se ajustan en «Del cocimiento al envasado».</p><button class="btn small" data-goto="view-trazabilidad">Ver la curva de frío →</button>`
        : `<p>No hay subidas de frío después del ${asEsc(asF(desde))} en el plan cargado.</p>`,
    };
  }

  // Setpoints.
  if (/setpoint|vapor|aire|caldera|psi|presion/.test(n) && typeof calcularSetpoints === "function") {
    const sp = calcularSetpoints(STATE.mergedByTrain);
    const en = (lista) => lista.find((x) => x.start <= t.ms && t.ms < x.end);
    const v = en(sp.vapor);
    const a = en(sp.aire);
    const txt = (x) => (!x ? "fuera del plan" : x.desconocido ? "? (sin plan de cocinas)" : x.psi == null ? "sin requerimiento" : `${x.psi} PSI`);
    const prox = sp.cambios.filter((c) => c.ms > t.ms).slice(0, 4);
    return {
      html: `<p>El ${asEsc(asF(t.ms))}: <b>vapor ${asEsc(txt(v))}</b>${v ? ` (${asEsc(v.motivo)})` : ""} y <b>aire ${asEsc(txt(a))}</b>${a ? ` (${asEsc(a.motivo)})` : ""}.</p>${prox.length ? `<p>Siguientes cambios:</p><ul>${prox.map((c) => `<li>${asEsc(asF(c.ms))} · ${asEsc(c.equipo)}: ${c.deDesconocido ? "?" : c.de ?? "—"} → ${c.aDesconocido ? "?" : c.a ?? "—"} PSI (${asEsc(c.motivo)})</li>`).join("")}</ul>` : ""}<p class="as-sub">Cocinas según: ${asEsc(sp.coc.nombre)}.</p>`,
    };
  }

  // Aseos.
  if (/aseo|cip|lavad/.test(n)) {
    const aseos = (STATE.seq.rows || []).filter((r) => r.tipo === "aseo");
    let prox = aseos.filter((r) => r.end.getTime() >= t.ms).slice(0, 8);
    const todos = !prox.length;
    if (todos) prox = aseos.slice(0, 12);
    return { html: `<p>El plan tiene <b>${aseos.length}</b> aseos de cocina.${prox.length ? (todos ? " Son estos:" : " Los siguientes:") : ""}</p>${prox.length ? `<ul>${prox.map((r) => `<li>${asEsc(asF(r.start.getTime()))} → ${asEsc(asF(r.end.getTime()))}: ${asEsc(r.nombre || "Aseo")}</li>`).join("")}</ul>` : ""}` };
  }

  // Cantidades.
  if (/cuant|total|hectolitro|\bhl\b|volumen/.test(n)) {
    const porM = {};
    d.cocs.forEach((c) => {
      const o = (porM[c.mostoId] = porM[c.mostoId] || { n: 0, hl: 0 });
      o.n++;
      o.hl += c.consumo.reduce((s, x) => s + x.hL, 0);
    });
    const mm = asMosto(q);
    const keys = Object.keys(porM).filter((k) => !mm || k === mm);
    return {
      html: `<p>Plan FerIA: <b>${d.cocs.length}</b> cocimientos.</p><table class="acu-tabla as-tabla"><thead><tr><th>Mosto</th><th class="num">Cocimientos</th><th class="num">hL a envasar que cubren</th></tr></thead><tbody>${keys.map((k) => `<tr><td>${asEsc(asNom(k))}</td><td class="num">${porM[k].n}</td><td class="num">${MOD_NF(porM[k].hl)}</td></tr>`).join("")}</tbody></table><p class="as-sub">Lo que cubre el inventario no genera cocimientos.</p>`,
    };
  }

  // ¿Cuándo se cocina tal mosto?
  const mosto = asMosto(q);
  if (mosto || /cuando|proximo|siguiente/.test(n)) {
    const lista = d.cocs.filter((c) => (!mosto || c.mostoId === mosto) && (t.explicito ? c.ms >= t.ms - 12 * AS_H : true));
    if (!lista.length) return { html: `<p>No hay cocimientos de ${asEsc(mosto ? asNom(mosto) : "ese mosto")} en el plan${t.explicito ? " desde esa fecha" : ""}.</p>` };
    const corridas = [];
    lista.forEach((c) => {
      const u = corridas[corridas.length - 1];
      if (u && u.mostoId === c.mostoId && c.ms - u.ult <= 4 * AS_H) {
        u.cocs.push(c);
        u.ult = c.ms;
      } else corridas.push({ mostoId: c.mostoId, cocs: [c], ult: c.ms });
    });
    const extra =
      mosto === "pony"
        ? `<p class="as-sub">La Pony se cocina por campañas de hasta 5 y como máximo 48 h antes de lo que pide su máximo en BBT: cocina 8:15 + maduración 48 h + hasta 48 h en BBT antes de envasar.</p>`
        : "";
    return {
      html: `<p>${mosto ? `Cocimientos de <b>${asEsc(asNom(mosto))}</b>` : "Próximos cocimientos"}: ${lista.length} en ${corridas.length} corrida(s).</p><ul>${corridas
        .slice(0, 10)
        .map((u) => {
          const dest = [...new Set(u.cocs.flatMap((c) => c.consumo.map((x) => `L${x.train} ${fmtDate(new Date(x.desde))}`)))].slice(0, 4).join(", ");
          return `<li><b>${asEsc(asF(u.cocs[0].ms))}</b>${u.cocs.length > 1 ? ` → ${asEsc(asF(u.cocs[u.cocs.length - 1].ms))}` : ""}: ${u.cocs.length} × ${asEsc(asNom(u.mostoId))} (n.º ${u.cocs.map((c) => c.n).join(", ")}) → ${asEsc(dest || "—")}</li>`;
        })
        .join("")}${corridas.length > 10 ? `<li>… y ${corridas.length - 10} corridas más</li>` : ""}</ul>${extra}`,
    };
  }

  // ¿Por qué no aparece el plan real de cocinas? Diagnóstico con lo cargado.
  if (/(plan real|real de cocina|programa de cocina|excel de cocina|programa_cocinas)/.test(n) || (/real/.test(n) && /(no aparece|no sale|no hay|falta|cargo|cargar|subi|por que)/.test(n))) {
    if (typeof PC !== "undefined" && !PC && typeof pcRecuperar === "function") pcRecuperar();
    const pc = typeof PC !== "undefined" ? PC : null;
    const inv = typeof INVENTORY_BALANCE !== "undefined" && Array.isArray(INVENTORY_BALANCE) && INVENTORY_BALANCE.length;
    const nota = inv
      ? "<p>Ojo: el archivo «PRODUCTO EN PROCESO» es el <b>inventario</b> de FV, SV y BBT (lo que ya está fermentando, madurando o listo). FerIA lo usa para descontar lo que no hay que cocinar, pero no es el plan de cocinas.</p>"
      : "";
    const coc = pc && pc.filas ? pc.filas.filter((x) => x.tipo === "coc" && x.inicio != null) : [];
    if (!coc.length)
      return {
        html: `<p>No aparece porque el <b>plan real de cocinas</b> sale de otro archivo: el Excel «Programa_Cocinas.xlsx» del área de Cocinas, que se carga en el módulo «Programa de cocinas (Excel)». En este navegador todavía no hay ninguno cargado.</p>${nota}<p>Lo que sí está: el plan de cocinas que FerIA calcula desde el instructivo de envasado (${d.cocs.length} cocimientos).</p><button class="btn small" data-goto="view-programa-cocinas">Ir a Programa de cocinas (Excel) →</button>`,
      };
    const ini = Math.min(...coc.map((x) => x.inicio));
    const fin = Math.max(...coc.map((x) => x.inicio));
    const i0d = typeof getI0Date === "function" ? getI0Date() : null;
    const i0 = i0d ? i0d.getTime() : d.desde;
    const ultFeria = Math.max(...d.cocs.map((c) => c.ms));
    const enVentana = coc.filter((x) => x.inicio >= i0 && x.inicio <= ultFeria + 9 * AS_H).length;
    return {
      html: `<p>Sí hay un plan real cargado: <b>${asEsc(pc.archivo || "Programa de cocinas")}</b>, con cargues del ${asEsc(asF(ini))} de ${new Date(ini).getUTCFullYear()} al ${asEsc(asF(fin))}.</p>
        <p>Plan vs. real compara desde el I0 (${asEsc(asF(i0))}) hasta el último cocimiento de FerIA (${asEsc(asF(ultFeria))}). En esa ventana el Excel real tiene <b>${enVentana}</b> cocimiento(s).${
          enVentana
            ? ""
            : fin < i0
              ? " El Excel real termina antes del I0: hay que cargar el Programa de cocinas actualizado (que llegue al menos hasta esas fechas)."
              : " Revisa el I0."
        }</p>${nota}<button class="btn small" data-goto="view-plan-vs-real">Ver Plan vs. real →</button>`,
    };
  }

  // Plan vs. real.
  if (/real|adherencia|compar/.test(n) && typeof PVR_ULTIMO !== "undefined" && PVR_ULTIMO) {
    const r = PVR_ULTIMO;
    return { html: `<p>Plan FerIA vs. real (última comparación abierta): ${r.tot.cocPlan} vs. ${r.tot.cocReal} cocimientos, adherencia ${r.adherencia.pct == null ? "—" : MOD_NF(r.adherencia.pct, 0) + " %"} con ±${MOD_NF(r.tol, 1)} h, desfase promedio ${typeof pvrFmtDesfase === "function" ? pvrFmtDesfase(r.desfase.prom) : "—"}, ${r.cobertura.enRiesgoReal} bloque(s) de envasado en riesgo con el real.</p><button class="btn small" data-goto="view-plan-vs-real">Ver Plan vs. real →</button>` };
  }

  return {
    html: `<p>No entendí bien la pregunta. Puedo responder cosas como:</p>${asHtmlEjemplos()}${asConfig().ia ? "" : '<p class="as-sub">Para preguntas más abiertas puedes activar las respuestas con IA (⚙).</p>'}`,
    sinEntender: true,
  };
}

function asHtmlEjemplos() {
  return `<div class="as-ejemplos">${AS_EJEMPLOS.map((e) => `<button class="as-chip" data-as-preg="${asEsc(e)}">${asEsc(e)}</button>`).join("")}</div>`;
}
function asHtmlReglas() {
  const cat = (MOSTO_CATALOG || [])
    .map((m) => `<li><b>${asEsc(m.nombre)}</b>: factor ${MOD_NF(m.factorDilucion, 2)}, ${MOD_NF(m.volumenPorCocimiento)} hL por cocimiento, cocina ${MOD_NF(m.tiempoCocinaHoras, 2)} h, fermentación ${MOD_NF(m.tiempoFermentacionHoras)} h, maduración ${MOD_NF(m.tiempoMaduracionHoras)} h${m.tiempoMaxBBTHoras ? `, máx. ${MOD_NF(m.tiempoMaxBBTHoras)} h en BBT` : ""}.</li>`)
    .join("");
  return `<p>Cómo arma FerIA el plan de cocinas:</p><ol>
    <li>Toma lo que falta por envasar desde el I0 y le descuenta el inventario.</li>
    <li>Arma la demanda en el tiempo por mosto: el cocimiento n.º k se necesita cuando la demanda acumulada pasa de k rendimientos (factor × hL por cocimiento).</li>
    <li>Cargue a más tardar de cada cocimiento = necesidad − maduración − fermentación − cocina.</li>
    <li>Los junta en campañas: Pony de a 5 y sin pasar 48 h en BBT; Estándar y Pilsen de a 6; Light completa (paga aseo al entrar). Cerveza máximo 2 días adelantada.</li>
    <li>Secuencia en la cocina única (2:50 entre cargues), con aseos de cambio de marca al entrar a Light o Pony (4:40) y aseo periódico cada 16–20 cocimientos; arranque con cerveza después de una parada; ≥ 24 h entre corridas de Pony; Light solo con levadura Light.</li>
    <li>Cuenta con que la cerveza se junta en FV de a 8 cocimientos y el lote fermenta desde su último llenado: el lote completo tiene que quedar listo antes del envasado de su primer cocimiento.</li>
    <li>Asigna FV y SV; un FV no espera abierto más de 24 h ni recibe un cocimiento que atrase a un lote que iba a tiempo.</li></ol>
    <p>Catálogo:</p><ul>${cat}</ul>`;
}

/* ------------------------------------------------------------- modo IA */

function asContextoIA() {
  const d = asDatos();
  const f = (ms) => (ms == null ? null : new Date(ms).toISOString().slice(0, 16).replace("T", " "));
  const ctx = {
    ahora: f(asAhora()),
    i0: (() => {
      const i = typeof getI0Date === "function" ? getI0Date() : null;
      return i ? f(i.getTime()) : null;
    })(),
    catalogo: (MOSTO_CATALOG || []).map((m) => ({ id: m.id, nombre: m.nombre, factor: m.factorDilucion, hlCoc: m.volumenPorCocimiento, cocinaH: m.tiempoCocinaHoras, fermH: m.tiempoFermentacionHoras, madH: m.tiempoMaduracionHoras, maxBBTH: m.tiempoMaxBBTHoras, entreCarguesH: m.tiempoEntreCarguesHoras })),
  };
  if (d) {
    ctx.cocimientos = d.cocs.map((c) => ({ n: c.n, mosto: c.mostoId, cargue: f(c.ms), finCocina: f(c.fin), fv: c.fv ? c.fv.map((x) => x.tanque).join(",") : null, trasiego: f(c.trasiego), listo: f(c.listo), tarde: c.tarde || c.tardeTanque, destinos: c.consumo.map((x) => ({ linea: x.train, sku: x.name, desde: f(x.desde), hasta: f(x.hasta), hL: Math.round(x.hL) })) }));
    ctx.envasado = d.envasado.filter((e) => e.tipo === "production").slice(0, 400).map((e) => ({ linea: e.train, sku: e.name, desde: f(e.ms), hasta: f(e.fin), hL: Math.round(e.hL) }));
    ctx.aseos = (STATE.seq.rows || []).filter((r) => r.tipo === "aseo").map((r) => ({ desde: f(r.start.getTime()), hasta: f(r.end.getTime()), nombre: r.nombre }));
    ctx.alertas = (STATE.seq.capacityWarnings || []).slice(0, 30).map((w) => w.detalle || w.tipo);
    ctx.subidasFrio = d.subidas.slice(0, 60).map((s) => ({ t: f(s.t), de: s.de, a: s.a, motivos: s.motivos.slice(0, 3) }));
  }
  return ctx;
}

async function asResponderIA(pregunta, local) {
  const cfg = asConfig();
  const historia = AS.msgs
    .filter((m) => m.texto)
    .slice(-6)
    .map((m) => ({ role: m.rol === "yo" ? "user" : "assistant", content: m.texto }));
  const sistema = `Eres el asistente de FerIA, la app de planeación de la Cervecería de Itagüí (Bavaria). Respondes en español, claro y breve, a personal de Utilities y Planeación.
Usa SOLO los datos del plan que vienen en el contexto (JSON). Las fechas están en hora local de planta (Bogotá). Si algo no está en los datos, dilo; no inventes.
Si viene una «respuesta calculada por FerIA», es exacta: úsala como base y amplíala si la pregunta lo pide.
CONTEXTO:
${JSON.stringify(asContextoIA())}`;
  const msgs = [...historia, { role: "user", content: `${pregunta}${local && !local.sinEntender ? `\n\n(Respuesta calculada por FerIA: ${asTexto(local.html)})` : ""}` }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.clave,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: cfg.modelo, max_tokens: 1200, system: sistema, messages: msgs }),
  });
  if (!r.ok) throw new Error(`La API respondió ${r.status}`);
  const j = await r.json();
  return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
function asTexto(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("button").forEach((b) => b.remove());
  return div.innerText.replace(/\n{2,}/g, "\n").trim();
}
// Texto de la IA → HTML seguro (párrafos, listas, negritas).
function asMarkdown(t) {
  const lineas = escapeHtml(t).split("\n");
  let html = "";
  let enLista = false;
  lineas.forEach((l) => {
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    const fmt = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    if (li) {
      if (!enLista) (html += "<ul>"), (enLista = true);
      html += `<li>${fmt(li[1])}</li>`;
    } else {
      if (enLista) (html += "</ul>"), (enLista = false);
      if (l.trim()) html += `<p>${fmt(l)}</p>`;
    }
  });
  if (enLista) html += "</ul>";
  return html;
}

/* ------------------------------------------------------------- interfaz */

function asMontar() {
  if (document.getElementById("asFab")) return;
  const fab = document.createElement("button");
  fab.id = "asFab";
  fab.className = "as-fab";
  fab.type = "button";
  fab.title = "Preguntarle a FerIA";
  fab.innerHTML = '<span aria-hidden="true">💬</span><span class="as-fab-t">Pregúntale a FerIA</span>';
  document.body.appendChild(fab);
  const panel = document.createElement("div");
  panel.id = "asPanel";
  panel.className = "as-panel";
  panel.hidden = true;
  document.body.appendChild(panel);
  fab.addEventListener("click", () => {
    AS.abierto = !AS.abierto;
    panel.hidden = !AS.abierto;
    if (AS.abierto) asPintar();
  });
  panel.addEventListener("click", asClicPanel);
}

function asPintar() {
  const panel = document.getElementById("asPanel");
  if (!panel) return;
  const cfg = asConfig();
  const msgs = AS.msgs.length
    ? AS.msgs.map((m) => `<div class="as-msg as-${m.rol}">${m.rol === "yo" ? `<p>${asEsc(m.texto)}</p>` : m.html}${m.fuente ? `<div class="as-fuente">${asEsc(m.fuente)}</div>` : ""}</div>`).join("")
    : `<div class="as-msg as-bot"><p>Hola, soy el asistente de FerIA. Respondo con el plan cargado: cocimientos, a dónde va cada uno, de dónde sale cada envasado, tanques, alertas, frío y setpoints.</p>${asHtmlEjemplos()}</div>`;
  panel.innerHTML = `
    <div class="as-head"><b>Asistente FerIA</b><span class="as-modo">${cfg.ia && cfg.clave ? "IA activada" : "Respuestas de FerIA"}</span>
      <button class="as-icon" data-as-conf title="Configuración">⚙</button><button class="as-icon" data-as-limpiar title="Borrar conversación">⟲</button><button class="as-icon" data-as-cerrar title="Cerrar">✕</button></div>
    <div class="as-conf" id="asConf" hidden>
      <label class="as-check"><input type="checkbox" id="asIa" ${cfg.ia ? "checked" : ""}> Respuestas con IA (Claude)</label>
      <p class="as-sub">Al activarlo, cada pregunta envía un resumen del plan cargado a la API de Anthropic con tu clave. La clave queda guardada solo en este navegador: no la uses en un equipo compartido. Sin IA, todo se calcula aquí y nada sale del navegador.</p>
      <input type="password" id="asClave" class="pc-buscar" placeholder="Clave de la API de Claude (sk-ant-…)" value="${asEsc(cfg.clave)}" autocomplete="off">
      <select id="asModelo" class="pc-sel">${[["claude-sonnet-5-5", "Claude Sonnet 5.5"], ["claude-haiku-5-5", "Claude Haiku 5.5 (más rápido)"], ["claude-opus-5-5", "Claude Opus 5.5 (más capaz)"]].map(([v, l]) => `<option value="${v}" ${cfg.modelo === v ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn small" data-as-guardar>Guardar</button>
    </div>
    <div class="as-msgs" id="asMsgs">${msgs}${AS.cargando ? '<div class="as-msg as-bot as-pensando"><p>Pensando…</p></div>' : ""}</div>
    <form class="as-form" id="asForm"><input id="asIn" autocomplete="off" placeholder="Escribe tu pregunta…" ${AS.cargando ? "disabled" : ""}><button class="btn primary small" ${AS.cargando ? "disabled" : ""}>Enviar</button></form>`;
  const box = document.getElementById("asMsgs");
  if (box) box.scrollTop = box.scrollHeight;
  const form = document.getElementById("asForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = document.getElementById("asIn").value.trim();
    if (v) asPreguntar(v);
  });
  const inp = document.getElementById("asIn");
  if (inp && !AS.cargando) inp.focus();
}

async function asPreguntar(texto) {
  AS.msgs.push({ rol: "yo", texto });
  let local;
  try {
    local = asResponderLocal(texto);
  } catch (e) {
    console.error(e);
    local = { html: "<p>No pude calcular la respuesta con el plan cargado.</p>", sinEntender: true };
  }
  const cfg = asConfig();
  if (cfg.ia && cfg.clave) {
    AS.cargando = true;
    asPintar();
    try {
      const r = await asResponderIA(texto, local);
      AS.msgs.push({ rol: "bot", html: asMarkdown(r) + (local && !local.sinEntender ? `<details class="as-det"><summary>Datos calculados por FerIA</summary>${local.html}</details>` : ""), texto: r, fuente: `IA · ${cfg.modelo}` });
    } catch (e) {
      AS.msgs.push({ rol: "bot", html: local.html, texto: asTexto(local.html), fuente: `Respuesta de FerIA (no se pudo usar la IA: ${e.message})` });
    }
    AS.cargando = false;
  } else AS.msgs.push({ rol: "bot", html: local.html, texto: asTexto(local.html), fuente: "Calculado con el plan cargado" });
  asPintar();
}

function asClicPanel(e) {
  const t = e.target;
  if (t.closest("[data-as-cerrar]")) {
    AS.abierto = false;
    document.getElementById("asPanel").hidden = true;
    return;
  }
  if (t.closest("[data-as-limpiar]")) {
    AS.msgs = [];
    asPintar();
    return;
  }
  if (t.closest("[data-as-conf]")) {
    const c = document.getElementById("asConf");
    if (c) c.hidden = !c.hidden;
    return;
  }
  if (t.closest("[data-as-guardar]")) {
    asGuardar({ ia: document.getElementById("asIa").checked, clave: document.getElementById("asClave").value.trim(), modelo: document.getElementById("asModelo").value });
    asPintar();
    return;
  }
  const p = t.closest("[data-as-preg]");
  if (p) {
    asPreguntar(p.dataset.asPreg);
    return;
  }
  const v = t.closest("[data-as-trz]");
  if (v && typeof TRZ !== "undefined") {
    // Deja elegido el cocimiento o bloque en la vista de trazabilidad; el
    // clic sigue al menú (data-goto) y abre la vista.
    TRZ.sel = v.dataset.asTrz;
    const k = TRZ.sel;
    const d = asDatos();
    TRZ.irA = k.startsWith("c") ? ((d && d.cocs.find((c) => c.key === k)) || {}).ms : Number(k.split("|")[1]);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", asMontar);
else asMontar();
