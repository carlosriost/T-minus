/* =========================================================================
   DEL COCIMIENTO AL ENVASADO (trazabilidad + momento actual + frío)
   -------------------------------------------------------------------------
   Pedido de Utilities: «que visualmente se correlacione el plan de cocinas
   con el de envasado: esto se va para allá, esto para allá; que muestre el
   momento en que se está cocinando», y saber cuándo SUBE la demanda de frío
   (amoníaco) para prender compresores.

   De dónde sale cada cosa:
   · Cada cocimiento del plan FerIA ya trae a qué línea, SKU y horas va su
     producto (engine.js → cocimientosDeDemanda: la demanda de envasado se
     reparte en el tiempo y en orden, cocimiento por cocimiento).
   · El FV, el trasiego y el SV salen de la asignación de tanques
     (STATE.seq.tankAssignment).
   · La demanda de frío es un ÍNDICE ESTIMADO, no una medición: suma cargas
     típicas de refrigeración (enfriar mosto, sostener fermentación, enfriar en
     el trasiego, sostener maduración) con pesos que Utilities puede ajustar.
     Sirve para ver CUÁNDO sube y por qué, no cuántos kW.
   ========================================================================= */

const TRZ_LS_KEY = "planTrazabilidad";
const TRZ_H = 3600000;
const TRZ_MOSTO_CLS = { estandar: "pc-c1", pilsen: "pc-c2", light: "pc-c3", pony: "pc-c4" };
// Pesos por defecto del índice de frío (unidades relativas por equipo/evento).
const TRZ_FRIO_DEFECTO = {
  mosto: 3, // enfriamiento de mosto al salir de cocina (1 h por cocimiento)
  mostoHoras: 1,
  fermentacion: 1, // FV con cerveza fermentando (sostener temperatura)
  trasiego: 4, // trasiego FV → SV y enfriamiento a maduración
  trasiegoHoras: 12,
  maduracion: 0.5, // SV madurando (sostener frío)
  umbral: 3, // cuánto tiene que subir el índice para avisar «sube»
};
let TRZ = { sel: null, pxH: 3, ahora: null, mosto: "todos" };

function trzConfig() {
  let g = null;
  try {
    g = JSON.parse(localStorage.getItem(TRZ_LS_KEY) || "null");
  } catch (_) {}
  const c = { frio: { ...TRZ_FRIO_DEFECTO } };
  if (g && g.frio)
    Object.keys(c.frio).forEach((k) => {
      if (isFinite(Number(g.frio[k])) && Number(g.frio[k]) >= 0) c.frio[k] = Number(g.frio[k]);
    });
  if (g && [2, 3, 4, 6, 8].includes(Number(g.pxH))) TRZ.pxH = Number(g.pxH);
  return c;
}
function trzGuardar(c) {
  try {
    localStorage.setItem(TRZ_LS_KEY, JSON.stringify({ frio: c.frio, pxH: TRZ.pxH }));
  } catch (_) {}
}
// «Ahora» en la convención de la app: componentes UTC = hora de pared local.
function trzAhoraMs() {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
}
function trzMostoDeSKU(nombre) {
  return typeof matchMosto === "function" ? matchMosto(nombre || "", MOSTO_CATALOG) : null;
}
function trzNombreMosto(id) {
  const m = (MOSTO_CATALOG || []).find((x) => x.id === id);
  return m ? m.nombre : id || "—";
}
function trzF(ms) {
  return ms == null ? "—" : fmtDateTime(new Date(ms));
}
function trzHL(v) {
  return `${MOD_NF(v)} hL`;
}

/* ------------------------------------------------------------- datos */

