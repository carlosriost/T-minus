/* =========================================================================
   PROGRAMA QUE DEBIÓ DARSE (en la pestaña «Programa de cocinas» del Excel)
   -------------------------------------------------------------------------
   «Genérame el programa que tuvo que haberse dado para poder envasar lo de
   las semanas actuales.»

   · «Debió darse» = los cocimientos del plan T-minus completo hacia atrás
     (js/programa-feria.js → pfCalcularHaciaAtras) que caen ANTES del I0:
     sin inventario, todo lo que pide el instructivo sale de un cocimiento.
   · «Se dio» = los cocimientos del Excel de Elaboración en esas mismas
     fechas (Pony HG y Pony GO del Excel = Pony en T-minus).
   · Se comparan por mosto (cuántos, acumulado en el tiempo y día a día) y
     cocimiento a cocimiento: el k-ésimo que debió darse de un mosto contra
     el k-ésimo real de ese mosto.
   Ojo: el Excel también trae lo que se cocinó para envasado ANTERIOR al
   instructivo (sobre todo los primeros días de la ventana y la Pony, que se
   envasa a los 2–4 días): por eso lo real puede ser mayor al principio.
   Nada de esto cambia el plan ni el Excel.
   ========================================================================= */

const PD_MOSTOS = [
  { id: "estandar", nombre: "Estándar", cls: "pc-c1", color: "var(--pc-c1)", excel: ["estandar"] },
  { id: "pilsen", nombre: "Pilsen", cls: "pc-c2", color: "var(--pc-c2)", excel: ["pilsen"] },
  { id: "light", nombre: "Light", cls: "pc-c3", color: "var(--pc-c3)", excel: ["light"] },
  { id: "pony", nombre: "Pony", cls: "pc-c4", color: "var(--pc-c4)", excel: ["ponyhg", "ponygo"] },
];
// Mosto del plan T-minus que corresponde a un mosto del Excel (club → ninguno).
function pdMostoDeExcel(id) {
  const m = PD_MOSTOS.find((x) => x.excel.includes(id));
  return m ? m.id : null;
}

function pdDatos() {
  if (typeof pfDatos !== "function" || !(STATE && STATE.parsed && STATE.seq && STATE.plan)) return { motivo: "sin-plan" };
  const i0d = typeof getI0Date === "function" ? getI0Date() : null;
  if (!i0d || isNaN(i0d)) return { motivo: "sin-i0" };
  const i0 = i0d.getTime();
  const atras = pfDatos("atras");
  if (!atras) return { motivo: "sin-plan" };
  const debio = atras.filas.filter((x) => x.tipo === "coc" && x.inicio < i0).sort((a, b) => a.inicio - b.inicio);
  if (!debio.length) return { motivo: "nada", i0 };
  const desde = medianocheMs(new Date(debio[0].inicio));
  const real = ((PC && PC.filas) || [])
    .filter((x) => x.tipo === "coc" && x.inicio != null && x.inicio >= desde && x.inicio < i0)
    .map((x) => ({ x, mostoId: pdMostoDeExcel(x.id) }))
    .sort((a, b) => a.x.inicio - b.x.inicio);
  const porMosto = PD_MOSTOS.map((m) => {
    const d = debio.filter((x) => x.id === m.id);
    const r = real.filter((o) => o.mostoId === m.id).map((o) => o.x);
    // Pareja k-ésima: el k-ésimo que debió darse con el k-ésimo real.
    const parejas = d.map((x, k) => ({ debio: x, real: r[k] || null, desfaseH: r[k] ? (r[k].inicio - x.inicio) / PC_H : null }));
    return {
      ...m,
      debio: d,
      real: r,
      parejas,
      hLEnvasa: d.reduce((a, x) => a + (x.hLEnvasa || 0), 0),
      envDesde: d.length ? Math.min(...d.flatMap((x) => x.destinos.map((z) => z.desde))) : null,
      envHasta: d.length ? Math.max(...d.flatMap((x) => x.destinos.map((z) => z.hasta))) : null,
    };
  });
  const otrosReal = real.filter((o) => !o.mostoId).map((o) => o.x);
  return { motivo: null, i0, desde, debio, real, porMosto, otrosReal, hayExcel: !!(PC && PC.filas), atras };
}

