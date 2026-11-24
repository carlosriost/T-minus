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
   Velocidad nominal (botellas por hora, dadas por la planta y editables en
   la página): L5 65.000, L7 19.000, L8 72.000; L9 según el formato:
   200 y 330 cc 42.000, 1000 cc 24.000, 1500 cc 18.000, 2000 cc 14.000.
   hL/h = botellas/h × mL de la botella ÷ 100.000.
   Si no se puede (formato sin velocidad o tamaño que no se lee del nombre),
   se usa la velocidad de la hoja «Velocidad Eficiencia» del instructivo, y
   si tampoco está, la eficiencia del SKU (horas × eficiencia); si no hay
   nada, no se puede calcular y se dice.
   Solo lee el plan; no cambia ningún dato.
   ========================================================================= */
(function () {
  "use strict";
  const H = 3600000;
  const DESFASE = 2 * H; // el día de producción arranca a las 22:00
  let SEMANA = "todas";

  const VEL_KEY = "planVelocidadesEnvasado";
  const VEL_DEFECTO = {
    linea: { 5: 65000, 7: 19000, 8: 72000 },
    l9: { 200: 42000, 330: 42000, 1000: 24000, 1500: 18000, 2000: 14000 },
  };
  function velConfig() {
    const c = JSON.parse(JSON.stringify(VEL_DEFECTO));
    try {
      const g = JSON.parse(localStorage.getItem(VEL_KEY) || "null");
      if (g && typeof g === "object")
        ["linea", "l9"].forEach((k) =>
          Object.keys(c[k]).forEach((x) => {
            const v = Number(g[k] && g[k][x]);
            if (isFinite(v) && v > 0) c[k][x] = v;
          }),
        );
    } catch (_) {}
    return c;
  }
  // mL de la botella a partir del nombre del SKU ("330cc", "200ccX30", "1.5L").
  function mlDe(nombre) {
    const n = String(nombre || "").toLowerCase();
    let m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:cc|ml)/);
    if (m) return Math.round(Number(m[1].replace(",", ".")));
    m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litros?)\b/);
    if (m) return Math.round(Number(m[1].replace(",", ".")) * 1000);
    return null;
  }
  // Velocidad nominal en hL/h según la planta, o null si no aplica.
  function velPlanta(t, nombre, cfg) {
    const ml = mlDe(nombre);
    if (!ml) return null;
    const bph = String(t) === "9" ? cfg.l9[ml] : cfg.linea[t];
    return bph > 0 ? (bph * ml) / 100000 : null;
  }

  function tiemposLinea(t, desde, hasta) {
    const bloques = ((STATE.mergedByTrain || {})[t] || []).filter((b) => b.start && b.end);
    const r = { tt: 0, nst: 0, dpa: 0, prod: 0, ept: 0, eptFalta: 0, hl: 0, estimadoEf: 0, velInstr: 0 };
    if (!(hasta > desde)) return r;
    const cfg = velConfig();
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
        const vp = velPlanta(t, b.name, cfg);
        const vel = vp || Number(b.velocidad) || 0;
        const ef = Number(b.eficiencia) || 0;
        r.prod += h;
        r.hl += hl;
        if (vel > 0) {
          r.ept += hl / vel;
          if (!vp) r.velInstr += h;
        } else if (ef > 0) {
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
    const s = { tt: 0, nst: 0, dpa: 0, prod: 0, ept: 0, eptFalta: 0, hl: 0, estimadoEf: 0, velInstr: 0 };
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
    const conInstr = res.lineas.filter((l) => l.velInstr > 0).map((l) => `TREN-${l.t}`);
    const vc = velConfig();
    const inV = (k, x) => `<input type="number" class="acu-pond ie-vel" data-ie-vel="${k}.${x}" min="1" step="500" value="${vc[k][x]}">`;
    const tablaVel = `<div class="ie-vel-grid">
        <table class="acu-tabla"><thead><tr><th>Línea</th><th class="acu-c">Botellas / hora</th></tr></thead><tbody>${Object.keys(vc.linea)
          .map((x) => `<tr><td>L${x}</td><td class="acu-c">${inV("linea", x)}</td></tr>`)
          .join("")}</tbody></table>
        <table class="acu-tabla"><thead><tr><th>L9 · formato</th><th class="acu-c">Botellas / hora</th></tr></thead><tbody>${Object.keys(vc.l9)
          .map((x) => `<tr><td>${x} cc</td><td class="acu-c">${inV("l9", x)}</td></tr>`)
          .join("")}</tbody></table>
      </div>
      <p class="acu-nota">hL/h = botellas por hora × mL de la botella ÷ 100.000 (el tamaño sale del nombre del SKU). Se guardan en este navegador y viajan en el paquete de la semana.${conInstr.length ? ` En ${escapeHtml(conInstr.join(", "))} algún formato no tiene velocidad aquí: se usó la del instructivo.` : ""}</p>
      <button type="button" class="btn small" data-ie-vel-reset>Restaurar velocidades de la planta</button>`;
    const chips = [`<button class="pc-chip ${SEMANA === "todas" ? "on" : ""}" data-ie-sem="todas">Todo el plan</button>`]
      .concat(semanas.map((s) => `<button class="pc-chip ${String(s.start) === SEMANA ? "on" : ""}" data-ie-sem="${s.start}" title="${escapeHtml(s.label)}">${escapeHtml(s.corto)}</button>`))
      .join("");
    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Indicadores de envasado por línea</h3><span class="sub">Programados con el plan de envasado · ${escapeHtml(fmtDateTime(new Date(res.desde)))} → ${escapeHtml(fmtDateTime(new Date(res.hasta)))}</span></div>
        <div class="panel-body">
          <div class="gantt-intro">
            <p><b>Qué miden.</b> Los tres comparan el <b>tiempo efectivo (EPT)</b> —las horas que tomaría envasar los hL del plan a la velocidad nominal de la línea (botellas por hora de la planta, abajo)— contra un tiempo distinto:</p>
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
          ${pliegue("ie-vel", "Velocidades nominales usadas", tablaVel, `L5 ${MOD_NF(vc.linea[5])} · L7 ${MOD_NF(vc.linea[7])} · L8 ${MOD_NF(vc.linea[8])} bot/h · L9 según formato`)}
          <p class="acu-nota">El día de producción va de las 22:00 a las 22:00 y la semana de lunes a domingo. Planta suma las horas de las cuatro líneas.${estimadas.length ? ` En ${escapeHtml(estimadas.join(", "))} algunos SKU no traen velocidad nominal: su tiempo efectivo se estimó con la eficiencia del SKU.` : ""}</p>
        </div>
      </div>`;
    cont.querySelectorAll("[data-ie-vel]").forEach((inp) =>
      inp.addEventListener("change", () => {
        const c = velConfig();
        const [k, x] = inp.dataset.ieVel.split(".");
        const v = Number(inp.value);
        if (isFinite(v) && v > 0) c[k][x] = v;
        try {
          localStorage.setItem(VEL_KEY, JSON.stringify(c));
        } catch (_) {}
        renderIndicadoresEnvasado();
      }),
    );
    const rst = cont.querySelector("[data-ie-vel-reset]");
    if (rst)
      rst.addEventListener("click", () => {
        try {
          localStorage.removeItem(VEL_KEY);
        } catch (_) {}
        renderIndicadoresEnvasado();
      });
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
