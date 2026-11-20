/* =========================================================================
   ACUERDOS DE SERVICIO DESDE EXCEL
   -------------------------------------------------------------------------
   Para cambiar los acuerdos sin tocar el código:
     1) se descarga el Excel con los acuerdos que hoy usa T-minus,
     2) se edita (texto, ponderación, meta, Activo = No para quitar, filas
        nuevas para agregar),
     3) se vuelve a cargar: T-minus muestra qué cambia y se aplica solo si el
        usuario confirma.
   Lo que se puede cambiar:
     · Texto del acuerdo, en las tres áreas.
     · Ponderación, en los acuerdos que T-minus ya mide.
     · Meta, en los acuerdos de Logística que tienen un número configurable
       (L3, L4, L5).
     · Activo = No (o borrar la fila): el acuerdo sale de la calificación.
     · Fila nueva con un ID nuevo: el acuerdo aparece en la lista, sin
       calificar, hasta que se programe la regla para medirlo.
   Todo queda en este navegador (y viaja en el paquete de la semana).
   ========================================================================= */
(function () {
  "use strict";
  const AREAS = [
    { id: "sla", nombre: "SLA Planta" },
    { id: "log", nombre: "Logística de envasado" },
    { id: "ela", nombre: "Elaboración" },
  ];
  const nombreArea = (id) => (AREAS.find((a) => a.id === id) || {}).nombre || id;
  const METAS_LOG = {
    L3: { clave: "umbralLineaHL", txt: "hL mínimos por corrida de línea" },
    L4: { clave: "maxCambiosFormato", txt: "cambios de formato máximos por línea y semana" },
    L5: { clave: "umbralFiltroHL", txt: "hL mínimos por corrida de filtro entre CIP" },
  };
  const COLS = ["Área", "ID", "Acuerdo", "Ponderación", "Meta", "Activo (Sí/No)", "Qué se puede cambiar"];
  let PREVIA = null; // { archivo, filas, cambios, errores }
  let MSG = "";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) =>
    String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim();

  function baseLog() {
    const cfg = configLogistica();
    return [
      { id: "L1", texto: "No planificar marcas Light al inicio de la semana" },
      { id: "L2", texto: "No iniciar la semana con malta (Pony)" },
      { id: "L3", texto: `Hacer corridas de líneas de más de ${MOD_NF(cfg.umbralLineaHL)} hL` },
      { id: "L4", texto: `Máximo ${cfg.maxCambiosFormato} cambios de formato por línea y semana` },
      { id: "L5", texto: `Corridas en filtro de más de ${MOD_NF(cfg.umbralFiltroHL)} hL` },
    ];
  }
  function bases() {
    return {
      sla: { lista: typeof SLA_PLANTA_VERDES !== "undefined" ? SLA_PLANTA_VERDES : [], idKey: "n" },
      log: { lista: baseLog(), idKey: "id" },
      ela: { lista: typeof REGLAS_OPERATIVAS !== "undefined" ? REGLAS_OPERATIVAS : [], idKey: "id" },
    };
  }

  // Los acuerdos como los usa T-minus hoy (originales + lo cargado de Excel),
  // incluidos los desactivados, para poder volver a activarlos.
  function acuerdosActuales() {
    const g = acuerdosExcelGuardados();
    const B = bases();
    const pesosSla = typeof slaPesos === "function" ? slaPesos() : {};
    const pondEla = typeof ponderacionAcuerdos === "function" ? ponderacionAcuerdos() : {};
    const cfg = configLogistica();
    const out = [];
    AREAS.forEach(({ id: area }) => {
      const { lista, idKey } = B[area];
      const ex = g ? g.filas.filter((f) => f.area === area) : [];
      const porId = new Map(ex.map((f) => [String(f.id), f]));
      const pond = (id) => (area === "sla" ? pesosSla[id] : area === "ela" ? pondEla[id] : cfg.pond[id]);
      lista.forEach((a) => {
        const id = String(a[idKey]);
        const f = porId.get(id);
        const quitado = ex.length && !f;
        const m = area === "log" ? METAS_LOG[id] : null;
        out.push({
          area,
          id,
          texto: (f && f.texto) || a.texto,
          ponderacion: pond(a[idKey]) != null ? pond(a[idKey]) : null,
          meta: m ? cfg[m.clave] : null,
          activo: !(quitado || (f && f.activo === false)),
          nuevo: false,
          nota: [pond(a[idKey]) != null ? "texto y ponderación" : "texto", m ? `meta (${m.txt})` : ""].filter(Boolean).join(", "),
        });
      });
      ex.filter((f) => !lista.some((a) => String(a[idKey]) === String(f.id))).forEach((f) =>
        out.push({ area, id: String(f.id), texto: f.texto, ponderacion: f.ponderacion, meta: null, activo: f.activo !== false, nuevo: true, nota: "acuerdo nuevo: aún sin regla para medirlo" }),
      );
    });
    return out;
  }

  /* ----------------------------------------------------------- descargar */
  function descargar() {
    if (typeof XLSX === "undefined") {
      MSG = "No se pudo crear el Excel: la librería de Excel no cargó. Revise la conexión y recargue la página.";
      return renderAcuerdosExcel();
    }
    const filas = acuerdosActuales().map((a) => [nombreArea(a.area), a.area === "sla" || a.area === "ela" ? (isFinite(Number(a.id)) ? Number(a.id) : a.id) : a.id, a.texto, a.ponderacion == null ? "" : a.ponderacion, a.meta == null ? "" : a.meta, a.activo ? "Sí" : "No", a.nota]);
    const ws = XLSX.utils.aoa_to_sheet([COLS, ...filas]);
    ws["!cols"] = [{ wch: 22 }, { wch: 6 }, { wch: 90 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 52 }];
    const ins = XLSX.utils.aoa_to_sheet([
      ["Cómo usar este Excel"],
      [""],
      ["1. Cambie el texto, la ponderación o la meta en la hoja «Acuerdos»."],
      ["2. Para quitar un acuerdo, ponga «No» en Activo (o borre la fila)."],
      ["3. Para agregar uno, escriba una fila nueva con un ID que no exista en esa área."],
      ["4. No cambie los nombres de las columnas ni de las áreas: SLA Planta, Logística de envasado, Elaboración."],
      ["5. Cárguelo en T-minus, en «Acuerdos de servicio → Cargar acuerdos (Excel)». T-minus le muestra qué cambia antes de aplicarlo."],
      [""],
      ["Ponderación: en SLA Planta es el peso relativo de cada acuerdo (1 = normal); en Logística y Elaboración es el % del score."],
      ["Meta: solo se puede cambiar en Logística L3, L4 y L5 (la columna «Qué se puede cambiar» lo dice)."],
      ["Un acuerdo nuevo aparece en la lista sin calificar hasta que se programe en T-minus la regla para medirlo."],
    ]);
    ins["!cols"] = [{ wch: 110 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Acuerdos");
    XLSX.utils.book_append_sheet(wb, ins, "Instrucciones");
    XLSX.writeFile(wb, "Acuerdos_de_servicio_T-minus.xlsx");
  }

  /* -------------------------------------------------------------- cargar */
  function areaDe(txt) {
    const t = norm(txt);
    if (!t) return null;
    if (t.includes("sla") || t.includes("planta")) return "sla";
    if (t.includes("logist") || t.includes("envasado")) return "log";
    if (t.includes("elabor")) return "ela";
    return null;
  }
  function numero(v) {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
    return isFinite(n) && n >= 0 ? n : NaN;
  }

  function leer(buffer, archivo) {
    const wb = XLSX.read(buffer, { type: "array" });
    let aoa = null, hr = -1;
    for (const n of wb.SheetNames) {
      const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: true });
      const i = a.findIndex((r) => (r || []).some((v) => norm(v) === "area") && (r || []).some((v) => norm(v) === "id"));
      if (i >= 0) {
        aoa = a;
        hr = i;
        break;
      }
    }
    if (!aoa) throw new Error("No encontré la hoja de acuerdos: debe tener las columnas «Área», «ID» y «Acuerdo». Use el Excel que descarga T-minus.");
    const h = aoa[hr].map(norm);
    const col = (pref) => h.findIndex((x) => x.startsWith(pref));
    const c = { area: col("area"), id: col("id"), texto: col("acuerdo"), pond: col("ponderacion"), meta: col("meta"), activo: col("activo") };
    if (c.texto < 0) throw new Error("Falta la columna «Acuerdo».");
    const filas = [], errores = [], vistos = new Set();
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (row.every((v) => String(v).trim() === "")) continue;
      const area = areaDe(row[c.area]);
      const id = String(row[c.id] == null ? "" : row[c.id]).trim();
      const texto = String(row[c.texto] == null ? "" : row[c.texto]).trim();
      const fila = r + 1;
      if (!area) {
        errores.push(`Fila ${fila}: el área «${row[c.area]}» no es SLA Planta, Logística de envasado ni Elaboración.`);
        continue;
      }
      if (!id) {
        errores.push(`Fila ${fila}: falta el ID.`);
        continue;
      }
      const clave = area + "|" + norm(id);
      if (vistos.has(clave)) {
        errores.push(`Fila ${fila}: el ID ${id} está repetido en ${nombreArea(area)}.`);
        continue;
      }
      vistos.add(clave);
      const pond = c.pond >= 0 ? numero(row[c.pond]) : null;
      const meta = c.meta >= 0 ? numero(row[c.meta]) : null;
      if (Number.isNaN(pond)) errores.push(`Fila ${fila}: la ponderación «${row[c.pond]}» no es un número; se deja la actual.`);
      if (Number.isNaN(meta)) errores.push(`Fila ${fila}: la meta «${row[c.meta]}» no es un número; se deja la actual.`);
      const act = c.activo >= 0 ? norm(row[c.activo]) : "";
      filas.push({ area, id: area === "log" ? id.toUpperCase() : id, texto, ponderacion: Number.isNaN(pond) ? null : pond, meta: Number.isNaN(meta) ? null : meta, activo: !/^(no|n|0|false|inactivo)$/.test(act) });
    }
    if (!filas.length) throw new Error("El Excel no trae ningún acuerdo válido.");
    return { archivo, filas, errores, cambios: comparar(filas) };
  }

  // Qué cambia respecto a lo que T-minus usa hoy.
  function comparar(filas) {
    const actuales = acuerdosActuales();
    const cambios = [];
    const enExcel = new Set(filas.map((f) => f.area + "|" + norm(f.id)));
    filas.forEach((f) => {
      const a = actuales.find((x) => x.area === f.area && norm(x.id) === norm(f.id));
      if (!a) {
        cambios.push({ tipo: "nuevo", f, txt: "Acuerdo nuevo (queda sin calificar hasta que se programe cómo medirlo)" });
        return;
      }
      const dif = [];
      if (f.texto && f.texto !== a.texto) dif.push("texto");
      if (f.ponderacion != null && a.ponderacion != null && !a.nuevo && f.ponderacion !== a.ponderacion) dif.push(`ponderación ${MOD_NF(a.ponderacion)} → ${MOD_NF(f.ponderacion)}`);
      if (f.ponderacion != null && a.ponderacion == null && !a.nuevo) dif.push("ponderación ignorada (T-minus no mide este acuerdo)");
      if (f.meta != null && a.meta != null && f.meta !== a.meta) dif.push(`meta ${MOD_NF(a.meta)} → ${MOD_NF(f.meta)}`);
      if (f.meta != null && a.meta == null) dif.push("meta ignorada (este acuerdo no tiene meta editable)");
      if (f.activo !== a.activo) dif.push(f.activo ? "se vuelve a activar" : "se quita (Activo = No)");
      if (dif.length) cambios.push({ tipo: f.activo ? "cambia" : "quita", f, txt: dif.join(" · ") });
    });
    actuales
      .filter((a) => a.activo && !enExcel.has(a.area + "|" + norm(a.id)))
      .forEach((a) => cambios.push({ tipo: "quita", f: a, txt: "No está en el Excel: se quita" }));
    return cambios;
  }

  function aplicar() {
    if (!PREVIA) return;
    const filas = PREVIA.filas;
    // Pesos y metas van a donde ya los guarda cada módulo.
    const B = bases();
    if (typeof slaPesos === "function" && typeof slaGuardarPesos === "function") {
      const p = slaPesos();
      filas.filter((f) => f.area === "sla" && f.ponderacion != null && p[Number(f.id)] != null).forEach((f) => (p[Number(f.id)] = f.ponderacion));
      slaGuardarPesos(p);
    }
    if (typeof ponderacionAcuerdos === "function") {
      const p = ponderacionAcuerdos();
      filas.filter((f) => f.area === "ela" && f.ponderacion != null && p[Number(f.id)] != null).forEach((f) => (p[Number(f.id)] = f.ponderacion));
      try {
        localStorage.setItem(ACUERDOS_LS_KEY, JSON.stringify(p));
      } catch (_) {}
    }
    const cfg = configLogistica();
    filas.filter((f) => f.area === "log").forEach((f) => {
      if (f.ponderacion != null && cfg.pond[f.id] != null) cfg.pond[f.id] = f.ponderacion;
      const m = METAS_LOG[f.id];
      if (m && f.meta != null) cfg[m.clave] = f.meta;
    });
    guardarConfigLogistica(cfg);
    // Textos, activos y nuevos. El texto solo se guarda si cambió: así un
    // texto que depende de la meta (L3, L4, L5) sigue la meta nueva.
    const orig = {};
    AREAS.forEach(({ id }) => B[id].lista.forEach((a) => (orig[id + "|" + norm(a[B[id].idKey])] = a.texto)));
    const baseLogNueva = baseLog();
    baseLogNueva.forEach((a) => (orig["log|" + norm(a.id)] = a.texto));
    const guardar = filas.map((f) => {
      const o = orig[f.area + "|" + norm(f.id)];
      const viejoLog = f.area === "log" ? (B.log.lista.find((a) => norm(a.id) === norm(f.id)) || {}).texto : null;
      const sinCambio = o != null && (f.texto === o || (viejoLog && f.texto === viejoLog));
      return { area: f.area, id: f.id, texto: sinCambio ? "" : f.texto, ponderacion: f.ponderacion, activo: f.activo };
    });
    try {
      localStorage.setItem(ACU_EXCEL_KEY, JSON.stringify({ archivo: PREVIA.archivo, cargado: new Date().toISOString(), filas: guardar }));
      MSG = `Listo: se aplicaron los acuerdos de «${PREVIA.archivo}».`;
    } catch (e) {
      MSG = "No se pudo guardar en este navegador: " + e.message;
    }
    PREVIA = null;
    repintarTodo();
  }

  function quitarExcel() {
    if (!confirm("¿Volver a los acuerdos originales de T-minus? Se quitan los textos, acuerdos nuevos y acuerdos desactivados que vinieron del Excel. Las ponderaciones y metas se quedan como están.")) return;
    try {
      localStorage.removeItem(ACU_EXCEL_KEY);
    } catch (_) {}
    MSG = "Se volvió a los acuerdos originales de T-minus.";
    PREVIA = null;
    repintarTodo();
  }

  function repintarTodo() {
    renderAcuerdosExcel();
    ["renderAcuerdosLogistica", "renderRecomendacionesPlan", "renderInicio"].forEach((f) => {
      if (typeof window[f] === "function")
        try {
          window[f]();
        } catch (e) {
          console.error(e);
        }
    });
  }

  /* --------------------------------------------------------------- vista */
  function renderAcuerdosExcel() {
    const cont = document.getElementById("acuExcelPanel");
    if (!cont) return;
    const g = acuerdosExcelGuardados();
    const act = acuerdosActuales();
    const tipoTxt = { nuevo: "Nuevo", cambia: "Cambia", quita: "Se quita" };
    const previa = PREVIA
      ? `<div class="acx-previa">
          <h4>Esto cambia si aplica «${esc(PREVIA.archivo)}»</h4>
          ${PREVIA.errores.length ? `<div class="pvr-falta"><b>Revise estas filas:</b><ul>${PREVIA.errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : ""}
          ${PREVIA.cambios.length
            ? `<div class="table-scroll"><table class="acx-tabla"><thead><tr><th></th><th>Área</th><th>ID</th><th>Acuerdo</th><th>Qué cambia</th></tr></thead><tbody>${PREVIA.cambios
                .map((c) => `<tr><td><span class="acx-tag acx-${c.tipo}">${tipoTxt[c.tipo]}</span></td><td>${esc(nombreArea(c.f.area))}</td><td>${esc(c.f.id)}</td><td>${esc(c.f.texto)}</td><td>${esc(c.txt)}</td></tr>`)
                .join("")}</tbody></table></div>`
            : `<p>El Excel trae los mismos acuerdos que ya usa T-minus: no hay nada que cambiar.</p>`}
          <div class="acx-acc"><button class="btn primary" id="acxAplicar" ${PREVIA.cambios.length ? "" : "disabled"}>Aplicar ${PREVIA.cambios.length} cambio(s)</button><button class="btn" id="acxCancelar">Cancelar</button></div>
        </div>`
      : "";
    cont.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>Cargar acuerdos de servicio (Excel)</h3></div>
        <div class="panel-body">
          <div class="gantt-intro">
            <p><b>Para agregar, quitar o cambiar acuerdos</b> sin tocar el código:</p>
            <ol class="acx-pasos">
              <li><b>Descargue</b> el Excel con los acuerdos que usa T-minus hoy.</li>
              <li><b>Edítelo:</b> cambie el texto, la ponderación o la meta; ponga «No» en Activo para quitar uno; escriba una fila nueva con un ID nuevo para agregar uno.</li>
              <li><b>Cárguelo</b> aquí. T-minus le muestra qué cambia y solo lo aplica si usted confirma.</li>
            </ol>
            <p class="gantt-intro-pie">Un acuerdo nuevo aparece en su pestaña <b>sin calificar</b> hasta que se programe en T-minus la regla para medirlo. La meta solo se puede cambiar en Logística L3, L4 y L5.</p>
          </div>
          <div class="acx-acc">
            <button class="btn primary" id="acxBajar">Descargar Excel de acuerdos</button>
            <label class="btn" for="acxArchivo">Cargar Excel de acuerdos</label><input type="file" id="acxArchivo" accept=".xlsx,.xls,.xlsm" hidden />
            ${g ? `<button class="btn" id="acxQuitar">Volver a los acuerdos originales</button>` : ""}
          </div>
          <p class="acx-estado">${g ? `Se usan los acuerdos cargados de «${esc(g.archivo)}» el ${esc(fmtDateTime(new Date(Date.parse(g.cargado) - 5 * 3600000)))}.` : "Se usan los acuerdos originales de T-minus."}</p>
          ${MSG ? `<div class="dc-msg ${/^(No se|Error)/.test(MSG) ? "error" : ""}">${esc(MSG)}</div>` : ""}
          ${previa}
          <h4 class="acx-sub">Acuerdos que usa T-minus hoy</h4>
          <div class="table-scroll"><table class="acx-tabla"><thead><tr><th>Área</th><th>ID</th><th>Acuerdo</th><th class="num">Ponderación</th><th class="num">Meta</th><th>Activo</th></tr></thead><tbody>${act
            .map((a) => `<tr class="${a.activo ? "" : "acx-inactivo"}"><td>${esc(nombreArea(a.area))}</td><td>${esc(a.id)}</td><td>${esc(a.texto)}${a.nuevo ? ' <span class="acx-tag acx-nuevo">Nuevo · sin calificar</span>' : ""}</td><td class="num">${a.ponderacion == null ? "—" : MOD_NF(a.ponderacion)}</td><td class="num">${a.meta == null ? "—" : MOD_NF(a.meta)}</td><td>${a.activo ? "Sí" : "No"}</td></tr>`)
            .join("")}</tbody></table></div>
        </div>
      </div>`;
    const $ = (id) => document.getElementById(id);
    $("acxBajar").onclick = descargar;
    $("acxArchivo").onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      MSG = "";
      f.arrayBuffer()
        .then((buf) => {
          PREVIA = leer(buf, f.name);
        })
        .catch((err) => {
          PREVIA = null;
          MSG = "No se pudo leer el Excel: " + err.message;
        })
        .then(renderAcuerdosExcel);
    };
    if ($("acxQuitar")) $("acxQuitar").onclick = quitarExcel;
    if ($("acxAplicar")) $("acxAplicar").onclick = aplicar;
    if ($("acxCancelar"))
      $("acxCancelar").onclick = () => {
        PREVIA = null;
        renderAcuerdosExcel();
      };
  }

  window.renderAcuerdosExcel = renderAcuerdosExcel;
})();
