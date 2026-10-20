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
  // El I0 es el CORTE: marca desde qué hora se mira lo que falta por envasar.
  // Todo lo que ya terminó de envasarse antes del I0 no es demanda pendiente y
  // no genera cocimientos. Si una corrida está a medias en el I0, solo cuenta la
  // parte que le queda (prorrateada por tiempo).
  const i0 = typeof getI0Date === "function" ? getI0Date() : null;
  const i0Ms = i0 ? i0.getTime() : null;
  const envasadoOmitido = []; // lo que quedó fuera por ser anterior al I0

  const events = [];
  let order = 0;
  TRAINS.forEach((t) => {
    (mergedByTrain[t] || [])
      .filter((b) => b.type === "production" && b.codigo)
      .forEach((b) => {
        const ini = new Date(b.start.getTime());
        const fin = b.end ? new Date(b.end.getTime()) : null;
        let volumen = Number(b.hectolitros) || 0;
        let earliest = ini;
        if (i0Ms != null) {
          const finMs = fin ? fin.getTime() : ini.getTime();
          if (finMs <= i0Ms) {
            // Ya se envasó por completo antes del I0.
            if (volumen > 0)
              envasadoOmitido.push({
                name: b.name || b.codigo,
                volumen,
                fin: fin || ini,
                train: t,
              });
            return;
          }
          if (ini.getTime() < i0Ms && fin && fin > ini) {
            // Corrida a medias en el I0: se cuenta solo lo que falta.
            const total = finMs - ini.getTime();
            const restante = finMs - i0Ms;
            const yaEnvasado = volumen * (1 - restante / total);
            if (yaEnvasado > 0)
              envasadoOmitido.push({
                name: b.name || b.codigo,
                volumen: yaEnvasado,
                fin: new Date(i0Ms),
                train: t,
                parcial: true,
              });
            volumen = volumen * (restante / total);
            earliest = new Date(i0Ms);
          }
        }
        events.push({
          codigo: b.codigo,
          name: b.name || b.codigo,
          earliest,
          end: fin,
          volumen,
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

  // Volumen resuelto (con fallback al resumen) + mosto de cada evento.
  const withVol = events
    .map((e) => {
      let volumen = e.volumen;
      if (!(volumen > 0)) {
        const summary = summaryMap[e.codigo];
        volumen =
          summary && summary.total && Number(summary.total.hlBBTs) > 0
            ? Number(summary.total.hlBBTs)
            : 0;
      }
      return { ...e, volumen, mostoId: matchMosto(e.name, MOSTO_CATALOG) };
    })
    .filter((e) => e.volumen > 0 && e.mostoId);

  // El número de cocimientos lo fija el volumen (ver computeCocinaPlan); NO se
  // infla partiendo la demanda en trozos. Por eso aquí se AGRUPA toda la demanda
  // de un mismo mosto que solo viene separada por OTRO mosto:
  //   · Stream cerveza: se agrupa por mostoId; la Pony intercalada es
  //     transparente (no corta el bloque de cerveza). Poker → Pony → Águila,
  //     todos "estandar", quedan en un solo bloque.
  //   · Stream Pony: GO y HG son el mismo mosto y se cuecen juntas, así que
  //     entran al mismo bloque; la cerveza intercalada es transparente.
  // El "mínimo 2 / máximo 4" de Pony es una regla de SECUENCIA (corridas
  // consecutivas), no de conteo: se aplica en sequenceWeek, no aquí.
  const skuCorto = (nm) =>
    String(nm || "")
      .replace(/\s+/g, " ")
      .trim();
  const nombreMosto = (id) => {
    const m = (MOSTO_CATALOG || []).find((x) => x.id === id);
    return m ? m.nombre : id;
  };
  const grupoABrand = (g, streamKey) => {
    const evs = g.events;
    const vol = evs.reduce((a, e) => a + e.volumen, 0);
    const earliest = evs.reduce(
      (a, e) => (e.earliest && e.earliest < a ? new Date(e.earliest.getTime()) : a),
      new Date(evs[0].earliest.getTime()),
    );
    const end = evs.reduce(
      (a, e) => (e.end && (!a || e.end > a) ? new Date(e.end.getTime()) : a),
      evs[0].end ? new Date(evs[0].end.getTime()) : null,
    );
    const seqOrder = Math.min(...evs.map((e) => e.sequenceOrder));
    const marcasTxt = [...new Set(evs.map((e) => skuCorto(e.name)))];
    return {
      codigo: evs[0].codigo,
      name: evs[0].name,
      earliest,
      end,
      volumen: vol,
      train: evs[0].train,
      sequenceOrder: seqOrder,
      _streamKey: streamKey,
      _mostoNombre: nombreMosto(g.mostoId),
      _marcasTxt: marcasTxt,
      marcas: evs,
    };
  };

  const grouped = [];

  // Cada stream corre por su lado: dentro de él, eventos consecutivos del mismo
  // mosto son un solo bloque; lo que se cuela del otro stream no lo corta.
  const agruparStream = (evs, streamKey) => {
    let cur = null;
    evs.forEach((e) => {
      if (!cur || cur.mostoId !== e.mostoId) {
        if (cur) grouped.push(grupoABrand(cur, streamKey));
        cur = { mostoId: e.mostoId, events: [e] };
      } else {
        cur.events.push(e);
      }
    });
    if (cur) grouped.push(grupoABrand(cur, streamKey));
  };
  // --- Stream cerveza (Pony transparente) ---
  agruparStream(
    withVol.filter((e) => !esMostoPony(e.mostoId)),
    "cerveza",
  );
  // --- Stream Pony, GO y HG juntas: mismo mosto (cerveza transparente) ---
  agruparStream(
    withVol.filter((e) => esMostoPony(e.mostoId)),
    "pony",
  );

  // Orden temporal final por primera fecha de envasado; se renumera el bloque.
  grouped.sort(
    (a, b) => a.earliest - b.earliest || a.sequenceOrder - b.sequenceOrder,
  );
  grouped.forEach((g, i) => {
    g.sequenceOrder = i;
    const extra =
      g._marcasTxt.length > 1 ? ` (${g._marcasTxt.join(" + ")})` : "";
    g.blockLabel = `${g._mostoNombre} · bloque ${i + 1}${extra}`;
    brands.push(g);
  });

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
  // Lo que el I0 dejó fuera (ya envasado), para poder mostrarlo.
  brands.envasadoOmitido = envasadoOmitido;
  brands.i0Corte = i0 || null;
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

// Una corrida de cerveza (Estandar, Pilsen o Light) va de 14 cocimientos
// seguidos para arriba. Por eso los bloques cercanos de un mismo mosto se
// juntan en uno solo en vez de programarse por separado, y un bloque solo se
// parte si de la partida salen dos corridas que sigan llegando a este mínimo.
const MIN_CORRIDA_CERVEZA = 14;
// Máximo de horas que un FV espera abierto el siguiente cocimiento de su marca.
const FV_MAX_ESPERA_LLENADO_HORAS = 24;

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

// Ventana de una campaña: cuánto se puede adelantar el cocimiento que más se
// adelanta dentro de una corrida seguida. Cerveza: el mismo tope de adelanto de
// la secuencia (2 días). Light: 3 días (manda la levadura). Pony: su máximo en
// BBT (48 h): con más que eso, la Pony quedaría esperando en el BBT.
const CAMPANA_VENTANA_HORAS = { estandar: 48, pilsen: 48, light: 72 };

// Demanda en el tiempo → cocimientos. `piezas` son los tramos de envasado que
// el inventario no cubre: {hL, desde, hasta, name, codigo, train}. Se supone
// que cada tramo se envasa parejo entre `desde` y `hasta`. El cocimiento n.º k
// (desde 0) se necesita cuando la demanda acumulada pasa de k rendimientos, y
// su producto se acaba cuando llega a (k+1) rendimientos.
function cocimientosDeDemanda(piezas, m) {
  const H = 3600000;
  const rinde =
    (Number(m.factorDilucion) || 1) * (Number(m.volumenPorCocimiento) || 1);
  const procMs =
    ((Number(m.tiempoCocinaHoras) || 0) +
      (Number(m.tiempoFermentacionHoras) || 0) +
      (Number(m.tiempoMaduracionHoras) || 0)) *
    H;
  const pz = (piezas || [])
    .filter((p) => p.hL > 1e-9 && p.hasta > p.desde)
    .map((p) => ({ ...p, rate: p.hL / (p.hasta - p.desde) }));
  const total = pz.reduce((a, p) => a + p.hL, 0);
  if (!(total > 1e-9)) return [];
  const ts = [...new Set(pz.flatMap((p) => [p.desde, p.hasta]))].sort(
    (a, b) => a - b,
  );
  const D = ts.map((t) =>
    pz.reduce(
      (a, p) =>
        a + p.hL * Math.min(1, Math.max(0, (t - p.desde) / (p.hasta - p.desde))),
      0,
    ),
  );
  // Primer instante en que la demanda acumulada llega a v.
  const tiempoDe = (v) => {
    for (let i = 1; i < ts.length; i++) {
      if (D[i] >= v - 1e-9) {
        if (D[i] - D[i - 1] <= 1e-12) return ts[i];
        return ts[i - 1] + ((v - D[i - 1]) / (D[i] - D[i - 1])) * (ts[i] - ts[i - 1]);
      }
    }
    return ts[ts.length - 1];
  };
  const N = Math.max(1, Math.ceil(total / rinde - 1e-9));
  const out = [];
  for (let k = 0; k < N; k++) {
    // «+0,001 hL»: si la demanda se queda quieta justo en k rendimientos (un
    // fin de semana sin envasar), se necesita cuando VUELVE a subir.
    const need = tiempoDe(Math.min(total, k * rinde + 1e-3));
    const needEnd = tiempoDe(Math.min(total, (k + 1) * rinde));
    const consumo = pz
      .map((p) => {
        const a = Math.max(need, p.desde);
        const z = Math.min(needEnd, p.hasta);
        return z > a
          ? { train: p.train, name: p.name, codigo: p.codigo, desde: a, hasta: z, hL: p.rate * (z - a) }
          : null;
      })
      .filter((c) => c && c.hL > 0.5);
    out.push({
      k,
      need,
      needEnd,
      latest: need - procMs,
      // «A más tardar» propio (sin el ajuste por lote de FV): contra este se
      // dice si un cocimiento llega tarde. El ajuste por lote solo adelanta la
      // programación; si al final el FV se cierra antes, el cocimiento llega.
      latestPropio: need - procMs,
      hLProducto: Math.min(rinde, total - k * rinde),
      consumo,
    });
  }
  return out;
}

// Cocimientos → campañas (corridas seguidas). Una campaña se cocina de corrido,
// un cargue tras otro; entra el siguiente cocimiento del mosto mientras ninguno
// quede adelantado más que la ventana del mosto (y la Pony, de a 5 como mucho).
// Cocimientos que se planea juntar en un mismo FV. El lote fermenta desde su
// ÚLTIMO llenado, así que el primero del lote tiene que esperar a los demás:
// para que el lote completo quede listo a tiempo, cada cocimiento del lote debe
// cargar antes de «necesidad del primero − proceso − los cargues que faltan».
// 8 cocimientos = un FV de 4.800 hL (los de 7.200 reciben 12).
const FV_LOTE_PLAN = 8;

function agruparEnCampanas(cocs, m, mostoId) {
  const H = 3600000;
  if (!cocs.length) return [];
  const gap = (Number(m.tiempoEntreCarguesHoras) || 0) * H;
  if ((Number(m.tiempoFermentacionHoras) || 0) > 0) {
    const procMs =
      ((Number(m.tiempoCocinaHoras) || 0) + (Number(m.tiempoFermentacionHoras) || 0) + (Number(m.tiempoMaduracionHoras) || 0)) * H;
    // El lote se llena con los cocimientos que se envasan cerca del primero
    // (dentro de la ventana de adelanto del mosto): con una marca de poca
    // demanda no se cocinan 8 de una vez para que esperen días en el tanque.
    const ventLote = (CAMPANA_VENTANA_HORAS[mostoId] != null ? CAMPANA_VENTANA_HORAS[mostoId] : 48) * H;
    for (let i = 0; i < cocs.length; ) {
      let fin = i + 1;
      while (fin < cocs.length && fin - i < FV_LOTE_PLAN && cocs[fin].need - cocs[i].need <= ventLote) fin++;
      const lote = cocs.slice(i, fin);
      i = fin;
      const limite = Math.min(...lote.map((c) => c.need)) - procMs;
      lote.forEach((c, p) => {
        c.latest = Math.min(c.latest, limite - (lote.length - 1 - p) * gap);
      });
    }
  }
  const pony = esMostoPony(mostoId);
  const ventana =
    (pony
      ? Number(m.tiempoMaxBBTHoras) || 48
      : CAMPANA_VENTANA_HORAS[mostoId] != null
        ? CAMPANA_VENTANA_HORAS[mostoId]
        : 48) * H;
  // Tope de tamaño: Pony de a 5 (acuerdo). Estándar y Pilsen de a 6: entre
  // ellas no hay aseo, así que cortar la corrida no cuesta nada y deja meter a
  // tiempo la otra cerveza (una corrida de 20 Estándar dejaba la Pilsen 2 días
  // tarde). Light sí paga aseo al entrar, así que va completa.
  const maxN = pony ? 5 : mostoId === "light" ? 60 : 6;
  const rango = (g) => {
    const v = g.map((c, j) => c.latest - j * gap);
    return { min: Math.min(...v), max: Math.max(...v) };
  };
  const grupos = [];
  let cur = [];
  cocs.forEach((c) => {
    const prueba = [...cur, c];
    const r = rango(prueba);
    if (cur.length && (r.max - r.min > ventana || prueba.length > maxN)) {
      grupos.push(cur);
      cur = [c];
    } else cur = prueba;
  });
  if (cur.length) grupos.push(cur);
  // Una Pony suelta (1 cocimiento) NO se junta a la fuerza con la siguiente:
  // para eso habría que cocinarla hasta 3 días antes y dejarla 72 h en el BBT,
  // que es justo el error que se veía (Pony en fechas que no tocaban). Si sale
  // suelta es porque el envasado pide poca Pony en esa ventana; la secuencia lo
  // avisa en Conflictos de capacidad para que se revise el plan de envasado.
  const factor = Number(m.factorDilucion) || 1;
  return grupos.map((g) => {
    const r = rango(g);
    const porMarca = new Map();
    g.forEach((c) =>
      c.consumo.forEach((x) => {
        const key = `${x.train}|${x.codigo}|${x.name}`;
        const o = porMarca.get(key) || { name: x.name, codigo: x.codigo, train: x.train, desde: x.desde, hasta: x.hasta, volumen: 0 };
        o.desde = Math.min(o.desde, x.desde);
        o.hasta = Math.max(o.hasta, x.hasta);
        o.volumen += x.hL;
        porMarca.set(key, o);
      }),
    );
    const marcas = [...porMarca.values()]
      .sort((a, b) => a.desde - b.desde)
      .map((o) => ({ ...o, earliest: new Date(o.desde), end: new Date(o.hasta) }));
    const vol = g.reduce((a, c) => a + c.hLProducto, 0);
    return {
      mostoId,
      nombre: m.nombre,
      volumenEnvasar: vol,
      volumenCocinar: vol / factor,
      numCocimientos: g.length,
      volumenPorCocimientoOverride: null,
      starts: g.map((_, j) => new Date(r.min + j * gap)),
      fechaEnvasadoMinima: new Date(g[0].need),
      fechaEnvasadoPrimera: new Date(g[0].need),
      fechaEnvasadoFin: new Date(Math.max(...g.map((c) => c.needEnd))),
      codigo: marcas[0] ? marcas[0].codigo : "",
      tren: marcas[0] ? marcas[0].train : "",
      marcas,
      inventarioUsadoHL: 0,
      asignacionesInventario: [],
      cubiertoTotalPorInventario: false,
      cocimientos: g,
    };
  });
}

function computeCocinaPlan(brands, catalog, inventoryBatches) {
  const sinHomologar = [];
  const results = [];

  // Balance Semanal: copia consumible del inventario por mosto, POR LOTE, cada
  // uno con la fecha en la que de verdad estará listo (inventoryBatchesByMosto:
  // BBT ya listo, FV/SV según lo que les falte de fermentación/maduración). Se
  // va descontando en el orden en que aparecen los bloques del plan de
  // envasado, así que el inventario cubre primero el bloque más próximo de esa
  // marca. Cuenta TODO el inventario como disponible, aunque todavía no esté
  // listo para envasar: estará listo pronto y se puede usar.
  const remainingBatches = {};
  // Lo que cubre el inventario y lo que ya no alcanza ningún cocimiento nuevo,
  // tramo por tramo de envasado (para la trazabilidad y los avisos).
  const cubiertoPorInvTramos = [];
  const noAlcanzable = [];
  const i0Plan = typeof getI0Date === "function" ? getI0Date() : null;
  const i0PlanMs = i0Plan && !isNaN(i0Plan) ? i0Plan.getTime() : null;
  Object.keys(inventoryBatches || {}).forEach((mostoId) => {
    remainingBatches[mostoId] = (inventoryBatches[mostoId] || []).map(
      (lote) => ({
        hL: lote.hL,
        listoEn: lote.listoEn,
        variante: lote.variante || null,
        esBBT: !!lote.esBBT,
        marcaTexto: lote.marcaTexto || "",
        equipo: lote.equipo || "",
      }),
    );
  });
  // TODO el inventario cuenta como DISPONIBLE, esté o no listo ya para envasar:
  // un FV que aún fermenta o un SV que aún madura igual va a estar listo pronto
  // y se puede usar. No se descarta un lote por su fecha de disponibilidad; los
  // lotes se toman en orden de disponibilidad (los que ya están listos primero).
  //
  // Un lote de BBT es producto TERMINADO de una marca concreta: solo se puede
  // asignar a la línea que envasa ESA marca (el BBT de Costeñita no cubre un
  // envasado de Poker aunque los dos sean Mosto Estandar). Los FV/SV todavía no
  // tienen marca definida y cubren cualquier envasado de su mosto.
  function tomarDeInventario(mostoId, necesario, nombreEnvasado, asignaciones) {
    const lotes = remainingBatches[mostoId];
    if (!lotes || necesario <= 1e-9) return 0;
    let tomado = 0;
    for (const lote of lotes) {
      if (tomado >= necesario - 1e-9) break;
      if (lote.hL <= 1e-9) continue;
      if (
        lote.esBBT &&
        !marcaBBTSirvePara(lote.marcaTexto, nombreEnvasado, mostoId)
      )
        continue;
      const take = Math.min(lote.hL, necesario - tomado);
      lote.hL -= take;
      tomado += take;
      if (asignaciones && take > 1e-9)
        asignaciones.push({
          equipo: lote.equipo,
          tipo: lote.esBBT ? "BBT" : "FV/SV",
          marcaLote: lote.marcaTexto,
          marcaEnvasado: nombreEnvasado,
          hL: take,
        });
    }
    return tomado;
  }

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

    // El inventario disponible se descuenta del volumen que hay que COCINAR, no
    // del volumen a envasar: el compromiso de envasado no cambia, solo cuánto de
    // eso sale de un cocimiento nuevo vs. de lo que ya está en inventario.
    // Se descuenta MARCA POR MARCA (no en bloque): un bloque puede juntar varios
    // SKU del mismo mosto, y un BBT terminado de Costeñita solo puede asignarse
    // a la línea que envasa Costeñita.
    const asignacionesInv = [];
    const eventos =
      Array.isArray(b.marcas) && b.marcas.length
        ? b.marcas
        : [{ name: b.name, volumen: volumenEnvasar }];
    let cubiertoPorInventario = 0;
    const pendientes = [];
    // HASTA DÓNDE ALCANZA EL INVENTARIO. Las corridas del bloque se cubren en
    // orden cronológico, así que si el inventario tapa las primeras, el
    // cocimiento no hace falta para ESAS sino para la primera que queda
    // descubierta. Esa es la fecha contra la que se calcula el inicio y la que
    // decide si el bloque llega tarde. Sin esto un bloque salía en rojo por una
    // corrida que el inventario ya tenía cubierta.
    let primeraDescubierta = null;
    eventos.forEach((ev) => {
      const vol = Number(ev.volumen) || 0;
      if (!(vol > 0)) return;
      const tomado = tomarDeInventario(
        mostoId,
        vol,
        ev.name || b.name,
        asignacionesInv,
      );
      cubiertoPorInventario += tomado;
      // Lo que esta corrida deja sin cubrir, con el tramo de tiempo en que se
      // envasa (si el inventario cubrió el comienzo, lo pendiente arranca
      // cuando se acaba lo cubierto). Con esto se arma la demanda en el tiempo.
      {
        const ini = ev.earliest ? ev.earliest.getTime() : b.earliest ? b.earliest.getTime() : null;
        if (ini != null) {
          let fin = ev.end ? ev.end.getTime() : null;
          if (!(fin > ini)) fin = ini + 3600000;
          const corte = ini + (fin - ini) * (tomado / vol);
          const base = { name: ev.name || b.name, codigo: ev.codigo || b.codigo, train: ev.train || b.train, mostoId };
          if (tomado > 1e-9) cubiertoPorInvTramos.push({ ...base, hL: tomado, desde: ini, hasta: corte });
          if (vol - tomado > 1e-9) {
            // RESPETAR EL TIEMPO DE PROCESO (12–14 días en cerveza). Lo que se
            // envasa antes de «I0 + cocina + fermentación + maduración» ya no lo
            // alcanza ningún cocimiento nuevo: tiene que salir de lo que ya está
            // en proceso. Antes se cocinaba igual, tarde, y la trazabilidad
            // quedaba al revés (cocinando después de envasar). Ahora se separa
            // como «no alcanzable» y se avisa.
            const procMs =
              ((Number(m.tiempoCocinaHoras) || 0) + (Number(m.tiempoFermentacionHoras) || 0) + (Number(m.tiempoMaduracionHoras) || 0)) * 3600000;
            const limite = i0PlanMs != null ? i0PlanMs + procMs : -Infinity;
            const rate = (vol - tomado) / Math.max(1, fin - corte);
            if (limite > corte) {
              const z = Math.min(fin, limite);
              noAlcanzable.push({ ...base, hL: rate * (z - corte), desde: corte, hasta: z, listoDesde: limite });
            }
            const desde = Math.max(corte, limite);
            if (fin > desde)
              pendientes.push({ ...base, hL: rate * (fin - desde), desde, hasta: fin });
          }
        }
      }
      if (primeraDescubierta == null && tomado < vol - 1e-9 && ev.earliest) {
        // Si la corrida quedó cubierta a medias, el mosto nuevo se necesita
        // cuando se acabe lo cubierto, no al empezar la corrida.
        const ini = ev.earliest.getTime();
        const fin = ev.end ? ev.end.getTime() : null;
        const frac = tomado / vol;
        primeraDescubierta = new Date(
          fin && fin > ini ? ini + (fin - ini) * frac : ini,
        );
      }
    });
    // Si el inventario cubre TODO el bloque no hay fecha de necesidad; y si no
    // se llegó a tocar ninguna corrida, manda la primera del bloque.
    const fechaNecesidad = primeraDescubierta || b.earliest;
    const volumenEnvasarPendiente = volumenEnvasar - cubiertoPorInventario;

    // El número de cocimientos lo fija SOLO el volumen, con la fórmula:
    //   numCocimientos = ceil( loQueHayQueCocinar / (factorDilución · volumenPorCocimiento) )
    // donde "loQueHayQueCocinar" = volumen a envasar que NO cubre el inventario
    // (volumenEnvasarPendiente). Un cocimiento rinde factorDilución · volXCoc hL
    // de producto terminado (p.ej. Pony: 3,23 · 600 = 1.938 hL).
    // No se infla: el "mínimo 2 / máximo 4" de Pony NO crea cocimientos que no
    // existen — es una regla de SECUENCIA (corridas de 2 a 5 cocimientos
    // SEGUIDOS) que se aplica al ordenar la semana en sequenceWeek.
    const volXCoc = Number(m.volumenPorCocimiento) || 1;
    const rendimientoPorCocimiento = factor * volXCoc; // hL de producto por cocimiento
    const numCocimientos =
      volumenEnvasarPendiente > 1e-9
        ? Math.max(
            1,
            Math.ceil(volumenEnvasarPendiente / rendimientoPorCocimiento),
          )
        : 0;
    // "Volumen a cocinar" en hL de mosto concentrado (lo que de verdad entra a
    // la olla): pendiente / factor.
    const volumenCocinar = volumenEnvasarPendiente / factor;

    let starts = [];
    if (fechaNecesidad && numCocimientos > 0) {
      starts = computeCocimientoStarts(fechaNecesidad, numCocimientos, m);
    }

    results.push({
      mostoId,
      nombre: m.nombre,
      volumenEnvasar,
      volumenCocinar,
      numCocimientos,
      volumenPorCocimientoOverride: null,
      starts,
      // Fecha contra la que se programa: la primera corrida del bloque que el
      // inventario NO alcanza a cubrir, no la primera del bloque.
      fechaEnvasadoMinima: fechaNecesidad,
      // Primera corrida del bloque, cubierta o no. Sirve para explicar en la
      // interfaz desde cuándo se envasa esta marca.
      fechaEnvasadoPrimera: b.earliest,
      fechaEnvasadoFin: b.end || null,
      codigo: b.codigo,
      tren: b.train,
      sequenceOrder: Number.isFinite(b.sequenceOrder)
        ? b.sequenceOrder
        : blockIndex,
      blockLabel: b.blockLabel || `${m.nombre} · bloque ${blockIndex + 1}`,
      marcas: [b],
      inventarioUsadoHL: cubiertoPorInventario,
      // Qué tanque cubrió qué marca del plan (para poder auditarlo).
      asignacionesInventario: asignacionesInv,
      cubiertoTotalPorInventario:
        numCocimientos === 0 && cubiertoPorInventario > 0,
      pendientes,
    });
  });

  // --- DEMANDA EN EL TIEMPO → COCIMIENTOS → CAMPAÑAS -------------------------
  // Antes cada «bloque» juntaba TODA la demanda de un mosto que solo venía
  // separada por otro mosto. En la corriente de Pony no hay otro mosto, así que
  // TODA la Pony del horizonte (tres semanas, por ejemplo) quedaba en un solo
  // bloque con la fecha del PRIMER envasado de Pony: se cocinaba todo de una vez,
  // días o semanas antes de lo que se iba a envasar. Encima, los bloques cortos
  // se fusionaban conservando la fecha del bloque destino, y la cerveza que se
  // envasaba el lunes podía quedar con fecha límite del jueves siguiente.
  // Ahora la demanda de cada mosto es una curva acumulada en el tiempo (lo que
  // falta por envasar después del inventario). El cocimiento n.º k se necesita
  // cuando esa curva pasa de (k−1) rendimientos: desde ahí se descuentan
  // maduración, fermentación y cocina para sacar SU cargue a más tardar. Y se
  // sabe a qué línea, SKU y horas va cada uno (trazabilidad).
  const cocPorMosto = {};
  results.forEach((r) =>
    (r.pendientes || []).forEach((pz) =>
      (cocPorMosto[r.mostoId] = cocPorMosto[r.mostoId] || []).push(pz),
    ),
  );
  const campanas = [];
  Object.keys(cocPorMosto).forEach((mostoId) => {
    const m = catalog.find((x) => x.id === mostoId) || {};
    const cocs = cocimientosDeDemanda(cocPorMosto[mostoId], m);
    agruparEnCampanas(cocs, m, mostoId).forEach((c) => campanas.push(c));
  });
  campanas.sort((a, b) => a.fechaEnvasadoMinima - b.fechaEnvasadoMinima);
  const cuenta = {};
  campanas.forEach((c, i) => {
    cuenta[c.mostoId] = (cuenta[c.mostoId] || 0) + 1;
    const lineas = [...new Set(c.marcas.map((x) => `L${x.train}`))].join(", ");
    const skus = [...new Set(c.marcas.map((x) => x.name))];
    c.sequenceOrder = i;
    c.blockLabel = `${c.nombre} · campaña ${cuenta[c.mostoId]} (${lineas}${skus.length ? " · " + skus.slice(0, 3).join(" + ") + (skus.length > 3 ? " …" : "") : ""})`;
  });
  // Lo que cubre el inventario sigue saliendo por marca, sin cocimientos, para
  // que las sumas (a envasar = inventario + a cocinar) cuadren en las tablas.
  const filasInventario = results
    .filter((r) => r.inventarioUsadoHL > 1e-9)
    .map((r) => ({
      ...r,
      volumenEnvasar: r.inventarioUsadoHL,
      volumenCocinar: 0,
      numCocimientos: 0,
      starts: [],
      cubiertoTotalPorInventario: true,
      blockLabel: `${r.blockLabel} — parte cubierta por inventario`,
      cocimientos: [],
    }));
  // Lo que ya no alcanza ningún cocimiento nuevo (antes de I0 + proceso), por
  // mosto, para que el volumen a envasar cuadre y se vea qué falta.
  const noAlcPorMosto = {};
  noAlcanzable.forEach((x) => {
    const o = (noAlcPorMosto[x.mostoId] = noAlcPorMosto[x.mostoId] || { hL: 0, desde: x.desde, hasta: x.hasta, listoDesde: x.listoDesde, marcas: [] });
    o.hL += x.hL;
    o.desde = Math.min(o.desde, x.desde);
    o.hasta = Math.max(o.hasta, x.hasta);
    o.marcas.push(x);
  });
  const filasNoAlc = Object.keys(noAlcPorMosto)
    .filter((k) => noAlcPorMosto[k].hL > 1)
    .map((k) => {
      const m = catalog.find((x) => x.id === k) || {};
      const o = noAlcPorMosto[k];
      return {
        mostoId: k,
        nombre: m.nombre,
        volumenEnvasar: o.hL,
        volumenCocinar: 0,
        numCocimientos: 0,
        starts: [],
        fechaEnvasadoMinima: new Date(o.desde),
        fechaEnvasadoPrimera: new Date(o.desde),
        fechaEnvasadoFin: new Date(o.hasta),
        marcas: o.marcas.map((x) => ({ ...x, earliest: new Date(x.desde), end: new Date(x.hasta), volumen: x.hL })),
        inventarioUsadoHL: 0,
        asignacionesInventario: [],
        cubiertoTotalPorInventario: false,
        noAlcanzable: true,
        listoDesde: new Date(o.listoDesde),
        blockLabel: `${m.nombre} — no alcanzable desde el I0 (se envasa antes del ${fmtDateTime(new Date(o.listoDesde))})`,
        cocimientos: [],
      };
    });
  results.length = 0;
  campanas.forEach((c) => results.push(c));
  filasInventario.forEach((r) => results.push(r));
  filasNoAlc.forEach((r) => results.push(r));

  // Lo que sobró de cada lote (no se usó porque no había demanda a tiempo para
  // consumirlo, o porque estará listo después de la última fecha cargada) —
  // se expone para poder explicar el "inventario sobrante" del Balance: no es
  // que "no cuadre", es que ese HL no alcanza a estar listo para ninguno de
  // los envasados que sí se cargaron.
  return { results, sinHomologar, remainingInventoryBatches: remainingBatches, noAlcanzable, cubiertoPorInvTramos };
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
      "Iniciar la producción semanal y los arranques después de paradas de cocina con mostos de cerveza, no con malta (acuerdo SLA Planta n.º 1).",
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
// Reglas fijas de aseo de cambio de marca (no dependen de la matriz):
//   · misma marca → sin aseo.
//   · saliendo de Pony → sin aseo hacia CUALQUIER cerveza (Estandar, Pilsen o
//     Light): la Pony sale directa.
//   · entrando a una cerveza normal (Estandar / Pilsen) → sin aseo. Esto cubre
//     Estandar ↔ Pilsen y Light → cerveza.
// SOLO hay aseo cuando se ENTRA a Light o se ENTRA a Pony desde otra cerveza.
// La duración sale de la matriz (Estandar→Light, Pilsen→Light, Estandar→Pony,
// Pilsen→Pony, Light→Pony) o, si no está definida, del valor por defecto.
function getAseoDuracion(fromMostoId, toMostoId, resolvedMatrix, defaultHoras) {
  const SIN_ASEO = { horas: 0, definido: true, sinAseo: true };
  if (fromMostoId && toMostoId && fromMostoId === toMostoId) return SIN_ASEO;
  if (esMostoPony(fromMostoId)) return SIN_ASEO;
  if (toMostoId !== "light" && !esMostoPony(toMostoId)) return SIN_ASEO;
  // Se busca la combinación en la matriz y, si no está, la inversa.
  let m = resolvedMatrix.find(
    (a) => a.origenId === fromMostoId && a.destinoId === toMostoId,
  );
  if (!m)
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
  // Cocimientos que admite cada equipo, por capacidad. Son números de planta y
  // van por capacidad EXACTA, no por rangos: antes se resolvía con umbrales
  // (>= 850 → 1,5) y eso se tragaba capacidades que no estaban en la lista. Los
  // toneles de Pony, de 860 hL, caían en la regla de las cubas de 900 y salían
  // con 1,5 en vez de 1,33; y el EXT 7, un madurador de 3.200 hL, quedaba topado
  // en 1,5 cocimientos —900 hL— cuando le caben más de cinco.
  const COCIMIENTOS_POR_CAPACIDAD = {
    7200: 12, // tanques grandes
    4800: 8, // tanques pequeños
    900: 1.5, // cubas grandes
    860: 1.33, // toneles de Pony
    750: 1.25, // cubas pequeñas
  };
  // Cocimiento de referencia para las capacidades que no están en la lista: se
  // llenan hasta la capacidad que tengan cargada en el catálogo de equipos.
  const HL_POR_COCIMIENTO_REF = 600;
  function getMaxCocimientosPorCapacidad(capacidadHL) {
    const capacidad = Number(capacidadHL) || 0;
    if (COCIMIENTOS_POR_CAPACIDAD[capacidad] != null)
      return COCIMIENTOS_POR_CAPACIDAD[capacidad];
    return capacidad > 0 ? capacidad / HL_POR_COCIMIENTO_REF : 1;
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
      // Se guardan también los hL que trae el inventario: es lo que el equipo
      // tiene dentro y hay que poder mostrarlo en la banda del Gantt.
      t.preocupado = {
        mostoId: o.mostoId,
        hasta: o.fecha,
        hL: Number(o.hL) || 0,
      };
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
  // Pony GO y Pony (HG) comparten los SV Pony (ningún otro mosto entra ahí),
  // pero no comparten TANQUE: un SV ya abierto con GO no admite HG y al revés,
  // porque son productos distintos (ver el filtro por t.mostoId más abajo).
  const isPony = (id) => esMostoPony(id);
  const isFV = (t) => t.tipo === "FV";
  const isSV = (t) => t.tipo === "SV" || t.tipo === "SV Pony";
  const canFV = (t, mostoId) =>
    t.disponible && isFV(t) && t.capacidadHL > 0 && !isPony(mostoId);
  const canSV = (t, mostoId) =>
    t.disponible &&
    isSV(t) &&
    t.capacidadHL > 0 &&
    (t.tipo !== "SV Pony" ? !isPony(mostoId) : isPony(mostoId));

  // ELEGIR EL EQUIPO SEGÚN LO QUE FALTA POR METER.
  //   1. Primero el que ya está abierto con este mismo mosto: se termina de
  //      llenar lo empezado antes de destapar otro.
  //   2. Si lo que queda por meter es UN RESTO —menos de un cocimiento
  //      completo— se busca el equipo MÁS PEQUEÑO en el que quepa entero. No
  //      vale la pena destapar un tanque de 7.200 hL para 300 hL sueltos: queda
  //      comprometido con esa marca y bloqueado para lo que venga.
  //   3. Para un volumen normal manda la prioridad A → B → C del catálogo y,
  //      dentro de ella, el equipo más chico que sirva. Así los cocimientos
  //      completos se van acumulando en los tanques grandes de prioridad A, que
  //      es como se llenan.
  // El orden aplica solo al RESTO y no a todo: aplicándolo siempre, cada
  // cocimiento se iba a la cuba más pequeña que lo aguantara y el plan se
  // desperdigaba entre 39 equipos en vez de 27.
  const ORDEN_PRIORIDAD = { A: 0, B: 1, C: 2 };
  // Fracción mínima que un volumen tiene que llenar de un equipo VACÍO para que
  // valga la pena destaparlo. Por debajo de eso se prefiere uno más chico donde
  // quepa: destapar un tanque grande lo compromete con esa marca hasta que se
  // vacíe, así que dejarlo al 9 % sale caro.
  // Solo se mira en MADURACIÓN. Al fermentador los cocimientos entran de a uno
  // y se van acumulando, así que al destapar un EXT de 7.200 solo hay 600 hL a
  // la vista y ningún cocimiento suelto justificaría abrirlo nunca: los grandes
  // no se usarían jamás. Al madurador, en cambio, el lote llega entero y ya no
  // crece, así que ahí sí se puede juzgar si aprovecha el equipo.
  const UMBRAL_APROVECHAMIENTO = 1 / 3;
  function ordenarPorAjuste(mostoId, restante, volPorCoc, loteCompleto) {
    const esResto = restante < (Number(volPorCoc) || 600) - 1e-9;
    const cabeEn = (t) => {
      const libre = t.capacidadHL - t.volumenAsignado;
      const cupo =
        ((Number(t.maxCocimientos) || 999) - t.cocimientosAsignados) *
        volPorCoc;
      return Math.max(0, Math.min(libre, cupo));
    };
    return (a, b) => {
      const abiertoA = a.mostoId === mostoId ? 0 : 1;
      const abiertoB = b.mostoId === mostoId ? 0 : 1;
      if (abiertoA !== abiertoB) return abiertoA - abiertoB;
      if (esResto) {
        // El resto busca el equipo más pequeño donde quepa entero; y si no cabe
        // en ninguno, se sigue repartiendo entre los chicos, de menor a mayor.
        // Un pequeño se completa con otros pequeños, no cayendo en un grande.
        const todoA = cabeEn(a) >= restante - 1e-9 ? 0 : 1;
        const todoB = cabeEn(b) >= restante - 1e-9 ? 0 : 1;
        if (todoA !== todoB) return todoA - todoB;
        if (a.capacidadHL !== b.capacidadHL)
          return a.capacidadHL - b.capacidadHL;
        return a.idx - b.idx;
      }
      // Volumen normal: manda la prioridad del catálogo y, dentro de ella, el
      // equipo MÁS GRANDE. Así los cocimientos completos se van acumulando en
      // pocos tanques hasta llenarlos, en vez de dejar media docena de grandes
      // a un cuarto de su capacidad. Antes se ordenaba de menor a mayor y se
      // empezaba siempre por el EXT de 4.800, dejando los de 7.200 y 8.500 casi
      // vacíos.
      // PERO no se destapa un equipo grande para algo que no lo aprovecha: un
      // lote de 750 hL abriendo un madurador de 8.500 lo deja al 9 % y
      // comprometido con esa marca. Si el volumen no llena al menos un tercio
      // del equipo VACÍO y hay uno más chico donde quepa, va al chico.
      const aprovecha = (t) => {
        if (t.volumenAsignado > 1e-9) return 1; // ya abierto: no es destaparlo
        const cabe = Math.min(restante, cabeEn(t));
        return t.capacidadHL > 0 ? cabe / t.capacidadHL : 1;
      };
      if (loteCompleto) {
        const desaprovechaA = aprovecha(a) < UMBRAL_APROVECHAMIENTO ? 1 : 0;
        const desaprovechaB = aprovecha(b) < UMBRAL_APROVECHAMIENTO ? 1 : 0;
        if (desaprovechaA !== desaprovechaB)
          return desaprovechaA - desaprovechaB;
      }
      return (
        ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] ||
        b.capacidadHL - a.capacidadHL ||
        a.idx - b.idx
      );
    };
  }

  // Un FV no se queda abierto días esperando la siguiente corrida de su marca:
  // si pasan más de FV_MAX_ESPERA_LLENADO_HORAS sin que le entre mosto, se
  // cierra con lo que tenga y empieza a fermentar. Antes se quedaba abierto
  // hasta llenarse, y el primer cocimiento de una Pilsen del lunes podía quedar
  // esperando a otro de la semana siguiente: llegaba al envasado días tarde.
  // También se cierra si meterle ESTE cocimiento atrasaría a los que ya tiene:
  // el lote fermenta desde el último llenado, así que si el nuevo cocimiento
  // deja el lote listo después del envasado del primero, ese FV se cierra ya y
  // el nuevo va a otro equipo.
  function cerrarLotesViejos(ahora, r, fermH, madH) {
    if (!ahora) return;
    tanks.forEach((t) => {
      const lote = t.__loteFV;
      if (!lote || lote.transferida || t.loteCerrado || !(t.volumenAsignado > 1e-9)) return;
      if (lote.ultimoLlenado == null) return;
      const viejo = ahora.getTime() - lote.ultimoLlenado > FV_MAX_ESPERA_LLENADO_HORAS * 3600000;
      // Solo si HOY el lote llega a tiempo y con este cocimiento dejaría de
      // llegar. Un lote que ya va tarde no se cierra por eso: cerrarlo no lo
      // adelanta y dejaba cada FV con un solo cocimiento (se acababan los FV).
      const listoHoy = lote.fermentEnd ? lote.fermentEnd.getTime() + (madH || 0) * 3600000 : null;
      const listoCon = r ? r.end.getTime() + ((fermH || 0) + (madH || 0)) * 3600000 : null;
      const atrasaria =
        r &&
        lote.mostoId === r.mostoId &&
        lote.necesidadMin != null &&
        listoHoy != null &&
        listoHoy <= lote.necesidadMin + 60000 &&
        listoCon > lote.necesidadMin + 60000;
      if (!viejo && !atrasaria) return;
      t.releaseTime = lote.fermentEnd;
      t.loteCerrado = true;
      transferencias.push({
        fecha: lote.fermentEnd,
        mostoId: lote.mostoId,
        nombre: lote.nombre,
        volumenHL: lote.volumenHL,
        origen: t,
        cocimientoNumero: lote.cocimientoNumero,
        fermentEnd: lote.fermentEnd,
        maduracionHoras: lote.maduracionHoras,
        parcial: true,
      });
      lote.transferida = true;
    });
  }

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

  // ¿Cuándo se libera el primer equipo capaz de recibir esto? Solo cuenta el
  // almacenamiento que de verdad sirve para este mosto y esta etapa: un SV no
  // vale para fermentar, un SV normal no recibe Pony, y un BBT no madura. De los
  // que sirven, se toma el que antes queda vacío, sumándole su aseo de
  // reutilización. Devuelve null si no hay NINGÚN equipo que pueda recibirlo
  // (entonces no es que falte espacio: es que no existe el equipo).
  function proximoEspacioLibre(puedeUsar, mostoId, ahora) {
    const desde = ahora ? ahora.getTime() : Date.now();
    let mejor = null;
    tanks.forEach((t) => {
      if (!puedeUsar(t, mostoId)) return;
      // Fecha de salida del equipo. Si ya se liberó, vale la última que tuvo:
      // sigue sin poder recibir hasta que pase su aseo de reutilización. Uno que
      // sigue abierto llenándose con otro mosto no tiene fecha todavía, y de ese
      // no se puede prometer nada.
      const salida = t.releaseTime || t.ultimoReleaseTime;
      if (!salida) return;
      const listo = salida.getTime() + limpiezaNecesaria(t, mostoId) * 3600000;
      if (listo >= desde && (mejor == null || listo < mejor)) mejor = listo;
    });
    return mejor == null ? null : new Date(mejor);
  }

  // Texto para el plan de cocinas: cuánto falta y desde cuándo habrá dónde
  // ponerlo. Es la respuesta a "no hay espacio, ¿y cuándo lo habrá?".
  function motivoSinEspacio(restante, etapa, puedeUsar, mostoId, ahora) {
    const hl = restante.toLocaleString("es-CO", { maximumFractionDigits: 1 });
    const libre = proximoEspacioLibre(puedeUsar, mostoId, ahora);
    const hayAlguno = tanks.some((t) => puedeUsar(t, mostoId));
    if (!hayAlguno)
      return `No hay ningún equipo habilitado para ${etapa} este mosto. Faltan ${hl} HL.`;
    if (!libre)
      return `No hay espacio para ${etapa}: faltan ${hl} HL y ningún equipo tiene fecha de salida dentro del horizonte cargado.`;
    const tarde = ahora && libre.getTime() - ahora.getTime() > 3650 * 86400000;
    return tarde
      ? `No hay espacio para ${etapa}: faltan ${hl} HL y ningún equipo se libera dentro del horizonte cargado (hay maduradores ocupados con levadura, sin fecha de salida).`
      : `No hay espacio para ${etapa}: faltan ${hl} HL. El primer equipo se libera el ${fmtDateTime(libre)}.`;
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
    if (esMostoPony(r.mostoId)) return;
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

    cerrarLotesViejos(r.start, r, fermentHoras, Number(m && m.tiempoMaduracionHoras) || 0);
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
        .sort(ordenarPorAjuste(r.mostoId, restante, volPorCoc));
      const tank = candidatos[0];
      if (!tank) break;
      // NUNCA por encima de la capacidad. Se carga lo que de verdad cabe: lo que
      // queda del cocimiento, el hueco que tenga el tanque, y el cupo de
      // cocimientos que le queda, lo que sea menor. El resto se sigue repartiendo
      // en la siguiente vuelta.
      // Un cocimiento SÍ se puede repartir entre dos tanques: es la única forma
      // de llenar por completo una cuba de 900 hL, que admite 1,5 cocimientos de
      // 600 hL. Antes se validaba contra lo que cabía pero se cargaba el
      // cocimiento entero, y una cuba de 900 terminaba con 1.200 hL dentro.
      const libreTank = tank.capacidadHL - tank.volumenAsignado;
      const cupoCoc =
        (Number(tank.maxCocimientos) || 999) - tank.cocimientosAsignados;
      const carga = Math.min(restante, libreTank, cupoCoc * volPorCoc);
      if (!(carga > 1e-9)) break;
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
        espacioDesde: proximoEspacioLibre(canFV, r.mostoId, r.start),
        motivo:
          motivoSinEspacio(restante, "fermentar", canFV, r.mostoId, r.start) +
          " Los SV son solo de maduración y los BBT solo de producto terminado.",
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
        // El FV queda ocupado desde que entra el mosto —o sea al TERMINAR el
        // cocimiento— hasta que acaba la fermentación, no lo que dura la
        // cocina. Con `...r` se heredaban el inicio y el fin del cocimiento
        // (unas 8:55 h) y el equipo aparecía libre al día siguiente, cuando en
        // realidad está ocupado 204 h. Las horas del cocimiento se conservan
        // aparte para la tabla de asignación.
        cocimientoStart: r.start,
        cocimientoEnd: r.end,
        start: new Date(r.end.getTime()),
        end: new Date(a.fermentEnd.getTime()),
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
      t.__loteFV.ultimoLlenado = r.end.getTime();
      if (r.necesidad)
        t.__loteFV.necesidadMin = Math.min(
          t.__loteFV.necesidadMin == null ? Infinity : t.__loteFV.necesidadMin,
          r.necesidad.getTime(),
        );
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
    if (!esMostoPony(r.mostoId)) return;
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
        .sort(ordenarPorAjuste(tr.mostoId, restante, volPorCoc, true));
      const tank = candidatos[0];
      if (!tank) break;
      // NUNCA por encima de la capacidad, igual que en el FV. Un lote que sale de
      // un fermentador grande no cabe en un madurador chico: se reparte entre los
      // que haga falta. Antes entraba entero, y un tonel de 820 hL llegaba a
      // tener 5.376 hL asignados.
      const libreTank = tank.capacidadHL - tank.volumenAsignado;
      const cupoCoc =
        (Number(tank.maxCocimientos) || 999) - tank.cocimientosAsignados;
      const carga = Math.min(restante, libreTank, cupoCoc * volPorCoc);
      if (!(carga > 1e-9)) break;
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
        espacioDesde: proximoEspacioLibre(canSV, tr.mostoId, tr.fecha),
        motivo:
          motivoSinEspacio(restante, "madurar", canSV, tr.mostoId, tr.fecha) +
          " Los BBT no se utilizan para maduración.",
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
  // ---------------------------------------------------------------------------
  // PROGRAMACION SEMANAL  (construida desde cero, reglas 1-5)
  //   R1  Inicio ideal de cada cocimiento = envasado - cocina - fermentacion -
  //       maduracion. Ese es su inicio objetivo; ya viene calculado en
  //       computeCocinaPlan (block.idealStarts).
  //   R2  Lo que cubre el inventario disponible (BBT + FV + SV, en orden de
  //       envasado) NO se cocina; eso tambien lo resuelve computeCocinaPlan.
  //   R3  Un bloque Light solo se programa si hay levadura Light disponible; si
  //       la levadura llega mas tarde, el bloque se corre hasta esa fecha.
  //   R4  Pony se cuece en corridas de 2 a 5 cocimientos; una corrida termina
  //       cuando empieza otra marca (nunca dos corridas de Pony seguidas).
  //   R5  El cronograma es una linea de tiempo continua: los bloques se
  //       ordenan por su inicio ideal y se colocan uno tras otro; cada bloque
  //       arranca cuando la cocina queda libre, nunca antes de su inicio ideal
  //       ni antes de I0. Si tuvo que arrancar despues del ideal, va en rojo.
  // ---------------------------------------------------------------------------
  const catalogById = {};
  (catalog || []).forEach((m) => (catalogById[m.id] = m));
  const HORA = 3600000;
  const DIA = 86400000;
  // "No te alejes tanto": la cerveza normal (Estándar / Pilsen) no se cuece más
  // de 7 días antes de su inicio ideal. Así no se adelanta a fin de mes dejando
  // un hueco largo hasta que arranca Pony; el tiempo muerto queda ANTES del
  // cronograma. Pony tiene su propio tope (máx. en BBT) y Light lo controla
  // la disponibilidad de levadura (el tope NO aplica a Light: si el usuario
  // registra una levadura Light a mano, el bloque Light debe poder adelantarse).
  // La cerveza casi no se adelanta a su inicio ideal (2 días de holgura para
  // absorber la cocina ocupada). Si se adelanta más, se cuece TODA antes de que
  // se abra la ventana de Pony y luego no queda con qué INTERCALAR: se irían
  // 25 Pony seguidas. Con esta holgura corta, la cerveza cae dentro de la
  // ventana de Pony y sirve de separador.
  const MAX_ADELANTO_CERVEZA = 2 * DIA;
  const aplicaTopeAdelanto = (id) => id === "estandar" || id === "pilsen" || id === "light";
  // Light: 3 días (la levadura manda, pero tampoco se cocina semanas antes;
  // sin este tope, con la apertura desde el I0 se cocinaba toda el primer día).
  const topeAdelantoMs = (id) => (id === "light" ? 3 * DIA : MAX_ADELANTO_CERVEZA);
  // Pony: el máximo REAL en BBT es tiempoMaxBBTHoras (48 h). La programación
  // puede estirarlo hasta 72 h como tope absoluto; entre el máximo y las 72 h el
  // bloque sale en ROJO para que el equipo lo revise. Nunca más de 72 h.
  const PONY_BBT_TOLERANCIA_HORAS = 72;
  const topeBBTHoras = (b) =>
    Math.max(Number(b.maxBBTHoras) || 0, PONY_BBT_TOLERANCIA_HORAS);
  const reglaWarnings = [];
  const capacityWarnings = [];
  // Envasado que ningún cocimiento nuevo alcanza (antes de I0 + proceso).
  ((plan && plan.results) || [])
    .filter((r) => r.noAlcanzable && r.volumenEnvasar > 1)
    .forEach((r) =>
      capacityWarnings.push({
        tipo: "noalcanzable",
        mostoId: r.mostoId,
        nombre: r.nombre,
        blockLabel: r.blockLabel,
        blockStart: r.fechaEnvasadoPrimera,
        blockEnd: r.fechaEnvasadoFin,
        deadline: r.listoDesde,
        retrasoHoras: 0,
        detalle: `${Math.round(r.volumenEnvasar).toLocaleString("es-CO")} hL de ${r.nombre} se envasan entre el ${fmtDateTime(r.fechaEnvasadoPrimera)} y el ${fmtDateTime(r.fechaEnvasadoFin)}, antes de que un cocimiento cargado desde el I0 alcance a estar listo (${fmtDateTime(r.listoDesde)}: cocina + fermentación + maduración). Tienen que salir de producto que ya esté en proceso: revisa el inventario cargado (Producto en proceso) o el I0.`,
      }),
    );
  const yeastEvents = [];

  // --- R3: pool de levadura Light ---
  const yeastPool = (YEAST_AVAILABILITY || [])
    .filter(
      (y) =>
        y.disponible !== false &&
        (y.mostoId || "") === "light" &&
        yeastAvailableDate(y),
    )
    .map((y) => ({
      fechaDisponible: yeastAvailableDate(y),
      origen: y.origen || "Disponibilidad registrada",
      consumida: false,
    }));
  if (typeof computedYeastHarvests === "function") {
    computedYeastHarvests(null).forEach((h) => {
      if (h.mostoId === "light")
        yeastPool.push({
          fechaDisponible: h.fechaDisponible,
          origen: h.fuente || "Cosecha de inventario",
          consumida: false,
        });
    });
  }
  yeastPool.sort((a, b) => a.fechaDisponible - b.fechaDisponible);

  // --- bloques del plan ---
  let blocks = (plan && plan.results ? plan.results : [])
    .filter((r) => Array.isArray(r.starts) && r.starts.length > 0)
    .map((r, i) => {
      const m = catalogById[r.mostoId] || {};
      return {
        blockId: `${r.mostoId}__${i}`,
        sourceIndex: i,
        mostoId: r.mostoId,
        nombre: r.nombre,
        codigo: r.codigo || "",
        tren: r.tren || "",
        blockLabel: r.blockLabel || r.nombre,
        cocinaHoras: Number(m.tiempoCocinaHoras) || 0,
        gapHoras: Number(m.tiempoEntreCarguesHoras) || 0,
        fermentacionHoras: Number(m.tiempoFermentacionHoras) || 0,
        maduracionHoras: Number(m.tiempoMaduracionHoras) || 0,
        maxBBTHoras: Number(m.tiempoMaxBBTHoras) || 0,
        volumenEnvasar: Number(r.volumenEnvasar) || 0,
        volumenCocinar: Number(r.volumenCocinar) || 0,
        volumenPorCocimiento: Number(m.volumenPorCocimiento) || 0,
        numCocimientos: r.starts.length,
        idealStarts: r.starts.map((d) =>
          d instanceof Date ? new Date(d.getTime()) : new Date(d),
        ),
        fechaEnvasado: r.fechaEnvasadoMinima
          ? new Date(r.fechaEnvasadoMinima.getTime())
          : null,
        // Necesidad y cargue a más tardar de CADA cocimiento (demanda en el
        // tiempo, ver cocimientosDeDemanda) y a qué envasado va cada uno.
        cocs: Array.isArray(r.cocimientos) && r.cocimientos.length === r.starts.length ? r.cocimientos : null,
      };
    });
  // Referencia de adelanto de un bloque: el cargue más tardío permitido para el
  // PRIMER cocimiento si se quiere que ninguno quede adelantado más de lo
  // debido (máx. en BBT de la Pony, 2 días de la cerveza). Con la demanda por
  // cocimiento sale de cada uno; sin ella, del inicio ideal del bloque.
  const refAdel = (b) => {
    if (!b.cocs || !b.cocs.length) return b.idealStarts[0].getTime();
    const g = b.gapHoras * HORA;
    return Math.max(...b.cocs.map((c, j) => c.latest - j * g));
  };
  // Piso de BBT de un bloque de Pony: su máximo real (48 h). Las 72 h son solo
  // tolerancia: antes la selección tomaba siempre el borde de las 72 h y TODA la
  // Pony salía 3 días antes de tiempo y en rojo. Las 72 h quedan solo para la
  // corrida que no cabe en 48 h (una Pony suelta juntada con su vecina).
  const pisoBBTHoras = (b) => {
    if (!b.cocs || !b.cocs.length) return topeBBTHoras(b);
    const g = b.gapHoras * HORA;
    const v = b.cocs.map((c, j) => c.latest - j * g);
    const holgura = (Math.max(...v) - Math.min(...v)) / HORA;
    return holgura > b.maxBBTHoras ? topeBBTHoras(b) : b.maxBBTHoras;
  };
  // Al partir un bloque se rehacen sus inicios ideales con sus propios
  // cocimientos (el primero manda: el que menos holgura tiene).
  const rehacerIdeales = (b) => {
    if (!b.cocs || !b.cocs.length) return b;
    const g = b.gapHoras * HORA;
    const min = Math.min(...b.cocs.map((c, j) => c.latest - j * g));
    b.idealStarts = b.cocs.map((_, j) => new Date(min + j * g));
    b.fechaEnvasado = new Date(b.cocs[0].need);
    return b;
  };

  // --- R4: partir Pony en corridas de 2 a 5 cocimientos ---
  const PONY_MAX = 5;
  blocks = blocks.flatMap((b) => {
    if (!esMostoPony(b.mostoId) || b.numCocimientos <= PONY_MAX) return [b];
    const tramos = splitEnTramos(
      b.numCocimientos,
      PONY_MAX,
      PONY_MIN_COCIMIENTOS,
    );
    let off = 0;
    return tramos.map((size, k) => {
      const share = size / b.numCocimientos;
      const slice = b.idealStarts.slice(off, off + size);
      off += size;
      return rehacerIdeales({
        ...b,
        blockId: `${b.blockId}__t${k}`,
        blockLabel: `${b.blockLabel} (corrida ${k + 1}/${tramos.length})`,
        numCocimientos: size,
        volumenEnvasar: b.volumenEnvasar * share,
        volumenCocinar: b.volumenCocinar * share,
        idealStarts: slice,
        cocs: b.cocs ? b.cocs.slice(off - size, off) : null,
      });
    });
  });

  // --- Separadores: NUNCA más de 5 Pony seguidas -----------------------------
  // Entre dos corridas de Pony tiene que ir SIEMPRE otra marca (aunque medien
  // días). El patrón real es: corrida LARGA de cerveza → aseo → 2-5 Pony →
  // corrida larga de cerveza → aseo → 2-5 Pony … La cerveza NO se pica en
  // trocitos: solo se parte cuando de verdad faltan separadores, y nunca en
  // trozos de menos de MIN_CORRIDA_CERVEZA cocimientos.
  // Parte un bloque en dos: los primeros `size` cocimientos y el resto. Se usa
  // para cortar una corrida de cerveza justo donde toca el aseo periódico, y
  // dejar el resto pendiente para después de la Pony que entra con ese aseo.
  const partirBloqueEn = (b, size) => {
    if (!(size > 0) || size >= b.numCocimientos) return [b, null];
    const trozo = (desde, cant, k) =>
      rehacerIdeales({
        ...b,
        blockId: `${b.blockId}__p${k}`,
        blockLabel: `${b.blockLabel} (parte ${k + 1})`,
        numCocimientos: cant,
        volumenEnvasar: (b.volumenEnvasar * cant) / b.numCocimientos,
        volumenCocinar: (b.volumenCocinar * cant) / b.numCocimientos,
        idealStarts: b.idealStarts.slice(desde, desde + cant),
        cocs: b.cocs ? b.cocs.slice(desde, desde + cant) : null,
      });
    return [trozo(0, size, 0), trozo(size, b.numCocimientos - size, 1)];
  };

  // Cuando ni partiendo por 14 alcanzan los separadores, se baja el piso a este
  // otro y se avisa: es preferible una corrida de cerveza más corta de lo
  // deseado que una racha de 12 Pony seguidas, que sí está prohibida.
  const MIN_CORRIDA_CERVEZA_FORZADO = 5;
  const corridasCortasForzadas = [];
  {
    const partirBloque = (b, partes, minimo) => {
      const tam = splitEnTramos(
        b.numCocimientos,
        Math.ceil(b.numCocimientos / partes),
        minimo,
      );
      let off = 0;
      return tam.map((size, k) => {
        const share = size / b.numCocimientos;
        const slice = b.idealStarts.slice(off, off + size);
        off += size;
        return rehacerIdeales({
          ...b,
          blockId: `${b.blockId}__c${k}`,
          blockLabel: `${b.blockLabel} (parte ${k + 1}/${tam.length})`,
          numCocimientos: size,
          volumenEnvasar: b.volumenEnvasar * share,
          volumenCocinar: b.volumenCocinar * share,
          idealStarts: slice,
          cocs: b.cocs ? b.cocs.slice(off - size, off) : null,
        });
      });
    };
    let guard = 0;
    while (guard++ < 20) {
      const nPony = blocks.filter((b) => esMostoPony(b.mostoId)).length;
      const noPony = blocks.filter((b) => !esMostoPony(b.mostoId));
      const faltan = Math.max(0, nPony - 1 - noPony.length);
      if (faltan <= 0) break;
      // El bloque de otra marca MÁS GRANDE que aún dé dos corridas largas.
      // Probado al revés (partir el más chico, para dejar entero el bloque
      // grande de Estandar) y sale peor: las dos mitades chicas terminan
      // pegadas una detrás de otra, el separador se gasta en balde y la Pony
      // se amontona al final. Del grande salen dos mitades que sí alcanzan a
      // separar dos corridas de Pony distintas.
      const porPiso = (min) =>
        noPony
          .filter((b) => b.numCocimientos >= 2 * min)
          .sort((a, b) => b.numCocimientos - a.numCocimientos)[0];
      let minimo = MIN_CORRIDA_CERVEZA;
      let candidato = porPiso(minimo);
      if (!candidato) {
        // No hay ningún bloque que dé dos corridas de 14. Se baja el piso.
        minimo = MIN_CORRIDA_CERVEZA_FORZADO;
        candidato = porPiso(minimo);
        if (candidato)
          corridasCortasForzadas.push({
            blockLabel: candidato.blockLabel,
            numCocimientos: candidato.numCocimientos,
          });
      }
      if (!candidato) break;
      const i = blocks.indexOf(candidato);
      blocks.splice(i, 1, ...partirBloque(candidato, 2, minimo));
    }
  }

  // --- R5: orden por FECHA DE ENVASADO ascendente ---
  // No por inicio ideal de cocina: si se ordenara por eso, TODA la cerveza
  // (tubería larga: fermentación + maduración) iría antes que TODA la Pony
  // (que solo madura 24 h), y el tramo final quedaría lleno de huecos de Pony
  // "día de por medio" sin cerveza con qué llenarlos. Ordenando por envasado,
  // cerveza y Pony se intercalan como en el plan y la cerveza (que no tiene
  // límite en BBT) se adelanta lo necesario para tapar esos huecos.
  blocks.sort(
    (a, b) =>
      (a.fechaEnvasado ? a.fechaEnvasado.getTime() : 0) -
        (b.fechaEnvasado ? b.fechaEnvasado.getTime() : 0) ||
      a.sourceIndex - b.sourceIndex,
  );

  // --- Aseos ---
  const resolvedAseo = resolveAseoMatrix(aseoMatrix || [], catalog);
  const aseoPeriodicoActivo = !!(aseoPeriodico && aseoPeriodico.activo);
  const aseoPeriodicoHoras =
    Number(aseoPeriodico && aseoPeriodico.duracionHoras) || 0;
  // Ventana de 16 a 20 cocimientos entre aseos. La cuenta la reinicia CUALQUIER
  // aseo, no solo el periódico: si un cambio de marca cae dentro de la ventana,
  // ese CIP ya cumple y no se programa otro encima.
  const aseoPeriodicoMin = Math.max(
    1,
    parseInt(aseoPeriodico && aseoPeriodico.cocimientosMin, 10) || 1,
  );
  const aseoPeriodicoMax = Math.max(
    aseoPeriodicoMin,
    parseInt(aseoPeriodico && aseoPeriodico.cocimientosMax, 10) ||
      aseoPeriodicoMin,
  );

  const rows = [];
  const ordenBloques = [];
  let n = 0;
  // NADA se programa antes del I0: el I0 es la hora desde la que se planea y no
  // se puede cocinar en el pasado. Un bloque cuyo inicio ideal ya quedó atrás se
  // corre hasta el I0 y sale en rojo por fecha límite, que es la señal de que
  // ese volumen ya no alcanza a estar listo a tiempo.
  // La cocina además es un recurso único: cada bloque arranca cuando la cadena
  // queda libre (o cuando termina su aseo de cambio de marca).
  let cursorCadencia = null; // cocina libre para el siguiente CARGUE
  let cursorLibre = null; // cocina totalmente libre (fin del último cocimiento)
  let prevMostoId = null;
  let finUltimoPony = null; // fin de cocina de la última corrida de Pony
  // Cocimientos hechos DESDE EL ÚLTIMO ASEO (de cambio de marca, de apertura o
  // periódico). Es lo que se compara contra la ventana de 16-20.
  let cocDesdeAseo = 0;
  // Aseos que quedaron por debajo del mínimo porque el cambio de marca los
  // obligó antes de tiempo: se avisan, no se esconden.
  const aseosCortos = [];
  // Aseo periódico que ya toca y todavía no se ha hecho. Mientras esté en true,
  // el siguiente bloque que entra es Pony: si de todas formas hay que lavar, que
  // ese lavado sirva para meter la Pony y no se gaste otro CIP más adelante.
  let aseoPeriodicoPendiente = false;
  // Corridas de Pony que hubo que correr porque no había SV Pony libre. No se
  // pierden: se programan cuando lo hay, y mientras tanto la cocina sigue con
  // cerveza. Se anotan para poder decir cuánto esperaron y por qué.
  const ponySinEspacio = [];
  let ponyIniciado = false; // ¿ya se programó la primera corrida de Pony?
  // Cocimientos de Pony SEGUIDOS que llevamos en la corrida actual. Se usa para
  // LLENAR la corrida hasta PONY_MAX antes de cambiar de marca: cada entrada a
  // Pony cuesta un CIP, así que dos corridas de 2 gastan el doble de aseos que
  // una de 4. Vuelve a 0 con cualquier bloque que no sea Pony.
  let ponySeguidas = 0;
  const HORA24 = 24 * HORA; // "día de por medio" entre CORRIDAS de Pony
  // PISO DE LA PROGRAMACIÓN: nada se coloca antes de aquí. Manda el I0.
  // Si el campo del I0 está vacío getI0Date() devuelve null, y sin piso el motor
  // colocaba cocimientos días antes del inicio del plan —programar en el pasado—
  // sin avisar de nada. En ese caso se usa el primer día del plan cargado, que
  // es la fecha más temprana que tiene sentido para lo que se está planeando.
  const i0Ms = i0FloorDate
    ? i0FloorDate.getTime()
    : weekStart instanceof Date && !isNaN(weekStart.getTime())
      ? weekStart.getTime()
      : null;

  // ALMACENAMIENTO DISPONIBLE. Un cocimiento no se programa si al terminar no
  // hay dónde ponerlo: la cerveza va a un FV y la Pony directo a un SV Pony.
  // Solo cuenta el equipo VACÍO; el que tiene producto no está libre hasta que
  // termina su etapa y pasa por su aseo de reutilización.
  const almacenLibreDesde = (() => {
    const occ =
      typeof inventoryOccupancyByEquipo === "function"
        ? inventoryOccupancyByEquipo()
        : {};
    const base = i0Ms != null ? i0Ms : Date.now();
    const primeroLibre = (tipos) => {
      let mejor = null;
      (tankCatalog || []).forEach((t) => {
        if (!tipos.includes(t.tipo) || t.disponible === false) return;
        if (!(Number(t.capacidadHL) > 0)) return;
        const o = occ[normalizeText(t.equipo || "")];
        const libre = !o || o.vacio ? base : o.fecha.getTime();
        const listo = libre + (Number(t.aseoHoras) || 0) * HORA;
        if (mejor == null || listo < mejor) mejor = listo;
      });
      return mejor;
    };
    return { pony: primeroLibre(["SV Pony"]), cerveza: primeroLibre(["FV"]) };
  })();
  // Piso por almacenamiento para un bloque: el cocimiento tiene que TERMINAR
  // cuando ya haya equipo libre, así que el piso del arranque es esa fecha menos
  // lo que dura la cocina. Como toda la programación arranca en el I0 o después,
  // la foto del inventario —que es del I0— vale para todo lo que se programa.
  const aplicarPisoAlmacen = (b, t) => {
    const libre = esMostoPony(b.mostoId)
      ? almacenLibreDesde.pony
      : almacenLibreDesde.cerveza;
    if (libre == null) return t;
    return Math.max(t, libre - (Number(b.cocinaHoras) || 0) * HORA);
  };
  const pending = blocks.slice();

  while (pending.length) {
    // Momento en que la cocina queda libre para el siguiente cargue / para un
    // aseo.
    const libreCadencia = cursorCadencia
      ? cursorCadencia.getTime()
      : cursorLibre
        ? cursorLibre.getTime()
        : pending[0].idealStarts[0].getTime();
    const libreTotal = cursorLibre ? cursorLibre.getTime() : libreCadencia;

    // Instante REAL más temprano en que cada bloque podría arrancar, con sus
    // topes: aseo de cambio de marca, levadura Light, y para Pony el máx. en
    // BBT y el "día de por medio". Sirve para no dejar la cocina parada.
    const arranqueDe = (b, conAlmacen = true) => {
      // Sin nada programado aún, el primer bloque puede arrancar desde el I0 (los
      // topes de adelanto de abajo lo frenan). Antes arrancaba justo en su
      // inicio ideal, sin holgura, y todo lo que se envasaba a la misma hora
      // —la Pilsen junto a la Estándar del lunes— quedaba tarde desde el inicio.
      let t = prevMostoId
        ? libreCadencia
        : i0Ms != null
          ? i0Ms
          : b.idealStarts[0].getTime();
      if (i0Ms != null) t = Math.max(t, i0Ms); // nunca antes del I0
      if (aplicaTopeAdelanto(b.mostoId))
        t = Math.max(t, refAdel(b) - topeAdelantoMs(b.mostoId));
      if (prevMostoId && prevMostoId !== b.mostoId) {
        const info = getAseoDuracion(
          prevMostoId,
          b.mostoId,
          resolvedAseo,
          aseoDefaultHoras,
        );
        if (!info.sinAseo && info.horas > 0)
          t = Math.max(t, libreTotal + info.horas * HORA);
      }
      if (b.mostoId === "light") {
        const y = yeastPool
          .filter((z) => !z.consumida)
          .sort((x, z) => x.fechaDisponible - z.fechaDisponible)[0];
        if (!y) return Infinity;
        t = Math.max(t, y.fechaDisponible.getTime());
      }
      if (esMostoPony(b.mostoId)) {
        // Tope absoluto de 72 h en BBT: nunca se cuece antes de eso.
        if (b.maxBBTHoras > 0)
          t = Math.max(t, refAdel(b) - pisoBBTHoras(b) * HORA);
        if (finUltimoPony) t = Math.max(t, finUltimoPony.getTime() + HORA24);
      }
      return conAlmacen ? aplicarPisoAlmacen(b, t) : t;
    };
    // Selección: el bloque que pueda ARRANCAR ANTES (menor arranqueDe, que ya
    // incluye su inicio ideal, aseos, levadura Light, máx. BBT y día de por
    // medio de Pony). Así la cocina nunca queda parada teniendo trabajo listo:
    // si una corrida de Pony todavía no puede (BBT / día de por medio) pero hay
    // cerveza cuyo inicio ideal ya llegó, entra la cerveza.
    // Si dos bloques pueden arrancar casi a la misma hora (±1 h), va primero
    // el más urgente: el que tiene el «a más tardar» más temprano.
    const urgencia = (b) => {
      if (!b.cocs || !b.cocs.length) return b.idealStarts[0].getTime();
      const g = b.gapHoras * HORA;
      return Math.min(...b.cocs.map((c, j) => c.latest - j * g));
    };
    let idx = 0;
    let best = arranqueDe(pending[0]);
    for (let i = 1; i < pending.length; i++) {
      const a = arranqueDe(pending[i]);
      if (
        a < best - HORA ||
        (Math.abs(a - best) <= HORA && urgencia(pending[i]) < urgencia(pending[idx]))
      ) {
        best = a;
        idx = i;
      }
    }
    // Corrida de Pony (hasta 4) SIEMPRE que se venga un aseo / cambio de marca,
    // para repartirlas por la semana y NO dejarlas todas al final. Se aplica
    // cuando el bloque anterior no es Pony y hay una corrida de Pony que ya
    // puede arrancar dentro de su ventana de BBT sin parar la cocina.
    // (Solo después de un bloque de cerveza: la APERTURA va con cerveza, ver abajo.)
    if (prevMostoId && !esMostoPony(prevMostoId)) {
      let pIdx = -1;
      let pBest = Infinity;
      for (let i = 0; i < pending.length; i++) {
        if (!esMostoPony(pending[i].mostoId)) continue;
        const a = arranqueDe(pending[i]);
        if (a < pBest) {
          pBest = a;
          pIdx = i;
        }
      }
      // Tras una corrida de cerveza entra Pony si su ventana de BBT ya está
      // abierta (o casi). Si todavía no lo está, sigue la cerveza: dos corridas
      // de cerveza seguidas son válidas — lo que NUNCA se permite es más de 5
      // Pony seguidas. Así la Pony se reparte sin retrasar la cerveza que sí
      // tiene que salir temprano.
      // RESERVA DE SEPARADORES: si ya quedan tantos (o menos) bloques de otra
      // marca como separaciones harán falta entre las corridas de Pony que
      // faltan, no se gastan seguidos. Hay que reservarlos porque la cerveza
      // tiene 12 días de tubería y la Pony 2: al final del horizonte ya no se
      // puede cocer cerveza nueva para separar, y la Pony se amontonaría en
      // corridas de 8 y 12 seguidas.
      const ponyPend = pending.filter((b) => esMostoPony(b.mostoId)).length;
      const noPonyPend = pending.length - ponyPend;
      const escasezSeparadores = noPonyPend <= Math.max(0, ponyPend - 1);
      const esperaPony = pBest - Math.max(best, libreCadencia);
      // Con un aseo periódico pendiente la Pony entra sí o sí: el CIP se va a
      // hacer igual, y entrar a Pony cuesta un CIP, así que aprovecharlo es
      // gratis. Es la regla de "acomodar la Pony siempre después de un aseo".
      if (
        pIdx >= 0 &&
        (aseoPeriodicoPendiente ||
          escasezSeparadores ||
          esperaPony <= 12 * HORA)
      ) {
        idx = pIdx;
        best = pBest;
      }
    }
    // NO DEJAR LA PONY TARDE POR COCINAR CERVEZA CON HOLGURA. Si cocinar
    // primero el bloque elegido hace que una Pony pendiente pase de su «a más
    // tardar», y meter antes esa Pony no deja tarde al elegido, entra la Pony.
    // (La Pony no se puede adelantar: su BBT aguanta 48 h; la cerveza sí tiene
    // holgura de días.)
    if (!esMostoPony(pending[idx].mostoId)) {
      const X = pending[idx];
      const durX = Math.max(0, X.numCocimientos - 1) * X.gapHoras * HORA + X.cocinaHoras * HORA;
      let cand = -1;
      let candUrg = Infinity;
      pending.forEach((b, i) => {
        if (!esMostoPony(b.mostoId)) return;
        const u = urgencia(b);
        if (u < candUrg) {
          candUrg = u;
          cand = i;
        }
      });
      if (cand >= 0) {
        const P = pending[cand];
        const aP = getAseoDuracion(X.mostoId, P.mostoId, resolvedAseo, aseoDefaultHoras);
        const ponyDespues = best + durX + (!aP.sinAseo && aP.horas > 0 ? aP.horas * HORA : 0);
        const arrP = arranqueDe(P);
        const durP = Math.max(0, P.numCocimientos - 1) * P.gapHoras * HORA + P.cocinaHoras * HORA;
        const aX = getAseoDuracion(P.mostoId, X.mostoId, resolvedAseo, aseoDefaultHoras);
        const xDespues = arrP + durP + (!aX.sinAseo && aX.horas > 0 ? aX.horas * HORA : 0);
        if (
          arrP < ponyDespues &&
          ponyDespues > candUrg + 3 * 60000 &&
          arrP <= candUrg + 3 * 60000 &&
          // …y al elegido no le pasa nada, o ya iba tarde de todas formas
          // (atrasarlo unas horas más no cambia nada; dejar sin Pony la línea sí).
          (xDespues <= urgencia(X) + 3 * 60000 || best > urgencia(X) + 3 * 60000)
        ) {
          idx = cand;
          best = arrP;
        }
      }
    }
    // ARRANQUE CON CERVEZA (acuerdo SLA Planta n.º 1, prioridad definida por
    // Planeación): la apertura de la programación y todo arranque después de
    // una parada de la cocina (12 h o más sin cargar) se hace con cerveza, no
    // con malta. Si el elegido es Pony y hay una marca de cerveza que pueda
    // arrancar, entra la cerveza; la Pony sigue después. Solo se abre con malta
    // si no queda ningún bloque de cerveza.
    // Se compara de cargue a cargue, igual que lo mide el SLA. Si la cerveza
    // no puede arrancar dentro de las 24 h siguientes (no tiene volumen que
    // salga a tiempo), se deja la Pony: se prioriza la cerveza sin parar la
    // cocina días enteros ni romper el máximo de la Pony en BBT.
    const ultimoCargue = (() => {
      for (let k = rows.length - 1; k >= 0; k--)
        if (rows[k].tipo === "cocimiento") return rows[k].start.getTime();
      return null;
    })();
    // La parada se mide con la cocina VACÍA: desde que termina el último
    // cocimiento más el aseo de cambio de marca que haga falta. Antes se medía
    // de cargue a cargue y el propio aseo de entrada a Pony (fin de cocina +
    // 4:40 ≈ 13,5 h) contaba como «parada»: cada Pony que venía después de
    // cerveza parecía un arranque, se le cedía el turno a la cerveza una y otra
    // vez, y la Pony terminaba cocinándose después de su envasado.
    const aseoHacia = (b) => {
      if (!prevMostoId || prevMostoId === b.mostoId) return 0;
      const info = getAseoDuracion(prevMostoId, b.mostoId, resolvedAseo, aseoDefaultHoras);
      return !info.sinAseo && info.horas > 0 ? info.horas * HORA : 0;
    };
    const cocinaVaciaDesde = cursorLibre ? cursorLibre.getTime() + aseoHacia(pending[idx]) : null;
    const esArranque =
      !prevMostoId ||
      (ultimoCargue != null &&
        best - ultimoCargue >= 12 * HORA &&
        (cocinaVaciaDesde == null || best - cocinaVaciaDesde >= 12 * HORA));
    if (esArranque && esMostoPony(pending[idx].mostoId)) {
      let c = -1;
      let cbest = Infinity;
      pending.forEach((b, i) => {
        if (esMostoPony(b.mostoId)) return;
        const a = arranqueDe(b);
        if (a < cbest) {
          cbest = a;
          c = i;
        }
      });
      // Ceder el turno a la cerveza NO puede dejar a la Pony sin su envasado:
      // si cocinar primero esa cerveza (más el aseo de vuelta a Pony) hace que
      // la Pony pase de su «a más tardar», se queda la Pony.
      let ponyAtrasada = false;
      if (c >= 0) {
        const pb = pending[idx];
        const cb = pending[c];
        const g = pb.gapHoras * HORA;
        const limitePony = pb.cocs
          ? Math.min(...pb.cocs.map((z, j) => z.latest - j * g))
          : pb.idealStarts[0].getTime();
        const finCerveza =
          cbest + Math.max(0, cb.numCocimientos - 1) * cb.gapHoras * HORA + cb.cocinaHoras * HORA;
        const aseoVuelta = getAseoDuracion(cb.mostoId, pb.mostoId, resolvedAseo, aseoDefaultHoras);
        const vuelta = finCerveza + (!aseoVuelta.sinAseo && aseoVuelta.horas > 0 ? aseoVuelta.horas * HORA : 0);
        ponyAtrasada = vuelta > limitePony + 3 * 60000;
      }
      if (c >= 0 && !ponyAtrasada && (!prevMostoId || cbest <= best + HORA24)) {
        idx = c;
        best = cbest;
      }
    }
    // LLENAR LA CORRIDA DE PONY hasta PONY_MAX antes de soltarla. Volver a
    // entrar a Pony cuesta un CIP; quedarse cuesta cero, porque entre Pony y
    // Pony (GO o HG, da igual) no hay aseo. Dos corridas de 2 gastan dos aseos
    // donde una de 4 gasta uno, y cada aseo que se ahorra alarga el tramo de
    // cocimientos seguidos. Solo se encadena lo que quepa en lo que falta para
    // PONY_MAX; si no cabe nada, la regla dura de abajo cambia de marca.
    if (esMostoPony(prevMostoId) && ponySeguidas < PONY_MAX) {
      const cupo = PONY_MAX - ponySeguidas;
      let fIdx = -1;
      let fBest = Infinity;
      pending.forEach((b, i) => {
        if (!esMostoPony(b.mostoId) || b.numCocimientos > cupo) return;
        const a = arranqueDe(b);
        if (a < fBest) {
          fBest = a;
          fIdx = i;
        }
      });
      // Solo se encadena si esa Pony puede arrancar YA. Si su ventana de BBT
      // todavía no se abre, esperar para completar la corrida dejaría la cocina
      // parada y atrasaría la cerveza: sale más caro que el CIP que se ahorra.
      if (fIdx >= 0 && fBest <= Math.max(best, libreCadencia) + 12 * HORA) {
        idx = fIdx;
        best = fBest;
      }
    }
    // R4 (DURA): JAMÁS más de 5 cocimientos de Pony seguidos — ni aunque medien
    // días entre corridas. Si el elegido
    // es Pony y con él la corrida se pasaría de PONY_MAX, se mete la marca (no
    // Pony) que pueda arrancar más pronto, cueste lo que cueste. Solo se
    // permite pasarse si ya no queda NINGÚN bloque de otra marca.
    if (
      esMostoPony(prevMostoId) &&
      esMostoPony(pending[idx].mostoId) &&
      ponySeguidas + pending[idx].numCocimientos > PONY_MAX
    ) {
      let c = -1;
      let cbest = Infinity;
      pending.forEach((b, i) => {
        if (esMostoPony(b.mostoId)) return;
        const a = arranqueDe(b);
        if (a < cbest) {
          cbest = a;
          c = i;
        }
      });
      if (c >= 0) {
        idx = c;
        best = cbest;
      }
    }
    // NOTA sobre los huecos de la cocina. Cuando el bloque elegido es Pony y su
    // ventana de BBT todavía no se abre, la cocina espera. Se probó rellenar esa
    // espera adelantando una corrida corta de cerveza (partiendo el bloque con
    // partirBloqueEn) y el resultado es peor: la cerveza tiene 12 días de
    // tubería y la Pony 2, así que la cerveza gastada de más al principio ya no
    // se puede reponer al final, y la Pony termina en rachas de 8 y hasta 12
    // seguidas. Entre tapar el hueco y no pasar nunca de 5 Pony seguidas, manda
    // la segunda. Los huecos que quedan se reportan en Conflictos de capacidad.

    // LA FALTA DE ESPACIO DE PONY NO PARA LA COCINA.
    // El piso de almacenamiento ya empuja la Pony hasta que haya SV Pony libre,
    // y como la selección elige el bloque que puede arrancar antes, mientras
    // tanto entra la cerveza. La Pony no se pierde: se programa cuando sí hay
    // espacio. Lo único que se anota aquí es cuánto tuvo que esperar por eso.
    if (esMostoPony(pending[idx].mostoId) && cursorLibre) {
      const cand = pending[idx];
      const sinPiso = arranqueDe(cand, false);
      if (best > sinPiso + HORA)
        ponySinEspacio.push({
          blockLabel: cand.blockLabel,
          numCocimientos: cand.numCocimientos,
          volumenEnvasar: cand.volumenEnvasar,
          desde: new Date(best),
          esperaHoras: (best - sinPiso) / HORA,
        });
    }
    const block = pending.splice(idx, 1)[0];
    const idealFirst = block.idealStarts[0];

    // R3: Light necesita levadura Light.
    let yeastUsed = null;
    if (block.mostoId === "light") {
      yeastUsed =
        yeastPool
          .filter((y) => !y.consumida)
          .sort((a, b) => a.fechaDisponible - b.fechaDisponible)[0] || null;
      if (!yeastUsed) {
        capacityWarnings.push({
          tipo: "levadura",
          mostoId: "light",
          nombre: block.nombre,
          blockLabel: block.blockLabel,
          detalle: `No hay levadura Light disponible: el bloque "${block.blockLabel}" no se puede cocinar.`,
        });
        yeastEvents.push({
          blockLabel: block.blockLabel,
          mostoId: "light",
          estado: "BLOQUEADO",
          requerida: "Light",
          fuente: "—",
          disponibleDesde: null,
          inicio: null,
          detalle: "No hay levadura Light disponible.",
        });
        continue;
      }
      yeastUsed.consumida = true;
    }

    // Aseo de cambio de marca: si el mosto cambia (y el origen no es Pony, que
    // sale directo), se hace un CIP que ocupa la cocina desde que termina de
    // cocinar el bloque anterior.
    let aseoRow = null;
    let earliestFeasible = null;
    if (prevMostoId && prevMostoId !== block.mostoId) {
      const info = getAseoDuracion(
        prevMostoId,
        block.mostoId,
        resolvedAseo,
        aseoDefaultHoras,
      );
      if (!info.sinAseo && info.horas > 0) {
        const aseoStart = new Date(cursorLibre.getTime());
        const aseoEnd = new Date(aseoStart.getTime() + info.horas * HORA);
        aseoRow = {
          n: 0,
          tipo: "aseo",
          mostoId: null,
          blockId: block.blockId,
          nombre: `ASEO ${blocksNombre(prevMostoId, catalogById)} → ${blocksNombre(block.mostoId, catalogById)}`,
          start: aseoStart,
          end: aseoEnd,
          definido: info.definido,
        };
        earliestFeasible = aseoEnd;
      } else {
        earliestFeasible = cursorCadencia
          ? new Date(cursorCadencia.getTime())
          : null;
      }
    } else if (prevMostoId) {
      earliestFeasible = cursorCadencia
        ? new Date(cursorCadencia.getTime())
        : null;
    } else if (!prevMostoId && esMostoPony(block.mostoId)) {
      // (Solo llega aquí si NO hay ningún bloque de cerveza que abrir: la
      // apertura se hace con cerveza. Ver «ARRANQUE CON CERVEZA».)
      // APERTURA: la primera corrida de Pony va ANTES DE TODO — incluso antes
      // de la pre-carga de cerveza y aunque el lote se pase del máx. en BBT
      // (se marcará en rojo). Se ancla justo antes del inicio ideal más
      // temprano de cualquier bloque, para que la cerveza siga a Pony sin
      // adelantarse ella.
      // NO lleva aseo: la cocina viene de lo que estuviera haciendo antes del
      // horizonte cargado, y ese CIP no es del plan de esta semana.
      const idealMasTemprano = Math.min(
        ...blocks.map((b) => b.idealStarts[0].getTime()),
      );
      const duracionCorrida =
        Math.max(0, block.numCocimientos - 1) * block.gapHoras * HORA +
        block.cocinaHoras * HORA;
      let ponyStart = idealMasTemprano - duracionCorrida;
      // Tope absoluto de 72 h en BBT: la apertura tampoco puede saltárselo.
      if (block.maxBBTHoras > 0)
        ponyStart = Math.max(
          ponyStart,
          idealFirst.getTime() - topeBBTHoras(block) * HORA,
        );
      earliestFeasible = new Date(ponyStart);
    }

    // Aseo periódico pendiente. Si el cambio de marca ya trajo su propio CIP, ese
    // sirve y no se hace otro: un aseo es un aseo. Solo se pinta aquí cuando no
    // hubo ninguno — porque sigue la misma marca, o porque se venía saliendo de
    // Pony, que sale sin lavar.
    if (
      aseoPeriodicoPendiente &&
      !aseoRow &&
      prevMostoId &&
      aseoPeriodicoActivo &&
      aseoPeriodicoHoras > 0 &&
      cursorLibre
    ) {
      const aseoStart = new Date(cursorLibre.getTime());
      const aseoEnd = new Date(aseoStart.getTime() + aseoPeriodicoHoras * HORA);
      aseoRow = {
        n: 0,
        tipo: "aseo",
        mostoId: null,
        blockId: block.blockId,
        nombre: `ASEO programado (${aseoPeriodicoMax} cocimientos desde el aseo anterior)`,
        start: aseoStart,
        end: aseoEnd,
        definido: true,
        periodico: true,
      };
      earliestFeasible = aseoEnd;
    }

    // R5: cada bloque arranca cuando la cadena queda libre (fin de cadencia del
    // bloque anterior, o fin de su aseo) PERO nunca antes de su inicio ideal
    // (envasado − cocina − ferm − madur). Así la cerveza no se adelanta semanas
    // y ocupa los días que le tocan. Si la cocina sigue ocupada pasado el inicio
    // ideal, el bloque se corre y va en rojo. Topes extra: levadura Light.
    let actualFirst = earliestFeasible
      ? new Date(earliestFeasible.getTime())
      : !prevMostoId && i0Ms != null
        ? new Date(i0Ms)
        : new Date(idealFirst.getTime());
    // "No te alejes tanto": cerveza normal, como mucho 7 días antes del ideal.
    const refBloque = refAdel(block);
    if (
      aplicaTopeAdelanto(block.mostoId) &&
      actualFirst.getTime() < refBloque - topeAdelantoMs(block.mostoId)
    )
      actualFirst = new Date(refBloque - topeAdelantoMs(block.mostoId));
    if (
      yeastUsed &&
      yeastUsed.fechaDisponible.getTime() > actualFirst.getTime()
    )
      actualFirst = new Date(yeastUsed.fechaDisponible.getTime());

    // Pony: dos pisos adicionales sobre el arranque.
    if (esMostoPony(block.mostoId)) {
      // (a) Tope absoluto en BBT (72 h): no se puede cocinar TAN temprano que
      //     el lote quede en el BBT más de eso. Entre el máx. del catálogo
      //     (48 h) y las 72 h se permite, pero el bloque sale en rojo.
      if (block.maxBBTHoras > 0) {
        const pisoBBT = new Date(refBloque - pisoBBTHoras(block) * HORA);
        if (actualFirst.getTime() < pisoBBT.getTime())
          actualFirst = new Date(pisoBBT.getTime());
      }
      // (b) "Día de por medio": una corrida de Pony arranca al menos 24 h
      //     después de que terminó de cocinar la corrida de Pony anterior
      //     (aunque haya cocido cerveza en medio, si esa cerveza tomó menos).
      //     También sirve de freno: sin él las corridas se pegan unas a otras y
      //     la Pony termina amontonada en rachas de 8 y 12.
      if (finUltimoPony) {
        const pisoDia = new Date(finUltimoPony.getTime() + HORA24);
        if (actualFirst.getTime() < pisoDia.getTime())
          actualFirst = new Date(pisoDia.getTime());
      }
    }

    // PISO DEL I0: no se programa nada en el pasado. Va después de todos los
    // topes de adelanto —el de la cerveza y el de BBT de la Pony pueden dejar el
    // arranque antes del I0— y antes del piso de almacenamiento.
    if (i0Ms != null && actualFirst.getTime() < i0Ms)
      actualFirst = new Date(i0Ms);

    // Piso por almacenamiento: no se arranca un cocimiento si al terminar no hay
    // FV (cerveza) o SV Pony (Pony) libre donde meterlo.
    actualFirst = new Date(
      aplicarPisoAlmacen(block, actualFirst.getTime()),
    );

    // El aseo se hace JUSTO ANTES del cambio de marca, no en cuanto termina el
    // bloque anterior. Si el bloque que entra tiene que esperar (ventana de
    // BBT, levadura, día de por medio), adelantar el CIP solo dejaba la cocina
    // lavada y parada durante horas; corriéndolo hasta pegarlo al arranque, esas
    // horas quedan libres para cocer otra cosa.
    if (aseoRow && actualFirst.getTime() > aseoRow.end.getTime()) {
      const dur = aseoRow.end.getTime() - aseoRow.start.getTime();
      aseoRow.end = new Date(actualFirst.getTime());
      aseoRow.start = new Date(actualFirst.getTime() - dur);
    }

    // Aviso de exceso en BBT: si una corrida de Pony (típicamente la de
    // apertura) se cuece tan pronto que el lote quedará en el BBT más de
    // `maxBBTHoras`, se marca en rojo para que el equipo lo resuelva.
    if (
      esMostoPony(block.mostoId) &&
      block.maxBBTHoras > 0 &&
      actualFirst.getTime() < refBloque - block.maxBBTHoras * HORA - 60000
    ) {
      const horasEnBBT = (refBloque - actualFirst.getTime()) / HORA;
      capacityWarnings.push({
        tipo: "bbt",
        mostoId: block.mostoId,
        nombre: block.nombre,
        tren: block.tren,
        blockLabel: block.blockLabel,
        blockStart: new Date(actualFirst.getTime()),
        blockEnd: block.fechaEnvasado,
        deadline: block.fechaEnvasado,
        retrasoHoras: horasEnBBT,
        detalle: `Esta corrida de Pony se cuece muy pronto: el lote quedará ~${Math.round(
          horasEnBBT,
        )} h en el BBT (máx. ${Math.round(
          block.maxBBTHoras,
        )} h). Programado así por la regla "Pony al principio"; revisar.`,
      });
    }

    if (aseoRow) {
      aseoRow.n = ++n;
      rows.push(aseoRow);
      // Un aseo es un aseo: reinicia la cuenta de la ventana de 16-20. Si el
      // cambio de marca lo obligó antes del mínimo, queda registrado.
      if (cocDesdeAseo > 0 && cocDesdeAseo < aseoPeriodicoMin)
        aseosCortos.push({
          cocimientos: cocDesdeAseo,
          nombre: aseoRow.nombre,
          start: aseoRow.start,
        });
      cocDesdeAseo = 0;
      aseoPeriodicoPendiente = false;
    }

    // Un bloque Light programado se vuelve cosecha de levadura Light a futuro.
    if (block.mostoId === "light" && typeof YEAST_HARVEST_DAYS !== "undefined") {
      yeastPool.push({
        fechaDisponible: new Date(
          actualFirst.getTime() + YEAST_HARVEST_DAYS * DIA,
        ),
        origen: `Cosecha propia · ${block.blockLabel}`,
        consumida: false,
      });
      yeastPool.sort((a, b) => a.fechaDisponible - b.fechaDisponible);
    }

    const shiftHoras = Math.max(
      0,
      (actualFirst.getTime() - idealFirst.getTime()) / HORA,
    );
    // Excede el máx. en BBT si se cuece MÁS DE 1 h antes de
    // (envasado − proceso − maxBBT) — típicamente la corrida de apertura.
    const excedeBBT =
      esMostoPony(block.mostoId) &&
      block.maxBBTHoras > 0 &&
      actualFirst.getTime() < refBloque - block.maxBBTHoras * HORA - HORA;
    // ¿LLEGA TARDE DE VERDAD? Se compara el fin del proceso —último cocimiento
    // más fermentación y maduración— contra la fecha de envasado que el bloque
    // tiene que cubrir. Antes bastaba con que el arranque se hubiera desplazado
    // del ideal para pintarlo en rojo, y eso marcaba bloques que terminaban
    // HOLGADAMENTE antes de su límite: de 68 filas, 63 salían con aviso.
    const finProceso =
      actualFirst.getTime() +
      Math.max(0, block.numCocimientos - 1) * block.gapHoras * HORA +
      block.cocinaHoras * HORA +
      (block.fermentacionHoras + block.maduracionHoras) * HORA;
    // Con demanda por cocimiento, cada uno se mide contra SU necesidad: el
    // cocimiento n.º i llega tarde si cargó después de su «a más tardar».
    const retrasoCoc = block.cocs
      ? block.cocs.map((c, i) => (actualFirst.getTime() + i * block.gapHoras * HORA - (c.latestPropio ?? c.latest)) / HORA)
      : null;
    const retrasoRealHoras = retrasoCoc
      ? Math.max(...retrasoCoc)
      : block.fechaEnvasado
        ? (finProceso - block.fechaEnvasado.getTime()) / HORA
        : 0;
    const llegaTarde = retrasoRealHoras > 0.05;
    const viola = llegaTarde || excedeBBT;
    const rowStartIdx = rows.length;

    // Aseo programado (periódico): al llegar al máximo de la ventana, contando
    // TODOS los bloques, se mete un CIP que corre el resto de la secuencia.
    let offsetMs = 0;
    let lastCocStart = actualFirst.getTime();
    for (let i = 0; i < block.numCocimientos; i++) {
      const start = new Date(
        actualFirst.getTime() + i * block.gapHoras * HORA + offsetMs,
      );
      const end = new Date(start.getTime() + block.cocinaHoras * HORA);
      lastCocStart = start.getTime();
      const restante = Math.max(
        0,
        block.volumenCocinar - i * block.volumenPorCocimiento,
      );
      rows.push({
        n: ++n,
        tipo: "cocimiento",
        blockId: block.blockId,
        mostoId: block.mostoId,
        nombre: block.nombre,
        codigo: block.codigo,
        tren: block.tren,
        blockLabel: block.blockLabel,
        start,
        end,
        latestStart: new Date(
          block.cocs ? block.cocs[i].latestPropio ?? block.cocs[i].latest : (block.idealStarts[i] || idealFirst).getTime(),
        ),
        shiftHours: shiftHoras,
        firstPackagingStart: block.fechaEnvasado,
        blockStart: i === 0,
        blockEnd: i === block.numCocimientos - 1,
        deadline: block.cocs ? new Date(block.cocs[i].need) : block.fechaEnvasado,
        violaDeadline: block.cocs
          ? (start.getTime() - (block.cocs[i].latestPropio ?? block.cocs[i].latest)) / HORA > 0.05 || excedeBBT
          : viola,
        // Trazabilidad: desde cuándo se envasa su producto y en qué línea/SKU.
        necesidad: block.cocs ? new Date(block.cocs[i].need) : block.fechaEnvasado,
        necesidadFin: block.cocs ? new Date(block.cocs[i].needEnd) : null,
        consumo: block.cocs ? block.cocs[i].consumo : [],
        cocVolumenHL: block.volumenPorCocimiento
          ? Math.min(block.volumenPorCocimiento, restante)
          : 0,
      });
      cocDesdeAseo++;
      // El aseo periódico entra al llegar al MÁXIMO de la ventana. Por debajo de
      // eso se espera: puede que el siguiente cambio de marca traiga su propio
      // CIP dentro de la ventana y no haga falta este.
      // Aquí NO se pinta el aseo: se CORTA la corrida y el resto del bloque
      // vuelve a la cola. El aseo se hace al empezar el bloque siguiente, que
      // será Pony (ver aseoPeriodicoPendiente en la selección). Antes el aseo se
      // metía en mitad del bloque y lo que seguía era la misma marca, así que
      // ese CIP no servía para entrar a Pony y más adelante había que hacer otro.
      if (
        aseoPeriodicoActivo &&
        aseoPeriodicoHoras > 0 &&
        cocDesdeAseo >= aseoPeriodicoMax &&
        i < block.numCocimientos - 1 &&
        !esMostoPony(block.mostoId) &&
        pending.some((b) => esMostoPony(b.mostoId))
      ) {
        const [, resto] = partirBloqueEn(block, i + 1);
        if (resto) {
          pending.push(resto);
          aseoPeriodicoPendiente = true;
          break;
        }
      }
    }

    // Con demanda por cocimiento el atraso se mide solo sobre los cocimientos
    // que de verdad quedaron en este tramo (si el aseo periódico partió el
    // bloque, el resto se juzga cuando se programe).
    const colocados = rows.slice(rowStartIdx).filter((x) => x.tipo === "cocimiento");
    const llegaTardeReal = block.cocs
      ? colocados.some((x) => x.latestStart && (x.start - x.latestStart) / HORA > 0.05)
      : llegaTarde;
    if (llegaTardeReal) {
      const finReal = new Date(
        rows[rows.length - 1].end.getTime() +
          (block.fermentacionHoras + block.maduracionHoras) * HORA,
      );
      const retraso = block.cocs
        ? Math.max(...colocados.map((x) => (x.start - x.latestStart) / HORA))
        : block.fechaEnvasado
          ? (finReal.getTime() - block.fechaEnvasado.getTime()) / HORA
          : retrasoRealHoras;
      // Con demanda por cocimiento, el aviso se cuenta con el cocimiento MÁS
      // atrasado: cuándo queda listo y desde cuándo lo necesita su envasado.
      const peor = block.cocs
        ? colocados.reduce((a, x) => (!a || x.start - x.latestStart > a.start - a.latestStart ? x : a), null)
        : null;
      capacityWarnings.push({
        tipo: "deadline",
        mostoId: block.mostoId,
        nombre: block.nombre,
        tren: block.tren,
        blockLabel: block.blockLabel,
        blockStart: rows[rowStartIdx].start,
        blockEnd: peor
          ? new Date(peor.end.getTime() + (block.fermentacionHoras + block.maduracionHoras) * HORA)
          : finReal,
        deadline: peor && peor.necesidad ? peor.necesidad : block.fechaEnvasado,
        retrasoHoras: Math.max(0, retraso),
        detalle: `El bloque arrancó ${shiftHoras.toFixed(
          1,
        )} h después de su inicio ideal ${
          i0Ms != null && rows[rowStartIdx].start.getTime() <= i0Ms + 60000
            ? "porque el I0 (desde cuándo se programa) ya es posterior a ese inicio"
            : "porque la cocina seguía ocupada"
        }, así que el proceso (cocina + fermentación + maduración) no alcanza a terminar antes del envasado que tiene que cubrir.`,
      });
    }

    yeastEvents.push({
      blockLabel: block.blockLabel,
      mostoId: block.mostoId,
      estado:
        block.mostoId === "light"
          ? "APTO"
          : esMostoPony(block.mostoId)
            ? "N/A"
            : "APTO",
      requerida:
        block.mostoId === "light"
          ? "Light"
          : esMostoPony(block.mostoId)
            ? "No aplica"
            : "General",
      fuente: yeastUsed
        ? yeastUsed.origen
        : esMostoPony(block.mostoId)
          ? "Pony no fermenta"
          : "—",
      disponibleDesde: yeastUsed ? yeastUsed.fechaDisponible : null,
      inicio: actualFirst,
      detalle: "",
    });

    ordenBloques.push(block.blockLabel);
    // Cocina libre para el siguiente cargue = último inicio + tiempo entre
    // cargues. Cocina totalmente libre (para un aseo) = fin del último
    // cocimiento.
    cursorCadencia = new Date(lastCocStart + block.gapHoras * HORA);
    cursorLibre = new Date(lastCocStart + block.cocinaHoras * HORA);
    if (esMostoPony(block.mostoId)) {
      finUltimoPony = new Date(cursorLibre.getTime());
      ponyIniciado = true;
      // La corrida sigue viva mientras no entre otra marca: GO detrás de HG (o
      // al revés) es la misma corrida, sin aseo en medio.
      ponySeguidas = esMostoPony(prevMostoId)
        ? ponySeguidas + block.numCocimientos
        : block.numCocimientos;
    } else {
      ponySeguidas = 0;
    }
    prevMostoId = block.mostoId;
  }


  // "Bloque" = corrida de cocimientos SEGUIDOS que pertenecen a la misma
  // demanda de envasado (mismo blockId de la programación). Corta el bloque:
  //   · cualquier aseo (de cambio de marca O periódico),
  //   · un cambio de mosto,
  //   · un cambio de blockId — otra demanda de envasado, u otra CORRIDA de la
  //     misma marca (Pony va en corridas de 2-4; entre corridas hay "día de por
  //     medio", así que nunca son 18 cocimientos seguidos aunque no haya aseo).
  // El inicio/fin se mira contra la fila anterior / siguiente de la secuencia.
  rows.forEach((r, i) => {
    if (r.tipo !== "cocimiento") return;
    const prev = rows[i - 1];
    const next = rows[i + 1];
    r.blockStart =
      !prev ||
      prev.tipo === "aseo" ||
      prev.mostoId !== r.mostoId ||
      prev.blockId !== r.blockId;
    r.blockEnd =
      !next ||
      next.tipo === "aseo" ||
      next.mostoId !== r.mostoId ||
      next.blockId !== r.blockId;
  });

  // Control DURO: nunca más de 5 cocimientos de Pony seguidos, aunque medien
  // días o aseos. Si aun así quedan rachas más largas es porque ya no había
  // NINGÚN bloque de otra marca con qué separarlas (toda la cerveza tiene que
  // cocerse antes por su tubería de 12 días). Se marca en rojo y se avisa.
  {
    const cocs = rows.filter((r) => r.tipo === "cocimiento");
    let racha = [];
    const cerrarRacha = () => {
      if (racha.length > PONY_MAX) {
        // Se avisa, pero NO se pinta como «llega tarde»: estos cocimientos
        // pueden estar a tiempo; el problema es de secuencia, no de fecha.
        racha.forEach((r) => (r.ponySeguidas = true));
        capacityWarnings.push({
          tipo: "ponyseguidas",
          mostoId: racha[0].mostoId,
          nombre: racha[0].nombre,
          blockLabel: racha[0].blockLabel,
          blockStart: racha[0].start,
          blockEnd: racha[racha.length - 1].end,
          deadline: null,
          retrasoHoras: racha.length,
          detalle: `${racha.length} cocimientos de Pony seguidos (máximo ${PONY_MAX}). No queda ningún bloque de otra marca con qué separarlos: toda la cerveza debe cocerse antes por su tiempo de proceso. Hay que traer cerveza de la semana siguiente o mover envasados de Pony.`,
        });
      }
      racha = [];
    };
    cocs.forEach((r) => {
      if (esMostoPony(r.mostoId)) racha.push(r);
      else cerrarRacha();
    });
    cerrarRacha();
  }

  // CORRIDAS DE PONY DE UN SOLO COCIMIENTO (acuerdo: mínimo 2 seguidos). Una
  // corrida termina cuando entra otra marca o la cocina para 12 h o más.
  {
    const cocs = rows.filter((r) => r.tipo === "cocimiento");
    const sueltas = [];
    cocs.forEach((r, i) => {
      if (!esMostoPony(r.mostoId)) return;
      const ant = cocs[i - 1];
      const sig = cocs[i + 1];
      const pegada = (a, b) => a && b && esMostoPony(a.mostoId) && esMostoPony(b.mostoId) && b.start - a.start < 12 * HORA;
      if (!pegada(ant, r) && !pegada(r, sig)) sueltas.push(r);
    });
    if (sueltas.length)
      capacityWarnings.push({
        tipo: "ponysuelta",
        mostoId: "pony",
        nombre: "Pony",
        blockLabel: `${sueltas.length} corrida(s) de Pony de un solo cocimiento`,
        blockStart: sueltas[0].start,
        blockEnd: sueltas[sueltas.length - 1].end,
        deadline: null,
        retrasoHoras: sueltas.length,
        detalle: `${sueltas.length} cocimiento(s) de Pony quedan solos (el acuerdo pide corridas de 2 o más): ${sueltas.map((r) => fmtDateTime(r.start)).join(", ")}. El envasado pide poca Pony en esas ventanas y juntarlos obligaría a dejarla más de 48 h en BBT; conviene revisar el plan de envasado de Pony.`,
      });
  }

  // PONY QUE HUBO QUE CORRER POR FALTA DE MADURADOR.
  if (ponySinEspacio.length) {
    const coc = ponySinEspacio.reduce((a, x) => a + x.numCocimientos, 0);
    const espera = ponySinEspacio.reduce(
      (a, x) => Math.max(a, x.esperaHoras || 0),
      0,
    );
    const desde = ponySinEspacio.reduce(
      (a, x) => (a == null || x.desde < a ? x.desde : a),
      null,
    );
    capacityWarnings.push({
      tipo: "ponysinespacio",
      mostoId: "pony",
      nombre: "Pony",
      blockLabel: `${coc} cocimiento(s) de Pony corridos por falta de madurador`,
      blockStart: desde,
      blockEnd: null,
      deadline: null,
      retrasoHoras: espera,
      detalle: `${coc} cocimiento(s) de Pony se corrieron porque no había SV Pony libre; el que más esperó, ${Math.round(
        espera,
      )} h. La cocina no se paró por eso: mientras tanto entró cerveza, y la Pony entra en cuanto se libera un madurador (el primero, el ${
        desde ? fmtDateTime(desde) : "—"
      }). Para adelantarla hay que envasar antes lo que ocupa los SV Pony.`,
    });
  }

  // CORRIDAS DE CERVEZA POR DEBAJO DEL MÍNIMO. Solo pasa cuando no había otra
  // forma de separar las corridas de Pony, que es la regla que manda.
  if (corridasCortasForzadas.length) {
    capacityWarnings.push({
      tipo: "corridacorta",
      mostoId: null,
      nombre: "Cerveza",
      blockLabel: `${corridasCortasForzadas.length} bloque(s) partidos por debajo de ${MIN_CORRIDA_CERVEZA}`,
      blockStart: null,
      blockEnd: null,
      deadline: null,
      retrasoHoras: corridasCortasForzadas.length,
      detalle: `Hubo que partir ${corridasCortasForzadas
        .map((c) => `"${c.blockLabel}" (${c.numCocimientos} cocimientos)`)
        .join(", ")} en corridas de menos de ${MIN_CORRIDA_CERVEZA} cocimientos. No quedaba otro bloque de cerveza con qué separar las corridas de Pony, y no pasar de 5 Pony seguidas manda sobre el largo de la corrida de cerveza. Para evitarlo hace falta más volumen de cerveza junto, o menos ventanas de Pony en el plan de envase.`,
    });
  }

  // HORAS DE COCINA SIN PROGRAMAR. La cocina espera cuando lo único que queda
  // por cocer todavía no puede arrancar: casi siempre una corrida de Pony cuya
  // ventana de BBT no se ha abierto (no se puede cocer más de 72 h antes de
  // envasar) y no hay cerveza con qué llenar la espera sin quedarse luego sin
  // separadores. No se tapan por las malas —adelantar cerveza aquí obliga a
  // amontonar la Pony al final—, pero sí se muestran, con hora y motivo.
  {
    const orden = rows
      .filter((r) => r.start instanceof Date && r.end instanceof Date)
      .sort((a, b) => a.start - b.start);
    const huecos = [];
    for (let i = 1; i < orden.length; i++) {
      const prev = orden[i - 1];
      // La cocina queda libre para el siguiente cargue a la cadencia; tras un
      // aseo, al terminar el aseo.
      const gapH =
        Number(
          (catalogById[prev.mostoId] || {}).tiempoEntreCarguesHoras,
        ) || 0;
      const libre =
        prev.tipo === "aseo"
          ? prev.end.getTime()
          : prev.start.getTime() + gapH * HORA;
      const h = (orden[i].start.getTime() - libre) / HORA;
      if (h > 1) huecos.push({ h, desde: new Date(libre), hasta: orden[i].start });
    }
    if (huecos.length) {
      const total = huecos.reduce((a, x) => a + x.h, 0);
      huecos.sort((a, b) => b.h - a.h);
      capacityWarnings.push({
        tipo: "cocinaparada",
        mostoId: null,
        nombre: "Cocina",
        blockLabel: `${Math.round(total)} h sin programar`,
        blockStart: huecos[huecos.length - 1].desde,
        blockEnd: huecos[0].hasta,
        deadline: null,
        retrasoHoras: total,
        detalle: `La cocina queda parada ${Math.round(
          total,
        )} h repartidas en ${huecos.length} hueco(s). El mayor es de ${Math.round(
          huecos[0].h,
        )} h desde el ${fmtDateTime(huecos[0].desde)}. Pasa cuando lo único pendiente es una corrida de Pony cuya ventana de BBT todavía no abre —no se puede cocer más de 72 h antes de envasar— y no queda cerveza que meter sin dejar luego a la Pony sin separador. Para cerrarlos hay que juntar los envasados de Pony en menos días.`,
      });
    }
  }

  // Ventana de 16-20 cocimientos entre aseos. Los aseos periódicos ya respetan
  // el máximo por construcción; los que se quedan cortos son los de CAMBIO DE
  // MARCA, que no se pueden posponer: entrar a Pony o a Light exige CIP. Si con
  // los volúmenes de la semana las marcas cambian cada pocos cocimientos, la
  // ventana no se puede cumplir y hay que decirlo, no taparlo.
  if (aseosCortos.length) {
    const menor = aseosCortos.reduce(
      (a, x) => Math.min(a, x.cocimientos),
      Infinity,
    );
    capacityWarnings.push({
      tipo: "aseocorto",
      mostoId: null,
      nombre: "Aseos",
      blockLabel: `${aseosCortos.length} aseo(s) por debajo del mínimo`,
      blockStart: aseosCortos[0].start,
      blockEnd: aseosCortos[aseosCortos.length - 1].start,
      deadline: null,
      retrasoHoras: aseosCortos.length,
      detalle: `${aseosCortos.length} de los aseos quedaron con menos de ${aseoPeriodicoMin} cocimientos desde el aseo anterior (el más corto, con ${menor}). Son aseos de CAMBIO DE MARCA y no se pueden posponer: entrar a Pony o a Light siempre exige un CIP. Con estas corridas —Pony va máximo de 5 en 5— las marcas cambian cada pocos cocimientos, así que la ventana de ${aseoPeriodicoMin} a ${aseoPeriodicoMax} no se puede cumplir sin juntar más volumen por marca. Detalle: ${aseosCortos
        .map((x) => `${x.cocimientos} coc → ${x.nombre}`)
        .join("; ")}.`,
    });
  }

  const totalHL = blocks.reduce((a, b) => a + (Number(b.volumenEnvasar) || 0), 0);
  const ponyHL = blocks
    .filter((b) => esMostoPony(b.mostoId))
    .reduce((a, b) => a + (Number(b.volumenEnvasar) || 0), 0);

  return {
    rows,
    reglaWarnings,
    capacityWarnings,
    recomendaciones: {
      // ¿La secuencia abre con Pony? Lo deseado es que NO (abre con cerveza).
      iniciaConPony: esMostoPony(
        (rows.find((r) => r.tipo === "cocimiento") || {}).mostoId,
      ),
      ponyJuntoAseo: null,
    },
    resumen: { totalHL, ponyHL, cervezaHL: totalHL - ponyHL },
    ordenBloques,
    ponySinEspacio,
    // Desde cuándo hay FV / SV Pony libre. Se expone para poder explicarlo en la
    // interfaz y para poder verificar el piso de almacenamiento.
    almacenLibreDesde,
    yeastEvents,
    yeastPool,
    yeastBlocked: yeastEvents.filter((e) => e.estado === "BLOQUEADO"),
  };
}

function blocksNombre(mostoId, catalogById) {
  const m = catalogById[mostoId];
  return m ? m.nombre : mostoId;
}

