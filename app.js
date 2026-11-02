'use strict';

/* ===== 定数 ===== */
const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const WD = 'https://www.wikidata.org/w/api.php';
const PROPS = 'Title,IUPACName,MolecularFormula,MolecularWeight,ExactMass,SMILES,InChIKey,Charge,XLogP';
const FF_NAME = 'MMFF94s';
const SYM_TOL = 0.2;          // 対称判定の許容誤差 [Å]
const PLANE_COLORS = ['#7b4fd0', '#e0702f', '#1f9e89', '#d6336c', '#3b7dd8', '#b5a000'];

const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re ' +
  'Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr D T').split(' '));

const SAMPLES = [
  ['基本', [['水', 962], ['メタン', 297], ['アンモニア', 222], ['二酸化炭素', 280], ['エタノール', 702], ['ベンゼン', 241]]],
  ['環の配座', [['シクロヘキサン', 8078], ['メチルシクロヘキサン', 7962], ['tert-ブチルシクロヘキサン', 18508],
    ['cis-1,2-ジメチルシクロヘキサン', 16628], ['trans-1,2-ジメチルシクロヘキサン', 23313], ['β-D-グルコース', 64689], ['アダマンタン', 9238]]],
  ['不斉・メソ体', [['L-乳酸', 107689], ['D-乳酸', 61503], ['(R)-2-ブタノール', 84682], ['(S)-2-ブタノール', 444683],
    ['L-酒石酸', 444305], ['D-酒石酸', 439655], ['meso-酒石酸', 447315], ['meso-2,3-ジブロモブタン', 98508],
    ['L-アラニン', 5950], ['D-アラニン', 71080], ['(−)-メントール', 16666], ['(R)-サリドマイド', 75792]]],
  ['生体・その他', [['カフェイン', 2519], ['アスピリン', 2244], ['ドーパミン', 681], ['セロトニン', 5202],
    ['コレステロール', 5997], ['六フッ化硫黄', 17358], ['フラーレン C60', 123591]]]
];

const SLIDERS = [
  { key: 'sphere', label: '球の大きさ', note: '球棒・vdW半径比', min: 0.05, max: 1, step: 0.01, unit: '×' },
  { key: 'fill', label: '空間充填の球', note: 'vdW半径比', min: 0.3, max: 1.3, step: 0.01, unit: '×' },
  { key: 'hScale', label: '水素の球', note: '他原子に対する倍率', min: 0.3, max: 1.5, step: 0.01, unit: '×' },
  { key: 'stick', label: '棒の太さ', note: '半径', min: 0.02, max: 0.5, step: 0.005, unit: 'Å' },
  { key: 'labelScale', label: 'ラベルの文字', note: '倍率', min: 0.5, max: 2.5, step: 0.05, unit: '×' }
];
const DEFAULTS = {
  style: 'ballstick', sphere: 0.25, fill: 1.0, hScale: 0.8, stick: 0.13, labelScale: 1, labels: 'name',
  showH: true, multi: true, stereo: true, surface: false, planeGrid: 0.6, glass: true, symNoH: false
};

/* ===== 小道具 ===== */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const subFormula = (f) => esc(f).replace(/(\d+)/g, '<sub>$1</sub>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動作は継続 */ } }
};
const hasOCL = () => typeof OCL !== 'undefined' && !!OCL.Molecule;

class NotFound extends Error {}
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status === 404 || r.status === 400) throw new NotFound(url);
    if (i === tries - 1) throw new Error(`HTTP ${r.status}`);
    await sleep(600 * (i + 1));
  }
}
async function getText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url);
    if (r.ok) return r.text();
    if (r.status === 404 || r.status === 400) throw new NotFound(url);
    if (i === tries - 1) throw new Error(`HTTP ${r.status}`);
    await sleep(600 * (i + 1));
  }
}

function toast(title, sub = '', kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="tic">${kind === 'err' ? '!' : kind === 'ok' ? '✓' : 'i'}</span><div><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 4600);
}

/* ===== 入力の判定 ===== */
const normalize = (s) => s.normalize('NFKC').replace(/[−‐-―]/g, '-').trim();

// 分子式（示性式・括弧も可）→ 元素ごとの個数。解析不能なら null
function parseFormula(s) {
  const t = s.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9()]+$/.test(t) || !/^[A-Z(]/.test(t)) return null;
  let i = 0;
  function group() {
    const counts = {};
    while (i < t.length && t[i] !== ')') {
      let part;
      if (t[i] === '(') {
        i++; part = group();
        if (t[i] !== ')') throw 0;
        i++;
      } else {
        const m = /^[A-Z][a-z]?/.exec(t.slice(i));
        if (!m || !ELEMENTS.has(m[0])) throw 0;
        i += m[0].length; part = { [m[0]]: 1 };
      }
      const n = /^\d+/.exec(t.slice(i));
      const k = n ? (i += n[0].length, +n[0]) : 1;
      for (const e in part) counts[e] = (counts[e] || 0) + part[e] * k;
    }
    return counts;
  }
  try {
    const c = group();
    return i === t.length && Object.keys(c).length ? c : null;
  } catch (e) { return null; }
}
function hillOrder(counts) {
  const keys = Object.keys(counts);
  return counts.C ? ['C', 'H'].filter((e) => counts[e]).concat(keys.filter((e) => e !== 'C' && e !== 'H').sort()) : keys.sort();
}
const hill = (counts) => hillOrder(counts).map((e) => e + (counts[e] > 1 ? counts[e] : '')).join('');

const looksSmiles = (s) => /^[A-Za-z0-9@+\-\[\]\(\)=#\\\/%.:*]+$/.test(s) && /[\[\]=#@\\\/]|[cnosp]\d|\d[cnosp]|^[cnos]/.test(s);
const hasJapanese = (s) => /[぀-ヿ㐀-鿿豈-﫿々ー]/.test(s);
function classify(s) {
  if (/^(cid\s*)?\d+$/i.test(s)) return 'cid';
  if (hasJapanese(s)) return 'ja';
  if (looksSmiles(s)) return 'smiles';
  if (parseFormula(s)) {
    // 数字なしで同じ元素記号が繰り返される「CCO」「CCCC」は SMILES とみなす
    const syms = s.match(/[A-Z][a-z]?/g) || [];
    if (!/\d/.test(s) && syms.length >= 3 && new Set(syms).size < syms.length) return 'smiles';
    return 'formula';
  }
  return 'name';
}

/* ===== PubChem / Wikidata ===== */
const cidsByName = async (name) => (await getJSON(`${PUG}/compound/name/${encodeURIComponent(name)}/cids/JSON`)).IdentifierList.CID;
const cidsBySmiles = async (smi) => (await getJSON(`${PUG}/compound/smiles/cids/JSON?smiles=${encodeURIComponent(smi)}`)).IdentifierList.CID.filter((c) => c > 0);
const cidsByFormula = async (f) => (await getJSON(`${PUG}/compound/fastformula/${encodeURIComponent(f)}/cids/JSON?MaxRecords=12`)).IdentifierList.CID;
const props = async (cids) => (await getJSON(`${PUG}/compound/cid/${cids.join(',')}/property/${PROPS}/JSON`)).PropertyTable.Properties;

async function wikidataSearch(term, lang) {
  const s = await getJSON(`${WD}?action=wbsearchentities&search=${encodeURIComponent(term)}&language=${lang}&uselang=ja&type=item&limit=8&format=json&origin=*`);
  const ids = s.search.map((x) => x.id);
  if (!ids.length) return [];
  const e = await getJSON(`${WD}?action=wbgetentities&ids=${ids.join('|')}&props=claims|labels|descriptions&languages=ja|en&format=json&origin=*`);
  const out = [];
  for (const id of ids) {
    const ent = e.entities[id];
    const cl = ent?.claims?.P662;
    if (!cl) continue;
    const best = cl.find((c) => c.rank === 'preferred') || cl.find((c) => c.rank !== 'deprecated');
    const cid = +best?.mainsnak?.datavalue?.value;
    if (cid) out.push({ cid, qid: id, ja: ent.labels.ja?.value, desc: ent.descriptions.ja?.value });
  }
  if (out.length) return out;
  // PubChem CID (P662) が無い項目（例：グルコース）は、化学物質らしい上位項目の英語名で PubChem を引き直す
  for (const id of ids.slice(0, 3)) {
    const ent = e.entities[id];
    const en = ent?.labels?.en?.value;
    if (!en || !(ent.claims.P231 || ent.claims.P233 || ent.claims.P274)) continue;
    try {
      const [cid] = await cidsByName(en);
      return [{ cid, qid: id, ja: ent.labels.ja?.value, desc: ent.descriptions.ja?.value }];
    } catch (err) { if (!(err instanceof NotFound)) throw err; }
  }
  return out;
}
async function wikidataByCid(cid) {
  const s = await getJSON(`${WD}?action=query&list=search&srsearch=haswbstatement:P662=${cid}&srlimit=1&format=json&origin=*`);
  const qid = s.query.search[0]?.title;
  if (!qid) return null;
  const e = await getJSON(`${WD}?action=wbgetentities&ids=${qid}&props=labels|descriptions&languages=ja&format=json&origin=*`);
  const ent = e.entities[qid];
  return { qid, ja: ent.labels.ja?.value, desc: ent.descriptions.ja?.value };
}

/* ===== 状態 ===== */
const S = {
  set: { ...DEFAULTS, ...store.get('ml.settings', {}) },
  cur: null,            // { cid, p, ja, desc, qid, source }
  mol: null,            // OpenChemLib の分子（現在の座標をもつ）
  mol0: null,           // 読み込み時の配座
  sdf: null,            // OCL が無いときの予備
  model: null, atoms: [], X: [], names: [],
  stereo: [], ez: [], chir: null,
  rings: [], confs: [], confActive: -1,
  E: null, Emin: null, Elabel: '',
  sel: [], planeSel: [], planes: [], sym: null, symShow: true,
  clickMode: 'rotate', spin: false, token: 0, busy: false, strained: new Set(), atomClickT: 0
};

/* ===== OCL ヘルパ ===== */
const getXYZ = (m) => { const n = m.getAllAtoms(), X = []; for (let i = 0; i < n; i++) X.push([m.getAtomX(i), m.getAtomY(i), m.getAtomZ(i)]); return X; };
const setXYZ = (m, X) => X.forEach((p, i) => { m.setAtomX(i, p[0]); m.setAtomY(i, p[1]); m.setAtomZ(i, p[2]); });
function energyOf(m) {
  try { return new OCL.ForceFieldMMFF94(m, FF_NAME, {}).getTotalEnergy(); } catch (e) { return null; }
}
function minimise(m, opts = { maxIts: 4000, gradTol: 1e-4, funcTol: 1e-6 }) {
  try { const ff = new OCL.ForceFieldMMFF94(m, FF_NAME, {}); ff.minimise(opts); return ff.getTotalEnergy(); } catch (e) { return null; }
}

// Horn の四元数法：Y を X に重ね合わせる（重原子のみで回転を求め、全原子に適用）
function superpose(Y, X, idx) {
  const cx = Chem.centroid(idx.map((i) => X[i])), cy = Chem.centroid(idx.map((i) => Y[i]));
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const i of idx) {
    const a = Chem.sub(Y[i], cy), b = Chem.sub(X[i], cx);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) M[r][c] += a[r] * b[c];
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = M;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]
  ];
  const shift = N.reduce((s, r) => s + r.reduce((t, v) => t + Math.abs(v), 0), 0);
  let q = [1, 0.1, 0.1, 0.1];
  for (let it = 0; it < 200; it++) {
    const nq = N.map((r, i) => r.reduce((s, v, j) => s + v * q[j], 0) + shift * q[i]);
    const l = Math.hypot(...nq); q = nq.map((v) => v / l);
  }
  const [w, x, y, z] = q;
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z]
  ];
  return Y.map((p) => { const d = Chem.sub(p, cy); return Chem.add(cx, R.map((r) => r[0] * d[0] + r[1] * d[1] + r[2] * d[2])); });
}

