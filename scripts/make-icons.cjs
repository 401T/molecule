// アプリアイコンを 1 つの原図から全サイズ作る（Apple のアプリアイコンの指針に沿う）。
//   npx electron scripts/make-icons.cjs
// ・iOS（apple-touch-icon）：正方形いっぱいに描き、透明部分を作らない。角丸はシステムが付ける
// ・macOS（.icns）：1024 の中に 824 の角丸正方形（連続曲率の角）を置き、下に柔らかい影を付ける
// ・PWA：通常用は角丸の形、マスク用は分子を安全領域（中央 80%）に収める
// ・図柄：正四面体形の炭素（sp³）を球棒モデルで立体的に描く。文字は入れず、色は青の濃淡だけにする
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const S = 1024;

// 分子の配置：正四面体の 4 方向。手前に 2 つ・奥に 2 つが重ならずに見える向き（画面上で原子どうしの間隔が最大になる角度を計算で選んだ）
const L = 310, RC = 100, RO = 70;   // 結合の長さ、中心と周りの球の半径（px）
function molecule() {
  const r = Math.sqrt(8) / 3, dirs = [[0, -1, 0]];
  for (const deg of [28, 148, 268]) { const a = deg * Math.PI / 180; dirs.push([r * Math.cos(a), 1 / 3, r * Math.sin(a)]); }
  const tilt = 30 * Math.PI / 180, c = Math.cos(tilt), s = Math.sin(tilt);
  const rot = ([x, y, z]) => [x, y * c - z * s, y * s + z * c];
  const D = 1100, cx = 512, cy = 524;
  const proj = ([x, y, z]) => { const k = D / (D - z); return { x: cx + x * k, y: cy + y * k, z: z / L, k }; };
  return dirs.map(rot).map((d) => ({
    atom: proj(d.map((v) => v * L)),
    from: proj(d.map((v) => v * RC * 0.92)),          // 中心の球の表面から
    to: proj(d.map((v) => v * (L - RO * 0.92))),      // 周りの球の表面まで
  })).concat([{ center: proj([0, 0, 0]) }]);
}
// 奥にある球ほど背景の青に少し溶けこませて、奥行きを出す
function sphere(p, r, id) {
  const at = `cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"`;
  const haze = Math.max(0, -p.z) * 0.32;
  return `<circle ${at} fill="url(#ball)"/><circle ${at} fill="url(#rim)"/>` +
    (haze ? `<circle ${at} fill="#2a6ff0" fill-opacity="${haze.toFixed(2)}"/>` : '');
}
function bond(a, b, w) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
  return `<g transform="translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${ang.toFixed(2)})"><rect x="0" y="${-w / 2}" width="${len.toFixed(1)}" height="${w}" rx="${w / 2}" fill="url(#stick)"/></g>`;
}

