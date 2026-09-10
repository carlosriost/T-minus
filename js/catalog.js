/* =========================================================================
   CATALOGO DE MOSTOS, BALANCE DE INVENTARIO y DISPONIBILIDAD DE LEVADURA + utils de texto
   ========================================================================= */
/* =========================================================================
   3) CATÁLOGO DE MOSTOS (editable) — homologación marca → mosto
   ========================================================================= */
// "palabras" = palabras clave (separadas por coma) para homologar una marca a un mosto,
// por texto contenido en el nombre de la marca — ignora deliberadamente el tamaño del envase
// (ej. "Águila 330ml Retornable" y "Águila Lata 269ml" homologan igual a "Águila").
// Los tiempos se editan en formato hh:mm:ss (horas:minutos:segundos) y se guardan internamente en horas.
// IMPORTANTE: "Light" va antes que "Estandar" en la lista para que "Águila Light" homologue a
// Mosto Light y no quede capturada primero por la palabra clave genérica "aguila" de Estandar.
// tiempoMaxBBTHoras = tiempo MÁXIMO que un lote puede estar en el BBT (producto
// terminado) antes de dañarse. Solo aplica a Pony (48 h); la cerveza no tiene
// este problema (0 = sin límite). Reemplaza el antiguo "vencimiento en SV".
// La programación puede estirarlo hasta PONY_BBT_TOLERANCIA_HORAS (72 h) como
// máximo absoluto: entre 48 h y 72 h el bloque sale en rojo para que el equipo
// lo revise; más allá de 72 h no se programa.
let MOSTO_CATALOG = [
  {
    id: "light",
    nombre: "Light",
    palabras: "aguila light, aguila lig, light",
    factorDilucion: 2.2,
    volumenPorCocimiento: 560,
    tiempoCocinaHoras: parseHMS("8:50:00"),
    tiempoFermentacionHoras: parseHMS("168:00:00"),
    tiempoMaduracionHoras: parseHMS("72:00:00"),
    tiempoEntreCarguesHoras: parseHMS("2:50:00"),
    tiempoMaxBBTHoras: 0,
  },
  {
    id: "pilsen",
    nombre: "Pilsen",
    palabras: "pilsen",
    factorDilucion: 1.93,
    volumenPorCocimiento: 600,
    tiempoCocinaHoras: parseHMS("8:55:00"),
    tiempoFermentacionHoras: parseHMS("204:00:00"),
    tiempoMaduracionHoras: parseHMS("72:00:00"),
    tiempoEntreCarguesHoras: parseHMS("2:50:00"),
    tiempoMaxBBTHoras: 0,
  },
  // Pony GO y Pony HG son EL MISMO MOSTO: se cuecen juntas, van al mismo
  // fermentador y al mismo madurador, y comparten todos estos parámetros. Se
  // separan más adelante, ya como producto terminado en el BBT, y ahí sí un BBT
  // de GO no sirve para envasar HG ni al revés (ver ponyVariante y
  // marcaBBTSirvePara). Por eso hay una sola fila de Pony en el catálogo.
  {
    id: "pony",
    nombre: "Pony",
    palabras: "pony, pmg",
    factorDilucion: 3.23,
    volumenPorCocimiento: 600,
    tiempoCocinaHoras: parseHMS("8:15:00"),
    tiempoFermentacionHoras: parseHMS("0"),
    tiempoMaduracionHoras: parseHMS("48:00:00"),
    tiempoEntreCarguesHoras: parseHMS("2:50:00"),
    tiempoMaxBBTHoras: parseHMS("48:00:00"),
  },
  {
    id: "estandar",
    nombre: "Estandar",
    palabras: "costeñita, aguila, poker",
    factorDilucion: 1.95,
    volumenPorCocimiento: 600,
    tiempoCocinaHoras: parseHMS("8:55:00"),
    tiempoFermentacionHoras: parseHMS("204:00:00"),
    tiempoMaduracionHoras: parseHMS("72:00:00"),
    tiempoEntreCarguesHoras: parseHMS("2:50:00"),
    tiempoMaxBBTHoras: 0,
  },
];

// Catálogo de aseos (CIP) entre cambios de marca: duración según marca de origen → marca de destino.
// "origen" y "destino" se homologan contra el catálogo de mostos igual que las marcas del Excel
// (mismo matchMosto), así "Aguila" homologa a Estandar salvo que diga "Aguila Light".
// Si una combinación no está definida, se usa ASEO_DEFAULT_HORAS (o el inverso, si existe).
// Reglas fijas (ver getAseoDuracion), NO configurables aquí: no hay aseo entre la misma
// marca, ni saliendo de Pony, ni saliendo de Light, ni entre cervezas normales
// (Estandar ↔ Pilsen). Solo hay aseo al ENTRAR a Light o a Pony desde una cerveza
// normal, así que estas son las únicas combinaciones que se consultan:
let ASEO_MATRIX = [
  {
    origen: "Estandar",
    destino: "Light",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Pilsen",
    destino: "Light",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Estandar",
    destino: "Pony",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Pilsen",
    destino: "Pony",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Light",
    destino: "Pony",
    duracionHoras: parseHMS("4:40:00"),
  },
];
let ASEO_DEFAULT_HORAS = parseHMS("3:50:00");