/* ===== 3D ビューア ===== */
let viewer;
function initViewer() {
  viewer = $3Dmol.createViewer($('#viewer'), { backgroundColor: 'white', backgroundAlpha: 0, antialias: true });
  viewer.setBackgroundColor(0xffffff, 0);
  new ResizeObserver(() => { viewer.resize(); LB.dirty = true; }).observe($('#viewer'));
}

const elemOf = (i) => S.atoms[i]?.elem;
function dispRadius(e) {
  const st = S.set;
  switch (st.style) {
    case 'sphere': return Chem.vdw(e) * st.fill * (e === 'H' ? st.hScale : 1);
    case 'stick': return st.stick;
    case 'line': return 0.08;
    default: return Chem.vdw(e) * st.sphere * (e === 'H' ? st.hScale : 1);
  }
}

function applyStyle() {
  if (!S.model) return;
  const st = S.set, single = !st.multi;
  const elems = [...new Set(S.atoms.map((a) => a.elem))];
  for (const e of elems) {
    const r = dispRadius(e);
    let spec;
    if (st.style === 'sphere') spec = { sphere: { radius: r, colorscheme: 'Jmol' } };
    else if (st.style === 'stick') spec = { stick: { radius: st.stick, singleBonds: single, colorscheme: 'Jmol' } };
    else if (st.style === 'line') spec = { line: { colorscheme: 'Jmol' }, sphere: { radius: 0.08, colorscheme: 'Jmol' } };
    else spec = { sphere: { radius: r, colorscheme: 'Jmol' }, stick: { radius: st.stick, singleBonds: single, colorscheme: 'Jmol' } };
    if (e === 'H' && !st.showH) spec = {};
    S.model.setStyle({ elem: e }, spec);
  }
  viewer.removeAllSurfaces();
  if (st.surface) viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.45, colorscheme: 'Jmol' }, {});
  drawShapes();
  viewer.render();
  LB.dirty = true;
}

// 不斉中心の輪・計測・平面などの図形
function drawShapes() {
  viewer.removeAllShapes();
  const X = S.X, st = S.set;
  if (st.stereo) {
    for (const s of S.stereo) {
      viewer.addSphere({ center: v(X[s.i]), radius: dispRadius(elemOf(s.i)) + 0.16, color: s.pseudo ? '#7b4fd0' : '#ffb020', opacity: 0.38 });
    }
  }
  S.sel.forEach((i) => viewer.addSphere({ center: v(X[i]), radius: dispRadius(elemOf(i)) + 0.22, color: '#2f5e9e', opacity: 0.4 }));
  for (let k = 1; k < S.sel.length; k++) {
    viewer.addCylinder({ start: v(X[S.sel[k - 1]]), end: v(X[S.sel[k]]), radius: 0.035, color: '#d9a441', dashed: true, fromCap: 1, toCap: 1 });
  }
  S.planeSel.forEach((i) => viewer.addSphere({ center: v(X[i]), radius: dispRadius(elemOf(i)) + 0.22, color: '#7b4fd0', opacity: 0.4 }));
  if (S.clickMode === 'build' && BS.pick >= 0 && X[BS.pick]) viewer.addSphere({ center: v(X[BS.pick]), radius: dispRadius(elemOf(BS.pick)) + 0.25, color: '#34c759', opacity: 0.45 });
  S.planes.forEach((pl) => { if (pl.visible) drawPlane(pl.atoms.map((i) => X[i]), pl.color, st.planeGrid); });
  if (S.sym && S.symShow) S.sym.planes.forEach((pl) => drawPlane(null, '#03af7a', st.planeGrid, pl));
}
const v = (p) => ({ x: p[0], y: p[1], z: p[2] });

// 平面を半透明の正方形として描く（分子全体を覆う大きさ）
function drawPlane(P, colorHex, grid, given) {
  const f = given ? { c: given.c, n: given.n } : Chem.fitPlane(P);
  let u = Math.abs(f.n[0]) < 0.9 ? Chem.unit(Chem.cross(f.n, [1, 0, 0])) : Chem.unit(Chem.cross(f.n, [0, 1, 0]));
  if (!given && f.u) u = f.u;
  const w = Chem.cross(f.n, u);
  let h = 1.5;
  for (const p of S.X) {
    const d = Chem.sub(p, f.c);
    h = Math.max(h, Math.abs(Chem.dot(d, u)) + 1.2, Math.abs(Chem.dot(d, w)) + 1.2);
  }
  // 透過背景では 3Dmol の半透明面が描けないため、格子線で面を表す（奥行きの前後関係は正しく出る）
  const corner = (a, b) => Chem.add(f.c, Chem.add(Chem.mul(u, a * h), Chem.mul(w, b * h)));
  const C = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  for (let k = 0; k < 4; k++) viewer.addCylinder({ start: v(C[k]), end: v(C[(k + 1) % 4]), radius: 0.03, color: colorHex, fromCap: 1, toCap: 1 });
  const lines = Math.min(80, Math.floor((2 * h) / grid));
  for (let k = 1; k < lines; k++) {
    const t = -1 + (2 * k) / lines;
    viewer.addCylinder({ start: v(corner(t, -1)), end: v(corner(t, 1)), radius: 0.011, color: colorHex });
    viewer.addCylinder({ start: v(corner(-1, t)), end: v(corner(1, t)), radius: 0.011, color: colorHex });
  }
}

// 全体が収まるように表示し、小さな分子は 1 Å ≒ 60 px までに抑える
function fitView() {
  viewer.zoomTo();
  viewer.zoom(innerWidth <= 760 ? 0.72 : 0.9);
  const ax = viewAxes();
  const a = viewer.modelToScreen(v(ax.center)), b = viewer.modelToScreen(v(Chem.add(ax.center, ax.right)));
  const ppa = Math.hypot(b.x - a.x, b.y - a.y);
  if (ppa > 60) viewer.zoom(60 / ppa);
}
// 画面の向きをモデル座標で表す（右・上・手前の単位ベクトルと回転中心）
function viewAxes() {
  const w = viewer.getView();
  const inv = [-w[4], -w[5], -w[6], w[7]];
  return { right: rotq(inv, [1, 0, 0]), up: rotq(inv, [0, 1, 0]), toward: rotq(inv, [0, 0, 1]), center: [-w[0], -w[1], -w[2]] };
}
// 画面上の点（ページ座標）を、回転中心を通り画面に平行な面の上のモデル座標に直す
function screenToModel(x, y) {
  const ax = viewAxes();
  const s0 = viewer.modelToScreen(v(ax.center)), s1 = viewer.modelToScreen(v(Chem.add(ax.center, ax.right)));
  const ppa = Math.hypot(s1.x - s0.x, s1.y - s0.y) || 40;
  return Chem.add(ax.center, Chem.add(Chem.mul(ax.right, (x - s0.x) / ppa), Chem.mul(ax.up, -(y - s0.y) / ppa)));
}

