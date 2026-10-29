/* =========================================================================
   SETPOINTS DE VAPOR (CALDERAS) Y AIRE COMPRIMIDO
   -------------------------------------------------------------------------
   El operador de Utilities necesita saber, con el plan de envasado y el de
   cocinas, a qué presión debe dejar sus equipos en cada momento. Las reglas
   (y los PSI) las define Utilities:

   VAPOR
     · Línea 8 envasando ............................. 75 PSI
     · Cualquier otra línea envasando, sin la 8 ...... 65 PSI
     · Ninguna línea envasando y la cocina trabajando  60 PSI
     · Ninguna línea y la cocina parada .............. sin requerimiento
       (no está definido: se muestra así y se puede poner un PSI en la tabla)
   AIRE
     · Con cocinas (algún cocimiento en proceso) ..... 75 PSI
     · Sin cocinas y con PET envasando ............... 70 PSI
     · Sin cocinas y sin PET ......................... 60 PSI

   Definiciones
     · «Línea envasando» = bloque de producción del Gantt. DPA y NST NO cuentan,
       igual que en Utilidades.
     · «PET» = algún tren envasando un SKU PET (envaseDeSKU del catálogo).
     · «Cocina trabajando» = hay al menos un cocimiento entre su cargue y su fin.
       Los aseos de cocina cuentan como cocina PARADA (lo definió Utilities).
     · Las cocinas salen del plan T-minus (programación calculada) o del plan real
       del área de Cocinas (Excel «Programa Cocinas»), según el selector. Fuera
       del rango que cubre ese plan no se sabe si la cocina trabaja: el tramo
       sale como «sin plan de cocinas» en vez de inventar un setpoint.
   ========================================================================= */

const SP_LS_KEY = "planSetpoints";
const SP_DEFECTO = {
  psi: {
    vaporL8: 75,
    vaporOtras: 65,
    vaporSoloCocinas: 60,
    vaporNada: null, // sin línea ni cocina: no definido
    aireCocinas: 75,
    aireSinCocinasPet: 70,
    aireSinCocinasSinPet: 60,
  },
  fuente: "feria", // "feria" | "real"
};
const SP_ETIQUETAS = {
  vaporL8: ["Vapor", "Línea 8 envasando"],
  vaporOtras: ["Vapor", "Otra línea envasando (sin la 8)"],
  vaporSoloCocinas: ["Vapor", "Sin líneas · cocina trabajando"],
  vaporNada: ["Vapor", "Sin líneas · cocina parada"],
  aireCocinas: ["Aire", "Con cocinas"],
  aireSinCocinasPet: ["Aire", "Sin cocinas · con PET"],
  aireSinCocinasSinPet: ["Aire", "Sin cocinas · sin PET"],
};
// Escala secuencial de UN tono (azul): más oscuro = más PSI. Los colores viven en
// style.css (variables --sp-0 … --sp-3, distintas en tema oscuro y claro); aquí
// solo se decide qué escalón le toca a cada PSI.
const SP_ESCALONES = 4;
let SP_FILTRO = { dia: "todos", turno: "todos" };

function spConfig() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(SP_LS_KEY) || "null");
  } catch (_) {}
  const c = JSON.parse(JSON.stringify(SP_DEFECTO));
  if (g && typeof g === "object") {
    if (g.psi)
      Object.keys(c.psi).forEach((k) => {
        if (g.psi[k] === null || g.psi[k] === "") c.psi[k] = k === "vaporNada" ? null : c.psi[k];
        else if (isFinite(Number(g.psi[k])) && Number(g.psi[k]) > 0) c.psi[k] = Number(g.psi[k]);
      });
    if (g.fuente === "real" || g.fuente === "feria") c.fuente = g.fuente;
  }
  return c;
}
function spGuardar(c) {
  try {
    localStorage.setItem(SP_LS_KEY, JSON.stringify(c));
  } catch (_) {}
}

