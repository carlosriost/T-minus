/* =========================================================================
   EVENTOS DE UI — carga de archivo, tema, wiring de botones
   ========================================================================= */
/* =========================================================================
   7) EVENTOS DE UI
   ========================================================================= */
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const statusEl = document.getElementById("status");

const uploadCompact = document.getElementById("uploadCompact");
const uploadCompactName = document.getElementById("uploadCompactName");
const changeFileBtn = document.getElementById("changeFileBtn");
const programI0Input = document.getElementById("programI0Input");
const i0Badge = document.getElementById("i0Badge");

// I0 se guarda localmente para que no tengas que escribirlo cada vez que abras el HTML.
// El valor por defecto toma la fecha Y HORA actuales (hora de pared local), para poder
// programar cocimientos enseguida el mismo día I0 sin tener que ajustar la hora a mano.
const savedI0 = localStorage.getItem("planCocinasI0");
const todayUTC = new Date();
const defaultI0 =
  savedI0 ||
  toInputDateTimeUTC(
    new Date(
      Date.UTC(
        todayUTC.getFullYear(),
        todayUTC.getMonth(),
        todayUTC.getDate(),
        todayUTC.getHours(),
        todayUTC.getMinutes(),
      ),
    ),
  );
programI0Input.value = defaultI0;
function refreshI0Badge() {
  const d = getI0Date();
  i0Badge.textContent = d ? `I0: ${fmtDateTime(d)}` : "I0: —";
  if (STATE && STATE.parsed) {
    const meta = document.getElementById("weekMeta");
    meta.textContent =
      (STATE.parsed.weekLabel || "") +
      (STATE.parsed.weekStartDate
        ? "  ·  primer día: " + fmtDate(STATE.parsed.weekStartDate)
        : "") +
      (STATE.parsed.headerDate
        ? "  ·  plan enviado: " + fmtDate(STATE.parsed.headerDate)
        : "") +
      (d ? "  ·  I0: " + fmtDateTime(d) : "");
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

function handleFile(file) {
  if (!file) return;
  statusEl.classList.remove("error");
  statusEl.textContent = "Leyendo " + file.name + "...";
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, {
        type: "array",
        cellDates: true,
      });
      const parsed = parseWorkbook(workbook);
      render(parsed);
      statusEl.textContent =
        "Listo — " + file.name + " procesado correctamente.";
      // Oculta la zona de arrastre y muestra la barra compacta con el nombre del archivo
      dropZone.classList.add("hidden");
      uploadCompactName.textContent = file.name;
      uploadCompact.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      statusEl.classList.add("error");
      statusEl.textContent = "Error: " + err.message;
      document.getElementById("results").classList.add("hidden");
      document.getElementById("ganttTopPanel").classList.add("hidden");
    }
  };
  reader.onerror = () => {
    statusEl.classList.add("error");
    statusEl.textContent = "No se pudo leer el archivo.";
  };
  reader.readAsArrayBuffer(file);
}

fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
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

changeFileBtn.addEventListener("click", () => {
  uploadCompact.classList.add("hidden");
  dropZone.classList.remove("hidden");
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
function applyTheme(theme) {
  document.body.classList.toggle("theme-light", theme === "light");
  if (themeToggleBtn)
    themeToggleBtn.textContent =
      theme === "light" ? "🌙 Modo oscuro" : "☀️ Modo claro";
}
let currentTheme = "dark";
try {
  currentTheme = localStorage.getItem(THEME_KEY) || "dark";
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
