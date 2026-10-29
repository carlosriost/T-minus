/* =========================================================================
   PROGRAMA DE COCINAS (EXCEL) — mapa interactivo del archivo de la planta
   -------------------------------------------------------------------------
   Lee el libro «Programa Cocinas» que lleva Elaboración y lo muestra sin
   perder nada, con filtros que mandan sobre todo lo de abajo:

   Hojas que se leen
   · «Programa Cocinas» (la principal): una fila por cocimiento o evento.
       B = n.º de cocimiento · C = mosto o evento (ASEO, PARO, PASO PROPAGADOR…)
       D = cargue (inicio) · E = duración · F = fin
       G = equipo destino (TE1…TE8, cubas 41…58 y sus combinaciones «41+42»,
           SV Pony 1…5, o formato de envase para Pony GO)
       H…P = anotaciones libres: origen de la levadura («TE4 J2» = tanque TE4,
           lote J2), fechas calculadas, incidentes, volúmenes, responsables.
       Además: color de resaltado de la fila y comentarios de celda.
     Las filas de ASEO/PARO casi nunca traen fecha: se ubican entre el cargue
     anterior y el siguiente (el hueco que dejan en la cocina).
   · «EFICIENCIAS»: por n.º de cocimiento, extracto de maceración, extracto
     al llenar, volumen de mosto frío, mosto débil, eficiencia INSQL y SAP.
   · «TIEMPOS»: tiempos de ciclo por mosto, matriz de tiempos entre cargues
     al cambiar de marca y tiempos de cambio con/sin aseo.
   · «LIBERACION EQUIPOS»: secuencias de aseo de cocinas por equipo.
   Las demás hojas se listan en el resumen del archivo (ocultas o con
   referencias rotas #REF!) para que se sepa que existen.

   Todo se procesa en el navegador; el último archivo queda guardado en este
   navegador para no tener que cargarlo cada vez.
   ========================================================================= */

const PC_LS_KEY = "planProgramaCocinasExcel";
const PC_MIN = 60000;
const PC_H = 3600000;
const PC_D = 86400000;

// Mostos en orden FIJO (el color sigue al mosto, nunca a su posición).
const PC_MOSTOS = [
  { id: "estandar", nombre: "Estándar", cls: "pc-c1", test: /estandar|est[aá]ndar/ },
  { id: "pilsen", nombre: "Pilsen", cls: "pc-c2", test: /pilsen/ },
  { id: "light", nombre: "Light", cls: "pc-c3", test: /light/ },
  { id: "ponyhg", nombre: "Pony HG", cls: "pc-c4", test: /pony.*(14|hg)/ },
  { id: "ponygo", nombre: "Pony GO", cls: "pc-c5", test: /pony.*go/ },
  { id: "club", nombre: "Club Colombia", cls: "pc-c6", test: /club/ },
];
const PC_EVENTOS = [
  { id: "aseo", nombre: "Aseo", cls: "pc-aseo" },
  { id: "paro", nombre: "Paro", cls: "pc-paro" },
  { id: "propagador", nombre: "Paso de propagador", cls: "pc-prop" },
];

// Colores de tema de Office (los del libro) para leer el resaltado de celdas.
const PC_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

let PC = null; // datos cargados
let PC_F = null; // filtros
let PC_SEL = null; // fila seleccionada (índice en PC.filas)
let PC_PAG = 0;

// CONTEXTO DE DIBUJO. Este módulo pinta dos vistas con las mismas gráficas:
// el Excel de Elaboración (PC: es el único que leen los demás módulos —plan
// vs. real, setpoints, inventario—) y el plan de cocinas que T-minus genera
// desde el instructivo (js/programa-feria.js). PCX apunta a la vista que se
// está pintando. PC_F / PC_SEL / PC_PAG siguen siendo siempre los del Excel.
const PCX_EXCEL = {
  fuente: "excel",
  get D() {
    return PC;
  },
  get F() {
    return PC_F;
  },
  set F(v) {
    PC_F = v;
  },
  get SEL() {
    return PC_SEL;
  },
  set SEL(v) {
    PC_SEL = v;
  },
  get PAG() {
    return PC_PAG;
  },
  set PAG(v) {
    PC_PAG = v;
  },
};
let PCX = PCX_EXCEL;
function pcMostos() {
  return (PCX.D && PCX.D.mostos) || PC_MOSTOS;
}
function pcEventos() {
  return (PCX.D && PCX.D.eventos) || PC_EVENTOS;
}

/* ---------------------------------------------------------------- lectura */

function pcSerialAMs(v) {
  // Serial de Excel → instante con la hora de pared de la planta en UTC.
  return Math.round(((v - 25569) * PC_D) / PC_MIN) * PC_MIN;
}
function pcTipo(texto) {
  const n = normalizeText(texto || "");
  if (!n) return null;
  if (/^paro/.test(n)) return { tipo: "evento", id: "paro" };
  if (/aseo/.test(n)) return { tipo: "evento", id: "aseo" };
  if (/propaga/.test(n)) return { tipo: "evento", id: "propagador" };
  // Pony GO antes que Pony HG: «Mosto Pony Malta GO» no trae «14°P».
  if (/pony/.test(n) && /\bgo\b/.test(n)) return { tipo: "coc", id: "ponygo" };
  for (const m of PC_MOSTOS) if (m.test.test(n)) return { tipo: "coc", id: m.id };
  return { tipo: "otro", id: "otro" };
}
function pcColorCelda(cell) {
  const s = cell && cell.s;
  if (!s || s.patternType !== "solid" || !s.fgColor) return null;
  let hex = s.fgColor.rgb ? String(s.fgColor.rgb).slice(-6) : s.fgColor.theme != null ? PC_THEME[s.fgColor.theme] : null;
  if (!hex) return null;
  const tint = Number(s.fgColor.tint) || 0;
  if (tint) {
    const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    hex = c
      .map((x) => Math.round(tint > 0 ? x + (255 - x) * tint : x * (1 + tint)))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }
  hex = hex.toUpperCase();
  if (hex === "FFFFFF") return null;
  return "#" + hex;
}
// Levadura: «TE4 J2», «TE1J4», «TE8 PROPAGADOR», «LEVADURA TE6 O-5 HORA CERO…»
function pcLevadura(txt) {
  if (typeof txt !== "string") return null;
  const m = txt.match(/\bTE\s*(\d)\s*(?:([A-Z])\s*-?\s*(\d{1,2}))?/i);
  if (!m) return null;
  if (!/^\s*(levadura\s+)?TE\s*\d/i.test(txt)) return null;
  return { tanque: "TE" + m[1], lote: m[2] ? (m[2] + m[3]).toUpperCase() : null };
}
function pcGrupoEquipo(g, tipoId) {
  const s = String(g == null ? "" : g).trim();
  if (!s) return "Sin equipo";
  if (/^TE\s*\d/i.test(s)) return "Tanques TE";
  if (/^\d{2}(\s*[+,\-]\s*\d{2})*$/.test(s) && Number(s.slice(0, 2)) >= 41) return "Cubas 41–58";
  if (/^\d(\s*[+]\s*\d)*$/.test(s) || /^\d(\.\d)?$/.test(s)) return tipoId === "ponyhg" || tipoId === "ponygo" ? "SV Pony 1–5" : "Otros";
  return "Formato / otros";
}