/* ===== 原子ラベル（HTML オーバーレイ） ===== */
const LB = { pool: [], dirty: true, key: '' };
function rotq(q, p) {   // 四元数 q = [x,y,z,w] でベクトルを回す
  const [x, y, z, w] = q;
  const ix = w * p[0] + y * p[2] - z * p[1], iy = w * p[1] + z * p[0] - x * p[2], iz = w * p[2] + x * p[1] - y * p[0], iw = -x * p[0] - y * p[1] - z * p[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
}
function labelLoop() {
  requestAnimationFrame(labelLoop);
  if (!S.model) return;
  const view = viewer.getView();
  const key = view.map((x) => x.toFixed(5)).join(',');
  if (!LB.dirty && key === LB.key) return;
  LB.key = key; LB.dirty = false;
  drawLabels(view);
}
function labelEl(k) {
  let el = LB.pool[k];
  if (!el) { el = document.createElement('div'); $('#labels').appendChild(el); LB.pool[k] = el; }
  return el;
}
function drawLabels(view) {
  const st = S.set, n = S.X.length;
  const mg = [view[0], view[1], view[2]], q = [view[4], view[5], view[6], view[7]];
  const right = rotq([-q[0], -q[1], -q[2], q[3]], [1, 0, 0]);
  const pts = [];
  const R = S.atoms.map((a) => dispRadius(a.elem));
  for (let i = 0; i < n; i++) { pts.push(v(S.X[i])); pts.push(v(Chem.add(S.X[i], Chem.mul(right, R[i])))); }
  const sc = viewer.modelToScreen(pts);       // ページ座標で返るのでキャンバス位置を引く
  const off = $('#labels').getBoundingClientRect();
  const scr = [], rad = [], dep = [];
  for (let i = 0; i < n; i++) {
    const a = sc[2 * i], b = sc[2 * i + 1];
    scr.push([a.x - off.left - scrollX, a.y - off.top - scrollY]); rad.push(Math.hypot(b.x - a.x, b.y - a.y));
    dep.push(rotq(q, Chem.add(S.X[i], mg))[2]);
  }
  const shown = (i) => st.showH || S.atoms[i].elem !== 'H';
  const stereoMap = new Map(S.stereo.map((s) => [s.i, s]));
  const big = st.style === 'ballstick' || st.style === 'sphere';
  const order = [...Array(n).keys()].filter(shown).sort((a, b) => dep[b] - dep[a]);
  let k = 0;
  const occluded = (i) => {
    if (!big) return false;
    for (const j of order) {
      if (dep[j] <= dep[i] + 0.05) break;
      const dx = scr[j][0] - scr[i][0], dy = scr[j][1] - scr[i][1];
      if (dx * dx + dy * dy < (rad[j] * 0.88) ** 2) return true;
    }
    return false;
  };
  const placed = [];   // 手前から置いたラベルの矩形（文字の重なりを避ける）
  const collides = (x, y, hw, hh) => placed.some((b) => Math.abs(b.x - x) < b.hw + hw && Math.abs(b.y - y) < b.hh + hh);
  // 不斉中心は手前の原子に隠れても必ず表示する
  const must = new Set([...(st.stereo ? S.stereo.map((s) => s.i) : []), ...S.strained]);
  const list = [...[...must].filter(shown), ...order.filter((i) => !must.has(i))];
  for (const i of list) {
    const e = S.atoms[i].elem, s = st.stereo ? stereoMap.get(i) : null, warn = S.strained.has(i);
    let text = '';
    if (st.labels === 'name' || (st.labels === 'heavy' && e !== 'H')) text = S.names[i];
    else if (st.labels === 'elem') text = e;
    if ((s || warn) && !text) text = e;
    if (!text || (!s && !warn && occluded(i))) continue;
    const fs = big ? Math.max(7, Math.min(16, rad[i] * 0.62)) * st.labelScale : 10 * st.labelScale;
    const hw = (text.length * 0.32 + (s ? 1.2 : 0)) * fs, hh = fs * 0.5;
    const ly = scr[i][1] - (big ? 0 : rad[i] + 8);
    if (!s && !warn && collides(scr[i][0], ly, hw, hh)) continue;
    placed.push({ x: scr[i][0], y: ly, hw, hh });
    const el = labelEl(k++);
    const light = Chem.isLight(Chem.color(e));
    const html = esc(text) + (s ? `<span class="st">*</span><span class="cip${s.pseudo ? ' pseudo' : ''}">${s.cip}</span>` : '') + (warn ? '<span class="warn">!</span>' : '');
    const cls = 'lb' + (big ? (light ? ' dark' : '') : ' pill');
    if (el.className !== cls) el.className = cls;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.style.fontSize = fs.toFixed(1) + 'px';
    el.style.transform = `translate(${scr[i][0].toFixed(1)}px, ${ly.toFixed(1)}px) translate(-50%, -50%)`;
    el.style.zIndex = (s || warn ? 3000 : 1000) + Math.round(dep[i] * 10);
    el.style.display = '';
  }
  // 計測・作図の選択順の番号
  const nums = [...S.sel.map((i, j) => [i, j + 1, '']), ...S.planeSel.map((i, j) => [i, j + 1, ' pl']),
    ...(S.clickMode === 'build' && BS.pick >= 0 && BS.pick < n ? [[BS.pick, '1', ' bd']] : [])];
  for (const [i, num, extra] of nums) {
    const el = labelEl(k++);
    el.className = 'lb num' + extra;
    if (el._h !== String(num)) { el.textContent = num; el._h = String(num); }
    el.style.fontSize = '10px';
    const off = Math.max(9, rad[i] * 0.75);
    el.style.transform = `translate(${(scr[i][0] + off).toFixed(1)}px, ${(scr[i][1] - off).toFixed(1)}px) translate(-50%, -50%)`;
    el.style.zIndex = 5000;
    el.style.display = '';
  }
  for (; k < LB.pool.length; k++) LB.pool[k].style.display = 'none';
}

/* ===== 分子の表示 ===== */
function renderModel({ resetView = false } = {}) {
  const molfile = S.mol ? S.mol.toMolfile() : S.sdf;
  const view = viewer.getView();
  viewer.removeAllModels();
  if (!molfile) {
    S.model = null; S.atoms = []; S.X = []; S.names = [];
    viewer.removeAllShapes(); viewer.removeAllSurfaces(); viewer.render();
    LB.pool.forEach((el) => { el.style.display = 'none'; });
    refreshGeometryPanels();
    return;
  }
  S.model = viewer.addModel(molfile, 'sdf', { keepH: true });
  S.atoms = S.model.selectedAtoms({});
  S.X = S.atoms.map((a) => [a.x, a.y, a.z]);
  const cnt = {};
  S.names = S.atoms.map((a) => { cnt[a.elem] = (cnt[a.elem] || 0) + 1; return a.elem + cnt[a.elem]; });
  viewer.setClickable({}, true, onAtomClick);
  applyStyle();
  if (resetView) fitView(); else viewer.setView(view);
  viewer.render();
  if (S.spin) viewer.spin('y', 0.6);
  LB.dirty = true;
  refreshGeometryPanels();
}

// 座標が変わるたびに更新するもの
function refreshGeometryPanels() {
  analyzeRings();
  if (S.sym) runSymmetry(false);
  renderMeasure();
  renderPlanes();
  renderEnergy();
}

/* ===== 立体化学 ===== */
function analyzeStereo() {
  S.stereo = []; S.ez = []; S.chir = null;
  if (!S.mol) return;
  const m = S.mol, M = OCL.Molecule;
  m.ensureHelperArrays(M.cHelperCIP);
  for (let i = 0; i < m.getAllAtoms(); i++) {
    if (!m.isAtomStereoCenter(i)) continue;
    const p = m.getAtomCIPParity(i);
    const pseudo = m.isAtomParityPseudo(i);
    let cip = p === 1 ? 'R' : p === 2 ? 'S' : '?';
    if (pseudo && cip !== '?') cip = cip.toLowerCase();
    S.stereo.push({ i, cip, pseudo });
  }
  for (let b = 0; b < m.getAllBonds(); b++) {
    const p = m.getBondCIPParity(b);
    if (p === 1 || p === 2) S.ez.push({ a: m.getBondAtom(0, b), b: m.getBondAtom(1, b), ez: p === 1 ? 'E' : 'Z' });
  }
  const c = m.getChirality() & 0xFF0000;
  S.chir = c;
}
function chiralityInfo() {
  const M = OCL.Molecule, c = S.chir, nC = S.stereo.length;
  if (c === M.cChiralityMeso) return { tag: 'meso', label: 'メソ体', text: '不斉中心をもつが、分子内に対称性があるため鏡像と重なる（アキラル・光学不活性）。' };
  if (c === M.cChiralityNotChiral) return { tag: 'achiral', label: 'アキラル', text: nC ? '立体中心はあるが、鏡像と重なる。' : '不斉中心をもたず、鏡像と重なる。' };
  if (c === M.cChiralityKnownEnantiomer) return { tag: 'chiral', label: 'キラル', text: '鏡像と重ならない（一方の鏡像異性体）。光学活性。' };
  if (c === M.cChiralityRacemic) return { tag: 'chiral', label: 'キラル（ラセミ）', text: '鏡像異性体の等量混合として登録。' };
  if (c === M.cChiralityUnknownEnantiomer) return { tag: 'chiral', label: 'キラル', text: '鏡像と重ならない（どちらの鏡像異性体かは未指定）。' };
  if (c === M.cChiralityEpimers || c === M.cChiralityDiastereomers) return { tag: 'chiral', label: 'キラル', text: '立体異性体（ジアステレオマー）の関係を含む。' };
  return { tag: 'achiral', label: '判定不能', text: '' };
}

function renderStereoPanel() {
  const box = $('#chirVerdict'), list = $('#stereoList');
  if (!S.mol) { box.innerHTML = S.cur?.source === 'built' ? 'この構造は OpenChemLib で解釈できないため、立体化学を判定できません（無理のある結合を含む場合など）。' : 'OpenChemLib を読み込めなかったため、立体化学の判定はできません。'; list.innerHTML = ''; return; }
  const ci = chiralityInfo();
  const undefinedNote = S.stereo.length && S.cur?.p?.SMILES && !/[@]/.test(S.cur.p.SMILES) && S.cur.source === 'pubchem'
    ? '<br><span class="tag warn">注意</span>PubChem の記録では立体が未指定のため、表示中の 3D 座標は立体異性体の一つです。' : '';
  box.innerHTML = `<span class="tag ${ci.tag}">${ci.label}</span>不斉中心 <b>${S.stereo.length}</b> 個<br>${esc(ci.text)}${undefinedNote}`;
  const items = S.stereo.map((s) => {
    const nb = neighborsText(s.i);
    return `<div class="item"><div class="hd"><span class="cipbig${s.pseudo ? ' pseudo' : ''}">${s.cip}</span><b>${S.names[s.i]}*</b><span class="r"><button class="mini-btn" data-focus="${s.i}">表示</button></span></div>
      <div class="sub">${s.pseudo ? '擬似不斉中心（r/s）' : S.atoms[s.i].elem === 'C' ? '不斉炭素原子' : '不斉中心'}・置換基：${esc(nb)}</div></div>`;
  });
  S.ez.forEach((d) => items.push(`<div class="item"><div class="hd"><span class="cipbig">${d.ez}</span><b>${S.names[d.a]}=${S.names[d.b]}</b></div><div class="sub">二重結合の立体配置</div></div>`));
  list.innerHTML = items.join('');
  list.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => focusAtom(+b.dataset.focus)));
  $('#stStereo').textContent = S.stereo.length;
  const bc = $('#bdChir');
  bc.textContent = S.stereo.length ? `${ci.label}・不斉中心 ${S.stereo.length}` : ci.label;
  bc.className = 'fact chir ' + ci.tag;
}
function neighborsText(i) {
  const a = S.atoms[i];
  return a.bonds.map((j) => S.names[j]).join('、');
}
function focusAtom(i) {
  viewer.zoomTo({ index: i }, 500);
  setTimeout(() => { viewer.zoom(0.35, 300); LB.dirty = true; }, 520);
}

/* ===== 対称性 ===== */
function symAtoms() {
  const all = S.X.map((p, i) => ({ e: S.atoms[i].elem, p }));
  return S.set.symNoH ? all.filter((a) => a.e !== 'H') : all;
}
function runSymmetry(announce = true) {
  const r = Chem.findSymmetry(symAtoms(), SYM_TOL);
  S.sym = r;
  const nP = r.planes.length, hasI = r.inversion != null;
  let html;
  if (nP || hasI) {
    html = `<span class="tag achiral">アキラルな配座</span>鏡映面 σ <b>${nP}</b> 枚${hasI ? '、対称心 i あり' : ''}。` +
      (nP ? `<br>緑の面が自動検出した鏡映面です（最大ずれ ${Math.max(...r.planes.map((p) => p.dev)).toFixed(3)} Å）。` : '') +
      (S.chir === OCL?.Molecule?.cChiralityMeso ? '<br>メソ体：分子内の対称要素で鏡像と重なります。' : '');
  } else {
    html = `<span class="tag chiral">σ・i なし</span>この配座には鏡映面も対称心もありません。` +
      (S.chir === OCL?.Molecule?.cChiralityMeso || S.chir === OCL?.Molecule?.cChiralityNotChiral
        ? '<br>立体配置はアキラルなので、別の配座（単結合の回転）で対称面が現れます。配座タブで探索できます。'
        : '<br>（回映軸 S<sub>n</sub> は未検査）');
  }
  $('#symVerdict').innerHTML = html;
  if (announce) { drawShapes(); viewer.render(); }
}

/* ===== 平面の作図 ===== */
function renderPlanes() {
  $('#planeSel').innerHTML = S.planeSel.map((i, k) => `<span class="chip"><i>${k + 1}</i>${S.names[i]}</span>`).join('');
  $('#planeMake').disabled = S.planeSel.length < 3;
  const atoms = symAtoms();
  $('#planeList').innerHTML = S.planes.map((pl, k) => {
    const P = pl.atoms.map((i) => S.X[i]);
    const f = Chem.fitPlane(P);
    const mir = Chem.testMirror(atoms, f.c, f.n, SYM_TOL);
    const on = S.X.map((p, i) => [i, Math.abs(Chem.dot(Chem.sub(p, f.c), f.n))]).filter(([, d]) => d < 0.15).map(([i]) => S.names[i]);
    return `<div class="item"><div class="hd"><span class="sw-c" style="background:${pl.color}"></span><b>平面 ${k + 1}</b>
      <span class="r"><button class="mini-btn${pl.visible ? ' on' : ''}" data-pv="${k}">${pl.visible ? '表示中' : '非表示'}</button><button class="mini-btn" data-pd="${k}">削除</button></span></div>
      <div class="sub">定義：${pl.atoms.map((i) => S.names[i]).join('・')}　RMS ${f.rms.toFixed(3)} Å</div>
      <div class="sub">${mir.ok ? `<span class="ok">✓ 鏡映面</span>（最大ずれ ${mir.worst.toFixed(3)} Å）` : `<span class="ng">× 鏡映面ではない</span>（重ならない原子 ${mir.bad} 個）`}</div>
      <div class="sub">面上の原子（±0.15 Å）：${on.length ? on.join('、') : 'なし'}</div></div>`;
  }).join('');
  $$('#planeList [data-pv]').forEach((b) => b.addEventListener('click', () => { const p = S.planes[+b.dataset.pv]; p.visible = !p.visible; renderPlanes(); drawShapes(); viewer.render(); }));
  $$('#planeList [data-pd]').forEach((b) => b.addEventListener('click', () => { S.planes.splice(+b.dataset.pd, 1); renderPlanes(); drawShapes(); viewer.render(); }));
}