// Aseo periódico (general): entre un aseo y el siguiente deben ir de 16 a 20
// cocimientos. La cuenta se reinicia con CUALQUIER aseo —de cambio de marca, de
// apertura o periódico—, no solo con el periódico: un CIP es un CIP. Por eso el
// aseo periódico solo entra cuando la cuenta llega al MÁXIMO sin que haya
// aparecido un cambio de marca que ya lo resuelva; si el cambio de marca cae
// dentro de la ventana, ese aseo hace las veces del periódico y no se duplica.
// Un aseo que caiga por debajo del mínimo (porque la marca cambia antes) se
// avisa en Conflictos de capacidad: es un incumplimiento que el motor no puede
// evitar, no algo que deba esconder.
let ASEO_PERIODICO = {
  activo: true,
  duracionHoras: parseHMS("3:50:00"),
  cocimientosMin: 16,
  cocimientosMax: 20,
};

// Balance Semanal: inventario de cerveza YA DISPONIBLE para esta semana, registrado POR LOTE
// (equipo, marca/mosto, días en el equipo y HL ya normalizados —con el factor de dilución
// aplicado—, mismas unidades que "volumen a envasar"). Se persiste en localStorage.
let INVENTORY_BALANCE = [];
try {
  const raw = JSON.parse(localStorage.getItem("planCocinasInventario") || "[]");
  if (Array.isArray(raw)) {
    INVENTORY_BALANCE = raw;
  } else if (raw && typeof raw === "object") {
    // Migración desde el formato anterior (mapa mostoId -> HL, sin equipo ni días).
    INVENTORY_BALANCE = Object.keys(raw)
      .filter((k) => Number(raw[k]) > 0)
      .map((k) => ({
        id: "inv_migrado_" + k,
        equipo: "",
        mostoId: k,
        diasEnEquipo: "",
        hL: Number(raw[k]) || 0,
      }));
  }
} catch (_) {
  INVENTORY_BALANCE = [];
}
function saveInventoryBalance() {
  try {
    localStorage.setItem(
      "planCocinasInventario",
      JSON.stringify(INVENTORY_BALANCE),
    );
  } catch (_) {}
}
// Un madurador (SV / SV Pony) con hL pero SIN días registrados no es producto
// en proceso: es el equipo ocupado con levadura (guardada ahí, no madurando).
// No cuenta como inventario disponible ni libera el equipo por sí sola.
function esLevaduraEnMadurador(e) {
  // El volumen se mira en las DOS columnas: la levadura guardada trae hL sin
  // diluir pero la columna diluida en 0, así que mirando solo esa el equipo
  // parecía vacío y contaba como disponible.
  const tieneProducto = Number(e && e.hL) > 0 || Number(e && e.hLSinDiluir) > 0;
  return (
    !!e &&
    (e.tipo === "SV" || e.tipo === "SV Pony") &&
    tieneProducto &&
    (e.diasEnEquipo === "" || e.diasEnEquipo == null)
  );
}

// Suma el HL normalizado de todos los lotes por mosto — TOTAL en el pipeline
// (BBT terminado + FV fermentando + SV madurando), sin importar si ya está
// listo o le faltan días. Es solo para MOSTRAR "inventario disponible" en el
// Balance; computeCocinaPlan ya NO usa esta suma para descontar demanda (ver
// inventoryBatchesByMosto) porque un FV que recién empezó a fermentar no
// puede cubrir un envasado de esta semana solo porque "hay volumen" en algún
// lado del proceso.
function inventoryTotalsByMosto(catalog) {
  const totals = {};
  (catalog || []).forEach((m) => (totals[m.id] = 0));
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || e.mostoId == null) return;
    if (esLevaduraEnMadurador(e)) return; // levadura, no producto: no cubre demanda
    totals[e.mostoId] = (totals[e.mostoId] || 0) + (Number(e.hL) || 0);
  });
  return totals;
}

