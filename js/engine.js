/* =========================================================================
   MOTOR — datos por marca, homologacion, plan de cocinas, reglas, asignacion de tanques y secuenciacion semanal
   ========================================================================= */
/* =========================================================================
   4) DATOS POR MARCA (volumen a envasar + fecha/hora "lista desde")
   ========================================================================= */
function buildBrandList(parsed, mergedByTrain) {
  // El plan de envasado define BLOQUES físicos. Filas consecutivas del mismo
  // mosto/marca pertenecen al mismo bloque de cocina y se deben programar
  // juntas. Si la misma marca reaparece después de otra marca, se crea un
  // bloque nuevo y puede ejecutarse más tarde.
  const events = [];
  let order = 0;
  TRAINS.forEach((t) => {
    (mergedByTrain[t] || [])
      .filter((b) => b.type === "production" && b.codigo)
      .forEach((b) => {
        events.push({
          codigo: b.codigo,
          name: b.name || b.codigo,
          earliest: new Date(b.start.getTime()),
          end: b.end ? new Date(b.end.getTime()) : null,
          volumen: Number(b.hectolitros) || 0,
          train: t,
          sequenceOrder: order++,
        });
      });
  });

  // Orden del plan de envasado. No usamos aquí las fechas de cocina calculadas.
  // La primera fecha/hora de envasado determina el orden temporal de los bloques.
  // Una vez ordenados los eventos, renumeramos la posición para que el bloque conserve
  // exactamente este orden al pasar a Programación de cocinas y Secuencia semanal.
  events.sort(
    (a, b) => a.earliest - b.earliest || a.sequenceOrder - b.sequenceOrder,
  );
  events.forEach((e, i) => {
    e.sequenceOrder = i;
  });

  const summaryMap = {};
  (parsed.summary || []).forEach((s) => (summaryMap[s.codigo] = s));

  const brands = [];
  let current = null;
  let blockIndex = 0;

  function flush() {
    if (!current || !(current.volumen > 0)) return;
    brands.push({
      codigo: current.codigo,
      name: current.name,
      earliest: current.earliest,
      end: current.end,
      volumen: current.volumen,
      train: current.train,
      sequenceOrder: current.sequenceOrder,
      blockLabel: `${current.name} · bloque ${blockIndex + 1}`,
      marcas: current.marcas,
    });
    blockIndex++;
    current = null;
  }

  events.forEach((e) => {
    let volumen = e.volumen;
    if (!(volumen > 0)) {
      const summary = summaryMap[e.codigo];
      volumen =
        summary && summary.total && Number(summary.total.hlBBTs) > 0
          ? Number(summary.total.hlBBTs)
          : 0;
    }
    if (!(volumen > 0)) return;

    const mostoId = matchMosto(e.name, MOSTO_CATALOG);
    const currentMostoId = current
      ? matchMosto(current.name, MOSTO_CATALOG)
      : null;

    // Agrupar SOLO filas consecutivas del mismo mosto. Nunca juntar dos
    // apariciones separadas de la misma marca.
    if (!current || mostoId !== currentMostoId) {
      flush();
      current = {
        codigo: e.codigo,
        name: e.name,
        earliest: new Date(e.earliest.getTime()),
        end: e.end ? new Date(e.end.getTime()) : null,
        volumen,
        train: e.train,
        sequenceOrder: e.sequenceOrder,
        marcas: [e],
      };
    } else {
      current.volumen += volumen;
      if (e.earliest && e.earliest < current.earliest)
        current.earliest = new Date(e.earliest.getTime());
      if (e.end && (!current.end || e.end > current.end))
        current.end = new Date(e.end.getTime());
      current.marcas.push(e);
    }
  });
  flush();

  if (!brands.length) {
    (parsed.summary || []).forEach((s, idx) => {
      const volumen = Number(s.total && s.total.hlBBTs) || 0;
      if (!(volumen > 0)) return;
      brands.push({
        codigo: s.codigo,
        name: s.marca || s.codigo,
        earliest: null,
        end: null,
        volumen,
        train: null,
        sequenceOrder: idx,
        blockLabel: `${s.marca || s.codigo} · bloque ${idx + 1}`,
        marcas: [s],
      });
    });
  }
  return brands;
}

/* =========================================================================
   5) HOMOLOGACIÓN + CÁLCULO DE PROGRAMACIÓN DE COCINAS
   ========================================================================= */
function matchMosto(brandName, catalog) {
  const n = normalizeText(brandName);
  for (const m of catalog) {
    // El nombre propio del mosto (p.ej. "Estandar") también debe reconocerse, además de sus
    // palabras clave de homologación (p.ej. "costeñita, aguila, poker") — si no, un aseo definido
    // como "Estandar → Light" no encuentra el mosto "Estandar" porque su nombre no está entre sus
    // propias palabras clave (esas son solo las marcas que homologan a él, no su nombre).
    const keys = [
      normalizeText(m.nombre),
      ...(m.palabras || "").split(",").map((k) => normalizeText(k)),
    ].filter(Boolean);
    if (keys.some((k) => n.includes(k))) return m.id;
  }
  return null;
}

function computeCocimientoStarts(fechaEnvasadoMinima, numCocimientos, m) {
  if (!fechaEnvasadoMinima || numCocimientos <= 0) return [];
  // La fecha de envasado, menos maduración y fermentación, marca el instante en que el
  // ÚLTIMO cocimiento debe estar listo (fin de cocina = inicio de fermentación).
  const deadline = new Date(
    fechaEnvasadoMinima.getTime() -
      (Number(m.tiempoFermentacionHoras) || 0) * 3600 * 1000 -
      (Number(m.tiempoMaduracionHoras) || 0) * 3600 * 1000,
  );
  const cocinaMs = (Number(m.tiempoCocinaHoras) || 0) * 3600 * 1000;
  const gapMs = (Number(m.tiempoEntreCarguesHoras) || 0) * 3600 * 1000;

  // La diferencia entre INICIOS de cocimientos es siempre el tiempo entre cargues.
  // La duración de cocina solo determina cuánto antes del fin de fermentación debe
  // comenzar el último cocimiento.
  // El ÚLTIMO inicio se obtiene restando SOLO el tiempo de cocina al fin de cocina requerido.
  // A partir de ahí, cada inicio anterior se separa exactamente por el tiempo ENTRE CARGUES.
  // En el catálogo operativo ese valor es 2:50 h, salvo que el usuario lo cambie manualmente.
  const lastStartMs = deadline.getTime() - cocinaMs;
  const firstStartMs = lastStartMs - Math.max(0, numCocimientos - 1) * gapMs;
  const starts = Array.from(
    { length: numCocimientos },
    (_, i) => new Date(firstStartMs + i * gapMs),
  );

  // Validación estructural: la separación entre inicios debe ser exactamente
  // el tiempo entre cargues; la duración de cocina NO interviene entre inicios.
  for (let i = 1; i < starts.length; i++) {
    const delta = starts[i].getTime() - starts[i - 1].getTime();
    if (Math.abs(delta - gapMs) > 1) {
      throw new Error(
        `Error de programación: la separación entre cocimientos de ${m.nombre} no coincide con el tiempo entre cargues.`,
      );
    }
  }
  return starts;
}

// Cuántos cargues de Pony (600 hL sin normalizar c/u) caben cociendo de
// corrido antes de necesitar un cambio real de marca: los limitan los SV Pony
// físicos del catálogo de tanques (maduración exclusiva de Pony). Con 0 o sin
// tanques definidos se usa PONY_MIN_COCIMIENTOS como piso de seguridad.
// PONY_MIN_COCIMIENTOS es el mínimo por tramo del acuerdo de servicio (Regla 4):
// un cocimiento suelto nunca queda solo.
const PONY_MIN_COCIMIENTOS = 2;

function ponyMaxCocimientosSeguidos(tankCatalog, volumenPorCocimiento) {
  const capHL = (tankCatalog || [])
    .filter((t) => t.tipo === "SV Pony" && t.disponible !== false)
    .reduce((s, t) => s + (Number(t.capacidadHL) || 0), 0);
  const vol = Number(volumenPorCocimiento) || 0;
  if (capHL <= 0 || vol <= 0) return PONY_MIN_COCIMIENTOS;
  return Math.max(PONY_MIN_COCIMIENTOS, Math.floor(capHL / vol));
}

// Reparte n cocimientos en tramos de máximo "max" y mínimo "min" cada uno
// (el último tramo nunca queda por debajo del mínimo: se le resta al
// penúltimo lo que haga falta en vez de dejar un tramo suelto).
function splitEnTramos(n, max, min) {
  const out = [];
  let remaining = n;
  while (remaining > max) {
    let take = max;
    if (remaining - take < min) take = remaining - min;
    out.push(take);
    remaining -= take;
  }
  out.push(remaining);
  return out;
}