function pcLeerLibro(wb, nombreArchivo) {
  const hoja = wb.Sheets["Programa Cocinas"];
  if (!hoja) throw new Error('El archivo no tiene la hoja «Programa Cocinas».');
  const rango = XLSX.utils.decode_range(hoja["!ref"]);
  const L = XLSX.utils.encode_col;
  const filas = [];
  for (let r = 1; r <= rango.e.r; r++) {
    const cel = (c) => hoja[XLSX.utils.encode_cell({ r, c })];
    const val = (c) => (cel(c) ? cel(c).v : null);
    const texto = val(2);
    const n = val(1);
    if ((texto == null || String(texto).trim() === "") && n == null) continue;
    const t = pcTipo(texto);
    if (!t) continue;
    const dC = cel(3);
    const d = val(3);
    const e = val(4);
    const f = val(5);
    // D con fecha y hora (serial > 1) es el cargue; D < 1 en una fila de evento
    // es una duración escrita a mano (p. ej. «=D257-D255»).
    const inicio = typeof d === "number" && d > 1 ? pcSerialAMs(d) : null;
    const durMin =
      typeof e === "number" && e < 5 ? Math.round((e * PC_D) / PC_MIN) : typeof d === "number" && d < 1 && !inicio ? Math.round((d * PC_D) / PC_MIN) : null;
    const fin = typeof f === "number" && f > 1 ? pcSerialAMs(f) : inicio != null && durMin != null ? inicio + durMin * PC_MIN : null;
    // Anotaciones H en adelante, con su columna; fechas legibles.
    const notas = [];
    for (let c = 7; c <= Math.min(rango.e.c, 30); c++) {
      const x = cel(c);
      if (!x || x.v == null || String(x.v).trim() === "") continue;
      let v = x.v;
      let tipo = "texto";
      if (typeof v === "number") {
        if (x.z && XLSX.SSF.is_date(x.z) && v > 1) {
          v = pcSerialAMs(v);
          tipo = "fecha";
        } else if (x.z && XLSX.SSF.is_date(x.z) && v < 1) {
          v = Math.round((v * PC_D) / PC_MIN);
          tipo = "duracion";
        } else if (v > 40000 && v < 60000) {
          v = pcSerialAMs(v);
          tipo = "fecha";
        } else tipo = "numero";
      }
      notas.push({ col: L(c), tipo, v, formula: !!x.f });
    }
    const comentarios = [];
    const colores = new Set();
    for (let c = 1; c <= 7; c++) {
      const x = cel(c);
      if (x && x.c) x.c.forEach((cm) => comentarios.push({ col: L(c), txt: String(cm.t || "").trim(), autor: cm.a || "" }));
      const col = pcColorCelda(x);
      if (col) colores.add(col);
    }
    for (let c = 7; c <= 15; c++) {
      const x = cel(c);
      if (x && x.c) x.c.forEach((cm) => comentarios.push({ col: L(c), txt: String(cm.t || "").trim(), autor: cm.a || "" }));
    }
    const lev = notas.map((x) => pcLevadura(typeof x.v === "string" ? x.v : null)).find(Boolean) || null;
    filas.push({
      fila: r + 1,
      n: typeof n === "number" ? n : null,
      texto: String(texto || "").trim(),
      tipo: t.tipo,
      id: t.id,
      inicio,
      fin,
      durMin: durMin != null ? durMin : inicio != null && fin != null ? Math.round((fin - inicio) / PC_MIN) : null,
      equipo: val(6) == null ? "" : String(val(6)).trim(),
      grupo: pcGrupoEquipo(val(6), t.id),
      lev,
      notas,
      comentarios,
      colores: [...colores],
      fechaPropia: inicio != null,
    });
  }

  // Eventos sin fecha: van entre el cargue anterior y el siguiente.
  for (let i = 0; i < filas.length; i++) {
    const x = filas[i];
    if (x.inicio != null) continue;
    let a = null;
    let b = null;
    for (let j = i - 1; j >= 0; j--) if (filas[j].tipo === "coc" && filas[j].inicio != null) { a = filas[j]; break; }
    for (let j = i + 1; j < filas.length; j++) if (filas[j].tipo === "coc" && filas[j].inicio != null) { b = filas[j]; break; }
    if (a && b) {
      x.inicio = a.inicio;
      x.fin = b.inicio;
      x.entre = [a.n, b.n];
      x.hueco = b.inicio - a.inicio;
    } else if (a) {
      x.inicio = a.inicio;
      x.fin = a.inicio + (x.durMin || 60) * PC_MIN;
    }
  }

  // Tiempo entre cargues (de un cocimiento al siguiente).
  let prev = null;
  filas.forEach((x) => {
    if (x.tipo !== "coc" || x.inicio == null) return;
    if (prev) {
      x.desdeAnterior = x.inicio - prev.inicio;
      x.mostoAnterior = prev.id;
    }
    prev = x;
  });

  // EFICIENCIAS por n.º de cocimiento.
  const ef = {};
  const he = wb.Sheets["EFICIENCIAS"];
  if (he) {
    const re = XLSX.utils.decode_range(he["!ref"]);
    for (let r = 2; r <= re.e.r; r++) {
      const v = (c) => {
        const x = he[XLSX.utils.encode_cell({ r, c })];
        return x && typeof x.v === "number" && isFinite(x.v) ? x.v : null;
      };
      const k = v(1);
      if (k == null) continue;
      ef[k] = { extMac: v(7), extLlenar: v(8), volFrio: v(9), mostoDebil: v(10), efInsql: v(11), efSap: v(12) };
    }
  }
  filas.forEach((x) => {
    if (x.tipo === "coc" && x.n != null && ef[x.n]) {
      const e = ef[x.n];
      // 0 o negativos son celdas sin dato en el Excel (cocimientos futuros).
      Object.keys(e).forEach((k) => {
        if (!(e[k] > 0)) e[k] = null;
      });
      x.ef = e;
    }
  });

  // TIEMPOS: tabla por mosto, matriz entre marcas y cambios con/sin aseo.
  const tiempos = { mostos: [], matriz: null, cambios: [] };
  const ht = wb.Sheets["TIEMPOS"];
  if (ht) {
    const g = (a) => (ht[a] ? ht[a].v : null);
    const durTxt = (v) => (typeof v === "number" ? fmtHM(Math.round(v * 24 * 60)) : v == null ? "" : String(v));
    for (let r = 2; r <= 15; r++) {
      if (g("B" + r) == null || typeof g("B" + r) !== "string") continue;
      tiempos.mostos.push({ codigo: g("A" + r), mosto: g("B" + r), ciclo: durTxt(g("C" + r)), volumen: g("D" + r), cargues: durTxt(g("E" + r)) });
    }
    const cols = ["H", "I", "J", "K", "L", "M", "N"];
    const destinos = cols.map((c) => String(g(c + "2") || "").trim());
    if (destinos.filter(Boolean).length) {
      tiempos.matriz = {
        destinos,
        filas: [3, 4, 5, 6, 7, 8, 9]
          .map((r) => ({ desde: String(g("G" + r) || "").trim(), valores: cols.map((c) => (typeof g(c + r) === "number" ? Math.round(g(c + r) * 24 * 60) : null)) }))
          .filter((f) => f.desde),
      };
    }
    for (let r = 14; r <= 60; r++) {
      const a = g("G" + r);
      if (a == null) continue;
      const h = g("H" + r);
      const i = g("I" + r);
      const j = g("J" + r);
      const k = g("K" + r);
      tiempos.cambios.push({
        de: String(a).trim(),
        tipo: typeof h === "string" ? h.trim() : "",
        a: typeof i === "string" ? i.trim() : "",
        horas: typeof j === "number" ? Math.round(j * 24 * 60) : typeof h === "number" ? Math.round(h * 60) : typeof k === "number" ? Math.round(k * 60) : null,
        nota: typeof i === "string" && typeof h === "number" ? i.trim() : "",
      });
    }
  }

  // LIBERACION EQUIPOS: secuencias de aseo (título en I, filas con equipo en J).
  const liberacion = [];
  const hl = wb.Sheets["LIBERACION EQUIPOS"];
  if (hl) {
    const re = XLSX.utils.decode_range(hl["!ref"]);
    let actual = null;
    for (let r = 0; r <= re.e.r; r++) {
      const v = (c) => {
        const x = hl[XLSX.utils.encode_cell({ r, c })];
        return x ? x.v : null;
      };
      const i = v(8);
      const j = v(9);
      if (typeof i === "string" && /aseo/i.test(i)) {
        actual = { titulo: i.trim(), pasos: [] };
        liberacion.push(actual);
      } else if (actual && typeof i === "number" && i > 1) {
        actual.pasos.push({ inicio: pcSerialAMs(i), equipo: j ? String(j).trim() : "(sin nombre)", fin: typeof v(10) === "number" ? pcSerialAMs(v(10)) : null, nota: v(11) ? String(v(11)).trim() : "" });
      }
    }
  }

  // Inventario de hojas, para no omitir nada en silencio.
  const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
  const hojas = wb.SheetNames.map((s, i) => ({
    nombre: s,
    oculta: !!(meta[i] && meta[i].Hidden),
    usada: ["Programa Cocinas", "EFICIENCIAS", "TIEMPOS", "LIBERACION EQUIPOS"].includes(s),
  }));

  return { archivo: nombreArchivo, cargado: Date.now(), filas, tiempos, liberacion, hojas };
}

function fmtHM(min) {
  if (min == null || !isFinite(min)) return "—";
  const s = min < 0 ? "-" : "";
  min = Math.abs(Math.round(min));
  return `${s}${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

/* --------------------------------------------------------------- estado */

function pcGuardar() {
  try {
    localStorage.setItem(PC_LS_KEY, JSON.stringify(PC));
  } catch (_) {
    // Si no cabe, se trabaja solo en memoria.
  }
}
function pcRecuperar() {
  try {
    const s = localStorage.getItem(PC_LS_KEY);
    if (s) PC = JSON.parse(s);
  } catch (_) {
    PC = null;
  }
}
function pcFiltrosIniciales(datos) {
  const D = datos || PCX.D;
  const coc = D.filas.filter((x) => x.inicio != null);
  const max = Math.max(...coc.map((x) => x.inicio));
  const min = Math.min(...coc.map((x) => x.inicio));
  const finDia = medianocheMs(new Date(max)) + PC_D;
  return {
    desde: Math.max(medianocheMs(new Date(min)), finDia - 28 * PC_D),
    hasta: finDia,
    min: medianocheMs(new Date(min)),
    max: finDia,
    mostos: new Set((D.mostos || PC_MOSTOS).map((m) => m.id)),
    eventos: new Set((D.eventos || PC_EVENTOS).map((e) => e.id)),
    grupo: "todos",
    equipo: "",
    texto: "",
    soloNotas: false,
  };
}
function pcPasa(x, sinRango) {
  const f = PCX.F;
  if (x.inicio == null) return false;
  if (!sinRango && (x.fin != null ? x.fin : x.inicio) < f.desde) return false;
  if (!sinRango && x.inicio >= f.hasta) return false;
  if (x.tipo === "coc" && !f.mostos.has(x.id)) return false;
  if (x.tipo === "evento" && !f.eventos.has(x.id)) return false;
  if (x.tipo === "otro" && f.mostos.size < pcMostos().length) return false;
  if (f.grupo !== "todos" && x.tipo === "coc" && x.grupo !== f.grupo) return false;
  if (f.grupo !== "todos" && x.tipo !== "coc") return false;
  if (f.equipo && normalizeText(x.equipo) !== normalizeText(f.equipo)) return false;
  if (f.soloNotas && !x.notas.length && !x.comentarios.length) return false;
  if (f.texto) {
    const q = normalizeText(f.texto);
    const hay = normalizeText([x.n, x.texto, x.equipo, x.buscar || "", ...x.notas.map((nn) => (nn.tipo === "texto" || nn.tipo === "numero" ? nn.v : "")), ...x.comentarios.map((c) => c.txt)].join(" "));
    if (!hay.includes(q)) return false;
  }
  return true;
}
function pcClaseDe(x) {
  if (x.tipo === "coc") return (pcMostos().find((m) => m.id === x.id) || {}).cls || "pc-otro";
  if (x.tipo === "evento") return (pcEventos().find((e) => e.id === x.id) || {}).cls || "pc-otro";
  return "pc-otro";
}
function pcNombreDe(x) {
  if (x.tipo === "coc") return (pcMostos().find((m) => m.id === x.id) || {}).nombre || x.texto;
  if (x.tipo === "evento") return (pcEventos().find((e) => e.id === x.id) || {}).nombre || x.texto;
  return x.texto;
}
function pcSemanaIso(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dia + 3);
  const primero = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - primero) / PC_D - 3 + ((primero.getUTCDay() + 6) % 7)) / 7);
}
function pcFecha(ms) {
  return ms == null ? "—" : fmtDateTime(new Date(ms));
}

/* ------------------------------------------------------------ tooltip */

function pcTip() {
  let t = document.getElementById("pcTooltip");
  if (!t) {
    t = document.createElement("div");
    t.id = "pcTooltip";
    t.className = "pc-tip";
    t.hidden = true;
    document.body.appendChild(t);
  }
  return t;
}
// lineas: [{v: valor fuerte, l: etiqueta, cls: clase de color}]
function pcMostrarTip(ev, titulo, lineas) {
  const t = pcTip();
  t.textContent = "";
  const h = document.createElement("div");
  h.className = "pc-tip-t";
  h.textContent = titulo;
  t.appendChild(h);
  lineas.forEach((ln) => {
    const row = document.createElement("div");
    row.className = "pc-tip-r";
    if (ln.cls) {
      const k = document.createElement("span");
      k.className = "pc-tip-k " + ln.cls;
      row.appendChild(k);
    }
    const b = document.createElement("b");
    b.textContent = ln.v;
    row.appendChild(b);
    const s = document.createElement("span");
    s.textContent = " " + (ln.l || "");
    row.appendChild(s);
    t.appendChild(row);
  });
  t.hidden = false;
  const w = t.offsetWidth;
  const hgt = t.offsetHeight;
  let x = ev.clientX + 14;
  let y = ev.clientY + 14;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
  if (y + hgt > window.innerHeight - 8) y = ev.clientY - hgt - 14;
  t.style.left = x + "px";
  t.style.top = y + "px";
}
function pcOcultarTip() {
  const t = document.getElementById("pcTooltip");
  if (t) t.hidden = true;
}
function pcTipFila(ev, x) {
  const lineas = [];
  if (x.tipo === "coc") {
    lineas.push({ v: pcFecha(x.inicio), l: "cargue", cls: pcClaseDe(x) });
    if (x.durMin != null) lineas.push({ v: fmtHM(x.durMin), l: "h de ciclo" });
    if (x.equipo) lineas.push({ v: x.equipo, l: "equipo destino" });
    if (x.ef && x.ef.volFrio) lineas.push({ v: MOD_NF(x.ef.volFrio), l: "hL mosto frío" });
    if (x.ef && x.ef.efSap) lineas.push({ v: MOD_NF(x.ef.efSap, 1) + " %", l: "eficiencia SAP" });
    if (x.desdeAnterior) lineas.push({ v: fmtHM(x.desdeAnterior / PC_MIN), l: "desde el cargue anterior" });
  } else {
    lineas.push({ v: x.entre ? fmtHM((x.hueco || 0) / PC_MIN) : x.durMin != null ? fmtHM(x.durMin) : "—", l: x.entre ? `de hueco entre el #${x.entre[0]} y el #${x.entre[1]}` : "duración", cls: pcClaseDe(x) });
  }
  if (x.notas.length) lineas.push({ v: String(x.notas.length), l: "anotación(es) — clic para verlas" });
  pcMostrarTip(ev, `${x.n != null ? "#" + x.n + " · " : ""}${x.texto}`, lineas);
}

