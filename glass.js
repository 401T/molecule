'use strict';
/* Liquid Glass：縁で背景が屈折する効果（SVG feDisplacementMap を backdrop-filter に適用）。
   Chromium 系のみ backdrop-filter の url() に対応するため、それ以外ではぼかし＋ハイライトのみになる。 */
const LiquidGlass = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const supported = !!window.chrome && CSS.supports('backdrop-filter', 'blur(1px)');
  const defs = () => document.getElementById('lgDefs');
  const els = new Map();
  let enabled = supported;

  // 角丸長方形の縁だけを外向きにずらす変位マップ（R: x方向, G: y方向, 128 が無変位）
  function makeMap(w, h, r, band) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const hw = w / 2, hh = h / 2;
    r = Math.min(r, hw, hh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hw, py = y + 0.5 - hh;
        const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        const sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;   // 内側で負
        const dist = -sdf;
        let nx = 0, ny = 0, m = 0;
        if (dist < band) {
          const t = 1 - Math.max(0, dist) / band;
          m = t * t * (3 - 2 * t);
          if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; }
          else if (qx > qy) nx = 1; else ny = 1;
          nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
        }
        const i = (y * w + x) * 4;
        d[i] = 128 + nx * m * 127; d[i + 1] = 128 + ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  function build(el) {
    const id = 'lg-' + el.dataset.glass;
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    const key = `${w}x${h}`;
    const rec = els.get(el) || {};
    if (rec.key === key) return;
    rec.key = key; els.set(el, rec);
    let f = document.getElementById(id);
    if (!f) {
      f = document.createElementNS(NS, 'filter');
      f.id = id;
      f.setAttribute('color-interpolation-filters', 'sRGB');
      f.setAttribute('filterUnits', 'userSpaceOnUse');
      f.setAttribute('primitiveUnits', 'userSpaceOnUse');
      f.innerHTML = '<feImage result="map" preserveAspectRatio="none"/><feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G"/>';
      defs().appendChild(f);
    }
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 24;
    const band = Math.min(28, Math.min(w, h) * 0.35);
    f.setAttribute('x', 0); f.setAttribute('y', 0); f.setAttribute('width', w); f.setAttribute('height', h);
    const im = f.querySelector('feImage');
    im.setAttribute('x', 0); im.setAttribute('y', 0); im.setAttribute('width', w); im.setAttribute('height', h);
    im.setAttribute('href', makeMap(w, h, radius, band));
    f.querySelector('feDisplacementMap').setAttribute('scale', Math.min(70, band * 2.2).toFixed(0));
    scheduleRefresh();
  }

  // フィルタ定義を差し替えた直後は Chromium が他パネルの合成結果を古いまま使い、文字が白っぽく残ることがある。
  // 変更が落ち着いたら全パネルのフィルタを一度外して付け直し、描き直させる
  let refreshTimer = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const all = document.querySelectorAll('[data-glass]');
      all.forEach((e) => { e.style.backdropFilter = ''; });
      requestAnimationFrame(() => requestAnimationFrame(() => all.forEach(apply)));
    }, 150);
  }

  function apply(el) {
    const id = 'lg-' + el.dataset.glass;
    const v = enabled ? `url(#${id}) blur(var(--g-blur)) saturate(180%)` : '';
    el.style.backdropFilter = v;
    el.style.webkitBackdropFilter = '';
  }

  function init() {
    const list = document.querySelectorAll('[data-glass]');
    if (supported) {
      const ro = new ResizeObserver((entries) => entries.forEach((e) => {
        if (e.contentRect.width > 0) build(e.target);
      }));
      list.forEach((el) => ro.observe(el));
    }
    // ポインタ追従の光沢
    window.addEventListener('pointermove', (e) => {
      for (const el of list) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
    }, { passive: true });
  }

  function setEnabled(on) {
    enabled = supported && on;
    document.querySelectorAll('[data-glass]').forEach(apply);
  }

  return { init, setEnabled, get supported() { return supported; }, get enabled() { return enabled; } };
})();
