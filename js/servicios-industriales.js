/* =========================================================================
   CONSUMOS DE SERVICIOS · 5) Planta completa y servicios industriales
   -------------------------------------------------------------------------
   Lee del Excel «Indicadores de servicios» el consumo total de la planta
   (electricidad, agua, vapor y energía térmica) y el de cada sistema de
   servicios industriales (refrigeración, aire comprimido, planta de CO2,
   calderas, sistema de agua, BTS, periféricos...).

   Para cada serie hay, cuando se puede, dos versiones:
     · oficial: la celda resumen del Excel, tal cual;
     · contador: la suma de los contadores sin los números sumados o
       restados a mano en sus fórmulas (y, en vapor, la diferencia de las
       lecturas, que no depende del total escrito).
   Además se revisan valores escritos a mano, cambios raros del factor de
   un contador (×4, ×1500...) y dobles conteos.

   Los modelos usan el mismo método que elaboración (SrvElab.motor):
   hL cocinados, filtrados y envasados, solos y combinados; validación
   temporal; el más simple dentro del 3 % del mejor; margen del 90 %.
   ========================================================================= */
(function (raiz) {
  "use strict";
  const enNode = typeof module !== "undefined" && module.exports;
  const D = enNode ? require("./servicios-datos.js") : raiz.SrvDatos;
  const EL = enNode ? require("./servicios-elaboracion.js") : raiz.SrvElab;
  const MO = EL.motor;

  const E = "ENERGIA SERV-PERI", A = "AGUA SERV-PERI", V = "Contadores vapor", C = "Combustibles", CO = "CONSUMO CO2", DS = "DATOS SEMANA", EE = "ENERGIA ELECTRICA";
  const HOJAS_IND = [E, A, V, C, CO, DS, EE, "MAESTRA"];
  const COL_FECHA = { [E]: "A", [A]: "A", [V]: "A", [C]: "A", [CO]: "A", [DS]: "C", [EE]: "A", MAESTRA: "A" };
  const UMBRAL = MO.CFG.umbral_base;

  const k = (sh, cols, f) => cols.map((c) => [sh, c, f === undefined ? 1 : f]);
  const MYCOM = k(E, ["AH", "AK", "AN", "AQ"]), AIRE = k(E, ["P", "S", "Y", "AB", "CN"]);
  const CALD = k(E, ["AT", "BI", "AW", "AZ", "BC", "BF"]), SAGUA = k(E, ["BL", "BO", "BR"]), PERI = k(E, ["BV", "CH", "CQ"]);
  // Vapor por contador: diferencia de las dos lecturas que usa la fórmula del total.
  // [hoja, columna del total, factor a kg, "dif", columna de lecturas]. Casino (BF) sin lecturas confiables (~0,1 %).
  const VAPOR_LECT = [[V, "AS", 1, "dif", "AR"], [V, "AU", 1000, "dif", "AT"], [V, "AW", 1000, "dif", "AV"], [V, "AY", 1000, "dif", "AX"], [V, "BD", 1000, "dif", "BC"]];
  const NAT = ["env", "coc"];

  // clave: [sistema, servicio, unidad, oficial, contador|null, opciones, descripción]
  const CAT = {
    elec_planta: ["Planta", "electricidad", "kWh", [[EE, "B", 1]], [[EE, "B", 1]], { ajuste_valor: [[E, "DO", 1]], marca_de: ["BV", "CH", "CQ"] }, "ISAGEN 44 kV menos perímetros (hoja ENERGIA ELECTRICA); contador = sin el «ajuste autorizado»"],
    agua_planta: ["Planta", "agua", "hL", [[DS, "T", 1]], null, {}, "entrada EEPPMM (contadores de elaboración + envase + perímetros) menos lo que va fuera de planta (DATOS SEMANA)"],
    vapor_planta: ["Planta", "vapor", "kg", [[V, "BG", 1000]], VAPOR_LECT, {}, "vapor consumido por todas las áreas (Gran total de Contadores vapor)"],
    termica_planta: ["Planta", "térmica", "MJ", [[C, "AK", 1], [C, "BL", 1], [C, "AN", -1]], [[C, "AK", 1], [C, "BC", 1, "BI"], [C, "AN", -1]], { excluye_si: [[V, "DV", "ajuste autorizado de gas natural"]] }, "gas natural + biogás + GLP, sin el calor vendido al casino"],
    termica_comprada: ["Planta", "térmica comprada", "MJ", [[C, "AE", 1], [C, "AG", 1], [C, "BL", 1], [C, "AN", -1]], [[C, "AE", 1], [C, "AG", 1], [C, "BC", 1, "BI"], [C, "AN", -1]], { excluye_si: [[V, "DV", "ajuste autorizado de gas natural"]] }, "gas natural + GLP comprados, sin biogás propio ni el calor vendido al casino (es el indicador oficial «Térmica comprada»)"],
    elec_refrigeracion: ["Refrigeración", "electricidad", "kWh", k(E, ["DV"]), MYCOM, { lect_de_oficial: ["DS", "D", "V"] }, "oficial = compresores Mycom + un % de maquinaria auxiliar que cambia (50–100 %); contador = solo compresores"],
    elec_maquinaria: ["Maquinaria auxiliar", "electricidad", "kWh", k(E, ["DS"]), null, { lect_de: ["D", "V"] }, "subestaciones de maquinaria 440 V y 220 V"],
    elec_aire: ["Aire comprimido", "electricidad", "kWh", k(E, ["DT"]), AIRE, {}, "compresores Ingersoll, Sierra, Elliot y Centac"],
    elec_co2: ["Planta de CO2", "electricidad", "kWh", k(E, ["DU"]), k(E, ["CW"]), {}, "planta de CO2 + Haffmans"],
    elec_calderas: ["Calderas", "electricidad", "kWh", k(E, ["DR"]), CALD, {}, "subestación de vapor y calderas 1 a 6"],
    elec_sistema_agua: ["Sistema de agua", "electricidad", "kWh", k(E, ["DX"]), null, { lect_de: ["BL", "BO", "BR"] }, "potabilizadora, pozo de bombeo y PTAR"],
    elec_servicios: ["Total servicios", "electricidad", "kWh", k(E, ["DR", "DS", "DT", "DU", "DX"]).concat(MYCOM), CALD.concat(k(E, ["DS"]), AIRE, k(E, ["CW"]), SAGUA, MYCOM), { lect_de: ["D", "V"] }, "cada contador una sola vez (el TOTAL SERVICIOS del Excel cuenta dos veces parte de maquinaria)"],
    elec_perimetro: ["Periféricos (perímetro)", "electricidad", "kWh", k(E, ["EB"]), PERI, {}, "Teleperformance, casino y taller industrial"],
    agua_refrigeracion: ["Refrigeración", "agua", "hL", [[DS, "DE", 1]], k(A, ["AB", "AH"], 10), {}, "condensadores de NH3 + chester"],
    agua_aire: ["Aire comprimido", "agua", "hL", [[DS, "DA", 1]], null, {}, "torres de enfriamiento + planta eléctrica"],
    agua_co2: ["Planta de CO2", "agua", "hL", [[DS, "DC", 1]], null, {}, "contador de la planta de CO2"],
    agua_calderas: ["Calderas", "agua", "hL", [[DS, "CY", 1]], null, { ceros: true }, "agua de reposición de calderas; lecturas atrasadas (días en cero y luego días de recuperación)"],
    agua_bts: ["BTS", "agua", "hL", [[DS, "DH", 1]], null, { ceros: true }, "contador «Residuales nueva»; muchos días en cero (uso intermitente)"],
    agua_reciclada: ["Sistema terciario", "agua reciclada", "hL", [[DS, "DJ", 1]], null, { ceros: true }, "agua reciclada del sistema terciario"],
    agua_servicios: ["Total servicios", "agua", "hL", [[DS, "J", 1]], null, {}, "calderas + maquinaria (TOTAL SERVICIOS de AGUA SERV-PERI)"],
    agua_perimetro: ["Periféricos (perímetro)", "agua", "hL", [[DS, "M", 1]], null, {}, "casino, taller, almacén, edificio técnico, reempaque, recibo de envase"],
    agua_no_perimetro: ["Fuera de planta (no perímetro)", "agua", "hL", [[DS, "W", 1]], null, {}, "colegios, club, edificio administrativo, ventas"],
    agua_epm: ["Entrada de agua (EEPPMM)", "agua", "hL", [[DS, "AM", 1]], null, {}, "columna EEPPMM: en el Excel es la suma de los contadores de elaboración, envase y perímetros (con ajustes a mano), no una lectura propia"],
    co2_recoleccion: ["Planta de CO2", "CO2 recolectado", "kg", [[CO, "B", 1]], null, { escrito_ok: true, nat: ["coc"] }, "CO2 recuperado de fermentación (dato escrito diario)"],
    co2_consumo: ["Planta de CO2", "CO2 consumido", "kg", k(CO, ["G", "Y"]), k(CO, ["G", "Y"]), {}, "vaporizador + CO2 directo"],
  };
  const SISTEMAS = ["Planta", "Refrigeración", "Aire comprimido", "Planta de CO2", "Calderas", "Sistema de agua", "Maquinaria auxiliar", "BTS", "Sistema terciario", "Periféricos (perímetro)", "Total servicios", "Entrada de agua (EEPPMM)", "Fuera de planta (no perímetro)"];

  /* ------------------------------------------------------------ celdas */
  const media = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  function med(a) { const b = a.slice().sort((x, y) => x - y), n = b.length; if (!n) return NaN; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
  function crudo(wb, sh, col, row) {
    const ws = wb.Sheets[sh], x = ws ? ws[col + row] : undefined;
    if (!x) return { v: null, f: null };
    const v = x.t !== "e" && typeof x.v === "number" && isFinite(x.v) ? x.v : null; // celdas con error (#N/A…) no son números
    const f = x.f ? "=" + x.f : x.v === undefined || x.v === null || x.v === "" ? null : "VAL";
    return { v, f };
  }
  const esFormula = (f) => typeof f === "string" && f.startsWith("=");

  // Suma de los números sueltos sumados o restados al nivel superior de la fórmula
  // («…+1000», «…-535.7», «(…)+350»); no toca números dentro de paréntesis o funciones.
  function ajustes(f) {
    if (!esFormula(f)) return 0;
    const s = f.slice(1).replace(/\s/g, "");
    let depth = 0, cur = "", sign = "+";
    const terms = [];
    for (const c of s) {
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      if (depth === 0 && (c === "+" || c === "-") && cur !== "" && !/[Ee]$/.test(cur) && !/[*/]$/.test(cur)) { terms.push([sign, cur]); sign = c; cur = ""; }
      else if (depth === 0 && (c === "+" || c === "-") && cur === "") sign = (sign === "-") !== (c === "-") ? "-" : "+";
      else cur += c;
    }
    if (cur) terms.push([sign, cur]);
    let tot = 0;
    for (const [sg, t] of terms) {
      if (/^\(*\d+(\.\d+)?%?\)*$/.test(t) && (t.match(/\(/g) || []).length === (t.match(/\)/g) || []).length) {
        const u = t.replace(/[()]/g, "");
        const v = parseFloat(u) / (u.endsWith("%") ? 100 : 1); tot += sg === "+" ? v : -v;
      }
    }
    return tot;
  }
  function factorFormula(f) {
    if (!esFormula(f)) return 1;
    const m = /\)([*/])(\d+(?:\.\d+)?)$/.exec(f.replace(/\s/g, ""));
    if (!m) return 1;
    return m[1] === "*" ? parseFloat(m[2]) : 1 / parseFloat(m[2]);
  }

  /* ------------------------------------------------------------ lectura */
  function mapaFechas(wb, sh, desde, hasta) {
    const ws = wb.Sheets[sh], out = new Map();
    if (!ws || !ws["!ref"]) return out;
    const col = COL_FECHA[sh], n = Number((/:([A-Z]+)(\d+)$/.exec(ws["!ref"]) || [0, 0, 0])[2]);
    for (let r = 1; r <= n; r++) {
      const c = ws[col + r];
      if (!c || typeof c.v !== "number") continue;
      const z = c.z || "";
      const fecha = c.t === "d" || (raiz.XLSX && raiz.XLSX.SSF && z ? raiz.XLSX.SSF.is_date(z) : /[dmy]/i.test(z.replace(/"[^"]*"/g, "")) && !/^General$/i.test(z));
      if (!fecha) continue;
      const f = D.serialAFecha(c.v);
      if (f && f >= desde && f <= hasta && !out.has(f)) out.set(f, r);
    }
    return out;
  }

  function lector(wb, mapas) {
    const fechasOrd = {};
    for (const [sh, m] of Object.entries(mapas)) fechasOrd[sh] = [...m.keys()].sort();
    function cel(sh, col, d) { const r = mapas[sh].get(d); return r ? crudo(wb, sh, col, r) : null; }
    function fac(c, d) {
      if (c.length > 3 && c[3] !== "dif") { const x = cel(c[0], c[3], d); return x && x.v !== null ? c[2] * x.v : null; }
      return c[2];
    }
    // [valor, ajuste, escrito a mano] ; valor null = sin dato
    function comp(c, d, variante) {
      const m = mapas[c[0]];
      if (!m.has(d)) return [null, 0, false];
      if (c.length > 3 && c[3] === "dif") {
        const [sh, tot, F, , lc] = c;
        const t = cel(sh, tot, d);
        const mm = t && esFormula(t.f) ? new RegExp(lc + "(\\d+)\\s*-\\s*" + lc + "(\\d+)").exec(t.f) : null;
        let a, b;
        if (mm) { a = crudo(wb, sh, lc, Number(mm[1])).v; b = crudo(wb, sh, lc, Number(mm[2])).v; }
        else {
          const fs = fechasOrd[sh], i = fs.indexOf(d);
          a = crudo(wb, sh, lc, m.get(d)).v;
          b = i > 0 ? crudo(wb, sh, lc, m.get(fs[i - 1])).v : null;
        }
        if (!a) return [0, 0, false];
        if (b === null) return [null, 0, false];
        if (a < b) return [null, 0, false, `lectura menor que la anterior (${lc})`];
        return [(a - b) * F, 0, false];
      }
      const x = cel(c[0], c[1], d);
      if (x.v === null) return x.f === null ? [0, 0, false] : [null, 0, false];
      const F = fac(c, d);
      if (F === null) return [null, 0, false];
      const a = ajustes(x.f), t = !esFormula(x.f);
      return [(variante === "contador" ? x.v - a : x.v) * F, a * F, t];
    }
    return { cel, comp };
  }

  // Días en que el factor de la fórmula de un contador difiere del habitual y el
  // nivel cambia en esa misma proporción (p. ej. ×4 durante un mes): error de factor.
  function factoresRaros(L, col, fechas) {
    const fs = new Map(), vs = new Map();
    for (const d of fechas) { const x = L.cel(E, col, d); if (!x || x.v === null || !esFormula(x.f)) continue; fs.set(d, factorFormula(x.f)); vs.set(d, x.v); }
    const out = new Map();
    if (!fs.size) return out;
    const cnt = new Map();
    for (const f of fs.values()) cnt.set(f, (cnt.get(f) || 0) + 1);
    let modal = null, mx = -1;
    for (const [f, n] of cnt) if (n > mx) { mx = n; modal = f; }
    const base = [...fs.keys()].filter((d) => fs.get(d) === modal && vs.get(d) > 0).map((d) => vs.get(d));
    if (base.length < 10) return out;
    const mb = med(base);
    if (!(mb > 0)) return out;
    for (const fct of new Set(fs.values())) {
      if (fct === modal) continue;
      const ds = [...fs.keys()].filter((d) => fs.get(d) === fct);
      const vv = ds.map((d) => vs.get(d)).filter((v) => v > 0);
      const mv = vv.length ? med(vv) : 0;
      const rf = fct / modal, rv = Math.max(mv, 1e-9) / mb;
      if (Math.abs(Math.log(rv) - Math.log(rf)) < Math.abs(Math.log(rv))) {
        const g = (x) => (x >= 1 ? "×" + D.numEs(x, x % 1 ? 1 : 0) : Math.abs(1 / x - Math.round(1 / x)) < 1e-9 ? "÷" + D.numEs(1 / x, 0) : "×" + D.numEs(x, 2));
        for (const d of ds) out.set(d, `${col}: factor ${g(fct)} en la fórmula (lo habitual es ${g(modal)}) y el nivel se mueve en esa dirección`);
      }
    }
    return out;
  }

  function leer(wb, desde, hasta) {
    const faltan = HOJAS_IND.filter((h) => !wb.Sheets[h]);
    if (faltan.length) throw new Error("Faltan hojas para servicios industriales: " + faltan.join(", "));
    const prodF = EL.leer(wb, desde, hasta);
    const fechas = prodF.map((r) => r.fecha);
    const prod = new Map(prodF.map((r) => [r.fecha, { coc: r.coc || 0, fil: r.fil || 0, env: r.env || 0 }]));
    const medias = { coc: media(prodF.map((r) => r.coc || 0)), fil: media(prodF.map((r) => r.fil || 0)), env: media(prodF.map((r) => r.env || 0)) };
    const mapas = {};
    for (const sh of HOJAS_IND) mapas[sh] = mapaFechas(wb, sh, desde, hasta);
    const L = lector(wb, mapas);
    const colsE = new Set(["D", "V", "BL", "BO", "BR"]);
    for (const v of Object.values(CAT)) for (const c of v[3].concat(v[4] || [])) if (c[0] === E) colsE.add(c[1]);
    const raros = {};
    for (const col of [...colsE].sort()) raros[col] = factoresRaros(L, col, fechas);
    return { fechas, prod, medias, L, raros };
  }

  const mismo = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  function series(R) {
    const { fechas, prod, medias, L, raros } = R;
    const out = {}, meta = {};
    for (const [s, [sis, serv, uni, ofi, cont, op, desc]] of Object.entries(CAT)) {
      const nat = op.nat || NAT;
      for (const [variante, comps] of [["oficial", ofi], ["contador", cont]]) {
        if (!comps) continue;
        const key = cont ? `${s}_${variante === "oficial" ? "oficial" : "medido"}` : s;
        meta[key] = { base: s, sistema: sis, servicio: serv, unidad: uni, variante: cont ? variante : "", naturales: nat, descripcion: desc, opciones: op };
        // Factor raro en un contador que entra en la serie → día excluido; en uno que solo la afecta de lado → marcado.
        let colsDir = comps.filter((c) => c[0] === E).map((c) => c[1]).concat(op.lect_de || []);
        if (variante === "oficial") colsDir = colsDir.concat((cont || []).filter((c) => c[0] === E).map((c) => c[1]), op.lect_de_oficial || []);
        const colsM = op.marca_de || [];
        out[key] = fechas.map((d) => {
          const p = prod.get(d);
          let tot = 0, aj = 0, falta = false, mFalta = "sin dato";
          const escritas = [];
          for (const c of comps) {
            const [v, a, t, nota] = L.comp(c, d, variante);
            if (v === null) { falta = true; if (nota) mFalta = nota; break; }
            tot += v; aj += a;
            if (t) escritas.push(c[1]);
          }
          let ajM = aj;
          if (variante === "oficial" && cont && !falta) {
            for (const c of cont) {
              if (c.length > 3 && c[3] === "dif") { const x = L.cel(c[0], c[1], d); if (x && x.v !== null && esFormula(x.f)) ajM += ajustes(x.f) * c[2]; continue; }
              if (comps.some((o) => mismo(o, c))) continue;
              ajM += L.comp(c, d, "contador")[1];
            }
          }
          for (const c of op.ajuste_valor || []) {
            const x = L.cel(c[0], c[1], d), v3 = ((x && x.v) || 0) * c[2];
            if (variante === "contador" && !falta) tot -= v3; else ajM += v3;
          }
          const exc = (op.excluye_si || []).filter((c) => { const x = L.cel(c[0], c[1], d); return x && x.v; }).map((c) => c[2]);
          const uniq = (l) => [...new Set(l)];
          const rr = uniq(colsDir.filter((c) => raros[c] && raros[c].has(d)).map((c) => raros[c].get(d)));
          const rm = uniq(colsM.filter((c) => raros[c] && raros[c].has(d)).map((c) => raros[c].get(d)));
          let estado = "valido", motivo = "", marca = "";
          if (falta) { estado = "excluido"; motivo = mFalta; tot = null; }
          else if (escritas.length && !op.escrito_ok && (variante === "contador" || comps.length === 1)) { estado = "excluido"; motivo = `valor escrito a mano (${escritas.join(",")})`; }
          if (estado === "valido" && rr.length) { estado = "excluido"; motivo = rr.join("; "); }
          if (estado === "valido" && exc.length) { if (variante === "contador") { estado = "excluido"; motivo = exc.join("; "); } else marca = exc.join("; "); }
          if (estado === "valido" && rm.length && !marca) marca = rm.join("; ");
          if (estado === "valido" && tot < 0) { estado = "excluido"; motivo = "valor negativo"; }
          if (estado === "valido" && variante === "oficial" && Math.abs(ajM) > 1e-9 && !marca) marca = `ajuste manual ${D.numEs(ajM, 0, true)} ${uni}`;
          if (estado === "valido" && nat.every((n) => p[n] < UMBRAL * medias[n])) { estado = "carga_base"; motivo = "producción < 5 % de la media"; }
          if (estado === "valido" && tot === 0 && !op.ceros) { estado = "excluido"; motivo = "consumo cero con producción"; }
          return { fecha: d, consumo: tot, ajuste: ajM, coc: p.coc, fil: p.fil, env: p.env, estado, motivo, marca, dudoso: !!marca };
        });
      }
    }
    return { series: out, meta };
  }

  /* ------------------------------------------------------------ auditoría */
  function auditar(R, S) {
    const { fechas, L, raros } = R;
    const val = (sh, col, d) => { const x = L.cel(sh, col, d); return x ? x.v : null; };
    // DV (refrigeración) = compresores + DS × %; el % cambia y TOTAL SERVICIOS suma DS otra vez.
    const pcts = new Map();
    let doble = 0, nd = 0;
    for (const d of fechas) {
      const x = L.cel(E, "DV", d);
      const m = x && esFormula(x.f) ? /DS\d+\*(\d+)%/.exec(x.f) : null;
      const raro = ["D", "V", "DS"].some((c) => raros[c] && raros[c].has(d));
      if (m) { pcts.set(m[1] + " %", (pcts.get(m[1] + " %") || 0) + 1); const ds = val(E, "DS", d); if (ds !== null && !raro) { doble += (ds * Number(m[1])) / 100; nd++; } }
    }
    const ajustesPor = {};
    for (const key of Object.keys(S.series)) {
      if (!/_oficial$/.test(key)) continue;
      const rows = S.series[key].filter((r) => r.consumo !== null);
      const n = rows.filter((r) => Math.abs(r.ajuste) > 1e-9).length;
      if (n) ajustesPor[key] = { dias: n, suma: rows.reduce((a, r) => a + r.ajuste, 0), oficial: rows.reduce((a, r) => a + r.consumo, 0) };
    }
    const factores = [];
    for (const [col, m] of Object.entries(raros)) {
      if (!m.size) continue;
      const ds = [...m.keys()].sort();
      // Tramos seguidos (por fecha) para mostrar «del 25/05 al 30/06».
      const tramos = [];
      for (const d of ds) {
        const t = tramos[tramos.length - 1], i = fechas.indexOf(d);
        if (t && fechas.indexOf(t[1]) === i - 1) t[1] = d; else tramos.push([d, d]);
      }
      factores.push({ columna: col, dias: ds.length, tramos, detalle: m.get(ds[ds.length - 1]) });
    }
    const escritos = {};
    for (const [key, rows] of Object.entries(S.series)) {
      const l = rows.filter((r) => /escrito a mano/.test(r.motivo)).map((r) => r.fecha);
      if (l.length) escritos[key] = l;
    }
    // Agua: entrada de planta vs. suma de áreas; tanques.
    let difAgua = [], tanques = 0;
    for (const d of fechas) {
      const t = val(DS, "T", d), q = val(DS, "Q", d), bh = val(DS, "BH", d);
      if (t !== null && q !== null) difAgua.push(q - t);
      if (bh) tanques++;
    }
    // Vapor oficial vs. contador, solo en días con las dos cifras.
    let vo = 0, vc = 0;
    S.series.vapor_planta_oficial.forEach((r, i) => { const c = S.series.vapor_planta_medido[i]; if (r.consumo !== null && c.consumo !== null) { vo += r.consumo; vc += c.consumo; } });
    return {
      dias: fechas.length,
      refrigeracion_pct: [...pcts.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ pct: p, dias: n })),
      doble_conteo_kwh_dia: nd ? doble / nd : null,
      ajustes: ajustesPor,
      factores,
      escritos,
      agua_areas_menos_entrada_hl_dia: difAgua.length ? media(difAgua) : null,
      agua_dias_variacion_tanques: tanques,
      vapor_oficial_vs_contador: vc ? vo / vc - 1 : null,
    };
  }

  /* ------------------------------------------------------------ indicadores oficiales */
  // Indicadores de planta que publica el Excel (MAESTRA): agua G (hL/hL) y térmica V (MJ/hL),
  // ponderados por los hL envasados de cada día (B), por mes. Sirven para comprobar que los
  // totales de planta de este módulo dan el mismo indicador que el Excel.
  function oficiales(R) {
    const mes = new Map();
    for (const d of R.fechas) {
      const x = (c) => { const v = R.L.cel("MAESTRA", c, d); return v ? v.v : null; };
      const b = x("B"), g = x("G"), t = x("V");
      if (!(b > 1)) continue;
      const k = d.slice(0, 7);
      if (!mes.has(k)) mes.set(k, { mes: k, env: 0, agua: 0, env_agua: 0, termica: 0, env_term: 0 });
      const a = mes.get(k);
      a.env += b;
      if (g !== null && isFinite(g) && g < 50) { a.agua += g * b; a.env_agua += b; }
      if (t !== null && isFinite(t) && t < 1000) { a.termica += t * b; a.env_term += b; }
    }
    return [...mes.values()].map((a) => ({ mes: a.mes, env: a.env, agua_hl_hl: a.env_agua ? a.agua / a.env_agua : null, termica_mj_hl: a.env_term ? a.termica / a.env_term : null }));
  }

  /* ------------------------------------------------------------ todo */
  function entrenar(wb, periodo, progreso) {
    const t0 = Date.now();
    const R = leer(wb, periodo.desde, periodo.hasta);
    const S = series(R);
    const modelos = {};
    const claves = Object.keys(S.series);
    claves.forEach((s, i) => {
      if (progreso) progreso(i / claves.length, s);
      const mt = S.meta[s], xs = S.series[s], nat = mt.naturales;
      const v = xs.filter((r) => r.estado === "valido");
      const spec = Object.assign({ serie: s }, mt, { n_estados: {} });
      delete spec.opciones;
      xs.forEach((r) => (spec.n_estados[r.estado] = (spec.n_estados[r.estado] || 0) + 1));
      const b = xs.filter((r) => r.estado !== "excluido" && r.consumo !== null && nat.every((n) => r[n] < UMBRAL * R.medias[n])).map((r) => r.consumo);
      spec.carga_base = b.length ? { n: b.length, mediana: MO.mediana(b), min: Math.min(...b), max: Math.max(...b), p10: MO.cuantil(b, 0.1), p90: MO.cuantil(b, 0.9) } : { n: 0 };
      spec.media_valida = v.length ? media(v.map((r) => r.consumo)) : null;
      if (v.length >= 40) {
        const hb = new MO.Multi("huber").fit(MO.XY(v, nat), v.map((r) => r.consumo));
        spec.fijo_operando = hb.b[0];
        const r = MO.evaluarSerie(v);
        delete r.candidatos; // se guarda solo el resumen por variable (por_driver) para no llenar el navegador
        Object.assign(spec, r);
        spec.calidad = MO.calidad(r);
        spec.habilitado = !/no confiable/i.test(spec.calidad);
        const e = v.map((x) => x.consumo / Math.max(1, x[nat[0]])), h = Math.floor(e.length / 2);
        const e1 = MO.mediana(e.slice(0, h)), e2 = MO.mediana(e.slice(h));
        spec.estabilidad = { especifico_1: e1, especifico_2: e2, cambio: e2 / e1 - 1 };
      } else { spec.habilitado = false; spec.calidad = "Sin datos suficientes"; }
      spec.historico = xs.map((r) => ({ f: r.fecha, c: r.consumo === null ? null : Math.round(r.consumo * 10) / 10, e: r.estado, m: (r.motivo || r.marca || "").slice(0, 90) }));
      modelos[s] = spec;
    });
    if (progreso) progreso(1, "listo");
    return { formato: "industriales/1", desde: periodo.desde, hasta: periodo.hasta, medias: R.medias, umbral_base: UMBRAL, nivel: MO.CFG.nivel, modelos, auditoria: auditar(R, S), oficiales: oficiales(R), segundos: (Date.now() - t0) / 1000 };
  }

  /* ------------------------------------------------------------ predicción */
  // prod = { coc, fil, env } en hL del día. Devuelve una fila por serie.
  function predecir(I, prod) {
    const out = {};
    for (const [s, m] of Object.entries(I.modelos)) {
      const r = { serie: s, sistema: m.sistema, servicio: m.servicio, variante: m.variante, unidad: m.unidad, calidad: m.calidad, habilitado: m.habilitado };
      const bajo = m.naturales.every((n) => (prod[n] || 0) < I.umbral_base * I.medias[n]);
      if (bajo && m.carga_base && m.carga_base.n) {
        r.estimado = m.carga_base.mediana; r.intervalo = [m.carga_base.p10, m.carga_base.p90]; r.carga_base = true;
      } else if (m.web) {
        const x = m.cols.map((c) => prod[c] || 0);
        r.estimado = EL.evaluarWeb(m.web, x);
        r.intervalo = [Math.max(0, r.estimado + m.q[0]), r.estimado + m.q[1]];
        r.extrapolacion = x.some((v, j) => v < m.lo[j] || v > m.hi[j]);
      } else r.estimado = null;
      out[s] = r;
    }
    return out;
  }
  // Serie que se muestra para (base, variante): la versión pedida si existe.
  function clave(I, base, variante) {
    if (I.modelos[base]) return base;
    const k1 = `${base}_${variante === "contador" ? "medido" : "oficial"}`;
    return I.modelos[k1] ? k1 : null;
  }

  const api = { HOJAS_IND, CAT, SISTEMAS, ajustes, factorFormula, leer, series, entrenar, predecir, clave };
  if (enNode) module.exports = api;
  else raiz.SrvInd = api;
})(typeof window !== "undefined" ? window : globalThis);