/* ===== 計測 ===== */
function onAtomClick(atom) {
  const i = atom.index;
  S.atomClickT = performance.now();
  if (S.clickMode === 'rotate') return;
  if (S.clickMode === 'build') { buildClick(i); return; }
  if (S.clickMode === 'plane') {
    const k = S.planeSel.indexOf(i);
    if (k >= 0) S.planeSel.splice(k, 1); else S.planeSel.push(i);
    renderPlanes();
  } else {
    if (S.sel.length >= 4) S.sel = [];
    if (S.sel[S.sel.length - 1] === i) return;
    S.sel.push(i);
    renderMeasure();
  }
  drawShapes(); viewer.render(); LB.dirty = true;
}
function renderMeasure() {
  const s = S.sel.filter((i) => i < S.X.length), nm = s.map((i) => S.names[i]);
  $('#mSel').innerHTML = nm.map((n, k) => `<span class="chip"><i>${k + 1}</i>${n}</span>`).join('');
  renderMeasureRows();
  renderDihedralCtl();
}
function renderMeasureRows() {
  const s = S.sel.filter((i) => i < S.X.length), P = s.map((i) => S.X[i]), nm = s.map((i) => S.names[i]);
  const rows = [];
  for (let k = 1; k < s.length; k++) rows.push([`距離 ${nm[k - 1]}–${nm[k]}`, Chem.dist(P[k - 1], P[k]).toFixed(3), 'Å']);
  for (let k = 2; k < s.length; k++) rows.push([`角 ∠${nm[k - 2]}–${nm[k - 1]}–${nm[k]}`, Chem.angle(P[k - 2], P[k - 1], P[k]).toFixed(1), '°']);
  if (s.length === 4) rows.push([`二面角 ${nm.join('–')}`, Chem.dihedral(...P).toFixed(1), '°']);
  $('#mRes').innerHTML = rows.map(([l, val, u]) => `<div class="mrow"><span>${esc(l)}</span><b>${val}<small>${u}</small></b></div>`).join('');
}

// 4 原子を選んだとき、中央の単結合（環外）を回して二面角を設定する
function rotatableSide() {
  if (!S.mol || S.sel.length !== 4) return null;
  const [, b, c] = S.sel, m = S.mol;
  const bond = m.getBond(b, c);
  if (bond < 0 || m.getBondOrder(bond) !== 1 || m.isRingBond(bond)) return null;
  const moving = [], seen = new Set([b, c]), stack = [c];
  while (stack.length) {
    const a = stack.pop();
    moving.push(a);
    for (let k = 0; k < m.getAllConnAtoms(a); k++) {
      const nb = m.getConnAtom(a, k);
      if (nb === b && a !== c) return null;
      if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
  }
  return moving;
}
function renderDihedralCtl() {
  const box = $('#dihCtl');
  const moving = rotatableSide();
  if (!moving) {
    box.innerHTML = S.sel.length === 4 ? '<p class="footnote" style="padding:0 10px">中央の結合が環内・多重結合のため回転できません。</p>' : '';
    return;
  }
  const cur = Chem.dihedral(...S.sel.map((i) => S.X[i]));
  box.innerHTML = `<div class="slider-row"><label>結合 ${S.names[S.sel[1]]}–${S.names[S.sel[2]]} の回転<small>0°=重なり形・180°=アンチ形</small></label>
    <span class="num"><input type="number" id="n-dih" min="-180" max="180" step="1" value="${cur.toFixed(0)}"><span class="unit">°</span></span>
    <input type="range" id="s-dih" min="-180" max="180" step="1" value="${cur.toFixed(0)}"></div>
    <div class="btnrow" style="margin-top:6px"><button class="mini-btn" data-dv="0">0°</button><button class="mini-btn" data-dv="60">60°</button><button class="mini-btn" data-dv="120">120°</button><button class="mini-btn" data-dv="180">180°</button><button class="mini-btn" data-dv="-60">−60°</button><button class="mini-btn" data-dv="-120">−120°</button></div>`;
  const r = $('#s-dih'), n = $('#n-dih');
  syncRangeFill(r);
  const go = (val, from) => {
    val = Math.max(-180, Math.min(180, +val));
    if (from !== r) r.value = val;
    if (from !== n) n.value = val;
    syncRangeFill(r);
    setDihedral(moving, val);
  };
  r.addEventListener('input', () => go(r.value, r));
  n.addEventListener('change', () => go(n.value, n));
  box.querySelectorAll('[data-dv]').forEach((b) => b.addEventListener('click', () => go(b.dataset.dv)));
}
function setDihedral(moving, target) {
  const X = getXYZ(S.mol);
  const [a, b, c, d] = S.sel.map((i) => X[i]);
  // b→c 軸まわりに正の向きへ回すと二面角は減るので符号を反転
  const delta = -(target - Chem.dihedral(a, b, c, d)) / Chem.DEG;
  const k = Chem.unit(Chem.sub(c, b));
  const cos = Math.cos(delta), sin = Math.sin(delta);
  for (const i of moving) {
    const p = Chem.sub(X[i], b);
    const kxp = Chem.cross(k, p), kdp = Chem.dot(k, p);
    X[i] = Chem.add(b, Chem.add(Chem.add(Chem.mul(p, cos), Chem.mul(kxp, sin)), Chem.mul(k, kdp * (1 - cos))));
  }
  setXYZ(S.mol, X);
  S.Elabel = `二面角 ${S.sel.map((i) => S.names[i]).join('–')} = ${(+target).toFixed(0)}°（未最適化）`;
  S.confActive = -1;
  quickRender();
  renderMeasureRows();
  renderPlanes();
  if (S.sym) runSymmetry(true);
}

/* ===== 環の配座 ===== */
function analyzeRings() {
  S.rings = [];
  if (!S.mol) { renderRings(); return; }
  const m = S.mol;
  const rs = m.getRingSet();
  const count = new Map();
  const rings = [];
  for (let r = 0; r < rs.getSize(); r++) {
    const atoms = Array.from(rs.getRingAtoms(r));
    atoms.forEach((a) => count.set(a, (count.get(a) || 0) + 1));
    rings.push({ atoms, size: atoms.length, aromatic: rs.isAromatic(r) });
  }
  for (const ring of rings) {
    const P = ring.atoms.map((i) => S.X[i]);
    ring.cp = ring.size >= 5 ? Chem.cremerPople(P) : null;
    const inRing = new Set(ring.atoms);
    let ok = ring.size === 6 && !ring.aromatic && ring.atoms.every((a) => count.get(a) === 1);
    for (let k = 0; k < ring.size && ok; k++) {
      const b = m.getBond(ring.atoms[k], ring.atoms[(k + 1) % ring.size]);
      if (b < 0 || m.getBondOrder(b) !== 1) ok = false;
    }
    if (ok) {
      ring.subs = ring.atoms.map((r) => {
        const out = [], seen = new Set([r]), stack = [];
        for (let k = 0; k < m.getAllConnAtoms(r); k++) { const nb = m.getConnAtom(r, k); if (!inRing.has(nb)) stack.push(nb); }
        while (stack.length) {
          const a = stack.pop();
          if (seen.has(a)) continue;
          seen.add(a); out.push(a);
          for (let k = 0; k < m.getAllConnAtoms(a); k++) {
            const nb = m.getConnAtom(a, k);
            if (inRing.has(nb) && nb !== r) ok = false;
            if (!seen.has(nb) && !inRing.has(nb)) stack.push(nb);
          }
        }
        return out;
      });
    }
    ring.editable = ok;
    S.rings.push(ring);
  }
  renderRings();
}

function renderRings() {
  const box = $('#ringList');
  if (!S.mol) { box.innerHTML = ''; return; }
  if (!S.rings.length) { box.innerHTML = '<div class="item"><div class="sub">環はありません。</div></div>'; return; }
  box.innerHTML = S.rings.map((r, k) => {
    const cp = r.cp;
    const par = !cp ? '' : r.size === 6 ? `Q = ${cp.Q.toFixed(3)} Å、θ = ${cp.theta.toFixed(1)}°、φ = ${cp.phi.toFixed(1)}°` : `q₂ = ${cp.q2.toFixed(3)} Å、φ₂ = ${cp.phi.toFixed(1)}°`;
    const ctl = r.editable ? `
      <div class="ring-ctl">
        <button class="mini-btn" data-rop="flip" data-r="${k}">環反転</button>
        <button class="mini-btn" data-rop="chair" data-r="${k}">椅子形</button>
        <button class="mini-btn" data-rop="tb" data-r="${k}">ねじれ舟形</button>
        <button class="mini-btn" data-rop="boat" data-r="${k}">舟形</button>
        <button class="mini-btn" data-rop="env" data-r="${k}">封筒形</button>
      </div>
      <div class="slider-row"><label>θ<small>0°=椅子・90°=舟・180°=反転椅子</small></label><span class="num"><input type="number" data-rt="${k}" min="0" max="180" step="1" value="${cp.theta.toFixed(0)}"><span class="unit">°</span></span>
        <input type="range" data-rt="${k}" min="0" max="180" step="1" value="${cp.theta.toFixed(0)}"></div>
      <div class="slider-row"><label>φ<small>擬回転：0°=舟・30°=ねじれ舟</small></label><span class="num"><input type="number" data-rp="${k}" min="0" max="360" step="1" value="${cp.phi.toFixed(0)}"><span class="unit">°</span></span>
        <input type="range" data-rp="${k}" min="0" max="360" step="1" value="${cp.phi.toFixed(0)}"></div>`
      : r.size === 6 && !r.aromatic ? '<div class="sub">縮環・橋かけ・二重結合を含む環は、配座の手動変更に対応していません（配座探索は可能）。</div>' : '';
    return `<div class="item"><div class="hd"><b>${r.size}員環${r.aromatic ? '（芳香環）' : ''}</b><span class="r"><span class="tag ${cp && cp.name.startsWith('椅子') ? 'achiral' : 'chiral'}" style="margin:0">${cp ? cp.name : '—'}</span></span></div>
      <div class="sub">${r.atoms.map((i) => S.names[i]).join('–')}</div><div class="sub">${par}</div>${ctl}</div>`;
  }).join('');
  box.querySelectorAll('[data-rop]').forEach((b) => b.addEventListener('click', () => ringOp(+b.dataset.r, b.dataset.rop)));
  box.querySelectorAll('input[data-rt], input[data-rp]').forEach((inp) => {
    syncRangeFill(inp);
    const k = +(inp.dataset.rt ?? inp.dataset.rp);
    const read = () => {
      const t = +box.querySelector(`input[type=range][data-rt="${k}"]`).value;
      const p = +box.querySelector(`input[type=range][data-rp="${k}"]`).value;
      return [t, p];
    };
    inp.addEventListener('input', () => {
      const sib = box.querySelectorAll(`input[data-${inp.dataset.rt != null ? 'rt' : 'rp'}="${k}"]`);
      sib.forEach((x) => { if (x !== inp) x.value = inp.value; syncRangeFill(x); });
      if (inp.type === 'range') ringPreview(k, ...read());
    });
    inp.addEventListener('change', () => ringRelax(k, ...read()));
  });
}

let ringBase = null;   // スライダー操作中の基準座標
function ringPreview(k, theta, phi) {
  const ring = S.rings[k];
  if (!ringBase) ringBase = { X: getXYZ(S.mol), Q: ring.cp.Q };
  const X = ringBase.X.map((p) => p.slice());
  Chem.moveRing(X, ring.atoms, ring.subs, Chem.ringTargets(ring.atoms.map((i) => X[i]), Math.max(0.45, ringBase.Q), theta, phi));
  setXYZ(S.mol, X);
  S.Elabel = '未最適化（プレビュー）';
  quickRender();
}
// プレビュー用の軽い再描画（環の一覧は作り直さない）
function quickRender() {
  const view = viewer.getView();
  viewer.removeAllModels();
  S.model = viewer.addModel(S.mol.toMolfile(), 'sdf', { keepH: true });
  S.atoms = S.model.selectedAtoms({});
  S.X = S.atoms.map((a) => [a.x, a.y, a.z]);
  viewer.setClickable({}, true, onAtomClick);
  applyStyle();
  viewer.setView(view);
  viewer.render();
  S.E = energyOf(S.mol);
  renderEnergy();
}

async function withBusy(label, fn) {
  if (S.busy) return;
  S.busy = true; setBusy(true, label);
  await sleep(30);
  try { await fn(); } catch (e) { console.error(e); toast('計算に失敗しました', String(e.message || e), 'err'); }
  finally { S.busy = false; setBusy(false); }
}

// 環の配座を (θ, φ) に拘束して残りを MMFF94s で緩和する
function constrainedRelax(ring, theta, phi, Qfix) {
  for (let it = 0; it < 40; it++) {
    try { new OCL.ForceFieldMMFF94(S.mol, FF_NAME, {}).minimise({ maxIts: 300, gradTol: 1, funcTol: 1e-3 }); } catch (e) { return; }
    const X = getXYZ(S.mol);
    Chem.moveRing(X, ring.atoms, ring.subs, Chem.ringRepucker(ring.atoms.map((i) => X[i]), theta, phi, Qfix));
    setXYZ(S.mol, X);
  }
}

function ringRelax(k, theta, phi) {
  const ring = S.rings[k];
  withBusy('拘束最適化中', async () => {
    if (ringBase) { setXYZ(S.mol, ringBase.X); }
    const X = getXYZ(S.mol);
    const Q0 = Math.max(0.45, ring.cp.Q);
    Chem.moveRing(X, ring.atoms, ring.subs, Chem.ringTargets(ring.atoms.map((i) => X[i]), Q0, theta, phi));
    setXYZ(S.mol, X);
    constrainedRelax(ring, theta, phi, theta > 67.5 && theta < 112.5 ? undefined : Q0);
    ringBase = null;
    S.E = energyOf(S.mol);
    S.Elabel = `環を θ=${theta.toFixed(0)}°, φ=${phi.toFixed(0)}° に拘束して最適化`;
    S.confActive = -1;
    renderModel();
  });
}

function ringOp(k, op) {
  const ring = S.rings[k], cp = ring.cp;
  withBusy('配座を計算中', async () => {
    const X = getXYZ(S.mol);
    const P = ring.atoms.map((i) => X[i]);
    let theta, phi = cp.phi, Q = Math.max(0.5, cp.Q), free = true, label;
    if (op === 'flip') { theta = 180 - cp.theta; Q = cp.Q > 0.3 ? cp.Q : 0.56; label = '環反転して最適化'; }
    else if (op === 'chair') { theta = cp.theta > 90 ? 180 : 0; Q = 0.56; label = '椅子形に戻して最適化'; }
    else if (op === 'tb') { theta = 90; phi = Math.round((cp.phi - 30) / 60) * 60 + 30; Q = 0.68; label = 'ねじれ舟形に変えて最適化'; }
    else if (op === 'boat') { theta = 90; phi = Math.round(cp.phi / 60) * 60; Q = 0.68; free = false; label = '舟形に拘束して最適化（鞍点）'; }
    else { theta = cp.theta > 90 ? 125.3 : 54.7; phi = Math.round(cp.phi / 60) * 60; Q = 0.55; free = false; label = '封筒形に拘束して最適化（鞍点）'; }
    Chem.moveRing(X, ring.atoms, ring.subs, Chem.ringTargets(P, Q, theta, ((phi % 360) + 360) % 360));
    setXYZ(S.mol, X);
    if (free) minimise(S.mol);
    else constrainedRelax(ring, theta, ((phi % 360) + 360) % 360, op === 'boat' ? undefined : Q);
    S.E = energyOf(S.mol);
    S.Elabel = label;
    S.confActive = -1;
    renderModel();
    if (op === 'boat') toast('舟形はエネルギー極小ではありません', '拘束を外して最適化すると、ねじれ舟形へ緩和します。');
  });
}

/* ===== エネルギー・配座探索 ===== */
function renderEnergy() {
  const box = $('#energy');
  if (!S.mol || S.E == null) { box.innerHTML = '<b>—</b><span>MMFF94s のパラメータがない原子を含むため計算できません</span>'; return; }
  if (S.Emin == null || S.E < S.Emin) S.Emin = S.E;
  box.innerHTML = `<b>${S.E.toFixed(2)}</b><span>kcal/mol　ΔE = ${(S.E - S.Emin).toFixed(2)}（これまでの最小値比）<br>${esc(S.Elabel)}</span>`;
}

async function conformerSearch() {
  if (!S.mol) return;
  const btn = $('#confSearch');
  await withBusy('配座探索中', async () => {
    const cg = new OCL.ConformerGenerator(20241102);
    const ok = cg.initializeConformers(S.mol0.getCompactCopy(), { strategy: OCL.ConformerGenerator.STRATEGY_LIKELY_RANDOM, maxTorsionSets: 120 });
    if (!ok) throw new Error('配座を発生できません');
    const out = [];
    const ref = getXYZ(S.mol);
    const heavy = [...Array(S.mol.getAllAtoms()).keys()].filter((i) => S.mol.getAtomicNo(i) !== 1);
    for (let k = 0; k < 30; k++) {
      const m = cg.getNextConformerAsMolecule(null);
      if (!m) break;
      const E = minimise(m);
      setXYZ(m, superpose(getXYZ(m), ref, heavy.length >= 3 ? heavy : [...ref.keys()]));
      out.push({ mol: m, E });
      btn.textContent = `探索中 ${k + 1}`;
      await sleep(0);
    }
    // エネルギーが 0.01 kcal/mol 以内のものは同一配座とみなす
    out.sort((a, b) => (a.E ?? 0) - (b.E ?? 0));
    S.confs = out.filter((c, i) => i === 0 || c.E == null || Math.abs(c.E - out[i - 1].E) > 0.01);
    S.confs.forEach((c) => {
      if (c.E != null && (S.Emin == null || c.E < S.Emin)) S.Emin = c.E;
      const X = getXYZ(c.mol);
      c.ringNames = S.rings.filter((r) => r.size >= 5 && !r.aromatic).map((r) => Chem.cremerPople(r.atoms.map((i) => X[i])).name);
    });
    renderConfs();
    toast('配座探索が完了しました', `${S.confs.length} 個の配座（MMFF94s 最適化）`, 'ok');
  });
  btn.textContent = '配座を探索';
}
function renderConfs() {
  const box = $('#confList');
  const Emin = S.confs.length ? S.confs[0].E : null;
  box.innerHTML = S.confs.map((c, k) => `<button class="item click${k === S.confActive ? ' on' : ''}" data-c="${k}">
    <div class="hd"><b>配座 ${k + 1}</b><span class="r">${c.E != null ? `ΔE ${(c.E - Emin).toFixed(2)} kcal/mol` : '—'}</span></div>
    <div class="sub">${c.ringNames.length ? '環：' + c.ringNames.join('・') + '　' : ''}E = ${c.E != null ? c.E.toFixed(2) : '—'} kcal/mol</div></button>`).join('');
  box.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => {
    const c = S.confs[+b.dataset.c];
    S.mol = c.mol.getCompactCopy();
    S.E = c.E; S.Elabel = `配座探索 #${+b.dataset.c + 1}（MMFF94s 最適化済み）`;
    S.confActive = +b.dataset.c;
    renderModel();
    renderConfs();
  }));
}

