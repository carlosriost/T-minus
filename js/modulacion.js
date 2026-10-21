/* =========================================================================
   MODULACIÓN DE LÍNEAS — paradas y arranques de lavadora, agua y paster
   -------------------------------------------------------------------------
   El instructivo es el seguimiento de la LLENADORA: si dice que la línea
   arranca a las 7:00, la llenadora arranca a las 7:00; igual con la parada.

   Hay PARADA cuando la llenadora deja de envasar:
     · por un DPA que dura 2 h o más (varios DPA seguidos cuentan juntos:
       «cambio de líquido 1:30 + inicio de producción 1:00» = 2:30), o
     · por no haber programación 2 h o más (NST «Sin programación», o
       horas sin ninguna fila en el instructivo).
   Un tramo sin envasar que mezcla DPA y sin programación, sin que ninguna de
   las dos partes llegue a 2 h, NO se toma como parada: se lista aparte
   para revisar. Un DPA escrito dentro de un turno de producción no detiene
   la llenadora (el instructivo la tiene envasando).

   Con la hora en que PARA la llenadora (P) y en que ARRANCA (A):
     arranque · lavadora A − 3 h · agua A · paster A + 1 h
     parada   · lavadora P − 1 h · agua P · paster P + 1 h
   Los tiempos se ajustan en el panel y se guardan en este navegador.
   ========================================================================= */

const MODL_LS_KEY = "planModulacion";
const MODL_DEFECTO = {
  umbralMin: 120,
  arranque: { lavadora: -180, agua: 0, paster: 60 },
  parada: { lavadora: -60, agua: 0, paster: 60 },
};
const MODL_EQUIPOS = [
  ["lavadora", "Lavadora"],
  ["agua", "Agua"],
  ["paster", "Paster"],
];
let MODL_FILTRO = { tren: "todos", dia: "todos" };

function modlConfig() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(MODL_LS_KEY) || "null");
  } catch (_) {}
  const c = JSON.parse(JSON.stringify(MODL_DEFECTO));
  if (g && typeof g === "object") {
    if (Number(g.umbralMin) > 0) c.umbralMin = Number(g.umbralMin);
    ["arranque", "parada"].forEach((k) =>
      MODL_EQUIPOS.forEach(([e]) => {
        const v = g[k] && g[k][e];
        if (v != null && isFinite(Number(v))) c[k][e] = Number(v);
      }),
    );
  }
  return c;
}
function modlGuardar(c) {
  try {
    localStorage.setItem(MODL_LS_KEY, JSON.stringify(c));
  } catch (_) {}
}

