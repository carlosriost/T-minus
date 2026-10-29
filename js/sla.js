/* =========================================================================
   SLA PLANTA — acuerdos de nivel de servicio (los marcados en VERDE)
   -------------------------------------------------------------------------
   Fuente: «SLA_Planta_corregido.xlsx», hoja «SLA Planta». Se toman SOLO los
   acuerdos cuya celda «Acuerdos» (columna C) tiene relleno verde (color de
   tema accent6, #70AD47): son 15 de los 100. El resto (azul claro, amarillo,
   blanco o sin color) no se incluye.

   Cada acuerdo se mide, cuando se puede, sobre lo que T-minus ya calcula:
     · la programación de cocinas (secuencia de cocimientos),
     · el plan de envasado cargado (líneas, formatos, hL),
     · el plan de filtración (si se llenó),
     · y los acuerdos de Elaboración que ya mide acuerdos.js (se reutilizan).
   Además se muestra el histórico OK/NOK semanal que trae el Excel (S1…S37),
   tal como está registrado, para comparar.
   ========================================================================= */

const SLA_LS_KEY = "planSlaPlanta";

// Histórico: una letra por semana desde S1 → o = OK, x = NOK, - = NA, . = sin dato.
const SLA_PLANTA_VERDES = [
  { n: 1, reunion: "W+1", texto: "Después de paradas programadas de cocinas se debe iniciar con mostos de Cerveza, no iniciar con Malta", area: "Elaboración", responsable: "Elaboración", indicador: "CO2", historico: "xoooooxooxooxooxooxooxooxooxooxoooxox" },
  { n: 3, reunion: "W+1", texto: "Fijar la cantidad de cambios entre cocimientos de Pony - Cerveza a máximo 4 por semana (Evitar mucha alternancia entre Pony y marcas de cerveza)", area: "Elaboración", responsable: "Elaboración", indicador: "AGUA", historico: "ooooxoooooooooooooooooooooooooooooxoo" },
  { n: 9, reunion: "W+1", texto: "Evitar finalizar la producción de cocinas con la marca Pony.", area: "Elaboración", responsable: "Elaboración/Logística", indicador: "HEAT/AGUA", historico: "oooooxooxxoooxoxxxoxxooooooooooooooxo" },
  { n: 10, reunion: "W+1", texto: "Los bloques de producción de Pony Malta deberán contemplar como mínimo dos cocimientos consecutivos. (4100 hL mínimo)", area: "Elaboración", responsable: "Elaboración/Logística", indicador: "HEAT/AGUA", historico: "xoooooooooooxooooooooooooxxoxxoxooooo" },
  { n: 11, reunion: "W+1", texto: "No desprogramar las líneas de tal manera que las paradas no sean superiores a dos días, con el fin de evitar consumos de CO₂ sin producción.", area: "Elaboración", responsable: "Elaboración/Logística", indicador: "CO2", historico: "..........................ooooooooooo" },
  { n: 12, reunion: "W+1", texto: "El volumen programado de Pony Malta no deberá superar los 23600 hL por semana.", area: "Elaboración", responsable: "Elaboración/Logística", indicador: "CO2", historico: "..........................oooxxxooooo" },
  { n: 13, reunion: "W+1", texto: "El tiempo de maduración no deberá exceder los 4 días. Garantizar que se filtre un bloque completo de cada marca", area: "Elaboración", responsable: "Elaboración/Logística", indicador: "HEAT/AGUA", historico: "..........................oooooooooxo" },
  { n: 19, reunion: "W+1", texto: "Se debera contar con un inventario máximo en BBT de 5000 hL de una marca diferente antes de iniciar a filtrar otro SKU.", area: "Elaboración", responsable: "Elaboración/Logística", indicador: "HEAT/AGUA", historico: "..........................ooooxooooxo" },
  { n: 26, reunion: "W+1", texto: "Cumplimiento de ciclos de filtración programados superiores a 5 000 hL de cerveza/malta", area: "Filtración", responsable: "Logística", indicador: "CO2", historico: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..o.o" },
  { n: 34, reunion: "W+1", texto: "Garantizar Mix de Formatos en las lineas de producción L5. 175 cc: 7500 hl, 250cc: 5000 hl, 330cc, 4000 hl", area: "Logística", responsable: "Logística", indicador: "OSE", historico: ".........................ooooooo..ooo" },
  { n: 35, reunion: "W+1", texto: "Garantizar cambios de marca en las lineas de producción L7. 1000cc: 7000 hl", area: "Logística", responsable: "Logística", indicador: "OSE", historico: ".........................ooooooo..o.o" },
  { n: 36, reunion: "W+1", texto: "Garantizar cambos de marca en las lineas de producción L8. 330cc: 6000 hl", area: "Logística", responsable: "Logística", indicador: "OSE", historico: ".........................ooooooo..o.o" },
  { n: 37, reunion: "W+1", texto: "Garantizar Mix de Formatos en las lineas de producción L9 . 200cc: 2000hl, 330cc: 3000hl, 1L: 4500hl, 1,5L: 4500hl, 2L: 4500hl", area: "Logística", responsable: "Logística", indicador: "OSE", historico: ".........................ooooooo..ooo" },
  { n: 39, reunion: "W+1", texto: "Garantizar balance inferior al 5% entre hectolitros cocinados vs hectolitros envasados", area: "Logística", responsable: "Logística", indicador: "E&F", historico: ".........................ooooooo..ooo" },
  { n: 40, reunion: "W+1", texto: "Garantizar balance inferior al 20% entre hectolitros de Pony malta y Cerveza", area: "Logística", responsable: "Logística", indicador: "E&F", historico: ".........................ooooooo..xoo" },
];

// Mínimos de corrida por formato en cada línea (acuerdos 34 a 37). La clave es
// el tamaño en mL. En L5 y L9 se agrupa por FORMATO ("mix de formatos"); en L7 y
// L8 por SKU, porque el acuerdo habla de "cambios de marca".
const SLA_MIX_LINEAS = {
  34: { tren: "5", agrupar: "formato", minimos: { 175: 7500, 250: 5000, 330: 4000 } },
  35: { tren: "7", agrupar: "sku", minimos: { 1000: 7000 } },
  36: { tren: "8", agrupar: "sku", minimos: { 330: 6000 } },
  37: { tren: "9", agrupar: "formato", minimos: { 200: 2000, 330: 3000, 1000: 4500, 1500: 4500, 2000: 4500 } },
};

// Acuerdos que ya mide acuerdos.js (Elaboración): SLA n.º → regla n.º.
const SLA_A_REGLA = { 9: 3, 10: 4, 11: 5, 12: 6, 13: 7, 19: 13 };

function slaPesos() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(SLA_LS_KEY) || "null");
  } catch (_) {}
  const p = {};
  SLA_PLANTA_VERDES.forEach((a) => {
    const v = g && g[a.n] != null ? Number(g[a.n]) : 1;
    p[a.n] = isFinite(v) && v >= 0 ? v : 1;
  });
  return p;
}
function slaGuardarPesos(p) {
  try {
    localStorage.setItem(SLA_LS_KEY, JSON.stringify(p));
  } catch (_) {}
}