// Intervalos en que la cocina trabaja, según la fuente elegida. Devuelve también
// el rango que cubre ese plan, para no inventar setpoints fuera de él.
function spCocinas(fuentePedida) {
  const deFeria = () => {
    const rows = ((STATE && STATE.seq && STATE.seq.rows) || []).filter((r) => r.tipo === "cocimiento" && r.start && r.end);
    if (!rows.length) return null;
    const i0 = (typeof getI0Date === "function" && getI0Date()) || rows[0].start;
    const i0ms = i0.getTime();
    const out = {
      fuente: "feria",
      nombre: "Plan T-minus (programación calculada)",
      intervalos: rows.map((r) => [r.start.getTime(), r.end.getTime()]),
      cobertura: [Math.min(i0ms, ...rows.map((r) => r.start.getTime())), Math.max(...rows.map((r) => r.end.getTime()))],
    };
    // ANTES DEL I0 el plan T-minus no existe: lo que pasó en la cocina es lo del
    // Programa de Cocinas real. Si está cargado y cubre ese tramo, se usa para
    // él (cocimientos que arrancaron antes del I0, recortados al I0). Antes
    // ese tramo salía «?» en el aire y el vapor.
    const fs = ((typeof PC !== "undefined" && PC && PC.filas) || []).filter((x) => x.tipo === "coc" && x.inicio != null && x.fin != null);
    if (fs.length) {
      const iniReal = Math.min(...fs.map((x) => x.inicio));
      if (iniReal < out.cobertura[0]) {
        fs.filter((x) => x.inicio < i0ms).forEach((x) => out.intervalos.push([x.inicio, Math.min(x.fin, i0ms)]));
        out.cobertura[0] = iniReal;
        out.nombre = `Plan T-minus desde el I0 · Programa de Cocinas real antes (${PC.archivo || "Excel"})`;
      }
    }
    return out;
  };
  const deReal = () => {
    if (typeof PC !== "undefined" && !PC && typeof pcRecuperar === "function") pcRecuperar();
    const fs = ((typeof PC !== "undefined" && PC && PC.filas) || []).filter((x) => x.tipo === "coc" && x.inicio != null && x.fin != null);
    if (!fs.length) return null;
    return {
      fuente: "real",
      nombre: `Plan real de Cocinas (${PC.archivo || "Excel"})`,
      intervalos: fs.map((x) => [x.inicio, x.fin]),
      cobertura: [Math.min(...fs.map((x) => x.inicio)), Math.max(...fs.map((x) => x.fin))],
    };
  };
  const pedido = fuentePedida === "real" ? deReal() : deFeria();
  if (pedido) return { ...pedido, aviso: "" };
  const otro = fuentePedida === "real" ? deFeria() : deReal();
  if (otro)
    return {
      ...otro,
      aviso:
        fuentePedida === "real"
          ? "No hay plan real de Cocinas cargado (módulo «Programa de cocinas (Excel)»): se usa el plan T-minus."
          : "No hay plan T-minus calculado: se usa el plan real de Cocinas.",
    };
  return { fuente: null, nombre: "Sin plan de cocinas", intervalos: [], cobertura: null, aviso: "No hay ningún plan de cocinas: el aire y el vapor sin líneas quedan sin definir." };
}