// Lotes de inventario por mosto CON su fecha real en que estarán LISTOS PARA
// ENVASAR (fin de todo el proceso, igual que la regla 1):
//   · BBT           → ya listo (I0).
//   · SV / SV Pony  → I0 + maduración que le falte.
//   · FV            → I0 + fermentación que le falte + maduración COMPLETA (al
//                     salir del fermentador todavía pasa por el madurador).
// Un lote solo puede cubrir un envasado que ocurra EN O DESPUÉS de esa fecha.
// Ordenados por fecha de disponibilidad (el que esté listo primero se consume
// primero). Devuelve { [mostoId]: [{ hL, listoEn: Date }, ...] }.
// Reglas propias del Mosto Pony: no fermenta (va de cocina directo a un SV
// Pony), tiene límite de 48 h en BBT, exige aseo al entrar desde una cerveza y
// nunca se cuecen más de 5 seguidas. Se consulta por todo el motor con este
// nombre y no comparando contra "pony" a mano, para que quede claro cuándo una
// decisión es por ser Pony y no por ser un mosto cualquiera.
function esMostoPony(mostoId) {
  return mostoId === "pony";
}

// Devuelve "go" o "hg" a partir del texto de la marca/SKU. GO y HG son el mismo
// mosto y se cuecen juntas; esto separa el PRODUCTO TERMINADO en BBT, que sí es
// distinto: un BBT de GO no sirve para envasar HG ni al revés. El nombre "Pony
// GO" no siempre aparece literal en el SKU ("PONY MALTA GO LESS SUGAR"), así
// que no basta con buscar la palabra.
function ponyVariante(texto) {
  const n = normalizeText(texto || "");
  // "Less sugar" ES la Pony GO, se escriba completo ("PONY MALTA GO LESS SUGAR
  // PET 2000CC X6") o corto ("PONY MALTA LESS SUGAR PET 1000CC X15"): en el
  // instructivo aparecen las dos formas para el mismo producto.
  if (/\bgo\b/.test(n) || /\bpmg\b/.test(n) || n.includes("less sugar"))
    return "go";
  return "hg";
}

/* ---- QUÉ ADMITE CADA BBT --------------------------------------------------
   No todo BBT sirve para todo. La planta los tiene repartidos así:
     · cerveza  (800 hL)   BBT1 a BBT8 — solo cerveza
     · cerveza  (1.300 hL) BBT19, BBT20, BBT22 — cerveza y además Pony vidrio
                           BBT24 — solo cerveza
     · Pony PET (1.200 hL) BBT21, BBT25, BBT26 — solo Pony PET
                           BBT23 — Pony vidrio y Pony PET
   El campo `admite` de cada tanque lleva esa lista. Un BBT sin `admite` no se
   restringe, para que un equipo agregado a mano desde «Equipos / Tanques» siga
   sirviendo mientras no se le indique lo contrario.
   --------------------------------------------------------------------------- */

// Envase de un texto del plan: PET o vidrio, o null si no se puede saber.
// Los SKU del instructivo sí lo dicen: los retornables de vidrio vienen como "R"
// o "RB" ("Pony Malta R 330cc X 30") y los plásticos dicen PET ("Pony Mlta Pet
// 330cc X 24"). Pero las filas del Gantt de filtración se llenan por MARCA
// ("Pony GO", "Pony HG"), que es el mosto y no dice nada del envase: ahí se
// devuelve null y no se restringe entre los dos tipos de Pony.
function envaseDeSKU(nombre) {
  const n = normalizeText(nombre || "");
  // "pet" / "r" / "rb" como palabra suelta, para no confundirse con otra que las
  // contenga.
  if (/(^|[^a-z])pet([^a-z]|$)/.test(n)) return "pet";
  if (/(^|[^a-z])(r|rb)([^a-z]|$)/.test(n)) return "vidrio";
  return null;
}

// Clases de BBT que sirven para guardar este producto. Se devuelve una lista
// porque el envase no siempre se conoce: una fila de filtración que solo dice
// "Pony HG" puede terminar en vidrio o en PET, y en ese caso valen los dos.
function clasesProductoBBT(mostoId, nombreEnvasado) {
  if (!esMostoPony(mostoId)) return ["cerveza"];
  const env = envaseDeSKU(nombreEnvasado);
  if (env === "pet") return ["ponypet"];
  if (env === "vidrio") return ["ponyvidrio"];
  return ["ponyvidrio", "ponypet"];
}

// ¿Este BBT puede recibir este producto?
function bbtAdmiteProducto(tanque, mostoId, nombreEnvasado) {
  const lista = tanque && tanque.admite;
  if (!Array.isArray(lista) || !lista.length) return true; // sin restricción
  return clasesProductoBBT(mostoId, nombreEnvasado).some(
    (c) => lista.indexOf(c) >= 0,
  );
}