// Tamaño en mL de un SKU a partir de su nombre ("330cc", "1,5L", "Pet 1 0L").
function tamanoMl(nombre) {
  const n = normalizeText(nombre || "");
  let m = n.match(/(\d+(?:[.,]\d+)?)\s*(cc|ml)\b/);
  if (m) return Math.round(Number(m[1].replace(",", ".")));
  m = n.match(/(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litro|litros)\b/);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * 1000);
  m = n.match(/\b(\d)\s+(\d)l\b/);
  if (m) return Number(m[1]) * 1000 + Number(m[2]) * 100;
  return null;
}

// Semana ISO (lunes a domingo) de un instante en hora de planta.
function semanaCalendario(ms) {
  const d = new Date(ms);
  const dia = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia);
}

function evaluarSLA() {
  const pesos = slaPesos();
  const seq = STATE && STATE.seq;
  const plan = STATE && STATE.plan;
  const coc = ((seq && seq.rows) || []).filter((r) => r.tipo === "cocimiento").sort((a, b) => a.start - b.start);
  const medido = {};
  const add = (n, cumplimiento, medida, detalle) => (medido[n] = { cumplimiento, medida, detalle });
  const nf = MOD_NF;

  /* SLA 1 — después de una parada de cocinas arrancar con cerveza, no con malta.
     Arranque = primer cocimiento de la programación y todo cocimiento que llega
     después de 12 h o más sin cargar la cocina. */
  if (coc.length) {
    const arranques = [coc[0]];
    for (let i = 1; i < coc.length; i++)
      if (coc[i].start - coc[i - 1].start >= 12 * 3600000) arranques.push(coc[i]);
    const conMalta = arranques.filter((r) => esMostoPony(r.mostoId));
    add(
      1,
      Math.round(((arranques.length - conMalta.length) / arranques.length) * 100),
      `${conMalta.length} de ${arranques.length} arranques con malta`,
      conMalta.length
        ? `Arrancan con malta: ${conMalta.map((r) => fmtDateTime(r.start)).join(", ")}.`
        : `Los ${arranques.length} arranques de cocina (inicio y después de paradas de 12 h o más) son con cerveza.`,
    );
  }

  /* SLA 3 — máximo 4 cambios Pony ↔ cerveza por semana de cocimientos. */
  if (coc.length) {
    const porSemana = {};
    for (let i = 1; i < coc.length; i++) {
      if (esMostoPony(coc[i].mostoId) !== esMostoPony(coc[i - 1].mostoId)) {
        const s = semanaCalendario(coc[i].start.getTime());
        porSemana[s] = (porSemana[s] || 0) + 1;
      }
    }
    const semanas = [...new Set(coc.map((r) => semanaCalendario(r.start.getTime())))];
    const notas = semanas.map((s) => ({ s, n: porSemana[s] || 0 }));
    const cumpl = notas.reduce((a, x) => a + Math.max(0, 100 - Math.max(0, x.n - 4) * 25), 0) / notas.length;
    const peor = notas.reduce((m, x) => (x.n > m.n ? x : m), notas[0]);
    add(
      3,
      Math.round(cumpl),
      `máx. ${peor.n} cambios en una semana`,
      notas.map((x) => `semana del ${fmtDate(new Date(x.s))}: ${x.n}`).join(" · ") + ". Cada cambio de más de 4 resta 25 puntos a esa semana.",
    );
  }

  /* SLA 9, 10, 11, 12, 13, 19 — los mide el tablero de Elaboración. */
  if (typeof evaluarAcuerdos === "function" && plan) {
    const ev = evaluarAcuerdos(plan, seq);
    Object.keys(SLA_A_REGLA).forEach((n) => {
      const f = ev.filas.find((x) => x.id === SLA_A_REGLA[n]);
      if (f && f.medible) add(Number(n), f.cumplimiento, f.medida, `${f.detalle} (Medido como el acuerdo ${f.id} de Elaboración.)`);
    });
  }

  /* SLA 26 — ciclos de filtración de más de 5.000 hL (plan de filtración). */
  if (typeof buildFiltracionPlanes === "function") {
    let planes = null;
    try {
      planes = buildFiltracionPlanes();
    } catch (_) {}
    const ciclos = [];
    if (planes && planes.porFiltro)
      Object.keys(planes.porFiltro).forEach((f) => {
        const p = planes.porFiltro[f];
        if (!p || !p.ok) return;
        let c = null;
        (p.segments || []).forEach((s) => {
          if (s.tipo === "fil") {
            c = c || { filtro: f, hl: 0, cerrado: false };
            c.hl += Number(s.hl) || 0;
          } else if ((s.tipo === "cambio" || s.tipo === "cip") && c) {
            c.cerrado = true;
            ciclos.push(c);
            c = null;
          }
        });
        if (c) ciclos.push(c);
      });
    const cuentan = ciclos.filter((c) => c.cerrado || c.hl >= 5000);
    if (cuentan.length) {
      const ok = cuentan.filter((c) => c.hl >= 5000);
      add(
        26,
        Math.round((ok.length / cuentan.length) * 100),
        `${ok.length} de ${cuentan.length} ciclos`,
        `Ciclos de filtración programados: ${cuentan.map((c) => `${c.filtro} ${nf(c.hl)} hL`).join("; ")}.`,
      );
    }
  }

  /* SLA 34 a 37 — corridas mínimas por formato en L5, L7, L8 y L9. */
  if (STATE && STATE.mergedByTrain) {
    const prod = bloquesProduccion();
    Object.keys(SLA_MIX_LINEAS).forEach((n) => {
      const cfg = SLA_MIX_LINEAS[n];
      const bs = prod.filter((b) => b.tren === cfg.tren);
      const corridas = [];
      bs.forEach((b) => {
        const ml = tamanoMl(b.nombre);
        const clave = cfg.agrupar === "formato" ? b.formato : b.codigo || b.nombre;
        const prev = corridas[corridas.length - 1];
        if (prev && prev.clave === clave) prev.hl += b.hl;
        else corridas.push({ clave, ml, hl: b.hl, nombre: cfg.agrupar === "formato" ? b.formato : b.nombre });
      });
      const evaluables = corridas.filter((c) => c.ml && cfg.minimos[c.ml] != null);
      if (!evaluables.length) {
        if (bs.length)
          add(Number(n), null, "—", `TREN-${cfg.tren} no envasa en este plan ninguno de los formatos del acuerdo.`);
        return;
      }
      const ok = evaluables.filter((c) => c.hl >= cfg.minimos[c.ml]);
      add(
        Number(n),
        Math.round((ok.length / evaluables.length) * 100),
        `${ok.length} de ${evaluables.length} corridas`,
        `TREN-${cfg.tren}: ` + evaluables.map((c) => `${c.nombre} ${nf(c.hl)} hL (mín. ${nf(cfg.minimos[c.ml])})${c.hl >= cfg.minimos[c.ml] ? " ✓" : " ✗"}`).join("; ") + ".",
      );
    });
  }

  /* SLA 39 — balance < 5 % entre hL cocinados y hL envasados.
     Cocinado = cocimientos × hL por cocimiento × factor de dilución (más lo que
     cubre el inventario), contra lo que pide el plan de envasado. */
  if (plan && plan.results && plan.results.length) {
    let env = 0;
    let prodHL = 0;
    plan.results.forEach((r) => {
      const m = MOSTO_CATALOG.find((x) => x.id === r.mostoId) || {};
      env += Number(r.volumenEnvasar) || 0;
      prodHL += (Number(r.numCocimientos) || 0) * (Number(m.volumenPorCocimiento) || 0) * (Number(m.factorDilucion) || 1) + (Number(r.inventarioUsadoHL) || 0);
    });
    if (env > 0) {
      const desv = (Math.abs(prodHL - env) / env) * 100;
      add(
        39,
        desv <= 5 ? 100 : Math.max(0, Math.round(100 - (desv - 5) * 10)),
        `${nf(desv, 1)} % de diferencia`,
        `Cocinado (diluido) + inventario: ${nf(prodHL)} hL · a envasar: ${nf(env)} hL. La diferencia viene de redondear a cocimientos completos. Cada punto por encima de 5 % resta 10.`,
      );
    }

    /* SLA 40 — balance < 20 % entre Pony y cerveza. Se interpreta como la
       participación de Pony en el volumen a envasar. */
    const pony = plan.results.filter((r) => esMostoPony(r.mostoId)).reduce((a, r) => a + (Number(r.volumenEnvasar) || 0), 0);
    if (env > 0) {
      const pct = (pony / env) * 100;
      add(
        40,
        pct <= 20 ? 100 : Math.max(0, Math.round(100 - (pct - 20) * 5)),
        `Pony ${nf(pct, 1)} % del total`,
        `Pony ${nf(pony)} hL de ${nf(env)} hL a envasar. Interpretación: la Pony no debe pasar del 20 % del volumen (confirmar con Logística). Cada punto por encima resta 5.`,
      );
    }
  }

  const filas = SLA_PLANTA_VERDES.map((a) => {
    const e = medido[a.n];
    const medible = !!e && e.cumplimiento != null;
    const peso = medible ? pesos[a.n] : 0;
    const hist = a.historico.split("");
    const ok = hist.filter((c) => c === "o").length;
    const nok = hist.filter((c) => c === "x").length;
    return {
      ...a,
      id: a.n,
      medible,
      peso,
      pesoConfig: pesos[a.n],
      cumplimiento: medible ? e.cumplimiento : null,
      estado: !medible ? "sin-datos" : e.cumplimiento >= 90 ? "cumple" : e.cumplimiento >= 60 ? "parcial" : "critico",
      medida: e ? e.medida : "—",
      detalle: e
        ? e.detalle
        : a.n === 19
          ? "Pide el inventario de BBT por marca justo antes de cada filtración; T-minus todavía no lo calcula. Se sigue en el histórico del Excel."
          : a.n === 26
            ? "Llena el Gantt de filtración (flujo, I0, tamaño de ciclo y secuencia) para medirlo."
            : "Carga el plan de envasado (y la programación de cocinas) para medirlo.",
      histOk: ok,
      histNok: nok,
      histPct: ok + nok ? Math.round((ok / (ok + nok)) * 100) : null,
    };
  });
  const med = filas.filter((f) => f.medible);
  const pesoTot = med.reduce((a, f) => a + f.peso, 0);
  const score = pesoTot ? med.reduce((a, f) => a + f.peso * f.cumplimiento, 0) / pesoTot : null;
  return {
    filas,
    medibles: med,
    sinDatos: filas.filter((f) => !f.medible),
    score,
    cumplidos: med.filter((f) => f.estado === "cumple").length,
    parciales: med.filter((f) => f.estado === "parcial").length,
    criticos: med.filter((f) => f.estado === "critico").length,
  };
}

