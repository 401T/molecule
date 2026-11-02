'use strict';
/* =====================================================================
   Liquid Glass エンジン
   ybouane/liquidglass のシェーダー（角丸の高さ場による屈折・色収差・鏡面反射）と同じ考え方を、
   SVG フィルタ（feDisplacementMap）＋ backdrop-filter で実装したもの。
   WebGL を使わないので、ボタンの数だけガラスを置いても GPU コンテキストを消費しない。

   ・data-glass      … 浮遊パネル（縁で屈折するスラブ）
   ・data-refract    … 浮いているボタン類。値 "dome" はレンズ（全体が拡大して見える）
   ・.lens           … セグメント・タブで選択位置へすばやく移動するガラスのレンズ
   ・range           … スライダーのつまみを、ドラッグ中だけ透明なガラスに変える
   ・select[data-glass-menu] … ボタンからガラスのメニューへ変形するポップアップ
   backdrop-filter の url() に対応する Chromium 系だけ屈折し、それ以外はぼかし＋光沢になる。
   ===================================================================== */
const LiquidGlass = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const supported = !!window.chrome && CSS.supports('backdrop-filter', 'blur(1px)');
  const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let enabled = supported;
  const defs = () => document.getElementById('lgDefs');
  const filters = new Map();          // 大きさ・形ごとのフィルタ（同じ形は共有）
  const tracked = new Set();

  /* ---------- 変位マップ ----------
     bevel：縁だけが丸い板ガラス。高さ h(d)=√(d(2R−d)) の傾きで外側の景色を引き込む
     dome ：中央が盛り上がったレンズ。中心へ寄せて拡大して見せる */
  function makeMap(w, h, r, mode) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const hw = w / 2, hh = h / 2;
    r = Math.min(r, hw, hh);
    const bevel = Math.max(2, Math.min(mode === 'dome' ? Math.min(hw, hh) : 26, Math.min(w, h) * 0.42));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - hw, py = y + 0.5 - hh;
        const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
        const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
        const inside = -sdf;
        let nx = 0, ny = 0, m = 0;
        if (inside > 0) {
          // 外向きの法線（距離場の勾配）
          if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; }
          else if (qx > qy) nx = 1; else ny = 1;
          nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
          if (inside < bevel) {
            const t = inside / bevel;                       // 0（縁）→ 1（平らな部分）
            const slope = (1 - t) / Math.sqrt(Math.max(1e-3, t * (2 - t)));
            m = Math.min(1, slope * 0.38);
          }
          if (mode === 'dome') {
            // レンズ：中心からの距離に比例して内側へ（拡大）。縁の屈折と合成する
            const rx = px / hw, ry = py / hh;
            nx = nx * m - rx * 0.55; ny = ny * m - ry * 0.55; m = 1;
          }
        }
        const i = (y * w + x) * 4;
        d[i] = 128 + Math.max(-1, Math.min(1, nx * m)) * 127;
        d[i + 1] = 128 + Math.max(-1, Math.min(1, ny * m)) * 127;
        d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  // 色収差つきの屈折フィルタ：R・G・B を少しずつ違う強さでずらして合成する
  function filterFor(w, h, r, mode) {
    const key = `${w}x${h}r${Math.round(r)}${mode}`;
    if (filters.has(key)) return filters.get(key);
    const id = 'lg' + filters.size;
    const f = document.createElementNS(NS, 'filter');
    f.id = id;
    for (const [k, val] of Object.entries({ 'color-interpolation-filters': 'sRGB', filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h })) f.setAttribute(k, val);
    const base = mode === 'dome' ? -Math.min(26, Math.min(w, h) * 0.5) : Math.min(60, Math.min(w, h) * 0.9);
    const ca = mode === 'dome' ? 0.06 : 0.08;   // 色収差の強さ
    const disp = (s, res) => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(base * s).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="${res}"/>`;
    const img = `<feImage href="${makeMap(w, h, r, mode)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>`;
    // 大きな面は色収差を省いて 1 回の変位だけにする（見た目の差は小さく、描画は約 3 倍速い）
    f.innerHTML = w * h > 40000 ? img + disp(1, 'out') : img +
      disp(1, 'dr') + disp(1 - ca, 'dg') + disp(1 - 2 * ca, 'db') +
      '<feColorMatrix in="dr" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>' +
      '<feColorMatrix in="dg" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>' +
      '<feColorMatrix in="db" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>' +
      '<feComposite in="r" in2="g" operator="arithmetic" k2="1" k3="1" result="rg"/>' +
      '<feComposite in="rg" in2="b" operator="arithmetic" k2="1" k3="1"/>';
    defs().appendChild(f);
    filters.set(key, id);
    return id;
  }

  const active = () => enabled && !reduceTransparency.matches;

  function apply(el) {
    if (!active()) { el.style.backdropFilter = ''; return; }
    // transform で拡大縮小している要素は元の大きさで作る
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (w < 4 || h < 4) return;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
    const mode = el.dataset.refract === 'dome' ? 'dome' : 'bevel';
    const id = filterFor(Math.ceil(w / 2) * 2, Math.ceil(h / 2) * 2, r, mode);
    const blur = el.dataset.blur ?? (el.hasAttribute('data-glass') ? 'var(--blur)' : mode === 'dome' ? '0px' : '3px');
    el.style.backdropFilter = `url(#${id}) blur(${blur}) saturate(190%) brightness(1.04)`;
  }

  const ro = supported ? new ResizeObserver((es) => es.forEach((e) => apply(e.target))) : null;
  function track(el) {
    if (tracked.has(el)) return;
    tracked.add(el);
    if (ro) ro.observe(el);
    apply(el);
  }

  // フィルタを差し替えた直後に Chromium が古い合成結果を使い続けることがあるので、一度外して付け直す
  let refreshTimer = 0;
  function refreshAll() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const all = [...tracked].filter((e) => e.isConnected);
      all.forEach((e) => { e.style.backdropFilter = ''; });
      requestAnimationFrame(() => requestAnimationFrame(() => all.forEach(apply)));
    }, 160);
  }

  /* ---------- 選択位置へ移動するガラスのレンズ（GlassEffectContainer のモーフィングに相当） ---------- */
  function attachLens(container) {
    if (!container || container.classList.contains('has-lens')) return;
    container.classList.add('has-lens');
    const lens = document.createElement('span');
    lens.className = 'lens';
    lens.setAttribute('aria-hidden', 'true');
    container.prepend(lens);
    let last = null;
    const place = () => {
      const on = container.querySelector(':scope > .on');
      if (!on || !on.offsetWidth) { lens.style.opacity = '0'; last = null; return; }
      const box = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
      if (last && last.x === box.x && last.y === box.y && last.w === box.w && last.h === box.h) return;
      const moved = !!last;
      if (!moved) lens.classList.add('no-anim');
      lens.style.opacity = '1';
      lens.style.width = box.w + 'px'; lens.style.height = box.h + 'px';
      lens.style.transform = `translate(${box.x}px, ${box.y}px)`;
      if (!moved) { void lens.offsetWidth; lens.classList.remove('no-anim'); }
      last = box;
    };
    new MutationObserver((ms) => { if (ms.some((m) => m.target !== lens)) place(); })
      .observe(container, { subtree: true, attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(place).observe(container);
    place();
  }

  /* ---------- スライダー：つまみをドラッグ中だけガラスにする ---------- */
  function enhanceRange(input) {
    if (input.parentElement?.classList.contains('range')) return input.parentElement;
    const wrap = document.createElement('div');
    wrap.className = 'range';
    input.replaceWith(wrap);
    wrap.appendChild(input);
    const knob = document.createElement('span');
    knob.className = 'knob';
    wrap.appendChild(knob);
    input.addEventListener('input', () => setRange(input));
    // iOS は細いつまみに正確に触れないと動き出さないので、溝全体で指の位置を受け取って値を決める
    const valueAt = (x) => {
      const r = wrap.getBoundingClientRect(), kw = knob.offsetWidth || 40;
      const f = Math.max(0, Math.min(1, (x - r.left - kw / 2) / Math.max(1, r.width - kw)));
      const min = +input.min, max = +input.max, step = +input.step || 1;
      return Math.min(max, Math.max(min, Math.round((min + f * (max - min)) / step) * step));
    };
    const setFrom = (x) => {
      const v = valueAt(x);
      if (+input.value === v) return;
      input.value = v;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let active = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      active = e.pointerId;
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('dragging'); knob.dataset.refract = 'dome'; track(knob);
      setFrom(e.clientX);
    });
    wrap.addEventListener('pointermove', (e) => { if (e.pointerId === active) setFrom(e.clientX); });
    const end = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      wrap.classList.remove('dragging');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    return wrap;
  }
  function setRange(input) {
    const wrap = enhanceRange(input);
    const f = (+input.value - +input.min) / ((+input.max - +input.min) || 1);
    wrap.style.setProperty('--pf', Math.max(0, Math.min(1, f)));
  }

  /* ---------- ボタンからガラスのメニューへ変形するポップアップ ---------- */
  function glassMenu(select) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-label', select.getAttribute('aria-label') || '');
    const label = () => { btn.innerHTML = `<span>${select.selectedOptions[0].textContent}</span><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>`; };
    label();
    select.hidden = true;
    select.after(btn);
    let menu = null;
    const close = () => {
      if (!menu) return;
      const m = menu; menu = null;
      m.classList.add('closing');
      setTimeout(() => { tracked.delete(m); m.remove(); }, 260);
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
    btn.addEventListener('click', () => {
      if (menu) { close(); return; }
      const r = btn.getBoundingClientRect();
      menu = document.createElement('div');
      menu.className = 'glass glass-menu';
      menu.dataset.glass = 'menu';
      menu.setAttribute('role', 'listbox');
      menu.innerHTML = [...select.options].map((o) => `<button type="button" role="option" data-v="${o.value}" class="${o.selected ? 'on' : ''}"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>${o.textContent}</button>`).join('');
      document.body.appendChild(menu);
      const mw = menu.offsetWidth;
      const left = Math.min(innerWidth - mw - 8, Math.max(8, r.right - mw));
      menu.style.left = left + 'px';
      menu.style.top = (r.bottom + 8) + 'px';
      // ボタンの位置・大きさから伸びてメニューになる
      menu.style.transformOrigin = `${r.left + r.width / 2 - left}px -8px`;
      menu.style.setProperty('--from-sx', (r.width / mw).toFixed(3));
      menu.style.setProperty('--from-sy', (r.height / menu.offsetHeight).toFixed(3));
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('[data-v]'); if (!b) return;
        select.value = b.dataset.v;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        label(); close();
      });
      menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
      document.addEventListener('pointerdown', outside, true);
      menu.querySelector('.on, button')?.focus({ preventScroll: true });
    });
  }

  /* ---------- 触れた点から光る・押すと膨らむ（インタラクティブなガラス） ---------- */
  const INTERACTIVE = '.btn, .mini-btn, .chipbtn, .pel, .ic, .menu-btn, .glass-menu button, .tab, .seg > button, .modebar > button, .nv, .cand, .sl-item';
  function bindInteraction() {
    let cur = null;
    const release = () => { if (cur) { cur.classList.remove('pressing'); cur = null; } };
    document.addEventListener('pointerdown', (e) => {
      const el = e.target.closest(INTERACTIVE);
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--px', `${e.clientX - r.left}px`);
      el.style.setProperty('--py', `${e.clientY - r.top}px`);
      el.classList.add('pressing');
      cur = el;
    }, { passive: true });
    document.addEventListener('pointerup', release, { passive: true });
    document.addEventListener('pointercancel', release, { passive: true });
    // パネルの光沢はポインタの位置に追従する
    window.addEventListener('pointermove', (e) => {
      for (const el of document.querySelectorAll('[data-glass]')) {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
    }, { passive: true });
  }

  function scan(root = document) {
    root.querySelectorAll('[data-glass], [data-refract]').forEach(track);
  }

  function init() {
    scan();
    // 後から追加された要素（メニューなど）にも適用する
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches('[data-glass], [data-refract]')) track(n);
        scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll('[data-lens]').forEach(attachLens);
    document.querySelectorAll('select[data-glass-menu]').forEach(glassMenu);
    bindInteraction();
    // スイッチのつまみ（押している間のガラス）用のレンズフィルタ
    if (supported) document.documentElement.style.setProperty('--lg-knob-filter', `url(#${filterFor(48, 32, 16, 'dome')})`);
    reduceTransparency.addEventListener('change', () => tracked.forEach(apply));
    window.addEventListener('resize', refreshAll);
    refreshAll();
  }

  // 分子を回している間は、大きなパネルの屈折を止めてぼかしだけにする（フレームレート優先）
  let motionTimer = 0;
  function setMotion(on, linger = 350) {
    clearTimeout(motionTimer);
    if (on) document.documentElement.classList.add('lg-motion');
    else motionTimer = setTimeout(() => document.documentElement.classList.remove('lg-motion'), linger);
  }

  function setEnabled(on) {
    enabled = supported && on;
    tracked.forEach(apply);
    refreshAll();
  }

  return { init, setEnabled, setMotion, setRange, attachLens, refreshAll, get supported() { return supported; }, get enabled() { return enabled; } };
})();
