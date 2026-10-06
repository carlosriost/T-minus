/* =========================================================================
   T-MINUS LÍNEAS — cuenta regresiva operativa por tren de envasado
   -------------------------------------------------------------------------
   Toma el plan de envasado cargado y un instante de referencia («ahora»):
   por defecto el I0 de la programación, o la hora actual de la planta. Para
   cada tren dice qué está haciendo, cuánto falta para terminar la corrida,
   para el próximo cambio de formato y para el próximo paro (NST), y qué
   viene después. Abajo, la secuencia de las próximas 12 horas y los eventos
   en orden. También muestra qué equipos de Utilities pide ese momento.
   ========================================================================= */

const TMINUS_MODO_KEY = "planTminusModo";
const TMINUS_VENTANA_H = 12;

function tminusModo() {
  try {
    return localStorage.getItem(TMINUS_MODO_KEY) === "ahora" ? "ahora" : "i0";
  } catch (_) {
    return "i0";
  }
}
function tminusReferencia() {
  if (tminusModo() === "ahora") return ahoraPlanta();
  return getI0Date() || ahoraPlanta();
}

// Turnos de la planta: T1 22:00-06:00, T2 06:00-14:00, T3 14:00-22:00.
function turnoDe(ms) {
  const h = new Date(ms).getUTCHours();
  if (h >= 22 || h < 6) return "T1 (22:00–06:00)";
  if (h < 14) return "T2 (06:00–14:00)";
  return "T3 (14:00–22:00)";
}

// Estado de un tren en el instante t.
function estadoTren(bloques, t) {
  const actual = bloques.find((b) => b.start.getTime() <= t && b.end.getTime() > t) || null;
  const futuros = bloques.filter((b) => b.start.getTime() > t);
  const fmtActual = actual && actual.type === "production" ? formatoDeSKU(actual.name) : null;
  const finCorrida = actual && actual.type === "production" ? actual.end.getTime() : null;
  // Próximo cambio de formato: el próximo producto con otro envase/tamaño.
  // Los DPA no se miran aquí (en T-Minus se omiten; ver renderTminus).
  let cambio = null;
  for (const b of futuros) {
    if (b.type === "production" && fmtActual && formatoDeSKU(b.name) !== fmtActual) {
      cambio = { ms: b.start.getTime(), txt: formatoDeSKU(b.name) };
      break;
    }
  }
  const paro = futuros.find((b) => b.type === "idle");
  // Próxima corrida programada después de la actual (puede ser el mismo SKU
  // si la línea para y vuelve a arrancar con él).
  const proximo = futuros.find((b) => b.type === "production");
  const anterior = bloques.some((b) => b.end.getTime() <= t);
  const estado = !actual
    ? anterior && futuros.length
      ? { txt: "Entre corridas", cls: "" }
      : { txt: "Sin plan", cls: "" }
    : actual.type === "production"
      ? { txt: "Envasando", cls: "ok" }
      : actual.type === "idle"
          ? { txt: "Paro NST", cls: "danger" }
          : { txt: actual.name || "Otro", cls: "" };
  return { actual, estado, finCorrida, cambio, paro, proximo };
}

function tminusBarras(bloques, desde, hasta) {
  const span = hasta - desde;
  return bloques
    .filter((b) => b.end.getTime() > desde && b.start.getTime() < hasta)
    .map((b) => {
      const a = Math.max(desde, b.start.getTime());
      const z = Math.min(hasta, b.end.getTime());
      const left = ((a - desde) / span) * 100;
      const width = Math.max(0.4, ((z - a) / span) * 100);
      const tit = escapeHtml(`${b.name || b.codigo || ""} · ${fmtDateTime(b.start)} → ${fmtDateTime(b.end)}`);
      if (b.type === "production") {
        const c = colorForPackagingEvent(b);
        return `<div class="tm-blk" style="left:${left}%;width:${width}%;background:${c.bg};color:${c.fg};" title="${tit}"><span>${escapeHtml(b.name || b.codigo || "")}</span></div>`;
      }
      return `<div class="tm-blk tm-nst" style="left:${left}%;width:${width}%;" title="${tit}"><span>NST</span></div>`;
    })
    .join("");
}