/* ------------------------------------------------------------- render */

function renderProgramaCocinas() {
  const cont = document.getElementById("programaCocinasPanel");
  if (!cont) return;
  PCX = PCX_EXCEL;
  // Las dos vistas usan los mismos id de gráficas: solo una puede estar pintada.
  const otra = document.getElementById("programaFeriaPanel");
  if (otra) otra.innerHTML = "";
  if (!PC) pcRecuperar();
  const carga = `
    <div class="panel">
      <div class="panel-head"><h3>Programa de cocinas (Excel de Elaboración)</h3>
        <span class="sub">${PC ? `${escapeHtml(PC.archivo)} · ${PCX.D.filas.length.toLocaleString("es-CO")} filas · cargado ${escapeHtml(new Date(PC.cargado).toLocaleString("es-CO"))}` : "Carga «Programa_Cocinas.xlsx»"}</span>
      </div>
      <div class="panel-body">
        <div class="pc-carga" id="pcDrop">
          <div><b>${PC ? "Cambiar archivo" : "Arrastra aquí el Programa de Cocinas"}</b><span>Se leen las hojas «Programa Cocinas», «EFICIENCIAS», «TIEMPOS» y «LIBERACION EQUIPOS». Todo queda en tu navegador.</span></div>
          <label class="btn ${PC ? "small" : "primary"}" for="pcFile">Elegir archivo .xlsx</label>
          <input type="file" id="pcFile" accept=".xlsx,.xlsm,.xls" hidden />
          <span id="pcEstado" class="pc-estado"></span>
        </div>
        <div id="pcCuerpo"></div>
      </div>
    </div>`;
  cont.innerHTML = carga;
  const inp = document.getElementById("pcFile");
  inp.addEventListener("change", (e) => e.target.files[0] && pcCargarArchivo(e.target.files[0]));
  const dz = document.getElementById("pcDrop");
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => (e.preventDefault(), dz.classList.add("drag"))));
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => (e.preventDefault(), dz.classList.remove("drag"))));
  dz.addEventListener("drop", (e) => e.dataTransfer.files[0] && pcCargarArchivo(e.dataTransfer.files[0]));
  if (!PC) return;
  if (!PCX.F) PCX.F = pcFiltrosIniciales();
  pcRenderCuerpo();
}

function pcCargarArchivo(file) {
  const est = document.getElementById("pcEstado");
  if (est) est.textContent = "Leyendo " + file.name + "…";
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), {
        type: "array",
        cellStyles: true,
        cellNF: true,
        sheets: ["Programa Cocinas", "EFICIENCIAS", "TIEMPOS", "LIBERACION EQUIPOS"],
      });
      // Con «sheets» SheetJS no trae los nombres de todas: se leen aparte.
      const todas = XLSX.read(new Uint8Array(e.target.result), { type: "array", bookSheets: true, bookProps: true });
      wb.SheetNames = todas.SheetNames;
      wb.Workbook = todas.Workbook || wb.Workbook;
      PC = pcLeerLibro(wb, file.name);
      PC_F = pcFiltrosIniciales(PC);
      PC_SEL = null;
      PC_PAG = 0;
      pcGuardar();
      renderProgramaCocinas();
      // Los cocimientos reales que todavía no aparecen en el Producto en
      // proceso cuentan como cerveza en proceso: el plan cambia con el archivo.
      if (typeof recompute === "function") recompute();
    } catch (err) {
      console.error(err);
      if (est) {
        est.textContent = "Error: " + err.message;
        est.classList.add("error");
      }
    }
  };
  reader.readAsArrayBuffer(file);
}

function pcRenderCuerpo() {
  // La vista del plan T-minus tiene su propio cuerpo (js/programa-feria.js).
  if (PCX !== PCX_EXCEL && typeof pfRenderCuerpo === "function") return pfRenderCuerpo();
  const cuerpo = document.getElementById("pcCuerpo");
  if (!cuerpo) return;
  const vis = PCX.D.filas.filter((x) => pcPasa(x));
  const coc = vis.filter((x) => x.tipo === "coc");
  const ev = vis.filter((x) => x.tipo === "evento");
  const dias = Math.max(1, (PCX.F.hasta - PCX.F.desde) / PC_D);
  const vol = coc.reduce((a, x) => a + ((x.ef && x.ef.volFrio) || 0), 0);
  const conVol = coc.filter((x) => x.ef && x.ef.volFrio).length;
  const efs = coc.map((x) => x.ef && x.ef.efSap).filter((v) => v > 50 && v < 150);
  const gaps = coc.map((x) => x.desdeAnterior).filter((g) => g > 0 && g < 12 * PC_H).sort((a, b) => a - b);
  const mediana = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
  const nAseo = ev.filter((x) => x.id === "aseo").length;
  const nParo = ev.filter((x) => x.id === "paro").length;
  const conNotas = vis.filter((x) => x.notas.length || x.comentarios.length).length;

  const kpis =
    modKpi("◉", "Cocimientos", MOD_NF(coc.length), `${MOD_NF(coc.length / dias, 1)} por día en el rango`) +
    modKpi("◍", "Mosto frío (real)", `${MOD_NF(vol)} <small>hL</small>`, `${conVol} de ${coc.length} con dato en EFICIENCIAS`) +
    modKpi("%", "Eficiencia SAP promedio", efs.length ? `${MOD_NF(efs.reduce((a, v) => a + v, 0) / efs.length, 1)} <small>%</small>` : "—", `${efs.length} cocimientos medidos`) +
    modKpi("⏱", "Tiempo típico entre cargues", mediana ? fmtHM(mediana / PC_MIN) : "—", "Mediana (sin contar huecos de 12 h o más)") +
    modKpi("⟲", "Aseos · paros", `${nAseo} <small>·</small> ${nParo}`, `${conNotas} filas con anotaciones o comentarios`);

  cuerpo.innerHTML = `
    ${pcHtmlFiltros()}
    <div class="acu-kpis">${kpis}</div>
    <div class="acu-card">
      <div class="acu-card-tit">Cocimientos por semana <small class="pc-sub">· clic en una semana para verla · el recuadro marca el rango elegido · desliza para moverte y acorta las semanas con la barra de abajo</small></div>
      <div id="pcSemanas" class="pc-chart"></div>
      ${pcLeyenda()}
    </div>
    ${typeof pdHtmlCard === "function" ? pdHtmlCard() : ""}
    <div class="pc-layout">
      <div class="acu-card">
        <div class="acu-card-tit">Mapa de cargues <small class="pc-sub">· una fila por día, de 00:00 a 24:00 · cada punto es un cargue · lo rayado es un aseo o paro · clic para ver todo el detalle${PCX.F.verDebio ? ' · <span class="pd-ley pd-ley-rombo"></span> rombo = cargue que debió darse (plan T-minus hacia atrás)' : ""}</small></div>
        <div id="pcMapa" class="pc-mapa"></div>
      </div>
      <div>
        <div class="acu-card" id="pcDetalle">${pcHtmlDetalle()}</div>
      </div>
    </div>
    <div class="vol-grid3">
      <div class="acu-card"><div class="acu-card-tit">Mezcla de mostos <small class="pc-sub">· clic para filtrar</small></div><div id="pcMix"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Equipos destino <small class="pc-sub">· clic para filtrar</small></div><div id="pcEquipos"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Eficiencia por semana <small class="pc-sub">· promedio SAP e INSQL, rango elegido</small></div><div id="pcEf" class="pc-chart"></div></div>
    </div>
    <div class="acu-card" style="margin-top:14px;">
      <div class="acu-card-tit">Todas las filas del rango (${vis.length.toLocaleString("es-CO")}) <small class="pc-sub">· con cada anotación del Excel</small></div>
      <div id="pcTabla"></div>
    </div>
    <div class="vol-grid3">
      <div class="acu-card pc-span2"><div class="acu-card-tit">Tiempos entre cargues al cambiar de marca <small class="pc-sub">· hoja TIEMPOS (estándar) vs. lo real en el rango (mediana)</small></div><div id="pcMatriz"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Tiempos de ciclo por mosto <small class="pc-sub">· hoja TIEMPOS</small></div><div id="pcTiempos"></div></div>
    </div>
    <div class="vol-grid3">
      <div class="acu-card pc-span2"><div class="acu-card-tit">Liberación de equipos en aseos de cocina <small class="pc-sub">· hoja LIBERACION EQUIPOS</small></div><div id="pcLiberacion"></div></div>
      <div class="acu-card"><div class="acu-card-tit">Hojas del archivo</div><div id="pcHojas"></div></div>
    </div>`;

  pcConectarFiltros();
  pcDibujarSemanas();
  if (typeof pdDibujar === "function")
    try {
      pdDibujar();
    } catch (e) {
      console.error(e);
      const el = document.getElementById("pdCuerpo");
      if (el) el.innerHTML = '<p class="empty-note">No se pudo calcular el programa que debió darse.</p>';
    }
  pcDibujarMapa(vis);
  pcDibujarMix(vis);
  pcDibujarEquipos(vis);
  pcDibujarEficiencia(coc);
  pcDibujarTabla(vis);
  pcDibujarMatriz(coc);
  pcDibujarTiempos();
  pcDibujarLiberacion();
  pcDibujarHojas();
}

