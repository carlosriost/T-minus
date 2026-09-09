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
  //   · Stream Pony: se agrupa por mostoId, que ya separa Pony GO de Pony (HG)
  //     porque son mostos distintos; la cerveza intercalada es transparente.
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
  // --- Stream Pony, GO y HG por separado (cerveza transparente) ---
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
  // Pony GO y Pony (HG) son mostos distintos, pero "Pony GO" casi nunca aparece
  // literal en el SKU ("PONY MALTA GO LESS SUGAR PET 2000CC X6"), así que
  // buscarlo por palabra suelta no sirve. Para cualquier texto que hable de Pony
  // manda ponyVariante, la misma regla que usa el inventario de BBT.
  if (/\bpony\b/.test(n) && typeof ponyVariante === "function") {
    const id = ponyVariante(n) === "go" ? "pony_go" : "pony";
    if ((catalog || []).some((m) => m.id === id)) return id;
  }
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
    // Etiqueta informativa (Go / HG). Ya no separa nada por sí sola —de eso se
    // encarga el mostoId, que en Pony distingue GO de HG—, pero se conserva para
    // poder explicar en el Balance por qué un lote sobrante no cubre la demanda.
    const varianteDemanda = esMostoPony(mostoId)
      ? mostoId === "pony_go"
        ? "go"
        : "hg"
      : null;
    const asignacionesInv = [];
    const eventos =
      Array.isArray(b.marcas) && b.marcas.length
        ? b.marcas
        : [{ name: b.name, volumen: volumenEnvasar }];
    let cubiertoPorInventario = 0;
    eventos.forEach((ev) => {
      const vol = Number(ev.volumen) || 0;
      if (!(vol > 0)) return;
      cubiertoPorInventario += tomarDeInventario(
        mostoId,
        vol,
        ev.name || b.name,
        asignacionesInv,
      );
    });
    const volumenEnvasarPendiente = volumenEnvasar - cubiertoPorInventario;

    // El número de cocimientos lo fija SOLO el volumen, con la fórmula:
    //   numCocimientos = ceil( loQueHayQueCocinar / (factorDilución · volumenPorCocimiento) )
    // donde "loQueHayQueCocinar" = volumen a envasar que NO cubre el inventario
    // (volumenEnvasarPendiente). Un cocimiento rinde factorDilución · volXCoc hL
    // de producto terminado (p.ej. Pony: 3,23 · 600 = 1.938 hL).
    // No se infla: el "mínimo 2 / máximo 4" de Pony NO crea cocimientos que no
    // existen — es una regla de SECUENCIA (corridas de 2 a 4 cocimientos
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
    if (b.earliest && numCocimientos > 0) {
      starts = computeCocimientoStarts(b.earliest, numCocimientos, m);
    }

    results.push({
      mostoId,
      variante: varianteDemanda,
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
      // Qué tanque cubrió qué marca del plan (para poder auditarlo).
      asignacionesInventario: asignacionesInv,
      cubiertoTotalPorInventario:
        numCocimientos === 0 && cubiertoPorInventario > 0,
    });
  });

  // Mantener el orden de bloques del plan de envasado. NO ordenar por start de cocina.
  results.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

  // --- Reconciliación de cocimientos ---------------------------------------
  // El número de cocimientos NO se infla partiendo la demanda: para cada mosto
  // —y Pony GO y Pony (HG) son dos mostos, así que cuentan por separado— el
  // total es exactamente ceil( Σ volumenCocinar / volumenPorCocimiento ). Ese
  // total se reparte entre los bloques del grupo de forma ACUMULADA, así que
  // Σ block.numCocimientos == total del mosto y ningún bloque redondea por su
  // cuenta. Lo que cambia entre bloques es solo el reparto y la secuencia, no
  // la cantidad total.
  const grpCoc = {};
  results.forEach((r) => {
    if (!(r.volumenCocinar > 1e-9)) return;
    const key = r.mostoId + (r.variante ? "|" + r.variante : "");
    (grpCoc[key] = grpCoc[key] || []).push(r);
  });
  Object.values(grpCoc).forEach((rs) => {
    const m = catalog.find((x) => x.id === rs[0].mostoId) || {};
    const vpc = Number(m.volumenPorCocimiento) || 1;
    let cumVol = 0;
    let cumCoc = 0;
    rs.forEach((r) => {
      cumVol += r.volumenCocinar;
      const totalHasta = Math.max(1, Math.ceil(cumVol / vpc - 1e-9));
      r.numCocimientos = Math.max(0, totalHasta - cumCoc);
      cumCoc = totalHasta;
      r.starts =
        r.fechaEnvasadoMinima && r.numCocimientos > 0
          ? computeCocimientoStarts(r.fechaEnvasadoMinima, r.numCocimientos, m)
          : [];
      r.cubiertoTotalPorInventario =
        r.numCocimientos === 0 && (r.inventarioUsadoHL || 0) > 0;
    });
  });

  // --- No dejar un cocimiento SOLO ---------------------------------------------
  // Un bloque que queda con 1 solo cocimiento no se programa aislado: se fusiona
  // con el bloque hermano (mismo mosto y, en Pony, misma variante) más cercano
  // en fecha de envasado, para que salgan juntos en la secuencia. El número
  // total de cocimientos del grupo no cambia.
  Object.values(grpCoc).forEach((rs) => {
    if (rs.length < 2) return;
    const m = catalog.find((x) => x.id === rs[0].mostoId) || {};
    for (let i = rs.length - 1; i >= 0; i--) {
      const src = rs[i];
      if (src.__merged || src.numCocimientos > 1) continue;
      let tgt = null;
      let bd = Infinity;
      rs.forEach((o) => {
        if (o === src || o.__merged || o.numCocimientos === 0) return;
        const d = Math.abs(
          (o.fechaEnvasadoMinima ? o.fechaEnvasadoMinima.getTime() : 0) -
            (src.fechaEnvasadoMinima ? src.fechaEnvasadoMinima.getTime() : 0),
        );
        if (d < bd) {
          bd = d;
          tgt = o;
        }
      });
      if (!tgt) continue;
      tgt.numCocimientos += src.numCocimientos;
      tgt.volumenCocinar += src.volumenCocinar;
      tgt.volumenEnvasar += src.volumenEnvasar;
      tgt.inventarioUsadoHL =
        (tgt.inventarioUsadoHL || 0) + (src.inventarioUsadoHL || 0);
      // Se conserva la fecha de envasado del bloque DESTINO (el grande): el
      // cocimiento suelto se cuece con esa tanda. No se adelanta todo el bloque
      // a la fecha del trocito; si esos pocos hL se necesitaran antes, el
      // chequeo de fecha límite lo marca en rojo.
      tgt.marcas = (tgt.marcas || []).concat(src.marcas || []);
      tgt.asignacionesInventario = (tgt.asignacionesInventario || []).concat(
        src.asignacionesInventario || [],
      );
      tgt.starts = tgt.fechaEnvasadoMinima
        ? computeCocimientoStarts(
            tgt.fechaEnvasadoMinima,
            tgt.numCocimientos,
            m,
          )
        : [];
      src.__merged = true;
    }
  });
  for (let i = results.length - 1; i >= 0; i--)
    if (results[i].__merged) results.splice(i, 1);

  // Lo que sobró de cada lote (no se usó porque no había demanda a tiempo para
  // consumirlo, o porque estará listo después de la última fecha cargada) —
  // se expone para poder explicar el "inventario sobrante" del Balance: no es
  // que "no cuadre", es que ese HL no alcanza a estar listo para ninguno de
  // los envasados que sí se cargaron.
  return { results, sinHomologar, remainingInventoryBatches: remainingBatches };
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
  // Búsqueda en la matriz: primero la combinación exacta y, si no está, la
  // combinación tratando Pony GO y Pony (HG) como una sola "Pony" — así una fila
  // "Estandar → Pony" cubre las dos sin tener que duplicarla, pero si el usuario
  // define una fila propia para Pony GO, esa manda.
  const canon = (id) => (esMostoPony(id) ? "pony" : id);
  const buscar = (f, t, k) => {
    let m = resolvedMatrix.find((a) => k(a.origenId) === f && k(a.destinoId) === t);
    if (!m) m = resolvedMatrix.find((a) => k(a.origenId) === t && k(a.destinoId) === f);
    return m;
  };
  const m =
    buscar(fromMostoId, toMostoId, (x) => x) ||
    buscar(canon(fromMostoId), canon(toMostoId), canon);
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
  // ---------------------------------------------------------------------------
  // PROGRAMACION SEMANAL  (construida desde cero, reglas 1-5)
  //   R1  Inicio ideal de cada cocimiento = envasado - cocina - fermentacion -
  //       maduracion. Ese es su inicio objetivo; ya viene calculado en
  //       computeCocinaPlan (block.idealStarts).
  //   R2  Lo que cubre el inventario disponible (BBT + FV + SV, en orden de
  //       envasado) NO se cocina; eso tambien lo resuelve computeCocinaPlan.
  //   R3  Un bloque Light solo se programa si hay levadura Light disponible; si
  //       la levadura llega mas tarde, el bloque se corre hasta esa fecha.
  //   R4  Pony se cuece en corridas de 2 a 4 cocimientos; una corrida termina
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
  const aplicaTopeAdelanto = (id) => id === "estandar" || id === "pilsen";
  // Pony: el máximo REAL en BBT es tiempoMaxBBTHoras (48 h). La programación
  // puede estirarlo hasta 72 h como tope absoluto; entre el máximo y las 72 h el
  // bloque sale en ROJO para que el equipo lo revise. Nunca más de 72 h.
  const PONY_BBT_TOLERANCIA_HORAS = 72;
  const topeBBTHoras = (b) =>
    Math.max(Number(b.maxBBTHoras) || 0, PONY_BBT_TOLERANCIA_HORAS);
  const reglaWarnings = [];
  const capacityWarnings = [];
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
      };
    });

  // --- R4: partir Pony en corridas de 2 a 4 cocimientos ---
  const PONY_MAX = 4;
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
      return {
        ...b,
        blockId: `${b.blockId}__t${k}`,
        blockLabel: `${b.blockLabel} (corrida ${k + 1}/${tramos.length})`,
        numCocimientos: size,
        volumenEnvasar: b.volumenEnvasar * share,
        volumenCocinar: b.volumenCocinar * share,
        idealStarts: slice,
      };
    });
  });

  // --- Separadores: NUNCA más de 4 Pony seguidas -----------------------------
  // Entre dos corridas de Pony tiene que ir SIEMPRE otra marca (aunque medien
  // días). El patrón real es: corrida LARGA de cerveza → aseo → 2-4 Pony →
  // corrida larga de cerveza → aseo → 2-4 Pony … La cerveza NO se pica en
  // trocitos: solo se parte cuando de verdad faltan separadores, y nunca en
  // trozos de menos de MIN_CORRIDA_CERVEZA cocimientos.
  const MIN_CORRIDA_CERVEZA = 5;
  {
    const partirBloque = (b, partes) => {
      const tam = splitEnTramos(
        b.numCocimientos,
        Math.ceil(b.numCocimientos / partes),
        MIN_CORRIDA_CERVEZA,
      );
      let off = 0;
      return tam.map((size, k) => {
        const share = size / b.numCocimientos;
        const slice = b.idealStarts.slice(off, off + size);
        off += size;
        return {
          ...b,
          blockId: `${b.blockId}__c${k}`,
          blockLabel: `${b.blockLabel} (parte ${k + 1}/${tam.length})`,
          numCocimientos: size,
          volumenEnvasar: b.volumenEnvasar * share,
          volumenCocinar: b.volumenCocinar * share,
          idealStarts: slice,
        };
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
      const candidato = noPony
        .filter((b) => b.numCocimientos >= 2 * MIN_CORRIDA_CERVEZA)
        .sort((a, b) => b.numCocimientos - a.numCocimientos)[0];
      if (!candidato) break;
      const i = blocks.indexOf(candidato);
      blocks.splice(i, 1, ...partirBloque(candidato, 2));
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
  // Se puede cocinar ANTES de I0 lo que haga falta para llegar a la fecha de
  // envasado: no hay piso en I0. La cocina sí es un recurso único: cada bloque
  // arranca cuando la cadena queda libre (o cuando termina su aseo de cambio de
  // marca), nunca antes de su inicio ideal.
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
  let ponyIniciado = false; // ¿ya se programó la primera corrida de Pony?
  // Cocimientos de Pony SEGUIDOS que llevamos en la corrida actual (GO y HG
  // cuentan juntas). Se usa para LLENAR la corrida hasta PONY_MAX antes de
  // cambiar de marca: cada entrada a Pony cuesta un CIP, así que dos corridas
  // de 2 gastan el doble de aseos que una de 4. Vuelve a 0 con cualquier
  // bloque que no sea Pony.
  let ponySeguidas = 0;
  const HORA24 = 24 * HORA; // "día de por medio" entre CORRIDAS de Pony
  const i0Ms = i0FloorDate ? i0FloorDate.getTime() : null;
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
    const arranqueDe = (b) => {
      let t = prevMostoId ? libreCadencia : b.idealStarts[0].getTime();
      if (aplicaTopeAdelanto(b.mostoId))
        t = Math.max(
          t,
          b.idealStarts[0].getTime() - MAX_ADELANTO_CERVEZA,
        );
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
          t = Math.max(
            t,
            b.idealStarts[0].getTime() - topeBBTHoras(b) * HORA,
          );
        if (finUltimoPony) t = Math.max(t, finUltimoPony.getTime() + HORA24);
      }
      return t;
    };
    // Selección: el bloque que pueda ARRANCAR ANTES (menor arranqueDe, que ya
    // incluye su inicio ideal, aseos, levadura Light, máx. BBT y día de por
    // medio de Pony). Así la cocina nunca queda parada teniendo trabajo listo:
    // si una corrida de Pony todavía no puede (BBT / día de por medio) pero hay
    // cerveza cuyo inicio ideal ya llegó, entra la cerveza.
    let idx = 0;
    let best = arranqueDe(pending[0]);
    for (let i = 1; i < pending.length; i++) {
      const a = arranqueDe(pending[i]);
      if (a < best - 1000) {
        best = a;
        idx = i;
      }
    }
    // Corrida de Pony (hasta 4) SIEMPRE que se venga un aseo / cambio de marca,
    // para repartirlas por la semana y NO dejarlas todas al final. Se aplica
    // cuando el bloque anterior no es Pony y hay una corrida de Pony que ya
    // puede arrancar dentro de su ventana de BBT sin parar la cocina.
    if (!esMostoPony(prevMostoId)) {
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
      // de cerveza seguidas son válidas — lo que NUNCA se permite es más de 4
      // Pony seguidas. Así la Pony se reparte sin retrasar la cerveza que sí
      // tiene que salir temprano.
      // RESERVA DE SEPARADORES: si ya quedan tantos (o menos) bloques de otra
      // marca como separaciones harán falta entre las corridas de Pony que
      // faltan, no se gastan seguidos: se alterna aunque haya que esperar a la
      // ventana de Pony. Es lo que evita que la cerveza se acabe y la Pony
      // quede apelotonada al final.
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
      if (pIdx >= 0 && (escasezSeparadores || esperaPony <= 12 * HORA)) {
        idx = pIdx;
        best = pBest;
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
    // R4 (DURA): JAMÁS más de 4 cocimientos de Pony seguidos — ni aunque medien
    // días entre corridas, y contando Pony GO y Pony (HG) JUNTAS. Si el elegido
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
    // seguidas. Entre tapar el hueco y no pasar nunca de 4 Pony seguidas, manda
    // la segunda. Los huecos que quedan se reportan en Conflictos de capacidad.
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

    // R5: cada bloque arranca cuando la cadena queda libre (fin de cadencia del
    // bloque anterior, o fin de su aseo) PERO nunca antes de su inicio ideal
    // (envasado − cocina − ferm − madur). Así la cerveza no se adelanta semanas
    // y ocupa los días que le tocan. Si la cocina sigue ocupada pasado el inicio
    // ideal, el bloque se corre y va en rojo. Topes extra: levadura Light.
    let actualFirst = earliestFeasible
      ? new Date(earliestFeasible.getTime())
      : new Date(idealFirst.getTime());
    // "No te alejes tanto": cerveza normal, como mucho 7 días antes del ideal.
    if (
      aplicaTopeAdelanto(block.mostoId) &&
      actualFirst.getTime() < idealFirst.getTime() - MAX_ADELANTO_CERVEZA
    )
      actualFirst = new Date(idealFirst.getTime() - MAX_ADELANTO_CERVEZA);
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
        const pisoBBT = new Date(
          idealFirst.getTime() - topeBBTHoras(block) * HORA,
        );
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
      actualFirst.getTime() < idealFirst.getTime() - block.maxBBTHoras * HORA
    ) {
      const horasEnBBT =
        block.maxBBTHoras +
        (idealFirst.getTime() -
          block.maxBBTHoras * HORA -
          actualFirst.getTime()) /
          HORA;
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
      actualFirst.getTime() <
        idealFirst.getTime() - block.maxBBTHoras * HORA - HORA;
    const viola = shiftHoras > 0.05 || excedeBBT;
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
          (block.idealStarts[i] || idealFirst).getTime(),
        ),
        shiftHours: shiftHoras,
        firstPackagingStart: block.fechaEnvasado,
        blockStart: i === 0,
        blockEnd: i === block.numCocimientos - 1,
        deadline: block.fechaEnvasado,
        violaDeadline: viola,
        cocVolumenHL: block.volumenPorCocimiento
          ? Math.min(block.volumenPorCocimiento, restante)
          : 0,
      });
      cocDesdeAseo++;
      // El aseo periódico solo entra al llegar al MÁXIMO de la ventana. Por
      // debajo de eso se espera: puede que el siguiente cambio de marca traiga
      // su propio CIP dentro de la ventana y no haga falta este.
      if (
        aseoPeriodicoActivo &&
        aseoPeriodicoHoras > 0 &&
        cocDesdeAseo >= aseoPeriodicoMax &&
        // No dejar un cocimiento SOLO ni antes ni después del aseo: se inserta
        // solo si en ESTE bloque ya se hizo ≥1 cocimiento y aún quedan ≥2; si
        // no, se pospone al siguiente punto válido.
        i >= 1 &&
        i < block.numCocimientos - 2
      ) {
        cocDesdeAseo = 0;
        offsetMs += aseoPeriodicoHoras * HORA;
        const nextStart = new Date(
          actualFirst.getTime() + (i + 1) * block.gapHoras * HORA + offsetMs,
        );
        rows.push({
          n: ++n,
          tipo: "aseo",
          mostoId: null,
          blockId: block.blockId,
          nombre: `ASEO programado (${aseoPeriodicoMax} cocimientos desde el aseo anterior)`,
          start: new Date(nextStart.getTime() - aseoPeriodicoHoras * HORA),
          end: nextStart,
          definido: true,
          periodico: true,
        });
      }
    }

    if (viola && shiftHoras > 0.05) {
      capacityWarnings.push({
        tipo: "deadline",
        mostoId: block.mostoId,
        nombre: block.nombre,
        tren: block.tren,
        blockLabel: block.blockLabel,
        blockStart: rows[rowStartIdx].start,
        blockEnd: new Date(
          rows[rows.length - 1].end.getTime() +
            (block.fermentacionHoras + block.maduracionHoras) * HORA,
        ),
        deadline: block.fechaEnvasado,
        retrasoHoras: shiftHoras,
        detalle: `El bloque arrancó ${shiftHoras.toFixed(
          1,
        )} h después de su inicio ideal (envasado − cocina − fermentación − maduración) porque la cocina seguía ocupada.`,
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

  // Control DURO: nunca más de 4 cocimientos de Pony seguidos, aunque medien
  // días o aseos. Si aun así quedan rachas más largas es porque ya no había
  // NINGÚN bloque de otra marca con qué separarlas (toda la cerveza tiene que
  // cocerse antes por su tubería de 12 días). Se marca en rojo y se avisa.
  {
    const cocs = rows.filter((r) => r.tipo === "cocimiento");
    let racha = [];
    const cerrarRacha = () => {
      if (racha.length > PONY_MAX) {
        racha.forEach((r) => (r.violaDeadline = true));
        capacityWarnings.push({
          tipo: "ponyseguidas",
          mostoId: racha[0].mostoId,
          nombre: racha[0].nombre,
          blockLabel: racha[0].blockLabel,
          blockStart: racha[0].start,
          blockEnd: racha[racha.length - 1].end,
          deadline: null,
          retrasoHoras: racha.length,
          detalle: `${racha.length} cocimientos de Pony seguidos, contando Pony GO y Pony HG juntas (máximo 4). No queda ningún bloque de otra marca con qué separarlos: toda la cerveza debe cocerse antes por su tiempo de proceso. Hay que traer cerveza de la semana siguiente o mover envasados de Pony.`,
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
      detalle: `${aseosCortos.length} de los aseos quedaron con menos de ${aseoPeriodicoMin} cocimientos desde el aseo anterior (el más corto, con ${menor}). Son aseos de CAMBIO DE MARCA y no se pueden posponer: entrar a Pony o a Light siempre exige un CIP. Con estas corridas —Pony va máximo de 4 en 4— las marcas cambian cada pocos cocimientos, así que la ventana de ${aseoPeriodicoMin} a ${aseoPeriodicoMax} no se puede cumplir sin juntar más volumen por marca. Detalle: ${aseosCortos
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
      // La secuencia abre con Pony (después de un aseo), antes de todo.
      iniciaConPony: esMostoPony(
        (rows.find((r) => r.tipo === "cocimiento") || {}).mostoId,
      ),
      ponyJuntoAseo: null,
    },
    resumen: { totalHL, ponyHL, cervezaHL: totalHL - ponyHL },
    ordenBloques,
    yeastEvents,
    yeastPool,
    yeastBlocked: yeastEvents.filter((e) => e.estado === "BLOQUEADO"),
  };
}

function blocksNombre(mostoId, catalogById) {
  const m = catalogById[mostoId];
  return m ? m.nombre : mostoId;
}