// 正方形いっぱいの原図（scale：分子の大きさ。マスク用は小さくする）
function art(scale = 1) {
  const m = molecule(), center = m.pop().center;
  const items = [{ z: 0, svg: sphere(center, RC, 'c') }];
  for (const { atom, from, to } of m) {
    // 結合は手前なら中心の球の上、奥なら下に描き、周りの球はいつも結合の上に描く
    const haze = Math.max(0, -atom.z) * 0.32;
    items.push({ z: atom.z * 0.5, svg: `<g opacity="${(1 - haze * 0.6).toFixed(2)}">${bond(from, to, 44 * (from.k + to.k) / 2)}</g>` });
    items.push({ z: atom.z + 0.001, svg: sphere(atom, RO * atom.k, 'o') });
  }
  items.sort((a, b) => a.z - b.z);
  const t = `translate(512 512) scale(${scale}) translate(-512 -512)`;
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5cb8ff"/><stop offset=".55" stop-color="#2a7bf6"/><stop offset="1" stop-color="#1f4fd8"/>
    </linearGradient>
    <radialGradient id="glow" cx=".5" cy=".38" r=".62">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ball" cx=".36" cy=".3" r=".78">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#f1f6ff"/><stop offset="1" stop-color="#b4c9f3"/>
    </radialGradient>
    <radialGradient id="rim" cx=".5" cy=".5" r=".5">
      <stop offset=".82" stop-color="#1c4fc4" stop-opacity="0"/><stop offset="1" stop-color="#1c4fc4" stop-opacity=".22"/>
    </radialGradient>
    <linearGradient id="stick" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c9d9f8"/><stop offset=".35" stop-color="#ffffff"/><stop offset="1" stop-color="#9fb8ea"/>
    </linearGradient>
    <filter id="drop" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#0b2a86" flood-opacity=".38"/>
    </filter>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <rect width="${S}" height="${S}" fill="url(#glow)"/>
  <g transform="${t}" filter="url(#drop)">${items.map((i) => i.svg).join('')}</g>`;
}

// 連続曲率の角丸正方形（超楕円 n=5 で近似）
function squircle(x0, y0, size, n = 5) {
  const a = size / 2, cx = x0 + a, cy = y0 + a, pts = [];
  for (let i = 0; i < 360; i++) {
    const t = i / 360 * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push(`${(cx + a * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)},${(cy + a * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const full = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${art(scale)}</svg>`;
// 角丸の形に切り抜いたもの（margin：macOS は 100、それ以外は 0）
const shaped = (margin, shadow) => {
  const body = S - margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs><clipPath id="sq"><path d="${squircle(margin, margin, body)}"/></clipPath>
  ${shadow ? '<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".28"/></filter>' : ''}</defs>
  ${shadow ? `<path d="${squircle(margin, margin, body)}" fill="#1f4fd8" filter="url(#sh)"/>` : ''}
  <g clip-path="url(#sq)"><g transform="translate(${margin} ${margin}) scale(${body / S})"><svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${art(1)}</svg></g></g>
</svg>`;
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body></body>');
  const png = async (svg, size, file) => {
    const data = await win.webContents.executeJavaScript(`new Promise((ok, ng) => {
      const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${size};
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png')); };
      img.onerror = ng; img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))}; })`);
    fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  };
  const out = (f) => path.join(ROOT, f);

  fs.writeFileSync(out('logo.svg'), full(1));                 // 画面内のロゴ（角丸は CSS で付ける）
  fs.writeFileSync(out('icon.svg'), shaped(0, false));        // ファビコン
  await png(full(1), 180, out('apple-touch-icon.png'));       // iOS：正方形いっぱい、透明なし
  await png(shaped(0, false), 192, out('icon-192.png'));
  await png(shaped(0, false), 512, out('icon-512.png'));
  await png(full(0.78), 512, out('icon-maskable-512.png'));   // 安全領域に収める
  // 正方形いっぱいのものは透明度の情報を持たせない（Apple の指針）。Pillow があれば RGB にする
  try {
    execFileSync('python3', ['-c', `from PIL import Image
for f in ['apple-touch-icon.png', 'icon-maskable-512.png']: Image.open(f).convert('RGB').save(f, optimize=True)`], { cwd: ROOT });
  } catch (e) { console.warn('Pillow がないので透明度の情報を残しました'); }

  // macOS：.iconset を作って iconutil で .icns にする
  const set = path.join(ROOT, 'dist', 'Molecule.iconset');
  fs.rmSync(set, { recursive: true, force: true }); fs.mkdirSync(set, { recursive: true });
  const mac = shaped(100, true);
  for (const [n, px] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256],
    ['256x256', 256], ['256x256@2x', 512], ['512x512', 512], ['512x512@2x', 1024]]) await png(mac, px, path.join(set, `icon_${n}.png`));
  await png(mac, 1024, out('dist/icon-mac-1024.png'));
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out('desktop/icon.icns')]);
  console.log('icons written');
  app.quit();
});
