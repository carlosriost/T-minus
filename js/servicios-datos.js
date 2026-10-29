/* =========================================================================
   CONSUMOS DE SERVICIOS · 1) Lectura del Excel «Indicadores de servicios»
   -------------------------------------------------------------------------
   Lee valores Y fórmulas (SheetJS, cellFormula) para saber de dónde sale
   cada número: medición, residuo de contadores, valor imputado, ajuste
   manual o valor escrito a mano. Arma el dataset fecha × línea × servicio
   con unidades y trazabilidad, y aplica las reglas de calidad verificables.
   Es el mismo proceso del proyecto Python de referencia
   (prediccion_servicios/src/excel_reader.py, dataset_maestro.py,
   data_cleaning.py, data_audit.py).
   Funciona igual en el navegador y en Node (pruebas).
   ========================================================================= */
(function (raiz) {
  "use strict";

  // Mapeo VERIFICADO del Excel (config/columnas.yaml del proyecto Python).
  const SRV_CFG = {
    lineas: ["L5", "L7", "L8", "L9"],
    nombres: { L5: "Línea 5 (Tren 5)", L7: "Línea 7 (Tren 7)", L8: "Línea 8 (Tren 8)", L9: "Línea 9 (PET)" },
    tren: { L5: "5", L7: "7", L8: "8", L9: "9" },
    produccion: { hoja: "MAESTRA", colFecha: "A", fila: 4, columnas: { L5: "CF", L7: "CH", L8: "CJ", L9: "CL" },
      validacion: { hoja: "DATOS SEMANA", colFecha: "C", fila: 6, columnas: { L5: "CC", L7: "CE", L8: "CG", L9: "CI" } } },
    vapor: { hoja: "MAESTRA", colFecha: "A", fila: 4,
      lineas: { L7: { total: "BS", comp: { lavadora: "BQ", pasteurizadora: "BR" } }, L5: { total: "BW", comp: { lavadora: "BU", pasteurizadora: "BV" } },
        L8: { total: "CA", comp: { lavadora: "BY", pasteurizadora: "BZ" } }, L9: { total: "CC", comp: {} } },
      pet: { linea: "L9", hoja: "Vapor Envasado", colFecha: "A", fila: 6, tunel: "U", flash: "V" } },
    electricidad: {
      lineas: { L5: { hoja: "Electria L5", recibe: true }, L7: { hoja: "Electrica L7", recibe: true }, L8: { hoja: "Electrica L8", recibe: true }, L9: { hoja: "Electrica L9", recibe: false } },
      colFecha: "B", fila: 3, total: "C", produccion: "E",
      aux: { hoja: "Electria L5", total: "K", parte: "Q", reparte: ["L5", "L7", "L8"] },
    },
    agua: { hoja: "DATOS SEMANA", colFecha: "C", fila: 6, columnas: { L5: "CL", L7: "CN", L8: "CP", L9: "CR" }, total: "G" },
    verificar: {
      MAESTRA: { CF2: "hls envasados por lineas", CF3: "l5", CH3: "l7", CJ3: "l8", CL3: "l9", BQ2: "lavadora", BR2: "pasteurizadora", BS2: "tren 7", BS3: "kg", BW2: "tren 5", BW3: "kg", CA2: "tren 8", CA3: "kg", CC2: "pet", A3: "dia" },
      "Electria L5": { C1: "kwh dia", E1: "hl env", K1: "auxiliares" },
      "Electrica L7": { C1: "kwh dia", E1: "hl env" },
      "Electrica L8": { C1: "kwh dia", E1: "hl env" },
      "Electrica L9": { C1: "kwh dia", E1: "hl env" },
      "DATOS SEMANA": { CL4: "agua envase", CL5: "l5", CN5: "l7", CP5: "l8", CR5: "l9", CC4: "produccion envase" },
      "Vapor Envasado": { U4: "tunel", V4: "flash" },
      "Agua Semanal": { I3: "hl agua" },
    },
  };
  const HOJAS = ["MAESTRA", "DATOS SEMANA", "Electria L5", "Electrica L7", "Electrica L8", "Electrica L9", "Vapor Envasado", "Agua Semanal"];
  const LINEA_AUX = "AUX";
  const GRAVEDAD = { vacio: 6, residuo: 5, imputado: 4, valor_fijo: 2, ajuste_manual: 1, medicion: 0 };

  /* ------------------------------------------------------------ utilidades */
  function normalizar(t) {
    return String(t == null ? "" : t).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function colNum(l) {
    let n = 0;
    for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64);
    return n;
  }
  function colLetra(n) {
    let s = "";
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function serialAFecha(v) {
    if (typeof v !== "number" || !isFinite(v) || v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  function aNumero(v) {
    if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    let t = String(v).trim();
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
    const n = Number(t);
    return t !== "" && isFinite(n) ? n : null;
  }
  function numEs(v, d, signo) {
    if (v === null || v === undefined) return "—";
    const s = Math.abs(v).toFixed(d || 0);
    const [e, f] = s.split(".");
    const miles = e.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const sg = v < 0 && Number(s) !== 0 ? "-" : signo ? "+" : "";
    return sg + miles + (f ? "," + f : "");
  }
  function pctEs(v, d, signo) {
    return v === null || v === undefined ? "—" : numEs(v * 100, d === undefined ? 1 : d, signo) + " %";
  }

  // Acceso a celdas de un libro SheetJS.
  function celda(wb, hoja, col, fila) {
    const ws = wb.Sheets[hoja];
    return ws ? ws[col + fila] : undefined;
  }
  function valor(wb, hoja, col, fila) {
    const c = celda(wb, hoja, col, fila);
    return c ? c.v : null;
  }
  function formula(wb, hoja, col, fila) {
    const c = celda(wb, hoja, col, fila);
    if (!c) return null;
    if (c.f) return "=" + c.f;
    return c.v === undefined ? null : c.v;
  }
  function ultimaFila(wb, hoja) {
    const ws = wb.Sheets[hoja];
    if (!ws || !ws["!ref"]) return 0;
    return XLSXref(ws["!ref"]);
  }
  function XLSXref(ref) {
    const m = /:([A-Z]+)(\d+)$/.exec(ref);
    return m ? Number(m[2]) : 0;
  }

  /* ------------------------------------------------------------ procedencia */
  // Evaluador mínimo de aritmética (+ − × ÷ y paréntesis), sin eval.
  function evaluarAritmetica(s) {
    let i = 0;
    const ver = () => s[i];
    function numero() {
      const m = /^\d+(\.\d+)?/.exec(s.slice(i));
      if (!m) throw new Error("x");
      i += m[0].length;
      return Number(m[0]);
    }
    function factor() {
      if (ver() === "+") { i++; return factor(); }
      if (ver() === "-") { i++; return -factor(); }
      if (ver() === "(") { i++; const v = expr(); if (ver() !== ")") throw new Error("x"); i++; return v; }
      return numero();
    }
    function termino() {
      let v = factor();
      while (ver() === "*" || ver() === "/") { const o = s[i++]; const w = factor(); v = o === "*" ? v * w : v / w; }
      return v;
    }
    function expr() {
      let v = termino();
      while (ver() === "+" || ver() === "-") { const o = s[i++]; const w = termino(); v = o === "+" ? v + w : v - w; }
      return v;
    }
    const v = expr();
    if (i !== s.length) throw new Error("x");
    return v;
  }
  function quitarFunciones(f) {
    let s = f;
    for (;;) {
      const m = /[A-Z][A-Z0-9.]*\(/.exec(s);
      if (!m) break;
      let i = m.index + m[0].length, prof = 1;
      while (i < s.length && prof) { if (s[i] === "(") prof++; else if (s[i] === ")") prof--; i++; }
      s = s.slice(0, m.index) + "0" + s.slice(i);
    }
    s = s.replace(/('[^']*'|\[\d+\][A-Za-z_ ]+|[A-Za-z_]+)!/g, "");
    s = s.replace(/\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?/g, "0");
    return s;
  }
  function ajusteManual(f) {
    if (typeof f !== "string" || f[0] !== "=") return 0;
    const s = quitarFunciones(f.slice(1)).replace(/\s/g, "");
    if (!s || !/^[\d.+\-*/()]+$/.test(s)) return 0;
    try { return evaluarAritmetica(s); } catch (_) { return 0; }
  }
  const RE_IMPUTADO = /^=\+?\$?[A-Z]{1,3}\$?\d+\s*\*\s*[0-9.]+$/;
  function procedencia(f, v) {
    if ((f === null || f === undefined) && (v === null || v === undefined)) return ["vacio", 0];
    if (!(typeof f === "string" && f[0] === "=")) return ["valor_fijo", 0];
    if (f.includes("'Contadores vapor'")) return ["residuo", 0];
    if (RE_IMPUTADO.test(f.replace(/\s/g, ""))) return ["imputado", 0];
    const a = ajusteManual(f);
    if (Math.abs(a) > 1e-9) return ["ajuste_manual", a];
    return ["medicion", 0];
  }
  function peor(procs) {
    let t = procs[0][0];
    for (const p of procs) if (GRAVEDAD[p[0]] > GRAVEDAD[t]) t = p[0];
    return [t, procs.reduce((s, p) => s + p[1], 0)];
  }

  /* ------------------------------------------------------------ estructura */
  function verificarEstructura(wb) {
    const hechas = [], errores = [];
    for (const h of HOJAS) if (!wb.Sheets[h]) errores.push(`Falta la hoja «${h}»`);
    if (errores.length) throw new Error("El archivo no parece el de Indicadores de servicios: " + errores.join("; "));
    for (const [hoja, celdas] of Object.entries(SRV_CFG.verificar)) {
      for (const [ref, esperado] of Object.entries(celdas)) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        const v = normalizar(valor(wb, hoja, m[1], Number(m[2])));
        if (v.includes(normalizar(esperado))) hechas.push(`${hoja}!${ref} contiene «${esperado}»`);
        else errores.push(`${hoja}!${ref}: se esperaba «${esperado}» y dice «${v}»`);
      }
    }
    if (errores.length) throw new Error("La estructura del Excel cambió (no se leyó nada para no usar datos equivocados):\n- " + errores.join("\n- "));
    return hechas;
  }

  // Solo celdas con FORMATO de fecha (un número suelto en la columna, como
  // un total, no es una fecha).
  function esCeldaFecha(c) {
    if (!c || typeof c.v !== "number") return false;
    if (c.t === "d") return true;
    const z = c.z || "";
    if (raiz.XLSX && raiz.XLSX.SSF && z) return raiz.XLSX.SSF.is_date(z);
    return /[dmy]/i.test(z.replace(/"[^"]*"/g, "")) && !/^General$/i.test(z);
  }
  function mapaFilas(wb, hoja, colFecha, fila0, avisos) {
    const out = new Map();
    const n = ultimaFila(wb, hoja);
    const rep = new Set();
    for (let r = fila0; r <= n; r++) {
      const c = celda(wb, hoja, colFecha, r);
      if (!esCeldaFecha(c)) continue;
      const f = serialAFecha(c.v);
      if (!f) continue;
      if (out.has(f)) rep.add(f);
      else out.set(f, r);
    }
    if (rep.size) avisos.push(`${hoja}: fechas repetidas ${[...rep].slice(0, 5).join(", ")} — se usa la primera aparición`);
    return out;
  }

  /* ------------------------------------------------------------ dataset */
  function construirDataset(wb) {
    const C = SRV_CFG, avisos = [], lineas = C.lineas;
    // Producción.
    const P = C.produccion;
    const fp = mapaFilas(wb, P.hoja, P.colFecha, P.fila, avisos);
    const prod = new Map();
    for (const [fecha, r] of fp) for (const ln of lineas) {
      const col = P.columnas[ln];
      const v = aNumero(valor(wb, P.hoja, col, r));
      prod.set(fecha + "|" + ln, [v, `${P.hoja}!${col}${r}`, procedencia(formula(wb, P.hoja, col, r), v)]);
    }
    let ultima = null, primera = null;
    for (const [k, v] of prod) {
      const f = k.slice(0, 10);
      if (primera === null || f < primera) primera = f;
      if (v[0] && v[0] > 0 && (ultima === null || f > ultima)) ultima = f;
    }
    if (!ultima) throw new Error("No hay producción en el Excel.");
    const pval = (f, ln) => (prod.get(f + "|" + ln) || [null])[0];
    // Validación cruzada de producción.
    const V = P.validacion;
    const fv = mapaFilas(wb, V.hoja, V.colFecha, V.fila, avisos);
    const difsProd = [];
    for (const f of [...fp.keys()].sort()) {
      if (f > ultima || !fv.has(f)) continue;
      for (const ln of lineas) {
        const a = pval(f, ln) || 0, b = aNumero(valor(wb, V.hoja, V.columnas[ln], fv.get(f))) || 0;
        if (Math.abs(a - b) > 0.5) difsProd.push({ fecha: f, linea: ln, MAESTRA: a, otra: b });
      }
    }
    const filas = [];
    function agregar(fecha, linea, servicio, v, unidad, fuente, f, proc, extra, prodAux) {
      const pp = linea === LINEA_AUX ? prodAux : prod.get(fecha + "|" + linea) || [null, "", ["vacio", 0]];
      filas.push(Object.assign({
        fecha, linea, servicio, produccion_hL: pp[0], consumo: v, unidad, fuente,
        formula: typeof f === "string" ? f : f === null || f === undefined ? "" : "valor escrito: " + f,
        procedencia: proc[0], ajuste_manual: proc[1], fuera_de_periodo: fecha > ultima,
      }, extra || {}));
    }
    // Vapor.
    const Vp = C.vapor;
    const fvap = mapaFilas(wb, Vp.hoja, Vp.colFecha, Vp.fila, avisos);
    const pet = Vp.pet;
    const fpet = mapaFilas(wb, pet.hoja, pet.colFecha, pet.fila, avisos);
    const petVsMaestra = [];
    for (const [fecha, r] of fvap) for (const ln of lineas) {
      const d = Vp.lineas[ln];
      const v = aNumero(valor(wb, Vp.hoja, d.total, r));
      const f = formula(wb, Vp.hoja, d.total, r);
      const procs = [procedencia(f, v)];
      for (const c of Object.values(d.comp)) procs.push(procedencia(formula(wb, Vp.hoja, c, r), aNumero(valor(wb, Vp.hoja, c, r))));
      const proc = peor(procs);
      const comps = Object.values(d.comp);
      const fuente = `${Vp.hoja}!${d.total}${r}` + (comps.length ? ` (= ${comps.map((c) => c + r).join(" + ")})` : "");
      if (ln === pet.linea && fpet.has(fecha)) {
        const rr = fpet.get(fecha);
        const tun = aNumero(valor(wb, pet.hoja, pet.tunel, rr)), fla = aNumero(valor(wb, pet.hoja, pet.flash, rr));
        const ft = formula(wb, pet.hoja, pet.tunel, rr), ff = formula(wb, pet.hoja, pet.flash, rr);
        const directo = typeof ft === "string" && ft[0] === "=" && typeof ff === "string" && ff[0] === "=" && tun !== null && fla !== null;
        if (directo && proc[0] === "medicion" && v !== null) petVsMaestra.push({ fecha, MAESTRA: v, directo: tun + fla, diferencia: v - (tun + fla) });
        if (directo && ["residuo", "valor_fijo", "vacio"].includes(proc[0])) {
          agregar(fecha, ln, "vapor", tun + fla, "kg", `${pet.hoja}!${pet.tunel}${rr} + ${pet.flash}${rr} (túnel + flash; MAESTRA!${d.total}${r} era ${proc[0]})`, ft + " + " + ff,
            peor([procedencia(ft, tun), procedencia(ff, fla)]), { procedencia_maestra: proc[0] });
          continue;
        }
      }
      agregar(fecha, ln, "vapor", v, "kg", fuente, f, proc);
    }
    // Electricidad (contador directo, sin auxiliares) + auxiliares compartidos.
    const E = C.electricidad, A = E.aux;
    const faux = mapaFilas(wb, A.hoja, E.colFecha, E.fila, avisos);
    const difsElec = [];
    for (const ln of lineas) {
      const d = E.lineas[ln];
      const fe = mapaFilas(wb, d.hoja, E.colFecha, E.fila, avisos);
      for (const [fecha, r] of fe) {
        const tot = aNumero(valor(wb, d.hoja, E.total, r));
        const f = formula(wb, d.hoja, E.total, r);
        const hl = aNumero(valor(wb, d.hoja, E.produccion, r)) || 0;
        const pm = pval(fecha, ln) || 0;
        if (fecha <= ultima && Math.abs(hl - pm) > 0.5) difsElec.push({ fecha, linea: ln, hoja: hl, MAESTRA: pm });
        let parte = 0;
        if (d.recibe && faux.has(fecha) && hl > 0) parte = aNumero(valor(wb, A.hoja, A.parte, faux.get(fecha))) || 0;
        agregar(fecha, ln, "electricidad", tot === null ? null : tot - parte, "kWh",
          `${d.hoja}!${E.total}${r}` + (parte ? ` − ${A.hoja}!${A.parte}${faux.get(fecha)} (auxiliares asignados)` : ""), f, procedencia(f, tot),
          { electricidad_oficial_kWh: tot, electricidad_aux_asignada_kWh: parte });
      }
    }
    for (const [fecha, r] of faux) {
      const k = aNumero(valor(wb, A.hoja, A.total, r));
      const f = formula(wb, A.hoja, A.total, r);
      const ps = A.reparte.map((ln) => pval(fecha, ln));
      const pt = ps.reduce((s, p) => s + (p || 0), 0);
      agregar(fecha, LINEA_AUX, "electricidad", k, "kWh", `${A.hoja}!${A.total}${r}`, f, procedencia(f, k),
        { lineas_activas: ps.filter((p) => p && p > 0).length }, [pt, "suma " + A.reparte.join("+"), ["medicion", 0]]);
    }
    // Agua.
    const G = C.agua;
    const fa = mapaFilas(wb, G.hoja, G.colFecha, G.fila, avisos);
    const difsAgua = [];
    for (const [fecha, r] of fa) {
      let suma = 0;
      for (const ln of lineas) {
        const col = G.columnas[ln];
        const v = aNumero(valor(wb, G.hoja, col, r));
        const f = formula(wb, G.hoja, col, r);
        suma += v || 0;
        agregar(fecha, ln, "agua", v, "hL", `${G.hoja}!${col}${r}`, f, procedencia(f, v), { agua_m3: v === null ? null : v * 0.1 });
      }
      const tot = aNumero(valor(wb, G.hoja, G.total, r));
      if (fecha <= ultima && tot !== null && Math.abs(tot - suma) > 1) difsAgua.push({ fecha, total: tot, suma, diferencia: tot - suma });
    }
    filas.sort((a, b) => (a.servicio < b.servicio ? -1 : a.servicio > b.servicio ? 1 : a.linea < b.linea ? -1 : a.linea > b.linea ? 1 : a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
    return { filas, primera, ultima, avisos, difsProd, difsElec, petVsMaestra, difsAgua };
  }

  /* ------------------------------------------------------------ reglas */
  const MOTIVOS = {
    fuera: "Fecha posterior al último día con producción: las filas futuras del Excel traen valores de plantilla.",
    sin_dato: "Celda vacía o no numérica.",
    residuo: "No es una medición de la línea: es el vapor total de envase de calderas menos otros contadores (incluye pérdidas y consumos sin medir).",
    imputado: "Valor estimado con otra columna (p. ej. pasteurizadora = lavadora × 0,87), no medido.",
    negativo: "Valor negativo: error de lectura o de ajuste.",
    cero: "Consumo 0 en un día con producción: lectura faltante probable.",
    sin_produccion: "Día sin producción en la línea: no entra al modelo de producción; se usa para describir el consumo base.",
  };
  function aplicarReglas(filas) {
    for (const r of filas) {
      let e, m = "";
      if (r.fuera_de_periodo) { e = "fuera_de_periodo"; m = MOTIVOS.fuera; }
      else if (r.consumo === null || r.consumo === undefined || Number.isNaN(r.consumo)) { e = "excluido"; m = MOTIVOS.sin_dato; }
      else if (r.procedencia === "residuo") { e = "excluido"; m = MOTIVOS.residuo; }
      else if (r.procedencia === "imputado") { e = "excluido"; m = MOTIVOS.imputado; }
      else if (r.consumo < 0) { e = "excluido"; m = MOTIVOS.negativo; }
      else if (r.produccion_hL === null || r.produccion_hL === undefined || r.produccion_hL <= 0) { e = "sin_produccion"; m = MOTIVOS.sin_produccion; }
      else if (r.consumo === 0) { e = "excluido"; m = MOTIVOS.cero; }
      else e = "valido";
      r.estado = e;
      r.motivo_exclusion = m;
      r.marca = "";
      if (e === "valido" || e === "sin_produccion") {
        if (r.procedencia === "ajuste_manual") r.marca = `La fórmula del Excel suma o resta un número escrito a mano al contador (ajuste manual de ${numEs(r.ajuste_manual || 0, 0, true)}).`;
        if (r.procedencia === "valor_fijo") r.marca = "Valor escrito a mano en la celda (no viene del archivo de contadores).";
      }
      r.dudoso = r.marca !== "";
    }
    return filas;
  }

  /* ------------------------------------------------------------ calidad */
  function resumenCalidad(filas) {
    const g = new Map();
    for (const r of filas) {
      if (r.fuera_de_periodo) continue;
      const k = r.servicio + "|" + r.linea;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    return [...g.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, x]) => {
      const [servicio, linea] = k.split("|");
      const cnt = (fn) => x.filter(fn).length;
      const val = cnt((r) => r.estado === "valido"), sp = cnt((r) => r.estado === "sin_produccion");
      return {
        servicio, linea, unidad: x[0].unidad, desde: x[0].fecha, hasta: x[x.length - 1].fecha, dias: x.length,
        validos_con_produccion: val, sin_produccion: sp, excluidos: cnt((r) => r.estado === "excluido"),
        excl_residuo: cnt((r) => r.procedencia === "residuo"), excl_imputado: cnt((r) => r.procedencia === "imputado" && r.estado === "excluido"),
        excl_sin_dato: cnt((r) => r.motivo_exclusion === MOTIVOS.sin_dato), excl_negativo: cnt((r) => r.motivo_exclusion === MOTIVOS.negativo),
        excl_cero_con_produccion: cnt((r) => r.motivo_exclusion === MOTIVOS.cero),
        con_ajuste_manual: cnt((r) => r.procedencia === "ajuste_manual"), valor_escrito_a_mano: cnt((r) => r.procedencia === "valor_fijo"),
        cobertura_valida_pct: Math.round((1000 * val) / Math.max(1, x.length - sp)) / 10,
      };
    });
  }
  function chequeos(ds) {
    const out = [];
    const add = (chequeo, resultado, detalle) => out.push({ chequeo, resultado, detalle });
    add("Producción MAESTRA = DATOS SEMANA", ds.difsProd.length ? `${ds.difsProd.length} diferencias` : "OK", "Se comparó día a día cada línea (tolerancia 0,5 hL).");
    add("Producción de las hojas eléctricas = MAESTRA", ds.difsElec.length ? `${ds.difsElec.length} diferencias` : "OK", "La producción con la que se reparten los auxiliares es la misma de MAESTRA.");
    if (ds.petVsMaestra.length) {
      const nd = ds.petVsMaestra.filter((x) => Math.abs(x.diferencia) > 0.5).length;
      add("Vapor PET: MAESTRA (cuando es medición) = túnel + flash", nd ? `${nd} diferencias` : "OK", `${ds.petVsMaestra.length} días comparados.`);
    }
    add("Agua de envase = suma de las 4 líneas", ds.difsAgua.length ? `${ds.difsAgua.length} días no cuadran` : "OK",
      ds.difsAgua.length ? ds.difsAgua.map((r) => `${r.fecha}: ${numEs(r.diferencia, 0, true)} hL`).join("; ") : "Todos los días cuadran.");
    const x = ds.filas.filter((r) => !r.fuera_de_periodo && r.servicio === "electricidad");
    const asign = x.filter((r) => r.linea !== LINEA_AUX).reduce((s, r) => s + (r.electricidad_aux_asignada_kWh || 0), 0);
    const aux = x.filter((r) => r.linea === LINEA_AUX).reduce((s, r) => s + (r.consumo || 0), 0);
    add("Auxiliares eléctricos repartidos = auxiliares medidos", `${numEs(aux - asign)} kWh sin repartir`,
      `Auxiliares medidos ${numEs(aux)} kWh; repartidos a L5/L7/L8 ${numEs(asign)} kWh. La regla del Excel usa 0,33 × 3 = 99 % y no reparte los días sin producción en esas líneas.`);
    for (const a of ds.avisos) add("Aviso de lectura", "Revisar", a);
    return out;
  }
  function auditoriaReglas(filas) {
    const crit = { residuo: "Fórmula = residuo de contadores", imputado: "Fórmula = otra columna × factor", ajuste_manual: "Fórmula con número escrito a mano", valor_fijo: "Valor escrito a mano" };
    const dec = { excluido: "Excluido del entrenamiento", valido: "Se conserva (marcado)", sin_produccion: "Se conserva como consumo base (marcado)" };
    return filas
      .filter((r) => !r.fuera_de_periodo && (r.estado === "excluido" || r.dudoso))
      .map((r) => ({ fecha: r.fecha, linea: r.linea, variable: `${r.servicio} (${r.unidad})`, valor_original: r.consumo, fuente: r.fuente, criterio: crit[r.procedencia] || "Regla de datos", decision: dec[r.estado], justificacion: (r.motivo_exclusion + " " + r.marca).trim() }));
  }

  // Lee un ArrayBuffer/Buffer con SheetJS (solo las hojas necesarias).
  function leerLibro(XLSXlib, datos, tipo) {
    return XLSXlib.read(datos, { type: tipo || "array", cellFormula: true, cellDates: false, cellNF: true, cellStyles: false, sheets: HOJAS });
  }
  function hojasDelLibro(XLSXlib, datos, tipo) {
    const b = XLSXlib.read(datos, { type: tipo || "array", bookSheets: true, bookProps: true });
    const info = (b.Workbook && b.Workbook.Sheets) || [];
    return { hojas: b.SheetNames, ocultas: info.filter((s) => s.Hidden).map((s) => s.name) };
  }

  const api = { SRV_CFG, HOJAS, LINEA_AUX, normalizar, colNum, colLetra, serialAFecha, aNumero, numEs, pctEs, procedencia, ajusteManual, evaluarAritmetica, verificarEstructura, construirDataset, aplicarReglas, resumenCalidad, chequeos, auditoriaReglas, leerLibro, hojasDelLibro, MOTIVOS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else raiz.SrvDatos = api;
})(typeof window !== "undefined" ? window : globalThis);