function pcLeyenda() {
  return `<div class="legend pc-leyenda">${pcMostos().map((m) => `<div class="item"><span class="sw ${m.cls}"></span>${m.nombre}</div>`).join("")}${pcEventos().map((e) => `<div class="item"><span class="sw ${e.cls}"></span>${e.nombre}</div>`).join("")}</div>`;
}

function pcHtmlFiltros() {
  const f = PCX.F;
  const d2i = (ms) => new Date(ms).toISOString().slice(0, 10);
  const presets = [
    ["7", "Última semana"],
    ["28", "Últimas 4 semanas"],
    ["91", "Últimos 3 meses"],
    ["todo", "Todo el archivo"],
  ];
  const grupos = ["todos", ...((PCX.D && PCX.D.grupos) || ["Tanques TE", "Cubas 41–58", "SV Pony 1–5", "Formato / otros", "Sin equipo"])];
  return `<div class="pc-filtros">
    <div class="pc-fgrupo"><span class="pc-flab">Rango</span>
      ${presets.map(([k, l]) => `<button class="pc-chip" data-pc-preset="${k}">${l}</button>`).join("")}
      <input type="date" class="pc-fecha" id="pcDesde" value="${d2i(f.desde)}" min="${d2i(f.min)}" max="${d2i(f.max)}" aria-label="Desde">
      <span class="pc-flab">a</span>
      <input type="date" class="pc-fecha" id="pcHasta" value="${d2i(f.hasta - PC_D)}" min="${d2i(f.min)}" max="${d2i(f.max)}" aria-label="Hasta">
    </div>
    <div class="pc-fgrupo"><span class="pc-flab">Mostos</span>
      ${pcMostos().map((m) => `<button class="pc-chip pc-chip-m ${f.mostos.has(m.id) ? "on" : ""}" data-pc-mosto="${m.id}"><span class="pc-dot ${m.cls}"></span>${m.nombre}</button>`).join("")}
    </div>
    <div class="pc-fgrupo"><span class="pc-flab">Eventos</span>
      ${pcEventos().map((e) => `<button class="pc-chip pc-chip-m ${f.eventos.has(e.id) ? "on" : ""}" data-pc-evento="${e.id}"><span class="pc-dot ${e.cls}"></span>${e.nombre}</button>`).join("")}
      <span class="pc-flab" style="margin-left:10px;">Equipo</span>
      <select id="pcGrupo" class="pc-sel">${grupos.map((g) => `<option value="${g}" ${f.grupo === g ? "selected" : ""}>${g === "todos" ? "Todos los equipos" : g}</option>`).join("")}</select>
      ${f.equipo ? `<button class="pc-chip on" data-pc-quitar-equipo>Equipo ${escapeHtml(f.equipo)} ✕</button>` : ""}
      <input type="search" id="pcBuscar" class="pc-buscar" placeholder="${escapeHtml((PCX.D && PCX.D.buscarTxt) || "Buscar n.º, nota, levadura (TE4 J2), incidente…")}" value="${escapeHtml(f.texto)}">
      <label class="pc-flab pc-check"><input type="checkbox" id="pcSoloNotas" ${f.soloNotas ? "checked" : ""}> ${escapeHtml((PCX.D && PCX.D.notasTxt) || "Solo con anotaciones")}</label>
      <button class="pc-chip" data-pc-limpiar>Limpiar filtros</button>
    </div>
  </div>`;
}

function pcConectarFiltros() {
  const re = () => {
    PCX.PAG = 0;
    pcRenderCuerpo();
  };
  document.querySelectorAll("[data-pc-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.pcPreset;
      if (k === "todo") {
        PCX.F.desde = PCX.F.min;
        PCX.F.hasta = PCX.F.max;
      } else {
        PCX.F.hasta = PCX.F.max;
        PCX.F.desde = Math.max(PCX.F.min, PCX.F.max - Number(k) * PC_D);
      }
      re();
    }),
  );
  const fecha = (id, cb) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("change", () => {
        const v = el.value ? Date.parse(el.value + "T00:00:00Z") : NaN;
        if (!isNaN(v)) cb(v);
      });
  };
  fecha("pcDesde", (v) => {
    PCX.F.desde = v;
    if (PCX.F.hasta <= v) PCX.F.hasta = v + PC_D;
    re();
  });
  fecha("pcHasta", (v) => {
    PCX.F.hasta = v + PC_D;
    if (PCX.F.desde >= PCX.F.hasta) PCX.F.desde = v;
    re();
  });
  const toggle = (set, id) => (set.has(id) ? set.delete(id) : set.add(id));
  document.querySelectorAll("[data-pc-mosto]").forEach((b) => b.addEventListener("click", () => (toggle(PCX.F.mostos, b.dataset.pcMosto), re())));
  document.querySelectorAll("[data-pc-evento]").forEach((b) => b.addEventListener("click", () => (toggle(PCX.F.eventos, b.dataset.pcEvento), re())));
  const g = document.getElementById("pcGrupo");
  if (g) g.addEventListener("change", () => ((PCX.F.grupo = g.value), (PCX.F.equipo = ""), re()));
  const q = document.querySelector("[data-pc-quitar-equipo]");
  if (q) q.addEventListener("click", () => ((PCX.F.equipo = ""), re()));
  const s = document.getElementById("pcBuscar");
  if (s) {
    let t = null;
    s.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        PCX.F.texto = s.value.trim();
        re();
        const n = document.getElementById("pcBuscar");
        if (n) {
          n.focus();
          n.setSelectionRange(n.value.length, n.value.length);
        }
      }, 300);
    });
  }
  const sn = document.getElementById("pcSoloNotas");
  if (sn) sn.addEventListener("change", () => ((PCX.F.soloNotas = sn.checked), re()));
  const lim = document.querySelector("[data-pc-limpiar]");
  if (lim)
    lim.addEventListener("click", () => {
      const r = { desde: PCX.F.desde, hasta: PCX.F.hasta };
      PCX.F = pcFiltrosIniciales();
      Object.assign(PCX.F, r);
      re();
    });
}

/* ---- Cocimientos por semana (barras apiladas por mosto, todo el archivo) ----
   Con barra para desplazarse de izquierda a derecha y una ventana de
   semanas que se puede acortar (deslizador doble o los selectores): así no
   hay que ver todo el archivo apretado para revisar unas pocas semanas. */