// Cálculo puro: tramos de setpoint de vapor y aire + lista de cambios.
function calcularSetpoints(mergedByTrain, cfg) {
  cfg = cfg || spConfig();
  const P = cfg.psi;
  const coc = spCocinas(cfg.fuente);
  const bloques = [];
  TRAINS.forEach((t) =>
    (mergedByTrain[t] || []).forEach((b) => {
      if (b && b.start && b.end && b.end > b.start) bloques.push({ ...b, train: t });
    }),
  );
  if (!bloques.length) return { vapor: [], aire: [], cambios: [], coc };
  // Mismos huecos cortos que en Utilidades: no son paradas (ver utilidades.js).
  if (typeof utilPuentearHuecos === "function") {
    const p = utilPuentearHuecos(bloques, (b) => b.type === "production");
    bloques.length = 0;
    p.forEach((b) => bloques.push(b));
  }
  const desde = Math.min(...bloques.map((b) => b.start.getTime()));
  const hasta = Math.max(...bloques.map((b) => b.end.getTime()));
  const prod = bloques.filter((b) => b.type === "production");
  const marcas = new Set([desde, hasta]);
  prod.forEach((b) => (marcas.add(b.start.getTime()), marcas.add(b.end.getTime())));
  coc.intervalos.forEach(([a, z]) => (marcas.add(a), marcas.add(z)));
  if (coc.cobertura) (marcas.add(coc.cobertura[0]), marcas.add(coc.cobertura[1]));
  const ts = [...marcas].filter((t) => t >= desde && t <= hasta).sort((a, b) => a - b);

  const tramosV = [];
  const tramosA = [];
  const empujar = (lista, a, z, r) => {
    const prev = lista[lista.length - 1];
    if (prev && prev.psi === r.psi && !!prev.desconocido === !!r.desconocido && prev.end === a) {
      prev.end = z;
      if (!prev.motivos.includes(r.motivo)) prev.motivos.push(r.motivo);
    } else lista.push({ start: a, end: z, psi: r.psi, desconocido: !!r.desconocido, motivo: r.motivo, motivos: [r.motivo] });
  };
  for (let i = 0; i < ts.length - 1; i++) {
    const a = ts[i];
    const z = ts[i + 1];
    if (z <= a) continue;
    const enCurso = prod.filter((b) => b.start.getTime() <= a && b.end.getTime() >= z);
    const lineas = [...new Set(enCurso.map((b) => b.train))].sort();
    const l8 = lineas.includes("8");
    const pet = enCurso.some((b) => envaseDeSKU(b.name || b.codigo) === "pet");
    const cubierto = coc.cobertura && a >= coc.cobertura[0] && z <= coc.cobertura[1];
    const cocinando = coc.intervalos.some(([x, y]) => x <= a && y >= z);

    // VAPOR: manda la línea 8; sin líneas manda la cocina.
    let v;
    if (l8) v = { psi: P.vaporL8, motivo: "L8 envasando" };
    else if (lineas.length) v = { psi: P.vaporOtras, motivo: `L${lineas.join(", L")} envasando (sin L8)` };
    else if (!cubierto) v = { psi: null, desconocido: true, motivo: "sin líneas · sin plan de cocinas para este tramo" };
    else if (cocinando) v = { psi: P.vaporSoloCocinas, motivo: "sin líneas · cocina trabajando" };
    else v = { psi: P.vaporNada, motivo: "sin líneas · cocina parada" };
    empujar(tramosV, a, z, v);

    // AIRE: manda la cocina; sin cocinas manda el PET.
    let ai;
    if (!cubierto) ai = { psi: null, desconocido: true, motivo: "sin plan de cocinas para este tramo" };
    else if (cocinando) ai = { psi: P.aireCocinas, motivo: "cocina trabajando" };
    else if (pet) ai = { psi: P.aireSinCocinasPet, motivo: "sin cocinas · PET envasando" };
    else ai = { psi: P.aireSinCocinasSinPet, motivo: "sin cocinas · sin PET" };
    empujar(tramosA, a, z, ai);
  }

  const cambios = [];
  const anotar = (lista, equipo) =>
    lista.forEach((t, i) => {
      if (i === 0) return;
      const p = lista[i - 1];
      if (p.psi === t.psi && p.desconocido === t.desconocido) return;
      cambios.push({ ms: t.start, equipo, de: p.desconocido ? null : p.psi, a: t.desconocido ? null : t.psi, aDesconocido: t.desconocido, deDesconocido: p.desconocido, motivo: t.motivo });
    });
  anotar(tramosV, "Calderas (vapor)");
  anotar(tramosA, "Aire comprimido");
  cambios.sort((x, y) => x.ms - y.ms || x.equipo.localeCompare(y.equipo));
  return { vapor: tramosV, aire: tramosA, cambios, coc };
}

