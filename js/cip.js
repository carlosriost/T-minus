/* =========================================================================
   CIP A/B/C — clasificación de equipos por agua de CIP
   -------------------------------------------------------------------------
   El catálogo de equipos ya trae, por tanque, el agua promedio de un CIP, su
   capacidad, el índice agua/capacidad y una categoría A/B/C (A = menos agua
   por hL de capacidad). La asignación de tanques usa esa categoría como
   prioridad: llena primero los A. Este módulo la hace visible:
     · Clasificación A/B/C con su criterio (rangos de índice por tipo).
     · Cuántos CIP pide la programación actual en cada tanque y cuánta agua
       estimada suma (usos × agua promedio por CIP).
   ========================================================================= */

let CIP_FILTRO = "todos";
const CIP_COLOR = { A: "var(--ok)", B: "var(--warn)", C: "var(--danger)" };

// Ocupaciones (bandas) por equipo en la asignación actual: los lotes que se
// solapan en el mismo tanque son UNA ocupación y por tanto un solo CIP después.
function ocupacionesPorEquipo(assignment) {
  const por = {};
  ((assignment && assignment.rows) || []).forEach((r) => {
    if (!r.tanque || !(r.start instanceof Date) || !(r.end instanceof Date)) return;
    (por[r.tanque] = por[r.tanque] || []).push({
      start: r.start.getTime(),
      end: r.end.getTime(),
      nombre: r.nombre,
      hl: Number(r.volumenHL) || 0,
      tipo: r.tanqueTipo,
    });
  });
  ((assignment && assignment.tanks) || []).forEach((t) => {
    if (!t.preocupado || !t.preocupado.hasta) return;
    (por[t.equipo] = por[t.equipo] || []).push({
      start: -Infinity,
      end: t.preocupado.hasta.getTime(),
      nombre: "Producto en proceso (inventario)",
      hl: Number(t.preocupado.hL) || 0,
      tipo: t.tipo,
      inventario: true,
    });
  });
  Object.keys(por).forEach((k) => {
    const bs = por[k].sort((a, b) => a.start - b.start);
    const f = [];
    bs.forEach((b) => {
      const p = f[f.length - 1];
      if (p && b.start <= p.end) {
        p.end = Math.max(p.end, b.end);
        p.hl += b.hl;
        if (!b.inventario) p.inventario = false;
      } else f.push({ ...b });
    });
    por[k] = f;
  });
  return por;
}