/* ===== 読み込み ===== */
function setBusy(on, label = '検索中') {
  $('#loading').hidden = !on;
  $('#loadingText').textContent = label;
  $('#srcDot').className = 'dot ' + (on ? 'busy' : S.cur ? 'ok' : '');
  $('#srcTxt').textContent = on ? label : S.cur ? sourceLabel() : '待機中';
  $('#searchForm .go').disabled = on;
}
const sourceLabel = () => ({ pubchem: 'PubChem 3D 配座', generated: 'OpenChemLib 生成＋MMFF94s', built: '自作（簡易力場／MMFF94s）' })[S.cur.source] || '';

async function generate3D(mol) {
  const cg = new OCL.ConformerGenerator(4242);
  if (!cg.initializeConformers(mol, { strategy: OCL.ConformerGenerator.STRATEGY_LIKELY_RANDOM, maxTorsionSets: 40 })) throw new Error('3D 座標を生成できません');
  let best = null;
  for (let k = 0; k < 8; k++) {
    const m = cg.getNextConformerAsMolecule(null);
    if (!m) break;
    const E = minimise(m);
    if (!best || (E != null && (best.E == null || E < best.E))) best = { m, E };
    await sleep(0);
  }
  if (!best) throw new Error('3D 座標を生成できません');
  return best.m;
}

async function loadCid(cid, meta = {}) {
  const tok = ++S.token;
  setBusy(true, '構造を取得中');
  try {
    const p = meta.props || (await props([cid]))[0];
    let sdf = null;
    try { sdf = await getText(`${PUG}/compound/cid/${cid}/record/SDF?record_type=3d`); } catch (e) { if (!(e instanceof NotFound)) throw e; }
    if (tok !== S.token) return;
    let mol = null, source = 'pubchem';
    if (sdf && hasOCL()) mol = OCL.Molecule.fromMolfile(sdf);
    if (!sdf) {
      if (!hasOCL()) throw new NotFound('3d');
      setBusy(true, '3D 座標を生成中');
      mol = await generate3D(OCL.Molecule.fromSmiles(p.SMILES));
      source = 'generated';
    }
    if (tok !== S.token) return;
    setMolecule(mol, sdf, { cid, p, ja: meta.ja, desc: meta.desc, qid: meta.qid, source });
    if (source === 'generated') toast('PubChem に 3D 配座がありません', 'OpenChemLib で 3D 座標を生成し、MMFF94s で最適化しました。');
    if (!meta.ja) {
      wikidataByCid(cid).then((w) => {
        if (!w || tok !== S.token || !S.cur) return;
        Object.assign(S.cur, { ja: w.ja, desc: w.desc, qid: w.qid });
        renderInfo(); pushHistory();
      }).catch(() => {});
    }
  } catch (e) {
    if (tok !== S.token) return;
    console.error(e);
    toast('構造を取得できませんでした', e instanceof NotFound ? 'PubChem にデータがありません。' : '通信エラー：時間をおいて再試行してください。', 'err');
  } finally {
    if (tok === S.token) setBusy(false);
  }
}

// PubChem に無い SMILES：OCL で 3D 化
async function loadSmilesLocal(smi) {
  const tok = ++S.token;
  setBusy(true, '3D 座標を生成中');
  try {
    const m0 = OCL.Molecule.fromSmiles(smi);
    const mf = m0.getMolecularFormula();
    const mol = await generate3D(m0);
    if (tok !== S.token) return;
    setMolecule(mol, null, { cid: null, p: { Title: smi, MolecularFormula: mf.formula, MolecularWeight: mf.relativeWeight, SMILES: smi }, source: 'generated' });
    toast('PubChem 未登録の構造です', 'OpenChemLib で 3D 座標を生成し、MMFF94s で最適化しました。');
  } catch (e) {
    if (tok !== S.token) return;
    toast('SMILES を解釈できませんでした', String(e.message || e), 'err');
  } finally {
    if (tok === S.token) setBusy(false);
  }
}

