/* =========================================================================
   UTILIDADES — fechas, formato, helpers varios

   ===== UN SOLO CALENDARIO PARA TODA LA PLANTA =====

   Toda la aplicación —plan de envasado, cocina, fermentación, maduración,
   filtración, BBT y los Gantt de cada proceso— trabaja sobre UNA SOLA línea de
   tiempo, en la hora de pared de la planta:

       America/Bogota (UTC-5)

   Un instante como "10 de septiembre de 2026 08:30" significa exactamente lo
   mismo en todos los módulos. No hay calendarios independientes ni orígenes
   propios por módulo, y el I0 es solo una marca de referencia sobre ese
   calendario: NUNCA un reinicio del tiempo.

   CÓMO SE GUARDA UNA FECHA
   ------------------------
   Cada instante se guarda en un Date cuyos COMPONENTES UTC son la hora de pared
   de la planta. Es decir: las 08:30 de Bogotá se guardan como un Date cuyo
   getUTCHours() vale 8 y getUTCMinutes() vale 30.

   Se hace así, y no guardando el instante absoluto, por una razón práctica: el
   navegador aplica su propia zona horaria a getHours(), a los constructores y a
   la aritmética de fechas. Si se guardara el instante absoluto, el mismo plan se
   vería corrido varias horas —y por lo tanto en otro día— según cómo esté
   configurado el computador donde se abra. Con esta convención el plan se lee
   idéntico en cualquier máquina: no hay conversiones de zona horaria en ningún
   punto, así que no hay desplazamientos posibles.

   REGLAS PARA NO ROMPERLO
   -----------------------
   1. Leer y escribir SIEMPRE con getUTC* / Date.UTC(). Nunca getHours(),
      getDate(), setHours() ni new Date(y, m, d) sobre una fecha de planta: esos
      usan la zona del navegador y corren la fecha.
   2. Nunca usar toISOString() para MOSTRAR una fecha (fmtDate / fmtDateTime son
      las funciones de presentación). Sirve solo para depurar.
   3. La hora actual se obtiene con ahoraPlanta(), no con new Date(): new Date()
      da el reloj del computador, que puede estar en otra zona.
   4. Las fechas que vienen de Excel entran por excelPartesFecha() y
      excelPartesHora(): SheetJS las construye en la zona LOCAL del navegador, y
      esos dos ayudantes las traen a esta convención. No leerlas directo.
   ========================================================================= */
/* =========================================================================
   1) PARSEO DEL EXCEL
   ========================================================================= */
const TRAINS = ["5", "7", "8", "9"];
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Zona horaria de la planta. Es el único calendario del sistema.
const PLANTA_TZ = "America/Bogota";

// La hora actual EN LA PLANTA, en la convención de arriba. Se pregunta por la
// hora de Bogotá explícitamente en vez de usar new Date() a secas, para que el
// programa dé lo mismo aunque el computador esté configurado en otra zona (o de
// viaje). Si el navegador no soporta la consulta por zona, cae a su reloj local.
function ahoraPlanta() {
  const ahora = new Date();
  try {
    const p = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: PLANTA_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(ahora)
      .forEach((x) => (p[x.type] = x.value));
    if (p.year)
      return new Date(
        Date.UTC(
          Number(p.year),
          Number(p.month) - 1,
          Number(p.day),
          Number(p.hour) % 24,
          Number(p.minute),
          Number(p.second),
        ),
      );
  } catch (_) {}
  return new Date(
    Date.UTC(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate(),
      ahora.getHours(),
      ahora.getMinutes(),
      ahora.getSeconds(),
    ),
  );
}

/* ---- ENTRADA DESDE EXCEL ------------------------------------------------
   SheetJS (0.18.5, cellDates:true) construye los Date en la zona LOCAL del
   navegador: la celda que en Excel dice "22:00" llega como un Date cuyo
   getHours() vale 22 y cuyo getUTCHours() vale 02:56 (el desfase de Bogotá en
   la época 1899 que Excel usa de ancla para las celdas de solo hora).
   Es decir: los componentes LOCALES son el valor real que se ve en Excel y los
   UTC están corridos. Estos dos ayudantes leen los componentes locales —el
   valor bueno— para pasarlos a la convención de la planta.
   ------------------------------------------------------------------------ */
