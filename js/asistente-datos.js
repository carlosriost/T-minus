/* =========================================================================
   ASISTENTE — preguntas sobre los DATOS cargados (volumen, inventario,
   faltantes, utilidades, levadura, resumen, fuentes) y tolerancia a errores
   de tecleo. Todo se calcula con lo que está cargado en este navegador; cada
   respuesta dice de dónde sale el número. No inventa: si un dato no está
   cargado, lo dice.
   Se carga ANTES de js/asistente.js, que llama a asResponderDatos().
   ========================================================================= */

/* ------------------------------------------------------- errores de tecleo */

// Palabras del dominio. Una palabra de 5+ letras que no esté aquí y se
// parezca mucho a una de ellas (1 letra de diferencia, 2 si es larga) se
// corrige: «cosinando» → «cocinando», «pilssen» → «pilsen».
const AS_VOCAB = [
  "cocina", "cocinando", "cocinar", "cocino", "cocimiento", "cocimientos", "envasa", "envasado", "envasar",
  "envasan", "linea", "lineas", "malta", "cerveza", "cervezas", "porcentaje", "semana", "semanas",
  "inventario", "tanque", "tanques", "fermentador", "fermentadores", "madurador", "maduradores",
  "costenita", "aguila", "poker", "pilsen", "light", "setpoint", "setpoints", "vapor", "caldera",
  "calderas", "compresor", "compresores", "levadura", "aseos", "alerta", "alertas", "tarde", "resumen",
  "faltante", "faltantes", "alcanza", "alcanzable", "cuando", "cuanto", "cuantos", "cuanta", "cuantas",
  "donde", "destino", "proximo", "proxima", "siguiente", "hectolitros", "volumen", "programa", "integridad",
  "datos", "fuente", "fuentes", "trazabilidad", "maduracion", "fermentacion", "elliot", "sierra", "centac",
  "revisar", "problemas", "libres", "vacios", "ocupados", "proceso", "listo", "listos", "cuadra", "cuadre",
  "lavadora", "paster", "llenadora", "modulacion", "calentamiento", "arranca", "arranque", "parada",
];
const AS_VOCAB_SET = new Set(AS_VOCAB);
function asLev(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function asCorregir(n) {
  return String(n || "")
    .split(/(\s+)/)
    .map((w) => {
      const lim = w.replace(/[¿?¡!.,;:]/g, "");
      if (lim.length < 5 || /\d/.test(lim) || AS_VOCAB_SET.has(lim)) return w;
      let mejor = null;
      let dist = 9;
      for (const v of AS_VOCAB) {
        if (Math.abs(v.length - lim.length) > 2) continue;
        const d = asLev(lim, v);
        if (d < dist) {
          dist = d;
          mejor = v;
        }
      }
      return mejor && dist <= (lim.length >= 8 ? 2 : 1) ? w.replace(lim, mejor) : w;
    })
    .join("")
    .replace(/\bponi\b/g, "pony")
    .replace(/\bcoste[nñ]ita\b/g, "costenita");
}

/* ------------------------------------------------------------ utilidades */

const asFuente = (txt) => `<p class="as-fuente">Fuente: ${txt}</p>`;
const asPct = (v, t) => (t > 0 ? `${MOD_NF((v / t) * 100, 1)} %` : "—");

// Semana mencionada: «semana 44», «esta semana», «la próxima semana». Índice
// dentro de semanasDelPlan(), o null.
function asSemanaIdx(n, semanas) {
  if (!semanas.length) return null;
  let m = n.match(/\bsemana\s*(?:n\.?\s*o\.?\s*)?(\d{1,2})\b/);
  if (m) {
    const num = Number(m[1]);
    const i = semanas.findIndex((s) => new RegExp(`\\b${num}\\b`).test(s.label));
    return i >= 0 ? i : -1;
  }
  const ahora = asAhora();
  const actual = semanas.findIndex((s) => ahora >= s.start && ahora < s.end);
  if (/\besta semana\b/.test(n)) return actual;
  if (/\b(proxima|siguiente) semana\b|\bsemana (que viene|entrante|proxima|siguiente)\b/.test(n)) return actual >= 0 && actual + 1 < semanas.length ? actual + 1 : -1;
  if (/\bsemana pasada\b/.test(n)) return actual > 0 ? actual - 1 : -1;
  if (/\bprimera semana\b/.test(n)) return 0;
  if (/\bultima semana\b/.test(n)) return semanas.length - 1;
  return null;
}

// Marca / SKU mencionado (por palabras de los SKU cargados).
function asSkusMencionados(n, skus) {
  const marcas = [
    ["costenita", (s) => /coste/.test(asNorm(s.nombre))],
    ["poker", (s) => /poker/.test(asNorm(s.nombre))],
    ["aguila light", (s) => /aguila\s*(light|lig)/.test(asNorm(s.nombre))],
    ["aguila", (s) => /aguila/.test(asNorm(s.nombre)) && !/aguila\s*(light|lig)/.test(asNorm(s.nombre))],
    ["light", (s) => /light|\blig\b/.test(asNorm(s.nombre))],
    ["pilsen", (s) => /pilsen/.test(asNorm(s.nombre))],
    ["pony", (s) => /pony/.test(asNorm(s.nombre))],
  ];
  for (const [clave, f] of marcas) {
    const re = clave === "aguila light" ? /aguila\s+light/ : new RegExp(`\\b${clave}\\b`);
    if (re.test(n)) {
      if (clave === "aguila" && /aguila\s+light/.test(n)) continue;
      return { clave, skus: skus.filter(f) };
    }
  }
  const cod = n.match(/\b(\d{4,5})\b/);
  if (cod) {
    const s = skus.filter((x) => String(x.codigo) === cod[1]);
    if (s.length) return { clave: cod[1], skus: s };
  }
  return null;
}

// Archivos y momentos que alimentan las respuestas.
function asFuentes() {
  const p = (STATE && STATE.parsed) || null;
  const semanas = typeof semanasDelPlan === "function" ? semanasDelPlan() : [];
  const pep = (typeof INVENTORY_BALANCE !== "undefined" && INVENTORY_BALANCE) || [];
  const foto = pep.map((e) => e && e.fotoEn).filter(Boolean)[0] || null;
  const i0d = typeof getI0Date === "function" ? getI0Date() : null;
  const pcCoc = typeof PC !== "undefined" && PC && PC.filas ? PC.filas.filter((x) => x.tipo === "coc" && x.inicio != null) : [];
  const fuera =
    typeof cocimientosRealesFueraDelInventario === "function" && i0d
      ? cocimientosRealesFueraDelInventario(i0d, MOSTO_CATALOG)
      : { lotes: [], corte: null };
  return {
    instructivo: p
      ? {
          archivo: (typeof VOL_ARCHIVO_ACTUAL !== "undefined" && VOL_ARCHIVO_ACTUAL) || "instructivo de envasado",
          semanas: semanas.map((s) => s.label),
          desde: semanas[0] ? semanas[0].start : null,
          hasta: semanas.length ? semanas[semanas.length - 1].end : null,
        }
      : null,
    pep: pep.length ? { equipos: pep.length, foto: foto ? Date.parse(foto) : null, corte: fuera.corte } : null,
    pc: pcCoc.length
      ? { archivo: PC.archivo || "Programa de Cocinas", desde: Math.min(...pcCoc.map((x) => x.inicio)), hasta: Math.max(...pcCoc.map((x) => x.inicio)), extra: fuera.lotes }
      : null,
    i0: i0d ? i0d.getTime() : null,
  };
}

// CUADRE DEL PLAN, en vivo: lo que pide el instructivo desde el I0 = lo que
// cubre el inventario + lo que se cocina + lo que no alcanza. Por mosto.
function asCuadrePlan() {
  if (!(STATE && STATE.parsed && STATE.plan)) return null;
  const i0d = getI0Date();
  if (!i0d) return null;
  const i0 = i0d.getTime();
  const o = {};
  const fila = (id) => (o[id] = o[id] || { dem: 0, inv: 0, coc: 0, na: 0 });
  TRAINS.forEach((t) =>
    (STATE.parsed.rawEvents[t] || []).forEach((e) => {
      if (classify(e) !== "production" || !e.hectolitros) return;
      const id = matchMosto(e.name, MOSTO_CATALOG);
      if (!id) return;
      const a = e.start.getTime();
      const b = e.end.getTime();
      const fr = b <= i0 ? 0 : a >= i0 ? 1 : (b - i0) / (b - a);
      fila(id).dem += e.hectolitros * fr;
    }),
  );
  (STATE.plan.cubiertoPorInvTramos || []).forEach((x) => (fila(x.mostoId).inv += x.hL));
  (STATE.plan.noAlcanzable || []).forEach((x) => (fila(x.mostoId).na += x.hL));
  (STATE.plan.results || []).forEach((r) => {
    if (r.cocimientos && r.cocimientos.length) fila(r.mostoId).coc += r.cocimientos.reduce((a, c) => a + (c.hLProducto || 0), 0);
  });
  Object.values(o).forEach((x) => (x.dif = x.dem - x.inv - x.coc - x.na));
  return o;
}

/* --------------------------------------------------------------- respuestas */

function asRespVolumen(n, t) {
  const r = resumenVolumen();
  const si = asSemanaIdx(n, r.semanas);
  if (si === -1) return { html: `<p>Esa semana no está en el instructivo cargado (tiene ${r.semanas.map((s) => asEsc(s.label)).join(", ")}).</p>` };
  const marca = asSkusMencionados(n, r.skus);
  const cuadre = typeof cuadreTablaResumen === "function" ? cuadreTablaResumen(r) : null;
  const fuente = asFuente(
    `${r.porHoja ? "filas por día de cada hoja del instructivo" : "bloques del instructivo por fecha"}${
      cuadre ? ` (cuadran con la tabla resumen de cada hoja en ${cuadre.revisados - cuadre.difs.length} de ${cuadre.revisados} SKU-semana)` : ""
    }.`,
  );
  // Una marca o SKU concreto.
  if (marca && marca.skus.length && !/(porcentaje|%|proporcion|participacion|mezcla|mix)/.test(n.replace(/malta|cerveza/g, "")) && !(/malta/.test(n) && /cerveza/.test(n))) {
    const semIdx = si != null ? [si] : r.semanas.map((_, i) => i);
    const filas = semIdx.map((i) => {
      const v = marca.skus.reduce((a, s) => a + (s.porSemana[i] || 0), 0);
      return { i, v, tot: r.reparto[i].total };
    });
    const total = filas.reduce((a, f) => a + f.v, 0);
    return {
      html: `<p><b>${asEsc(marca.clave === marca.skus[0].codigo ? marca.skus[0].nombre : marca.clave.replace(/\b\w/g, (c) => c.toUpperCase()))}</b>: ${asHL(total)} a envasar${si != null ? ` en ${asEsc(r.semanas[si].label)}` : " en todo el instructivo"} (${marca.skus.length} SKU: ${marca.skus.map((s) => asEsc(s.nombre)).join(", ")}).</p>${
        semIdx.length > 1
          ? `<table class="acu-tabla as-tabla"><thead><tr><th>Semana</th><th class="num">hL</th><th class="num">% de la semana</th></tr></thead><tbody>${filas.map((f) => `<tr><td>${asEsc(r.semanas[f.i].label)}</td><td class="num">${MOD_NF(f.v)}</td><td class="num">${asPct(f.v, f.tot)}</td></tr>`).join("")}</tbody></table>`
          : `<p>Es el ${asPct(total, filas[0].tot)} de lo que se envasa esa semana (${asHL(filas[0].tot)}).</p>`
      }${fuente}`,
    };
  }
  // Malta vs. cerveza (una semana o todas).
  const semIdx = si != null ? [si] : r.semanas.map((_, i) => i);
  const nomM = (id) => asNom(id);
  const filaSem = (i) => {
    const o = r.reparto[i];
    return `<tr><td>${asEsc(r.semanas[i].label)}</td><td class="num">${MOD_NF(o.total)}</td><td class="num"><b>${asPct(o.malta, o.total)}</b><small> ${MOD_NF(o.malta)}</small></td><td class="num"><b>${asPct(o.cerveza, o.total)}</b><small> ${MOD_NF(o.cerveza)}</small></td></tr>`;
  };
  const tot = r.repartoTotal;
  let detalle = "";
  if (si != null) {
    const o = r.reparto[si];
    detalle = `<p>Por mosto: ${Object.entries(o.porMosto)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) => `${asEsc(nomM(id))} ${asPct(v, o.total)} (${MOD_NF(v)} hL)`)
      .join(" · ")}.</p>`;
  }
  return {
    html: `${si != null ? `<p><b>${asEsc(r.semanas[si].label)}</b>: se envasan ${asHL(r.reparto[si].total)} — <b>malta ${asPct(r.reparto[si].malta, r.reparto[si].total)}</b> y <b>cerveza ${asPct(r.reparto[si].cerveza, r.reparto[si].total)}</b>.</p>${detalle}` : `<p>Malta (Pony) vs. cerveza a envasar por semana:</p>`}${
      si == null
        ? `<table class="acu-tabla as-tabla"><thead><tr><th>Semana</th><th class="num">hL</th><th class="num">Malta</th><th class="num">Cerveza</th></tr></thead><tbody>${semIdx.map(filaSem).join("")}<tr><td><b>Todo</b></td><td class="num"><b>${MOD_NF(tot.total)}</b></td><td class="num"><b>${asPct(tot.malta, tot.total)}</b></td><td class="num"><b>${asPct(tot.cerveza, tot.total)}</b></td></tr></tbody></table>`
        : ""
    }${tot.sinMosto > 0 ? `<p class="as-sub">${MOD_NF(tot.sinMosto)} hL no homologan a ningún mosto y no cuentan ni como malta ni como cerveza.</p>` : ""}${fuente}<button class="btn small" data-goto="view-datos">Ver Datos de entrada →</button>`,
  };
}

function asBuscarEquipo(n) {
  const inv = (typeof INVENTORY_BALANCE !== "undefined" && INVENTORY_BALANCE) || [];
  const m = n.match(/\b(ext\s*\d{1,2}|te\s*\d{1,2}|bbt\s*\d{1,2}|\d{1,2}\s*-\s*\d{3}\s*a?)\b/);
  if (!m) return null;
  const tok = m[1].replace(/\s+/g, "");
  const norm = (s) => asNorm(s).replace(/\s+/g, "");
  let e = inv.filter((x) => norm(x.equipo) === tok || norm(x.equipo) === tok.replace(/^te/, "ext"));
  if (!e.length) {
    const num = tok.match(/^(\d{1,2})-/);
    if (num) e = inv.filter((x) => norm(x.equipo).startsWith(num[1] + "-"));
  }
  return { tok: m[1], filas: e };
}

function asRespInventario(n, t) {
  const inv = (typeof INVENTORY_BALANCE !== "undefined" && INVENTORY_BALANCE) || [];
  const fu = asFuentes();
  if (!inv.length)
    return { html: '<p>No hay inventario cargado. Sube el «PRODUCTO EN PROCESO» en Datos de entrada para que T-minus sepa qué hay en cada FV, SV y BBT.</p><button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button>' };
  const fuenteTxt = `Producto en proceso${fu.pep && fu.pep.foto ? ` (foto del ${asF(fu.pep.foto)}${fu.pep.corte ? `, último llenado registrado ${asF(fu.pep.corte)}` : ""})` : ""}`;
  const lotes = inventoryBatchesByMosto(MOSTO_CATALOG);
  const loteDe = (equipo) => Object.values(lotes).flat().find((l) => l.equipo === equipo);
  const cubre = (equipo) => ((STATE.plan && STATE.plan.cubiertoPorInvTramos) || []).filter((x) => x.equipo === equipo);
  const eq = asBuscarEquipo(n);
  if (eq) {
    // Un tanque concreto.
    const ocup = typeof inventoryOccupancyByEquipo === "function" ? inventoryOccupancyByEquipo() : {};
    const progr = ((STATE.seq && STATE.seq.tankAssignment && STATE.seq.tankAssignment.rows) || []).filter((r) => r.tanque && asNorm(r.tanque).replace(/\s+/g, "") === eq.tok.replace(/\s+/g, "").replace(/^te/, "ext"));
    const delPrograma = fu.pc ? fu.pc.extra.filter((l) => (l.tanques || []).some((x) => asNorm(x).replace(/\s+/g, "") === eq.tok.replace(/\s+/g, "").replace(/^te/, "ext"))) : [];
    if (!eq.filas.length && !progr.length && !delPrograma.length)
      return { html: `<p>No encuentro el equipo «${asEsc(eq.tok.toUpperCase())}» en el Producto en proceso ni en la asignación de tanques del plan.</p>` };
    const partes = eq.filas.map((e) => {
      const l = loteDe(e.equipo);
      const c = cubre(e.equipo);
      const nombre = e.vacio ? "VACÍO" : e.marcaTexto || asNom(e.mostoId) || "—";
      return `<p><b>${asEsc(e.equipo)}</b> (${asEsc(e.tipo || "—")}) · ${asEsc(nombre)}${e.vacio ? "" : ` · ${MOD_NF(Number(e.hL) || 0)} hL diluidos`}${e.diasEnEquipo !== "" && e.diasEnEquipo != null ? ` · ${MOD_NF(Number(e.diasEnEquipo), 2)} días en el equipo a la hora de la foto` : ""}.</p>${
        e.cocinadoEn ? `<p>${/llenado/.test(e.cocinadoNota || "") ? "Terminó de llenarse desde cocinas" : "Cocinado"} el <b>${asEsc(asF(Date.parse(e.cocinadoEn)))}</b>${e.cocinadoNota ? ` (${asEsc(e.cocinadoNota)})` : ""}.</p>` : ""
      }${e.vacioMinEn ? `<p>La planta lo puede vaciar desde el <b>${asEsc(asF(Date.parse(e.vacioMinEn)))}</b> (fecha tanque vacío mín.).</p>` : ""}${l ? `<p>Listo para envasar desde el <b>${asEsc(asF(new Date(l.listoEn).getTime()))}</b>.</p>` : ""}${
        c.length
          ? `<p>T-minus lo usa para:</p><ul>${c.map((x) => `<li>L${asEsc(x.train)} · ${asEsc(x.name)}: ${asEsc(asF(x.desde))} → ${asEsc(asF(x.hasta))} (${asHL(x.hL)})</li>`).join("")}</ul>`
          : e.vacio || esLevaduraEnMadurador(e)
            ? ""
            : "<p>No cubre ningún envasado cargado (está listo después de lo que pide el instructivo, o no hay demanda de su marca a tiempo).</p>"
      }`;
    });
    const o = ocup[asNorm((eq.filas[0] || {}).equipo || eq.tok)];
    const extra = [
      delPrograma.length
        ? `<p>Según el Programa de Cocinas además recibió ${delPrograma.length} cocimiento(s) que el Producto en proceso aún no muestra: ${delPrograma.map((l) => `n.º ${l.n} (${asEsc(asF(Date.parse(l.cocinadoEn)))})`).join(", ")}.</p>`
        : "",
      o && !o.vacio && o.fecha ? `<p class="as-sub">Ocupado hasta el ${asEsc(asF(o.fecha.getTime()))}${o.delPrograma ? " (por los cocimientos del Programa de Cocinas)" : ""}.</p>` : "",
      progr.length
        ? `<p>En el plan T-minus recibe ${progr.length} cocimiento(s): ${[...new Set(progr.map((r) => asNom(r.mostoId)))].map(asEsc).join(", ")} desde el ${asEsc(asF(Math.min(...progr.map((r) => r.start.getTime()))))}.</p>`
        : "",
    ].join("");
    return { html: partes.join("") + extra + asFuente(`${fuenteTxt}${delPrograma.length ? " y Programa de Cocinas" : ""}; asignación de tanques del plan T-minus.`) };
  }
  // Tanques libres.
  if (/(libre|vacio|disponible)/.test(n)) {
    const vac = inv.filter((e) => e.vacio && e.tipo !== "BBT");
    const ocup = typeof inventoryOccupancyByEquipo === "function" ? inventoryOccupancyByEquipo() : {};
    const deVerdad = vac.filter((e) => {
      const o = ocup[asNorm(e.equipo)];
      return !o || o.vacio;
    });
    const tomados = vac.filter((e) => !deVerdad.includes(e));
    return {
      html: `<p>En el Producto en proceso salen <b>${vac.length}</b> FV/SV vacíos${tomados.length ? `, pero ${tomados.length} ya los llenó el Programa de Cocinas (${tomados.map((e) => asEsc(e.equipo)).join(", ")})` : ""}. Libres de verdad: <b>${deVerdad.length}</b>.</p><p>${deVerdad.map((e) => `${asEsc(e.equipo)} (${asEsc(e.tipo)})`).join(", ") || "—"}</p>${asFuente(fuenteTxt + (tomados.length ? " y Programa de Cocinas." : "."))}`,
    };
  }
  // Resumen por mosto (o de un mosto).
  const mm = asMosto(n);
  const ids = Object.keys(lotes).filter((k) => !mm || k === mm);
  const filas = ids.map((k) => {
    const ls = lotes[k];
    const hl = ls.reduce((a, l) => a + l.hL, 0);
    const ya = ls.filter((l) => new Date(l.listoEn).getTime() <= t.ms).reduce((a, l) => a + l.hL, 0);
    const prox = ls.filter((l) => new Date(l.listoEn).getTime() > t.ms).sort((a, b) => new Date(a.listoEn) - new Date(b.listoEn))[0];
    const usado = ((STATE.plan && STATE.plan.cubiertoPorInvTramos) || []).filter((x) => x.mostoId === k).reduce((a, x) => a + x.hL, 0);
    return `<tr><td>${asEsc(asNom(k))}</td><td class="num">${ls.length}</td><td class="num">${MOD_NF(hl)}</td><td class="num">${MOD_NF(ya)}</td><td>${prox ? `${asEsc(prox.equipo)} · ${asEsc(asF(new Date(prox.listoEn).getTime()))}` : "—"}</td><td class="num">${MOD_NF(usado)}</td></tr>`;
  });
  return {
    html: `<p>Inventario en proceso${mm ? ` de ${asEsc(asNom(mm))}` : ""} (hL diluidos, listos para envasar al ${asEsc(asF(t.ms))}):</p><table class="acu-tabla as-tabla"><thead><tr><th>Mosto</th><th class="num">Lotes</th><th class="num">hL</th><th class="num">Ya listos</th><th>Siguiente en estar listo</th><th class="num">Usado por el plan</th></tr></thead><tbody>${filas.join("")}</tbody></table>${
      fu.pc && fu.pc.extra.length ? `<p class="as-sub">Incluye ${fu.pc.extra.length} cocimientos del Programa de Cocinas que el Producto en proceso todavía muestra en tanques vacíos.</p>` : ""
    }${asFuente(fuenteTxt + (fu.pc && fu.pc.extra.length ? " y Programa de Cocinas." : "."))}<button class="btn small" data-goto="view-balance">Ver Balance de inventario →</button>`,
  };
}

function asRespFaltantes(n) {
  const na = (STATE.plan && STATE.plan.noAlcanzable) || [];
  const mm = asMosto(n);
  const lista = na.filter((x) => x.hL >= 1 && (!mm || x.mostoId === mm));
  if (!lista.length)
    return { html: `<p>No hay envasado sin cerveza${mm ? ` de ${asEsc(asNom(mm))}` : ""}: todo lo que pide el instructivo desde el I0 lo cubre el inventario o un cocimiento del plan.</p>${asFuente("plan T-minus calculado con el instructivo y el Producto en proceso.")}` };
  const porM = {};
  lista.forEach((x) => (porM[x.mostoId] = (porM[x.mostoId] || 0) + x.hL));
  return {
    html: `<p><b>${MOD_NF(lista.reduce((a, x) => a + x.hL, 0))} hL</b> del instructivo no tienen cerveza lista a tiempo: ${Object.entries(porM)
      .map(([k, v]) => `${asEsc(asNom(k))} ${MOD_NF(v)} hL`)
      .join(", ")}.</p><ul>${lista
      .sort((a, b) => a.desde - b.desde)
      .slice(0, 12)
      .map((x) => `<li>L${asEsc(x.train)} · ${asEsc(x.name)}: <b>${asEsc(asF(x.desde))} → ${asEsc(asF(x.hasta))}</b> · ${asHL(x.hL)} (un cocimiento nuevo estaría listo el ${asEsc(asF(x.listoDesde))})</li>`)
      .join("")}</ul><p class="as-sub">Ni el Producto en proceso ni el Programa de Cocinas tienen cerveza de ese mosto lista en esos tramos, y un cocimiento cargado desde el I0 no alcanza (cocina + fermentación + maduración). Hay que mover ese envasado o confirmar si hay cerveza que no esté en los archivos.</p>${asFuente("instructivo (filas por día), Producto en proceso y, si está cargado, Programa de Cocinas.")}`,
  };
}

function asRespUtilidades(n, t) {
  if (typeof calcularUtilidades !== "function") return null;
  const u = calcularUtilidades(STATE.mergedByTrain);
  const en = (l) => l.find((x) => x.start.getTime() <= t.ms && t.ms < x.end.getTime());
  const c = en(u.calderas);
  const a = en(u.aire);
  if (!c && !a) return { html: `<p>El ${asEsc(asF(t.ms))} está fuera del instructivo cargado.</p>` };
  const prox = [...u.calderas.map((x) => ({ ...x, eq: "Calderas" })), ...u.aire.map((x) => ({ ...x, eq: "Aire" }))]
    .filter((x) => x.start.getTime() > t.ms)
    .sort((x, y) => x.start - y.start)
    .slice(0, 5);
  return {
    html: `<p>El ${asEsc(asF(t.ms))}: <b>calderas: ${asEsc(c ? c.texto : "—")}</b> y <b>aire comprimido: ${asEsc(a ? a.texto : "—")}</b>${a ? ` (${asEsc(utilTextoLineas(a))})` : ""}.</p>${
      prox.length ? `<p>Siguientes cambios:</p><ul>${prox.map((x) => `<li>${asEsc(asF(x.start.getTime()))} · ${x.eq}: ${asEsc(x.texto)}</li>`).join("")}</ul>` : ""
    }<p class="as-sub">Regla de Utilities por número de líneas funcionando (los DPA no cuentan; huecos de hasta 30 min entre turnos no son parada).</p>${asFuente("instructivo de envasado (líneas funcionando) y la caldera/Elliot elegidos en el Gantt.")}`,
  };
}

function asRespLevadura(n, t) {
  const ev = ((STATE.seq && STATE.seq.yeastEvents) || []).filter((e) => e.mostoId === "light");
  const cos = typeof computedYeastHarvests === "function" ? computedYeastHarvests(STATE.seq && STATE.seq.tankAssignment) : [];
  const light = cos.filter((c) => c.tipo === "light").sort((a, b) => a.fechaDisponible - b.fechaDisponible);
  return {
    html: `<p>La Light solo se cocina con levadura Light. Cosechas Light previstas (a los 6 días de fermentación, solo de FV EXT):</p><ul>${light.map((c) => `<li>${asEsc(c.fuente)}: desde el <b>${asEsc(asF(c.fechaDisponible.getTime()))}</b></li>`).join("") || "<li>—</li>"}</ul>${
      ev.length ? `<p>Campañas de Light del plan:</p><ul>${ev.map((e) => `<li>${asEsc(e.blockLabel)} · ${asEsc(e.estado)}${e.fuente ? ` · levadura de ${asEsc(e.fuente)}` : ""}${e.inicio ? ` · arranca ${asEsc(asF(new Date(e.inicio).getTime()))}` : ""}</li>`).join("")}</ul>` : ""
    }${asFuente("Producto en proceso (FV EXT con Light) y asignación de tanques del plan T-minus.")}`,
  };
}

function asRespResumen() {
  const d = asDatos();
  const fu = asFuentes();
  const r = typeof resumenVolumen === "function" ? resumenVolumen() : null;
  const cu = asCuadrePlan();
  const porM = {};
  d.cocs.forEach((c) => (porM[c.mostoId] = (porM[c.mostoId] || 0) + 1));
  const tarde = d.cocs.filter((c) => c.tarde || c.tardeTanque);
  const na = Object.values(cu || {}).reduce((a, x) => a + x.na, 0);
  const inv = Object.values(cu || {}).reduce((a, x) => a + x.inv, 0);
  const dem = Object.values(cu || {}).reduce((a, x) => a + x.dem, 0);
  return {
    html: `<p><b>Plan de cocinas</b> desde el I0 ${asEsc(asF(fu.i0))}: <b>${d.cocs.length}</b> cocimientos (${Object.entries(porM)
      .map(([k, v]) => `${asEsc(asNom(k))} ${v}`)
      .join(" · ")}); <b>${tarde.length}</b> llega(n) tarde.</p>
      <p>Envasado desde el I0: ${asHL(dem)} — ${asPct(inv, dem)} sale del inventario, ${asPct(dem - inv - na, dem)} de cocimientos nuevos${na >= 1 ? ` y <span class="pvr-no">${asPct(na, dem)} (${MOD_NF(na)} hL) no tiene cerveza a tiempo</span>` : ""}.</p>
      ${r ? `<p>Instructivo: ${r.semanas.length} semanas, ${asHL(r.total)}, <b>malta ${asPct(r.repartoTotal.malta, r.repartoTotal.total)}</b> / cerveza ${asPct(r.repartoTotal.cerveza, r.repartoTotal.total)}.</p>` : ""}
      ${asFuente(`instructivo${fu.pep ? ", Producto en proceso" : ""}${fu.pc ? ", Programa de Cocinas" : ""}; plan T-minus calculado en este navegador.`)}`,
  };
}

function asRespRevisar() {
  const d = asDatos();
  const items = [];
  const na = ((STATE.plan && STATE.plan.noAlcanzable) || []).filter((x) => x.hL >= 1);
  if (na.length) {
    const porM = {};
    na.forEach((x) => (porM[x.mostoId] = (porM[x.mostoId] || 0) + x.hL));
    items.push({ peso: 3, txt: `<b>Envasado sin cerveza a tiempo</b>: ${Object.entries(porM).map(([k, v]) => `${asEsc(asNom(k))} ${MOD_NF(v)} hL`).join(", ")}. Pregúntame «¿qué envasado no alcanza?» para ver los tramos.` });
  }
  const tarde = d.cocs.filter((c) => c.tarde || c.tardeTanque);
  if (tarde.length) items.push({ peso: 2, txt: `<b>${tarde.length} cocimiento(s) tarde</b>: ${tarde.slice(0, 4).map((c) => `${asEsc(asNom(c.mostoId))} n.º ${c.n} (${asEsc(asF(c.ms))})`).join(", ")}.` });
  (STATE.seq.capacityWarnings || [])
    .filter((w) => ["ponyseguidas", "ponysuelta", "levadura", "aseocorto"].includes(w.tipo))
    .forEach((w) => items.push({ peso: 1, txt: asEsc(String(w.detalle || w.tipo).split(". ")[0]) + "." }));
  const fu = asFuentes();
  if (fu.pc && fu.pc.extra.length) items.push({ peso: 1, txt: `El Producto en proceso no está al día: ${fu.pc.extra.length} cocimientos del Programa de Cocinas llenaron tanques que ahí salen vacíos (último llenado registrado ${asEsc(asF(fu.pep && fu.pep.corte))}). T-minus ya los cuenta.` });
  if (fu.pc && fu.i0 && fu.pc.hasta < fu.i0) items.push({ peso: 2, txt: "El Programa de Cocinas cargado termina antes del I0: cárgalo actualizado para comparar plan vs. real." });
  if (typeof PP_AVISO_TIEMPOS !== "undefined" && PP_AVISO_TIEMPOS) items.push({ peso: 1, txt: asEsc(PP_AVISO_TIEMPOS) });
  const cu = asCuadrePlan();
  const roto = cu && Object.entries(cu).filter(([, x]) => Math.abs(x.dif) >= 1);
  if (roto && roto.length) items.push({ peso: 4, txt: `<span class="pvr-no">El plan no cuadra</span> en ${roto.map(([k, x]) => `${asEsc(asNom(k))} (${MOD_NF(x.dif)} hL)`).join(", ")}: avísale a quien mantiene T-minus.` });
  if (!items.length) return { html: "<p>No veo nada que revisar: todo el envasado tiene cerveza a tiempo, ningún cocimiento llega tarde y el plan cuadra.</p>" };
  items.sort((a, b) => b.peso - a.peso);
  return { html: `<p>Lo que yo revisaría, de más a menos importante:</p><ol>${items.map((i) => `<li>${i.txt}</li>`).join("")}</ol>${asFuente("plan T-minus, avisos del motor y los archivos cargados.")}` };
}

function asRespFuentes() {
  const fu = asFuentes();
  const r = typeof resumenVolumen === "function" ? resumenVolumen() : null;
  const checks = r && typeof validarPlanVolumen === "function" ? validarPlanVolumen(r) : [];
  const cu = asCuadrePlan();
  const li = [];
  li.push(
    fu.instructivo
      ? `<li><b>Instructivo de envasado</b> (${asEsc(fu.instructivo.archivo)}): ${fu.instructivo.semanas.map(asEsc).join(", ")}, del ${asEsc(fmtDate(new Date(fu.instructivo.desde)))} al ${asEsc(fmtDate(new Date(fu.instructivo.hasta - AS_D)))}${r ? `, ${asHL(r.total)} en ${r.skus.length} SKU` : ""}.</li>`
      : "<li><b>Instructivo</b>: no cargado.</li>",
  );
  li.push(
    fu.pep
      ? `<li><b>Producto en proceso</b>: ${fu.pep.equipos} equipos, foto del ${asEsc(asF(fu.pep.foto))}${fu.pep.corte ? `, último llenado registrado ${asEsc(asF(fu.pep.corte))}` : ""}.</li>`
      : "<li><b>Producto en proceso</b>: no cargado (sin inventario).</li>",
  );
  li.push(
    fu.pc
      ? `<li><b>Programa de Cocinas</b> (${asEsc(fu.pc.archivo)}): cargues hasta el ${asEsc(asF(fu.pc.hasta))}${fu.pc.extra.length ? `; ${fu.pc.extra.length} cocimientos suyos cuentan como cerveza en proceso` : ""}.</li>`
      : "<li><b>Programa de Cocinas</b>: no cargado.</li>",
  );
  li.push(`<li><b>Plan T-minus</b>: calculado en este navegador desde el I0 ${asEsc(asF(fu.i0))}.</li>`);
  const ok = checks.filter((c) => c.ok).length;
  const cuadraTodo = cu && Object.values(cu).every((x) => Math.abs(x.dif) < 1);
  return {
    html: `<p>Respondo solo con lo que está cargado aquí; no uso datos de afuera ni supongo nada que no esté en los archivos:</p><ul>${li.join("")}</ul>
      <p><b>Verificación en vivo</b>:</p><ul>${checks.map((c) => `<li>${c.ok ? "✓" : "⚠"} ${asEsc(c.tit)}: ${asEsc(c.det)}</li>`).join("")}${
        cu
          ? `<li>${cuadraTodo ? "✓" : "⚠"} Cuadre del plan por mosto (envasado desde el I0 = inventario + cocimientos + no alcanzable): ${Object.entries(cu)
              .map(([k, x]) => `${asEsc(asNom(k))} ${MOD_NF(x.dem)} = ${MOD_NF(x.inv)} + ${MOD_NF(x.coc)} + ${MOD_NF(x.na)}${Math.abs(x.dif) >= 1 ? ` <span class="pvr-no">(dif. ${MOD_NF(x.dif)})</span>` : ""}`)
              .join(" · ")}</li>`
          : ""
      }</ul><p class="as-sub">${ok} de ${checks.length} validaciones del instructivo en orden.</p>`,
  };
}

// Modulación: a qué hora arranca / para cada equipo de una línea.
function asRespModulacion(n, t) {
  if (typeof calcularModulacion !== "function") return null;
  const r = calcularModulacion(STATE.mergedByTrain, modlConfig());
  const linea = asLinea(n);
  // Todos los equipos que se mencionen («la lavadora y la paster»).
  const eqs = [
    ["lavadora", /lavadora/],
    ["agua", /\bagua\b/],
    ["paster", /paster|pasteuriz/],
  ]
    .filter(([, re]) => re.test(n))
    .map(([e]) => e);
  const quiere = /\b(para|parada|paran|apaga|detiene)\b/.test(n) && !/arranc|calenta|prend|enciend/.test(n) ? "para" : /arranc|calenta|prend|enciend|inicia/.test(n) ? "arranca" : null;
  const lineas = linea ? [linea] : TRAINS;
  const bloques = lineas.map((tr) => {
    const evs = r.eventos.filter((e) => e.tren === tr && e.equipo === "llenadora" && e.ms >= t.ms - 60000 && (!quiere || e.accion === quiere));
    const sig = evs[0];
    if (!sig) return `<li><b>L${asEsc(tr)}</b>: sin ${quiere === "para" ? "paradas" : quiere === "arranca" ? "arranques" : "paradas ni arranques"} después del ${asEsc(asF(t.ms))} en el instructivo.</li>`;
    const p = sig.parada;
    const grupo = r.eventos
      .filter((e) => e.parada === p && (e.accion === sig.accion || e.accion === "sigue") && e.equipo !== "llenadora" && (!eqs.length || eqs.includes(e.equipo)))
      .sort((a, b) => a.ms - b.ms);
    return `<li><b>L${asEsc(tr)}</b> · la llenadora ${sig.accion === "arranca" ? "arranca" : "para"} el <b>${asEsc(asF(sig.ms))}</b> (${sig.accion === "arranca" ? (p.desdeInicio ? "parada desde el comienzo del instructivo" : `tras ${modlDur(p.dur)} de parada`) : `parada de ${modlDur(p.dur)}${p.hastaFin ? ", hasta el final del instructivo" : `, arranca ${asF(p.arranca)}`}`}): ${grupo
      .map((e) => `${asEsc(MODL_NOMBRE[e.equipo])} ${asEsc(modlAccionTxt(e))} <b>${asEsc(asF(e.ms))}</b>`)
      .join(" · ")}.<br><small class="as-sub">${asEsc(p.motivo)}</small></li>`;
  });
  const cfg = modlConfig();
  return {
    html: `<p>${eqs.length ? `${eqs.map((e) => asEsc(MODL_NOMBRE[e])).join(" y ")}: ` : ""}lo siguiente desde el ${asEsc(asF(t.ms))}:</p><ul>${bloques.join("")}</ul><p class="as-sub">Reglas: arranque lavadora ${MOD_NF(cfg.arranque.lavadora / 60, 2)} h · agua ${MOD_NF(cfg.arranque.agua / 60, 2)} h · paster +${MOD_NF(cfg.arranque.paster / 60, 2)} h; parada lavadora ${MOD_NF(cfg.parada.lavadora / 60, 2)} h · agua ${MOD_NF(cfg.parada.agua / 60, 2)} h · paster +${MOD_NF(cfg.parada.paster / 60, 2)} h, respecto a la llenadora. Parada = DPA de mantenimiento o sin programación de ${MOD_NF(cfg.umbralMin / 60, 2)} h o más (cambio de líquido, CIP, empaque o arranque no son parada). Sin lavadora: ${TRAINS.filter((t) => !r.lavadora[t]).map((t) => "L" + t).join(", ") || "ninguna"}.</p>${asFuente("instructivo de envasado (es el seguimiento de la llenadora).")}<button class="btn small" data-goto="view-gantt-plan">Ver la modulación en el Gantt →</button>`,
  };
}

// Punto de entrada: devuelve {html} o null si la pregunta no es de este tipo.
function asResponderDatos(n, t, d) {
  if (/(de donde (sacas|salen|vienen)|que datos|fuentes?\b|archivos? (cargad|subid)|integridad|confiable|confianza|verifica|validacion)/.test(n)) return asRespFuentes();
  if (/(que (deberia|debo|hay que) revisar|que ves (raro|mal)|recomienda|recomendacion|que esta mal|problemas del plan|que me (preocupa|falta revisar))/.test(n)) return asRespRevisar();
  if (/(resumen|como (esta|va|quedo) el plan|estado del plan|panorama|en general)/.test(n)) return asRespResumen();
  if (/(no alcanza|no alcanzable|faltante|falta(n)? (cerveza|malta|pony)|no hay cerveza|sin cerveza|desabasto|quiebre)/.test(n)) return asRespFaltantes(n);
  if (/(levadura|cosecha)/.test(n)) return asRespLevadura(n, t);
  if (/(lavadora|paster|pasteuriz|modulacion|llenadora|calentamiento)/.test(n) || (/(arranc|parada|\bpara\b)/.test(n) && /\b(linea|tren|l)\s*-?\s*[5789]\b/.test(n) && !/cocin/.test(n)) || (/\bagua\b/.test(n) && /(arranc|parada|\bpara\b)/.test(n)))
    return asRespModulacion(n, t);
  if (/(elliot|sierra|centac|caldera|compresor(es)? de aire|aire comprimido|que compresor)/.test(n) && !/setpoint|psi|presion/.test(n)) return asRespUtilidades(n, t);
  const mencionaEquipo = /\b(ext\s*\d{1,2}|bbt\s*\d{1,2}|\d{1,2}\s*-\s*\d{3}\s*a?)\b/.test(n);
  if (mencionaEquipo || /(inventario|producto en proceso|tanques?\b.*\b(libres?|vacios?|disponibles?)|(libres?|vacios?|disponibles?)\b.*\btanques?|que hay en (el|los) (fv|sv|bbt|tanque|fermentador|madurador))/.test(n)) return asRespInventario(n, t);
  const esVolumen =
    /(porcentaje|%|proporcion|participacion|mezcla|\bmix\b)/.test(n) ||
    (/malta/.test(n) && /cerveza/.test(n)) ||
    (/(envas|volumen|hectolitro|\bhl\b|cuant)/.test(n) && /semana/.test(n) && !/cocimiento/.test(n)) ||
    (/(cuant[oa]s?|volumen|hectolitros?|\bhl\b)/.test(n) && /(envasa|envasar|envasan|envasado)/.test(n) && !/cocimiento/.test(n));
  if (esVolumen && typeof resumenVolumen === "function") return asRespVolumen(n, t);
  return null;
}