// Escalón de la rampa (0 = más claro … 3 = más oscuro) según el orden del PSI
// entre todos los PSI configurados.
function spEscalon(psi, cfg) {
  const vals = [...new Set(Object.values(cfg.psi).filter((v) => v != null))].sort((a, b) => a - b);
  const i = vals.indexOf(psi);
  if (i < 0) return 0;
  return vals.length <= 1 ? SP_ESCALONES - 1 : Math.round((i / (vals.length - 1)) * (SP_ESCALONES - 1));
}
function spClase(psi, desconocido, cfg) {
  if (desconocido) return "sp-desc";
  if (psi == null) return "sp-nada";
  return "sp-n" + spEscalon(psi, cfg);
}
function spTxtPsi(psi, desconocido) {
  if (desconocido) return "?";
  return psi == null ? "—" : `${psi} PSI`;
}
// Fecha con año cuando no es el año en curso (el Excel de Cocinas arranca el año anterior).
function spFmtCob(ms) {
  const d = new Date(ms);
  return fmtDateTime(d) + (d.getUTCFullYear() !== new Date().getFullYear() ? ` de ${d.getUTCFullYear()}` : "");
}
// Día de planeación (arranca a las 22:00 del día anterior) y turno de un instante.
function spDiaPlaneacion(ms) {
  return medianocheMs(new Date(ms + 2 * 3600000));
}
function spTurno(ms) {
  const h = new Date(ms).getUTCHours();
  return h >= 22 || h < 6 ? "T1" : h < 14 ? "T2" : "T3";
}

// Huella de las cocinas usadas en el último dibujo: si al volver al Gantt cambió
// (se cargó otro Excel de Cocinas o se recalculó el plan), hay que redibujar.
let SP_ULTIMA_FIRMA = "";
function spFirma() {
  const cfg = spConfig();
  const pc = typeof PC !== "undefined" && PC ? `${PC.archivo || ""}|${(PC.filas || []).length}` : "";
  const sq = STATE && STATE.seq && STATE.seq.rows ? STATE.seq.rows.length + "|" + (STATE.seq.rows[0] && STATE.seq.rows[0].start ? STATE.seq.rows[0].start.getTime() : "") : "";
  return `${cfg.fuente}#${pc}#${sq}`;
}
function spNecesitaRedibujar() {
  if (typeof PC !== "undefined" && !PC && typeof pcRecuperar === "function") pcRecuperar();
  return spFirma() !== SP_ULTIMA_FIRMA;
}