function pcDibujarSemanas() {
  const el = document.getElementById("pcSemanas");
  if (!el) return;
  const porSem = new Map();
  PCX.D.filas.forEach((x) => {
    if (x.tipo !== "coc" || x.inicio == null || !pcPasa(x, true)) return;
    const s = semanaCalendario(x.inicio);
    if (!porSem.has(s)) porSem.set(s, {});
    const o = porSem.get(s);
    o[x.id] = (o[x.id] || 0) + 1;
  });
  // Semanas sin cocimientos también se muestran (huecos reales).
  const todas = [];
  for (let s = semanaCalendario(PCX.F.min); s < PCX.F.max; s += 7 * PC_D) todas.push(s);
  if (!todas.length) {
    el.innerHTML = '<p class="empty-note">Sin semanas en el archivo.</p>';
    return;
  }
  // Ventana visible (índices en «todas»). Por defecto, todo el archivo.
  const v = PCX.F.semVista || { i0: 0, i1: todas.length - 1 };
  v.i0 = Math.max(0, Math.min(todas.length - 1, v.i0));
  v.i1 = Math.max(v.i0, Math.min(todas.length - 1, v.i1));
  PCX.F.semVista = v;
  const vis = todas.slice(v.i0, v.i1 + 1);
  const H = 190;
  const m = { t: 10, b: 34 };
  const ih = H - m.t - m.b;
  const tot = (o) => Object.values(o || {}).reduce((a, x) => a + x, 0);
  const max = Math.max(10, ...vis.map((s) => tot(porSem.get(s))));
  const ancho = Math.max(300, (el.clientWidth || 900) - 40);
  // Cada semana tiene al menos 22 px: si no caben, aparece la barra.
  const paso = Math.max(22, ancho / vis.length);
  const W = Math.ceil(paso * vis.length) + 8;
  const bw = Math.max(2, paso - 3);
  const y = (val) => m.t + ih - (val / max) * ih;
  const ticks = [0, Math.round(max / 2), max];
  let eje = "";
  ticks.forEach((t) => (eje += `<text x="30" y="${y(t) + 3}" class="pc-ax" text-anchor="end">${t}</text>`));
  let svg = "";
  ticks.forEach((t) => (svg += `<line x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="pc-grid"/>`));
  // Rango elegido (filtros de arriba), en coordenadas de la ventana.
  const iR0 = (semanaCalendario(PCX.F.desde) - vis[0]) / (7 * PC_D);
  const iR1 = (semanaCalendario(PCX.F.hasta - 1) - vis[0]) / (7 * PC_D) + 1;
  const xr0 = Math.max(0, iR0 * paso);
  const xr1 = Math.min(W, iR1 * paso);
  if (xr1 > xr0) svg += `<rect x="${xr0}" y="${m.t - 4}" width="${Math.max(2, xr1 - xr0)}" height="${ih + 8}" class="pc-rango"/>`;
  const cadaEtq = paso >= 40 ? 1 : paso >= 28 ? 2 : 3;
  vis.forEach((s, i) => {
    const o = porSem.get(s) || {};
    let acum = 0;
    const x0 = i * paso + 1.5;
    const ms = pcMostos();
    ms.forEach((mo, k) => {
      const val = o[mo.id] || 0;
      if (!val) return;
      const y1 = y(acum + val);
      const y0 = y(acum);
      svg += `<rect x="${x0}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1 - (acum > 0 ? 2 : 0))}" rx="${k === ms.length - 1 ? 2 : 0}" class="${mo.cls}"/>`;
      acum += val;
    });
    if (i % cadaEtq === 0) {
      const d = new Date(s);
      svg += `<text x="${x0 + bw / 2}" y="${H - m.b + 14}" class="pc-ax" text-anchor="middle">S${pcSemanaIso(s)}</text><text x="${x0 + bw / 2}" y="${H - m.b + 26}" class="pc-ax" text-anchor="middle">${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}</text>`;
    }
    svg += `<rect x="${i * paso}" y="${m.t}" width="${paso}" height="${ih}" class="pc-hit" data-sem="${s}"/>`;
  });
  const etq = (s) => `S${pcSemanaIso(s)} · ${fmtDate(new Date(s))}`;
  const opts = (sel) => todas.map((s, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${escapeHtml(etq(s))}</option>`).join("");
  el.innerHTML = `
    <div class="pc-semctl">
      <span class="pc-flab">Ver semanas</span>
      <select class="pc-sel" data-semv="i0">${opts(v.i0)}</select><span class="pc-flab">→</span><select class="pc-sel" data-semv="i1">${opts(v.i1)}</select>
      <button class="pc-chip" data-semv-preset="todo">Todo</button>
      <button class="pc-chip" data-semv-preset="12">Últimas 12</button>
      <button class="pc-chip" data-semv-preset="rango">Alrededor del rango</button>
      <span class="pc-sub">${vis.length} de ${todas.length} semanas</span>
    </div>
    <div class="pc-semwrap">
      <svg class="pc-semeje" width="34" height="${H}" viewBox="0 0 34 ${H}" aria-hidden="true">${eje}</svg>
      <div class="pc-semscroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cocimientos por semana">${svg}</svg></div>
    </div>
    <div class="pc-dualfila">
      <button class="pc-chip pc-mover" data-semmover="-1" title="Mover la ventana una semana a la izquierda" ${v.i0 === 0 ? "disabled" : ""}>◀</button>
      <div class="pc-dual" style="--a:${todas.length > 1 ? (v.i0 / (todas.length - 1)) * 100 : 0}%;--b:${todas.length > 1 ? (v.i1 / (todas.length - 1)) * 100 : 100}%">
        <div class="pc-dual-banda" title="Arrastra para moverte sin cambiar cuántas semanas ves"></div>
        <input type="range" min="0" max="${todas.length - 1}" value="${v.i0}" data-semr="i0" aria-label="Primera semana visible">
        <input type="range" min="0" max="${todas.length - 1}" value="${v.i1}" data-semr="i1" aria-label="Última semana visible">
      </div>
      <button class="pc-chip pc-mover" data-semmover="1" title="Mover la ventana una semana a la derecha" ${v.i1 === todas.length - 1 ? "disabled" : ""}>▶</button>
    </div>`;
  const sc = el.querySelector(".pc-semscroll");
  // Mostrar el rango elegido: si queda fuera de la vista, se desplaza hasta él.
  if (sc && xr1 > xr0 && (xr0 < sc.scrollLeft || xr1 > sc.scrollLeft + sc.clientWidth)) sc.scrollLeft = Math.max(0, xr0 - 40);
  else if (sc && PCX.F.semScroll != null) sc.scrollLeft = PCX.F.semScroll;
  if (sc) sc.addEventListener("scroll", () => (PCX.F.semScroll = sc.scrollLeft));
  const redibujar = () => {
    PCX.F.semScroll = null;
    pcDibujarSemanas();
  };
  el.querySelectorAll("[data-semv]").forEach((sel) =>
    sel.addEventListener("change", () => {
      v[sel.dataset.semv] = Number(sel.value);
      if (v.i0 > v.i1) sel.dataset.semv === "i0" ? (v.i1 = v.i0) : (v.i0 = v.i1);
      redibujar();
    }),
  );
  el.querySelectorAll("[data-semr]").forEach((r) =>
    r.addEventListener("input", () => {
      const k = r.dataset.semr;
      v[k] = Number(r.value);
      if (v.i0 > v.i1) k === "i0" ? (v.i0 = v.i1) : (v.i1 = v.i0);
      clearTimeout(PCX.F.semT);
      PCX.F.semT = setTimeout(redibujar, 60);
    }),
  );
  // Desplazar la ventana (mismo número de semanas) a izquierda o derecha.
  const desplazar = (d) => {
    const largo = v.i1 - v.i0;
    const n0 = Math.max(0, Math.min(todas.length - 1 - largo, v.i0 + d));
    if (n0 === v.i0) return false;
    v.i0 = n0;
    v.i1 = n0 + largo;
    return true;
  };
  el.querySelectorAll("[data-semmover]").forEach((b) =>
    b.addEventListener("click", () => desplazar(Number(b.dataset.semmover)) && redibujar()),
  );
  const banda = el.querySelector(".pc-dual-banda");
  if (banda && todas.length > 1)
    banda.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const pista = banda.parentElement.getBoundingClientRect();
      const porSemanaPx = Math.max(1, pista.width / (todas.length - 1));
      const x0 = ev.clientX;
      const base = v.i0;
      banda.setPointerCapture && banda.setPointerCapture(ev.pointerId);
      const mover = (e) => {
        const d = Math.round((e.clientX - x0) / porSemanaPx);
        if (desplazar(base + d - v.i0)) {
          clearTimeout(PCX.F.semT);
          PCX.F.semT = setTimeout(redibujar, 40);
        }
      };
      const soltar = () => {
        banda.removeEventListener("pointermove", mover);
        banda.removeEventListener("pointerup", soltar);
        banda.removeEventListener("pointercancel", soltar);
      };
      banda.addEventListener("pointermove", mover);
      banda.addEventListener("pointerup", soltar);
      banda.addEventListener("pointercancel", soltar);
    });
  el.querySelectorAll("[data-semv-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.semvPreset;
      if (k === "todo") (v.i0 = 0), (v.i1 = todas.length - 1);
      else if (k === "12") (v.i1 = todas.length - 1), (v.i0 = Math.max(0, todas.length - 12));
      else {
        const a = todas.findIndex((s) => s >= semanaCalendario(PCX.F.desde));
        const z = todas.findIndex((s) => s > PCX.F.hasta - 1);
        v.i0 = Math.max(0, (a < 0 ? 0 : a) - 4);
        v.i1 = Math.min(todas.length - 1, (z < 0 ? todas.length - 1 : z - 1) + 4);
      }
      redibujar();
    }),
  );
  el.querySelectorAll("[data-sem]").forEach((r) => {
    const s = Number(r.dataset.sem);
    r.addEventListener("pointermove", (ev) => {
      const o = porSem.get(s) || {};
      const lineas = pcMostos()
        .filter((mo) => o[mo.id])
        .map((mo) => ({ v: String(o[mo.id]), l: mo.nombre, cls: mo.cls }));
      pcMostrarTip(ev, `Semana ${pcSemanaIso(s)} · desde ${fmtDate(new Date(s))} — ${tot(o)} cocimientos`, lineas.length ? lineas : [{ v: "0", l: "cocimientos" }]);
    });
    r.addEventListener("pointerleave", pcOcultarTip);
    r.addEventListener("click", () => {
      PCX.F.desde = Math.max(PCX.F.min, s);
      PCX.F.hasta = Math.min(PCX.F.max, s + 7 * PC_D);
      PCX.PAG = 0;
      pcRenderCuerpo();
    });
  });
}

/* ---- Mapa de cargues: días × horas ---- */
function pcDibujarMapa(vis) {
  const el = document.getElementById("pcMapa");
  if (!el) return;
  const nd = Math.round((PCX.F.hasta - PCX.F.desde) / PC_D);
  const rowH = nd <= 21 ? 24 : nd <= 45 ? 16 : nd <= 120 ? 9 : 5;
  const W = Math.max(520, el.clientWidth || 800);
  const m = { l: 74, r: 8, t: 22 };
  const iw = W - m.l - m.r;
  const H = m.t + nd * rowH + 6;
  const xh = (h) => m.l + (h / 24) * iw;
  let svg = "";
  for (let h = 0; h <= 24; h += 2) {
    svg += `<line x1="${xh(h)}" x2="${xh(h)}" y1="${m.t - 4}" y2="${H}" class="pc-grid"/>`;
    svg += `<text x="${xh(h)}" y="${m.t - 8}" class="pc-ax" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
  }
  // Turnos de la planta (22-06, 06-14, 14-22) como bandas muy tenues.
  svg += `<rect x="${xh(6)}" y="${m.t}" width="${xh(14) - xh(6)}" height="${nd * rowH}" class="pc-turno"/>`;
  for (let i = 0; i < nd; i++) {
    const d = PCX.F.desde + i * PC_D;
    const dow = new Date(d).getUTCDay();
    const yy = m.t + i * rowH;
    if (dow === 0 || dow === 6) svg += `<rect x="${m.l}" y="${yy}" width="${iw}" height="${rowH}" class="pc-finde"/>`;
    if (rowH >= 9 || dow === 1) svg += `<text x="${m.l - 6}" y="${yy + rowH / 2 + 3}" class="pc-ax ${dow === 1 ? "pc-lunes" : ""}" text-anchor="end">${fmtDate(new Date(d))}</text>`;
    if (dow === 1) svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="pc-sem"/>`;
  }
  const idx = new Map(PCX.D.filas.map((x, i) => [x, i]));
  // Eventos (fondo rayado), partidos por día si cruzan medianoche.
  vis.filter((x) => x.tipo === "evento").forEach((x) => {
    let a = Math.max(x.inicio, PCX.F.desde);
    const b = Math.min(x.fin != null ? x.fin : x.inicio + PC_H, PCX.F.hasta);
    while (a < b) {
      const dia = medianocheMs(new Date(a));
      const z = Math.min(b, dia + PC_D);
      const fila = Math.round((dia - PCX.F.desde) / PC_D);
      const h0 = (a - dia) / PC_H;
      const h1 = (z - dia) / PC_H;
      svg += `<rect x="${xh(h0)}" y="${m.t + fila * rowH + 1}" width="${Math.max(2, xh(h1) - xh(h0))}" height="${rowH - 2}" class="pc-ev ${pcClaseDe(x)} ${PCX.SEL === idx.get(x) ? "pc-selm" : ""}" data-pc-i="${idx.get(x)}"/>`;
      a = z;
    }
  });
  // Cargues.
  const r = rowH >= 16 ? 5 : rowH >= 9 ? 3.5 : 0;
  vis.filter((x) => x.tipo !== "evento").forEach((x) => {
    const dia = medianocheMs(new Date(x.inicio));
    const fila = Math.round((dia - PCX.F.desde) / PC_D);
    if (fila < 0 || fila >= nd) return;
    const h = (x.inicio - dia) / PC_H;
    const cx = xh(h);
    const cy = m.t + fila * rowH + rowH / 2;
    const sel = PCX.SEL === idx.get(x) ? " pc-selm" : "";
    const marca = x.notas.length || x.comentarios.length ? " pc-anot" : "";
    svg += r
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" class="pc-pt ${pcClaseDe(x)}${sel}${marca}"/>`
      : `<rect x="${cx - 1}" y="${cy - rowH / 2 + 0.5}" width="2.5" height="${rowH - 1}" class="pc-pt ${pcClaseDe(x)}${sel}"/>`;
    // Zona de clic más grande que la marca.
    svg += `<rect x="${cx - 7}" y="${cy - Math.max(7, rowH / 2)}" width="14" height="${Math.max(14, rowH)}" class="pc-hit" data-pc-i="${idx.get(x)}"/>`;
  });
  // Excel: rombos con lo que debió darse según el plan T-minus hacia atrás.
  if (PCX === PCX_EXCEL && typeof pdMarcasMapa === "function") svg += pdMarcasMapa(xh, m, rowH, nd);
  el.innerHTML = nd > 0 ? `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mapa de cargues por día y hora" class="${rowH < 9 ? "pc-compacto" : ""}">${svg}</svg>` : '<p class="empty-note">Sin días en el rango.</p>';
  el.querySelectorAll("[data-pd-tip]").forEach((n) => {
    n.addEventListener("pointermove", (ev) => pcMostrarTip(ev, n.dataset.pdTip, []));
    n.addEventListener("pointerleave", pcOcultarTip);
  });
  el.querySelectorAll("[data-pc-i]").forEach((n) => {
    const x = PCX.D.filas[Number(n.dataset.pcI)];
    n.addEventListener("pointermove", (ev) => pcTipFila(ev, x));
    n.addEventListener("pointerleave", pcOcultarTip);
    n.addEventListener("click", () => pcSeleccionar(Number(n.dataset.pcI)));
  });
}