function computeCocinaPlan(brands, catalog, inventoryBalance) {
  const sinHomologar = [];
  const results = [];

  // Balance Semanal: copia consumible del inventario disponible por mosto. Se va
  // descontando en el orden en que aparecen los bloques del plan de envasado, así
  // que el inventario cubre primero el bloque más próximo de esa marca.
  const remainingInv = {};
  (catalog || []).forEach((m) => {
    remainingInv[m.id] = Math.max(
      0,
      Number((inventoryBalance || {})[m.id]) || 0,
    );
  });

  // IMPORTANTE: no se agrupan todos los registros de una misma marca/mosto.
  // Cada bloque de envasado conserva su propia fecha de necesidad y volumen,
  // de modo que una misma marca puede volver a aparecer más tarde como otro
  // bloque, siempre completo y sin intercalar cocimientos de otras marcas.
  (brands || []).forEach((b, blockIndex) => {
    const mostoId = matchMosto(b.name, catalog);
    if (!mostoId) {
      if (b.volumen > 0) sinHomologar.push(b);
      return;
    }
    const m = catalog.find((x) => x.id === mostoId) || {};
    const volumenEnvasar = Number(b.volumen) || 0;
    if (!(volumenEnvasar > 0)) return;
    const factor = Number(m.factorDilucion) || 1;

    // El inventario disponible se descuenta del volumen que hay que COCINAR, no del
    // volumen a envasar: el compromiso de envasado no cambia, solo cuánto de eso sale
    // de un cocimiento nuevo vs. de cerveza que ya está lista en inventario.
    const invDisponible = remainingInv[mostoId] || 0;
    const cubiertoPorInventario = Math.min(invDisponible, volumenEnvasar);
    remainingInv[mostoId] = invDisponible - cubiertoPorInventario;
    const volumenEnvasarPendiente = volumenEnvasar - cubiertoPorInventario;

    const volumenCocinar = volumenEnvasarPendiente / factor;
    const volXCoc = Number(m.volumenPorCocimiento) || 1;
    let numCocimientos =
      volumenCocinar > 1e-9
        ? Math.max(1, Math.ceil(volumenCocinar / volXCoc))
        : 0;

    // Regla 4 (acuerdo de servicio): los bloques de producción de Pony Malta deben
    // contemplar como mínimo DOS cocimientos consecutivos, pero SIN dividir el
    // volumen de cada cocimiento. El tamaño de cada cocimiento sigue siendo el que
    // define el catálogo (volumen fijo por cocimiento), y solo se aumenta la cantidad
    // de cocimientos para respetar la regla de mínimo.
    if (mostoId === "pony" && numCocimientos > 0 && numCocimientos < 2) {
      numCocimientos = 2;
    }

    let starts = [];
    if (b.earliest && numCocimientos > 0) {
      starts = computeCocimientoStarts(b.earliest, numCocimientos, m);
    }

    results.push({
      mostoId,
      nombre: m.nombre,
      volumenEnvasar,
      volumenCocinar,
      numCocimientos,
      volumenPorCocimientoOverride: null,
      starts,
      fechaEnvasadoMinima: b.earliest,
      fechaEnvasadoFin: b.end || null,
      codigo: b.codigo,
      tren: b.train,
      sequenceOrder: Number.isFinite(b.sequenceOrder)
        ? b.sequenceOrder
        : blockIndex,
      blockLabel: b.blockLabel || `${m.nombre} · bloque ${blockIndex + 1}`,
      marcas: [b],
      inventarioUsadoHL: cubiertoPorInventario,
      cubiertoTotalPorInventario:
        numCocimientos === 0 && cubiertoPorInventario > 0,
    });
  });

  // Mantener el orden de bloques del plan de envasado. NO ordenar por start de cocina.
  results.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  return { results, sinHomologar };
}

/* =========================================================================
   5.5) REGLAS OPERATIVAS DE PROGRAMACIÓN + RECOMENDACIONES + SECUENCIACIÓN
   ========================================================================= */
const REGLAS_OPERATIVAS = [
  {
    id: 1,
    texto:
      "Garantizar la ejecución de aseos con una frecuencia máxima de 14 días. Programar máximo 81.000 hL; si se prioriza cerveza, máximo 66.000 hL de cerveza y 15.000 hL de Pony; si se prioriza Pony, máximo 23.600 hL de Pony y 57.400 hL de cerveza.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 2,
    texto:
      "Los cambios de marca deben programarse previamente y mantenerse conforme al plan congelado de 1 semana, definido en la reunión W+1.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 3,
    texto: "Evitar finalizar la producción con la marca Pony.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 4,
    texto:
      "Los bloques de producción de Pony Malta deberán contemplar como mínimo dos cocimientos consecutivos (4.100 hL mínimo).",
    impacto: "HEAT/AGUA",
  },
  {
    id: 5,
    texto:
      "No desprogramar las líneas de tal manera que las paradas sean superiores a dos días, con el fin de evitar consumos de CO₂ sin producción.",
    impacto: "CO2",
  },
  {
    id: 6,
    texto:
      "El volumen programado de Pony Malta no deberá superar los 23.600 hL por semana.",
    impacto: "CO2",
  },
  {
    id: 7,
    texto:
      "El tiempo de maduración no deberá exceder los 4 días. Garantizar que se filtre un bloque completo de cada marca.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 8,
    texto:
      "Cumplir estrictamente las ventanas de mantenimiento establecidas. Seguir la fecha fija asignada y solo cambiar con aviso mínimo de tres turnos laborales (24 horas) para programación.",
    impacto: "EE/HEAT/AGUA",
  },
  {
    id: 9,
    texto:
      "Ejecutar la filtración en bloques completos por marca, finalizando la totalidad del volumen programado de Estándar, Pilsen y Águila Light antes de iniciar la filtración de una marca diferente. No se permiten filtraciones intermedias de otras marcas dentro de un mismo bloque.",
    impacto: "EE/HEAT/AGUA",
  },
  {
    id: 10,
    texto:
      "No mezclar formatos grandes de Pony Malta con filtración de Águila Light.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 11,
    texto:
      "Mantener actualizada la programación en SUITE360, informando cambios y secuencias a las áreas implicadas (Elaboración y Envase), para garantizar tiempos de proceso y secuencias de arranque.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 12,
    texto: "Realizar un único bloque semanal de filtración de Águila Light.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 13,
    texto:
      "Contar con un inventario máximo en BBT de 5.000 hL de una marca diferente antes de iniciar la filtración de otro SKU.",
    impacto: "HEAT/AGUA",
  },
  {
    id: 14,
    texto:
      "Actualizar las eficiencias de las líneas de envasado según su variación real en el salón de embotellado.",
    impacto: "CO2",
  },
];
// Reglas que SÍ se pueden validar con los datos de este archivo (volúmenes y horarios de cocinas + aseos CIP).
// El resto depende de datos de líneas de envasado, filtración, mantenimiento o SUITE360 que no están aquí.
const REGLAS_VERIFICABLES = new Set([1, 3, 4, 5, 6, 7, 12]);

const RECOMENDACIONES = [
  {
    id: "r1",
    texto:
      "Iniciar la producción semanal con Pony para aprovechar los aseos semanales y optimizar los consumos asociados a arranques y cambios de proceso.",
    impacto: "EE/HEAT/AGUA",
  },
  {
    id: "r2",
    texto:
      "Planificar la producción de forma que los bloques de Pony queden cercanos a los aseos programados, reduciendo cambios operativos y consumos de recursos.",
    impacto: "EE/HEAT/AGUA",
  },
];

function computeDeadline(fechaEnvasadoMinima, m) {
  if (!fechaEnvasadoMinima) return null;
  return new Date(
    fechaEnvasadoMinima.getTime() -
      (Number(m.tiempoFermentacionHoras) || 0) * 3600 * 1000 -
      (Number(m.tiempoMaduracionHoras) || 0) * 3600 * 1000,
  );
}
function dateKey(d) {
  return d.getUTCFullYear() + "-" + d.getUTCMonth() + "-" + d.getUTCDate();
}

// Resuelve la duración de aseo (CIP) para una transición de mosto → mosto, usando ASEO_MATRIX
// homologada contra el catálogo de mostos (misma lógica que matchMosto para las marcas del Excel).
function resolveAseoMatrix(matrix, catalog) {
  return matrix.map((a) => ({
    ...a,
    origenId: matchMosto(a.origen, catalog),
    destinoId: matchMosto(a.destino, catalog),
  }));
}
function getAseoDuracion(fromMostoId, toMostoId, resolvedMatrix, defaultHoras) {
  // Regla fija: no se programa aseo hacia la misma marca.
  if (fromMostoId && toMostoId && fromMostoId === toMostoId) {
    return { horas: 0, definido: true, sinAseo: true };
  }
  // Regla fija: no se programa aseo cuando se sale de Pony hacia cualquier otra marca.
  if (fromMostoId === "pony") {
    return { horas: 0, definido: true, sinAseo: true };
  }
  let m = resolvedMatrix.find(
    (a) => a.origenId === fromMostoId && a.destinoId === toMostoId,
  );
  if (m) return { horas: Number(m.duracionHoras) || 0, definido: true };
  m = resolvedMatrix.find(
    (a) => a.origenId === toMostoId && a.destinoId === fromMostoId,
  );
  if (m) return { horas: Number(m.duracionHoras) || 0, definido: true };
  return { horas: Number(defaultHoras) || 0, definido: false };
}

