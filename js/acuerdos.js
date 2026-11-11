/* =========================================================================
   ACUERDOS DE SERVICIO — calificación semanal

   Cada acuerdo se mide contra el plan de la SEMANA evaluada y da un
   cumplimiento de 0 a 100 %. El puntaje es ponderación × cumplimiento, y el
   score total es la suma de los puntajes sobre la ponderación de los acuerdos
   que SÍ se pudieron medir: los que dependen de datos que no vienen en los
   archivos cargados se listan aparte y no arrastran el score hacia abajo.

   Las ponderaciones son un criterio de negocio, no un dato del archivo: se
   editan desde la propia página y quedan guardadas.
   ========================================================================= */
const ACUERDOS_LS_KEY = "planAcuerdosPonderacion";

// Ponderación por defecto de los acuerdos medibles (suman 100).
const ACUERDOS_PONDERACION_DEFECTO = {
  1: 20, // tope de volumen semanal y frecuencia de aseos
  3: 10, // no terminar con Pony
  4: 15, // bloques de Pony de mínimo 2 cocimientos
  5: 10, // sin paradas de línea de más de 2 días
  6: 20, // tope de Pony semanal
  7: 15, // maduración máxima de 4 días
  12: 10, // un único bloque semanal de filtración de Light
};

function ponderacionAcuerdos() {
  let guardadas = null;
  try {
    guardadas = JSON.parse(localStorage.getItem(ACUERDOS_LS_KEY) || "null");
  } catch (_) {}
  const out = { ...ACUERDOS_PONDERACION_DEFECTO };
  if (guardadas && typeof guardadas === "object")
    Object.keys(out).forEach((k) => {
      const v = Number(guardadas[k]);
      if (isFinite(v) && v >= 0) out[k] = v;
    });
  return out;
}

function guardarPonderacionAcuerdos(p) {
  try {
    localStorage.setItem(ACUERDOS_LS_KEY, JSON.stringify(p));
  } catch (_) {}
}

// Cumplimiento lineal: 100 % hasta el tope, y de ahí bajando hasta 0 % cuando
// se dobla. Así pasarse un poco no cuesta lo mismo que pasarse el doble.
function cumplimientoPorTope(valor, tope) {
  if (!(tope > 0)) return 100;
  if (valor <= tope) return 100;
  return Math.max(0, Math.round((1 - (valor - tope) / tope) * 100));
}