// Todo lo que muestra el módulo, sin tocar el DOM.
function calcularTrazabilidad(cfg) {
  const seq = STATE && STATE.seq;
  const rows = (seq && seq.rows) || [];
  const ta = (seq && seq.tankAssignment) || {};
  const cocs = rows
    .filter((r) => r.tipo === "cocimiento" && r.start && r.end)
    .map((r) => ({
      n: r.n,
      key: `c${r.n}`,
      mostoId: r.mostoId,
      ms: r.start.getTime(),
      fin: r.end.getTime(),
      necesidad: r.necesidad ? r.necesidad.getTime() : r.deadline ? r.deadline.getTime() : null,
      necesidadFin: r.necesidadFin ? r.necesidadFin.getTime() : null,
      tarde: !!r.violaDeadline,
      bloque: r.blockLabel || "",
      consumo: (r.consumo || []).map((c) => ({ ...c })),
      hL: Number(r.cocVolumenHL) || 0,
    }));
  const porN = new Map(cocs.map((c) => [c.n, c]));
  // FV de cada cocimiento (las filas de FV heredan el n.º del cocimiento).
  (ta.rows || []).forEach((t) => {
    if (!/^FV/.test(t.etapa || "") || !t.tanque || t.n == null) return;
    const c = porN.get(t.n);
    if (!c) return;
    (c.fv = c.fv || []).push({ tanque: t.tanque, desde: t.start.getTime(), hasta: t.end.getTime() });
  });
  // Trasiegos (FV → SV) y SV: el lote de un FV se trasiega junto.
  const trasiegos = (ta.transferencias || []).map((tr) => ({
    ms: tr.fecha.getTime(),
    mostoId: tr.mostoId,
    fv: tr.origen ? tr.origen.equipo || "" : "",
    hL: Number(tr.volumenHL) || 0,
    pony: !!tr.ponyDirect,
    madH: Number(tr.maduracionHoras) || 0,
  }));
  const svRows = (ta.rows || []).filter((t) => /^SV/.test(t.etapa || "") && t.tanque);
  cocs.forEach((c) => {
    const fv = c.fv && c.fv[0];
    const tr = fv
      ? trasiegos.filter((x) => x.fv === fv.tanque && x.ms >= fv.desde - 60000).sort((a, b) => a.ms - b.ms)[0]
      : trasiegos.filter((x) => x.pony && Math.abs(x.ms - c.fin) < 60000)[0];
    if (tr) {
      c.trasiego = tr.ms;
      c.sv = [...new Set(svRows.filter((s) => s.mostoId === c.mostoId && Math.abs(s.start.getTime() - tr.ms) < 60000).map((s) => s.tanque))];
      c.listo = tr.ms + tr.madH * TRZ_H;
    }
    // El lote del FV fermenta desde su ÚLTIMO llenado: si el producto queda
    // listo después de que arranca su envasado, se avisa aunque el cargue
    // del cocimiento haya sido a tiempo.
    const iniEnv = c.consumo.length ? Math.min(...c.consumo.map((x) => x.desde)) : null;
    c.tardeTanque = c.listo != null && iniEnv != null && c.listo > iniEnv + 60000;
    c.atrasoH = c.tardeTanque ? (c.listo - iniEnv) / TRZ_H : 0;
  });

  // Envasado: bloques de producción por tren, con su mosto.
  const envasado = [];
  (typeof TRAINS !== "undefined" ? TRAINS : []).forEach((t) =>
    ((STATE.mergedByTrain || {})[t] || []).forEach((b) => {
      if (!b.start || !b.end) return;
      envasado.push({
        train: t,
        tipo: b.type,
        name: b.name || b.codigo || "",
        ms: b.start.getTime(),
        fin: b.end.getTime(),
        mostoId: b.type === "production" ? trzMostoDeSKU(b.name) : null,
        hL: Number(b.hectolitros) || 0,
      });
    }),
  );

  // Índice de frío: tramos con peso, y los instantes en que sube.
  const F = cfg.frio;
  const tramos = [];
  cocs.forEach((c) => tramos.push({ a: c.fin, z: c.fin + F.mostoHoras * TRZ_H, w: F.mosto, motivo: `Enfriar mosto · ${trzNombreMosto(c.mostoId)} n.º ${c.n}` }));
  const fvLotes = new Map();
  (ta.rows || []).forEach((t) => {
    if (!/^FV/.test(t.etapa || "") || !t.tanque) return;
    const k = `${t.tanque}|${t.end.getTime()}`;
    const o = fvLotes.get(k) || { tanque: t.tanque, a: t.start.getTime(), z: t.end.getTime(), mostoId: t.mostoId };
    o.a = Math.min(o.a, t.start.getTime());
    fvLotes.set(k, o);
  });
  fvLotes.forEach((o) => tramos.push({ a: o.a, z: o.z, w: F.fermentacion, motivo: `Fermentación en ${o.tanque} (${trzNombreMosto(o.mostoId)})` }));
  trasiegos.forEach((tr) =>
    tramos.push({
      a: tr.ms,
      z: tr.ms + F.trasiegoHoras * TRZ_H,
      w: F.trasiego,
      motivo: tr.pony ? `Pony a SV y enfriamiento (${trzHL(tr.hL)})` : `Trasiego ${tr.fv} → maduración (${trzNombreMosto(tr.mostoId)}, ${trzHL(tr.hL)})`,
    }),
  );
  const svLotes = new Map();
  svRows.forEach((s) => {
    const k = `${s.tanque}|${s.start.getTime()}`;
    if (!svLotes.has(k)) svLotes.set(k, { a: s.start.getTime(), z: s.end.getTime(), tanque: s.tanque, mostoId: s.mostoId });
  });
  svLotes.forEach((o) => tramos.push({ a: o.a, z: o.z, w: F.maduracion, motivo: `Maduración en ${o.tanque} (${trzNombreMosto(o.mostoId)})` }));
  const marcas = [...new Set(tramos.flatMap((t) => [t.a, t.z]))].sort((a, b) => a - b);
  const curva = marcas.map((t) => ({ t, v: tramos.reduce((s, x) => s + (x.a <= t && x.z > t ? x.w : 0), 0) }));
  const subidas = [];
  for (let i = 1; i < curva.length; i++) {
    const d = curva[i].v - curva[i - 1].v;
    if (d >= F.umbral - 1e-9) {
      const motivos = tramos.filter((x) => Math.abs(x.a - curva[i].t) < 60000).map((x) => x.motivo);
      subidas.push({ t: curva[i].t, de: curva[i - 1].v, a: curva[i].v, motivos });
    }
  }

  const desde = Math.min(...cocs.map((c) => c.ms), ...envasado.map((e) => e.ms));
  const hasta = Math.max(...cocs.map((c) => c.fin), ...envasado.map((e) => e.fin));
  return { cocs, envasado, trasiegos, curva, subidas, desde, hasta };
}

