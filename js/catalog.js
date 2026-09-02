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
  },
  {
    id: "pony",
    nombre: "Pony",
    palabras: "pony",
    factorDilucion: 3.23,
    volumenPorCocimiento: 600,
    tiempoCocinaHoras: parseHMS("8:15:00"),
    tiempoFermentacionHoras: parseHMS("0"),
    tiempoMaduracionHoras: parseHMS("24:00:00"),
    tiempoEntreCarguesHoras: parseHMS("2:50:00"),
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
  },
];

// Catálogo de aseos (CIP) entre cambios de marca: duración según marca de origen → marca de destino.
// "origen" y "destino" se homologan contra el catálogo de mostos igual que las marcas del Excel
// (mismo matchMosto), así "Aguila" homologa a Estandar salvo que diga "Aguila Light".
// Si una combinación no está definida, se usa ASEO_DEFAULT_HORAS (o el inverso, si existe).
// Reglas fijas (no requieren fila en la matriz): no se programa aseo cuando origen y destino son
// la misma marca, ni cuando el origen es Pony (ver getAseoDuracion).
let ASEO_MATRIX = [
  {
    origen: "Pilsen",
    destino: "Estandar",
    duracionHoras: parseHMS("3:50:00"),
  },
  {
    origen: "Light",
    destino: "Estandar",
    duracionHoras: parseHMS("3:50:00"),
  },
  {
    origen: "Estandar",
    destino: "Pony",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Pilsen",
    destino: "Light",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Light",
    destino: "Pony",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Estandar",
    destino: "Light",
    duracionHoras: parseHMS("4:40:00"),
  },
  {
    origen: "Pilsen",
    destino: "Pony",
    duracionHoras: parseHMS("4:40:00"),
  },
];
let ASEO_DEFAULT_HORAS = parseHMS("3:50:00");

// Aseo periódico (general): un aseo (CIP) adicional que se inserta automáticamente cada N
// cocimientos consecutivos en la secuencia semanal, independientemente del mosto o de si hay
// cambio de marca. Totalmente editable desde el panel "Aseo periódico (general)".
let ASEO_PERIODICO = {
  activo: false,
  duracionHoras: parseHMS("3:50:00"),
  cocimientosEntreAseos: 18,
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
// Suma el HL normalizado de todos los lotes por mosto — es lo que consume computeCocinaPlan().
function inventoryTotalsByMosto(catalog) {
  const totals = {};
  (catalog || []).forEach((m) => (totals[m.id] = 0));
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || e.mostoId == null) return;
    totals[e.mostoId] = (totals[e.mostoId] || 0) + (Number(e.hL) || 0);
  });
  return totals;
}

// Ocupación actual de cada equipo (FV/SV) según el inventario "producto en
// proceso". Devuelve un mapa nombreEquipoNormalizado -> {mostoId, tipo,
// faltanDias, fecha, hL, vacio}. Un FV se libera al terminar la fermentación
// del mosto; un SV al terminar la maduración; los BBT no cuentan (producto
// terminado). Los equipos vacíos quedan como disponibles (faltanDias 0).
function inventoryOccupancyByEquipo() {
  const out = {};
  const i0 = (typeof getI0Date === "function" && getI0Date()) || new Date();
  const catById = {};
  (MOSTO_CATALOG || []).forEach((m) => (catById[m.id] = m));
  (INVENTORY_BALANCE || []).forEach((e) => {
    if (!e || !e.equipo || e.tipo === "BBT") return;
    const key = normalizeText(e.equipo);
    const hL = Math.round(Number(e.hL) || 0);
    const dias =
      e.diasEnEquipo === "" || e.diasEnEquipo == null
        ? 0
        : Number(e.diasEnEquipo) || 0;
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
  if (!row.disponibleDesde) return getI0Date() || new Date();
  const d = new Date(row.disponibleDesde);
  return isNaN(d.getTime()) ? null : d;
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
  {
    id: "sv_ext14",
    equipo: "EXT 14",
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
    indiceAguaCapacidad: 0.09,
    prioridad: "C",
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