function pcSeleccionar(i) {
  PCX.SEL = i;
  const d = document.getElementById("pcDetalle");
  if (d) d.innerHTML = pcHtmlDetalle();
  pcConectarDetalle();
  document.querySelectorAll(".pc-selm").forEach((n) => n.classList.remove("pc-selm"));
  document.querySelectorAll(`#pcMapa [data-pc-i="${i}"]`).forEach((n) => {
    const prev = n.previousElementSibling;
    if (n.classList.contains("pc-hit") && prev) prev.classList.add("pc-selm");
    else n.classList.add("pc-selm");
  });
  document.querySelectorAll("#pcTabla tr.sel").forEach((t) => t.classList.remove("sel"));
  const tr = document.querySelector(`#pcTabla tr[data-pc-i="${i}"]`);
  if (tr) tr.classList.add("sel");
  if (window.innerWidth < 1100 && d) d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function pcHtmlDetalle() {
  if (PCX !== PCX_EXCEL && typeof pfHtmlDetalle === "function") return pfHtmlDetalle();
  if (PCX.SEL == null || !PCX.D.filas[PCX.SEL])
    return `<div class="acu-card-tit">Detalle</div><p class="empty-note">Haz clic en un punto del mapa, en una franja rayada o en una fila de la tabla para ver todo lo que el Excel dice de ese cocimiento o evento.</p>
      <div class="pc-ayuda"><div><span class="pc-dot pc-c1"></span>Punto = cargue de un cocimiento (color = mosto)</div><div><span class="pc-dot pc-aseo"></span>Franja rayada = aseo o paro entre dos cargues</div><div><span class="pc-anot-demo"></span>Punto con aro = tiene anotaciones en el Excel</div><div>Bandas: fines de semana más oscuros; la franja clara es el turno 06–14.</div></div>`;
  const x = PCX.D.filas[PCX.SEL];
  const fila = (k, v) => (v == null || v === "" ? "" : `<div class="pc-dl"><span>${k}</span><b>${v}</b></div>`);
  const nota = (nn) => {
    const v = nn.tipo === "fecha" ? pcFecha(nn.v) : nn.tipo === "duracion" ? fmtHM(nn.v) + " h" : nn.tipo === "numero" ? MOD_NF(nn.v, Number.isInteger(nn.v) ? 0 : 2) : escapeHtml(String(nn.v));
    return `<div class="pc-nota"><span class="pc-col">${nn.col}</span><div>${v}${nn.formula ? ' <small class="pc-sub">(calculado en el Excel)</small>' : ""}</div></div>`;
  };
  const e = x.ef || {};
  const vecinos = (dir) => {
    for (let j = PCX.SEL + dir; j >= 0 && j < PCX.D.filas.length; j += dir) if (pcPasa(PCX.D.filas[j], true) && PCX.D.filas[j].inicio != null) return j;
    return null;
  };
  const ant = vecinos(-1);
  const sig = vecinos(1);
  return `<div class="acu-card-tit pc-det-tit"><span class="pc-dot ${pcClaseDe(x)}"></span>${x.n != null ? "Cocimiento #" + x.n : pcNombreDe(x)}
      <span class="pc-nav"><button class="btn small" data-pc-nav="${ant}" ${ant == null ? "disabled" : ""}>◀</button><button class="btn small" data-pc-nav="${sig}" ${sig == null ? "disabled" : ""}>▶</button></span></div>
    <div class="pc-orig">${escapeHtml(x.texto)}</div>
    ${fila("Tipo", pcNombreDe(x))}
    ${fila(x.tipo === "coc" ? "Cargue (D)" : x.fechaPropia ? "Fecha (D)" : "Ubicación", x.tipo === "coc" || x.fechaPropia ? pcFecha(x.inicio) : x.entre ? `entre el cargue #${x.entre[0]} (${pcFecha(x.inicio)}) y el #${x.entre[1]} (${pcFecha(x.fin)})` : pcFecha(x.inicio))}
    ${x.entre ? fila("Hueco en la cocina", fmtHM(x.hueco / PC_MIN) + " h") : ""}
    ${fila("Duración (E)", x.durMin != null ? fmtHM(x.durMin) + " h" : "")}
    ${x.tipo === "coc" ? fila("Fin (F)", pcFecha(x.fin)) : ""}
    ${fila("Equipo destino (G)", x.equipo ? `${escapeHtml(x.equipo)} <small class="pc-sub">· ${escapeHtml(x.grupo)}</small> <button class="pc-mini" data-pc-equipo="${escapeHtml(x.equipo)}">filtrar</button>` : "")}
    ${x.lev ? fila("Levadura", `${x.lev.tanque}${x.lev.lote ? " · lote " + x.lev.lote : ""} <button class="pc-mini" data-pc-buscar="${x.lev.tanque}${x.lev.lote ? " " + x.lev.lote : ""}">ver otros</button>`) : ""}
    ${x.desdeAnterior ? fila("Desde el cargue anterior", fmtHM(x.desdeAnterior / PC_MIN) + " h" + (x.mostoAnterior && x.mostoAnterior !== x.id ? ` <small class="pc-sub">(venía de ${escapeHtml((pcMostos().find((m) => m.id === x.mostoAnterior) || {}).nombre || "")})</small>` : "")) : ""}
    ${x.colores.length ? fila("Resaltado en el Excel", x.colores.map((c) => `<span class="pc-swatch" style="background:${c}" title="${c}"></span>`).join(" ")) : ""}
    ${fila("Fila en el Excel", String(x.fila))}
    ${x.ef ? `<div class="pc-sec">EFICIENCIAS</div>${fila("Volumen mosto frío", e.volFrio != null ? MOD_NF(e.volFrio) + " hL" : "—")}${fila("Extracto maceración", e.extMac != null ? MOD_NF(e.extMac, 2) + " °P" : "—")}${fila("Extracto al llenar", e.extLlenar != null ? MOD_NF(e.extLlenar, 2) + " °P" : "—")}${fila("Mosto débil", e.mostoDebil != null ? MOD_NF(e.mostoDebil, 1) + " hL" : "—")}${fila("Eficiencia INSQL", e.efInsql != null ? MOD_NF(e.efInsql, 2) + " %" : "—")}${fila("Eficiencia SAP", e.efSap != null ? MOD_NF(e.efSap, 2) + " %" : "—")}` : x.tipo === "coc" ? '<div class="pc-sec">EFICIENCIAS</div><p class="empty-note">Sin datos de laboratorio para este cocimiento (aún no se ha cocinado o no está en la hoja).</p>' : ""}
    <div class="pc-sec">Anotaciones (columnas H en adelante)</div>
    ${x.notas.length ? x.notas.map(nota).join("") : '<p class="empty-note">Sin anotaciones.</p>'}
    ${x.comentarios.length ? `<div class="pc-sec">Comentarios de celda</div>${x.comentarios.map((c) => `<div class="pc-nota"><span class="pc-col">${c.col}</span><div>${escapeHtml(c.txt)}${c.autor ? ` <small class="pc-sub">— ${escapeHtml(c.autor)}</small>` : ""}</div></div>`).join("")}` : ""}`;
}
function pcConectarDetalle() {
  // Del plan T-minus: abrir el cocimiento en «Del cocimiento al envasado».
  document.querySelectorAll("[data-pf-trz]").forEach((b) =>
    b.addEventListener("click", () => {
      if (typeof TRZ !== "undefined") TRZ.sel = b.dataset.pfTrz;
    }),
  );
  document.querySelectorAll("[data-pc-nav]").forEach((b) => b.addEventListener("click", () => b.dataset.pcNav !== "null" && pcSeleccionar(Number(b.dataset.pcNav))));
  document.querySelectorAll("[data-pc-equipo]").forEach((b) =>
    b.addEventListener("click", () => {
      PCX.F.equipo = b.dataset.pcEquipo;
      PCX.F.grupo = "todos";
      pcRenderCuerpo();
    }),
  );
  document.querySelectorAll("[data-pc-buscar]").forEach((b) =>
    b.addEventListener("click", () => {
      PCX.F.texto = b.dataset.pcBuscar;
      PCX.F.desde = PCX.F.min;
      PCX.F.hasta = PCX.F.max;
      pcRenderCuerpo();
    }),
  );
}

/* ---- Mezcla de mostos ---- */
function pcDibujarMix(vis) {
  const el = document.getElementById("pcMix");
  if (!el) return;
  const cnt = {};
  vis.forEach((x) => x.tipo === "coc" && (cnt[x.id] = (cnt[x.id] || 0) + 1));
  const tot = Object.values(cnt).reduce((a, v) => a + v, 0);
  // Barra única 100 % apilada + lista con valores (identidad también por texto).
  el.innerHTML =
    `<div class="pc-mixbar">${pcMostos().filter((m) => cnt[m.id]).map((m) => `<span class="${m.cls}" style="flex:${cnt[m.id]}" data-pc-m="${m.id}"></span>`).join("")}</div>` +
    `<div class="pc-mixlist">${pcMostos().map((m) => {
      const v = cnt[m.id] || 0;
      const on = PCX.F.mostos.has(m.id);
      return `<button class="pc-mixrow ${on ? "" : "off"}" data-pc-m="${m.id}"><span class="pc-dot ${m.cls}"></span><span class="l">${m.nombre}</span><b>${MOD_NF(v)}</b><span class="p">${tot ? Math.round((v / tot) * 100) : 0}%</span></button>`;
    }).join("")}</div>`;
  el.querySelectorAll("[data-pc-m]").forEach((b) => {
    const m = pcMostos().find((mm) => mm.id === b.dataset.pcM);
    b.addEventListener("pointermove", (ev) => pcMostrarTip(ev, m.nombre, [{ v: MOD_NF(cnt[m.id] || 0), l: "cocimientos en el rango", cls: m.cls }]));
    b.addEventListener("pointerleave", pcOcultarTip);
    b.addEventListener("click", () => {
      // Clic = ver solo ese mosto; clic otra vez = volver a todos.
      const solo = PCX.F.mostos.size === 1 && PCX.F.mostos.has(m.id);
      PCX.F.mostos = solo ? new Set(pcMostos().map((x) => x.id)) : new Set([m.id]);
      pcRenderCuerpo();
    });
  });
}

/* ---- Equipos destino ---- */
function pcDibujarEquipos(vis) {
  const el = document.getElementById("pcEquipos");
  if (!el) return;
  const cnt = {};
  vis.forEach((x) => {
    if (x.tipo !== "coc") return;
    const k = x.equipo || "(vacío)";
    cnt[k] = cnt[k] || { n: 0, g: x.grupo };
    cnt[k].n++;
  });
  const lista = Object.entries(cnt).sort((a, b) => b[1].n - a[1].n);
  const max = Math.max(1, ...lista.map((x) => x[1].n));
  el.innerHTML = lista.length
    ? `<div class="pc-eqs">${lista
        .map(
          ([k, o]) =>
            `<button class="pc-eq ${PCX.F.equipo === k ? "on" : ""}" data-pc-eq="${escapeHtml(k)}" title="${escapeHtml(o.g)}"><span class="l">${escapeHtml(k)}</span><span class="t"><span style="width:${(o.n / max) * 100}%"></span></span><b>${o.n}</b></button>`,
        )
        .join("")}</div>`
    : '<p class="empty-note">Sin cocimientos en el rango.</p>';
  el.querySelectorAll("[data-pc-eq]").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.pcEq;
      PCX.F.equipo = PCX.F.equipo === k || k === "(vacío)" ? "" : k;
      PCX.F.grupo = "todos";
      pcRenderCuerpo();
    }),
  );
}

/* ---- Eficiencia por semana (una sola escala: %) ---- */
function pcDibujarEficiencia(coc) {
  const el = document.getElementById("pcEf");
  if (!el) return;
  const porSem = new Map();
  coc.forEach((x) => {
    if (!x.ef) return;
    const s = semanaCalendario(x.inicio);
    const o = porSem.get(s) || { sap: [], insql: [] };
    if (x.ef.efSap > 50 && x.ef.efSap < 150) o.sap.push(x.ef.efSap);
    if (x.ef.efInsql > 50 && x.ef.efInsql < 150) o.insql.push(x.ef.efInsql);
    porSem.set(s, o);
  });
  const sem = [...porSem.keys()].sort((a, b) => a - b).filter((s) => porSem.get(s).sap.length || porSem.get(s).insql.length);
  if (!sem.length) {
    el.innerHTML = '<p class="empty-note">Sin datos de eficiencia en el rango.</p>';
    return;
  }
  const prom = (a) => (a.length ? a.reduce((x, v) => x + v, 0) / a.length : null);
  const serie = sem.map((s) => ({ s, sap: prom(porSem.get(s).sap), insql: prom(porSem.get(s).insql), n: porSem.get(s).sap.length }));
  const vals = serie.flatMap((p) => [p.sap, p.insql]).filter((v) => v != null);
  const lo = Math.floor(Math.min(...vals) - 1);
  const hi = Math.ceil(Math.max(...vals) + 1);
  const W = Math.max(280, el.clientWidth || 360);
  const H = 190;
  const m = { l: 36, r: 10, t: 12, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (i) => m.l + (sem.length === 1 ? iw / 2 : (i / (sem.length - 1)) * iw);
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  let svg = "";
  [lo, (lo + hi) / 2, hi].forEach((t) => (svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="pc-grid"/><text x="${m.l - 5}" y="${y(t) + 3}" class="pc-ax" text-anchor="end">${MOD_NF(t)}</text>`));
  const linea = (k, cls) => {
    const pts = serie.map((p, i) => (p[k] != null ? `${x(i)},${y(p[k])}` : null)).filter(Boolean);
    return `<polyline points="${pts.join(" ")}" class="pc-line ${cls}"/>` + serie.map((p, i) => (p[k] != null ? `<circle cx="${x(i)}" cy="${y(p[k])}" r="3" class="pc-ldot ${cls}"/>` : "")).join("");
  };
  svg += linea("insql", "pc-l2") + linea("sap", "pc-l1");
  const cada = Math.ceil(serie.length / 6);
  serie.forEach((p, i) => i % cada === 0 && (svg += `<text x="${x(i)}" y="${H - 8}" class="pc-ax" text-anchor="middle">S${pcSemanaIso(p.s)}</text>`));
  svg += `<line class="pc-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" class="pc-hit pc-efhit"/>`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Eficiencia por semana">${svg}</svg>
    <div class="legend pc-leyenda" style="border:none;padding:6px 0 0;"><div class="item"><span class="pc-lkey pc-l1"></span>Eficiencia SAP</div><div class="item"><span class="pc-lkey pc-l2"></span>Eficiencia INSQL</div></div>`;
  const hit = el.querySelector(".pc-efhit");
  const cross = el.querySelector(".pc-cross");
  hit.addEventListener("pointermove", (ev) => {
    const r = hit.getBoundingClientRect();
    const fx = ((ev.clientX - r.left) / r.width) * iw;
    const i = sem.length === 1 ? 0 : Math.max(0, Math.min(sem.length - 1, Math.round((fx / iw) * (sem.length - 1))));
    cross.setAttribute("x1", x(i));
    cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    const p = serie[i];
    pcMostrarTip(ev, `Semana ${pcSemanaIso(p.s)} · ${p.n} cocimientos medidos`, [
      { v: p.sap != null ? MOD_NF(p.sap, 2) + " %" : "—", l: "SAP", cls: "pc-l1" },
      { v: p.insql != null ? MOD_NF(p.insql, 2) + " %" : "—", l: "INSQL", cls: "pc-l2" },
    ]);
  });
  hit.addEventListener("pointerleave", () => (pcOcultarTip(), cross.setAttribute("visibility", "hidden")));
}

/* ---- Tabla completa (paginada, todas las columnas) ---- */
function pcDibujarTabla(vis) {
  const el = document.getElementById("pcTabla");
  if (!el) return;
  const POR = 100;
  const pags = Math.max(1, Math.ceil(vis.length / POR));
  PCX.PAG = Math.min(PCX.PAG, pags - 1);
  const idx = new Map(PCX.D.filas.map((x, i) => [x, i]));
  const filas = vis
    .slice(PCX.PAG * POR, PCX.PAG * POR + POR)
    .map((x) => {
      const e = x.ef || {};
      const notas = x.notas
        .map((nn) => `<span class="pc-tn"><i>${nn.col}</i>${nn.tipo === "fecha" ? pcFecha(nn.v) : nn.tipo === "duracion" ? fmtHM(nn.v) : escapeHtml(String(nn.tipo === "numero" ? MOD_NF(nn.v, Number.isInteger(nn.v) ? 0 : 2) : nn.v))}</span>`)
        .concat(x.comentarios.map((c) => `<span class="pc-tn pc-tc"><i>💬${c.col}</i>${escapeHtml(c.txt)}</span>`))
        .join("");
      return `<tr data-pc-i="${idx.get(x)}" class="${PCX.SEL === idx.get(x) ? "sel" : ""}">
        <td class="num">${x.fila}</td><td class="num">${x.n != null ? x.n : ""}</td>
        <td><span class="pc-dot ${pcClaseDe(x)}"></span>${escapeHtml(x.texto)}${x.colores.length ? ` <span class="pc-swatch" style="background:${x.colores[0]}" title="Resaltado en el Excel"></span>` : ""}</td>
        <td>${x.tipo === "coc" || x.fechaPropia ? pcFecha(x.inicio) : `<small class="pc-sub">entre #${x.entre ? x.entre.join(" y #") : "—"}</small>`}</td>
        <td class="num">${x.durMin != null ? fmtHM(x.durMin) : x.hueco ? `<small class="pc-sub">${fmtHM(x.hueco / PC_MIN)}</small>` : ""}</td>
        <td>${x.tipo === "coc" ? pcFecha(x.fin) : ""}</td>
        <td>${escapeHtml(x.equipo)}</td>
        <td>${x.lev ? `${x.lev.tanque}${x.lev.lote ? " " + x.lev.lote : ""}` : ""}</td>
        <td class="num">${e.volFrio != null ? MOD_NF(e.volFrio) : ""}</td>
        <td class="num">${e.extMac != null ? MOD_NF(e.extMac, 2) : ""}</td>
        <td class="num">${e.extLlenar != null ? MOD_NF(e.extLlenar, 2) : ""}</td>
        <td class="num">${e.mostoDebil != null ? MOD_NF(e.mostoDebil, 1) : ""}</td>
        <td class="num">${e.efInsql != null ? MOD_NF(e.efInsql, 2) : ""}</td>
        <td class="num">${e.efSap != null ? MOD_NF(e.efSap, 2) : ""}</td>
        <td class="pc-notas">${notas}</td>
      </tr>`;
    })
    .join("");
  el.innerHTML = `<div class="table-scroll" style="max-height:520px;"><table class="pc-tabla"><thead><tr>
      <th class="num">Fila</th><th class="num">#</th><th>Mosto / evento (C)</th><th>Cargue (D)</th><th class="num">Dur. (E)</th><th>Fin (F)</th><th>Equipo (G)</th><th>Levadura</th>
      <th class="num" title="Volumen mosto frío (EFICIENCIAS)">hL frío</th><th class="num" title="Extracto maceración °P">Ext. mac.</th><th class="num" title="Extracto al llenar °P">Ext. llenar</th><th class="num" title="Mosto débil">M. débil</th><th class="num">EF INSQL</th><th class="num">EF SAP</th><th>Anotaciones (H→) y comentarios</th>
    </tr></thead><tbody>${filas || '<tr><td colspan="15"><p class="empty-note">Ninguna fila cumple los filtros.</p></td></tr>'}</tbody></table></div>
    <div class="pc-pag"><button class="btn small" data-pc-pag="-1" ${PCX.PAG === 0 ? "disabled" : ""}>◀ Anteriores</button><span>Página ${PCX.PAG + 1} de ${pags} · filas ${vis.length ? PCX.PAG * POR + 1 : 0}–${Math.min(vis.length, (PCX.PAG + 1) * POR)} de ${vis.length}</span><button class="btn small" data-pc-pag="1" ${PCX.PAG >= pags - 1 ? "disabled" : ""}>Siguientes ▶</button></div>`;
  el.querySelectorAll("tr[data-pc-i]").forEach((tr) => tr.addEventListener("click", () => pcSeleccionar(Number(tr.dataset.pcI))));
  el.querySelectorAll("[data-pc-pag]").forEach((b) =>
    b.addEventListener("click", () => {
      PCX.PAG += Number(b.dataset.pcPag);
      pcDibujarTabla(vis);
    }),
  );
}

/* ---- Matriz de tiempos entre cargues ---- */
function pcDibujarMatriz(coc) {
  const el = document.getElementById("pcMatriz");
  if (!el) return;
  const mz = PCX.D.tiempos && PCX.D.tiempos.matriz;
  if (!mz) {
    el.innerHTML = '<p class="empty-note">La hoja TIEMPOS no trae la matriz de cambios.</p>';
    return;
  }
  // Nombre de la hoja TIEMPOS → mosto del programa (solo donde es inequívoco).
  const mapa = (s) => {
    const n = normalizeText(s);
    if (/light/.test(n)) return "light";
    if (/estandar/.test(n)) return "estandar";
    if (/pilsen/.test(n)) return "pilsen";
    if (/club/.test(n)) return "club";
    if (/pony\s*hg/.test(n)) return "ponyhg";
    return null;
  };
  const real = {};
  coc.forEach((x) => {
    if (!x.desdeAnterior || !x.mostoAnterior || x.desdeAnterior > 12 * PC_H) return;
    const k = x.mostoAnterior + ">" + x.id;
    (real[k] = real[k] || []).push(x.desdeAnterior / PC_MIN);
  });
  const med = (a) => {
    if (!a || !a.length) return null;
    const s = a.slice().sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const todos = mz.filas.flatMap((f) => f.valores).filter((v) => v != null);
  const lo = Math.min(...todos);
  const hi = Math.max(...todos);
  const celda = (v, desde, hasta) => {
    if (v == null) return '<td class="pc-mz vac">—</td>';
    const a = mapa(desde);
    const b = mapa(hasta);
    const r = a && b ? med(real[a + ">" + b]) : null;
    const nReal = a && b && real[a + ">" + b] ? real[a + ">" + b].length : 0;
    const t = hi > lo ? (v - lo) / (hi - lo) : 0;
    return `<td class="pc-mz" style="--t:${t.toFixed(2)}" title="De ${escapeHtml(desde)} a ${escapeHtml(hasta)} · estándar ${fmtHM(v)} h${r != null ? ` · real ${fmtHM(r)} h (${nReal} cambios)` : ""}"><b>${fmtHM(v)}</b>${r != null ? `<small>real ${fmtHM(r)}</small>` : ""}</td>`;
  };
  el.innerHTML = `<div class="table-scroll mod-noclip"><table class="pc-matriz"><thead><tr><th>De ↓ / A →</th>${mz.destinos.map((d) => `<th>${escapeHtml(d)}</th>`).join("")}</tr></thead><tbody>${mz.filas
    .map((f) => `<tr><th>${escapeHtml(f.desde)}</th>${f.valores.map((v, i) => celda(v, f.desde, mz.destinos[i])).join("")}</tr>`)
    .join("")}</tbody></table></div><p class="acu-nota">Horas:minutos entre un cargue y el siguiente cuando cambia la marca (incluye el aseo cuando aplica). Más oscuro = más tiempo. «real» = mediana en el rango elegido, solo donde la marca de la hoja corresponde sin duda a un mosto del programa.</p>`;
}

function pcDibujarTiempos() {
  const el = document.getElementById("pcTiempos");
  if (!el) return;
  const t = PCX.D.tiempos || { mostos: [], cambios: [] };
  el.innerHTML =
    `<div class="table-scroll mod-noclip"><table class="pc-tabla"><thead><tr><th>Código</th><th>Mosto</th><th class="num">Ciclo</th><th class="num">Vol.</th><th class="num">Entre cargues</th></tr></thead><tbody>${t.mostos
      .map((m) => `<tr><td>${escapeHtml(String(m.codigo || ""))}</td><td>${escapeHtml(m.mosto)}</td><td class="num">${escapeHtml(m.ciclo)}</td><td class="num">${m.volumen != null ? MOD_NF(m.volumen) : ""}</td><td class="num">${escapeHtml(m.cargues)}</td></tr>`)
      .join("")}</tbody></table></div>` +
    (t.cambios.length
      ? `<details class="pc-det"><summary class="pc-sec">Cambios con y sin aseo (${t.cambios.length})</summary><div class="table-scroll mod-noclip"><table class="pc-tabla"><tbody>${t.cambios
          .map((c) => `<tr><td>${escapeHtml(c.de)}</td><td>${escapeHtml(c.tipo)}</td><td>${escapeHtml(c.a)}</td><td class="num">${c.horas != null ? fmtHM(c.horas) : ""}</td><td><small class="pc-sub">${escapeHtml(c.nota)}</small></td></tr>`)
          .join("")}</tbody></table></div></details>`
      : "");
}

function pcDibujarLiberacion() {
  const el = document.getElementById("pcLiberacion");
  if (!el) return;
  const L = PCX.D.liberacion || [];
  if (!L.length) {
    el.innerHTML = '<p class="empty-note">El archivo no trae secuencias de liberación.</p>';
    return;
  }
  el.innerHTML = `<div class="pc-lib">${L.map((s) => {
    const t0 = Math.min(...s.pasos.map((p) => p.inicio));
    const t1 = Math.max(...s.pasos.map((p) => p.fin || p.inicio));
    const span = Math.max(1, t1 - t0);
    return `<div class="pc-lib-s"><div class="pc-sec">${escapeHtml(s.titulo)} <small class="pc-sub">· ${pcFecha(t0)} → ${pcFecha(t1)} (${fmtHM((t1 - t0) / PC_MIN)} h)</small></div>${s.pasos
      .map(
        (p) =>
          `<div class="pc-lib-r" title="${escapeHtml(p.nota)}"><span class="l">${escapeHtml(p.equipo)}</span><span class="t"><span style="left:${((p.inicio - t0) / span) * 100}%;width:${Math.max(1, (((p.fin || p.inicio) - p.inicio) / span) * 100)}%"></span></span><span class="v">${pcFecha(p.inicio).split(" ").slice(-1)[0]}–${p.fin ? pcFecha(p.fin).split(" ").slice(-1)[0] : "?"}</span></div>`,
      )
      .join("")}</div>`;
  }).join("")}</div><p class="acu-nota">Cada equipo queda «listo para mantenimiento» al terminar su tramo.</p>`;
}

function pcDibujarHojas() {
  const el = document.getElementById("pcHojas");
  if (!el) return;
  const notas = {
    "PROGRAMA MODULACION": "fórmulas con #REF! (vínculo roto)",
    "Consumos Vapor formatos": "fórmulas con #REF! (vínculo roto)",
    "Programa PRO": "copia anterior del programa (hasta abril)",
  };
  el.innerHTML = `<div class="pc-hojas">${(PCX.D.hojas || [])
    .map(
      (h) =>
        `<div class="pc-hoja ${h.usada ? "usada" : ""}"><span>${h.usada ? "✓" : h.oculta ? "◌" : "○"}</span><b>${escapeHtml(h.nombre)}</b><small>${h.usada ? "se muestra aquí" : h.oculta ? "oculta en el Excel" : notas[h.nombre] || "no se usa"}</small></div>`,
    )
    .join("")}</div>`;
}

// Redibujar al cambiar el ancho (los SVG se ajustan al contenedor).
let PC_RESIZE = null;
window.addEventListener("resize", () => {
  clearTimeout(PC_RESIZE);
  PC_RESIZE = setTimeout(() => {
    const v = document.getElementById("view-programa-cocinas");
    const vf = document.getElementById("view-programa-feria");
    if (PCX === PCX_EXCEL && PC && PC_F && v && !v.classList.contains("nav-hide")) pcRenderCuerpo();
    else if (PCX !== PCX_EXCEL && PCX.D && PCX.F && vf && !vf.classList.contains("nav-hide")) pcRenderCuerpo();
  }, 250);
});