// Estado de un cocimiento en un instante dado.
function trzEstado(c, t) {
  if (t < c.ms) return { txt: "Por cocinar", cls: "trz-e0" };
  if (t < c.fin) return { txt: "Cocinándose", cls: "trz-e1" };
  const fv = c.fv && c.fv[0];
  if (c.trasiego && t < c.trasiego) return { txt: fv ? `Fermentando en ${fv.tanque}` : "Fermentando", cls: "trz-e2" };
  if (c.listo && t < c.listo) return { txt: c.sv && c.sv.length ? `Madurando en ${c.sv.join(", ")}` : "Madurando", cls: "trz-e3" };
  const ini = c.consumo.length ? Math.min(...c.consumo.map((x) => x.desde)) : c.necesidad;
  const fin = c.consumo.length ? Math.max(...c.consumo.map((x) => x.hasta)) : c.necesidadFin;
  if (ini != null && t < ini) return { txt: "Listo, esperando envasado", cls: "trz-e3" };
  if (fin != null && t < fin) return { txt: "Envasándose", cls: "trz-e4" };
  return { txt: "Envasado", cls: "trz-e5" };
}
// El cocimiento que está en la cocina en el instante t (o el último cargado).
function trzCocimientoEn(d, t) {
  const enCurso = d.cocs.filter((c) => c.ms <= t && t < c.fin).sort((a, b) => b.ms - a.ms);
  if (enCurso.length) return enCurso[0];
  return null;
}

/* ------------------------------------------------------------- dibujo */