function pdHtmlCard() {
  return `<div class="acu-card pd-card" id="pdCard"><div class="acu-card-tit">Programa que debió darse para envasar las semanas actuales <small class="pc-sub">· plan T-minus hacia atrás vs. lo que dice este Excel, hasta el I0</small></div><div id="pdCuerpo"></div></div>`;
}

function pdDibujar() {
  const el = document.getElementById("pdCuerpo");
  if (!el) return;
  const D = pdDatos();
  if (D.motivo === "sin-plan") {
    el.innerHTML = '<p class="empty-note">Para calcularlo hace falta el instructivo de envasado (y, si lo tienes, el Producto en proceso) en Datos de entrada.</p><button class="btn small" data-goto="view-datos">Ir a Datos de entrada →</button>';
    return;
  }
  if (D.motivo === "sin-i0") {
    el.innerHTML = '<p class="empty-note">Falta el I0 del plan.</p>';
    return;
  }
  if (D.motivo === "nada") {
    el.innerHTML = '<p class="empty-note">Con el instructivo cargado no hacía falta cocinar nada antes del I0.</p>';
    return;
  }
  const ver = !!(PCX_EXCEL.F && PCX_EXCEL.F.verDebio);
  const totD = D.debio.length;
  const totR = D.porMosto.reduce((a, m) => a + m.real.length, 0);
  const filas = D.porMosto
    .filter((m) => m.debio.length || m.real.length)
    .map((m) => {
      const dif = m.real.length - m.debio.length;
      const tarde = m.parejas.filter((p) => p.desfaseH != null && p.desfaseH > 0.5);
      const medDes = (() => {
        const v = m.parejas.map((p) => p.desfaseH).filter((x) => x != null).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : null;
      })();
      return `<tr><td><span class="pc-dot ${m.cls}"></span>${m.nombre}</td>
        <td class="num"><b>${m.debio.length}</b></td>
        <td>${m.debio.length ? `${escapeHtml(pcFecha(m.debio[0].inicio))} → ${escapeHtml(pcFecha(m.debio[m.debio.length - 1].inicio))}` : "—"}</td>
        <td class="num">${MOD_NF(m.hLEnvasa)}</td>
        <td>${m.envDesde != null ? `${escapeHtml(fmtDate(new Date(m.envDesde)))} → ${escapeHtml(fmtDate(new Date(m.envHasta)))}` : "—"}</td>
        <td class="num">${D.hayExcel ? m.real.length : "—"}</td>
        <td class="num">${D.hayExcel ? (dif < 0 ? `<span class="pvr-no">${dif}</span>` : dif > 0 ? `<span class="pvr-si">+${dif}</span>` : "0") : "—"}</td>
        <td class="num">${medDes == null ? "—" : `${medDes > 0 ? "+" : ""}${MOD_NF(medDes, 1)} h`}${tarde.length ? ` <small class="pc-sub">(${tarde.length} después)</small>` : ""}</td></tr>`;
    })
    .join("");
  const otros = D.otrosReal.length ? `<p class="acu-nota">Además, el Excel tiene ${D.otrosReal.length} cocimiento(s) de mostos que no están en el instructivo (p. ej. Club Colombia) en esas fechas: no entran en la comparación.</p>` : "";
  el.innerHTML = `
    <p class="acu-nota pd-intro">Para que <b>todo</b> lo que pide el instructivo (envasado desde el ${escapeHtml(fmtDate(new Date(Math.min(...D.porMosto.filter((m) => m.envDesde != null).map((m) => m.envDesde)))))}) tenga cerveza a tiempo sin contar el inventario, T-minus calcula que había que cocinar <b>${totD} cocimientos</b> entre el ${escapeHtml(pcFecha(D.debio[0].inicio))} y el I0 (${escapeHtml(pcFecha(D.i0))}).${D.hayExcel ? ` En esas fechas este Excel tiene <b>${totR}</b> de esos mostos.` : " Carga el Excel de Elaboración para compararlo."} Mismas reglas del plan, sin inventario, con levadura Light disponible y cerveza cocinable hasta ${2 + PF_ADELANTO_ATRAS_DIAS} días antes (Light ${3 + PF_ADELANTO_ATRAS_DIAS}).</p>
    <div class="pf-esc">
      <button class="pc-chip ${ver ? "on" : ""}" data-pd-ver>◇ ${ver ? "Ocultar" : "Ver"} en el mapa de cargues</button>
      <button class="pc-chip" data-pd-abrir>Abrir el plan completo hacia atrás →</button>
    </div>
    <div class="table-scroll mod-noclip"><table class="pc-tabla pd-tabla"><thead><tr><th>Mosto</th><th class="num">Debió darse (coc.)</th><th>Cargues</th><th class="num">hL a envasar</th><th>Se envasan</th><th class="num">Se dio (Excel)</th><th class="num">Diferencia</th><th class="num">Desfase mediano</th></tr></thead><tbody>${filas}</tbody></table></div>
    <p class="acu-nota">«Desfase» = cargue real − cargue que debió darse, pareando el k-ésimo cocimiento de cada mosto (positivo = se cocinó después). Este Excel también trae lo que se cocinó para envasado anterior al instructivo, así que al principio de la ventana lo real puede ser mayor, sobre todo en Pony.</p>
    ${otros}
    <div class="pd-acum" id="pdAcum"></div>
    <details class="pd-det"><summary>Día por día (${Math.round((D.i0 - D.desde) / PC_D) + 1} días)</summary><div id="pdDias"></div></details>
    <details class="pd-det"><summary>Cada cocimiento que debió darse (${totD})</summary><div id="pdLista"></div></details>`;
  pdDibujarAcumulado(D);
  pdDibujarDias(D);
  pdDibujarLista(D);
  el.querySelector("[data-pd-ver]").addEventListener("click", () => {
    const F = PCX_EXCEL.F;
    if (!F) return;
    F.verDebio = !F.verDebio;
    if (F.verDebio) {
      // El rango del mapa pasa a la ventana del plan pasado.
      F.desde = Math.max(F.min, D.desde);
      F.hasta = Math.min(F.max, medianocheMs(new Date(D.i0)) + PC_D);
      PC_SEL = null;
    }
    pcRenderCuerpo();
    if (F.verDebio) {
      const mapa = document.getElementById("pcMapa");
      if (mapa) mapa.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  el.querySelector("[data-pd-abrir]").addEventListener("click", () => {
    PCX_FERIA.escenario = "atras";
    PCX_FERIA.F = null;
    PCX_FERIA.SEL = null;
    PCX_FERIA.PAG = 0;
    const b = document.querySelector('.sb-item[data-view="view-programa-feria"]');
    if (b) b.click();
  });
}
// Acumulado por mosto: cuántos debieron darse vs. cuántos se dieron hasta
// cada momento (escalones). Un panel por mosto, misma escala de tiempo.
function pdDibujarAcumulado(D) {
  const el = document.getElementById("pdAcum");
  if (!el) return;
  const W = 300;
  const H = 150;
  const m = { l: 28, r: 8, t: 14, b: 22 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (ms) => m.l + ((ms - D.desde) / Math.max(1, D.i0 - D.desde)) * iw;
  const paneles = D.porMosto
    .filter((mo) => mo.debio.length || mo.real.length)
    .map((mo) => {
      const max = Math.max(1, mo.debio.length, mo.real.length);
      const y = (v) => m.t + ih - (v / max) * ih;
      const escalon = (lista) => {
        let p = `M ${x(D.desde)} ${y(0)}`;
        lista.forEach((ms, k) => (p += ` L ${x(ms)} ${y(k)} L ${x(ms)} ${y(k + 1)}`));
        return p + ` L ${x(D.i0)} ${y(lista.length)}`;
      };
      let s = "";
      [0, Math.round(max / 2), max].forEach((v) => (s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="pc-grid"/><text x="${m.l - 4}" y="${y(v) + 3}" class="pc-ax" text-anchor="end">${v}</text>`));
      for (let d = D.desde; d <= D.i0; d += PC_D) {
        const dw = new Date(d).getUTCDay();
        if (dw === 1) s += `<line x1="${x(d)}" x2="${x(d)}" y1="${m.t}" y2="${m.t + ih}" class="pc-sem"/><text x="${x(d)}" y="${H - 6}" class="pc-ax" text-anchor="middle">${escapeHtml(fmtDate(new Date(d)).replace(/^\S+\s/, ""))}</text>`;
      }
      s += `<path d="${escalon(mo.debio.map((z) => z.inicio))}" class="pd-l-debio" style="stroke:${mo.color}"/>`;
      if (D.hayExcel) s += `<path d="${escalon(mo.real.map((z) => z.inicio))}" class="pd-l-real" style="stroke:${mo.color}"/>`;
      const dif = mo.real.length - mo.debio.length;
      return `<div class="pd-panel"><div class="pd-panel-t"><span class="pc-dot ${mo.cls}"></span>${mo.nombre} <small class="pc-sub">debió ${mo.debio.length}${D.hayExcel ? ` · se dio ${mo.real.length} · <span class="${dif < 0 ? "pvr-no" : "pvr-si"}">${dif > 0 ? "+" : ""}${dif}</span>` : ""}</small></div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Acumulado de cocimientos de ${escapeHtml(mo.nombre)}">${s}</svg></div>`;
    })
    .join("");
  el.innerHTML = `<div class="pd-paneles">${paneles}</div><div class="legend pc-leyenda"><div class="item"><span class="pd-ley pd-ley-debio"></span>Debió darse (plan T-minus hacia atrás)</div>${D.hayExcel ? '<div class="item"><span class="pd-ley pd-ley-real"></span>Se dio (este Excel)</div>' : ""}<div class="item pc-sub">Cocimientos acumulados desde el ${escapeHtml(fmtDate(new Date(D.desde)))} hasta el I0. Donde la línea continua va por debajo de la punteada, la cocina iba atrasada frente a lo que pide el instructivo.</div></div>`;
}

function pdDibujarDias(D) {
  const el = document.getElementById("pdDias");
  if (!el) return;
  const mostos = D.porMosto.filter((mo) => mo.debio.length || mo.real.length);
  const acum = Object.fromEntries(mostos.map((mo) => [mo.id, 0]));
  let html = "";
  for (let d = D.desde; d < D.i0; d += PC_D) {
    const celdas = mostos
      .map((mo) => {
        const nd = mo.debio.filter((z) => z.inicio >= d && z.inicio < d + PC_D).length;
        const nr = mo.real.filter((z) => z.inicio >= d && z.inicio < d + PC_D).length;
        acum[mo.id] += nr - nd;
        const a = acum[mo.id];
        return `<td class="num">${nd}</td><td class="num">${D.hayExcel ? nr : "—"}</td><td class="num">${D.hayExcel ? `<span class="${a < 0 ? "pvr-no" : a > 0 ? "pvr-si" : ""}">${a > 0 ? "+" : ""}${a}</span>` : "—"}</td>`;
      })
      .join("");
    html += `<tr><td>${escapeHtml(fmtDate(new Date(d)))}</td>${celdas}</tr>`;
  }
  el.innerHTML = `<div class="table-scroll" style="max-height:420px;"><table class="pc-tabla pd-dias"><thead><tr><th rowspan="2">Día</th>${mostos.map((mo) => `<th colspan="3" class="pd-th-m"><span class="pc-dot ${mo.cls}"></span>${mo.nombre}</th>`).join("")}</tr><tr>${mostos.map(() => '<th class="num">Debió</th><th class="num">Se dio</th><th class="num">Acum.</th>').join("")}</tr></thead><tbody>${html}</tbody></table></div><p class="acu-nota">«Acum.» = se dio − debió darse, acumulado desde el primer día (negativo = cocimientos que faltaban hasta ese día). El último día se corta en el I0.</p>`;
}

function pdDibujarLista(D) {
  const el = document.getElementById("pdLista");
  if (!el) return;
  const filas = D.porMosto
    .flatMap((mo) => mo.parejas.map((p, k) => ({ mo, p, k })))
    .sort((a, b) => a.p.debio.inicio - b.p.debio.inicio)
    .map(({ mo, p, k }) => {
      const x = p.debio;
      const dest = x.destinos
        .slice(0, 3)
        .map((z) => `L${escapeHtml(String(z.train))} ${escapeHtml(z.name)} · ${escapeHtml(pcFecha(z.desde))}`)
        .join("<br>");
      const real = p.real ? `${escapeHtml(pcFecha(p.real.inicio))} <small class="pc-sub">#${p.real.n != null ? p.real.n : "—"}${p.real.equipo ? " · " + escapeHtml(p.real.equipo) : ""}</small>` : D.hayExcel ? '<span class="pvr-no">no se dio</span>' : "—";
      const des = p.desfaseH == null ? "" : `${p.desfaseH > 0 ? "+" : ""}${MOD_NF(p.desfaseH, 1)} h`;
      return `<tr><td class="num">${k + 1}</td><td><span class="pc-dot ${mo.cls}"></span>${mo.nombre}</td><td>${escapeHtml(pcFecha(x.inicio))}</td><td>${x.aMasTardar ? escapeHtml(pcFecha(x.aMasTardar)) : "—"}</td><td>${escapeHtml(x.equipo || "—")}</td><td class="pc-notas">${dest || "—"}${x.destinos.length > 3 ? `<br><small class="pc-sub">+${x.destinos.length - 3} más</small>` : ""}</td><td>${real}</td><td class="num ${p.desfaseH != null && p.desfaseH > 0.5 ? "pvr-no" : ""}">${des}</td></tr>`;
    })
    .join("");
  el.innerHTML = `<div class="table-scroll" style="max-height:480px;"><table class="pc-tabla"><thead><tr><th class="num">K</th><th>Mosto</th><th>Debió cargarse</th><th>A más tardar</th><th>Fermenta en</th><th>Para envasar en</th><th>K-ésimo real (Excel)</th><th class="num">Desfase</th></tr></thead><tbody>${filas}</tbody></table></div><p class="acu-nota">«K» = número del cocimiento dentro de su mosto. «A más tardar» = último cargue que todavía alcanza su envasado con el proceso del catálogo.</p>`;
}

// Marcas «debió darse» para el mapa de cargues del Excel (rombos huecos).
function pdMarcasMapa(xh, m, rowH, nd) {
  const F = PCX_EXCEL.F;
  if (!F || !F.verDebio) return "";
  // pfDatos tiene cache: volver a pedirlo no recalcula el plan.
  const D = pdDatos();
  if (!D || D.motivo) return "";
  const r = rowH >= 16 ? 5.5 : rowH >= 9 ? 4 : 2.5;
  let s = "";
  D.porMosto.forEach((mo) => {
    if (!mo.excel.some((id) => F.mostos.has(id))) return;
    mo.debio.forEach((x) => {
      if (x.inicio < F.desde || x.inicio >= F.hasta) return;
      const dia = medianocheMs(new Date(x.inicio));
      const fila = Math.round((dia - F.desde) / PC_D);
      if (fila < 0 || fila >= nd) return;
      const cx = xh((x.inicio - dia) / PC_H);
      const cy = m.t + fila * rowH + rowH / 2;
      const tip = `Debió darse · ${mo.nombre} · ${pcFecha(x.inicio)}${x.destinos[0] ? ` · para L${x.destinos[0].train} ${x.destinos[0].name} ${pcFecha(x.destinos[0].desde)}` : ""}`;
      s += `<path d="M ${cx} ${cy - r} L ${cx + r} ${cy} L ${cx} ${cy + r} L ${cx - r} ${cy} Z" class="pd-rombo" style="stroke:${mo.color}" data-pd-tip="${escapeHtml(tip)}"/>`;
    });
  });
  return s;
}