// Sin semana (w sin pasar) se califica cada semana del plan y se promedia: los
// topes de estos acuerdos son semanales. Con w = una semana de
// semanasAcuerdos(), solo cuenta lo que empieza en esa semana.
function evaluarAcuerdos(plan, seq, w) {
  if (w === undefined) {
    const sem = typeof semanasAcuerdos === "function" ? semanasAcuerdos() : [];
    if (sem.length) return resumirAcuerdosSemanal(plan, seq, sem);
    w = null;
  }
  const en = (d) => !w || enSemana(d, w);
  const DIA = 24 * 3600000;
  const pond = ponderacionAcuerdos();
  const filasSeq = ((seq && seq.rows) || []).slice().sort((a, b) => a.start - b.start);
  const todosCoc = filasSeq.filter((r) => r.tipo === "cocimiento");
  const cocimientos = todosCoc.filter((r) => en(r.start));
  const aseos = filasSeq.filter((r) => r.tipo === "aseo");
  let hlTotal;
  let hlPony;
  if (w) {
    // hL de mosto de los cocimientos que arrancan en la semana.
    hlTotal = cocimientos.reduce((a, r) => a + (Number(r.cocVolumenHL) || 0), 0);
    hlPony = cocimientos.filter((r) => esMostoPony(r.mostoId)).reduce((a, r) => a + (Number(r.cocVolumenHL) || 0), 0);
  } else {
    const results = (plan && plan.results) || [];
    const hlDe = (pred) =>
      results
        .filter(pred)
        .reduce((a, r) => a + (Number(r.volumenCocinar) || 0), 0);
    hlTotal = hlDe(() => true);
    hlPony = hlDe((r) => esMostoPony(r.mostoId));
  }
  const hlCerveza = hlTotal - hlPony;

  const medido = {};
  const add = (id, cumplimiento, medida, detalle) =>
    (medido[id] = { cumplimiento, medida, detalle });

  /* --- R1: tope de volumen semanal + aseos con 14 días de separación máxima.
     El tope depende de a qué se priorice —81.000 hL en total, repartidos en
     66.000 cerveza + 15.000 Pony si manda la cerveza, o 57.400 + 23.600 si
     manda la Pony— así que se toma el reparto que mejor le quede al plan. */
  {
    const escenarios = [
      { nombre: "cerveza", cerveza: 66000, pony: 15000 },
      { nombre: "Pony", cerveza: 57400, pony: 23600 },
    ];
    const mejor = escenarios
      .map((e) => ({
        e,
        c: Math.min(
          cumplimientoPorTope(hlTotal, 81000),
          cumplimientoPorTope(hlCerveza, e.cerveza),
          cumplimientoPorTope(hlPony, e.pony),
        ),
      }))
      .sort((a, b) => b.c - a.c)[0];
    // Separación entre aseos: en una semana cuentan los intervalos entre dos
    // aseos seguidos que se cruzan con ella.
    let huecoMax = 0;
    let nHuecos = 0;
    const t = aseos.map((a) => a.start.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < t.length; i++) {
      if (w && !(t[i] + 2 * 3600000 > w.start && t[i - 1] + 2 * 3600000 < w.end)) continue;
      nHuecos++;
      huecoMax = Math.max(huecoMax, (t[i] - t[i - 1]) / DIA);
    }
    const cAseo = nHuecos ? cumplimientoPorTope(huecoMax, 14) : 100;
    const hayAlgo = !w || cocimientos.length || nHuecos;
    add(
      1,
      hayAlgo ? Math.min(mejor.c, cAseo) : null,
      `${Math.round(hlTotal).toLocaleString("es-CO")} hL`,
      `${Math.round(hlTotal).toLocaleString("es-CO")} hL ${w ? "de mosto en la semana" : "en total"} ` +
        `(${Math.round(hlCerveza).toLocaleString("es-CO")} de cerveza y ${Math.round(hlPony).toLocaleString("es-CO")} de Pony) ` +
        `contra el tope de 81.000 hL priorizando ${mejor.e.nombre}. ` +
        (nHuecos
          ? `La mayor separación entre aseos es de ${huecoMax.toFixed(1)} días (máximo 14).`
          : w
            ? "No hay dos aseos seguidos que se crucen con la semana."
            : "No hay dos aseos que comparar en el horizonte cargado."),
    );
  }

  /* --- R3: no terminar la producción con Pony. */
  {
    const ultimo = cocimientos[cocimientos.length - 1];
    const enPony = !!ultimo && esMostoPony(ultimo.mostoId);
    add(
      3,
      cocimientos.length ? (enPony ? 0 : 100) : null,
      ultimo ? ultimo.nombre : "—",
      ultimo
        ? enPony
          ? `El último cocimiento de la semana es Pony y termina el ${fmtDateTime(ultimo.end)}.`
          : `La semana cierra con ${ultimo.nombre}, no con Pony.`
        : "Sin cocimientos programados esta semana.",
    );
  }

  /* --- R4: cada bloque de Pony con mínimo dos cocimientos seguidos. */
  {
    // Los bloques se arman con toda la programación (un bloque que cruza el
    // domingo no se parte) y cuentan en la semana de su primer cocimiento.
    const corridas = [];
    let n = 0;
    let ini = null;
    todosCoc.forEach((r) => {
      if (esMostoPony(r.mostoId)) {
        if (!n) ini = r.start;
        n++;
      } else if (n) {
        if (en(ini)) corridas.push(n);
        n = 0;
      }
    });
    if (n && en(ini)) corridas.push(n);
    const cortas = corridas.filter((x) => x < 2).length;
    add(
      4,
      corridas.length
        ? Math.round(((corridas.length - cortas) / corridas.length) * 100)
        : null,
      corridas.length ? `${corridas.length} bloque(s)` : "—",
      corridas.length
        ? `${corridas.length} bloque(s) de Pony, de ${corridas.join(", ")} cocimiento(s). ` +
            (cortas
              ? `${cortas} queda(n) por debajo del mínimo de 2.`
              : "Todos cumplen el mínimo de 2.")
        : "No hay bloques de Pony esta semana.",
    );
  }

  /* --- R5: ninguna línea parada más de dos días.
     Se miran los tramos que el propio instructivo marca como no-producción
     (NST / sin programación) en cada tren. */
  {
    let paradas = 0;
    let total = 0;
    let mayor = 0;
    const porTren =
      (typeof STATE !== "undefined" && STATE && STATE.mergedByTrain) || {};
    (typeof TRAINS !== "undefined" ? TRAINS : []).forEach((tr) => {
      (porTren[tr] || []).forEach((b) => {
        if (!/nst|sin programaci/.test(normalizeText(b.name || ""))) return;
        if (!en(b.start)) return;
        total++;
        const dias = (b.end.getTime() - b.start.getTime()) / DIA;
        mayor = Math.max(mayor, dias);
        if (dias > 2) paradas++;
      });
    });
    add(
      5,
      total
        ? Math.round(((total - paradas) / total) * 100)
        : !w || (typeof bloquesProduccion === "function" && bloquesProduccion().some((b) => en(b.start)))
          ? 100
          : null,
      total ? `${paradas} de ${total}` : "sin paradas",
      total
        ? `${total} tramo(s) sin programación; ${paradas} pasa(n) de dos días. La más larga dura ${mayor.toFixed(1)} días.`
        : "Ninguna línea queda sin programación esta semana.",
    );
  }

  /* --- R6: el volumen de Pony no pasa de 23.600 hL por semana. */
  add(
    6,
    w && !cocimientos.length ? null : cumplimientoPorTope(hlPony, 23600),
    `${Math.round(hlPony).toLocaleString("es-CO")} hL`,
    `${Math.round(hlPony).toLocaleString("es-CO")} hL de Pony ${w ? "(mosto) en la semana " : ""}contra el tope semanal de 23.600 hL.`,
  );

  /* --- R7: la maduración no pasa de cuatro días. */
  {
    const bandas = (
      (seq && seq.tankAssignment && seq.tankAssignment.rows) ||
      []
    ).filter((r) => /madur/i.test(r.etapa || "") && en(r.start));
    let excedidas = 0;
    let mayor = 0;
    bandas.forEach((r) => {
      const dias = (r.end.getTime() - r.start.getTime()) / DIA;
      mayor = Math.max(mayor, dias);
      if (dias > 4.01) excedidas++;
    });
    add(
      7,
      bandas.length
        ? Math.round(((bandas.length - excedidas) / bandas.length) * 100)
        : null,
      bandas.length ? `máx. ${mayor.toFixed(1)} d` : "—",
      bandas.length
        ? `${bandas.length} maduración(es); ${excedidas} pasa(n) de 4 días. La más larga dura ${mayor.toFixed(1)} días.`
        : "No hay maduraciones asignadas para medir.",
    );
  }

  /* --- R12: un único bloque semanal de filtración de Águila Light. */
  {
    let bloques = 0;
    if (w) {
      // Por semana hace falta saber cuándo se filtra: se toman los tramos de
      // filtración del Gantt, en orden de tiempo, y cada bloque de Light cuenta
      // en la semana en que arranca.
      const tramos = typeof tramosFiltracion === "function" ? tramosFiltracion() : [];
      // Cada filtro por separado: dos filtros en paralelo no parten un bloque.
      const prev = {};
      tramos.forEach((s) => {
        const esLight = /light/.test(normalizeText(s.marca || ""));
        if (esLight && !prev[s.filtro] && en(s.start)) bloques++;
        prev[s.filtro] = esLight;
      });
    } else {
      const filas =
        (typeof FILTRACION_STATE !== "undefined" &&
          FILTRACION_STATE &&
          FILTRACION_STATE.filas) ||
        [];
      let prev = false;
      filas.forEach((f) => {
        const esLight = /light/.test(normalizeText(f.marca || ""));
        if (esLight && !prev) bloques++;
        prev = esLight;
      });
    }
    add(
      12,
      bloques === 0
        ? null
        : bloques === 1
          ? 100
          : Math.max(0, 100 - (bloques - 1) * 50),
      bloques ? `${bloques} bloque(s)` : "—",
      bloques === 0
        ? w
          ? "No arranca ningún bloque de Águila Light en la semana."
          : "No hay filtración de Águila Light en el Gantt de filtración."
        : bloques === 1
          ? "Un solo bloque de Águila Light, como pide el acuerdo."
          : `${bloques} bloques separados de Águila Light: deberían ir en uno solo.`,
    );
  }

  const filas = (typeof REGLAS_OPERATIVAS !== "undefined"
    ? REGLAS_OPERATIVAS
    : []
  ).map((r) => {
    const e = medido[r.id];
    const medible = !!e && e.cumplimiento != null;
    const ponderacion = medible ? Number(pond[r.id]) || 0 : 0;
    const cumplimiento = medible ? e.cumplimiento : null;
    return {
      id: r.id,
      texto: r.texto,
      impacto: r.impacto,
      medible,
      ponderacion,
      cumplimiento,
      puntaje: medible ? (ponderacion * cumplimiento) / 100 : 0,
      estado: !medible
        ? "sin-datos"
        : cumplimiento >= 90
          ? "cumple"
          : cumplimiento >= 60
            ? "parcial"
            : "critico",
      medida: e ? e.medida : "—",
      detalle: e
        ? e.detalle
        : "Depende de datos de líneas, mantenimiento o SUITE360 que no vienen en los archivos cargados.",
    };
  });

  const medibles = filas.filter((f) => f.medible);
  const pondTotal = medibles.reduce((a, f) => a + f.ponderacion, 0);
  const puntajeTotal = medibles.reduce((a, f) => a + f.puntaje, 0);
  return {
    filas,
    medibles,
    sinDatos: filas.filter((f) => !f.medible),
    pondTotal,
    puntajeTotal,
    // El score se normaliza sobre la ponderación realmente medida, para que un
    // acuerdo sin datos no cuente como incumplido.
    score: pondTotal > 0 ? (puntajeTotal / pondTotal) * 100 : null,
    cumplidos: medibles.filter((f) => f.estado === "cumple").length,
    parciales: medibles.filter((f) => f.estado === "parcial").length,
    criticos: medibles.filter((f) => f.estado === "critico").length,
    semana: w
      ? w.label
      : (typeof STATE !== "undefined" && STATE && STATE.parsed
          ? STATE.parsed.weekLabel
          : "") || "",
  };
}

