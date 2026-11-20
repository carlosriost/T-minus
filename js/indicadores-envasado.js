/* =========================================================================
   ENVASADO — GLY, LEF y OSE por línea (programados con el plan de envasado)
   -------------------------------------------------------------------------
   Modelo de tiempos de envasado (AB InBev):
     TT  Tiempo total ............ el calendario (aquí: lo que cubre el plan)
     NST Tiempo no programado .... sin programación / sin demanda
     ST  Tiempo programado ....... TT − NST
     DPA Paradas planeadas ....... cambios de líquido y de empaque,
                                   esterilizaciones, mantenimiento programado,
                                   inicio de producción
     LT  Tiempo de carga ......... ST − DPA
     EC  Causas externas ......... faltas de producto, de servicios, de
                                   material… (el plan no las trae: 0)
     EPT Tiempo efectivo ......... hL envasados ÷ velocidad nominal (hL/h):
                                   las horas que tomaría a velocidad nominal
   Indicadores:
     GLY = EPT ÷ ST         (rendimiento sobre el tiempo programado)
     LEF = EPT ÷ (LT − EC)  (eficiencia de la línea)
     OSE = EPT ÷ TT         (eficiencia sobre todo el tiempo)
   Con el plan, EC = 0 y las pérdidas por paros no planeados no existen: son
   los indicadores PROGRAMADOS. Los reales salen del reporte de la línea.
   Si un SKU no trae velocidad nominal en la hoja «Velocidad Eficiencia», su
   EPT se estima con la eficiencia del SKU (horas × eficiencia); si tampoco
   la trae, no se puede calcular y se dice.
   Solo lee el plan; no cambia ningún dato.
   ========================================================================= */
