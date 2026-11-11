/* =========================================================================
   DATOS DE ENTRADA — los archivos de la semana en una sola hoja
   -------------------------------------------------------------------------
   · Muestra en tarjetas los cuatro archivos que usa T-minus, con lo que se
     leyó de cada uno, y deja cargar los cuatro desde aquí.
   · Guarda lo último cargado en este navegador: el instructivo (sus bytes, en
     IndexedDB) se vuelve a leer al abrir la página; el producto en proceso,
     el programa de cocinas real, el I0 y los ajustes ya quedaban guardados, y
     los modelos de servicios van en IndexedDB.
   · Paquete de la semana: un solo archivo con todo lo anterior para llevarlo
     a otro computador (el operador lo carga una vez y le queda guardado).
     Contiene datos de la planta: se comparte solo dentro del equipo (SharePoint
     o Teams), nunca en el repositorio público.
   ========================================================================= */
(function () {
  "use strict";
  const K_INSTR = "archivo.instructivo"; // IndexedDB: { nombre, cargado, bytes }
  const LS_META = "planArchivosMeta"; // localStorage: { instructivo, pp } → { nombre, cargado, resumen }
  const LS_ORIGEN = "planPaqueteOrigen"; // de qué paquete viene lo cargado en este navegador
  const FORMATO = "tminus-paquete/1";
  // Lo que viaja en el paquete: solo claves de T-minus (el dominio
  // carlosriost.github.io lo comparten otras aplicaciones). Las preferencias de
  // pantalla de cada quien (pestañas, semana elegida, historial) no viajan.
  const VIAJAN = [
    "planCocinasI0", "planCocinasInventario", "planCocinasFactoresPP", "planCocinasLevadura", "planProgramaCocinasExcel",
    "planFiltracion", "planArchivosMeta", "planAcuerdosPonderacion", "planAcuerdosLogistica", "planSlaPlanta",
    "planUtilidades", "planSetpoints", "planModulacion", "planVsRealCocinas", "planTrazabilidad",
    "planRecCalificaciones", "planRecOrdenarConCal", "planAsistente", "tminus.servicios.cfg", "tminus.cargabase.formulas",
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fecha = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("es-CO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const leerLS = (k, d) => {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (_) {
      return d;
    }
  };
  const escribirLS = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (_) {
      return false;
    }
  };
  const meta = () => leerLS(LS_META, {}) || {};
  // «Semanas 43–46» a partir del rótulo del instructivo.
  function semanasDe(label) {
    const n = String(label || "").match(/\d+/g) || [];
    return !n.length ? "" : n.length === 1 ? "Semana " + n[0] : "Semanas " + n[0] + "–" + n[n.length - 1];
  }
  function registrar(id, m) {
    const M = meta();
    M[id] = Object.assign({}, m, { cargado: m.cargado || new Date().toISOString() });
    escribirLS(LS_META, M);
    render();
  }

  /* ------------------------------------------------------------ estado */
  let guardadoInstr = null; // { estado: "ok" | "error" | "sin-almacen", cargado }
  let msg = { srv: "", pc: "" };
  let msgPaquete = "";

  function estados() {
    const M = meta();
    const plan = typeof STATE !== "undefined" && STATE && STATE.parsed;
    const inv = (typeof INVENTORY_BALANCE !== "undefined" && INVENTORY_BALANCE) || [];
    if (typeof PC !== "undefined" && !PC && typeof pcRecuperar === "function") pcRecuperar();
    const pc = typeof PC !== "undefined" && PC && Array.isArray(PC.filas) && PC.filas.length ? PC : null;
    const srv = window.SrvApp ? SrvApp.info() : { ok: false };
    const semanas = plan ? semanasDe(plan.weekLabel) : "";
    const nBloques = plan ? Object.values(plan.rawEvents || {}).reduce((a, evs) => a + (evs || []).length, 0) : 0;
    const foto = inv.map((e) => e && e.fotoEn && Date.parse(e.fotoEn)).filter(isFinite).sort((a, b) => b - a)[0];
    return {
      instructivo: {
        ok: !!plan,
        nombre: (M.instructivo && M.instructivo.nombre) || "",
        cargado: M.instructivo && M.instructivo.cargado,
        resumen: plan ? [semanas, nBloques ? `${nBloques.toLocaleString("es-CO")} filas del instructivo` : ""].filter(Boolean).join(" · ") : "",
        aviso:
          plan && guardadoInstr && guardadoInstr.estado === "error"
            ? "No se pudo guardar en este navegador (almacenamiento lleno o bloqueado): al cerrar la página hay que volver a cargarlo."
            : "",
      },
      pp: {
        ok: inv.length > 0,
        nombre: (M.pp && M.pp.nombre) || "",
        cargado: M.pp && M.pp.cargado,
        resumen: (M.pp && M.pp.resumen) || (inv.length ? `${inv.length} equipos${foto ? " · foto del " + fecha(new Date(foto).toISOString()) : ""}` : ""),
      },
      srv: {
        ok: !!srv.ok,
        ocupado: !!srv.ocupado,
        nombre: srv.archivo || "",
        cargado: srv.guardado_en,
        resumen: srv.ok ? `datos ${srv.desde} → ${srv.hasta} · ${srv.habilitados} de ${srv.modelos} modelos de envasado habilitados` : "",
        progreso: srv.estado || "",
      },
      pc: {
        ok: !!pc,
        nombre: pc ? pc.archivo : "",
        cargado: pc && pc.cargado ? new Date(pc.cargado).toISOString() : null,
        resumen: pc ? `${pc.filas.length.toLocaleString("es-CO")} filas leídas` : "",
      },
    };
  }

  /* ------------------------------------------------------------ pintar */
  const BOTON = { instructivo: "archivo .xlsx", pp: "archivo", srv: "archivo .xlsm", pc: "archivo .xlsx" };
  function render() {
    const E = estados();
    Object.keys(E).forEach((id) => {
      const e = E[id];
      const box = $("datEstado-" + id);
      const card = box && box.closest(".datos-card");
      if (!box) return;
      if (card) card.classList.toggle("ok", e.ok);
      let html;
      if (id === "srv" && e.ocupado) html = `<div class="dc-linea curso"><span class="dc-ico">…</span><div><b>${esc(e.progreso)}</b><small>Puede tardar hasta un minuto; no cierre la pestaña.</small></div></div>`;
      else if (e.ok)
        html = `<div class="dc-linea"><span class="dc-ico ok">✓</span><div><b>${esc(e.nombre || "Cargado")}</b>${e.cargado ? `<small>cargado el ${esc(fecha(e.cargado))}</small>` : ""}${e.resumen ? `<small>${esc(e.resumen)}</small>` : ""}${e.aviso ? `<small class="dc-aviso">${esc(e.aviso)}</small>` : ""}</div></div>`;
      else html = `<div class="dc-linea"><span class="dc-ico"></span><div><b class="dc-falta">Sin cargar</b></div></div>`;
      box.innerHTML = html;
      const btn = $("datBtn-" + id);
      if (btn) {
        btn.textContent = e.ok ? "Cambiar archivo" : "Elegir " + BOTON[id];
        btn.classList.toggle("primary", !e.ok);
        btn.classList.toggle("small", e.ok);
      }
    });
    if ($("datMsg-srv")) {
      const p = E.srv.progreso;
      const m = msg.srv || (p && !E.srv.ocupado && /^(Error|No se pudo)/.test(p) ? p : "");
      $("datMsg-srv").textContent = m;
      $("datMsg-srv").classList.toggle("error", /^(Error|No se pudo)/.test(m));
    }
    if ($("datMsg-pc")) {
      $("datMsg-pc").textContent = msg.pc;
      $("datMsg-pc").classList.toggle("error", /^(Error|No se pudo)/.test(msg.pc));
    }
    renderResumen(E);
    teclado();
    const rev = $("datosRevisionResumen");
    if (rev) rev.textContent = E.instructivo.ok ? `${E.instructivo.resumen} · qué leyó T-minus del instructivo y sus validaciones` : "Aparece al cargar el plan de envasado";
    const det = $("datosRevision");
    if (det) {
      det.hidden = !E.instructivo.ok;
      // Si la revisión del instructivo encontró problemas, se abre sola.
      const malas = document.querySelectorAll("#volumenPanel .vol-check-ico.bad").length;
      if (rev && malas) rev.textContent = `⚠ ${malas} validación(es) con problemas · revise antes de usar la programación`;
      if (malas && !det.dataset.abiertoSolo) {
        det.open = true;
        det.dataset.abiertoSolo = "1";
      }
    }
  }

  function renderResumen(E) {
    const cont = $("datosResumen");
    if (!cont) return;
    const lista = [E.instructivo, E.pp, E.srv, E.pc];
    const n = lista.filter((e) => e.ok).length;
    const origen = leerLS(LS_ORIGEN, null);
    const titulo = !E.instructivo.ok
      ? "Falta el plan de envasado"
      : n === 4
        ? "Los 4 archivos están cargados"
        : `${n} de 4 archivos cargados`;
    const sub = origen
      ? `Vienen del paquete «${esc(origen.archivo)}»${origen.semanas ? ` (${esc(origen.semanas)})` : ""}, creado el ${esc(fecha(origen.creado))}. Quedan guardados en este navegador.`
      : E.instructivo.ok
        ? "Quedan guardados en este navegador: al volver a abrir T-minus aparecen solos."
        : "Cargue los archivos en las tarjetas de abajo, o el paquete de la semana si se lo pasaron.";
    cont.innerHTML = `
      <div class="dr-estado ${E.instructivo.ok ? "ok" : ""}">
        <span class="dr-ico" aria-hidden="true">${E.instructivo.ok ? "✓" : "!"}</span>
        <div><b>${esc(titulo)}</b><small>${sub}</small></div>
      </div>
      <div class="dr-paquete">
        <div><b>Paquete de la semana</b><small>Para que otro computador vea lo mismo: descargue el paquete, déjelo en la carpeta del equipo en SharePoint o Teams y, en el otro computador, use «Cargar paquete». Contiene datos de la planta: compártalo solo dentro del equipo.</small></div>
        <div class="dr-acc">
          <button class="btn small" id="datPaqueteBajar" ${E.instructivo.ok ? "" : 'disabled title="Primero cargue el plan de envasado"'}>Descargar paquete</button>
          <label class="btn small" for="datPaqueteIn">Cargar paquete</label><input type="file" id="datPaqueteIn" accept=".json,.tminus" hidden />
        </div>
        ${msgPaquete ? `<div class="dc-msg ${/^(Error|No se pudo)/.test(msgPaquete) ? "error" : ""}" style="flex-basis:100%">${esc(msgPaquete)}</div>` : ""}
      </div>`;
    $("datPaqueteBajar").onclick = exportarPaquete;
    $("datPaqueteIn").onchange = (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) importarPaquete(f);
    };
  }

  /* ------------------------------------------------------------ carga desde las tarjetas */
  function conectarTarjeta(id, input, cargar) {
    const zona = $("datDrop-" + id);
    const inp = $(input);
    if (inp)
      inp.addEventListener("change", (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) cargar(f);
      });
    if (!zona) return;
    ["dragenter", "dragover"].forEach((t) => zona.addEventListener(t, (e) => (e.preventDefault(), zona.classList.add("drag"))));
    ["dragleave", "drop"].forEach((t) => zona.addEventListener(t, (e) => (e.preventDefault(), zona.classList.remove("drag"))));
    zona.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) cargar(f);
    });
  }
  conectarTarjeta("srv", "datFile-srv", (f) => {
    msg.srv = "";
    if (!window.SrvApp) return ((msg.srv = "Error: el módulo de servicios no cargó; recargue la página."), render());
    if (!/\.xls[xm]$/i.test(f.name)) return ((msg.srv = `Error: «${f.name}» no es un Excel (.xlsm o .xlsx). Aquí va «Indicadores servicios 2026».`), render());
    SrvApp.cargarExcel(f);
    render();
  });
  conectarTarjeta("pc", "datFile-pc", (f) => {
    msg.pc = "Leyendo " + f.name + "…";
    render();
    if (typeof pcCargarArchivo !== "function") return ((msg.pc = "Error: el módulo de cocinas no cargó; recargue la página."), render());
    pcCargarArchivo(f, (err) => {
      msg.pc = err ? "Error: " + err.message + " ¿Es el «Programa_Cocinas» de Elaboración?" : "";
      render();
    });
  });

  /* ------------------------------------------------------------ guardar y restaurar el instructivo */
  function instructivoCargado(buffer, nombre, opts) {
    opts = opts || {};
    if (opts.restaurado) {
      guardadoInstr = { estado: "ok" };
      render();
      return;
    }
    const cargado = new Date().toISOString();
    const M = meta();
    M.instructivo = { nombre, cargado };
    escribirLS(LS_META, M);
    // Un archivo nuevo deja de venir del paquete que se cargó antes.
    try {
      localStorage.removeItem(LS_ORIGEN);
    } catch (_) {}
    if (!window.TMAlmacen) {
      guardadoInstr = { estado: "error" };
      return render();
    }
    TMAlmacen.escribir(K_INSTR, { nombre, cargado, bytes: buffer.slice(0) })
      .then(() => {
        guardadoInstr = { estado: "ok", cargado };
        TMAlmacen.pedirPersistencia();
        render();
      })
      .catch((err) => {
        console.error(err);
        guardadoInstr = { estado: "error" };
        // El plan anterior ya no vale: que no vuelva al abrir la página.
        TMAlmacen.borrar(K_INSTR).catch(() => {});
        render();
      });
    render();
  }

  function restaurar() {
    if (!window.TMAlmacen) return render();
    TMAlmacen.leer(K_INSTR)
      .then((f) => {
        if (!f || !f.bytes || (typeof STATE !== "undefined" && STATE && STATE.parsed)) return;
        try {
          procesarInstructivo(f.bytes, f.nombre, { restaurado: true, cargado: f.cargado });
          const M = meta();
          if (!M.instructivo || M.instructivo.nombre !== f.nombre) {
            M.instructivo = { nombre: f.nombre, cargado: f.cargado };
            escribirLS(LS_META, M);
          }
        } catch (err) {
          console.error(err);
          const st = $("status");
          if (st) {
            st.classList.add("error");
            st.textContent = "No se pudo volver a leer el plan guardado (" + err.message + "). Cárguelo de nuevo.";
          }
        }
      })
      .catch((err) => console.error(err))
      .then(() => {
        render();
        const aviso = sessionStorage.getItem("tminus.paqueteCargado");
        if (aviso) {
          sessionStorage.removeItem("tminus.paqueteCargado");
          msgPaquete = aviso;
          render();
          if (window.FerIANav) FerIANav.go("view-datos");
        }
      });
  }

  /* ------------------------------------------------------------ paquete de la semana */
  function aBase64(buf) {
    const b = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deBase64(t) {
    const s = atob(t);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b.buffer;
  }
  function clavesQueViajan() {
    return VIAJAN.filter((k) => {
      try {
        return localStorage.getItem(k) != null;
      } catch (_) {
        return false;
      }
    });
  }
  function descargar(texto, nombre) {
    const url = URL.createObjectURL(new Blob([texto], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportarPaquete() {
    msgPaquete = "Armando el paquete…";
    render();
    const plan = typeof STATE !== "undefined" && STATE && STATE.parsed;
    const semanas = plan ? semanasDe(plan.weekLabel) : "";
    (window.TMAlmacen ? TMAlmacen.leer(K_INSTR) : Promise.resolve(null))
      .then((f) => {
        if (!f || !f.bytes) throw new Error("no hay un plan de envasado guardado en este navegador; cárguelo de nuevo en la tarjeta 1");
        const ls = {};
        clavesQueViajan().forEach((k) => (ls[k] = localStorage.getItem(k)));
        const paquete = {
          formato: FORMATO,
          creado: new Date().toISOString(),
          semanas,
          instructivo: { nombre: f.nombre, cargado: f.cargado, base64: aBase64(f.bytes) },
          ajustes: ls,
          servicios: window.SrvApp ? SrvApp.paquete() || null : null,
        };
        const hoy = new Date();
        const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
        const nombre = `T-minus paquete ${(semanas || "plan").replace(/[–\s]+/g, " ").trim()} ${dia}.json`.replace(/\s+/g, "_");
        const texto = JSON.stringify(paquete);
        descargar(texto, nombre);
        msgPaquete = `Paquete descargado: ${nombre} (${(texto.length / 1048576).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB)${paquete.servicios ? "" : " · sin modelos de servicios (no se ha cargado el Excel de indicadores)"}.`;
        render();
      })
      .catch((err) => {
        console.error(err);
        msgPaquete = "No se pudo armar el paquete: " + err.message + ".";
        render();
      });
  }
  function importarPaquete(file) {
    msgPaquete = "Leyendo " + file.name + "…";
    render();
    const rd = new FileReader();
    rd.onload = () => {
      let p;
      try {
        p = JSON.parse(rd.result);
      } catch (_) {
        msgPaquete = `Error: «${file.name}» no es un paquete de T-minus.`;
        return render();
      }
      if (!p || p.formato !== FORMATO || !p.instructivo || !p.instructivo.base64) {
        msgPaquete =
          p && p.formato === "prediccion-servicios/1"
            ? `Error: «${file.name}» es un paquete de modelos de servicios, no el paquete de la semana. Se carga en Consumos de servicios → Más → Cargar paquete.`
            : `Error: «${file.name}» no es un paquete de la semana de T-minus.`;
        return render();
      }
      const ok = window.confirm(
        `Cargar el paquete «${file.name}»${p.semanas ? ` (${p.semanas})` : ""}, creado el ${fecha(p.creado)}.\n\nReemplaza en este navegador el plan de envasado, el producto en proceso, el I0, el programa de cocinas real, los ajustes${p.servicios ? " y los modelos de servicios" : ""} por los del paquete. ¿Continuar?`,
      );
      if (!ok) {
        msgPaquete = "";
        return render();
      }
      Promise.resolve()
        .then(() => aplicarPaquete(p, file.name))
        .catch((err) => {
        console.error(err);
        msgPaquete = "No se pudo cargar el paquete: " + err.message;
        render();
      });
    };
    rd.onerror = () => {
      msgPaquete = "No se pudo leer el archivo.";
      render();
    };
    rd.readAsText(file);
  }
  // Se valida todo antes de tocar nada; si algo falla a mitad de camino se
  // devuelve este navegador a como estaba.
  function aplicarPaquete(p, archivo) {
    if (!window.TMAlmacen) throw new Error("este navegador no deja guardar datos (¿ventana de incógnito?)");
    if (!p.ajustes || typeof p.ajustes !== "object") throw new Error("el paquete no trae los ajustes del plan");
    let bytes;
    try {
      bytes = deBase64(p.instructivo.base64);
      parseWorkbook(XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: true }));
    } catch (err) {
      throw new Error("el plan de envasado del paquete no se puede leer (" + err.message + ")");
    }
    const conSrv = !!(p.servicios && window.SrvApp);
    const antes = {};
    VIAJAN.concat([LS_ORIGEN]).forEach((k) => (antes[k] = localStorage.getItem(k)));
    const devolverLS = () =>
      Object.keys(antes).forEach((k) => {
        try {
          if (antes[k] == null) localStorage.removeItem(k);
          else localStorage.setItem(k, antes[k]);
        } catch (_) {}
      });
    return Promise.all([TMAlmacen.leer(K_INSTR), conSrv ? TMAlmacen.leer(SrvApp.claveAlmacen) : null]).then(([instrAntes, srvAntes]) => {
      const devolverIDB = () =>
        Promise.all([
          instrAntes ? TMAlmacen.escribir(K_INSTR, instrAntes) : TMAlmacen.borrar(K_INSTR),
          conSrv ? (srvAntes ? TMAlmacen.escribir(SrvApp.claveAlmacen, srvAntes) : TMAlmacen.borrar(SrvApp.claveAlmacen)) : null,
        ]).catch(() => {});
      // 1) Ajustes (localStorage): cualquier error de espacio deshace todo.
      try {
        VIAJAN.forEach((k) => localStorage.removeItem(k));
        Object.keys(p.ajustes).forEach((k) => {
          if (VIAJAN.includes(k) && typeof p.ajustes[k] === "string") localStorage.setItem(k, p.ajustes[k]);
        });
        localStorage.setItem(LS_ORIGEN, JSON.stringify({ archivo, creado: p.creado, semanas: p.semanas || "", cargado: new Date().toISOString() }));
      } catch (err) {
        devolverLS();
        throw new Error("no cupo en el almacenamiento de este navegador; no se cambió nada");
      }
      // 2) Modelos de servicios y plan de envasado (IndexedDB).
      const B = conSrv ? Object.assign({}, p.servicios, { guardado_en: new Date().toISOString() }) : null;
      return (conSrv ? TMAlmacen.escribir(SrvApp.claveAlmacen, B) : Promise.resolve())
        .then(() => TMAlmacen.escribir(K_INSTR, { nombre: p.instructivo.nombre, cargado: p.instructivo.cargado, bytes }))
        .then(
          () => {
            if (conSrv)
              try {
                localStorage.removeItem(SrvApp.claveLocal);
              } catch (_) {}
            sessionStorage.setItem("tminus.paqueteCargado", `Paquete cargado: ${archivo}. Todo queda guardado en este navegador.`);
            location.reload();
          },
          (err) => {
            devolverLS();
            return devolverIDB().then(() => {
              throw new Error("no se pudo guardar en este navegador (" + err.message + "); no se cambió nada");
            });
          },
        );
    });
  }

  // Los botones de elegir archivo son <label>: con teclado se abren con Enter o espacio.
  function teclado(raiz) {
    (raiz || document).querySelectorAll("#view-datos label.btn[for]").forEach((l) => {
      if (l.dataset.teclado) return;
      l.dataset.teclado = "1";
      l.tabIndex = 0;
      l.setAttribute("role", "button");
      l.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const inp = document.getElementById(l.htmlFor);
          if (inp) inp.click();
        }
      });
    });
  }
  document.addEventListener("tminus:datos", render);
  window.DatosEntrada = { render, registrar, instructivoCargado, nombre: (id) => (meta()[id] || {}).nombre || "" };
  restaurar();
})();