function setMolecule(mol, sdf, cur) {
  S.mol = mol; S.mol0 = mol ? mol.getCompactCopy() : null; S.sdf = sdf;
  S.cur = cur;
  S.sel = []; S.planeSel = []; S.planes = []; S.sym = null; S.confs = []; S.confActive = -1; ringBase = null;
  S.E = mol ? energyOf(mol) : null; S.Emin = null;
  S.Elabel = cur.source === 'pubchem' ? '初期配座：PubChem 3D（静電項なしの MMFF94s で最適化された座標）' : '初期配座：OCL 生成＋MMFF94s 最適化';
  $('#empty').hidden = true;
  if (mol) analyzeStereo();
  renderModel({ resetView: true });
  $('#symVerdict').innerHTML = '';
  $('#confList').innerHTML = '';
  renderStereoPanel();
  renderInfo();
  pushHistory();
  if (cur.cid) history.replaceState(null, '', `#cid=${cur.cid}`);
}

async function search(raw, mode = 'auto') {
  const q = normalize(raw);
  if (!q) return;
  const kind = mode === 'auto' ? classify(q) : mode === 'name' ? (hasJapanese(q) ? 'ja' : 'name') : mode;
  $('#cands').hidden = true;
  setBusy(true);
  const tok = S.token;
  try {
    if (kind === 'cid') return await loadCid(+q.replace(/\D/g, ''));
    if (kind === 'formula') {
      const counts = parseFormula(q);
      if (!counts) throw new NotFound('formula');
      const hf = hill(counts);
      const ps = await props(await cidsByFormula(hf));
      if (tok !== S.token) return;
      showCands(ps, `分子式 ${hf} の候補（PubChem で参照の多い順）`);
      return await loadCid(ps[0].CID, { props: ps[0] });
    }
    if (kind === 'smiles') {
      let cids = [];
      try { cids = await cidsBySmiles(q); } catch (e) { if (!(e instanceof NotFound)) throw e; }
      if (cids.length) return await loadCid(cids[0]);
      if (!hasOCL()) throw new NotFound('smiles');
      return await loadSmilesLocal(q);
    }
    if (kind === 'ja') {
      const hits = await wikidataSearch(q, 'ja');
      if (!hits.length) throw new NotFound('ja');
      if (hits.length > 1) {
        const ps = await props([...new Set(hits.map((h) => h.cid))]);
        const byCid = Object.fromEntries(ps.map((p) => [p.CID, p]));
        showCands(hits.filter((h) => byCid[h.cid]).map((h) => ({ ...byCid[h.cid], _ja: h.ja, _meta: h })), `「${q}」の候補`);
      }
      return await loadCid(hits[0].cid, hits[0]);
    }
    try {
      return await loadCid((await cidsByName(q))[0]);
    } catch (e) {
      if (!(e instanceof NotFound)) throw e;
      const hits = await wikidataSearch(q, 'en');
      if (!hits.length) throw e;
      return await loadCid(hits[0].cid, hits[0]);
    }
  } catch (e) {
    if (tok !== S.token) return;
    console.error(e);
    const label = { formula: '分子式', smiles: 'SMILES', ja: '和名', name: '名称', cid: 'CID' }[kind];
    toast('見つかりませんでした', e instanceof NotFound ? `「${q}」を${label}として検索しましたが該当がありません。` : '通信エラー：時間をおいて再試行してください。', 'err');
    setBusy(false);
  }
}

function showCands(list, heading) {
  const box = $('#cands');
  box.innerHTML = `<div class="ch"><span>${esc(heading)}</span><button type="button" id="candClose">閉じる ✕</button></div>` + list.map((p, i) =>
    `<button type="button" class="cand${i === 0 ? ' on' : ''}" data-i="${i}"><b>${esc(p._ja || p.Title || 'CID ' + p.CID)}</b><span>${esc(p.IUPACName || '')}${p.IUPACName ? ' ・ ' : ''}CID ${p.CID}</span></button>`).join('');
  box.hidden = false;
  $('#candClose').addEventListener('click', () => { box.hidden = true; });
  box.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', () => {
    box.querySelectorAll('.cand').forEach((x) => x.classList.toggle('on', x === b));
    const p = list[+b.dataset.i];
    loadCid(p.CID, { props: p, ...(p._meta || {}) });
  }));
}

/* ===== 表示更新 ===== */
function composition() {
  const c = {};
  for (const a of S.atoms) c[a.elem] = (c[a.elem] || 0) + 1;
  return c;
}

function renderInfo() {
  const { p, ja, desc, cid, qid } = S.cur;
  const title = p.Title || p.IUPACName || `CID ${cid}`;
  const name = ja || title;
  const bonds = S.atoms.reduce((n, a) => n + a.bonds.length, 0) / 2;
  const comp = composition();
  const counts = parseFormula(String(p.MolecularFormula).replace(/[+-]\d*$/, '')) || comp;
  const els = hillOrder(counts);
  $('#badges').innerHTML = els.map((e) => `<span class="el-pill"><i style="background:${Chem.color(e)}"></i>${e}<span>${counts[e]}</span></span>`).join('');
  $('#bdSub').textContent = desc || '';
  const k = $('#bdName');
  k.textContent = name;
  k.className = 'large-title' + (name.length > 26 ? ' xlong' : name.length > 14 ? ' long' : '');
  $('#bdEn').textContent = ja && title !== ja ? title : (p.IUPACName && p.IUPACName.toLowerCase() !== title.toLowerCase() ? p.IUPACName : '');
  $('#bdFormula').innerHTML = subFormula(p.MolecularFormula);
  $('#bdMw').textContent = (+p.MolecularWeight).toFixed(2);
  $('#bdSrc').textContent = sourceLabel() + (cid ? ` ・ PubChem CID ${cid}` : '');
  $('#board').hidden = false;

  $('#stAtoms').textContent = S.atoms.length;
  $('#stBonds').textContent = bonds;

  const rows = [
    ['和名', ja], ['英名', p.Title], ['IUPAC名', p.IUPACName],
    ['分子式', subFormula(p.MolecularFormula), true],
    ['分子量', `${(+p.MolecularWeight).toFixed(3)} g/mol`],
    ['精密質量', p.ExactMass && `${(+p.ExactMass).toFixed(4)} Da`],
    ['電荷', p.Charge != null ? String(p.Charge) : null],
    ['XLogP3', p.XLogP != null ? String(p.XLogP) : null],
    ['SMILES', p.SMILES, false, 'mono'], ['InChIKey', p.InChIKey, false, 'mono'],
    ['座標', S.cur.source === 'pubchem' ? 'PubChem 3D 配座（OMEGA で生成し MMFF94s で最適化した計算構造）。全原子の座標・結合方向をそのまま描画。' : 'OpenChemLib で 3D 座標を生成し、MMFF94s 力場で最適化。'],
    ['原子の大きさ', 'ファンデルワールス半径（Bondi）× 表示倍率'],
    ['原子名', '元素記号＋元素ごとの通し番号（PubChem の原子順。IUPAC の位置番号とは異なる）'],
    ['リンク', (cid ? `<a href="https://pubchem.ncbi.nlm.nih.gov/compound/${cid}" target="_blank" rel="noopener">PubChem</a>` : '') +
      (qid ? ` ・ <a href="https://www.wikidata.org/wiki/${qid}" target="_blank" rel="noopener">Wikidata</a>` : ''), true]
  ];
  $('#info').innerHTML = rows.filter((r) => r[1]).map(([kk, val, html, cls]) => `<dt>${kk}</dt><dd${cls ? ` class="${cls}"` : ''}>${html ? val : esc(val)}</dd>`).join('');
  document.title = `${name} — Molecule`;
  if (curView === 'comp') renderSide();
}

/* ===== サイドバー ===== */
let curView = 'comp';
function pushHistory() {
  const c = S.cur;
  if (!c?.cid) return;
  const h = store.get('ml.history', []).filter((x) => x.cid !== c.cid);
  h.unshift({ cid: c.cid, name: c.ja || c.p.Title || `CID ${c.cid}`, f: c.p.MolecularFormula });
  store.set('ml.history', h.slice(0, 40));
  if (curView === 'history') renderSide();
}
function renderSide() {
  const box = $('#sidelist');
  if (curView === 'samples') {
    box.innerHTML = SAMPLES.map(([g, list]) => `<div class="sl-group">${esc(g)}</div>` +
      list.map(([n, cid]) => `<button class="sl-item" data-cid="${cid}" data-ja="${esc(n)}">${esc(n)}<small>${cid}</small></button>`).join('')).join('');
  } else if (curView === 'history') {
    const h = store.get('ml.history', []);
    box.innerHTML = '<h4>履歴</h4>' + (h.length ? h.map((x) => `<button class="sl-item" data-cid="${x.cid}">${esc(x.name)}<small>${esc(x.f || '')}</small></button>`).join('')
      : '<div class="sl-empty">まだ履歴はありません</div>');
  } else if (curView === 'about') {
    box.innerHTML = `<h4>このアプリについて</h4><div class="sl-about">
      <p><b>座標</b><br>PubChem の 3D 配座（OMEGA 生成・MMFF94s 最適化）の全原子座標をそのまま描画します。3D 配座が無い化合物は OpenChemLib で生成し MMFF94s で最適化します。</p>
      <p><b>立体化学</b><br>不斉中心と CIP 表示（R/S、擬似不斉は r/s）、キラル・アキラル・メソの判定は OpenChemLib による 3D 座標からの判定です。</p>
      <p><b>配座</b><br>六員環は Cremer–Pople パラメータ（Q, θ, φ）で椅子形・舟形・ねじれ舟形を判定します。環反転・舟形などは MMFF94s で（拘束）最適化します。</p>
      <p><b>対称性</b><br>鏡映面・対称心は全原子座標を実際に鏡映・反転して重なるかで判定します（許容誤差 ${SYM_TOL} Å）。</p>
      <p><b>大きさ</b><br>球はファンデルワールス半径（Bondi）の倍率、棒は半径 Å で指定します。</p></div>`;
  } else {
    if (!S.model) { box.innerHTML = '<h4>組成</h4><div class="sl-empty">分子を表示すると元素組成が出ます</div>'; return; }
    const c = composition();
    box.innerHTML = '<h4>組成（表示中の原子）</h4>' + hillOrder(c).map((e) =>
      `<div class="comp"><span class="ball" style="background:${Chem.color(e)}"></span><span class="el">${e}</span>${esc(Chem.ELEM_JA[e] || '')}<span class="ct">${c[e]}</span></div>`).join('');
  }
  box.querySelectorAll('[data-cid]').forEach((b) => b.addEventListener('click', () => {
    $('#cands').hidden = true;
    loadCid(+b.dataset.cid, b.dataset.ja ? { ja: b.dataset.ja } : {});
  }));
}

/* ===== 設定 UI ===== */
function saveSettings() { store.set('ml.settings', S.set); }
function syncRangeFill(inp) {
  if (inp.type !== 'range') return;
  LiquidGlass.setRange(inp);
  const p = ((+inp.value - +inp.min) / (+inp.max - +inp.min)) * 100;
  inp.style.setProperty('--p', p + '%');
}
function sliderHTML(d, val) {
  const dec = (String(d.step).split('.')[1] || '').length;
  return `<div class="slider-row"><label for="s-${d.key}">${d.label}<small>${d.note}</small></label>
    <span class="num"><input type="number" id="n-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${(+val).toFixed(dec)}"><span class="unit">${d.unit}</span></span>
    <input type="range" id="s-${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${val}"></div>`;
}
function buildSliders() {
  $('#sliders').innerHTML = SLIDERS.map((d) => sliderHTML(d, S.set[d.key])).join('');
  $('#planeOpacityRow').outerHTML = sliderHTML({ key: 'planeGrid', label: '平面の格子間隔', note: '', min: 0.25, max: 2, step: 0.05, unit: 'Å' }, S.set.planeGrid);
  for (const d of [...SLIDERS, { key: 'planeGrid', step: 0.05 }]) {
    const r = $(`#s-${d.key}`), n = $(`#n-${d.key}`);
    const dec = (String(d.step).split('.')[1] || '').length;
    syncRangeFill(r);
    let raf = 0;
    const set = (val, from) => {
      val = Math.min(+r.max, Math.max(+r.min, +val));
      if (!Number.isFinite(val)) return;
      S.set[d.key] = val;
      if (from !== r) r.value = val;
      if (from !== n) n.value = val.toFixed(dec);
      syncRangeFill(r);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { applyStyle(); saveSettings(); });
    };
    r.addEventListener('input', () => set(r.value, r));
    n.addEventListener('change', () => set(n.value, n));
  }
}