(function () {
  "use strict";
  const H = 3600000;
  const DESFASE = 2 * H; // el día de producción arranca a las 22:00
  let SEMANA = "todas";

  function tiemposLinea(t, desde, hasta) {
    const bloques = ((STATE.mergedByTrain || {})[t] || []).filter((b) => b.start && b.end);
    const r = { tt: 0, nst: 0, dpa: 0, prod: 0, ept: 0, eptFalta: 0, hl: 0, estimadoEf: 0 };
    if (!(hasta > desde)) return r;
    r.tt = (hasta - desde) / H;
    let cubierto = 0;
    bloques.forEach((b) => {
      const a = Math.max(desde, b.start.getTime());
      const z = Math.min(hasta, b.end.getTime());
      if (z <= a) return;
      const h = (z - a) / H;
      cubierto += h;
      if (b.type === "production") {
        const frac = (z - a) / (b.end.getTime() - b.start.getTime());
        const hl = (Number(b.hectolitros) || 0) * frac;
        const vel = Number(b.velocidad) || 0;
        const ef = Number(b.eficiencia) || 0;
        r.prod += h;
        r.hl += hl;
        if (vel > 0) r.ept += hl / vel;
        else if (ef > 0) {
          r.ept += h * Math.min(1, ef);
          r.estimadoEf += h;
        } else r.eptFalta += h;
      } else if (b.type === "idle") r.nst += h;
      else r.dpa += h; // DPA y otras actividades planeadas
    });
    // Horas dentro del plan sin ninguna fila: también es tiempo no programado.
    r.nst += Math.max(0, r.tt - cubierto);
    return r;
  }

  function indicadores(r) {
    const st = r.tt - r.nst;
    const lt = st - r.dpa;
    const ok = r.prod > 0 && r.eptFalta < 1e-9;
    return {
      ...r,
      st,
      lt,
      gly: ok && st > 0 ? r.ept / st : null,
      lef: ok && lt > 0 ? r.ept / lt : null,
      ose: ok && r.tt > 0 ? r.ept / r.tt : null,
    };
  }

  function sumar(lista) {
    const s = { tt: 0, nst: 0, dpa: 0, prod: 0, ept: 0, eptFalta: 0, hl: 0, estimadoEf: 0 };
    lista.forEach((r) => Object.keys(s).forEach((k) => (s[k] += r[k] || 0)));
    return s;
  }

  function calcular(w) {
    const todos = TRAINS.flatMap((t) => (STATE.mergedByTrain[t] || []).filter((b) => b.start && b.end));
    if (!todos.length) return null;
    const ini = Math.min(...todos.map((b) => b.start.getTime()));
    const fin = Math.max(...todos.map((b) => b.end.getTime()));
    const desde = w ? Math.max(ini, w.start - DESFASE) : ini;
    const hasta = w ? Math.min(fin, w.end - DESFASE) : fin;
    const lineas = TRAINS.map((t) => ({ t, ...indicadores(tiemposLinea(t, desde, hasta)) }));
    const planta = indicadores(sumar(lineas));
    return { desde, hasta, lineas, planta };
  }

  const pct = (v) => (v == null ? "—" : `${MOD_NF(v * 100, 1)} %`);
  const hh = (v) => MOD_NF(v, 1);

  function barra(r) {
    if (!(r.tt > 0)) return "";
    const seg = [
      ["ept", r.eptFalta > 0 ? 0 : r.ept, "Tiempo efectivo (EPT)"],
      ["perd", r.eptFalta > 0 ? r.prod : Math.max(0, r.prod - r.ept), r.eptFalta > 0 ? "Producción (sin velocidad para separar el EPT)" : "Producción por debajo de la velocidad nominal"],
      ["dpa", r.dpa, "Paradas planeadas (DPA)"],
      ["nst", r.nst, "No programado (NST)"],
    ];
    return `<div class="ie-barra">${seg
      .filter((s) => s[1] > 0.01)
      .map((s) => `<span class="ie-${s[0]}" style="width:${(s[1] / r.tt) * 100}%" title="${escapeHtml(`${s[2]}: ${hh(s[1])} h (${MOD_NF((s[1] / r.tt) * 100, 1)} % del tiempo)`)}"></span>`)
      .join("")}</div>`;
  }

  function fila(nombre, r, total) {
    return `<tr class="${total ? "ie-total" : ""}">
      <td class="ie-lin">${nombre}</td>
      <td class="num ie-kpi">${pct(r.gly)}</td>
      <td class="num ie-kpi">${pct(r.lef)}</td>
      <td class="num ie-kpi">${pct(r.ose)}</td>
      <td class="ie-bar-td">${barra(r)}</td>
      <td class="num">${hh(r.tt)}</td>
      <td class="num">${hh(r.nst)}</td>
      <td class="num">${hh(r.st)}</td>
      <td class="num">${hh(r.dpa)}</td>
      <td class="num">${hh(r.lt)}</td>
      <td class="num">${r.eptFalta > 0 ? "—" : hh(r.ept)}</td>
      <td class="num">${MOD_NF(r.hl)}</td>
    </tr>`;
  }

  function renderIndicadoresEnvasado() {
    const cont = document.getElementById("envasadoKpiPanel");
    if (!cont) return;
    if (typeof STATE === "undefined" || !STATE || !STATE.mergedByTrain) return modSinDatos(cont, "los indicadores de envasado");
    const semanas = typeof semanasAcuerdos === "function" ? semanasAcuerdos() : [];
    const w = semanas.find((s) => String(s.start) === SEMANA) || null;
    if (!w) SEMANA = "todas";
    const res = calcular(w);
    if (!res) return modSinDatos(cont, "los indicadores de envasado");
    const faltan = res.lineas.filter((l) => l.eptFalta > 0).map((l) => `TREN-${l.t}`);
    const estimadas = res.lineas.filter((l) => l.estimadoEf > 0 && !l.eptFalta).map((l) => `TREN-${l.t}`);
    const chips = [`<button class="pc-chip ${SEMANA === "todas" ? "on" : ""}" data-ie-sem="todas">Todo el plan</button>`]
      .concat(semanas.map((s) => `<button class="pc-chip ${String(s.start) === SEMANA ? "on" : ""}" data-ie-sem="${s.start}" title="${escapeHtml(s.label)}">${escapeHtml(s.corto)}</button>`))
      .join("");
    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Indicadores de envasado por línea</h3><span class="sub">Programados con el plan de envasado · ${escapeHtml(fmtDateTime(new Date(res.desde)))} → ${escapeHtml(fmtDateTime(new Date(res.hasta)))}</span></div>
        <div class="panel-body">
          <div class="gantt-intro">
            <p><b>Qué miden.</b> Los tres comparan el <b>tiempo efectivo (EPT)</b> —las horas que tomaría envasar los hL del plan a la velocidad nominal de la línea— contra un tiempo distinto:</p>
            <div class="gantt-intro-cols">
              <div><b>GLY</b> = EPT ÷ tiempo programado<br><small>Cuánto del tiempo en que la línea tiene programa se convierte en producción a velocidad nominal. Los cambios y mantenimientos programados le bajan.</small></div>
              <div><b>LEF</b> = EPT ÷ (tiempo de carga − causas externas)<br><small>La eficiencia de la línea mientras debería estar envasando: ya descuenta cambios y mantenimientos programados.</small></div>
              <div><b>OSE</b> = EPT ÷ tiempo total<br><small>Sobre todo el calendario: también le bajan las horas sin programación (NST).</small></div>
            </div>
            <p class="gantt-intro-pie">Tiempo programado = total − no programado (NST). Tiempo de carga = programado − paradas planeadas (DPA). Con el plan no hay causas externas ni paros no planeados, así que estos son los valores <b>programados</b>; los reales salen del reporte de la línea.</p>
          </div>
          <div class="pc-filtros"><div class="pc-fgrupo"><span class="pc-flab">Periodo</span>${chips}</div></div>
          ${faltan.length ? `<div class="pvr-falta"><b>Sin velocidad nominal en ${escapeHtml(faltan.join(", "))}.</b> Algunos SKU no traen velocidad ni eficiencia en la hoja «Velocidad Eficiencia» del instructivo, así que no se puede calcular el tiempo efectivo de esa línea.</div>` : ""}
          <div class="table-scroll"><table class="ie-tabla">
            <thead><tr><th>Línea</th><th class="num">GLY</th><th class="num">LEF</th><th class="num">OSE</th><th>Uso del tiempo</th><th class="num">Total (h)</th><th class="num">NST (h)</th><th class="num">Programado (h)</th><th class="num">DPA (h)</th><th class="num">De carga (h)</th><th class="num">Efectivo EPT (h)</th><th class="num">hL</th></tr></thead>
            <tbody>${res.lineas.map((l) => fila(`TREN-${l.t}`, l)).join("")}${fila("Planta", res.planta, true)}</tbody>
          </table></div>
          <div class="legend ie-ley"><div class="item"><span class="sw ie-ept"></span>Tiempo efectivo (EPT)</div><div class="item"><span class="sw ie-perd"></span>Producción por debajo de la velocidad nominal</div><div class="item"><span class="sw ie-dpa"></span>Paradas planeadas (DPA)</div><div class="item"><span class="sw ie-nst"></span>No programado (NST)</div></div>
          <p class="acu-nota">El día de producción va de las 22:00 a las 22:00 y la semana de lunes a domingo. Planta suma las horas de las cuatro líneas.${estimadas.length ? ` En ${escapeHtml(estimadas.join(", "))} algunos SKU no traen velocidad nominal: su tiempo efectivo se estimó con la eficiencia del SKU.` : ""}</p>
        </div>
      </div>`;
    cont.querySelectorAll("[data-ie-sem]").forEach((b) =>
      b.addEventListener("click", () => {
        SEMANA = b.dataset.ieSem;
        renderIndicadoresEnvasado();
      }),
    );
  }

  window.renderIndicadoresEnvasado = renderIndicadoresEnvasado;
  window.indicadoresEnvasado = calcular;
})();
