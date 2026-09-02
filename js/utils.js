/* =========================================================================
   UTILIDADES — fechas UTC, formato, helpers varios
   ========================================================================= */
/* =========================================================================
   1) PARSEO DEL EXCEL
   ========================================================================= */
const TRAINS = ["5", "7", "8", "9"];
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

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
  // returns {h,m,s} from a Date (time-only cells still parse as Date via cellDates:true)
  if (isDateLike(v))
    return {
      h: v.getUTCHours(),
      m: v.getUTCMinutes(),
      s: v.getUTCSeconds(),
    };
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

