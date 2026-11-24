/* =========================================================================
   EVENTOS DE UI — carga de archivo, tema, wiring de botones
   ========================================================================= */
/* =========================================================================
   7) EVENTOS DE UI
   ========================================================================= */
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const statusEl = document.getElementById("status");

const programI0Input = document.getElementById("programI0Input");
const i0Badge = document.getElementById("i0Badge");

// I0 se guarda localmente para que no tengas que escribirlo cada vez que abras el HTML.
// El valor por defecto es la fecha Y HORA actuales EN LA PLANTA (America/Bogota), para
// poder programar cocimientos enseguida el mismo día I0 sin ajustar la hora a mano.
const savedI0 = localStorage.getItem("planCocinasI0");
const defaultI0 = savedI0 || toInputDateTimeUTC(ahoraPlanta());
programI0Input.value = defaultI0;
function refreshI0Badge() {
  const d = getI0Date();
  i0Badge.textContent = d ? `I0: ${fmtDateTime(d)}` : "I0: —";
  if (STATE && STATE.parsed) {
    setWeekMeta(STATE.parsed, d);
    recompute();
  }
}
programI0Input.addEventListener("change", () => {
  const d = getI0Date();
  if (!d) return;
  localStorage.setItem("planCocinasI0", programI0Input.value);
  refreshI0Badge();
});
refreshI0Badge();

// El plan nacional de envase por planta (CSV con columnas AG01 … UN01, PAÍS)
// se confunde fácil con el instructivo: no trae líneas, SKU ni horas.
function esPlanNacionalPorPlanta(workbook) {
  try {
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const fila = (XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || []).map((x) => String(x || "").toUpperCase());
    return fila.includes("UN01") && fila.some((x) => /^PA.?S$/.test(x.trim()));
  } catch (_) {
    return false;
  }
}

// Lee el instructivo desde sus bytes. opts.restaurado: viene de lo guardado en
// este navegador (o de un paquete) al abrir la página.
function procesarInstructivo(buffer, nombre, opts) {
  opts = opts || {};
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: "array", cellDates: true });
  let parsed;
  try {
    parsed = parseWorkbook(workbook);
  } catch (err) {
    if (esPlanNacionalPorPlanta(workbook))
      throw new Error(
        "Ese archivo es el plan nacional de envase por planta (columnas AG01 … UN01 y PAÍS): trae solo hL por planta y por día, sin líneas, SKU ni horas. Aquí va el instructivo de envasado de Suite 360 (.xlsx) con las hojas de la semana.",
      );
    throw new Error(err.message + " ¿Es el instructivo de envasado de Suite 360 (.xlsx)?");
  }
  if (opts.restaurado) parsed.__restaurado = true;
  if (typeof VOL_ARCHIVO_ACTUAL !== "undefined") VOL_ARCHIVO_ACTUAL = nombre;
  render(parsed);
  if (window.DatosEntrada) DatosEntrada.instructivoCargado(buffer, nombre, opts);
  // Historial de planes (comparación de plan y acumulado del mes).
  if (window.HistorialPlanes) HistorialPlanes.registrar(nombre, opts).catch((e) => console.error(e));
  return parsed;
}

function handleFile(file) {
  if (!file) return;
  statusEl.classList.remove("error");
  statusEl.textContent = "Leyendo " + file.name + "...";
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      procesarInstructivo(e.target.result, file.name);
      statusEl.textContent = "";
    } catch (err) {
      console.error(err);
      statusEl.classList.add("error");
      statusEl.textContent = "Error: " + err.message;
    }
  };
  reader.onerror = () => {
    statusEl.classList.add("error");
    statusEl.textContent = "No se pudo leer el archivo.";
  };
  reader.readAsArrayBuffer(file);
}

fileInput.addEventListener("change", (e) => {
  handleFile(e.target.files[0]);
  e.target.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag");
  }),
);
dropZone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

// ---- Ocultar/mostrar el panel de catálogos hacia el lado ----
// (La navegación por menú lateral reemplaza este control; se mantiene
//  null-safe por si los elementos ya no existen en el HTML.)
const configTabsEl = document.getElementById("configTabs");
const catalogsBar = document.getElementById("catalogsBar");
const toggleCatalogsBtn = document.getElementById("toggleCatalogsBtn");
const sideCatalogsTab = document.getElementById("sideCatalogsTab");
function collapseCatalogs() {
  if (configTabsEl) configTabsEl.classList.add("hidden");
  if (catalogsBar) catalogsBar.classList.add("hidden");
  if (sideCatalogsTab) sideCatalogsTab.classList.remove("hidden");
}
function expandCatalogs() {
  if (configTabsEl) configTabsEl.classList.remove("hidden");
  if (catalogsBar) catalogsBar.classList.remove("hidden");
  if (sideCatalogsTab) sideCatalogsTab.classList.add("hidden");
}
if (toggleCatalogsBtn)
  toggleCatalogsBtn.addEventListener("click", collapseCatalogs);
if (sideCatalogsTab)
  sideCatalogsTab.addEventListener("click", expandCatalogs);

// ---- Modo oscuro / claro ----
const THEME_KEY = "envasado-theme";
const themeToggleBtn = document.getElementById("themeToggleBtn");
// Botón de solo ícono: luna en modo claro (pasa a oscuro), sol en oscuro.
const ICO_LUNA = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICO_SOL = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
function applyTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
  if (themeToggleBtn) {
    themeToggleBtn.innerHTML = theme === "light" ? ICO_LUNA : ICO_SOL;
    const t = theme === "light" ? "Cambiar a modo oscuro" : "Cambiar a modo claro";
    themeToggleBtn.title = t;
    themeToggleBtn.setAttribute("aria-label", t);
  }
}
// Por defecto, modo claro: es el más tranquilo para trabajar de día.
let currentTheme = "light";
try {
  currentTheme = localStorage.getItem(THEME_KEY) || "light";
} catch (_) {}
applyTheme(currentTheme);
if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    applyTheme(currentTheme);
    try {
      localStorage.setItem(THEME_KEY, currentTheme);
    } catch (_) {}
  });
}