// Construye la secuencia real de cocimientos (una sola cocina compartida) respetando bloques
// independientes del plan de envasado. Una misma marca/mosto puede reaparecer en otro bloque
// más tarde si el plan la necesita de nuevo, pero nunca se intercalan marcas dentro de un bloque.
// - regla 3: evitar terminar la semana con Pony (se intercambia de posición si es posible).
// - recomendación 1: intentar iniciar la semana con Pony, solo si no rompe ninguna fecha límite.
// - regla 4: bloque de Pony con mínimo de cocimientos necesario para cubrir 4.100 hL.
// - regla 5: alerta si queda un hueco > 2 días entre bloques.
// - reglas 6 y 1: alertas de volumen semanal de Pony / cerveza.
// - regla 7: alerta si la maduración configurada supera 4 días.
// - un evento de ASEO (CIP) programado en cada cambio de marca, con duración según ASEO_MATRIX.
function assignTanks(seq, plan, tankCatalog, catalog) {
  /*
    MODELO FISICO DE EQUIPOS
    ------------------------
    FV       = FERMENTACIÓN. Recibe mosto directamente desde cocina.
    SV       = MADURACIÓN. NO recibe cocimiento de cocina; recibe producto
               transferido desde FV después de terminar la fermentación.
    SV Pony  = MADURACIÓN EXCLUSIVA DE PONY. Pony no usa SV normales.
    BBT      = PRODUCTO TERMINADO. No participa en fermentación ni maduración.

    En FV y SV se procura llenar la capacidad con producto de una sola marca.
    Un FV parcialmente lleno permanece abierto y NO se pasa al siguiente FV mientras
    todavía pueda recibir otro cocimiento COMPLETO de la misma marca. Varios cocimientos
    se acumulan en el mismo tanque hasta llenarlo. Un cocimiento no se fracciona entre
    dos tanques. Solo al llenarse se cierra el lote y comienza la fermentación.
    En SV se aplica la misma regla para los lotes transferidos desde FV. Se respeta
    A → B → C sin mezclar marcas.
  */
  function getMaxCocimientosPorCapacidad(capacidadHL) {
    const capacidad = Number(capacidadHL) || 0;
    // Regla operativa de capacidad por FV:
    // - FV EXT grandes: 7200 HL = 12 cocimientos máximos
    // - FV EXT medianos: 4800 HL = 8 cocimientos máximos
    // - FV de 900 HL: admiten 1,5 cocimientos por lote
    // - FV de 750 HL: admiten 1,25 cocimientos por lote
    // - Si la capacidad no cae en esos rangos, se usa una regla proporcional.
    if (capacidad >= 7000) return 12;
    if (capacidad >= 4500) return 8;
    if (capacidad >= 850) return 1.5;
    if (capacidad >= 700) return 1.25;
    if (capacidad > 0) return Math.max(1, capacidad / 600);
    return 1;
  }

  const tanks = (tankCatalog || [])
    .map((t, idx) => ({
      ...t,
      idx,
      capacidadHL: Number(t.capacidadHL) || 0,
      maxCocimientos: getMaxCocimientosPorCapacidad(Number(t.capacidadHL) || 0),
      prioridad: ["A", "B", "C"].includes(String(t.prioridad).toUpperCase())
        ? String(t.prioridad).toUpperCase()
        : "C",
      disponible: t.disponible !== false,
      volumenAsignado: 0,
      cocimientosAsignados: 0,
      mostoId: null,
      releaseTime: null,
      loteCerrado: false,
    }))
    .sort(
      (a, b) =>
        ({ A: 0, B: 1, C: 2 })[a.prioridad] -
          { A: 0, B: 1, C: 2 }[b.prioridad] || a.idx - b.idx,
    );

  // Ocupación inicial desde el inventario "producto en proceso": un FV/SV que ya
  // tiene producto NO está libre hasta que termine su etapa (fermentación /
  // maduración) y pase por el aseo de reutilización. Se respeta la prioridad
  // A → B → C: solo se marcan como ocupados; el resto del algoritmo no cambia.
  if (typeof inventoryOccupancyByEquipo === "function") {
    const occ = inventoryOccupancyByEquipo();
    const esFVoSV = (t) =>
      t.tipo === "FV" || t.tipo === "SV" || t.tipo === "SV Pony";
    tanks.forEach((t) => {
      if (!t.disponible || !esFVoSV(t)) return;
      const o = occ[normalizeText(t.equipo || "")];
      // Solo los equipos vacíos (o sin dato) están libres. Un equipo que ya
      // terminó su etapa sigue ocupado hasta que se libere + aseo: se le pone
      // releaseTime = o.fecha (que para "listo para liberar" es ~I0), así queda
      // disponible solo después del aseo de reutilización.
      if (!o || o.vacio) return;
      t.releaseTime = o.fecha;
      t.mostoId = o.mostoId || null; // para el aseo previo a reutilizar
      t.volumenAsignado = t.capacidadHL;
      t.cocimientosAsignados = Number(t.maxCocimientos) || 0;
      t.loteCerrado = true;
      t.preocupado = { mostoId: o.mostoId, hasta: o.fecha };
    });
  }

  const cookRows = ((seq && seq.rows) || []).filter(
    (r) => r.tipo === "cocimiento",
  );
  // El orden recibido ya representa bloques completos por marca: no se intercalan marcas.
  // Mantener este orden es obligatorio para que un tanque se llene con cocimientos consecutivos
  // de la misma marca antes de abrir otro bloque de marca.
  const resultRows = [];
  const sinTanque = [];
  const transferencias = [];

  const mById = (id) => (catalog || []).find((x) => x.id === id);
  const isPony = (id) => id === "pony";
  const isFV = (t) => t.tipo === "FV";
  const isSV = (t) => t.tipo === "SV" || t.tipo === "SV Pony";
  const canFV = (t, mostoId) =>
    t.disponible && isFV(t) && t.capacidadHL > 0 && !isPony(mostoId);
  const canSV = (t, mostoId) =>
    t.disponible &&
    isSV(t) &&
    t.capacidadHL > 0 &&
    (t.tipo !== "SV Pony" ? !isPony(mostoId) : isPony(mostoId));

  function releaseFinished(now) {
    tanks.forEach((t) => {
      if (t.releaseTime && now && now.getTime() >= t.releaseTime.getTime()) {
        // El equipo se libera al terminar la etapa. Antes de volver a usarlo
        // debe pasar por aseo; por eso conservamos el último mosto para
        // calcular el tiempo de CIP al momento de la siguiente asignación.
        t.volumenAsignado = 0;
        t.cocimientosAsignados = 0;
        t.ultimoMostoId = t.mostoId || t.ultimoMostoId || null;
        t.ultimoReleaseTime = t.releaseTime;
        t.mostoId = null;
        t.releaseTime = null;
        t.loteCerrado = false;
        t.__loteFV = null;
      }
    });
  }

  function limpiezaNecesaria(t, nuevoMostoId) {
    // El aseo de reutilización lo define el usuario POR EQUIPO en el catálogo.
    // La matriz ASEO_MATRIX sigue siendo exclusivamente para aseos de cocina
    // entre cambios de marca; no se usa para liberar FV/SV.
    const h = Number(t && t.aseoHoras);
    return Number.isFinite(h) && h >= 0 ? h : Number(ASEO_DEFAULT_HORAS) || 0;
  }

  function equipoDisponibleEn(t, now, nuevoMostoId) {
    if (t.releaseTime && now && now.getTime() < t.releaseTime.getTime())
      return false;
    if (!t.ultimoMostoId) return true;
    const base = t.releaseTime || t.ultimoReleaseTime || now;
    if (!base || !now) return true;
    const aseoH = limpiezaNecesaria(t, nuevoMostoId);
    const listo = new Date(base.getTime() + aseoH * 3600000);
    return now.getTime() >= listo.getTime();
  }

  // 1) ASIGNACIÓN A FV: cada cocimiento entra a fermentación.
  // Pony tiene 0 h de fermentación y pasa directamente a SV Pony.
  cookRows.forEach((r, idx) => {
    // PONY NO PASA POR FV: sale de cocina y entra directamente a SV Pony para maduración.
    // Se registra en el bloque específico de transferencias Pony más abajo.
    if (r.mostoId === "pony") return;
    const m = mById(r.mostoId);
    const fermentHoras = Number(m && m.tiempoFermentacionHoras) || 0;
    let restante = Math.max(0, Number(r.cocVolumenHL) || 0);
    if (restante <= 0) {
      const sin = {
        ...r,
        cocimientoNumero: idx + 1,
        etapa: "FV · Fermentación",
        volumenHL: 0,
        tanque: null,
        estado: "sin tanque",
        motivo: "Cocimiento sin volumen calculable",
      };
      resultRows.push(sin);
      sinTanque.push(sin);
      return;
    }

    releaseFinished(r.start);
    const asignaciones = [];

    // Para el mismo mosto: primero tanques FV ya abiertos; luego vacíos, siempre A→B→C.
    while (restante > 1e-9) {
      const volPorCoc = Number((m && m.volumenPorCocimiento) || 600);
      const candidatos = tanks
        .filter((t) => {
          if (!canFV(t, r.mostoId)) return false;
          if (!equipoDisponibleEn(t, r.start, r.mostoId)) return false;
          const libre = t.capacidadHL - t.volumenAsignado;
          const cargaPotencial = Math.min(restante, libre);
          const cocimientosNuevos = cargaPotencial / volPorCoc;
          const maxCocimientos = Number(t.maxCocimientos) || 999;
          // Esta regla permite compartir cocimientos entre FV cuando la fracción es real,
          // por ejemplo: 900 HL admite 1,5 cocimientos y 750 HL admite 1,25 cocimientos.
          // No se divide el volumen de un cocimiento del catálogo; solo se acumula la
          // fracción correspondiente de ese cocimiento en la capacidad del FV.
          // Los FV EXTERIORES siguen teniendo un máximo entero de cocimientos (12 o 8),
          // mientras que los FV pequeños tienen un máximo fraccional (1,5 o 1,25).
          // Un cocimiento completo se mantiene en UN solo tanque.
          // Varios cocimientos de la misma marca pueden compartir el tanque,
          // pero no se parte un cocimiento entre dos FV.
          if (libre <= 1e-9 || t.loteCerrado) return false;
          if (t.mostoId && t.mostoId !== r.mostoId) return false;
          if (
            t.cocimientosAsignados + cocimientosNuevos >
            maxCocimientos + 1e-9
          )
            return false;
          return true;
        })
        .sort((a, b) => {
          const aa = a.mostoId === r.mostoId ? 0 : 1,
            bb = b.mostoId === r.mostoId ? 0 : 1;
          return (
            aa - bb ||
            { A: 0, B: 1, C: 2 }[a.prioridad] -
              { A: 0, B: 1, C: 2 }[b.prioridad] ||
            a.capacidadHL - b.capacidadHL ||
            a.idx - b.idx
          );
        });
      const tank = candidatos[0];
      if (!tank) break;
      // El cocimiento completo entra al mismo tanque; nunca se fracciona.
      const carga = restante;
      tank.volumenAsignado += carga;
      // Se acumulan cocimientos fraccionales según el volumen real del catálogo:
      // 900 HL => 1,5 cocimientos, 750 HL => 1,25 cocimientos, etc.
      // Esto permite compartir cocimientos entre FV pequeños sin dividir el
      // volumen de un cocimiento del catálogo en dos mitades artificiales.
      tank.cocimientosAsignados += carga / volPorCoc;
      tank.mostoId = r.mostoId;
      tank.ultimoMostoId = null;
      tank.ultimoReleaseTime = null;
      const lleno =
        tank.volumenAsignado >= tank.capacidadHL - 1e-9 ||
        tank.cocimientosAsignados >= tank.maxCocimientos - 1e-9;
      const fermentEnd = new Date(r.end.getTime() + fermentHoras * 3600000);
      // IMPORTANTE: un FV parcialmente lleno NO empieza a fermentar/liberarse todavía.
      // Se mantiene abierto para que los siguientes cocimientos de la MISMA marca
      // continúen llenándolo. Solo cuando llega a su capacidad se cierra el lote y
      // comienza a correr la fermentación desde el último cocimiento que lo llenó.
      if (lleno) {
        tank.releaseTime = fermentEnd;
        tank.loteCerrado = true;
      } else {
        tank.releaseTime = null;
        tank.loteCerrado = false;
      }
      asignaciones.push({ tank, carga, lleno, fermentEnd });
      restante -= carga;
    }

    if (restante > 1e-9) {
      const sin = {
        ...r,
        cocimientoNumero: idx + 1,
        etapa: "FV · Fermentación",
        volumenHL: Math.max(0, Number(r.cocVolumenHL) || 0),
        tanque: null,
        estado: "sin tanque",
        motivo: `Faltan ${restante.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL de capacidad en FV disponibles. Los SV son solo de maduración y los BBT solo de producto terminado.`,
      };
      resultRows.push(sin);
      sinTanque.push(sin);
      return;
    }

    asignaciones.forEach((a, subIdx) => {
      const t = a.tank;
      resultRows.push({
        ...r,
        cocimientoNumero: idx + 1,
        subAsignacion: subIdx + 1,
        etapa: "FV · Fermentación",
        volumenHL: a.carga,
        tanque: t.equipo || `Equipo ${t.idx + 1}`,
        tanqueId: t.id,
        tanqueTipo: "FV",
        prioridad: t.prioridad,
        capacidadHL: t.capacidadHL,
        acumuladoHL: t.volumenAsignado,
        restanteHL: Math.max(0, t.capacidadHL - t.volumenAsignado),
        tanqueLleno: a.lleno,
        estado: "Asignado",
      });
      // La transferencia FV→SV se registra sobre el LOTE del FV, no sobre cada cocimiento.
      // Así varios cocimientos que llenan el mismo FV pasan juntos a maduración.
      if (!t.__loteFV) {
        t.__loteFV = {
          mostoId: r.mostoId,
          nombre: r.nombre,
          volumenHL: 0,
          fermentEnd: a.fermentEnd,
          cocimientoNumero: idx + 1,
          maduracionHoras: Number(m && m.tiempoMaduracionHoras) || 0,
          transferida: false,
        };
      }
      t.__loteFV.volumenHL += a.carga;
      t.__loteFV.fermentEnd = a.fermentEnd;
      t.__loteFV.cocimientoNumero = idx + 1;
      t.__loteFV.maduracionHoras = Number(m && m.tiempoMaduracionHoras) || 0;
      if (a.lleno && !t.__loteFV.transferida) {
        transferencias.push({
          fecha: t.__loteFV.fermentEnd,
          mostoId: t.__loteFV.mostoId,
          nombre: t.__loteFV.nombre,
          volumenHL: t.__loteFV.volumenHL,
          origen: t,
          cocimientoNumero: t.__loteFV.cocimientoNumero,
          fermentEnd: t.__loteFV.fermentEnd,
          maduracionHoras: t.__loteFV.maduracionHoras,
        });
        t.__loteFV.transferida = true;
      }
    });
  });

  // Cerrar los FV que quedaron parcialmente llenos al terminar la secuencia de cocina.
  // No se deja producto indefinidamente en FV: el último cocimiento de ese lote determina
  // el fin de fermentación y el paso a SV.
  tanks.forEach((t) => {
    if (t.__loteFV && !t.__loteFV.transferida && t.volumenAsignado > 1e-9) {
      const lote = t.__loteFV;
      // Si el FV quedó parcialmente lleno al finalizar la secuencia, se cierra
      // con el último cocimiento asignado y recién ahí empieza su fermentación.
      t.releaseTime = lote.fermentEnd;
      t.loteCerrado = true;
      transferencias.push({
        fecha: lote.fermentEnd,
        mostoId: lote.mostoId,
        nombre: lote.nombre,
        volumenHL: t.volumenAsignado,
        origen: t,
        cocimientoNumero: lote.cocimientoNumero,
        fermentEnd: lote.fermentEnd,
        maduracionHoras: lote.maduracionHoras,
      });
      lote.transferida = true;
    }
  });

  // Pony no requiere fermentación en FV (su tiempo de fermentación configurado es 0):
  // pasa directamente a SV Pony para maduración.
  cookRows.forEach((r, idx) => {
    if (r.mostoId !== "pony") return;
    const m = mById(r.mostoId);
    transferencias.push({
      fecha: r.end,
      mostoId: r.mostoId,
      nombre: r.nombre,
      volumenHL: Math.max(0, Number(r.cocVolumenHL) || 0),
      origen: null,
      cocimientoNumero: idx + 1,
      fermentEnd: r.end,
      maduracionHoras: Number(m && m.tiempoMaduracionHoras) || 0,
      ponyDirect: true,
    });
  });

  // 2) MADURACIÓN EN SV: se ejecuta cuando cada lote termina fermentación.
  // Se procesa cronológicamente y llena SV hasta capacidad. Pony SOLO puede usar SV Pony.
  transferencias.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  transferencias.forEach((tr) => {
    releaseFinished(tr.fecha);
    let restante = tr.volumenHL;
    const asignaciones = [];
    while (restante > 1e-9) {
      const volPorCoc = Number(
        (mById(tr.mostoId) && mById(tr.mostoId).volumenPorCocimiento) || 600,
      );
      const candidatos = tanks
        .filter((t) => {
          if (!canSV(t, tr.mostoId)) return false;
          if (!equipoDisponibleEn(t, tr.fecha, tr.mostoId)) return false;
          const libre = t.capacidadHL - t.volumenAsignado;
          const cargaPotencial = Math.min(restante, libre);
          const cocimientosNuevos = cargaPotencial / volPorCoc;
          const maxCocimientos = Number(t.maxCocimientos) || 999;
          // Cada lote transferido desde FV entra completo en un solo SV.
          // Varios lotes de la misma marca pueden compartir el SV hasta llenarlo,
          // pero no se parte un lote entre dos SV.
          if (libre <= 1e-9 || t.loteCerrado) return false;
          if (t.mostoId && t.mostoId !== tr.mostoId) return false;
          if (
            t.cocimientosAsignados + cocimientosNuevos >
            maxCocimientos + 1e-9
          )
            return false;
          return true;
        })
        .sort((a, b) => {
          const aa = a.mostoId === tr.mostoId ? 0 : 1,
            bb = b.mostoId === tr.mostoId ? 0 : 1;
          return (
            aa - bb ||
            { A: 0, B: 1, C: 2 }[a.prioridad] -
              { A: 0, B: 1, C: 2 }[b.prioridad] ||
            a.capacidadHL - b.capacidadHL ||
            a.idx - b.idx
          );
        });
      const tank = candidatos[0];
      if (!tank) break;
      // El lote completo permanece en un solo SV; no se fracciona entre tanques.
      const carga = restante;
      tank.volumenAsignado += carga;
      tank.cocimientosAsignados += carga / volPorCoc;
      tank.mostoId = tr.mostoId;
      tank.ultimoMostoId = null;
      tank.ultimoReleaseTime = null;
      const lleno =
        tank.volumenAsignado >= tank.capacidadHL - 1e-9 ||
        tank.cocimientosAsignados >= tank.maxCocimientos - 1e-9;
      tank.releaseTime = new Date(
        tr.fecha.getTime() + tr.maduracionHoras * 3600000,
      );
      tank.loteCerrado = lleno;
      asignaciones.push({ tank, carga, lleno });
      restante -= carga;
    }

    if (restante > 1e-9) {
      const sin = {
        ...tr,
        etapa: "SV · Maduración",
        start: tr.fecha,
        end: new Date(tr.fecha.getTime() + tr.maduracionHoras * 3600000),
        volumenHL: restante,
        tanque: null,
        estado: "sin tanque",
        motivo: `Faltan ${restante.toLocaleString("es-CO", { maximumFractionDigits: 1 })} HL de capacidad en SV habilitados para maduración. Los BBT no se utilizan para maduración.`,
      };
      resultRows.push(sin);
      sinTanque.push(sin);
    }
    asignaciones.forEach((a, subIdx) => {
      const t = a.tank;
      resultRows.push({
        cocimientoNumero: tr.cocimientoNumero,
        nombre: tr.nombre,
        mostoId: tr.mostoId,
        etapa: "SV · Maduración",
        start: tr.fecha,
        end: new Date(tr.fecha.getTime() + tr.maduracionHoras * 3600000),
        subAsignacion: subIdx + 1,
        volumenHL: a.carga,
        tanque: t.equipo || `Equipo ${t.idx + 1}`,
        tanqueId: t.id,
        tanqueTipo: t.tipo,
        prioridad: t.prioridad,
        capacidadHL: t.capacidadHL,
        acumuladoHL: t.volumenAsignado,
        restanteHL: Math.max(0, t.capacidadHL - t.volumenAsignado),
        tanqueLleno: a.lleno,
        estado: "Asignado",
      });
    });
  });

  return {
    rows: resultRows,
    sinTanque,
    tanks,
    totalCocimientos: cookRows.length,
    transferencias,
  };
}

