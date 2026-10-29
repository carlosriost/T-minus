# T-minus

Planeación de envasado, cocinas y servicios para la cervecería, en una sola página web.

**Abrir:** https://carlosriost.github.io/T-minus/

## Qué hace

| Área | Qué muestra |
|---|---|
| Inicio | Resumen del plan cargado, lo que requiere atención y qué archivos faltan |
| Envasado | Gantt de líneas y filtración, T-minus por línea, acuerdos de servicio |
| Cocinas | Plan de cocinas calculado desde el instructivo, programa real, plan vs. real y trazabilidad del cocimiento al envasado |
| Servicios | Vapor, electricidad y agua esperados por línea a partir del volumen (modelos validados con el Excel de indicadores), y CIP |

## Archivos que usa

1. **Plan de envasado** (instructivo Suite 360, `.xlsx`). Obligatorio.
2. **Producto en proceso** (FV / SV / BBT). Opcional.
3. **Programa de cocinas real** (Excel de Elaboración). Opcional.
4. **Indicadores de servicios** (`.xlsm` de MED Servicios). Opcional.

Los archivos se leen y procesan **en el navegador**: no se envían a ningún servidor y este repositorio no contiene datos de planta. Lo que la app recuerda (catálogos, modelos de servicios, calificaciones) queda en el almacenamiento local de cada navegador.

## Técnico

HTML, CSS y JavaScript sin compilación. La única dependencia externa es SheetJS (CDN) para leer Excel. Para publicar basta con GitHub Pages sobre la rama `main`, carpeta raíz.

---

Elaborado por Ingeniería y Servicios.