function segBind(sel, attr, key, after) {
  const seg = $(sel);
  const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset[attr] === S.set[key]));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.set[key] = b.dataset[attr]; sync(); saveSettings(); after();
  });
  sync();
}

const THEMES = ['auto', 'light', 'dark'], THEME_JA = { auto: '自動', light: 'ライト', dark: 'ダーク' };
function applyTheme(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $('#themeBtn span').textContent = THEME_JA[t];
  store.set('ml.theme', t);
}

/* ===== PNG 保存（ラベルも合成） ===== */
function savePNG() {
  if (!S.cur) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const box = $('#labels').getBoundingClientRect();
    const k = img.width / box.width;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const el of LB.pool) {
      if (el.style.display === 'none' || !el.textContent) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      ctx.font = `700 ${parseFloat(cs.fontSize) * k}px -apple-system, "Hiragino Sans", sans-serif`;
      ctx.lineWidth = 3 * k; ctx.strokeStyle = el.classList.contains('dark') ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.85)';
      ctx.fillStyle = el.classList.contains('dark') ? '#121212' : '#ffffff';
      const x = (r.left + r.width / 2 - box.left) * k, y = (r.top + r.height / 2 - box.top) * k;
      ctx.strokeText(el.textContent, x, y); ctx.fillText(el.textContent, x, y);
    }
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = `${S.cur.ja || S.cur.p.Title || 'molecule'}.png`;
    a.click();
  };
  img.src = viewer.pngURI();
}

/* ===== イベント ===== */
let setClick = () => {};
function bind() {
  $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); $('#q').blur(); search($('#q').value, $('#mode').value); });

  segBind('#styleSeg', 'style', 'style', applyStyle);
  segBind('#labelSeg', 'label', 'labels', () => { LB.dirty = true; });
  buildSliders();
  const tog = (id, key) => { const el = $(id); el.checked = S.set[key]; el.addEventListener('change', () => { S.set[key] = el.checked; saveSettings(); applyStyle(); }); };
  tog('#tH', 'showH'); tog('#tOrder', 'multi'); tog('#tStereo', 'stereo'); tog('#tSurf', 'surface');
  const tsh = $('#tSymH'); tsh.checked = S.set.symNoH;
  tsh.addEventListener('change', () => { S.set.symNoH = tsh.checked; saveSettings(); renderPlanes(); if (S.sym) runSymmetry(true); });

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.tab === 'build') setClick('build');
    else if (t.dataset.tab === 'measure' && S.clickMode !== 'measure') setClick('measure');
    else if (S.clickMode === 'build') setClick('rotate');
    $$('.tab').forEach((x) => x.classList.toggle('on', x === t));
    $$('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t.dataset.tab));
    sheetMin(false);
  }));
  const sheetMin = (on) => { $('#inspector').classList.toggle('min', on); document.body.classList.toggle('sheet-min', on); };
  $('#grab').addEventListener('click', () => sheetMin(!$('#inspector').classList.contains('min')));
  // 検索候補を出している間はサイドバーの一覧を隠す
  new MutationObserver(() => document.body.classList.toggle('searching', !$('#cands').hidden)).observe($('#cands'), { attributes: true, attributeFilter: ['hidden'] });

  setClick = (mode) => {
    S.clickMode = mode;
    if (mode !== 'build') BS.pick = -1;
    $$('#clickSeg button').forEach((b) => b.classList.toggle('on', b.dataset.click === mode));
    $('#planeMode').classList.toggle('on', mode === 'plane');
    if (S.model) { drawShapes(); viewer.render(); }
    LB.dirty = true;
  };
  $('#clickSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setClick(b.dataset.click); });
  $('#planeMode').addEventListener('click', () => setClick(S.clickMode === 'plane' ? 'rotate' : 'plane'));
  $('#planeMake').addEventListener('click', () => {
    if (S.planeSel.length < 3) return;
    S.planes.push({ atoms: S.planeSel.slice(), color: PLANE_COLORS[S.planes.length % PLANE_COLORS.length], visible: true });
    S.planeSel = [];
    renderPlanes(); drawShapes(); viewer.render(); LB.dirty = true;
  });
  $('#planeSelClear').addEventListener('click', () => { S.planeSel = []; renderPlanes(); drawShapes(); viewer.render(); LB.dirty = true; });
  $('#symFind').addEventListener('click', () => {
    if (!S.model) return;
    if (S.sym && S.symShow) { S.symShow = false; S.sym = null; $('#symVerdict').innerHTML = ''; $('#symFind').textContent = '対称面を自動検出'; drawShapes(); viewer.render(); return; }
    S.symShow = true; runSymmetry(true); $('#symFind').textContent = '検出結果を消す';
  });

  $('#mClear').addEventListener('click', () => { S.sel = []; renderMeasure(); drawShapes(); viewer.render(); LB.dirty = true; });
  $('#confSearch').addEventListener('click', conformerSearch);
  $('#confReset').addEventListener('click', () => {
    if (!S.mol0) return;
    S.mol = S.mol0.getCompactCopy(); S.E = energyOf(S.mol); S.Elabel = '初期配座'; S.confActive = -1;
    renderModel(); renderConfs();
  });
  $('#confMin').addEventListener('click', () => withBusy('最適化中', async () => {
    S.E = minimise(S.mol); S.Elabel = '現在の配座から MMFF94s で最適化'; S.confActive = -1; renderModel();
  }));

  $('#cZoomIn').addEventListener('click', () => viewer.zoom(1.25, 250));
  $('#cZoomOut').addEventListener('click', () => viewer.zoom(0.8, 250));
  $('#cReset').addEventListener('click', () => { viewer.zoomTo(undefined, 400); setTimeout(() => viewer.zoom(0.9, 200), 420); });
  $('#cSpin').addEventListener('click', (e) => {
    S.spin = !S.spin;
    LiquidGlass.setMotion(S.spin);
    e.currentTarget.classList.toggle('on', S.spin);
    viewer.spin(S.spin ? 'y' : false, 0.6);
  });
  $('#cShot').addEventListener('click', savePNG);
  $('#cFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  });

  $$('.nv').forEach((b) => b.addEventListener('click', () => {
    curView = b.dataset.view;
    $$('.nv').forEach((x) => x.classList.toggle('on', x === b));
    renderSide();
  }));
  $('#themeBtn').addEventListener('click', () => applyTheme(THEMES[(THEMES.indexOf(store.get('ml.theme', 'auto')) + 1) % 3]));
  const glassBtn = $('#glassBtn');
  const syncGlass = () => { LiquidGlass.setEnabled(S.set.glass); glassBtn.querySelector('span').textContent = LiquidGlass.supported ? `屈折 ${S.set.glass ? 'オン' : 'オフ'}` : '屈折 非対応'; glassBtn.disabled = !LiquidGlass.supported; };
  glassBtn.addEventListener('click', () => { S.set.glass = !S.set.glass; saveSettings(); syncGlass(); });
  syncGlass();

  window.addEventListener('hashchange', fromHash);
}

function fromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('cid')) { if (+h.get('cid') !== S.cur?.cid) loadCid(+h.get('cid')); return true; }
  if (h.get('q')) { $('#q').value = h.get('q'); search(h.get('q')); return true; }
  return false;
}

/* ===== 分子の作成 ===== */
const PALETTE = ['H', 'C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Br', 'I', 'B', 'Si'];
const TOOL_HINT = {
  add: '原子をクリック：選んだ元素を結合でつなぎます（水素があれば置き換え）。何もない所をクリック：原子を置きます。',
  bond: '原子を2つ順にクリック：間に結合を作ります。同じ次数の結合がすでにあれば切ります。環を閉じるときにも使います。',
  elem: '原子をクリック：選んだ元素に置き換えます。',
  erase: '原子をクリック：その原子（と付いている水素）を削除します。'
};
const BS = { mol: Builder.empty(), undo: [], redo: [], tool: 'add', elem: 'C', order: 1, pick: -1, baseName: '' };
const autoH = () => $('#bAutoH').checked;
const autoRelax = () => $('#bAutoRelax').checked;

// 表示中の座標（3Dmol＝モルファイル座標）を作成用データへ戻す
function syncBuildFromView() {
  if (S.cur?.source !== 'built' || S.X.length !== BS.mol.atoms.length) return;
  BS.mol.atoms.forEach((a, i) => { a.p = S.X[i].slice(); });
}
// 表示中の分子（PubChem など）を作成用データに取り込む
function builderFromCurrent() {
  const m = Builder.empty();
  S.atoms.forEach((a, i) => m.atoms.push({ e: a.elem, p: S.X[i].slice() }));
  S.atoms.forEach((a, i) => a.bonds.forEach((j, k) => { if (i < j) m.bonds.push({ a: i, b: j, o: a.bondOrder?.[k] || 1 }); }));
  BS.baseName = S.cur ? (S.cur.ja || S.cur.p.Title || '') : '';
  return m;
}
function ensureBuilder() {
  S.token++;   // 読み込み中の検索結果で作成中の分子を上書きしない
  if (S.cur?.source === 'built') { syncBuildFromView(); return; }
  BS.mol = S.atoms.length ? builderFromCurrent() : Builder.empty();
  BS.undo = []; BS.redo = []; BS.pick = -1;
}

function edit(fn) {
  ensureBuilder();
  BS.undo.push(Builder.clone(BS.mol));
  if (BS.undo.length > 80) BS.undo.shift();
  BS.redo = [];
  fn(BS.mol);
  afterEdit();
}

function afterEdit({ relax = autoRelax(), mmff = autoRelax() } = {}) {
  const first = S.cur?.source !== 'built' || S.atoms.length === 0;
  Builder.normalize(BS.mol);
  BS.pick = -1;
  if (relax) Builder.relax(BS.mol, 500);
  showBuilt({ resetView: first, mmff });
}