function sequenceWeek(
  plan,
  catalog,
  weekStart,
  aseoMatrix,
  aseoDefaultHoras,
  aseoPeriodico,
  i0FloorDate,
  tankCatalog,
) {
  /*
     SECUENCIA OPERATIVA FLEXIBLE, SIN INTERCALAR MARCAS
     ----------------------------------------------------
     1) Cada bloque de envasado recibe sus inicios definitivos de computeCocinaPlan().
        sequenceWeek NO vuelve a calcular la distancia entre cocimientos: solo puede
        desplazar el bloque completo hacia adelante si la secuencia física lo requiere.
     2) Los bloques se ejecutan en el ORDEN DEL PLAN DE ENVASADO, no por la fecha de
        inicio de cocina calculada.
     3) Un bloque completo puede adelantarse si la cocina queda libre antes; la fecha calculada
        desde envasado es la ÚLTIMA hora permitida de inicio. Nunca se inserta otra marca dentro del bloque.
     4) Entre bloques se programa el CIP correspondiente y, terminado el CIP, el siguiente bloque
        arranca inmediatamente: no se dejan huecos artificiales.
     5) Si aun así la secuencia obliga a terminar el proceso después de su fecha límite, se marca el conflicto;
        no se intercalan marcas para ocultarlo.
  */
  const catalogById = {};
  (catalog || []).forEach((m) => (catalogById[m.id] = m));
  const aseoPeriodicoActivo = !!(aseoPeriodico && aseoPeriodico.activo);
  const aseoPeriodicoHoras =
    Number(aseoPeriodico && aseoPeriodico.duracionHoras) || 0;
  const aseoPeriodicoCada = Math.max(
    1,
    parseInt(aseoPeriodico && aseoPeriodico.cocimientosEntreAseos) || 1,
  );
  const reglaWarnings = [];
  const capacityWarnings = [];
  const yeastEvents = [];
  const yeastPool = (YEAST_AVAILABILITY || [])
    .filter((y) => y.disponible !== false && yeastAvailableDate(y))
    .map((y, index) => ({
      id: y.id || `levadura_${index}`,
      sourceMostoId: y.mostoId || "estandar",
      fechaDisponible: yeastAvailableDate(y),
      origen: y.origen || "Disponibilidad registrada",
      consumida: false,
      automatica: false,
    }));
  // Cosechas previstas: FVs ya en fermentación (inventario) + bloques
  // programados, disponibles a los YEAST_HARVEST_DAYS días de fermentación.
  if (typeof computedYeastHarvests === "function") {
    // Sin la asignación de tanques (se calcula después): solo cosechas del
    // inventario EXT. Las de bloques programados se ven en la pestaña.
    computedYeastHarvests(null).forEach((h, i) => {
      yeastPool.push({
        id: `auto_yeast_${i}_${h.mostoId}`,
        sourceMostoId: h.mostoId,
        fechaDisponible: h.fechaDisponible,
        origen: h.fuente,
        consumida: false,
        automatica: true,
      });
    });
  }
  yeastPool.sort((a, b) => a.fechaDisponible - b.fechaDisponible);
  const resolvedAseo = resolveAseoMatrix(aseoMatrix || [], catalog);

  let blocks = (plan && plan.results ? plan.results : [])
    .filter((r) => Array.isArray(r.starts) && r.starts.length > 0)
    .map((r, sourceIndex) => {
      const m = catalogById[r.mostoId] || {};
      const starts = r.starts.map(
        (d) => new Date(d.getTime ? d.getTime() : new Date(d).getTime()),
      );
      return {
        blockId: `${r.mostoId}__${sourceIndex}`,
        sourceIndex,
        sequenceOrder: Number.isFinite(r.sequenceOrder)
          ? r.sequenceOrder
          : sourceIndex,
        codigo: r.codigo || "",
        tren: r.tren || "",
        blockLabel: r.blockLabel || `${r.nombre} · bloque ${sourceIndex + 1}`,
        mostoId: r.mostoId,
        nombre: r.nombre,
        numCocimientos: starts.length,
        volumenEnvasar: Number(r.volumenEnvasar) || 0,
        volumenCocinar: Number(r.volumenCocinar) || 0,
        volumenPorCocimiento: Number(m.volumenPorCocimiento) || 0,
        cocinaHoras: Number(m.tiempoCocinaHoras) || 0,
        gapHoras: Number(m.tiempoEntreCarguesHoras) || 0,
        fermentacionHoras: Number(m.tiempoFermentacionHoras) || 0,
        maduracionHoras: Number(m.tiempoMaduracionHoras) || 0,
        latestStarts: starts,
        // Fecha límite del bloque = INICIO DEL PRIMER ENVASADO de ese bloque.
        // No se usa la fecha de fin del bloque ni la fecha de envío del plan.
        deadline: r.fechaEnvasadoMinima
          ? new Date(r.fechaEnvasadoMinima.getTime())
          : null,
        firstPackagingStart: r.fechaEnvasadoMinima
          ? new Date(r.fechaEnvasadoMinima.getTime())
          : null,
        actualStarts: [],
        shiftHours: 0,
      };
    });

  // Ningún bloque de Pony puede tener más cocimientos seguidos de los que
  // caben en los SV Pony disponibles: se parte en varios bloques de a lo sumo
  // ese tamaño, cada uno tratado como un bloque normal e independiente por el
  // resto del algoritmo. La regla de selección de bloques (más abajo) es la
  // que de verdad impide que dos tramos de Pony queden consecutivos sin un
  // cambio real de marca.
  blocks = blocks.flatMap((b) => {
    if (b.mostoId !== "pony") return [b];
    const maxRun = ponyMaxCocimientosSeguidos(
      tankCatalog,
      b.volumenPorCocimiento,
    );
    if (b.numCocimientos <= maxRun) return [b];
    const tramos = splitEnTramos(b.numCocimientos, maxRun, PONY_MIN_COCIMIENTOS);
    let offset = 0;
    return tramos.map((size, idx) => {
      const share = size / b.numCocimientos;
      const chunkStarts = b.latestStarts.slice(offset, offset + size);
      offset += size;
      return {
        ...b,
        blockId: `${b.blockId}__t${idx}`,
        sequenceOrder: b.sequenceOrder + idx / 1000,
        blockLabel: `${b.blockLabel} (tramo ${idx + 1}/${tramos.length})`,
        numCocimientos: size,
        volumenEnvasar: b.volumenEnvasar * share,
        volumenCocinar: b.volumenCocinar * share,
        latestStarts: chunkStarts,
        actualStarts: [],
      };
    });
  });

  if (!blocks.length) {
    return {
      rows: [],
      reglaWarnings,
      capacityWarnings,
      recomendaciones: { iniciaConPony: false, ponyJuntoAseo: null },
      resumen: null,
      ordenBloques: [],
      yeastEvents,
      yeastPool,
      yeastBlocked: [],
    };
  }

  blocks.sort(
    (a, b) =>
      a.sequenceOrder - b.sequenceOrder || a.sourceIndex - b.sourceIndex,
  );

  const rows = [];
  const transitionCips = [];
  const scheduledBlocks = [];
  let prevBlock = null;
  let prevBlockEnd = null;
  let prevLastStart = null;
  let ponyJuntoAseo = false;
  let globalCocCount = 0;
  const totalCocimientos = blocks.reduce((a, b) => a + b.numCocimientos, 0);

  // -----------------------------------------------------------------------
  // SECUENCIA CONTINUA DE BLOQUES
  // -----------------------------------------------------------------------
  // La fecha calculada en Programación de cocinas es la "última hora permitida"
  // para arrancar cada bloque. Si la cocina queda libre antes de esa hora, el bloque
  // se adelanta y se ejecuta inmediatamente, manteniendo el orden del plan.
  //
  // Regla clave: una vez que se elige un bloque, TODOS sus cocimientos se ejecutan
  // consecutivamente y con la separación fija entre inicios (2:50 h por defecto).
  // Nunca se intercala otra marca dentro del bloque.
  // -----------------------------------------------------------------------
  const pending = new Set(blocks.map((_, i) => i));
  let cursorTime = null;
  const EPS = 1000;

  function getCipHours(prev, next) {
    if (!prev) return { horas: 0, definido: true, sinAseo: true };
    const info = getAseoDuracion(
      prev.mostoId,
      next.mostoId,
      resolvedAseo,
      aseoDefaultHoras,
    );
    return {
      horas: info.sinAseo ? 0 : Math.max(0, Number(info.horas) || 0),
      definido: info.definido,
      sinAseo: !!info.sinAseo,
    };
  }

  while (pending.size) {
    // Disponibilidad real de la cocina antes del CIP del siguiente bloque.
    const readyBase =
      cursorTime === null ? null : new Date(cursorTime.getTime());

    // La secuencia operativa sigue SIEMPRE el orden solicitado del plan.
    // No se intercalan marcas ni se reordenan bloques para perseguir sus fechas
    // calculadas. Si el siguiente bloque todavía no necesita comenzar, se adelanta
    // y se ejecuta inmediatamente cuando la cocina queda libre; el hueco se evita.
    //
    // ÚNICA excepción: dos tramos de Pony (ya partidos según la capacidad de
    // SV Pony, ver arriba) no pueden quedar consecutivos sin un cambio real
    // de marca entre ellos. Si el candidato natural es Pony justo después de
    // otro tramo de Pony, se adelanta el próximo bloque pendiente de OTRA
    // marca (conservando su propio orden) y el tramo de Pony queda pendiente
    // para la siguiente vuelta del bucle.
    let chosenIdx;
    const remaining = [...pending].sort(
      (ia, ib) =>
        blocks[ia].sequenceOrder - blocks[ib].sequenceOrder || ia - ib,
    );
    chosenIdx = remaining[0];
    if (
      prevBlock &&
      prevBlock.mostoId === "pony" &&
      blocks[chosenIdx].mostoId === "pony"
    ) {
      const alterno = remaining.find((idx) => blocks[idx].mostoId !== "pony");
      if (alterno !== undefined) {
        chosenIdx = alterno;
      } else {
        reglaWarnings.push({
          ids: [4],
          text: `Regla 4: el bloque de Pony "${blocks[chosenIdx].blockLabel}" quedó consecutivo a otro de Pony porque no había ninguna otra marca pendiente para intercalar.`,
        });
      }
    }

    const block = blocks[chosenIdx];
    pending.delete(chosenIdx);

    const firstLatest = block.latestStarts[0];
    const cipInfo = getCipHours(prevBlock, block);
    const cipHours = cipInfo.horas;

    // Los cocimientos se traslapan: mientras uno cocina, el siguiente cargue ya
    // arrancó en macerado/filtración. Por eso, cuando NO hay que hacer aseo entre
    // marcas, el inicio del nuevo bloque simplemente continúa la cadencia normal
    // (último inicio anterior + tiempo entre cargues) y NO espera a que termine de
    // cocinar el cargue anterior. El tiempo de cocción completo (prevBlockEnd) solo
    // se usa como referencia cuando SÍ hay que hacer un aseo (CIP) entre marcas,
    // porque el aseo requiere que la cocina haya quedado realmente libre.
    // Para el primer bloque de todo el plan (prevBlock aún null): firstLatest es la
    // "última hora permitida" de inicio, NO la hora en que debe iniciar. Si hay I0
    // definido y cae antes de firstLatest, hay un hueco de tiempo disponible entre
    // "ahora" (I0) y esa fecha límite — se aprovecha adelantando el arranque hasta I0
    // en vez de dejar la cocina parada esperando innecesariamente. Si I0 cae después
    // de firstLatest, igual se usa I0 (no se puede programar en el pasado). Sin I0
    // definido, se usa firstLatest tal cual, sin adelantar.
    const earliestFeasible = prevBlock
      ? cipInfo.sinAseo
        ? new Date(prevLastStart.getTime() + prevBlock.gapHoras * 3600000)
        : new Date(prevBlockEnd.getTime() + cipHours * 3600000)
      : i0FloorDate
        ? new Date(i0FloorDate.getTime())
        : new Date(firstLatest.getTime());

    // El primer cocimiento puede adelantarse hasta el momento en que la cocina queda
    // realmente disponible. A PARTIR DE ESE INICIO, todos los cocimientos del bloque
    // se construyen exclusivamente con la separación entre INICIOS configurada.
    // El tiempo de cocina (8:15, 8:50, 8:55, etc.) NO interviene en la separación
    // entre inicios.
    let actualFirst = new Date(earliestFeasible.getTime());
    // Vencimiento (catálogo de mostos, "Vencimiento en SV"): tiempoVencimientoHoras
    // es el máximo TOTAL que un lote puede estar en su SV, maduración incluida
    // (0 = sin control, p. ej. cerveza normal) — no un plazo aparte después de
    // madurar. Como la maduración (tiempoMaduracionHoras) es fija, el margen
    // real que se puede "adelantar" la cocina sin que se venza es
    // vencimiento − maduración. "firstLatest" es la última hora permitida de
    // este cocimiento (calculada desde el envasado con cero holgura); como
    // todos los cocimientos del bloque comparten la misma separación entre
    // inicios que "latestStarts", adelantar el primero hasta como mucho
    // firstLatest − ese margen basta para que TODO el bloque lo respete,
    // aunque la cocina esté libre mucho antes.
    const vencimientoHoras = Number(
      (catalogById[block.mostoId] || {}).tiempoVencimientoHoras,
    );
    if (vencimientoHoras > 0) {
      const margenHoras = Math.max(0, vencimientoHoras - block.maduracionHoras);
      const pisoVencimiento = new Date(
        firstLatest.getTime() - margenHoras * 3600000,
      );
      if (actualFirst.getTime() < pisoVencimiento.getTime()) {
        actualFirst = pisoVencimiento;
      }
    }
    // Restricción de levadura: Light solo puede arrancar con una cosecha Light.
    // Si existe una cosecha futura, el bloque se desplaza hasta esa fecha. Si no
    // existe ninguna, el bloque queda bloqueado y no entra a la secuencia física.
    let yeastUsed = null;
    if (block.mostoId === "light") {
      const compatibles = yeastPool
        .filter(
          (y) =>
            !y.consumida && yeastCompatible(y.sourceMostoId, block.mostoId),
        )
        .sort((a, b) => a.fechaDisponible - b.fechaDisponible);
      yeastUsed =
        compatibles.find((y) => y.fechaDisponible <= actualFirst) ||
        compatibles[0] ||
        null;
      if (!yeastUsed) {
        block.yeastBlocked = true;
        const warning = {
          tipo: "levadura",
          mostoId: "light",
          nombre: block.nombre,
          blockLabel: block.blockLabel,
          deadline: block.deadline,
          detalle:
            "No existe levadura Light disponible. El bloque no se programa porque Light solo puede sembrarse con una cosecha proveniente de un tanque Light.",
        };
        capacityWarnings.push(warning);
        yeastEvents.push({
          blockLabel: block.blockLabel,
          mostoId: block.mostoId,
          estado: "BLOQUEADO",
          requerida: "Light",
          fuente: "—",
          disponibleDesde: null,
          inicio: null,
          detalle: warning.detalle,
        });
        continue;
      }
      if (yeastUsed.fechaDisponible > actualFirst) {
        actualFirst = new Date(yeastUsed.fechaDisponible.getTime());
        capacityWarnings.push({
          tipo: "levadura",
          mostoId: "light",
          nombre: block.nombre,
          blockLabel: block.blockLabel,
          blockStart: actualFirst,
          deadline: block.deadline,
          detalle: `El bloque Light fue desplazado hasta ${fmtDateTime(actualFirst)} por disponibilidad de levadura Light.`,
        });
      }
      yeastUsed.consumida = true;
      // Este mismo bloque Light, una vez fermentado, se vuelve una cosecha
      // futura disponible para OTROS bloques Light más adelante en la semana
      // (o en semanas siguientes fusionadas en el mismo instructivo). Sin
      // esto, solo el primer bloque Light podía programarse: el resto se
      // bloqueaba aunque hubiera levadura propia en camino.
      if (typeof YEAST_HARVEST_DAYS !== "undefined") {
        yeastPool.push({
          id: `auto_sched_${block.blockId}`,
          sourceMostoId: "light",
          fechaDisponible: new Date(
            actualFirst.getTime() + YEAST_HARVEST_DAYS * 86400000,
          ),
          origen: `Cosecha propia · ${block.blockLabel}`,
          consumida: false,
          automatica: true,
        });
      }
    }
    block.yeastUsed = yeastUsed;
    block.shiftHours =
      (actualFirst.getTime() - firstLatest.getTime()) / 3600000;
    // El aseo periódico es una demora REAL en el cronograma, no una etiqueta
    // que solo aparece si por casualidad ya hay un hueco (con el tiempo entre
    // cargues normal casi nunca lo hay: la cocina dura más que el cargue).
    // globalCocCount ya cuenta los cocimientos de TODOS los bloques anteriores,
    // así que "globalCocCount + i" es la posición global del cocimiento i de
    // este bloque — el corte cae exactamente cada aseoPeriodicoCada cocimientos
    // sin importar si cae dentro del bloque o justo al empezar uno nuevo.
    block.actualStarts = [];
    block.periodicPauseBefore = [];
    {
      let cursor = actualFirst.getTime();
      for (let i = 0; i < block.numCocimientos; i++) {
        const pos = globalCocCount + i;
        const pausa =
          aseoPeriodicoActivo &&
          aseoPeriodicoCada > 0 &&
          pos > 0 &&
          pos % aseoPeriodicoCada === 0;
        if (pausa) cursor += aseoPeriodicoHoras * 3600000;
        block.periodicPauseBefore.push(pausa);
        block.actualStarts.push(new Date(cursor));
        cursor += block.gapHoras * 3600000;
      }
    }

    if (block.mostoId === "light") {
      yeastEvents.push({
        blockLabel: block.blockLabel,
        mostoId: block.mostoId,
        estado: "APTO",
        requerida: "Light",
        fuente: block.yeastUsed ? block.yeastUsed.origen : "—",
        disponibleDesde: block.yeastUsed
          ? block.yeastUsed.fechaDisponible
          : null,
        inicio: block.actualStarts[0],
        detalle:
          block.yeastUsed && block.yeastUsed.fechaDisponible > earliestFeasible
            ? "Programado desde la primera disponibilidad compatible."
            : "Levadura Light disponible al inicio.",
      });
      // La cosecha de este bloque Light ya está contemplada en yeastPool a
      // través de computedYeastHarvests (a los YEAST_HARVEST_DAYS días del
      // primer cocimiento del bloque).
    } else if (block.mostoId === "pony") {
      // Pony Malta no fermenta (0 h de fermentación, no pasa por FV): no usa
      // levadura, así que no aplica ninguna restricción ni consumo del pool.
      yeastEvents.push({
        blockLabel: block.blockLabel,
        mostoId: block.mostoId,
        estado: "N/A",
        requerida: "No aplica",
        fuente: "Pony no fermenta",
        disponibleDesde: null,
        inicio: actualFirst,
        detalle: "Pony Malta no usa levadura: sale de cocina directo a SV, sin fermentación.",
      });
    } else {
      yeastEvents.push({
        blockLabel: block.blockLabel,
        mostoId: block.mostoId,
        estado: "APTO",
        requerida: "General / mezcla",
        fuente: "Compatible sin exclusividad Light",
        disponibleDesde: actualFirst,
        inicio: actualFirst,
        detalle:
          "Puede usar levaduras cosechadas de marcas no Light mezcladas entre sí o levadura Light.",
      });
    }
    // Validación: dentro de cada bloque la diferencia entre inicios nunca puede
    // ser MENOR al tiempo entre cargues (sería físicamente imposible).
    for (let i = 1; i < block.actualStarts.length; i++) {
      const deltaH =
        (block.actualStarts[i].getTime() -
          block.actualStarts[i - 1].getTime()) /
        3600000;
      if (deltaH - block.gapHoras < -1e-9) {
        throw new Error(
          `Error de secuencia en ${block.nombre}: el cocimiento #${i + 1} no está separado al menos ${block.gapHoras.toFixed(2)} h del anterior.`,
        );
      }
    }

    if (prevBlock) {
      const cipStart = new Date(prevBlockEnd.getTime());
      const cipEnd = new Date(prevBlockEnd.getTime() + cipHours * 3600000);
      if (!cipInfo.sinAseo) {
        transitionCips.push({
          n: 0,
          tipo: "aseo",
          mostoId: null,
          blockId: block.blockId,
          afterBlockId: prevBlock.blockId,
          nombre: `ASEO ${blocksNombre(prevBlock.mostoId, catalogById)} → ${blocksNombre(block.mostoId, catalogById)}`,
          start: cipStart,
          end: cipEnd,
          definido: cipInfo.definido,
        });
        if (prevBlock.mostoId === "pony" || block.mostoId === "pony")
          ponyJuntoAseo = true;
      }

      const gapDespuesCip =
        (actualFirst.getTime() - cipEnd.getTime()) / 3600000;
      if (gapDespuesCip > 48) {
        reglaWarnings.push({
          ids: [5],
          text: `Regla 5: hueco de ${gapDespuesCip.toFixed(1)} h sin cocimientos entre el bloque de ${prevBlock.nombre} y el bloque de ${block.nombre} (más de 2 días).`,
        });
      }
    }

    // Bloque completo: se conservan TODOS los cocimientos y sus fechas relativas.
    block.actualStarts.forEach((startDate, i) => {
      const start = new Date(startDate.getTime());
      const end = new Date(start.getTime() + block.cocinaHoras * 3600000);

      // El aseo periódico ya quedó reservado como una demora real al construir
      // block.actualStarts (ver arriba): aquí solo se refleja como fila.
      if (block.periodicPauseBefore[i]) {
        rows.push({
          n: 0,
          tipo: "aseo",
          mostoId: null,
          blockId: block.blockId,
          nombre: `ASEO periódico (cada ${aseoPeriodicoCada} cocimientos)`,
          start: new Date(start.getTime() - aseoPeriodicoHoras * 3600000),
          end: new Date(start.getTime()),
          definido: true,
          periodico: true,
        });
      }

      const volXCoc = block.volumenPorCocimiento;
      const restante = Math.max(0, block.volumenCocinar - i * volXCoc);
      const cocVolumenHL = Math.min(volXCoc, restante);
      rows.push({
        n: 0,
        tipo: "cocimiento",
        blockId: block.blockId,
        mostoId: block.mostoId,
        nombre: block.nombre,
        codigo: block.codigo,
        tren: block.tren,
        blockLabel: block.blockLabel,
        start,
        end,
        latestStart: new Date(block.latestStarts[i].getTime()),
        shiftHours: block.shiftHours,
        firstPackagingStart: block.firstPackagingStart
          ? new Date(block.firstPackagingStart.getTime())
          : null,
        blockStart: i === 0,
        blockEnd: i === block.actualStarts.length - 1,
        deadline: block.deadline,
        violaDeadline: false,
        cocVolumenHL,
      });
      globalCocCount++;
    });

    scheduledBlocks.push(block);
    prevBlock = block;
    prevLastStart = new Date(
      block.actualStarts[block.actualStarts.length - 1].getTime(),
    );
    prevBlockEnd = new Date(
      prevLastStart.getTime() + block.cocinaHoras * 3600000,
    );
    // El cursor para el siguiente bloque debe reflejar la cadencia real de la cocina,
    // no el fin de cocción: si el próximo bloque no requiere aseo, puede arrancar en
    // cuanto la cocina quede libre para macerar/filtrar (prevLastStart + gap), que es
    // normalmente mucho antes de prevBlockEnd. Usamos el más temprano de los dos como
    // base de "disponibilidad", y la lógica de earliestFeasible arriba decide cuál
    // aplica según si hay o no aseo.
    cursorTime = new Date(
      Math.min(
        prevLastStart.getTime() + block.gapHoras * 3600000,
        prevBlockEnd.getTime(),
      ),
    );
  }

  // Reemplazamos el orden de análisis por el orden físico realmente ejecutado.
  // Los cocimientos de un bloque siguen siempre consecutivos y su CIP queda
  // inmediatamente después del bloque que acaba de terminar.
  const executionBlocks = scheduledBlocks;
  const grouped = [];
  for (const block of executionBlocks) {
    const blockRows = rows.filter((r) => r.blockId === block.blockId);
    grouped.push(...blockRows);
    const cips = transitionCips.filter((r) => r.afterBlockId === block.blockId);
    grouped.push(...cips);
  }
  rows.length = 0;
  rows.push(...grouped);
  rows.forEach((r, idx) => (r.n = idx + 1));

  // "inicio de bloque" / "fin de bloque" es un rótulo que anuncia un cambio real
  // de marca a continuación. Cada demanda de envasado arma su propio bloque de
  // cocina (arriba, deliberadamente sin agruparse por marca — ver comentario en
  // computeCocinaPlan), pero cuando dos de esos bloques quedan consecutivos y son
  // de LA MISMA marca, no debe mostrarse un falso fin/inicio entre ellos: se
  // recalculan los rótulos aquí mirando la marca del cocimiento vecino real.
  const cocRows = rows.filter((r) => r.tipo === "cocimiento");
  cocRows.forEach((r, i) => {
    const prev = cocRows[i - 1];
    const next = cocRows[i + 1];
    r.blockStart = !prev || prev.mostoId !== r.mostoId;
    r.blockEnd = !next || next.mostoId !== r.mostoId;
  });

  // Para las reglas/recomendaciones, usar el orden físico ejecutado.
  blocks = executionBlocks;
  // Verificación final de fecha límite usando LAS FECHAS ACTUALES de la secuencia.
  // Si un bloque tuvo que desplazarse porque el bloque anterior todavía ocupaba la cocina,
  // ese desplazamiento puede convertirlo en incumplimiento.
  blocks.forEach((block) => {
    if (!block.deadline) return;
    const blockRows = rows.filter(
      (r) => r.blockId === block.blockId && r.tipo === "cocimiento",
    );
    if (!blockRows.length) return;
    const lastCookEnd = blockRows[blockRows.length - 1].end;
    const blockEnd = new Date(
      lastCookEnd.getTime() +
        (block.fermentacionHoras + block.maduracionHoras) * 3600000,
    );
    if (blockEnd.getTime() > block.deadline.getTime() + 1) {
      const retrasoHoras =
        (blockEnd.getTime() - block.deadline.getTime()) / 3600000;
      blockRows.forEach((r) => (r.violaDeadline = true));
      capacityWarnings.push({
        mostoId: block.mostoId,
        nombre: block.nombre,
        blockStart: blockRows[0].start,
        blockEnd,
        deadline: block.deadline,
        retrasoHoras,
        tipo: "deadline",
        detalle: `El bloque tuvo que iniciar ${Math.max(0, block.shiftHours).toFixed(1)} h después de su último inicio permitido para respetar la secuencia de bloques.`,
      });
    }
  });

  const ponyBlocks = blocks.filter((b) => b.mostoId === "pony");
  const totalHL = blocks.reduce((a, b) => a + b.volumenEnvasar, 0);
  const ponyHL = ponyBlocks.reduce((a, b) => a + b.volumenEnvasar, 0);
  const cervezaHL = totalHL - ponyHL;

  // Reglas 1 y 6: se miden POR SEMANA CALENDARIO (lunes a domingo), sobre el
  // volumen de envasado PEDIDO esa semana — no sobre el total acumulado de
  // todas las semanas que traiga el instructivo (puede traer varias hojas
  // "Semana N" fusionadas). Cada bloque se ubica en la semana de su fecha de
  // envasado (block.deadline = fechaEnvasadoMinima); los tramos de un mismo
  // bloque de Pony ya comparten esa fecha, así que quedan en la misma semana.
  function lunesDe(fecha) {
    const d = new Date(
      Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
    );
    const dow = d.getUTCDay(); // 0 = domingo
    return addDays(d, dow === 0 ? -6 : 1 - dow);
  }
  const semanas = {};
  blocks.forEach((b) => {
    const ref = b.deadline || (b.latestStarts && b.latestStarts[0]) || null;
    const lunes = ref ? lunesDe(ref) : null;
    const key = lunes ? lunes.getTime() : "sin-fecha";
    if (!semanas[key]) semanas[key] = { lunes, ponyHL: 0, cervezaHL: 0, totalHL: 0 };
    const s = semanas[key];
    s.totalHL += b.volumenEnvasar;
    if (b.mostoId === "pony") s.ponyHL += b.volumenEnvasar;
    else s.cervezaHL += b.volumenEnvasar;
  });
  Object.values(semanas).forEach((s) => {
    const semanaTxt = s.lunes
      ? `semana del ${fmtDate(s.lunes)} (lun-dom)`
      : "semana sin fecha de envasado";
    if (s.ponyHL > 23600) {
      reglaWarnings.push({
        ids: [6],
        text: `Regla 6: volumen de Pony en la ${semanaTxt} (${s.ponyHL.toLocaleString("es-CO", { maximumFractionDigits: 0 })} hL) supera 23.600 hL.`,
      });
    }
    const escenarioCerveza = s.cervezaHL <= 66000 && s.ponyHL <= 15000;
    const escenarioPony = s.ponyHL <= 23600 && s.cervezaHL <= 57400;
    if (s.totalHL > 81000 || (!escenarioCerveza && !escenarioPony)) {
      reglaWarnings.push({
        ids: [1],
        text: `Regla 1: volumen total en la ${semanaTxt} (${s.totalHL.toLocaleString("es-CO", { maximumFractionDigits: 0 })} hL) no cabe en ninguno de los escenarios de aseo permitidos.`,
      });
    }
  });
  blocks.forEach((b) => {
    if (b.maduracionHoras > 96)
      reglaWarnings.push({
        ids: [7],
        text: `Regla 7: la maduración configurada para ${b.nombre} supera 4 días.`,
      });
  });

  // Regla 4: los bloques de Pony deben contemplar como mínimo dos cocimientos
  // consecutivos (4.100 hL mínimo). Se valida aquí sobre el resultado final ya
  // secuenciado, como respaldo por si algún ajuste manual del catálogo o del
  // inventario terminara dejando un bloque de Pony con un solo cocimiento.
  blocks.forEach((b) => {
    if (b.mostoId !== "pony") return;
    if (b.numCocimientos < 2) {
      reglaWarnings.push({
        ids: [4],
        text: `Regla 4: el bloque de Pony "${b.blockLabel || b.nombre}" solo tiene ${b.numCocimientos} cocimiento(s) programado(s); el acuerdo de servicio exige mínimo dos cocimientos consecutivos (4.100 hL mínimo).`,
      });
    }
  });

  return {
    rows,
    reglaWarnings,
    capacityWarnings,
    recomendaciones: {
      iniciaConPony: blocks.length > 0 && blocks[0].mostoId === "pony",
      ponyJuntoAseo: ponyBlocks.length ? ponyJuntoAseo : null,
    },
    resumen: { totalHL, ponyHL, cervezaHL },
    ordenBloques: blocks.map((b) => b.blockLabel),
    yeastEvents,
    yeastPool,
    yeastBlocked: yeastEvents.filter((e) => e.estado === "BLOQUEADO"),
  };
}

function blocksNombre(mostoId, catalogById) {
  const m = catalogById[mostoId];
  return m ? m.nombre : mostoId;
}