// ¿El producto de un BBT sirve para envasar esta marca del plan?
// El BBT trae la marca terminada tal cual la escribe la planta ("COSTEÑITA",
// "PILSEN", "PONY GO") y el plan de envasado trae el SKU completo
// ("Costeñita R 175cc X 38"). Coincide si todas las palabras significativas de
// la marca del BBT aparecen en el nombre del SKU. En Pony manda la variante
// (Go / HG), porque "PONY GO" no aparece literal en "PONY MALTA GO LESS SUGAR";
// como además Pony GO y Pony (HG) son mostos distintos, el lote y el envasado ya
// llegan aquí separados por mosto y esta comprobación solo confirma la variante.
function marcaBBTSirvePara(marcaBBT, nombreEnvasado, mostoId) {
  const bbt = normalizeText(marcaBBT || "");
  const sku = normalizeText(nombreEnvasado || "");
  if (!bbt) return true; // sin marca registrada, no se restringe
  if (esMostoPony(mostoId)) {
    if (typeof ponyVariante !== "function") return true;
    return ponyVariante(marcaBBT) === ponyVariante(nombreEnvasado);
  }
  if (!sku) return true;
  const palabras = bbt.split(/\s+/).filter((w) => w.length > 2);
  if (!palabras.length) return true;
  return palabras.every((w) => sku.includes(w));
}

function inventoryBatchesByMosto(catalog) {
  const i0 = (typeof getI0Date === "function" && getI0Date()) || ahoraPlanta();
  const catById = {};
  (catalog || []).forEach((m) => (catById[m.id] = m));
  const out = {};
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || e.mostoId == null) return;
    if (esLevaduraEnMadurador(e)) return;
    const hL = Number(e.hL) || 0;
    if (hL <= 0) return;
    let listoEn = i0;
    if (e.tipo === "FV" || e.tipo === "SV" || e.tipo === "SV Pony") {
      const m = catById[e.mostoId];
      const dias =
        e.diasEnEquipo === "" || e.diasEnEquipo == null
          ? 0
          : Number(e.diasEnEquipo) || 0;
      const fermentDias = m ? (Number(m.tiempoFermentacionHoras) || 0) / 24 : 0;
      const maduracionDias = m
        ? (Number(m.tiempoMaduracionHoras) || 0) / 24
        : 0;
      const faltanDias =
        e.tipo === "FV"
          ? Math.max(0, fermentDias - dias) + maduracionDias
          : Math.max(0, maduracionDias - dias);
      listoEn = new Date(i0.getTime() + faltanDias * 86400000);
    }
    // BBT: producto terminado, disponible desde ya (listoEn = i0).
    // Solo los BBT de Pony llevan variante (go / hg); el resto queda en null y
    // cubre cualquier envasado de su mosto.
    const variante =
      esMostoPony(e.mostoId) && e.tipo === "BBT"
        ? ponyVariante(e.marcaTexto)
        : null;
    if (!out[e.mostoId]) out[e.mostoId] = [];
    out[e.mostoId].push({
      hL,
      listoEn,
      variante,
      esBBT: e.tipo === "BBT",
      // Marca del lote. En BBT es producto TERMINADO de una marca concreta
      // (Costeñita, Pilsen, Pony Go…) y solo sirve para envasar esa marca. En
      // FV/SV todavía es mosto sin marca definida: cubre cualquiera del mosto.
      marcaTexto: e.tipo === "BBT" ? e.marcaTexto || "" : "",
      equipo: e.equipo || "",
    });
  });
  // Se consume primero lo que está listo antes; a igualdad de fecha, primero el
  // BBT (producto terminado que hay que sacar del tanque) y luego el FV/SV.
  Object.keys(out).forEach((k) =>
    out[k].sort(
      (a, b) =>
        a.listoEn - b.listoEn || (b.esBBT ? 1 : 0) - (a.esBBT ? 1 : 0),
    ),
  );
  return out;
}