/* ---- Filas del Gantt de envasado (misma escala que los trenes) ---- */
function htmlFilasSetpoints(mergedByTrain, rangeStart, totalWidth, dayLinesHtml) {
  const cfg = spConfig();
  SP_ULTIMA_FIRMA = spFirma();
  const sp = calcularSetpoints(mergedByTrain, cfg);
  if (!sp.vapor.length && !sp.aire.length) return "";
  const rs = rangeStart.getTime();
  const px = (ms) => ((ms - rs) / 3600000) * GANTT_PX_PER_HOUR;
  const barras = (tramos, equipo) =>
    tramos
      .map((t) => {
        const left = px(t.start);
        const width = Math.max(3, px(t.end) - left);
        const dur = fmtDuration(t.end - t.start);
        const title = escapeHtml(`${equipo}: ${spTxtPsi(t.psi, t.desconocido)} · ${fmtDateTime(new Date(t.start))} → ${fmtDateTime(new Date(t.end))} (${dur}) · ${t.motivos.join(" / ")}`);
        const cls = spClase(t.psi, t.desconocido, cfg);
        // El valor siempre va escrito: completo si cabe, solo el número si el tramo
        // es angosto; el motivo solo cuando sobra espacio (y siempre en el tooltip).
        const psiTxt = t.desconocido ? "?" : t.psi == null ? "—" : width >= 66 ? `${t.psi} PSI` : String(t.psi);
        const txt = width >= 22 ? `<b>${escapeHtml(psiTxt)}</b>${width >= 170 ? `<span>${escapeHtml(t.motivo)}</span>` : ""}` : "";
        return `<div class="block sp-block ${cls}" style="left:${left}px;width:${width}px;" title="${title}">${txt}</div>`;
      })
      .join("");
  // Rombo en cada cambio de setpoint.
  const rombos = (equipo) =>
    sp.cambios
      .filter((c) => c.equipo === equipo)
      .map((c) => `<div class="sp-rombo" style="left:${px(c.ms)}px" title="${escapeHtml(`Cambio ${fmtDateTime(new Date(c.ms))}: ${c.deDesconocido ? "?" : c.de ?? "—"} → ${c.aDesconocido ? "?" : c.a ?? "—"} PSI · ${c.motivo}`)}"></div>`)
      .join("");
  const fila = (label, sub, tramos, equipo) => `
        <div class="gantt-row util-row sp-row">
          <div class="lane-label">${label}<small>${sub}</small></div>
          <div class="lane-track" style="width:${totalWidth}px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}</div>
            ${barras(tramos, equipo)}${rombos(equipo)}
          </div>
        </div>`;
  return `
        <div class="gantt-row util-sep">
          <div class="lane-label">SETPOINTS</div>
          <div class="util-sep-track sp-sep-track" style="width:${totalWidth}px;"><span>Cocinas: ${escapeHtml(sp.coc.nombre)}${sp.coc.cobertura ? ` · cubre ${escapeHtml(spFmtCob(sp.coc.cobertura[0]))} → ${escapeHtml(spFmtCob(sp.coc.cobertura[1]))} (fuera de eso: «?»)` : ""}${sp.coc.aviso ? " · ⚠ " + escapeHtml(sp.coc.aviso) : ""}</span></div>
        </div>
        ${fila("VAPOR", "PSI", sp.vapor, "Calderas (vapor)")}
        ${fila("AIRE", "PSI", sp.aire, "Aire comprimido")}`;
}

/* ---- Leyenda: la rampa con los PSI configurados ---- */
function htmlLeyendaSetpoints() {
  const cfg = spConfig();
  const vals = [...new Set(Object.values(cfg.psi).filter((v) => v != null))].sort((a, b) => a - b);
  return (
    `<div class="item"><b class="util-ctl-label">Setpoint (PSI)</b></div>` +
    vals.map((v) => `<div class="item"><span class="sw sp-sw ${spClase(v, false, cfg)}">${v}</span></div>`).join("") +
    `<div class="item"><span class="sw sp-nada"></span>Sin requerimiento</div>` +
    `<div class="item"><span class="sw sp-desc"></span>Sin plan de cocinas</div>` +
    `<div class="item"><span class="sp-rombo-ley"></span>Cambio de setpoint</div>`
  );
}

