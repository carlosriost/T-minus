/* =========================================================================
   UTILIDADES — calderas y aire comprimido según las líneas de envasado
   =========================================================================
   El área de Utilities debe saber, en cada momento del plan, qué equipos
   tienen que estar operando. La demanda de vapor (calderas) y de aire
   comprimido depende de cuántas líneas de envasado están trabajando a la vez,
   así que aquí se recorre el plan de envasado, se cuenta cuántos trenes están
   envasando en cada tramo de tiempo y se aplican las reglas de la planta.
   ========================================================================= */

// ¿Un cambio de formato (DPA) cuenta como "línea funcionando"? Por ahora NO:
// durante el cambio la línea no está envasando. Si la planta decide lo
// contrario, basta con poner true aquí.
const UTIL_CUENTA_DPA = false;

const UTIL_STORAGE_KEY = "planUtilidades";
const UTIL_OPCIONES_DEFAULT = { calderaAlterna: "Caldera 2", elliot: "Elliot 1" };
const UTIL_CALDERAS_ALTERNAS = ["Caldera 2", "Caldera 6"];
const UTIL_ELLIOTS = ["Elliot 1", "Elliot 2"];

// Opciones elegidas por el usuario (caldera alterna y Elliot), guardadas en
// el navegador para no tener que elegirlas cada vez que se abre la app.
function utilLeerOpciones() {
  let guardadas = {};
  try {
    guardadas = JSON.parse(localStorage.getItem(UTIL_STORAGE_KEY) || "{}") || {};
  } catch (_) {}
  const op = { ...UTIL_OPCIONES_DEFAULT, ...guardadas };
  if (!UTIL_CALDERAS_ALTERNAS.includes(op.calderaAlterna))
    op.calderaAlterna = UTIL_OPCIONES_DEFAULT.calderaAlterna;
  if (!UTIL_ELLIOTS.includes(op.elliot)) op.elliot = UTIL_OPCIONES_DEFAULT.elliot;
  return op;
}
function utilGuardarOpciones(op) {
  try {
    localStorage.setItem(UTIL_STORAGE_KEY, JSON.stringify(op));
  } catch (_) {}
}

// Regla de CALDERAS según el número de líneas funcionando.
// Devuelve { clave, texto }: la clave fija el color de la barra.
function utilEquiposCaldera(n, op) {
  // Sin líneas envasando no hay demanda de vapor de envasado.
  if (n <= 0) return { clave: "cal-0", texto: "Sin caldera requerida" };
  // Una sola línea: la Caldera 5 sola alcanza.
  if (n === 1) return { clave: "cal-5", texto: "Caldera 5" };
  // Dos o más líneas: la Caldera 5 más la alterna elegida (2 o 6).
  return {
    clave: op.calderaAlterna === "Caldera 6" ? "cal-56" : "cal-52",
    texto: "Caldera 5 + " + op.calderaAlterna,
  };
}

// Regla de AIRE COMPRIMIDO según el número de líneas funcionando.
function utilEquiposAire(n, op) {
  // Sin líneas: solo el consumo base de la planta (Aire + Compresor E110).
  if (n <= 0) return { clave: "aire-0", texto: "Aire + Compresor E110" };
  // Una línea: el Sierra cubre la demanda.
  if (n === 1) return { clave: "aire-1", texto: "Sierra" };
  // Dos líneas: el Elliot elegido más el Centac.
  if (n === 2) return { clave: "aire-2", texto: op.elliot + " + Centac" };
  // Tres o cuatro líneas: el Elliot elegido más el Sierra.
  return { clave: "aire-3", texto: op.elliot + " + Sierra" };
}

// ¿Este bloque del Gantt significa que el tren está funcionando?
function utilBloqueFunciona(b) {
  if (!b) return false;
  if (b.type === "production") return true;
  return UTIL_CUENTA_DPA && b.type === "changeover";
}

// Calcula los tramos de calderas y de aire para todo el plan cargado.
// mergedByTrain: { "5": [bloques], "7": [...], ... } con {start, end, type}.
// Devuelve { calderas: [...], aire: [...] }, cada tramo con
// { start, end, clave, texto, lineasMin, lineasMax }.
function calcularUtilidades(mergedByTrain, opciones) {
  const op = opciones || utilLeerOpciones();
  const bloques = [];
  TRAINS.forEach((t) =>
    (mergedByTrain[t] || []).forEach((b) => {
      if (b && b.start && b.end && b.end > b.start) bloques.push({ ...b, train: t });
    }),
  );
  if (!bloques.length) return { calderas: [], aire: [] };

  // 1) Instantes donde puede cambiar el número de líneas funcionando.
  const instantes = [
    ...new Set(bloques.flatMap((b) => [b.start.getTime(), b.end.getTime()])),
  ].sort((a, b) => a - b);

  // 2) Para cada tramo entre dos instantes, cuántos trenes están funcionando
  //    (un tren cuenta una sola vez aunque tenga bloques solapados).
  const funcionando = bloques.filter(utilBloqueFunciona);
  const tramos = [];
  for (let i = 0; i < instantes.length - 1; i++) {
    const a = instantes[i];
    const z = instantes[i + 1];
    const trenes = new Set();
    funcionando.forEach((b) => {
      if (b.start.getTime() <= a && b.end.getTime() >= z) trenes.add(b.train);
    });
    tramos.push({ a, z, n: trenes.size });
  }

  // 3) y 4) Aplicar la regla y unir tramos seguidos con el mismo resultado,
  //    para que no queden barras partidas.
  const armar = (regla) => {
    const out = [];
    tramos.forEach(({ a, z, n }) => {
      const r = regla(n, op);
      const prev = out[out.length - 1];
      if (prev && prev.texto === r.texto && prev.end.getTime() === a) {
        prev.end = new Date(z);
        prev.lineasMin = Math.min(prev.lineasMin, n);
        prev.lineasMax = Math.max(prev.lineasMax, n);
      } else {
        out.push({
          start: new Date(a),
          end: new Date(z),
          clave: r.clave,
          texto: r.texto,
          lineasMin: n,
          lineasMax: n,
        });
      }
    });
    return out;
  };
  return { calderas: armar(utilEquiposCaldera), aire: armar(utilEquiposAire) };
}