// Ocupación actual de cada equipo (FV/SV) según el inventario "producto en
// proceso". Devuelve un mapa nombreEquipoNormalizado -> {mostoId, tipo,
// faltanDias, fecha, hL, vacio}. Un FV se libera al terminar la fermentación
// del mosto; un SV al terminar la maduración; los BBT no cuentan (producto
// terminado). Los equipos vacíos quedan como disponibles (faltanDias 0).
function inventoryOccupancyByEquipo() {
  const out = {};
  const i0 = (typeof getI0Date === "function" && getI0Date()) || ahoraPlanta();
  const catById = {};
  (MOSTO_CATALOG || []).forEach((m) => (catById[m.id] = m));
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || !e.equipo || e.tipo === "BBT") return;
    const key = normalizeText(e.equipo);
    const hL = Math.round(Number(e.hL) || 0);
    const dias =
      e.diasEnEquipo === "" || e.diasEnEquipo == null
        ? 0
        : Math.round(Number(e.diasEnEquipo) || 0);

    // Madurador con levadura guardada (hL sin días): el equipo está ocupado
    // pero no hay reloj de maduración corriendo, así que no se puede calcular
    // cuándo se libera. Se marca ocupado indefinidamente (hasta que se
    // actualice el inventario) en vez de asumir una fecha de liberación falsa.
    if (esLevaduraEnMadurador(e)) {
      const faltanDias = Infinity;
      const fecha = new Date(i0.getTime() + 3650 * 86400000);
      if (!out[key] || out[key].vacio || out[key].faltanDias !== Infinity) {
        out[key] = {
          mostoId: e.mostoId || null,
          tipo: e.tipo,
          faltanDias,
          fecha,
          hL,
          vacio: false,
          levadura: true,
        };
      }
      return;
    }

    const vacio = e.vacio || (hL <= 0 && dias <= 0);
    if (vacio) {
      if (!out[key])
        out[key] = {
          mostoId: e.mostoId || null,
          tipo: e.tipo,
          faltanDias: 0,
          fecha: i0,
          hL: 0,
          vacio: true,
        };
      return;
    }
    const m = catById[e.mostoId];
    let diasReq = 0;
    if (m) {
      if (e.tipo === "FV")
        diasReq = (Number(m.tiempoFermentacionHoras) || 0) / 24;
      else diasReq = (Number(m.tiempoMaduracionHoras) || 0) / 24; // SV / SV Pony
    }
    const faltanDias = Math.max(0, diasReq - dias);
    const fecha = new Date(i0.getTime() + faltanDias * 86400000);
    if (!out[key] || out[key].vacio || faltanDias > out[key].faltanDias) {
      out[key] = {
        mostoId: e.mostoId || null,
        tipo: e.tipo,
        faltanDias,
        fecha,
        hL,
        vacio: false,
      };
    }
  });
  return out;
}

// Fecha límite más próxima para envasar lo que YA está en BBT, según
// tiempoMaxBBTHoras del catálogo. Solo Pony tiene límite (48 h en BBT); la
// cerveza no. Para cada lote de BBT de Pony: fechaLímite = I0 + (máx − horas
// que ya lleva en BBT). Si ya se pasó, la fecha cae en o antes de I0.
// Devuelve {pony: Date|null, cerveza: Date|null} (cerveza siempre null).
function proximoLimiteBBT(catalog) {
  const i0 = (typeof getI0Date === "function" && getI0Date()) || ahoraPlanta();
  const catById = {};
  (catalog || []).forEach((m) => (catById[m.id] = m));
  let pony = null;
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || e.tipo !== "BBT") return;
    const hL = Number(e.hL) || 0;
    if (hL <= 0 || e.vacio) return;
    const m = catById[e.mostoId];
    if (!m) return;
    const maxH = Number(m.tiempoMaxBBTHoras) || 0;
    if (maxH <= 0) return;
    const yaEnBBT = Number(e.almacenBBTHoras) || 0;
    const fechaLimite = new Date(
      i0.getTime() + (maxH - yaEnBBT) * 3600000,
    );
    if (esMostoPony(e.mostoId)) {
      if (!pony || fechaLimite < pony) pony = fechaLimite;
    }
  });
  return { pony, cerveza: null };
}

// Índice del inventario "producto en proceso" por nombre de equipo normalizado
// (TODOS los tipos, incluidos BBT). Si varias filas apuntan al mismo equipo,
// gana la de más hL.
function inventoryEntryByEquipo() {
  const out = {};
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || !e.equipo) return;
    const k = normalizeText(e.equipo);
    if (!out[k] || (Number(e.hL) || 0) > (Number(out[k].hL) || 0)) out[k] = e;
  });
  return out;
}

// Disponibilidad de levadura. Cada fila representa una cosecha utilizable para
// sembrar un bloque. La única compatibilidad exclusiva es Light -> Light para
// producir Light. Para los demás mostos se admite levadura general o Light.
let YEAST_AVAILABILITY = [];
try {
  YEAST_AVAILABILITY =
    JSON.parse(localStorage.getItem("planCocinasLevadura") || "[]") || [];
} catch (_) {
  YEAST_AVAILABILITY = [];
}
function saveYeastAvailability() {
  try {
    localStorage.setItem(
      "planCocinasLevadura",
      JSON.stringify(YEAST_AVAILABILITY),
    );
  } catch (_) {}
}
function yeastTypeForMosto(mostoId) {
  return mostoId === "light" ? "light" : "general";
}
function yeastCompatible(sourceMostoId, targetMostoId) {
  if (targetMostoId === "light") return sourceMostoId === "light";
  return true;
}
function yeastAvailableDate(row) {
  if (!row || row.disponible === false) return null;
  if (!row.disponibleDesde) return getI0Date() || ahoraPlanta();
  const d = new Date(row.disponibleDesde);
  return isNaN(d.getTime()) ? null : d;
}