/* ---- Panel del operador: configuración + cambios de setpoint ---- */
function htmlPanelSetpoints(mergedByTrain) {
  const cfg = spConfig();
  const sp = calcularSetpoints(mergedByTrain, cfg);
  const dias = [...new Set(sp.cambios.map((c) => spDiaPlaneacion(c.ms)))].sort((a, b) => a - b);
  if (SP_FILTRO.dia !== "todos" && !dias.includes(Number(SP_FILTRO.dia))) SP_FILTRO.dia = "todos";
  const lista = spCambiosFiltrados(sp);
  const psiTxt = (v, d) => (d ? "?" : v == null ? "—" : String(v));
  const filas = lista.length
    ? lista
        .map(
          (c) => `<tr>
          <td>${escapeHtml(fmtDateTime(new Date(c.ms)))}</td>
          <td><span class="sp-turno">${spTurno(c.ms)}</span></td>
          <td>${escapeHtml(c.equipo)}</td>
          <td class="acu-c"><span class="sp-psi ${spClase(c.de, c.deDesconocido, cfg)}">${psiTxt(c.de, c.deDesconocido)}</span> → <span class="sp-psi ${spClase(c.a, c.aDesconocido, cfg)}">${psiTxt(c.a, c.aDesconocido)}</span></td>
          <td class="rec-imp">${escapeHtml(c.motivo)}</td>
        </tr>`,
        )
        .join("")
    : '<tr><td colspan="5"><p class="empty-note">Sin cambios de setpoint en el filtro elegido.</p></td></tr>';
  const conf = Object.keys(SP_ETIQUETAS)
    .map((k) => {
      const [eq, cond] = SP_ETIQUETAS[k];
      const v = cfg.psi[k];
      return `<tr><td>${eq}</td><td class="rec-imp">${cond}</td><td class="acu-c"><input type="number" class="acu-pond sp-in" data-sp-psi="${k}" min="1" step="1" value="${v == null ? "" : v}" placeholder="—" title="${k === "vaporNada" ? "Vacío = sin requerimiento (no definido)" : "PSI"}"> PSI</td></tr>`;
    })
    .join("");
  return `
    <div class="sp-panel" id="spPanel">
      <div class="sp-head">
        <b class="util-title">Setpoints para el operador</b>
        <span class="util-ctl"><span class="util-ctl-label">Cocinas según</span>
          <button type="button" class="btn small ${cfg.fuente === "feria" ? "primary" : ""}" data-sp-fuente="feria">Plan T-minus</button>
          <button type="button" class="btn small ${cfg.fuente === "real" ? "primary" : ""}" data-sp-fuente="real">Plan real (Excel)</button>
        </span>
        ${sp.coc.aviso ? `<span class="sp-aviso">⚠ ${escapeHtml(sp.coc.aviso)}</span>` : `<span class="util-note">Usando: ${escapeHtml(sp.coc.nombre)}</span>`}
      </div>
      <div class="sp-grid">
        <div class="acu-card">
          <div class="acu-card-tit">Cambios de setpoint (${lista.length})
            <span class="sp-filtros">
              <select class="pc-sel" data-sp-filtro="dia"><option value="todos">Todos los días</option>${dias.map((d) => `<option value="${d}" ${String(SP_FILTRO.dia) === String(d) ? "selected" : ""}>${escapeHtml(fmtDate(new Date(d)))}</option>`).join("")}</select>
              <select class="pc-sel" data-sp-filtro="turno">${[["todos", "Todos los turnos"], ["T1", "T1 · 22–06"], ["T2", "T2 · 06–14"], ["T3", "T3 · 14–22"]].map(([v, l]) => `<option value="${v}" ${SP_FILTRO.turno === v ? "selected" : ""}>${l}</option>`).join("")}</select>
              <button type="button" class="btn small" data-sp-csv>⬇ CSV</button>
              <button type="button" class="btn small" data-sp-imprimir>🖨 Imprimir</button>
            </span>
          </div>
          <div class="table-scroll" style="max-height:340px;"><table class="acu-tabla sp-tabla"><thead><tr><th>Fecha y hora</th><th>Turno</th><th>Equipo</th><th class="acu-c">De → A (PSI)</th><th>Motivo</th></tr></thead><tbody>${filas}</tbody></table></div>
          <p class="acu-nota">Día de planeación: de 22:00 del día anterior a 21:59. «?» = no hay plan de cocinas para ese tramo. «—» = sin requerimiento definido.</p>
        </div>
        <div class="acu-card">
          <div class="acu-card-tit">Setpoints definidos por Utilities</div>
          <table class="acu-tabla sp-conf"><tbody>${conf}</tbody></table>
          <p class="acu-nota">DPA y NST no cuentan como línea envasando. Los aseos de cocina cuentan como cocina parada. PET = algún tren envasando un SKU PET. Los valores se guardan en este navegador.</p>
          <button type="button" class="btn small" data-sp-reset>Restaurar valores</button>
        </div>
      </div>
    </div>`;
}