/* ---- Vista CIP A/B/C ---- */
function renderCipABC() {
  const cont = document.getElementById("cipPanel");
  if (!cont) return;
  const assignment = STATE && STATE.seq && STATE.seq.tankAssignment;
  const occ = assignment ? ocupacionesPorEquipo(assignment) : {};
  const hayPlan = !!assignment;
  const equipos = TANK_CATALOG.filter((t) => ["FV", "SV", "SV Pony", "BBT"].includes(t.tipo) && Number(t.capacidadHL) > 0).map((t) => {
    const cat = ["A", "B", "C"].includes(String(t.prioridad).toUpperCase()) ? String(t.prioridad).toUpperCase() : "A";
    const agua = Number(t.aguaPromedio) || 0;
    const usos = (occ[t.equipo] || []).filter((b) => !b.inventario).length;
    return {
      equipo: t.equipo,
      tipo: t.tipo,
      cap: Number(t.capacidadHL) || 0,
      agua,
      indice: Number(t.indiceAguaCapacidad) || (agua && t.capacidadHL ? agua / t.capacidadHL : 0),
      cat,
      medido: agua > 0,
      disponible: t.disponible !== false,
      usos,
      aguaPlan: usos * agua,
    };
  });
  const vista = CIP_FILTRO === "todos" ? equipos : equipos.filter((e) => e.tipo === CIP_FILTRO);

  const porCat = { A: [], B: [], C: [] };
  vista.forEach((e) => porCat[e.cat].push(e));
  const aguaTot = vista.reduce((a, e) => a + e.agua, 0);
  const aguaPlanTot = vista.reduce((a, e) => a + e.aguaPlan, 0);
  const usosTot = vista.reduce((a, e) => a + e.usos, 0);
  const sinMedir = vista.filter((e) => !e.medido).length;

  const kpis =
    ["A", "B", "C"]
      .map((c) =>
        modKpi(
          c,
          `Equipos categoría ${c}`,
          String(porCat[c].length),
          `${porCat[c].filter((e) => e.usos).length} usados en la programación`,
          CIP_COLOR[c],
        ),
      )
      .join("") +
    modKpi(
      "💧",
      "Agua CIP estimada del plan",
      hayPlan ? MOD_NF(aguaPlanTot) : "—",
      hayPlan ? `${usosTot} CIP de reutilización × agua promedio` : "Carga el plan para estimarla",
      "var(--accent2)",
    );

  const resumen = ["A", "B", "C"]
    .map((c) => {
      const l = porCat[c];
      const ag = l.reduce((a, e) => a + e.agua, 0);
      const agp = l.reduce((a, e) => a + e.aguaPlan, 0);
      return `<div class="cip-res"><span class="cip-letra" style="background:${CIP_COLOR[c]}">${c}</span><div class="cip-res-txt"><b>${l.length} equipos</b><small>${vista.length ? Math.round((l.length / vista.length) * 100) : 0}% · ${l.reduce((a, e) => a + e.usos, 0)} CIP en el plan</small></div><div class="cip-res-bar"><span style="width:${aguaTot ? (ag / aguaTot) * 100 : 0}%;background:${CIP_COLOR[c]}"></span></div><div class="cip-res-v">${MOD_NF(ag, 1)}<small>${hayPlan ? "plan: " + MOD_NF(agp) : ""}</small></div></div>`;
    })
    .join("");

  // Criterio: rango del índice agua/capacidad que cubre cada categoría, por tipo.
  const tipos = ["FV", "SV", "SV Pony", "BBT"].filter((t) => CIP_FILTRO === "todos" || CIP_FILTRO === t);
  const criterio = tipos
    .map((tp) => {
      const celdas = ["A", "B", "C"]
        .map((c) => {
          const ix = equipos.filter((e) => e.tipo === tp && e.cat === c && e.medido).map((e) => e.indice);
          return `<td>${ix.length ? `${MOD_NF(Math.min(...ix), 3)} – ${MOD_NF(Math.max(...ix), 3)}` : "—"}</td>`;
        })
        .join("");
      return `<tr><td><b>${tp}</b></td>${celdas}</tr>`;
    })
    .join("");

  const orden = { A: 0, B: 1, C: 2 };
  const filas = vista
    .slice()
    .sort((a, b) => orden[a.cat] - orden[b.cat] || (b.medido ? 1 : 0) - (a.medido ? 1 : 0) || a.indice - b.indice || a.equipo.localeCompare(b.equipo))
    .map(
      (e) => `<tr${e.disponible ? "" : ' style="opacity:.55" title="Marcado como no disponible en el catálogo"'}>
      <td><b>${escapeHtml(e.equipo)}</b></td><td>${escapeHtml(e.tipo)}</td>
      <td class="num">${MOD_NF(e.cap)}</td>
      <td class="num">${e.medido ? MOD_NF(e.agua, 2) : '<span style="color:var(--muted)">sin medir</span>'}</td>
      <td class="num">${e.medido ? MOD_NF(e.indice, 3) : "—"}</td>
      <td class="acu-c"><span class="cip-letra" style="background:${CIP_COLOR[e.cat]}">${e.cat}</span></td>
      <td class="num">${hayPlan ? e.usos : "—"}</td>
      <td class="num">${hayPlan && e.usos ? (e.medido ? MOD_NF(e.aguaPlan, 1) : "sin medir") : "—"}</td>
    </tr>`,
    )
    .join("");

  const conteo = (tp) => (tp === "todos" ? equipos.length : equipos.filter((e) => e.tipo === tp).length);
  const filtro = ["todos", "FV", "SV", "SV Pony", "BBT"]
    .map((tp) => `<button data-cip-tipo="${tp}" class="${CIP_FILTRO === tp ? "active" : ""}">${tp === "todos" ? "Todos" : tp} (${conteo(tp)})</button>`)
    .join("");

  // Uso de tanques C cuando hay A/B del mismo tipo que no se usan: oportunidad.
  const oportunidades = [];
  ["FV", "SV", "SV Pony"].forEach((tp) => {
    const usadosC = equipos.filter((e) => e.tipo === tp && e.cat === "C" && e.usos > 0);
    const libresAB = equipos.filter((e) => e.tipo === tp && e.cat !== "C" && e.disponible && e.usos === 0);
    if (usadosC.length && libresAB.length)
      oportunidades.push(
        `${tp}: la programación usa ${usadosC.map((e) => e.equipo).join(", ")} (categoría C) mientras ${libresAB.length} equipo(s) A/B no reciben carga. Revisa si el volumen o el momento permiten pasarlos a un A/B.`,
      );
  });

  cont.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Clasificación A/B/C por consumo de agua de CIP</h3><span class="sub">Datos del catálogo de equipos · la asignación de tanques llena primero los A</span></div>
      <div class="panel-body">
        <div class="acu-kpis">${kpis}</div>
        <div class="filtro-equipos" style="margin-bottom:12px;">${filtro}</div>
        <div class="acu-grid">
          <div class="acu-card">
            <div class="acu-card-tit">Equipos ${sinMedir ? `<span class="acu-tag" style="color:var(--muted);border-color:var(--line);margin-left:6px;">${sinMedir} sin medición de agua</span>` : ""}</div>
            <div class="table-scroll" style="max-height:520px;"><table class="acu-tabla"><thead><tr><th>Equipo</th><th>Tipo</th><th class="num">Cap. (hL)</th><th class="num" title="Agua promedio de un CIP del equipo (catálogo)">Agua / CIP</th><th class="num" title="Agua del CIP dividida por la capacidad">Índice</th><th class="acu-c">Cat.</th><th class="num" title="CIP de reutilización que pide la programación actual">CIP plan</th><th class="num" title="CIP en el plan × agua promedio">Agua plan</th></tr></thead><tbody>${filas}</tbody></table></div>
          </div>
          <div>
            <div class="acu-card"><div class="acu-card-tit">Resumen por categoría <small style="color:var(--muted);font-weight:400;">(agua de un CIP por equipo)</small></div>${resumen}
              <div class="cip-total"><span>Total · ${vista.length} equipos</span><b>${MOD_NF(aguaTot, 1)}</b></div></div>
            <div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Criterio de clasificación</div>
              <p class="acu-nota" style="margin-top:0;">A = menos agua por hL de capacidad (más eficiente) · C = más agua por hL. Rango del índice en cada categoría:</p>
              <table class="acu-tabla"><thead><tr><th>Tipo</th><th style="color:var(--ok)">A</th><th style="color:var(--warn)">B</th><th style="color:var(--danger)">C</th></tr></thead><tbody>${criterio}</tbody></table>
              <p class="acu-nota">La categoría se edita en «Equipos / Tanques» (columna Prioridad). Los equipos sin medición de agua conservan la categoría del catálogo.</p>
            </div>
            ${oportunidades.length ? `<div class="acu-card" style="margin-top:14px;"><div class="acu-card-tit">Oportunidades de ahorro</div>${oportunidades.map((o) => `<div class="tm-restr"><span>💧</span><div>${escapeHtml(o)}</div></div>`).join("")}</div>` : ""}
          </div>
        </div>
      </div>
    </div>`;
  cont.querySelectorAll("[data-cip-tipo]").forEach((b) =>
    b.addEventListener("click", () => {
      CIP_FILTRO = b.dataset.cipTipo;
      renderCipABC();
    }),
  );
}
