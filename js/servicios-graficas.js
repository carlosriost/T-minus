/* Gráficas SVG sin dependencias (funcionan sin internet). */
(function (raiz) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function ticks(min, max, n) {
    if (!(max > min)) { max = min + 1; }
    const paso0 = (max - min) / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const paso = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((p) => p >= paso0) || paso0;
    const out = [];
    for (let v = Math.ceil(min / paso) * paso; v <= max + 1e-9; v += paso) out.push(+v.toFixed(10));
    return out;
  }
  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " M";
    if (a >= 1e4) return (v / 1e3).toLocaleString("es-CO", { maximumFractionDigits: 0 }) + " k";
    if (a >= 1000) return (v / 1e3).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " k";
    return v.toLocaleString("es-CO", { maximumFractionDigits: a < 10 ? 2 : 0 });
  }
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  function marco(el, W, H, m, xs, ys, opt) {
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const [x0, x1] = xs, [y0, y1] = ys;
    const X = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * iw;
    const Y = (v) => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
    let s = "";
    ticks(y0, y1, 5).forEach((t) => {
      s += `<line class="rej" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    });
    if (opt.xFecha) {
      const d0 = new Date(x0), d1 = new Date(x1);
      for (let d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1)); d <= d1; d.setUTCMonth(d.getUTCMonth() + 1)) {
        if (d.getTime() < x0) continue;
        s += `<line class="rej" x1="${X(d.getTime())}" x2="${X(d.getTime())}" y1="${m.t}" y2="${m.t + ih}"/><text x="${X(d.getTime()) + 3}" y="${H - m.b + 15}">${MESES[d.getUTCMonth()]}</text>`;
      }
    } else {
      ticks(x0, x1, 6).forEach((t) => {
        s += `<text x="${X(t)}" y="${H - m.b + 15}" text-anchor="middle">${fmt(t)}</text>`;
      });
    }
    s += `<line class="eje" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
    if (opt.xLab) s += `<text class="titulo-eje" x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(opt.xLab)}</text>`;
    if (opt.yLab) s += `<text class="titulo-eje" transform="translate(12 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(opt.yLab)}</text>`;
    return { X, Y, s, iw, ih };
  }

  function montar(el, W, H, cuerpo, aria) {
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria || "gráfica")}">${cuerpo}</svg>`;
  }

  // Dispersión producción vs. consumo, con curva del modelo y banda del intervalo.
  function dispersion(el, o) {
    const W = o.W || 640, H = o.H || 320, m = { l: 62, r: 14, t: 12, b: 40 };
    const xsP = o.puntos.map((p) => p.x).concat(o.curva ? o.curva.map((p) => p.x) : []).concat(o.marcador ? [o.marcador.x] : []);
    const ysP = o.puntos.map((p) => p.y).concat(o.banda ? o.banda.map((p) => p.hi) : []).concat(o.marcador ? [o.marcador.hi || o.marcador.y] : []);
    const x1 = Math.max(1, ...xsP) * 1.03, y1 = Math.max(1, ...ysP) * 1.06;
    const f = marco(el, W, H, m, [0, x1], [0, y1], o);
    let s = f.s;
    if (o.rango) s += `<rect x="${f.X(o.rango[0])}" y="${m.t}" width="${Math.max(0, f.X(o.rango[1]) - f.X(o.rango[0]))}" height="${f.ih}" fill="var(--panel2)" opacity=".7"/>`;
    if (o.banda && o.banda.length) {
      const arriba = o.banda.map((p) => `${f.X(p.x)},${f.Y(p.hi)}`).join(" ");
      const abajo = o.banda.slice().reverse().map((p) => `${f.X(p.x)},${f.Y(p.lo)}`).join(" ");
      s += `<polygon points="${arriba} ${abajo}" fill="var(--band)"/>`;
    }
    o.puntos.forEach((p) => {
      const tip = p.tip ? ` data-tip="${esc(p.tip)}"` : "";
      if (p.forma === "x") {
        const a = 3.2;
        s += `<path d="M${f.X(p.x) - a},${f.Y(p.y) - a}L${f.X(p.x) + a},${f.Y(p.y) + a}M${f.X(p.x) - a},${f.Y(p.y) + a}L${f.X(p.x) + a},${f.Y(p.y) - a}" stroke="${p.color}" stroke-width="1.6"${tip}/>`;
      } else if (p.forma === "rombo") {
        const a = 4.2;
        s += `<path d="M${f.X(p.x)},${f.Y(p.y) - a}L${f.X(p.x) + a},${f.Y(p.y)}L${f.X(p.x)},${f.Y(p.y) + a}L${f.X(p.x) - a},${f.Y(p.y)}Z" fill="none" stroke="${p.color}" stroke-width="1.6"${tip}/>`;
      } else if (p.forma === "anillo") {
        s += `<circle cx="${f.X(p.x)}" cy="${f.Y(p.y)}" r="4" fill="none" stroke="${p.color}" stroke-width="1.6"${tip}/>`;
      } else {
        s += `<circle cx="${f.X(p.x)}" cy="${f.Y(p.y)}" r="${p.r || 3}" fill="${p.color}" fill-opacity="${p.op || 0.55}"${tip}/>`;
      }
    });
    if (o.curva && o.curva.length) s += `<polyline points="${o.curva.map((p) => `${f.X(p.x)},${f.Y(p.y)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.4"/>`;
    if (o.diagonal) s += `<line x1="${f.X(0)}" y1="${f.Y(0)}" x2="${f.X(Math.min(x1, y1))}" y2="${f.Y(Math.min(x1, y1))}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
    if (o.marcador) {
      const k = o.marcador;
      if (k.lo != null) s += `<line x1="${f.X(k.x)}" x2="${f.X(k.x)}" y1="${f.Y(k.lo)}" y2="${f.Y(k.hi)}" stroke="var(--ink)" stroke-width="2"/>`;
      s += `<circle cx="${f.X(k.x)}" cy="${f.Y(k.y)}" r="6" fill="var(--ink)" stroke="var(--panel)" stroke-width="2" data-tip="${esc(k.tip || "")}"/>`;
    }
    montar(el, W, H, s, o.aria);
  }

  // Series en el tiempo (x = ms).
  function lineas(el, o) {
    const W = o.W || 640, H = o.H || 260, m = { l: 62, r: 14, t: 12, b: 40 };
    const todos = o.series.flatMap((s) => s.puntos);
    if (!todos.length) { el.innerHTML = '<p class="muted">Sin datos.</p>'; return; }
    const x0 = Math.min(...todos.map((p) => p.x)), x1 = Math.max(...todos.map((p) => p.x));
    const yMin = o.yMin != null ? o.yMin : Math.min(0, ...todos.map((p) => p.lo != null ? p.lo : p.y));
    const y1 = Math.max(...todos.map((p) => (p.hi != null ? p.hi : p.y))) * 1.06;
    const f = marco(el, W, H, m, [x0, x1], [yMin, y1], Object.assign({ xFecha: true }, o));
    let s = f.s;
    if (o.corte) s += `<line x1="${f.X(o.corte)}" x2="${f.X(o.corte)}" y1="${m.t}" y2="${m.t + f.ih}" stroke="var(--ink)" stroke-dasharray="5 4"/><text x="${f.X(o.corte) + 4}" y="${m.t + 11}">prueba final →</text>`;
    if (o.cero) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${f.Y(0)}" y2="${f.Y(0)}" stroke="var(--muted)"/>`;
    o.series.forEach((se) => {
      if (se.banda) {
        const arriba = se.puntos.map((p) => `${f.X(p.x)},${f.Y(p.hi)}`).join(" ");
        const abajo = se.puntos.slice().reverse().map((p) => `${f.X(p.x)},${f.Y(p.lo)}`).join(" ");
        s += `<polygon points="${arriba} ${abajo}" fill="var(--band)"/>`;
      }
      if (se.tipo === "puntos") {
        se.puntos.forEach((p) => (s += `<circle cx="${f.X(p.x)}" cy="${f.Y(p.y)}" r="${se.r || 2.6}" fill="${p.color || se.color}" fill-opacity=".75"${p.tip ? ` data-tip="${esc(p.tip)}"` : ""}/>`));
      } else {
        let d = "";
        let prev = null;
        se.puntos.forEach((p) => {
          const corta = prev && p.x - prev.x > (o.huecoMs || 3 * 86400000);
          d += `${!prev || corta ? "M" : "L"}${f.X(p.x)},${f.Y(p.y)}`;
          prev = p;
        });
        s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.ancho || 1.6}"${se.guiones ? ' stroke-dasharray="5 4"' : ""}/>`;
      }
    });
    montar(el, W, H, s, o.aria);
  }

  // Barras con rango opcional (lo–hi).
  function barras(el, o) {
    const W = o.W || 640, H = o.H || 260, m = { l: 62, r: 14, t: 14, b: 44 };
    const vals = o.valores;
    const y1 = Math.max(1e-9, ...vals.map((v) => (v.hi != null ? v.hi : v.v))) * 1.1;
    const f = marco(el, W, H, m, [0, vals.length], [0, y1], Object.assign({}, o, { xFecha: false }));
    let s = f.s.replace(/<text x="[^"]*" y="[^"]*" text-anchor="middle">[^<]*<\/text>/g, "");
    const bw = f.iw / vals.length;
    vals.forEach((v, i) => {
      const x = m.l + i * bw + bw * 0.18, w = bw * 0.64;
      s += `<rect x="${x}" y="${f.Y(v.v)}" width="${w}" height="${Math.max(0, f.Y(0) - f.Y(v.v))}" fill="${v.color || "var(--accent)"}" rx="3"${v.tip ? ` data-tip="${esc(v.tip)}"` : ""}/>`;
      if (v.lo != null) s += `<line x1="${x + w / 2}" x2="${x + w / 2}" y1="${f.Y(v.lo)}" y2="${f.Y(v.hi)}" stroke="var(--ink)" stroke-width="1.6"/>`;
      s += `<text x="${x + w / 2}" y="${H - m.b + 15}" text-anchor="middle">${esc(o.cats[i])}</text>`;
    });
    montar(el, W, H, s, o.aria);
  }

  // Barras apiladas por categoría (p. ej. días) con varias series y una raya
  // opcional de rango para el total.
  function apiladas(el, o) {
    const W = o.W || 900, H = o.H || 280, m = { l: 62, r: 14, t: 14, b: 46 };
    const n = o.cats.length;
    if (!n) { el.innerHTML = '<p class="muted">Sin datos.</p>'; return; }
    const tot = o.cats.map((_, i) => o.series.reduce((s, se) => s + (se.valores[i] || 0), 0));
    const y1 = Math.max(1e-9, ...tot, ...(o.rangos || []).map((r) => (r ? r[1] : 0))) * 1.08;
    const f = marco(el, W, H, m, [0, n], [0, y1], Object.assign({}, o, { xFecha: false }));
    let s = f.s.replace(/<text x="[^"]*" y="[^"]*" text-anchor="middle">[^<]*<\/text>/g, "");
    const bw = f.iw / n;
    const cada = Math.max(1, Math.ceil(n / (o.maxEtiquetas || 16)));
    for (let i = 0; i < n; i++) {
      const x = m.l + i * bw + bw * 0.14, w = bw * 0.72;
      let acum = 0;
      o.series.forEach((se) => {
        const v = se.valores[i] || 0;
        if (v <= 0) return;
        s += `<rect x="${x}" y="${f.Y(acum + v)}" width="${w}" height="${Math.max(0, f.Y(acum) - f.Y(acum + v))}" fill="${se.color}"${se.tips ? ` data-tip="${esc(se.tips[i] || "")}"` : ""}/>`;
        acum += v;
      });
      if (o.rangos && o.rangos[i]) s += `<line x1="${x + w / 2}" x2="${x + w / 2}" y1="${f.Y(o.rangos[i][0])}" y2="${f.Y(o.rangos[i][1])}" stroke="var(--ink)" stroke-width="1.4" opacity=".7"/>`;
      if (o.marcas && o.marcas[i]) s += `<text x="${x + w / 2}" y="${f.Y(acum) - 4}" text-anchor="middle" style="fill:var(--warn)">${esc(o.marcas[i])}</text>`;
      if (i % cada === 0) s += `<text x="${x + w / 2}" y="${H - m.b + 15}" text-anchor="middle">${esc(o.cats[i])}</text>`;
    }
    montar(el, W, H, s, o.aria);
  }

  function conectarTips(raizEl) {
    let tip = document.getElementById("srvTip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "srvTip";
      tip.className = "srv-tip";
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    raizEl.addEventListener("pointermove", (e) => {
      const t = e.target.closest && e.target.closest("[data-tip]");
      if (!t || !t.getAttribute("data-tip")) { tip.hidden = true; return; }
      tip.textContent = t.getAttribute("data-tip");
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 12, y = e.clientY + 12;
      if (x + w > innerWidth - 8) x = e.clientX - w - 12;
      if (y + h > innerHeight - 8) y = e.clientY - h - 12;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    });
    raizEl.addEventListener("pointerleave", () => (tip.hidden = true));
  }

  raiz.SrvCharts = { dispersion, lineas, barras, apiladas, conectarTips, fmt };
})(window);
