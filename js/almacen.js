/* =========================================================================
   ALMACÉN LOCAL (IndexedDB)
   -------------------------------------------------------------------------
   Guarda datos grandes en el navegador (los modelos de servicios pesan
   varios MB y no caben en localStorage junto con lo demás). Queda en este
   navegador y este computador, sobrevive a recargas y reinicios, y solo se
   borra si el usuario lo pide (botón «Limpiar datos») o limpia los datos
   del sitio en el navegador. Se pide al navegador almacenamiento
   persistente para que no lo borre por falta de espacio.
   No hay servidor: nada sale de este equipo.
   ========================================================================= */
(function (raiz) {
  "use strict";
  const BD = "tminus", ALMACEN = "datos", VERSION = 1;
  let abierta = null;

  function abrir() {
    if (abierta) return abierta;
    abierta = new Promise((ok, mal) => {
      if (!raiz.indexedDB) return mal(new Error("Este navegador no tiene IndexedDB"));
      const req = raiz.indexedDB.open(BD, VERSION);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(ALMACEN)) req.result.createObjectStore(ALMACEN); };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => mal(req.error || new Error("No se pudo abrir el almacén local"));
      req.onblocked = () => mal(new Error("El almacén local está bloqueado por otra pestaña"));
    });
    abierta.catch(() => (abierta = null));
    return abierta;
  }
  function tx(modo, fn) {
    return abrir().then((db) => new Promise((ok, mal) => {
      const t = db.transaction(ALMACEN, modo), st = t.objectStore(ALMACEN);
      let res;
      const r = fn(st);
      if (r) r.onsuccess = () => (res = r.result);
      t.oncomplete = () => ok(res);
      t.onerror = () => mal(t.error || new Error("Error del almacén local"));
      t.onabort = () => mal(t.error || new Error("Escritura cancelada (¿sin espacio?)"));
    }));
  }
  const leer = (clave) => tx("readonly", (st) => st.get(clave));
  const escribir = (clave, valor) => tx("readwrite", (st) => st.put(valor, clave));
  const borrar = (clave) => tx("readwrite", (st) => st.delete(clave));

  // Pide almacenamiento persistente (el navegador puede concederlo sin preguntar).
  let persistente = null;
  function pedirPersistencia() {
    try {
      if (raiz.navigator && navigator.storage && navigator.storage.persist) {
        return navigator.storage.persisted().then((ya) => (ya ? true : navigator.storage.persist())).then((v) => (persistente = !!v)).catch(() => (persistente = false));
      }
    } catch (_) {}
    persistente = false;
    return Promise.resolve(false);
  }
  const esPersistente = () => persistente;

  raiz.TMAlmacen = { leer, escribir, borrar, pedirPersistencia, esPersistente };
})(typeof window !== "undefined" ? window : globalThis);