function renderTrazabilidad() {
  const cont = document.getElementById("trazabilidadPanel");
  if (!cont) return;
  const seq = STATE && STATE.seq;
  if (!seq || !(seq.rows || []).some((r) => r.tipo === "cocimiento")) {
    if (typeof modSinDatos === "function") modSinDatos(cont, "la trazabilidad cocina → envasado");
    return;
  }
  const cfg = trzConfig();
  const d = calcularTrazabilidad(cfg);
  if (TRZ.ahora == null) TRZ.ahora = trzAhoraMs();
  const t = TRZ.ahora;
  const enCocina = trzCocimientoEn(d, t);
  const proximo = d.cocs.filter((c) => c.ms > t).sort((a, b) => a.ms - b.ms)[0];
  const subida = d.subidas.find((s) => s.t >= t);
  const fueraDeRango = t < d.desde || t > d.hasta;
  const destino = (c) =>
    c && c.consumo.length
      ? c.consumo
          .slice(0, 2)
          .map((x) => `L${x.train} ${trzF(x.desde)}`)
          .join(" · ")
      : "—";
  const d2i = (ms) => new Date(ms).toISOString().slice(0, 16);
  const kpis =
    modKpi("🔥", "En la cocina en ese momento", enCocina ? `${escapeHtml(trzNombreMosto(enCocina.mostoId))} <small>n.º ${enCocina.n}</small>` : "—", enCocina ? `se envasa: ${escapeHtml(destino(enCocina))}` : "Ningún cocimiento en proceso") +
    modKpi("⏭", "Próximo cargue", proximo ? escapeHtml(trzF(proximo.ms)) : "—", proximo ? `${escapeHtml(trzNombreMosto(proximo.mostoId))} n.º ${proximo.n} → ${escapeHtml(destino(proximo))}` : "No quedan cargues") +
    modKpi("❄", "Próxima subida de frío", subida ? escapeHtml(trzF(subida.t)) : "—", subida ? `índice ${MOD_NF(subida.de, 1)} → ${MOD_NF(subida.a, 1)} · ${escapeHtml(subida.motivos[0] || "")}` : "Sin subidas después de este momento", "var(--accent2)") +
    modKpi("◉", "Cocimientos con destino", `${d.cocs.filter((c) => c.consumo.length).length} <small>de ${d.cocs.length}</small>`, "cada uno con su línea, SKU y horas de envasado");

  cont.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Del cocimiento al envasado</h3><span class="sub">Plan FerIA · qué se cocina, dónde fermenta y madura, y en qué línea se envasa</span></div>
      <div class="panel-body">
        <div class="pc-filtros trz-filtros">
          <div class="pc-fgrupo"><span class="pc-flab">Momento</span>
            <input type="datetime-local" class="pc-fecha" id="trzAhora" value="${d2i(t)}" aria-label="Momento a mirar">
            <button class="pc-chip" data-trz-ahora>Ahora</button>
            <button class="pc-chip" data-trz-ir>Ir al momento en la línea de tiempo</button>
            <span class="pc-sub">${fueraDeRango ? "⚠ Ese momento está fuera del plan cargado (" + escapeHtml(trzF(d.desde)) + " → " + escapeHtml(trzF(d.hasta)) + ")." : "Escoge cualquier fecha y hora: se ve qué se está cocinando y a dónde va."}</span>
          </div>
          <div class="pc-fgrupo"><span class="pc-flab">Mosto</span>
            ${[["todos", "Todos", ""], ...Object.keys(TRZ_MOSTO_CLS).map((k) => [k, trzNombreMosto(k), TRZ_MOSTO_CLS[k]])].map(([k, l, cls]) => `<button class="pc-chip ${TRZ.mosto === k ? "on" : ""}" data-trz-mosto="${k}">${cls ? `<span class="pc-dot ${cls}"></span>` : ""}${escapeHtml(l)}</button>`).join("")}
            <span class="pc-flab" style="margin-left:10px;">Zoom</span>
            ${[2, 3, 4, 6, 8].map((z) => `<button class="pc-chip ${TRZ.pxH === z ? "on" : ""}" data-trz-zoom="${z}">${z} px/h</button>`).join("")}
          </div>
        </div>
        <div class="acu-kpis">${kpis}</div>
        <div class="pc-layout">
          <div class="acu-card">
            <div class="acu-card-tit">Línea de tiempo <small class="pc-sub">· arriba la cocina, abajo las líneas de envasado · cada curva une un cocimiento con lo que alimenta · la línea amarilla es el momento elegido · clic en un cocimiento o en un bloque de envasado</small></div>
            <div id="trzLinea" class="trz-linea"></div>
            <div class="legend pc-leyenda">${Object.keys(TRZ_MOSTO_CLS).map((k) => `<div class="item"><span class="sw ${TRZ_MOSTO_CLS[k]}"></span>${escapeHtml(trzNombreMosto(k))}</div>`).join("")}<div class="item"><span class="sw trz-sw-otro"></span>DPA / NST</div><div class="item"><span class="sw trz-sw-frio"></span>Índice de frío (estimado)</div><div class="item"><span class="trz-ley-sube">▲</span>Sube la demanda de frío</div><div class="item"><span class="trz-ley-ahora"></span>Momento elegido</div></div>
          </div>
          <div class="acu-card" id="trzDetalle">${trzHtmlDetalle(d)}</div>
        </div>
        <div class="vol-grid3 pvr-grid2">
          <div class="acu-card">
            <div class="acu-card-tit">¿Cuándo sube la demanda de frío? <small class="pc-sub">· para prender compresores a tiempo · estimado desde el plan de cocinas y la asignación de tanques</small></div>
            ${trzHtmlSubidas(d, t)}
          </div>
          <div class="acu-card">
            <div class="acu-card-tit">Pesos del índice de frío <small class="pc-sub">· ajustables por Utilities · se guardan en este navegador</small></div>
            ${trzHtmlPesos(cfg)}
          </div>
        </div>
        <div class="acu-card" style="margin-top:14px;">
          <div class="acu-card-tit">Cada cocimiento y su destino (${d.cocs.length})</div>
          ${trzHtmlTabla(d, t)}
        </div>
      </div>
    </div>`;
  trzDibujarLinea(d, t);
  trzConectar(d, cfg);
}

function trzHtmlDetalle(d) {
  const t = TRZ.ahora;
  if (!TRZ.sel)
    return `<div class="acu-card-tit">Detalle</div><p class="empty-note">Haz clic en un cocimiento (carril «Cocina») para ver dónde fermenta, cuándo se trasiega y en qué línea, SKU y horas se envasa. O haz clic en un bloque de envasado para ver de qué cocimientos sale.</p>`;
  const fila = (k, v) => (v == null || v === "" ? "" : `<div class="pc-dl"><span>${k}</span><b>${v}</b></div>`);
  if (TRZ.sel.startsWith("c")) {
    const c = d.cocs.find((x) => x.key === TRZ.sel);
    if (!c) return `<div class="acu-card-tit">Detalle</div><p class="empty-note">Ese cocimiento ya no está en el plan.</p>`;
    const e = trzEstado(c, t);
    const fv = c.fv && c.fv.length ? c.fv.map((x) => escapeHtml(x.tanque)).join(", ") : "—";
    const destinos = c.consumo.length
      ? c.consumo
          .map((x) => `<div class="trz-dest"><span class="trz-tren">L${escapeHtml(String(x.train))}</span><div><b>${escapeHtml(x.name)}</b><small>${escapeHtml(trzF(x.desde))} → ${escapeHtml(trzF(x.hasta))} · ${trzHL(x.hL)}</small></div><button class="pc-mini" data-trz-ver="e${escapeHtml(String(x.train))}|${x.desde}">ver</button></div>`)
          .join("")
      : '<p class="empty-note">Sin destino calculado (plan sin demanda por cocimiento).</p>';
    return `<div class="acu-card-tit pc-det-tit"><span class="pc-dot ${TRZ_MOSTO_CLS[c.mostoId] || "pc-otro"}"></span>${escapeHtml(trzNombreMosto(c.mostoId))} · cocimiento n.º ${c.n}</div>
      <div class="trz-estado ${e.cls}">${escapeHtml(e.txt)} <small>a las ${escapeHtml(trzF(t))}</small></div>
      <div class="pc-sec">Cocina</div>
      ${fila("Cargue", escapeHtml(trzF(c.ms)))}${fila("Fin de cocina", escapeHtml(trzF(c.fin)))}${c.tarde ? fila("Ojo", '<span class="pvr-no">llega tarde a su envasado</span>') : ""}
      <div class="pc-sec">Fermentación y maduración</div>
      ${fila("Fermenta en", fv)}${fila("Trasiego a maduración", escapeHtml(trzF(c.trasiego)))}${fila("Madura en", c.sv && c.sv.length ? escapeHtml(c.sv.join(", ")) : "—")}${fila("Listo para envasar", escapeHtml(trzF(c.listo)) + (c.tardeTanque ? ` <span class="pvr-no">· ${MOD_NF(c.atrasoH, 1)} h después de que arranca su envasado</span>` : ""))}
      <div class="pc-sec">Se envasa en</div>${destinos}`;
  }
  // Bloque de envasado elegido: «e<tren>|<ms>»
  const [tr, msTxt] = TRZ.sel.slice(1).split("|");
  const ms = Number(msTxt);
  const b = d.envasado.find((x) => String(x.train) === tr && x.ms <= ms && ms < x.fin);
  if (!b) return `<div class="acu-card-tit">Detalle</div><p class="empty-note">Ese bloque ya no está en el plan.</p>`;
  const fuentes = d.cocs
    .map((c) => ({ c, x: c.consumo.filter((z) => String(z.train) === tr && z.desde < b.fin && z.hasta > b.ms) }))
    .filter((o) => o.x.length);
  return `<div class="acu-card-tit pc-det-tit"><span class="pc-dot ${TRZ_MOSTO_CLS[b.mostoId] || "pc-otro"}"></span>L${escapeHtml(tr)} · ${escapeHtml(b.name)}</div>
    ${fila("Envasa", `${escapeHtml(trzF(b.ms))} → ${escapeHtml(trzF(b.fin))}`)}${fila("Volumen", b.hL ? trzHL(b.hL) : "—")}${fila("Mosto", escapeHtml(trzNombreMosto(b.mostoId)))}
    <div class="pc-sec">Sale de estos cocimientos (${fuentes.length})</div>
    ${
      fuentes.length
        ? fuentes
            .map((o) => `<div class="trz-dest"><span class="trz-tren ${TRZ_MOSTO_CLS[o.c.mostoId] || ""}">${o.c.n}</span><div><b>Cargue ${escapeHtml(trzF(o.c.ms))}</b><small>${escapeHtml(trzEstado(o.c, TRZ.ahora).txt)} · ${trzHL(o.x.reduce((a, z) => a + z.hL, 0))} para este bloque</small></div><button class="pc-mini" data-trz-ver="${o.c.key}">ver</button></div>`)
            .join("")
        : `<p class="empty-note">${b.tipo === "production" ? "Ningún cocimiento del plan alimenta este bloque: lo cubre el inventario o quedó antes del I0." : "Es un DPA o NST: no envasa."}</p>`
    }`;
}

function trzHtmlSubidas(d, t) {
  const proximas = d.subidas.filter((s) => s.t >= t - 24 * TRZ_H).slice(0, 40);
  if (!proximas.length) return '<p class="empty-note">No hay subidas del índice después de este momento en el plan cargado.</p>';
  return `<div class="table-scroll" style="max-height:340px;"><table class="acu-tabla trz-tsub"><thead><tr><th>Fecha y hora</th><th class="num">Índice</th><th>Por qué sube</th><th></th></tr></thead><tbody>${proximas
    .map(
      (s) => `<tr class="${s.t < t ? "trz-pasado" : ""}"><td>${escapeHtml(trzF(s.t))}</td><td class="num">${MOD_NF(s.de, 1)} → <b>${MOD_NF(s.a, 1)}</b></td><td class="rec-imp">${escapeHtml(s.motivos.slice(0, 3).join(" · "))}${s.motivos.length > 3 ? ` <small class="pc-sub">+${s.motivos.length - 3} más</small>` : ""}</td><td><button class="pc-mini" data-trz-irms="${s.t}">ver</button></td></tr>`,
    )
    .join("")}</tbody></table></div><p class="acu-nota">Se avisa cuando el índice sube ${MOD_NF(trzConfig().frio.umbral, 1)} o más de golpe. Es una estimación para planear: confírmenla con la operación real de los compresores.</p>`;
}

function trzHtmlPesos(cfg) {
  const et = [
    ["mosto", "Enfriar mosto al salir de cocina (por cocimiento)"],
    ["mostoHoras", "… durante (h)"],
    ["fermentacion", "Fermentación en FV (por tanque)"],
    ["trasiego", "Trasiego FV → SV y enfriamiento (por lote)"],
    ["trasiegoHoras", "… durante (h)"],
    ["maduracion", "Maduración en SV (por tanque)"],
    ["umbral", "Avisar cuando sube al menos"],
  ];
  return `<table class="acu-tabla sp-conf"><tbody>${et
    .map(([k, l]) => `<tr><td class="rec-imp">${l}</td><td class="acu-c"><input type="number" class="acu-pond sp-in" data-trz-peso="${k}" min="0" step="0.5" value="${cfg.frio[k]}"></td></tr>`)
    .join("")}</tbody></table><button type="button" class="btn small" data-trz-reset style="margin-top:8px;">Restaurar pesos</button>`;
}

function trzHtmlTabla(d, t) {
  const lista = d.cocs.filter((c) => TRZ.mosto === "todos" || c.mostoId === TRZ.mosto);
  return `<div class="table-scroll" style="max-height:440px;"><table class="acu-tabla trz-tabla"><thead><tr><th class="num">N.º</th><th>Mosto</th><th>Cargue</th><th>Fermenta</th><th>Trasiego</th><th>Listo</th><th>Se envasa en</th><th>Estado</th></tr></thead><tbody>${lista
    .map((c) => {
      const e = trzEstado(c, t);
      const dest = c.consumo.length
        ? c.consumo.map((x) => `L${escapeHtml(String(x.train))} · ${escapeHtml(x.name)} <small class="pc-sub">${escapeHtml(trzF(x.desde))} → ${escapeHtml(trzF(x.hasta))}</small>`).join("<br>")
        : "—";
      return `<tr class="pvr-fila ${TRZ.sel === c.key ? "pvr-fila-sel" : ""}" data-trz-ver="${c.key}"><td class="num">${c.n}</td><td><span class="pc-dot ${TRZ_MOSTO_CLS[c.mostoId] || "pc-otro"}"></span>${escapeHtml(trzNombreMosto(c.mostoId))}${c.tarde || c.tardeTanque ? ' <span class="pvr-no" title="Llega tarde a su envasado">⚠</span>' : ""}</td><td>${escapeHtml(trzF(c.ms))}</td><td>${c.fv ? escapeHtml(c.fv.map((x) => x.tanque).join(", ")) : "—"}</td><td>${escapeHtml(trzF(c.trasiego))}</td><td>${escapeHtml(trzF(c.listo))}</td><td class="trz-dest-c">${dest}</td><td><span class="trz-estado-chip ${e.cls}">${escapeHtml(e.txt)}</span></td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}

function trzDibujarLinea(d, t) {
  const cont = document.getElementById("trzLinea");
  if (!cont) return;
  const pxH = TRZ.pxH;
  const W = Math.ceil(((d.hasta - d.desde) / TRZ_H) * pxH) + 40;
  const x = (ms) => 20 + ((ms - d.desde) / TRZ_H) * pxH;
  const eje = 34;
  const hCoc = 54;
  const hFrio = 70;
  const hueco = 120;
  const hTren = 40;
  const trenes = typeof TRAINS !== "undefined" ? TRAINS : [];
  const yCoc = eje;
  const yFrio = yCoc + hCoc + 6;
  const yTren0 = yFrio + hFrio + hueco;
  const H = yTren0 + trenes.length * hTren + 10;
  const yTren = (tr) => yTren0 + trenes.indexOf(String(tr)) * hTren;
  const s = [];
  // Días.
  const D = 86400000;
  for (let dd = Math.floor(d.desde / D) * D; dd <= d.hasta; dd += D) {
    if (dd < d.desde) continue;
    const dt = new Date(dd);
    const finde = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
    if (finde) s.push(`<rect class="pc-finde" x="${x(dd)}" y="${eje}" width="${24 * pxH}" height="${H - eje - 10}"></rect>`);
    s.push(`<line class="pc-sem" x1="${x(dd)}" y1="4" x2="${x(dd)}" y2="${H - 10}"></line>`);
    if (24 * pxH >= 40) s.push(`<text class="pc-ax ${dt.getUTCDay() === 1 ? "pc-lunes" : ""}" x="${x(dd) + 3}" y="14">${escapeHtml(24 * pxH >= 70 ? fmtDate(dt) : String(dt.getUTCDate()))}</text>`);
  }
  // Fondos de carril.
  s.push(`<rect class="pvr-carril" x="0" y="${yCoc + 4}" width="${W}" height="${hCoc - 8}"></rect>`);
  trenes.forEach((tr) => s.push(`<rect class="pvr-carril" x="0" y="${yTren(tr) + 3}" width="${W}" height="${hTren - 6}"></rect>`));
  // Índice de frío (área escalonada).
  // Escala del mínimo al máximo del índice: la carga de base (tanques
  // fermentando y madurando) es grande y aplastaba las subidas.
  const vals = d.curva.map((p) => p.v);
  const vmax = Math.max(1, ...vals);
  const vmin = Math.min(vmax - 1, ...vals.filter((v) => v > 0));
  const yv = (v) => yFrio + hFrio - 6 - ((Math.max(v, vmin) - vmin) / (vmax - vmin)) * (hFrio - 14);
  if (d.curva.length) {
    let path = `M ${x(d.curva[0].t)} ${yv(0)}`;
    d.curva.forEach((p, i) => {
      path += ` L ${x(p.t)} ${yv(i ? d.curva[i - 1].v : 0)} L ${x(p.t)} ${yv(p.v)}`;
    });
    path += ` L ${x(d.curva[d.curva.length - 1].t)} ${yv(0)} Z`;
    s.push(`<path class="trz-frio" d="${path}"></path>`);
    let ultimoX = -99;
    d.subidas.forEach((su) => {
      if (x(su.t) - ultimoX < 9) return; // sin amontonar triángulos
      ultimoX = x(su.t);
      s.push(`<text class="trz-sube" x="${x(su.t)}" y="${yv(su.a) - 2}" text-anchor="middle" data-trz-tip="${escapeHtml(`${trzF(su.t)} · índice ${MOD_NF(su.de, 1)} → ${MOD_NF(su.a, 1)} · ${su.motivos.join(" · ")}`)}">▲</text>`);
    });
    s.push(`<text class="pc-ax" x="4" y="${yFrio + 10}">${MOD_NF(vmax, 0)}</text><text class="pc-ax" x="4" y="${yFrio + hFrio - 8}">${MOD_NF(vmin, 0)}</text>`);
  }
  // Envasado.
  d.envasado.forEach((e) => {
    const cls = e.tipo === "production" ? TRZ_MOSTO_CLS[e.mostoId] || "pc-otro" : "trz-otro";
    const atenuado = TRZ.mosto !== "todos" && e.mostoId !== TRZ.mosto ? "trz-atenuado" : "";
    const key = `e${e.train}|${e.ms}`;
    s.push(`<rect class="${cls} trz-env ${atenuado} ${TRZ.sel === key ? "trz-sel" : ""}" x="${x(e.ms)}" y="${yTren(e.train) + 7}" width="${Math.max(1, x(e.fin) - x(e.ms))}" height="${hTren - 14}" rx="2" data-trz-key="${key}" data-trz-tip="${escapeHtml(`L${e.train} · ${e.name} · ${trzF(e.ms)} → ${trzF(e.fin)}${e.hL ? " · " + trzHL(e.hL) : ""}`)}"></rect>`);
  });
  // Curvas cocimiento → envasado.
  const selC = TRZ.sel && TRZ.sel.startsWith("c") ? TRZ.sel : null;
  const selE = TRZ.sel && TRZ.sel.startsWith("e") ? TRZ.sel.slice(1).split("|") : null;
  d.cocs.forEach((c) => {
    if (TRZ.mosto !== "todos" && c.mostoId !== TRZ.mosto) return;
    c.consumo.forEach((z) => {
      const x1 = x(c.ms) + 3;
      const y1 = yCoc + hCoc - 6;
      const x2 = x((z.desde + z.hasta) / 2);
      const y2 = yTren(z.train) + 7;
      const marcada = selC === c.key || (selE && String(z.train) === selE[0] && z.desde < Number(selE[1]) + 1 && z.hasta > Number(selE[1]) - 1);
      const ym = (y1 + y2) / 2;
      s.push(`<path class="trz-link ${TRZ_MOSTO_CLS[c.mostoId] ? "trz-l-" + c.mostoId : ""} ${marcada ? "trz-link-sel" : ""}" d="M ${x1} ${y1} C ${x1} ${ym}, ${x2} ${ym}, ${x2} ${y2}"></path>`);
    });
  });
  // Cocimientos.
  d.cocs.forEach((c) => {
    const atenuado = TRZ.mosto !== "todos" && c.mostoId !== TRZ.mosto ? "trz-atenuado" : "";
    const enCurso = c.ms <= t && t < c.fin ? "trz-encurso" : "";
    s.push(`<rect class="${TRZ_MOSTO_CLS[c.mostoId] || "pc-otro"} trz-coc ${atenuado} ${enCurso} ${TRZ.sel === c.key ? "trz-sel" : ""} ${c.tarde ? "trz-tarde" : ""}" x="${x(c.ms)}" y="${yCoc + 8}" width="${Math.max(3, x(c.fin) - x(c.ms))}" height="${hCoc - 16}" rx="2" data-trz-key="${c.key}" data-trz-tip="${escapeHtml(`${trzNombreMosto(c.mostoId)} n.º ${c.n} · cargue ${trzF(c.ms)} · fin ${trzF(c.fin)}${c.consumo.length ? " · va a " + c.consumo.map((z) => `L${z.train} ${trzF(z.desde)}`).join(", ") : ""}`)}"></rect>`);
  });
  // Momento elegido.
  if (t >= d.desde && t <= d.hasta) s.push(`<line class="trz-ahora" x1="${x(t)}" y1="${eje - 6}" x2="${x(t)}" y2="${H - 10}"></line><text class="pc-ax trz-ahora-t" x="${x(t) + 4}" y="${eje - 8}">${escapeHtml(trzF(t))}</text>`);
  const labs = `<div class="pvr-lab" style="height:${eje}px"></div><div class="pvr-lab" style="height:${hCoc}px"><b>Cocina</b><small>${d.cocs.length} cocimientos</small></div><div class="pvr-lab" style="height:${hFrio + 6}px"><b>Frío</b><small>índice estimado</small></div><div class="pvr-lab pvr-lab-h" style="height:${hueco}px"><small>fermentación + maduración</small></div>${trenes.map((tr) => `<div class="pvr-lab" style="height:${hTren}px"><b>L${escapeHtml(tr)}</b><small>envasado</small></div>`).join("")}`;
  const sc = document.getElementById("trzSvgWrap");
  const prev = sc ? sc.scrollLeft : null;
  cont.innerHTML = `<div class="pvr-tl"><div class="pvr-labs">${labs}</div><div class="pvr-svgwrap" id="trzSvgWrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="pvr-svg">${s.join("")}</svg></div></div>`;
  const wrap = document.getElementById("trzSvgWrap");
  if (wrap) {
    if (TRZ.irA) {
      wrap.scrollLeft = Math.max(0, x(TRZ.irA) - wrap.clientWidth / 3);
      TRZ.irA = null;
    } else if (prev != null) wrap.scrollLeft = prev;
    else wrap.scrollLeft = Math.max(0, x(Math.min(Math.max(t, d.desde), d.hasta)) - wrap.clientWidth / 3);
  }
  TRZ._x = x;
}

/* ------------------------------------------------------------- eventos */

function trzSeleccionar(key, d) {
  TRZ.sel = key;
  const det = document.getElementById("trzDetalle");
  if (det) det.innerHTML = trzHtmlDetalle(d);
  trzDibujarLinea(d, TRZ.ahora);
  trzConectarLinea(d);
  document.querySelectorAll(".trz-tabla .pvr-fila").forEach((tr) => tr.classList.toggle("pvr-fila-sel", tr.dataset.trzVer === key));
}

function trzConectarLinea(d) {
  const svg = document.querySelector("#trzLinea svg");
  if (!svg) return;
  svg.addEventListener("click", (e) => {
    const k = e.target.getAttribute && e.target.getAttribute("data-trz-key");
    if (k) trzSeleccionar(k, d);
  });
  svg.addEventListener("mousemove", (e) => {
    const tip = e.target.getAttribute && e.target.getAttribute("data-trz-tip");
    if (tip && typeof pcMostrarTip === "function") pcMostrarTip(e, tip, []);
    else if (typeof pcOcultarTip === "function") pcOcultarTip();
  });
  svg.addEventListener("mouseleave", () => typeof pcOcultarTip === "function" && pcOcultarTip());
}

function trzIrA(ms) {
  const wrap = document.getElementById("trzSvgWrap");
  if (wrap && TRZ._x) wrap.scrollTo({ left: Math.max(0, TRZ._x(ms) - wrap.clientWidth / 3), behavior: "smooth" });
}

function trzConectar(d, cfg) {
  const cont = document.getElementById("trazabilidadPanel");
  const re = () => renderTrazabilidad();
  const inp = document.getElementById("trzAhora");
  if (inp)
    inp.addEventListener("change", () => {
      const v = typeof parseInputDateTimeUTC === "function" ? parseInputDateTimeUTC(inp.value) : null;
      if (v) {
        TRZ.ahora = v.getTime();
        // «¿A dónde va lo que se cocina en este momento?»: se elige solo.
        const c = trzCocimientoEn(d, TRZ.ahora);
        if (c) TRZ.sel = c.key;
        re();
        trzIrA(TRZ.ahora);
      }
    });
  cont.querySelectorAll("[data-trz-ahora]").forEach((b) =>
    b.addEventListener("click", () => {
      TRZ.ahora = trzAhoraMs();
      const c = trzCocimientoEn(d, TRZ.ahora);
      if (c) TRZ.sel = c.key;
      re();
      trzIrA(TRZ.ahora);
    }),
  );
  cont.querySelectorAll("[data-trz-ir]").forEach((b) => b.addEventListener("click", () => trzIrA(TRZ.ahora)));
  cont.querySelectorAll("[data-trz-mosto]").forEach((b) =>
    b.addEventListener("click", () => {
      TRZ.mosto = b.dataset.trzMosto;
      re();
    }),
  );
  cont.querySelectorAll("[data-trz-zoom]").forEach((b) =>
    b.addEventListener("click", () => {
      TRZ.pxH = Number(b.dataset.trzZoom);
      trzGuardar(cfg);
      const wrap = document.getElementById("trzSvgWrap");
      if (wrap) wrap.remove();
      re();
    }),
  );
  cont.querySelectorAll("[data-trz-peso]").forEach((i) =>
    i.addEventListener("change", () => {
      const v = Number(i.value);
      if (isFinite(v) && v >= 0) {
        cfg.frio[i.dataset.trzPeso] = v;
        trzGuardar(cfg);
      }
      re();
    }),
  );
  const reset = cont.querySelector("[data-trz-reset]");
  if (reset)
    reset.addEventListener("click", () => {
      cfg.frio = { ...TRZ_FRIO_DEFECTO };
      trzGuardar(cfg);
      re();
    });
  if (!cont.dataset.trzDelegado) {
    cont.dataset.trzDelegado = "1";
    cont.addEventListener("click", (e) => {
      const b = e.target.closest("[data-trz-ver]");
      if (b) {
        const datos = calcularTrazabilidad(trzConfig());
        trzSeleccionar(b.dataset.trzVer, datos);
        const k = b.dataset.trzVer;
        const ms = k.startsWith("c") ? (datos.cocs.find((c) => c.key === k) || {}).ms : Number(k.split("|")[1]);
        if (ms) trzIrA(ms);
        if (b.tagName !== "TR") {
          const tl = document.getElementById("trzLinea");
          if (tl) tl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      const g = e.target.closest("[data-trz-irms]");
      if (g) {
        trzIrA(Number(g.dataset.trzIrms));
        const tl = document.getElementById("trzLinea");
        if (tl) tl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
  trzConectarLinea(d);
}