function excelPartesFecha(v) {
  if (!isDateLike(v) || isNaN(v.getTime())) return null;
  return { y: v.getFullYear(), mo: v.getMonth(), d: v.getDate() };
}
function excelPartesHora(v) {
  if (!isDateLike(v) || isNaN(v.getTime())) return null;
  return { h: v.getHours(), m: v.getMinutes(), s: v.getSeconds() };
}
// Celda de Excel con FECHA Y HORA → instante en la convención de la planta.
function excelFechaHoraAPlanta(v) {
  const p = excelPartesFecha(v);
  const h = excelPartesHora(v);
  return p && h ? new Date(Date.UTC(p.y, p.mo, p.d, h.h, h.m, h.s)) : null;
}
// Celda de Excel con FECHA (se ignora la hora) → fecha de planta a medianoche.
function excelFechaAPlanta(v) {
  const p = excelPartesFecha(v);
  return p ? new Date(Date.UTC(p.y, p.mo, p.d)) : null;
}

function addDays(date, n) {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function isDateLike(v) {
  return v instanceof Date;
}
function cellTimeParts(v) {
  // Hora {h,m,s} de una celda de Excel. Las celdas de "solo hora" también llegan
  // como Date por cellDates:true.
  // OJO: se leen los componentes LOCALES. Antes se leían los UTC y eso corría
  // toda hora leída del Excel 4:56 h (una celda "22:00" entraba como 02:56 del
  // día siguiente), porque SheetJS construye los Date en la zona del navegador.
  if (isDateLike(v)) return excelPartesHora(v);
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) return { h: +m[1], m: +m[2], s: +(m[3] || 0) };
  }
  return null;
}
function combine(dateBase, timeParts) {
  const d = new Date(
    Date.UTC(
      dateBase.getUTCFullYear(),
      dateBase.getUTCMonth(),
      dateBase.getUTCDate(),
      timeParts.h,
      timeParts.m,
      timeParts.s,
    ),
  );
  return d;
}
function fmtDate(d) {
  return (
    DAY_NAMES[d.getUTCDay()] +
    " " +
    String(d.getUTCDate()).padStart(2, "0") +
    "/" +
    String(d.getUTCMonth() + 1).padStart(2, "0")
  );
}
function fmtDateTime(d) {
  return (
    fmtDate(d) +
    " " +
    String(d.getUTCHours()).padStart(2, "0") +
    ":" +
    String(d.getUTCMinutes()).padStart(2, "0")
  );
}
function parseInputDateUTC(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
// Igual que parseInputDateUTC pero también acepta el valor de un input
// datetime-local ("YYYY-MM-DDTHH:mm"), conservando la hora para poder usarla
// como piso mínimo de arranque del primer cocimiento (programar "enseguida").
function parseInputDateTimeUTC(value) {
  if (!value) return null;
  const m = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/,
  );
  if (!m) return null;
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]) || 0,
      Number(m[5]) || 0,
    ),
  );
}
function toInputDateUTC(d) {
  if (!d || isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function toInputDateTimeUTC(d) {
  if (!d || isNaN(d.getTime())) return "";
  return `${toInputDateUTC(d)}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
function getI0Date() {
  const input = document.getElementById("programI0Input");
  return input ? parseInputDateTimeUTC(input.value) : null;
}
function fmtI0Offset(date, i0 = getI0Date()) {
  if (!date || !i0) return "—";
  const days = Math.round((new Date(date).getTime() - i0.getTime()) / 86400000);
  return days === 0 ? "I0" : days > 0 ? `I+${days}` : `I${days}`;
}
function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60),
    m = totalMin % 60;
  return String(h).padStart(3, "0") + ":" + String(m).padStart(2, "0");
}
function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}
// Algunas plantillas guardan la celda "FECHA" como TEXTO (no como fecha real de Excel),
// típicamente en formato colombiano día/mes/año, p.ej. "01/09/2026". cellDates:true de
// SheetJS solo convierte celdas numéricas con formato de fecha; una celda de texto queda
// como string aunque se vea con apariencia de fecha, por eso hace falta este parseo aparte.
function parseDMYStringUTC(v) {
  if (isBlank(v) || isDateLike(v)) return null;
  const m = String(v)
    .trim()
    .match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]),
    month = Number(m[2]),
    year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