const MODL_MIN = 60000;
function modlDur(ms) {
  const m = Math.round(ms / MODL_MIN);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} h`;
}
function modlDesfase(min) {
  if (!min) return "a la misma hora que la llenadora";
  const h = Math.abs(min) / 60;
  const t = Number.isInteger(h) ? `${h} h` : modlDur(Math.abs(min) * MODL_MIN);
  return `${t} ${min < 0 ? "antes" : "después"} de la llenadora`;
}
function modlNombreBloque(b) {
  const n = String(b.name || "").replace(/^(DPA|NST)\s*-\s*/i, "");
  // «Liquid changes - Cambio de Liquido» → «Cambio de Liquido» (la parte en español).
  const partes = n.split(/\s+-\s+/);
  return (partes.length > 1 ? partes[partes.length - 1] : n).trim() || (b.type === "idle" ? "Sin programación" : "DPA");
}

// Cálculo puro. mergedByTrain: { "5": [bloques {start,end,type,name}], … }.
function calcularModulacion(mergedByTrain, cfg) {
  cfg = cfg || modlConfig();
  const umbral = cfg.umbralMin * MODL_MIN;
  const todos = [];
  TRAINS.forEach((t) =>
    ((mergedByTrain && mergedByTrain[t]) || []).forEach((b) => {
      if (b && b.start && b.end && b.end > b.start) todos.push({ ...b, train: t });
    }),
  );
  if (!todos.length) return { paradas: [], eventos: [], revisar: [], desde: null, hasta: null };
  // Horizonte del instructivo: lo mismo para todas las líneas.
  const desde = Math.min(...todos.map((b) => b.start.getTime()));
  const hasta = Math.max(...todos.map((b) => b.end.getTime()));
  const paradas = [];
  const revisar = [];
  TRAINS.forEach((t) => {
    const bs = todos.filter((b) => b.train === t);
    // Unión de lo que la llenadora envasa (producción, con solapes juntos).
    const prod = bs
      .filter((b) => b.type === "production")
      .map((b) => [b.start.getTime(), b.end.getTime()])
      .sort((x, y) => x[0] - y[0]);
    const union = [];
    prod.forEach(([a, z]) => {
      const u = union[union.length - 1];
      if (u && a <= u[1]) u[1] = Math.max(u[1], z);
      else union.push([a, z]);
    });
    // Tramos sin envasar dentro del horizonte.
    const huecos = [];
    let cur = desde;
    union.forEach(([a, z]) => {
      if (a > cur) huecos.push([cur, a]);
      cur = Math.max(cur, z);
    });
    if (hasta > cur) huecos.push([cur, hasta]);
    const noProd = bs.filter((b) => b.type !== "production");
    huecos.forEach(([a, z]) => {
      if (z - a < MODL_MIN) return;
      // Cortes del tramo en intervalos elementales: DPA, o sin programación
      // (NST, «otro» o sin filas).
      const cortes = new Set([a, z]);
      noProd.forEach((b) => {
        const s = Math.max(a, b.start.getTime());
        const e = Math.min(z, b.end.getTime());
        if (e > s) (cortes.add(s), cortes.add(e));
      });
      const ts = [...cortes].sort((x, y) => x - y);
      const tramos = [];
      for (let i = 0; i < ts.length - 1; i++) {
        const s = ts[i];
        const e = ts[i + 1];
        if (e <= s) continue;
        const cubren = noProd.filter((b) => b.start.getTime() <= s && b.end.getTime() >= e);
        const dpa = cubren.find((b) => b.type === "changeover");
        const otro = cubren.find((b) => b.type !== "changeover");
        const tipo = dpa ? "dpa" : "sin";
        const etiqueta = dpa ? `DPA ${modlNombreBloque(dpa)}` : otro ? (otro.type === "idle" ? "Sin programación (NST)" : modlNombreBloque(otro)) : "Sin filas en el instructivo";
        const u = tramos[tramos.length - 1];
        if (u && u.tipo === tipo && u.end === s) {
          u.end = e;
          const p = u.partes[u.partes.length - 1];
          if (p.etiqueta === etiqueta && p.end === s) p.end = e;
          else u.partes.push({ etiqueta, start: s, end: e });
        } else tramos.push({ tipo, start: s, end: e, partes: [{ etiqueta, start: s, end: e }] });
      }
      const maxDe = (tipo) => Math.max(0, ...tramos.filter((x) => x.tipo === tipo).map((x) => x.end - x.start));
      const dpaMax = maxDe("dpa");
      const sinMax = maxDe("sin");
      const motivo = tramos.flatMap((x) => x.partes).map((p) => `${p.etiqueta} ${modlDur(p.end - p.start)}`).join(" + ");
      const base = { tren: t, para: a, arranca: z, dur: z - a, motivo, tramos, desdeInicio: a <= desde, hastaFin: z >= hasta };
      if (dpaMax >= umbral || sinMax >= umbral)
        paradas.push({ ...base, por: dpaMax >= umbral && sinMax >= umbral ? "DPA y sin programación" : dpaMax >= umbral ? "DPA de 2 h o más" : "sin programación 2 h o más" });
      else if (z - a >= umbral && !base.desdeInicio && !base.hastaFin) revisar.push(base);
    });
  });
  paradas.sort((x, y) => x.para - y.para || x.tren.localeCompare(y.tren));
  // Eventos por equipo. Al comienzo del instructivo no se sabe desde cuándo
  // está parada la línea (no hay parada que anunciar); al final, no se sabe
  // cuándo vuelve a arrancar.
  const eventos = [];
  paradas.forEach((p) => {
    const lavPara = p.para + cfg.parada.lavadora * MODL_MIN;
    const lavArr = p.arranca + cfg.arranque.lavadora * MODL_MIN;
    const lavaSigue = !p.desdeInicio && !p.hastaFin && lavArr <= lavPara;
    p.lavadoraNoPara = lavaSigue;
    if (!p.desdeInicio) {
      eventos.push({ ms: p.para, tren: p.tren, equipo: "llenadora", accion: "para", parada: p });
      MODL_EQUIPOS.forEach(([e]) => {
        if (e === "lavadora" && lavaSigue) return;
        eventos.push({ ms: p.para + cfg.parada[e] * MODL_MIN, tren: p.tren, equipo: e, accion: "para", parada: p });
      });
    }
    if (!p.hastaFin) {
      eventos.push({ ms: p.arranca, tren: p.tren, equipo: "llenadora", accion: "arranca", parada: p });
      MODL_EQUIPOS.forEach(([e]) => {
        if (e === "lavadora" && lavaSigue) return;
        eventos.push({ ms: p.arranca + cfg.arranque[e] * MODL_MIN, tren: p.tren, equipo: e, accion: "arranca", parada: p });
      });
    }
    if (lavaSigue) eventos.push({ ms: lavPara, tren: p.tren, equipo: "lavadora", accion: "sigue", parada: p });
  });
  const ordenEq = { lavadora: 0, agua: 1, llenadora: 2, paster: 3 };
  eventos.sort((x, y) => x.ms - y.ms || x.tren.localeCompare(y.tren) || ordenEq[x.equipo] - ordenEq[y.equipo]);
  return { paradas, eventos, revisar, desde, hasta };
}

const MODL_NOMBRE = { lavadora: "Lavadora", agua: "Agua", paster: "Paster", llenadora: "Llenadora" };
function modlAccionTxt(ev) {
  if (ev.accion === "sigue") return "sigue encendida";
  if (ev.equipo === "lavadora" && ev.accion === "arranca") return "arranca (calentamiento)";
  if (ev.equipo === "paster" && ev.accion === "arranca") return "arranca (calentamiento)";
  return ev.accion === "para" ? "para" : "arranca";
}
function modlDetalleEvento(ev) {
  const p = ev.parada;
  if (ev.accion === "sigue")
    return `La parada dura ${modlDur(p.dur)}: la lavadora tendría que parar ${fmtDateTime(new Date(p.para + modlConfig().parada.lavadora * MODL_MIN))} y volver a arrancar antes de esa hora, así que no se apaga.`;
  if (ev.equipo === "llenadora")
    return ev.accion === "para"
      ? `Para ${modlDur(p.dur)} · ${p.motivo}`
      : `Vuelve a envasar tras ${p.desdeInicio ? "estar parada desde el comienzo del instructivo" : `una parada de ${modlDur(p.dur)}`}`;
  const cfg = modlConfig();
  const off = ev.accion === "para" ? cfg.parada[ev.equipo] : cfg.arranque[ev.equipo];
  return `${modlDesfase(off)} (llenadora ${ev.accion === "para" ? "para" : "arranca"} ${fmtDateTime(new Date(ev.accion === "para" ? p.para : p.arranca))})`;
}

/* ---- Filas del Gantt de envasado (misma escala) ---- */
function htmlFilasModulacion(mergedByTrain, rangeStart, totalWidth, dayLinesHtml) {
  const r = calcularModulacion(mergedByTrain, modlConfig());
  if (!r.paradas.length && !r.revisar.length) return "";
  const rs = rangeStart.getTime();
  const px = (ms) => ((ms - rs) / 3600000) * GANTT_PX_PER_HOUR;
  const fila = (t) => {
    const ps = r.paradas.filter((p) => p.tren === t);
    const rv = r.revisar.filter((p) => p.tren === t);
    const bloques = ps
      .map((p) => {
        const left = px(p.para);
        const width = Math.max(3, px(p.arranca) - left);
        const tit = `L${t} · PARADA ${fmtDateTime(new Date(p.para))} → ${fmtDateTime(new Date(p.arranca))} (${modlDur(p.dur)}) · ${p.motivo}`;
        const txt = width >= 90 ? `<b>Parada ${escapeHtml(modlDur(p.dur))}</b>${width >= 170 ? `<span>${escapeHtml(p.por)}</span>` : ""}` : "";
        return `<div class="block modl-parada" style="left:${left}px;width:${width}px;" title="${escapeHtml(tit)}">${txt}</div>`;
      })
      .join("");
    const dudas = rv
      .map((p) => {
        const left = px(p.para);
        const width = Math.max(3, px(p.arranca) - left);
        return `<div class="block modl-revisar" style="left:${left}px;width:${width}px;" title="${escapeHtml(`L${t} · ¿parada? ${fmtDateTime(new Date(p.para))} → ${fmtDateTime(new Date(p.arranca))} (${modlDur(p.dur)}) · ${p.motivo} · ninguna parte llega a 2 h: no se tomó como parada`)}"></div>`;
      })
      .join("");
    const marcas = r.eventos
      .filter((e) => e.tren === t && e.equipo !== "llenadora" && e.accion !== "sigue")
      .map(
        (e) =>
          `<div class="modl-marca modl-${e.equipo} modl-${e.accion}" style="left:${px(e.ms)}px" title="${escapeHtml(`L${t} · ${MODL_NOMBRE[e.equipo]} ${modlAccionTxt(e)} ${fmtDateTime(new Date(e.ms))} · ${modlDetalleEvento(e)}`)}"><span>${e.accion === "arranca" ? "▲" : "▼"}</span></div>`,
      )
      .join("");
    return `
        <div class="gantt-row util-row modl-row">
          <div class="lane-label">L${t}<small>modulación</small></div>
          <div class="lane-track" style="width:${totalWidth}px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}</div>
            ${dudas}${bloques}${marcas}
          </div>
        </div>`;
  };
  return `
        <div class="gantt-row util-sep">
          <div class="lane-label">MODULACIÓN</div>
          <div class="util-sep-track sp-sep-track" style="width:${totalWidth}px;"><span>Paradas de la llenadora (DPA o sin programación de 2 h o más) · ▼ para · ▲ arranca: <b class="modl-c-lavadora">lavadora</b> · <b class="modl-c-agua">agua</b> · <b class="modl-c-paster">paster</b></span></div>
        </div>
        ${TRAINS.map(fila).join("")}`;
}

function htmlLeyendaModulacion() {
  return (
    `<div class="item"><b class="util-ctl-label">Modulación</b></div>` +
    `<div class="item"><span class="sw modl-sw-parada"></span>Parada de la llenadora</div>` +
    `<div class="item"><span class="sw modl-sw-revisar"></span>¿Parada? (revisar)</div>` +
    MODL_EQUIPOS.map(([e, n]) => `<div class="item"><span class="modl-ley modl-c-${e}">▼▲</span>${n}</div>`).join("")
  );
}

/* ---- Panel: próximo arranque/parada por línea + tabla + reglas ---- */
function modlDiaPlaneacion(ms) {
  return medianocheMs(new Date(ms + 2 * 3600000));
}
function modlEventosFiltrados(r) {
  return r.eventos.filter(
    (e) => (MODL_FILTRO.tren === "todos" || e.tren === MODL_FILTRO.tren) && (MODL_FILTRO.dia === "todos" || modlDiaPlaneacion(e.ms) === Number(MODL_FILTRO.dia)),
  );
}
// Siguiente parada o arranque de cada línea a partir de «ahora».
function modlProximos(r, ahora) {
  return TRAINS.map((t) => {
    const evs = r.eventos.filter((e) => e.tren === t && e.equipo === "llenadora" && e.ms >= ahora);
    const sig = evs[0];
    if (!sig) return { tren: t, ev: null };
    const grupo = r.eventos.filter((e) => e.parada === sig.parada && e.accion === sig.accion && e.equipo !== "llenadora").concat(r.eventos.filter((e) => e.parada === sig.parada && e.accion === "sigue"));
    return { tren: t, ev: sig, grupo };
  });
}

function htmlPanelModulacion(mergedByTrain) {
  const cfg = modlConfig();
  const r = calcularModulacion(mergedByTrain, cfg);
  if (!r.paradas.length && !r.revisar.length) return "";
  const ahora = typeof ahoraPlanta === "function" ? ahoraPlanta().getTime() : Date.now();
  const enHorizonte = ahora >= r.desde && ahora <= r.hasta;
  const ref = enHorizonte ? ahora : r.desde;
  const prox = modlProximos(r, ref);
  const tarjetas = prox
    .map((x) => {
      if (!x.ev) return `<div class="modl-card"><div class="modl-card-t">Línea ${escapeHtml(x.tren)}</div><p class="empty-note">Sin paradas ni arranques después de ${escapeHtml(fmtDateTime(new Date(ref)))} en el instructivo.</p></div>`;
      const p = x.ev.parada;
      const arr = x.ev.accion === "arranca";
      const lineas = x.grupo
        .sort((a, b) => a.ms - b.ms)
        .map((e) => `<li class="${e.ms < ref ? "modl-ya" : ""}"><span class="modl-c-${e.equipo}">${escapeHtml(MODL_NOMBRE[e.equipo])}</span> <b>${escapeHtml(fmtDateTime(new Date(e.ms)))}</b> · ${escapeHtml(modlAccionTxt(e))}${e.ms < ref ? " · <i>ya debió hacerse</i>" : ""}</li>`)
        .join("");
      return `<div class="modl-card ${arr ? "modl-card-arr" : "modl-card-par"}"><div class="modl-card-t">Línea ${escapeHtml(x.tren)} · ${arr ? "arranca" : "para"} <b>${escapeHtml(fmtDateTime(new Date(x.ev.ms)))}</b></div><div class="modl-card-s">${arr ? (p.desdeInicio ? "Parada desde el comienzo del instructivo" : `Tras una parada de ${escapeHtml(modlDur(p.dur))}`) : `Parada de ${escapeHtml(modlDur(p.dur))}${p.hastaFin ? " (hasta el final del instructivo)" : ` · arranca ${escapeHtml(fmtDateTime(new Date(p.arranca)))}`}`}</div><ul>${lineas}</ul><div class="modl-card-m">${escapeHtml(p.motivo)}</div></div>`;
    })
    .join("");
  const dias = [...new Set(r.eventos.map((e) => modlDiaPlaneacion(e.ms)))].sort((a, b) => a - b);
  if (MODL_FILTRO.dia !== "todos" && !dias.includes(Number(MODL_FILTRO.dia))) MODL_FILTRO.dia = "todos";
  const lista = modlEventosFiltrados(r);
  const filas = lista.length
    ? lista
        .map(
          (e) => `<tr class="${e.ms < ahora ? "modl-pasado" : ""} ${e.equipo === "llenadora" ? "modl-fila-llen" : ""}">
          <td>${escapeHtml(fmtDateTime(new Date(e.ms)))}</td>
          <td><span class="sp-turno">${typeof spTurno === "function" ? spTurno(e.ms) : ""}</span></td>
          <td>L${escapeHtml(e.tren)}</td>
          <td><span class="modl-c-${e.equipo}">${escapeHtml(MODL_NOMBRE[e.equipo])}</span></td>
          <td><b>${escapeHtml(modlAccionTxt(e))}</b></td>
          <td class="rec-imp">${escapeHtml(modlDetalleEvento(e))}</td>
        </tr>`,
        )
        .join("")
    : '<tr><td colspan="6"><p class="empty-note">Sin eventos en el filtro elegido.</p></td></tr>';
  const inp = (grupo, e) => `<input type="number" class="acu-pond sp-in" data-modl="${grupo}.${e}" step="0.25" value="${cfg[grupo][e] / 60}"> h`;
  const conf = `<table class="acu-tabla sp-conf"><thead><tr><th>Equipo</th><th class="acu-c">Arranque</th><th class="acu-c">Parada</th></tr></thead><tbody>${MODL_EQUIPOS.map(([e, n]) => `<tr><td>${n}</td><td class="acu-c">${inp("arranque", e)}</td><td class="acu-c">${inp("parada", e)}</td></tr>`).join("")}<tr><td>Parada si dura</td><td class="acu-c" colspan="2"><input type="number" class="acu-pond sp-in" data-modl="umbral" step="0.25" min="0.25" value="${cfg.umbralMin / 60}"> h o más</td></tr></tbody></table>`;
  const revisarHtml = r.revisar.length
    ? `<div class="acu-card" style="margin-top:12px;"><div class="acu-card-tit">Para revisar: ¿son paradas? (${r.revisar.length})</div><p class="acu-nota" style="margin-top:0;">Tramos de 2 h o más sin envasar en los que ninguna parte llega sola a 2 h (DPA corto seguido de sin programación). Con las reglas no son parada; confírmenlo.</p><ul class="modl-rev">${r.revisar
        .map((p) => `<li><b>L${escapeHtml(p.tren)}</b> ${escapeHtml(fmtDateTime(new Date(p.para)))} → ${escapeHtml(fmtDateTime(new Date(p.arranca)))} (${escapeHtml(modlDur(p.dur))}): ${escapeHtml(p.motivo)}</li>`)
        .join("")}</ul></div>`
    : "";
  return `
    <div class="sp-panel modl-panel" id="modlPanel">
      <div class="sp-head">
        <b class="util-title">Modulación — paradas y arranques de línea</b>
        <span class="util-note">El instructivo es la llenadora: ${r.paradas.length} parada(s) en ${escapeHtml(fmtDate(new Date(r.desde)))} → ${escapeHtml(fmtDate(new Date(r.hasta)))}</span>
      </div>
      <div class="modl-cards-tit">${enHorizonte ? `Lo siguiente en cada línea desde ahora (${escapeHtml(fmtDateTime(new Date(ahora)))})` : `Primer evento de cada línea (hoy está fuera del instructivo cargado)`}</div>
      <div class="modl-cards">${tarjetas}</div>
      <div class="sp-grid">
        <div class="acu-card">
          <div class="acu-card-tit">Arranques y paradas por equipo (${lista.length})
            <span class="sp-filtros">
              <select class="pc-sel" data-modl-filtro="tren"><option value="todos">Todas las líneas</option>${TRAINS.map((t) => `<option value="${t}" ${MODL_FILTRO.tren === t ? "selected" : ""}>L${t}</option>`).join("")}</select>
              <select class="pc-sel" data-modl-filtro="dia"><option value="todos">Todos los días</option>${dias.map((d) => `<option value="${d}" ${String(MODL_FILTRO.dia) === String(d) ? "selected" : ""}>${escapeHtml(fmtDate(new Date(d)))}</option>`).join("")}</select>
              <button type="button" class="btn small" data-modl-csv>⬇ CSV</button>
              <button type="button" class="btn small" data-modl-imprimir>🖨 Imprimir</button>
            </span>
          </div>
          <div class="table-scroll" style="max-height:380px;"><table class="acu-tabla sp-tabla"><thead><tr><th>Fecha y hora</th><th>Turno</th><th>Línea</th><th>Equipo</th><th>Acción</th><th>Por qué</th></tr></thead><tbody>${filas}</tbody></table></div>
          <p class="acu-nota">Día de planeación: de 22:00 del día anterior a 21:59. En gris lo que ya pasó. Al comienzo del instructivo no se sabe desde cuándo estaba parada una línea, y al final no se sabe cuándo vuelve a arrancar: en esos casos solo sale lo que sí se sabe.</p>
        </div>
        <div class="acu-card">
          <div class="acu-card-tit">Reglas de modulación</div>
          ${conf}
          <p class="acu-nota">Horas respecto a la llenadora: negativo = antes, positivo = después. Parada = DPA de esa duración o más (seguidos cuentan juntos) o sin programación de esa duración o más. Se guardan en este navegador.</p>
          <button type="button" class="btn small" data-modl-reset>Restaurar reglas</button>
        </div>
      </div>
      ${revisarHtml}
    </div>`;
}

function conectarPanelModulacion(mergedByTrain, redibujar) {
  const panel = document.getElementById("modlPanel");
  if (!panel) return;
  panel.querySelectorAll("[data-modl]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const c = modlConfig();
      const v = Number(inp.value);
      if (!isFinite(v)) return;
      const k = inp.dataset.modl;
      if (k === "umbral") {
        if (v > 0) c.umbralMin = Math.round(v * 60);
      } else {
        const [g, e] = k.split(".");
        c[g][e] = Math.round(v * 60);
      }
      modlGuardar(c);
      redibujar();
    }),
  );
  const reset = panel.querySelector("[data-modl-reset]");
  if (reset)
    reset.addEventListener("click", () => {
      modlGuardar(JSON.parse(JSON.stringify(MODL_DEFECTO)));
      redibujar();
    });
  panel.querySelectorAll("[data-modl-filtro]").forEach((s) =>
    s.addEventListener("change", () => {
      MODL_FILTRO[s.dataset.modlFiltro] = s.value;
      redibujar();
    }),
  );
  const filasExport = () =>
    modlEventosFiltrados(calcularModulacion(mergedByTrain, modlConfig())).map((e) => [
      fmtDateTime(new Date(e.ms)),
      typeof spTurno === "function" ? spTurno(e.ms) : "",
      "L" + e.tren,
      MODL_NOMBRE[e.equipo],
      modlAccionTxt(e),
      modlDetalleEvento(e),
    ]);
  const csv = panel.querySelector("[data-modl-csv]");
  if (csv)
    csv.addEventListener("click", () => {
      const filas = [["Fecha y hora", "Turno", "Línea", "Equipo", "Acción", "Por qué"], ...filasExport()];
      const txt = "﻿" + filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv;charset=utf-8" }));
      a.download = "modulacion_lineas.csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 500);
    });
  const imp = panel.querySelector("[data-modl-imprimir]");
  if (imp)
    imp.addEventListener("click", () => {
      const filas = filasExport();
      const w = window.open("", "_blank");
      if (!w) return;
      const fil = `${MODL_FILTRO.tren === "todos" ? "Todas las líneas" : "L" + MODL_FILTRO.tren} · ${MODL_FILTRO.dia === "todos" ? "todos los días" : fmtDate(new Date(Number(MODL_FILTRO.dia)))}`;
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>Modulación de líneas</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{color:#555;font-size:12px;margin:0 0 14px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#eee}</style></head><body><h1>Modulación de líneas — arranques y paradas</h1><p>${escapeHtml(fil)} · Generado ${escapeHtml(new Date().toLocaleString("es-CO"))}</p><table><thead><tr><th>Fecha y hora</th><th>Turno</th><th>Línea</th><th>Equipo</th><th>Acción</th><th>Por qué</th><th>Hecho ✓</th></tr></thead><tbody>${filas
          .map((f) => `<tr>${f.map((v) => `<td>${escapeHtml(String(v))}</td>`).join("")}<td></td></tr>`)
          .join("")}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`,
      );
      w.document.close();
    });
}