function slaTiraHistorico(h) {
  return `<div class="sla-hist" title="Histórico del Excel SLA Planta: verde OK, rojo NOK, gris sin registro">${h.historico
    .split("")
    .map((c, i) => `<span class="sla-h ${c === "o" ? "ok" : c === "x" ? "nok" : c === "-" ? "na" : ""}" title="S${i + 1}: ${c === "o" ? "OK" : c === "x" ? "NOK" : c === "-" ? "NA" : "sin registro"}"></span>`)
    .join("")}</div>`;
}

function renderSLAPlanta(cont) {
  const ev = evaluarSLA();
  const score = ev.score == null ? null : Math.round(ev.score);
  const col = colorScore(score);
  const EST = typeof ACUERDOS_ESTADO !== "undefined" ? ACUERDOS_ESTADO : {};
  const nMed = ev.medibles.length;
  const histTot = ev.filas.reduce((a, f) => a + f.histOk + f.histNok, 0);
  const histOk = ev.filas.reduce((a, f) => a + f.histOk, 0);
  const kpis =
    modKpi("◎", "Score SLA (plan actual)", score == null ? "—" : `${score} <small>/ 100</small>`, `${nMed} de ${ev.filas.length} acuerdos medibles con los archivos cargados`, col) +
    modKpi("✓", "Cumplen", `${ev.cumplidos} <small>de ${nMed}</small>`, "≥ 90 % de cumplimiento", "var(--ok)") +
    modKpi("⚠", "Críticos", String(ev.criticos), "< 60 % de cumplimiento", ev.criticos ? "var(--danger)" : "var(--muted)") +
    modKpi("▤", "Histórico del Excel", histTot ? `${Math.round((histOk / histTot) * 100)}%` : "—", `OK en ${histOk} de ${histTot} registros semanales (meta 85 %)`, histTot && histOk / histTot >= 0.85 ? "var(--ok)" : "var(--warn)");

  const ordenEst = { critico: 0, parcial: 1, cumple: 2, "sin-datos": 3 };
  const filas = ev.filas
    .slice()
    .sort((a, b) => ordenEst[a.estado] - ordenEst[b.estado] || a.n - b.n)
    .map((f) => {
      const e = EST[f.estado] || { txt: f.estado, color: "var(--muted)", icono: "" };
      return `<tr>
        <td class="acu-c"><b>${f.n}</b></td>
        <td class="acu-nom">${escapeHtml(f.texto)}<div class="acu-det">${f.medida && f.medida !== "—" ? escapeHtml(f.medida) + " · " : ""}${escapeHtml(f.detalle)}</div></td>
        <td class="rec-imp">${escapeHtml(f.area)}<div class="acu-det">Resp.: ${escapeHtml(f.responsable)}</div></td>
        <td class="acu-c"><span class="sla-ind">${escapeHtml(f.indicador)}</span></td>
        <td class="acu-c"><input type="number" class="acu-pond" data-sla-peso="${f.n}" min="0" step="1" value="${f.pesoConfig}" title="Peso del acuerdo en el score" /></td>
        <td class="acu-c">${f.medible ? `<div class="acu-bar"><span style="width:${f.cumplimiento}%;background:${e.color};"></span></div><small>${MOD_NF(f.cumplimiento)}%</small>` : '<span style="color:var(--muted);">—</span>'}</td>
        <td class="acu-c"><span class="acu-tag" style="color:${e.color};border-color:${e.color};">${e.icono} ${e.txt}</span></td>
        <td>${slaTiraHistorico(f)}<div class="acu-det">${f.histPct == null ? "Sin registros" : `${f.histPct}% OK (${f.histOk}/${f.histOk + f.histNok})`}</div></td>
      </tr>`;
    })
    .join("");

  // Cumplimiento histórico por indicador (CO2, AGUA, HEAT/AGUA, OSE, E&F).
  const porInd = {};
  ev.filas.forEach((f) => {
    const k = f.indicador;
    porInd[k] = porInd[k] || { ok: 0, tot: 0, n: 0 };
    porInd[k].ok += f.histOk;
    porInd[k].tot += f.histOk + f.histNok;
    porInd[k].n++;
  });
  const barrasInd = modBarras(
    Object.entries(porInd).map(([k, v], i) => ({
      label: `${k} (${v.n})`,
      valor: v.tot ? Math.round((v.ok / v.tot) * 100) : 0,
      color: MOD_PALETA[i % MOD_PALETA.length],
    })),
    "% OK",
  );

  cont.innerHTML = `
    <div class="acu-kpis">${kpis}</div>
    <div class="acu-card">
      <div class="acu-card-tit">Acuerdos SLA Planta en verde (${ev.filas.length}) <small style="color:var(--muted);font-weight:400;">· medidos sobre el plan actual · histórico tal como viene en el Excel</small></div>
      <div class="table-scroll mod-noclip"><table class="acu-tabla sla-tabla"><thead><tr><th class="acu-c">#</th><th>Acuerdo</th><th>Área</th><th class="acu-c">Indicador</th><th class="acu-c">Peso</th><th class="acu-c">Cumplimiento</th><th class="acu-c">Estado</th><th>Histórico S1→S${SLA_PLANTA_VERDES.reduce((m, a) => Math.max(m, a.historico.length), 0)}</th></tr></thead><tbody>${filas}</tbody></table></div>
    </div>
    <div class="vol-grid3">
      <div class="acu-card"><div class="acu-card-tit">Plan actual</div>${modAnillo(
        [
          { label: "Cumple", valor: ev.cumplidos, color: "var(--ok)" },
          { label: "Parcial", valor: ev.parciales, color: "var(--warn)" },
          { label: "Crítico", valor: ev.criticos, color: "var(--danger)" },
          { label: "Sin datos", valor: ev.sinDatos.length, color: "var(--muted)" },
        ].filter((p) => p.valor > 0),
        score == null ? "—" : String(score),
        "/ 100",
      )}</div>
      <div class="acu-card"><div class="acu-card-tit">Histórico del Excel por indicador</div>${barrasInd}</div>
      <div class="acu-card"><div class="acu-card-tit">Cómo se mide</div><p class="acu-nota" style="margin-top:0;">Solo entran los acuerdos con la celda en verde en «SLA Planta». Los acuerdos 9, 10, 11, 12, 13 y 19 son los mismos de Elaboración y reutilizan esa medición. Score = promedio ponderado por «Peso» de los acuerdos medibles. Un acuerdo sin datos no castiga el score.</p></div>
    </div>`;
  cont.querySelectorAll("[data-sla-peso]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const p = slaPesos();
      const v = Number(inp.value);
      p[inp.dataset.slaPeso] = isFinite(v) && v >= 0 ? v : 1;
      slaGuardarPesos(p);
      renderAcuerdosLogistica();
    }),
  );
}