// Días de fermentación tras los cuales ya se puede cosechar la levadura de un FV.
const YEAST_HARVEST_DAYS = 6;

// La levadura SOLO se cosecha de los fermentadores EXT (EXT 1, EXT 2, ...).
function esFermentadorEXT(nombre) {
  return /^\s*ext\b/i.test(String(nombre || ""));
}

// Cosechas de levadura previstas, disponibles a los YEAST_HARVEST_DAYS días de
// fermentación y SOLO desde fermentadores EXT:
//  · inventario "producto en proceso" (FVs EXT ya en fermentación) →
//    I0 + max(0, 6 − días en el equipo).
//  · asignación de tanques del plan (lotes FV en un EXT) → primer cocimiento
//    del lote + 6 días.
// Devuelve [{ mostoId, tipo:"light"|"general", fuente, fechaDisponible }].
function computedYeastHarvests(tankAssignment) {
  const i0 = (typeof getI0Date === "function" && getI0Date()) || ahoraPlanta();
  const out = [];

  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || e.tipo !== "FV" || !e.mostoId || !esFermentadorEXT(e.equipo))
      return;
    const dias =
      e.diasEnEquipo === "" || e.diasEnEquipo == null
        ? 0
        : Number(e.diasEnEquipo) || 0;
    const falta = Math.max(0, YEAST_HARVEST_DAYS - dias);
    out.push({
      mostoId: e.mostoId,
      tipo: yeastTypeForMosto(e.mostoId),
      fuente: "Inventario · " + e.equipo,
      fechaDisponible: new Date(i0.getTime() + falta * 86400000),
    });
  });

  // Lotes FV programados en un EXT: un lote = todo lo asignado a un mismo EXT.
  // La fermentación del lote empieza con su primer cocimiento.
  const lotes = {};
  ((tankAssignment && tankAssignment.rows) || []).forEach((row) => {
    if (
      !row ||
      row.tanqueTipo !== "FV" ||
      !esFermentadorEXT(row.tanque) ||
      !(row.start instanceof Date)
    )
      return;
    const k = (row.tanqueId || row.tanque) + "|" + row.mostoId;
    if (!lotes[k] || row.start < lotes[k].start)
      lotes[k] = { mostoId: row.mostoId, tanque: row.tanque, start: row.start };
  });
  Object.values(lotes).forEach((l) => {
    out.push({
      mostoId: l.mostoId,
      tipo: yeastTypeForMosto(l.mostoId),
      fuente: "Programado · " + l.tanque,
      fechaDisponible: new Date(
        Math.max(l.start.getTime(), i0.getTime()) +
          YEAST_HARVEST_DAYS * 86400000,
      ),
    });
  });

  return out.sort((a, b) => a.fechaDisponible - b.fechaDisponible);
}