// Promedio de las semanas: cada acuerdo con el promedio de las semanas en que
// se pudo medir, y el score como promedio de los scores semanales.
function resumirAcuerdosSemanal(plan, seq, semanas) {
  const pond = ponderacionAcuerdos();
  const porSemana = semanas.map((s) => ({ semana: s, ev: evaluarAcuerdos(plan, seq, s) }));
  const filas = porSemana[0].ev.filas.map((f0) => {
    const r = resumirFilaSemanal(f0.id, porSemana, "Depende de datos de líneas, mantenimiento o SUITE360 que no vienen en los archivos cargados.");
    const ponderacion = r.medible ? Number(pond[f0.id]) || 0 : 0;
    return {
      id: f0.id,
      texto: f0.texto,
      impacto: f0.impacto,
      medible: r.medible,
      ponderacion,
      cumplimiento: r.cumplimiento,
      puntaje: r.medible ? (ponderacion * r.cumplimiento) / 100 : 0,
      estado: r.estado,
      medida: r.medida,
      detalle: r.detalle,
      semanas: r.semanas,
    };
  });
  const medibles = filas.filter((f) => f.medible);
  return {
    filas,
    medibles,
    sinDatos: filas.filter((f) => !f.medible),
    pondTotal: medibles.reduce((a, f) => a + f.ponderacion, 0),
    puntajeTotal: medibles.reduce((a, f) => a + f.puntaje, 0),
    score: scorePromedioSemanas(porSemana),
    cumplidos: medibles.filter((f) => f.estado === "cumple").length,
    parciales: medibles.filter((f) => f.estado === "parcial").length,
    criticos: medibles.filter((f) => f.estado === "critico").length,
    semana: `${semanas[0].corto} a ${semanas[semanas.length - 1].corto} (promedio semanal)`,
    porSemana,
  };
}