// Texto "N línea(s)" de un tramo (con rango si el tramo une varios conteos).
function utilTextoLineas(t) {
  const n =
    t.lineasMin === t.lineasMax ? `${t.lineasMin}` : `${t.lineasMin} a ${t.lineasMax}`;
  return `${n} línea${t.lineasMax === 1 && t.lineasMin === 1 ? "" : "s"} funcionando`;
}

// Filas "UTILIDADES" (separador + CALDERAS + AIRE) para el Gantt de envasado.
// Usa la misma escala y el mismo rangeStart que los trenes, para que queden
// alineadas hora a hora con ellos.
function htmlFilasUtilidades(mergedByTrain, rangeStart, totalWidth, dayLinesHtml) {
  const util = calcularUtilidades(mergedByTrain, utilLeerOpciones());
  if (!util.calderas.length && !util.aire.length) return "";
  const rs = rangeStart.getTime();
  const barras = (tramos) =>
    tramos
      .map((t) => {
        const left = ((t.start.getTime() - rs) / 3600000) * GANTT_PX_PER_HOUR;
        const width = Math.max(
          3,
          ((t.end.getTime() - t.start.getTime()) / 3600000) * GANTT_PX_PER_HOUR,
        );
        const dur = fmtDuration(t.end - t.start);
        const title = escapeHtml(
          `${t.texto} · ${fmtDateTime(t.start)} → ${fmtDateTime(t.end)} (${dur}) · ${utilTextoLineas(t)}`,
        );
        const txt =
          width >= 22
            ? `<b>${escapeHtml(t.texto)}</b><span>${escapeHtml(dur)} · ${escapeHtml(utilTextoLineas(t))}</span>`
            : "";
        return `<div class="block util-block util-${t.clave}" style="left:${left}px; width:${width}px;" title="${title}">${txt}</div>`;
      })
      .join("");
  const fila = (label, sub, tramos) => `
        <div class="gantt-row util-row">
          <div class="lane-label">${label}<small>${sub}</small></div>
          <div class="lane-track" style="width:${totalWidth}px;">
            <div class="day-lines" style="left:0; width:${totalWidth}px;">${dayLinesHtml}</div>
            ${barras(tramos)}
          </div>
        </div>`;
  return `
        <div class="gantt-row util-sep">
          <div class="lane-label">UTILIDADES</div>
          <div class="util-sep-track" style="width:${totalWidth}px;"></div>
        </div>
        ${fila("CALDERAS", "vapor", util.calderas)}
        ${fila("AIRE", "comprimido", util.aire)}`;
}

// Barra de controles del apartado Utilidades: elegir caldera alterna y Elliot.
function htmlControlesUtilidades() {
  const op = utilLeerOpciones();
  const grupo = (campo, opciones, actual) =>
    opciones
      .map(
        (o) =>
          `<button type="button" class="btn small util-opt${o === actual ? " primary" : ""}" data-util-campo="${campo}" data-util-valor="${escapeHtml(o)}" aria-pressed="${o === actual}">${escapeHtml(o)}</button>`,
      )
      .join("");
  return `
    <div class="util-bar" id="utilidadesBar">
      <b class="util-title">Utilidades</b>
      <span class="util-ctl"><span class="util-ctl-label">Caldera alterna (2+ líneas)</span>${grupo("calderaAlterna", UTIL_CALDERAS_ALTERNAS, op.calderaAlterna)}</span>
      <span class="util-ctl"><span class="util-ctl-label">Elliot (2+ líneas)</span>${grupo("elliot", UTIL_ELLIOTS, op.elliot)}</span>
      <span class="util-note">DPA no cuenta como línea funcionando</span>
    </div>`;
}

// Ítems de leyenda de las filas de Utilidades.
function htmlLeyendaUtilidades() {
  const op = utilLeerOpciones();
  const items = [
    ["cal-0", "Sin caldera requerida"],
    ["cal-5", "Caldera 5"],
    [op.calderaAlterna === "Caldera 6" ? "cal-56" : "cal-52", "Caldera 5 + " + op.calderaAlterna],
    ["aire-0", "Aire + Compresor E110"],
    ["aire-1", "Sierra"],
    ["aire-2", op.elliot + " + Centac"],
    ["aire-3", op.elliot + " + Sierra"],
  ];
  return items
    .map(
      ([clave, label]) =>
        `<div class="item"><span class="sw util-block util-${clave}"></span>${escapeHtml(label)}</div>`,
    )
    .join("");
}

// Conecta los botones de la barra de Utilidades. `redibujar` vuelve a pintar
// el Gantt de envasado con las opciones nuevas (sin recargar el Excel).
function conectarControlesUtilidades(redibujar) {
  const bar = document.getElementById("utilidadesBar");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-util-campo]");
    if (!btn) return;
    const op = utilLeerOpciones();
    const campo = btn.dataset.utilCampo;
    if (op[campo] === btn.dataset.utilValor) return;
    op[campo] = btn.dataset.utilValor;
    utilGuardarOpciones(op);
    redibujar();
  });
}