// Inventario real de equipos/tanques cargado desde la matriz proporcionada.
// AguaPromedio e indiceAguaCapacidad son informativos; la asignación utiliza capacidad,
// prioridad, tipo y disponibilidad. Todos quedan disponibles inicialmente y pueden
// desmarcarse desde la tabla.
let TANK_CATALOG = [
  // FV — equipos EXT nuevos del inventario físico. Se les asigna prioridad A
  // por su mayor capacidad, para favorecer lotes más grandes y reducir CIP pequeños.
  {
    id: "fv_ext1",
    equipo: "EXT 1",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 7200,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_ext2",
    equipo: "EXT 2",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 4800,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_ext3",
    equipo: "EXT 3",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 7200,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_ext4",
    equipo: "EXT 4",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 7200,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_ext5",
    equipo: "EXT 5",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 4800,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_ext6",
    equipo: "EXT 6",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 7200,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_ext8",
    equipo: "EXT 8",
    tipo: "FV",
    aguaPromedio: 0,
    capacidadHL: 4800,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_45_309",
    equipo: "45-309",
    tipo: "FV",
    aguaPromedio: 58.25,
    capacidadHL: 900,
    indiceAguaCapacidad: 0.065,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_41_309",
    equipo: "41-309",
    tipo: "FV",
    aguaPromedio: 63.8,
    capacidadHL: 900,
    indiceAguaCapacidad: 0.071,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_43_309",
    equipo: "43-309",
    tipo: "FV",
    aguaPromedio: 64.88,
    capacidadHL: 900,
    indiceAguaCapacidad: 0.072,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_42_309",
    equipo: "42-309",
    tipo: "FV",
    aguaPromedio: 71.45,
    capacidadHL: 900,
    indiceAguaCapacidad: 0.079,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_46_309",
    equipo: "46-309",
    tipo: "FV",
    aguaPromedio: 72.55,
    capacidadHL: 900,
    indiceAguaCapacidad: 0.081,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_44_309",
    equipo: "44-309",
    tipo: "FV",
    aguaPromedio: 73.38,
    capacidadHL: 900,
    indiceAguaCapacidad: 0.082,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_51_309a",
    equipo: "51-309A",
    tipo: "FV",
    aguaPromedio: 76.0,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.101,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_50_309a",
    equipo: "50-309A",
    tipo: "FV",
    aguaPromedio: 76.45,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.102,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_47_309a",
    equipo: "47-309A",
    tipo: "FV",
    aguaPromedio: 80.25,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.107,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_52_310",
    equipo: "52-310",
    tipo: "FV",
    aguaPromedio: 84.11,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.112,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_53_310",
    equipo: "53-310",
    tipo: "FV",
    aguaPromedio: 85.5,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.114,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_55_310",
    equipo: "55-310",
    tipo: "FV",
    aguaPromedio: 87.5,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.117,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_56_310",
    equipo: "56-310",
    tipo: "FV",
    aguaPromedio: 87.5,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.117,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_57_310",
    equipo: "57-310",
    tipo: "FV",
    aguaPromedio: 88.38,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.118,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_49_309a",
    equipo: "49-309A",
    tipo: "FV",
    aguaPromedio: 90.92,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.121,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_58_310",
    equipo: "58-310",
    tipo: "FV",
    aguaPromedio: 96.63,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.129,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_54_310",
    equipo: "54-310",
    tipo: "FV",
    aguaPromedio: 102.0,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.136,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "fv_48_309a",
    equipo: "48-309A",
    tipo: "FV",
    aguaPromedio: 108.75,
    capacidadHL: 750,
    indiceAguaCapacidad: 0.145,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  // SV — equipos EXT nuevos del inventario físico. Se les asigna prioridad A
  // por su mayor capacidad, para favorecer tanques llenos y reducir CIP pequeños.
  {
    id: "sv_ext7",
    equipo: "EXT 7",
    tipo: "SV",
    aguaPromedio: 0,
    capacidadHL: 3200,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_ext9",
    equipo: "EXT 9",
    tipo: "SV",
    aguaPromedio: 0,
    capacidadHL: 5300,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_ext10",
    equipo: "EXT 10",
    tipo: "SV",
    aguaPromedio: 0,
    capacidadHL: 8500,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_ext11",
    equipo: "EXT 11",
    tipo: "SV",
    aguaPromedio: 0,
    capacidadHL: 8500,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  // "EXT 14" no existe: no aparece en ninguna hoja del inventario "producto en
  // proceso", y su capacidad (820 hL) coincide con la de 14-210, que sí está en
  // el reporte. Era el mismo tonel con un nombre mal transcrito, y por contarlo
  // aparte salían 15 maduradores donde la planta tiene 14.
  // No tenemos su consumo de agua medido: queda en 0 y con prioridad A como sus
  // hermanos de 820 hL, y se puede ajustar desde «Equipos / Tanques».
  {
    id: "sv_14_210",
    equipo: "14-210",
    tipo: "SV",
    aguaPromedio: 0,
    capacidadHL: 820,
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_17_210",
    equipo: "17-210",
    tipo: "SV",
    aguaPromedio: 63.63,
    capacidadHL: 820,
    indiceAguaCapacidad: 0.078,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_16_210",
    equipo: "16-210",
    tipo: "SV",
    aguaPromedio: 68.0,
    capacidadHL: 820,
    indiceAguaCapacidad: 0.083,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_15_210",
    equipo: "15-210",
    tipo: "SV",
    aguaPromedio: 74.75,
    capacidadHL: 820,
    indiceAguaCapacidad: 0.091,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_9_209",
    equipo: "9-209",
    tipo: "SV",
    aguaPromedio: 104.75,
    capacidadHL: 1000,
    indiceAguaCapacidad: 0.105,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_6_209",
    equipo: "6-209",
    tipo: "SV",
    aguaPromedio: 90.75,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.106,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_7_209",
    equipo: "7-209",
    tipo: "SV",
    aguaPromedio: 98.83,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.115,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_18_210",
    equipo: "18-210",
    tipo: "SV",
    aguaPromedio: 111.05,
    capacidadHL: 820,
    indiceAguaCapacidad: 0.135,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_8_209",
    equipo: "8-209",
    tipo: "SV",
    aguaPromedio: 119.13,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.139,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "sv_19_210",
    equipo: "19-210",
    tipo: "SV",
    aguaPromedio: 115.0,
    capacidadHL: 820,
    indiceAguaCapacidad: 0.14,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  // SV Pony
  {
    id: "svpony_4_209",
    equipo: "4-209",
    tipo: "SV Pony",
    aguaPromedio: 85.9,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.1,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "svpony_2_209",
    equipo: "2-209",
    tipo: "SV Pony",
    aguaPromedio: 88.1,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.102,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "svpony_3_209",
    equipo: "3-209",
    tipo: "SV Pony",
    aguaPromedio: 88.7,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.103,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "svpony_1_209",
    equipo: "1-209",
    tipo: "SV Pony",
    aguaPromedio: 89.9,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.105,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "svpony_5_209",
    equipo: "5-209",
    tipo: "SV Pony",
    aguaPromedio: 93.2,
    capacidadHL: 860,
    indiceAguaCapacidad: 0.108,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  // BBT
  {
    id: "bbt19",
    equipo: "BBT19",
    tipo: "BBT",
    aguaPromedio: 37.42,
    capacidadHL: 1300,
    admite: ["cerveza", "ponyvidrio"],
    indiceAguaCapacidad: 0.029,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt22",
    equipo: "BBT22",
    tipo: "BBT",
    aguaPromedio: 52.56,
    capacidadHL: 1300,
    admite: ["cerveza", "ponyvidrio"],
    indiceAguaCapacidad: 0.04,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt24",
    equipo: "BBT24",
    tipo: "BBT",
    aguaPromedio: 62.21,
    capacidadHL: 1300,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.048,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt20",
    equipo: "BBT20",
    tipo: "BBT",
    aguaPromedio: 75.75,
    capacidadHL: 1300,
    admite: ["cerveza", "ponyvidrio"],
    indiceAguaCapacidad: 0.058,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt2",
    equipo: "BBT2",
    tipo: "BBT",
    aguaPromedio: 53.79,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.067,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt1",
    equipo: "BBT1",
    tipo: "BBT",
    aguaPromedio: 57.03,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.071,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt7",
    equipo: "BBT7",
    tipo: "BBT",
    aguaPromedio: 57.56,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.072,
    prioridad: "B",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt3",
    equipo: "BBT3",
    tipo: "BBT",
    aguaPromedio: 60.58,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.076,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt5",
    equipo: "BBT5",
    tipo: "BBT",
    aguaPromedio: 62.88,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.079,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt4",
    equipo: "BBT4",
    tipo: "BBT",
    aguaPromedio: 63.63,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.08,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt6",
    equipo: "BBT6",
    tipo: "BBT",
    aguaPromedio: 71.64,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0.09,
    prioridad: "C",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  // Estos cinco están en la hoja "BBTs" del producto en proceso pero faltaban
  // aquí, así que no contaban como espacio de dilución.
  // OJO: no tenemos su capacidad ni su consumo de agua medidos. La capacidad va
  // por serie —BBT1 a BBT8 son de 800 hL y BBT19 a BBT26 de 1.300 hL, que es lo
  // que traen sus hermanos ya cargados— y el agua queda en 0 con prioridad A.
  // Hay que confirmar ambos datos y corregirlos desde «Equipos / Tanques».
  {
    id: "bbt8",
    equipo: "BBT8",
    tipo: "BBT",
    aguaPromedio: 0,
    capacidadHL: 800,
    admite: ["cerveza"],
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt21",
    equipo: "BBT21",
    tipo: "BBT",
    aguaPromedio: 0,
    capacidadHL: 1200,
    admite: ["ponypet"],
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt23",
    equipo: "BBT23",
    tipo: "BBT",
    aguaPromedio: 0,
    capacidadHL: 1200,
    admite: ["ponyvidrio", "ponypet"],
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt25",
    equipo: "BBT25",
    tipo: "BBT",
    aguaPromedio: 0,
    capacidadHL: 1200,
    admite: ["ponypet"],
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
  {
    id: "bbt26",
    equipo: "BBT26",
    tipo: "BBT",
    aguaPromedio: 0,
    capacidadHL: 1200,
    admite: ["ponypet"],
    indiceAguaCapacidad: 0,
    prioridad: "A",
    disponible: true,
    aseoHoras: parseHMS("1:00:00"),
  },
];

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}
function normalizeText(str) {
  return (str || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}
// Convierte "hh:mm:ss", "hh:mm" o un número simple de horas a horas decimales.
function parseHMS(str) {
  if (str === null || str === undefined) return 0;
  const s = String(str).trim();
  if (!s) return 0;
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some((p) => isNaN(p))) return 0;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] + parts[1] / 60;
  return parts[0] + parts[1] / 60 + parts[2] / 3600;
}
// Convierte horas decimales a "hh:mm:ss" para mostrar en el input.
function formatHMS(hoursFloat) {
  const totalSeconds = Math.max(
    0,
    Math.round((Number(hoursFloat) || 0) * 3600),
  );
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