function renderTminus() {
  const cont = document.getElementById("tminusPanel");
  if (!cont) return;
  if (!STATE || !STATE.mergedByTrain) return modSinDatos(cont, "la cuenta regresiva de líneas");

  const ref = tminusReferencia();
  const t = ref.getTime();
  // En T-Minus solo los NST cuentan como parada: los DPA (cambios de formato)
  // se omiten por completo —no aparecen en la línea de tiempo, en los eventos
  // ni en los contadores—, como pidió Planeación.
  const porTren = bloquesPorTren();
  TRAINS.forEach((tr) => (porTren[tr] = porTren[tr].filter((b) => b.type !== "changeover")));
  const estados = {};
  TRAINS.forEach((tr) => (estados[tr] = estadoTren(porTren[tr], t)));

  /* ---- Tarjetas ---- */
  const activas = TRAINS.filter((tr) => estados[tr].actual && estados[tr].actual.type === "production").length;
  const diaIni = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const corridasHoy = TRAINS.reduce(
    (a, tr) =>
      a +
      porTren[tr].filter(
        (b) => b.type === "production" && b.start.getTime() >= diaIni && b.start.getTime() < diaIni + 86400000,
      ).length,
    0,
  );
  const nst6h = TRAINS.reduce(
    (a, tr) =>
      a +
      porTren[tr].filter(
        (b) => b.type === "idle" && b.start.getTime() > t && b.start.getTime() <= t + 6 * 3600000,
      ).length,
    0,
  );
  // Utilización de la semana en curso: horas envasando / horas disponibles.
  const semanas = semanasDelPlan();
  const si = semanas.length ? semanaIdxDe(t, semanas) : -1;
  let util = null;
  if (si >= 0) {
    const w = semanas[si];
    let horas = 0;
    TRAINS.forEach((tr) =>
      porTren[tr].forEach((b) => {
        if (b.type !== "production") return;
        const a = Math.max(w.start, b.start.getTime());
        const z = Math.min(w.end, b.end.getTime());
        if (z > a) horas += (z - a) / 3600000;
      }),
    );
    util = (horas / (TRAINS.length * ((w.end - w.start) / 3600000))) * 100;
  }
  let utilTxt = "—";
  if (typeof calcularUtilidades === "function") {
    const u = calcularUtilidades(STATE.mergedByTrain);
    const en = (lista) => (lista.find((x) => x.start.getTime() <= t && x.end.getTime() > t) || {}).texto;
    const c = en(u.calderas);
    const ai = en(u.aire);
    if (c || ai) utilTxt = `${escapeHtml(c || "—")}<br>${escapeHtml(ai || "—")}`;
  }
  const kpis =
    modKpi("▶", "Líneas envasando", `${activas} <small>/ ${TRAINS.length}</small>`, `Turno ${turnoDe(t)}`, activas ? "var(--ok)" : "var(--muted)") +
    modKpi("▤", "Corridas que arrancan hoy", String(corridasHoy), fmtDate(ref)) +
    modKpi("⏸", "Paros NST que arrancan", String(nst6h), "En las próximas 6 horas", nst6h ? "var(--warn)" : "var(--muted)") +
    modKpi("◔", "Utilización de la semana", util == null ? "—" : `${MOD_NF(util)}%`, si >= 0 ? `Horas envasando · ${escapeHtml(semanas[si].label)}` : "") +
    `<div class="acu-kpi"><div class="acu-kpi-ico" style="color:var(--accent);">♨</div><div><div class="acu-kpi-tit">Utilities en este momento</div><div class="tm-util">${utilTxt}</div><div class="acu-kpi-pie">Según las líneas funcionando</div></div></div>`;

  /* ---- Tabla por línea ---- */
  const desde = t - 3600000;
  const hasta = t + TMINUS_VENTANA_H * 3600000;
  const marcas = [];
  for (let h = Math.ceil(desde / 7200000) * 7200000; h <= hasta; h += 7200000) marcas.push(h);
  const ejeHtml = (conTexto) =>
    marcas
      .map(
        (h) =>
          `<div class="tm-tick" style="left:${((h - desde) / (hasta - desde)) * 100}%">${conTexto ? String(new Date(h).getUTCHours()).padStart(2, "0") + ":00" : ""}</div>`,
      )
      .join("");
  const ahoraPct = ((t - desde) / (hasta - desde)) * 100;
  const chip = (ms, cls, sub) =>
    ms == null
      ? '<span class="tm-chip tm-none">—</span>'
      : `<span class="tm-chip ${cls}" title="${escapeHtml(fmtDateTime(new Date(ms)))}">${modTMinus(ms - t)}</span>${sub ? `<small class="tm-sub">${escapeHtml(sub)}</small>` : ""}`;

  const filas = TRAINS.map((tr) => {
    const e = estados[tr];
    const act = e.actual;
    const prod =
      act && act.type === "production"
        ? `<b>${escapeHtml(act.name || act.codigo)}</b><small class="tm-sub">${escapeHtml(formatoDeSKU(act.name))} · ${MOD_NF(act.hectolitros)} hL</small>`
        : `<span style="color:var(--muted)">${act ? escapeHtml(act.name || "") : "Sin bloque"}</span>`;
    const prox = e.proximo
      ? `<b>${escapeHtml(e.proximo.name || e.proximo.codigo)}</b><small class="tm-sub">${escapeHtml(fmtDateTime(e.proximo.start))}</small>`
      : '<span style="color:var(--muted)">—</span>';
    return `<tr>
      <td><b>TREN-${tr}</b><br><span class="tag ${e.estado.cls}">${e.estado.txt}</span></td>
      <td class="tm-prod">${prod}</td>
      <td class="acu-c">${chip(e.finCorrida, "tm-fin")}</td>
      <td class="acu-c">${chip(e.cambio && e.cambio.ms, "tm-cambio", e.cambio && e.cambio.txt)}</td>
      <td class="acu-c">${chip(e.paro && e.paro.start.getTime(), "tm-paro")}</td>
      <td class="tm-prod">${prox}</td>
    </tr>`;
  }).join("");
  // Secuencia de las próximas horas: una fila por tren con la misma escala.
  const secuencia = TRAINS.map(
    (tr) =>
      `<div class="tm-seq-row"><div class="tm-seq-l">TREN-${tr}</div><div class="tm-line">${ejeHtml(false)}${tminusBarras(porTren[tr], desde, hasta)}<div class="tm-now" style="left:${ahoraPct}%"></div></div></div>`,
  ).join("");

  /* ---- Próximos eventos (12 h) ---- */
  const eventos = [];
  TRAINS.forEach((tr) =>
    porTren[tr].forEach((b) => {
      const s = b.start.getTime();
      const f = b.end.getTime();
      if (s > t && s <= hasta) {
        if (b.type === "production") eventos.push({ ms: s, tr, tipo: "ini", txt: `Inicio de corrida · ${b.name || b.codigo}` });
        else if (b.type === "idle") eventos.push({ ms: s, tr, tipo: "nst", txt: "Inicio de paro (NST)" });
      }
      if (b.type === "production" && f > t && f <= hasta)
        eventos.push({ ms: f, tr, tipo: "fin", txt: `Fin de corrida · ${b.name || b.codigo}` });
    }),
  );
  eventos.sort((a, b) => a.ms - b.ms);
  const colEv = { ini: "var(--ok)", fin: "var(--danger)", dpa: "var(--warn)", nst: "#3226e8" };
  const eventosHtml = eventos.length
    ? eventos
        .slice(0, 10)
        .map(
          (e) =>
            `<div class="tm-ev"><span class="dot" style="background:${colEv[e.tipo]}"></span><b>${fmtDateTime(new Date(e.ms)).split(" ").slice(-1)[0]}</b><div><div>${escapeHtml(e.txt)}</div><small>TREN-${e.tr} · ${modTMinus(e.ms - t)}</small></div></div>`,
        )
        .join("")
    : '<p class="empty-note">Sin eventos en las próximas 12 horas.</p>';

  /* ---- Restricciones de secuencia de la semana en curso ---- */
  const hallazgos =
    typeof hallazgosLogistica === "function" ? hallazgosLogistica().filter((h) => si < 0 || h.semana === si) : [];
  const restrHtml = hallazgos.length
    ? hallazgos
        .slice(0, 6)
        .map(
          (h) =>
            `<div class="tm-restr ${h.grave ? "grave" : ""}"><span>${h.grave ? "⛔" : "⚠"}</span><div><b>TREN-${h.tren}</b><div>${escapeHtml(h.texto)}</div></div></div>`,
        )
        .join("")
    : '<p class="empty-note">Sin restricciones de secuencia en la semana en curso.</p>';

  const modo = tminusModo();
  cont.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>T-Minus de líneas de envasado</h3>
        <span class="tm-modo">Referencia:
          <button type="button" class="btn small ${modo === "i0" ? "primary" : ""}" data-tm-modo="i0">I0 de la programación</button>
          <button type="button" class="btn small ${modo === "ahora" ? "primary" : ""}" data-tm-modo="ahora">Hora actual</button>
          <b class="tm-ref">${escapeHtml(fmtDateTime(ref))}</b>
        </span>
      </div>
      <div class="panel-body">
        <div class="acu-kpis">${kpis}</div>
        <div class="acu-grid">
          <div class="acu-card">
            <div class="acu-card-tit">Estado actual y T-Minus por línea</div>
            <div class="table-scroll"><table class="acu-tabla tm-tabla"><thead><tr>
              <th>Línea</th><th>Producto actual</th><th class="acu-c">T-Minus<br>fin de corrida</th><th class="acu-c">T-Minus<br>cambio formato</th><th class="acu-c">T-Minus<br>paro (NST)</th><th>Próximo producto</th>
            </tr></thead><tbody>${filas}</tbody></table></div>
            <div class="tm-nota">T-Minus = tiempo que falta desde la referencia. Cambio de formato = el próximo producto con otro envase/tamaño. Aquí solo los NST cuentan como parada; los DPA se omiten.</div>
          </div>
          <div>
            <div class="acu-card"><div class="acu-card-tit">Próximos eventos (${TMINUS_VENTANA_H} h)</div>${eventosHtml}</div>
            <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Restricciones de secuencia (semana en curso) ${hallazgos.length ? `<span class="acu-tag" style="color:var(--warn);border-color:var(--warn);margin-left:6px;">${hallazgos.length}</span>` : ""}</div>${restrHtml}</div>
          </div>
        </div>
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Secuencia de las próximas ${TMINUS_VENTANA_H} horas <small style="color:var(--muted);font-weight:400;">· la línea amarilla es el momento de referencia</small></div>
          <div class="tm-seq"><div class="tm-seq-row"><div class="tm-seq-l"></div><div class="tm-line tm-axis">${ejeHtml(true)}</div></div>${secuencia}</div>
        </div>
      </div>
    </div>`;
  cont.querySelectorAll("[data-tm-modo]").forEach((b) =>
    b.addEventListener("click", () => {
      try {
        localStorage.setItem(TMINUS_MODO_KEY, b.dataset.tmModo);
      } catch (_) {}
      renderTminus();
    }),
  );
}

// Con «Hora actual», la cuenta regresiva avanza sola cada minuto.
setInterval(() => {
  const v = document.getElementById("view-tminus");
  if (tminusModo() === "ahora" && v && !v.classList.contains("nav-hide")) renderTminus();
}, 60000);