// 作成中の分子を表示する。OpenChemLib が解釈できれば立体化学・MMFF94s も使う
function showBuilt({ resetView = false, mmff = false } = {}) {
  const m = BS.mol;
  const counts = Builder.counts(m);
  S.strained = new Set(Builder.strained(m));
  S.sel = []; S.planeSel = []; S.planes = []; S.sym = null; S.confs = []; S.confActive = -1; ringBase = null;
  $('#symVerdict').innerHTML = ''; $('#confList').innerHTML = '';
  if (!m.atoms.length) {
    S.mol = null; S.mol0 = null; S.sdf = null;
    S.cur = { cid: null, p: { Title: '新しい分子', MolecularFormula: '', MolecularWeight: 0 }, source: 'built' };
    S.stereo = []; S.ez = []; S.chir = null; S.E = null;
    renderModel();
    $('#board').hidden = true; $('#empty').hidden = false;
    renderBuildStatus();
    return;
  }
  const molfile = Builder.toMolfile(m);
  let mol = null;
  if (hasOCL()) {
    try { mol = OCL.Molecule.fromMolfile(molfile); if (mol.getAllAtoms() !== m.atoms.length) mol = null; } catch (e) { mol = null; }
  }
  let usedMMFF = false;
  if (mol && mmff && !S.strained.size && m.atoms.length <= 120) {
    const before = getXYZ(mol);
    if (minimise(mol) != null) usedMMFF = true; else setXYZ(mol, before);
  }
  let smiles = '';
  try { smiles = mol ? mol.toIsomericSmiles() : ''; } catch (e) { smiles = ''; }
  S.mol = mol; S.mol0 = mol ? mol.getCompactCopy() : null; S.sdf = molfile;
  S.cur = {
    cid: null, ja: null, desc: '自作した分子', qid: null, source: 'built',
    p: { Title: BS.baseName ? `${BS.baseName}（編集）` : '新しい分子', MolecularFormula: hill(counts), MolecularWeight: Builder.weight(m), SMILES: smiles }
  };
  S.E = mol ? energyOf(mol) : null; S.Emin = null;
  S.Elabel = usedMMFF ? '自作分子（MMFF94s で最適化）' : '自作分子（簡易力場で整形）';
  if (mol) analyzeStereo(); else { S.stereo = []; S.ez = []; S.chir = null; }
  $('#empty').hidden = true;
  renderModel({ resetView });
  syncBuildFromView();      // MMFF で動いた座標を作成用データにも反映
  renderStereoPanel();
  renderInfo();
  renderBuildStatus(usedMMFF);
  history.replaceState(null, '', location.pathname);
}

function buildClick(i) {
  ensureBuilder();
  const ax = viewAxes();
  const tool = BS.tool, el = BS.elem, order = BS.order;
  if (tool === 'bond') {
    if (BS.pick < 0) { BS.pick = i; drawShapes(); viewer.render(); LB.dirty = true; return; }
    const a = BS.pick;
    BS.pick = -1;
    if (a === i) { drawShapes(); viewer.render(); LB.dirty = true; return; }
    edit((m) => {
      const k = Builder.findBond(m, a, i);
      const A = m.atoms[a], B = m.atoms[i];
      Builder.setBond(m, a, i, k >= 0 && m.bonds[k].o === order ? 0 : order);
      if (autoH()) { Builder.fillHydrogens(m, m.atoms.indexOf(A), ax.toward); Builder.fillHydrogens(m, m.atoms.indexOf(B), ax.toward); }
    });
    return;
  }
  edit((m) => {
    if (tool === 'erase') {
      const target = m.atoms[i];
      const heavyNbrs = Builder.nbrs(m, i).map((n) => m.atoms[n.j]).filter((x) => x.e !== 'H');
      const hs = target.e === 'H' ? [] : Builder.hydrogensOf(m, i);
      Builder.deleteAtoms(m, [i, ...hs]);
      if (autoH()) heavyNbrs.forEach((x) => Builder.fillHydrogens(m, m.atoms.indexOf(x), ax.toward));
    } else if (tool === 'elem') {
      m.atoms[i].e = el;
      if (autoH()) Builder.fillHydrogens(m, i, ax.toward);
    } else {
      // 水素をクリックしたら、その水素を新しい原子に置き換える
      const ns = Builder.nbrs(m, i);
      if (autoH() && el !== 'H' && m.atoms[i].e === 'H' && ns.length === 1) {
        const parent = m.atoms[ns[0].j], H = m.atoms[i];
        const dir = Chem.unit(Chem.sub(H.p, parent.p));
        Builder.deleteAtoms(m, [i]);
        const pi = m.atoms.indexOf(parent);
        const len = ((Builder.COV[parent.e] ?? 1.2) + (Builder.COV[el] ?? 1.2)) * (order === 2 ? 0.87 : order === 3 ? 0.78 : 1);
        const j = Builder.addAtom(m, el, Chem.add(parent.p, Chem.mul(dir, len)));
        m.bonds.push({ a: pi, b: j, o: order });
        const newAtom = m.atoms[j];
        Builder.fillHydrogens(m, m.atoms.indexOf(parent), ax.toward);
        Builder.fillHydrogens(m, m.atoms.indexOf(newAtom), ax.toward);
        return;
      }
      const parent = m.atoms[i];
      let newAtom;
      const hs = Builder.hydrogensOf(m, i);
      if (autoH() && el !== 'H' && parent.e !== 'H' && hs.length) {
        // 水素を置き換える：その水素の方向に新しい原子を置く
        const H = m.atoms[hs[0]];
        const dir = Chem.unit(Chem.sub(H.p, parent.p));
        Builder.deleteAtoms(m, [hs[0]]);
        const pi = m.atoms.indexOf(parent);
        const len = (Builder.COV[parent.e] ?? 1.2) + (Builder.COV[el] ?? 1.2);
        const j = Builder.addAtom(m, el, Chem.add(parent.p, Chem.mul(dir, len * (order === 2 ? 0.87 : order === 3 ? 0.78 : 1))));
        m.bonds.push({ a: pi, b: j, o: order });
        newAtom = m.atoms[j];
      } else {
        newAtom = m.atoms[Builder.attach(m, i, el, order, ax.toward, ax.right)];
      }
      if (autoH()) {
        Builder.fillHydrogens(m, m.atoms.indexOf(parent), ax.toward);
        Builder.fillHydrogens(m, m.atoms.indexOf(newAtom), ax.toward);
      }
    }
  });
}

function emptyClick(x, y) {
  if (BS.tool !== 'add') return;
  const p = screenToModel(x, y);
  const ax = viewAxes();
  edit((m) => {
    const k = Builder.addAtom(m, BS.elem, m.atoms.length ? p : ax.center);
    if (autoH()) Builder.fillHydrogens(m, k, ax.toward);
  });
}

function renderBuildStatus(usedMMFF) {
  const m = BS.mol, box = $('#buildStatus');
  if (S.cur?.source !== 'built') { box.innerHTML = '<b>表示中の分子</b>をそのまま編集できます。原子をクリックすると自動で取り込みます。'; return; }
  if (!m.atoms.length) { box.innerHTML = '何もない所をクリックすると、選んだ元素の原子を置きます。'; return; }
  const c = Builder.counts(m);
  const warn = [...S.strained].map((i) => `${S.names[i] || m.atoms[i].e}：結合次数の和 ${Builder.orderSum(m, i)}（通常は ${Builder.MAXV[m.atoms[i].e] ?? '—'} まで）`);
  box.innerHTML = `<b>${subFormula(hill(c))}</b>　${Builder.weight(m).toFixed(2)} g/mol<br>原子 ${m.atoms.length}・結合 ${m.bonds.length}` +
    (S.cur.p.SMILES ? `<br>SMILES：<span style="font-family:var(--mono);font-size:12px">${esc(S.cur.p.SMILES)}</span>` : '') +
    `<br>形：${usedMMFF ? 'MMFF94s で最適化' : S.mol ? '簡易力場で整形（「形を整える」で MMFF94s）' : '簡易力場で整形（OpenChemLib で解釈できない構造）'}` +
    (warn.length ? `<br><span class="warnline">無理のある結合：</span>${warn.map(esc).join('、')}` : '');
}

function bindBuilder() {
  $('#palette').innerHTML = PALETTE.map((e) => `<button type="button" class="pel${e === BS.elem ? ' on' : ''}" data-el="${e}"><i style="background:${Chem.color(e)}"></i>${e}</button>`).join('');
  const pickElem = (e) => {
    BS.elem = e;
    $$('#palette .pel').forEach((b) => b.classList.toggle('on', b.dataset.el === e));
  };
  $('#palette').addEventListener('click', (e) => { const b = e.target.closest('.pel'); if (b) { pickElem(b.dataset.el); $('#elemCustom').value = ''; } });
  $('#elemCustom').addEventListener('change', (e) => {
    const t = e.target.value.trim();
    const sym = t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : '';
    if (ELEMENTS.has(sym)) { pickElem(sym); e.target.value = sym; } else if (t) { toast('元素記号ではありません', `「${t}」は周期表にありません。`, 'err'); e.target.value = ''; }
  });
  const seg = (sel, key, attr, cb) => $(sel).addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    BS[key] = attr === 'order' ? +b.dataset[attr] : b.dataset[attr];
    $$(`${sel} button`).forEach((x) => x.classList.toggle('on', x === b));
    cb?.();
  });
  const hint = () => { $('#toolHint').textContent = TOOL_HINT[BS.tool]; BS.pick = -1; if (S.model) { drawShapes(); viewer.render(); } LB.dirty = true; };
  seg('#toolSeg', 'tool', 'tool', hint);
  seg('#orderSeg', 'order', 'order');
  hint();

  $('#bNew').addEventListener('click', () => {
    S.token++; setBusy(false);
    BS.mol = Builder.empty(); BS.undo = []; BS.redo = []; BS.baseName = '';
    S.cur = { source: 'built', p: {} };
    showBuilt();
    setClick('build');
    toast('新しい分子', '何もない所をクリックして最初の原子を置いてください。');
  });
  $('#bFromCur').addEventListener('click', () => {
    if (!S.atoms.length) return;
    BS.mol = builderFromCurrent(); BS.undo = []; BS.redo = [];
    showBuilt();
    setClick('build');
  });
  $('#bUndo').addEventListener('click', () => {
    if (!BS.undo.length) return;
    syncBuildFromView();
    BS.redo.push(Builder.clone(BS.mol)); BS.mol = BS.undo.pop(); showBuilt();
  });
  $('#bRedo').addEventListener('click', () => {
    if (!BS.redo.length) return;
    syncBuildFromView();
    BS.undo.push(Builder.clone(BS.mol)); BS.mol = BS.redo.pop(); showBuilt();
  });
  $('#bFillH').addEventListener('click', () => edit((m) => Builder.fillAllHydrogens(m, viewAxes().toward)));
  $('#bStripH').addEventListener('click', () => edit((m) => Builder.removeAllHydrogens(m)));
  $('#bClean').addEventListener('click', () => {
    ensureBuilder();
    if (!BS.mol.atoms.length) return;
    BS.undo.push(Builder.clone(BS.mol)); BS.redo = [];
    Builder.normalize(BS.mol);
    Builder.relax(BS.mol, 2000);
    showBuilt({ mmff: true });
    toast('形を整えました', S.Elabel.includes('MMFF') ? 'MMFF94s 力場で最適化しました。' : '簡易力場（結合長・VSEPR の結合角・原子の重なり）で整えました。', 'ok');
  });

  // 何もない所のクリック（ドラッグで回転したときは除く）
  let down = null;
  $('#viewer').addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; LiquidGlass.setMotion(true); });
  window.addEventListener('pointerup', () => { if (!S.spin) LiquidGlass.setMotion(false); });
  $('#viewer').addEventListener('wheel', () => { LiquidGlass.setMotion(true); if (!S.spin) LiquidGlass.setMotion(false, 500); }, { passive: true });
  $('#viewer').addEventListener('pointerup', (e) => {
    if (!down || S.clickMode !== 'build') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const t = performance.now();
    setTimeout(() => { if (S.atomClickT < t - 5) emptyClick(e.clientX, e.clientY); }, 60);
  });
}

/* ===== 起動 ===== */
applyTheme(store.get('ml.theme', 'auto'));
LiquidGlass.init();
initViewer();
bind();
bindBuilder();
renderSide();
requestAnimationFrame(labelLoop);
if (!hasOCL()) toast('OpenChemLib を読み込めませんでした', '立体化学・配座の機能は使えません（表示は可能）。', 'err');
if (!fromHash()) loadCid(16666, { ja: '(−)-メントール' });