function spCambiosFiltrados(sp) {
  return sp.cambios.filter(
    (c) => (SP_FILTRO.dia === "todos" || spDiaPlaneacion(c.ms) === Number(SP_FILTRO.dia)) && (SP_FILTRO.turno === "todos" || spTurno(c.ms) === SP_FILTRO.turno),
  );
}

function conectarPanelSetpoints(mergedByTrain, redibujar) {
  const panel = document.getElementById("spPanel");
  if (!panel) return;
  panel.querySelectorAll("[data-sp-fuente]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = spConfig();
      c.fuente = b.dataset.spFuente;
      spGuardar(c);
      redibujar();
    }),
  );
  panel.querySelectorAll("[data-sp-psi]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const c = spConfig();
      const v = inp.value.trim();
      c.psi[inp.dataset.spPsi] = v === "" ? null : Number(v) > 0 ? Number(v) : c.psi[inp.dataset.spPsi];
      if (c.psi[inp.dataset.spPsi] == null && inp.dataset.spPsi !== "vaporNada") c.psi[inp.dataset.spPsi] = SP_DEFECTO.psi[inp.dataset.spPsi];
      spGuardar(c);
      redibujar();
    }),
  );
  const reset = panel.querySelector("[data-sp-reset]");
  if (reset)
    reset.addEventListener("click", () => {
      const c = spConfig();
      c.psi = { ...SP_DEFECTO.psi };
      spGuardar(c);
      redibujar();
    });
  panel.querySelectorAll("[data-sp-filtro]").forEach((s) =>
    s.addEventListener("change", () => {
      SP_FILTRO[s.dataset.spFiltro] = s.value;
      redibujar();
    }),
  );
  const filasExport = () => {
    const sp = calcularSetpoints(mergedByTrain, spConfig());
    return spCambiosFiltrados(sp).map((c) => [
      fmtDateTime(new Date(c.ms)),
      spTurno(c.ms),
      c.equipo,
      c.deDesconocido ? "?" : c.de == null ? "sin requerimiento" : c.de,
      c.aDesconocido ? "?" : c.a == null ? "sin requerimiento" : c.a,
      c.motivo,
    ]);
  };
  const csv = panel.querySelector("[data-sp-csv]");
  if (csv)
    csv.addEventListener("click", () => {
      const filas = [["Fecha y hora", "Turno", "Equipo", "De (PSI)", "A (PSI)", "Motivo"], ...filasExport()];
      const txt = "﻿" + filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
      a.download = "cambios_setpoint.csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 500);
    });
  const imp = panel.querySelector("[data-sp-imprimir]");
  if (imp)
    imp.addEventListener("click", () => {
      const filas = filasExport();
      const w = window.open("", "_blank");
      if (!w) return;
      const fil = `${SP_FILTRO.dia === "todos" ? "Todos los días" : fmtDate(new Date(Number(SP_FILTRO.dia)))} · ${SP_FILTRO.turno === "todos" ? "todos los turnos" : SP_FILTRO.turno}`;
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>Cambios de setpoint</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{color:#555;font-size:12px;margin:0 0 14px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#eee}td.n{font-weight:700;text-align:center}</style></head><body><h1>Cambios de setpoint — Utilities</h1><p>${escapeHtml(fil)} · Cocinas: ${escapeHtml(spCocinas(spConfig().fuente).nombre)} · Generado ${escapeHtml(new Date().toLocaleString("es-CO"))}</p><table><thead><tr><th>Fecha y hora</th><th>Turno</th><th>Equipo</th><th>De (PSI)</th><th>A (PSI)</th><th>Motivo</th><th>Hecho ✓</th></tr></thead><tbody>${filas
          .map((f) => `<tr>${f.map((v, i) => `<td${i === 3 || i === 4 ? ' class="n"' : ""}>${escapeHtml(String(v))}</td>`).join("")}<td></td></tr>`)
          .join("")}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`,
      );
      w.document.close();
    });
}
