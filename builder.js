'use strict';
/* 分子エディタ：原子を自由につないで分子を作る。
   化学的に無理のある結合（超原子価など）も受け付け、簡易力場で形を整える。 */
const Builder = (() => {
  const { sub, add, mul, dot, cross, norm, unit, dist } = Chem;
  const DEG = Chem.DEG;

  // 共有結合半径 [Å]（Cordero et al. 2008）
  const COV = {
    H: 0.31, He: 0.28, Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58, Na: 1.66, Mg: 1.41,
    Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06, K: 2.03, Ca: 1.76, Ti: 1.60, Cr: 1.39, Mn: 1.39, Fe: 1.32,
    Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.20, As: 1.19, Se: 1.20, Br: 1.20, Kr: 1.16, Ag: 1.45,
    Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39, Xe: 1.40, Pt: 1.36, Au: 1.36, Hg: 1.32, Pb: 1.46
  };
  // 価電子数（孤立電子対の見積もり用）
  const VE = { H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, Ca: 2, B: 3, Al: 3, Ga: 3, C: 4, Si: 4, Ge: 4, Sn: 4, Pb: 4,
    N: 5, P: 5, As: 5, Sb: 5, O: 6, S: 6, Se: 6, Te: 6, F: 7, Cl: 7, Br: 7, I: 7, He: 8, Ne: 8, Ar: 8, Kr: 8, Xe: 8 };
  // 通常の原子価（水素を補う数）
  const STD = { H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, Ca: 2, B: 3, Al: 3, C: 4, Si: 4, Ge: 4, Sn: 4, N: 3, P: 3, As: 3,
    O: 2, S: 2, Se: 2, Te: 2, F: 1, Cl: 1, Br: 1, I: 1 };
  // これを超えると「無理のある結合」として印を付ける
  const MAXV = { H: 1, Li: 1, Na: 1, K: 1, Be: 2, Mg: 2, B: 4, Al: 4, C: 4, Si: 4, Ge: 4, N: 3, O: 2, F: 1,
    P: 5, As: 5, S: 6, Se: 6, Te: 6, Cl: 7, Br: 7, I: 7, He: 0, Ne: 0, Ar: 0 };
  // 標準原子量
  const WEIGHT = {
    H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
    Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078,
    Ti: 47.867, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723,
    Ge: 72.630, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Ag: 107.87, Sn: 118.71, Sb: 121.76, Te: 127.60,
    I: 126.90, Xe: 131.29, Pt: 195.08, Au: 196.97, Hg: 200.59, Pb: 207.2
  };
  const ORDER_K = [1, 1, 0.87, 0.78];

  const empty = () => ({ atoms: [], bonds: [] });
  const clone = (m) => ({ atoms: m.atoms.map((a) => ({ e: a.e, p: a.p.slice() })), bonds: m.bonds.map((b) => ({ ...b })) });
  const findBond = (m, i, j) => m.bonds.findIndex((b) => (b.a === i && b.b === j) || (b.a === j && b.b === i));
  const nbrs = (m, i) => m.bonds.filter((b) => b.a === i || b.b === i).map((b) => ({ j: b.a === i ? b.b : b.a, o: b.o }));
  const orderSum = (m, i) => nbrs(m, i).reduce((s, n) => s + n.o, 0);
  const bondLen = (e1, e2, o) => ((COV[e1] ?? 1.2) + (COV[e2] ?? 1.2)) * (ORDER_K[o] ?? 1);
  const lonePairs = (m, i) => Math.max(0, Math.floor(((VE[m.atoms[i].e] ?? 4) - orderSum(m, i)) / 2));
  // VSEPR：σ結合の数＋孤立電子対の数から理想結合角を決める（孤立電子対1つにつき約2.5°狭める）
  function idealAngle(domains, lp) {
    if (domains <= 2) return 180;
    if (domains === 3) return 120 - (lp ? 2 : 0);
    if (domains === 4) return 109.47 - 2.5 * lp;
    return 90;
  }

  /* ---------- 編集操作 ---------- */
  function addAtom(m, e, p) { m.atoms.push({ e, p: p.slice() }); return m.atoms.length - 1; }

  // 原子 i から伸ばす新しい結合の向き。既存の結合と VSEPR の理想角をなし、なるべく画面と平行になる向きを選ぶ
  function openDirection(m, i, order, view, right) {
    const ns = nbrs(m, i);
    if (!ns.length) return right ? unit(right) : [1, 0, 0];
    const us = ns.map((n) => unit(sub(m.atoms[n.j].p, m.atoms[i].p)));
    const lp = Math.max(0, Math.floor(((VE[m.atoms[i].e] ?? 4) - orderSum(m, i) - order) / 2));
    const theta = idealAngle(ns.length + 1 + lp, lp);
    let best = null, bestScore = -Infinity;
    const N = 240;
    for (let k = 0; k < N; k++) {   // フィボナッチ球面上の候補
      const z = 1 - (2 * k + 1) / N, r = Math.sqrt(1 - z * z), phi = k * 2.399963229728653;
      const d = [r * Math.cos(phi), r * Math.sin(phi), z];
      let s = 0, minAng = 180;
      for (const u of us) {
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(d, u)))) * DEG;
        s -= (ang - theta) ** 2;
        minAng = Math.min(minAng, ang);
      }
      if (minAng < 60) s -= 1e4;
      if (view) s -= 400 * Math.abs(dot(d, view));
      if (s > bestScore) { bestScore = s; best = d; }
    }
    return best;
  }

  function attach(m, i, e, order, view, right) {
    const d = openDirection(m, i, order, view, right);
    const j = addAtom(m, e, add(m.atoms[i].p, mul(d, bondLen(m.atoms[i].e, e, order))));
    m.bonds.push({ a: i, b: j, o: order });
    return j;
  }

  // 結合を設定（order 0 で削除）
  function setBond(m, i, j, order) {
    if (i === j) return;
    const k = findBond(m, i, j);
    if (order <= 0) { if (k >= 0) m.bonds.splice(k, 1); return; }
    if (k >= 0) m.bonds[k].o = order; else m.bonds.push({ a: i, b: j, o: order });
  }

  function deleteAtoms(m, list) {
    const del = new Set(list);
    const map = [];
    const atoms = [];
    m.atoms.forEach((a, i) => { if (!del.has(i)) { map[i] = atoms.length; atoms.push(a); } });
    m.atoms = atoms;
    m.bonds = m.bonds.filter((b) => !del.has(b.a) && !del.has(b.b)).map((b) => ({ a: map[b.a], b: map[b.b], o: b.o }));
    return map;
  }
  const hydrogensOf = (m, i) => nbrs(m, i).filter((n) => m.atoms[n.j].e === 'H').map((n) => n.j);

  // 原子 i を通常の原子価まで水素で満たす（多すぎる水素は外す）
  function fillHydrogens(m, i, view) {
    const e = m.atoms[i].e;
    if (e === 'H') return;
    const want = (STD[e] ?? 0) - nbrs(m, i).filter((n) => m.atoms[n.j].e !== 'H').reduce((s, n) => s + n.o, 0);
    const atom = m.atoms[i];
    const hs = hydrogensOf(m, i);
    if (hs.length > Math.max(0, want)) deleteAtoms(m, hs.slice(0, hs.length - Math.max(0, want)));
    const idx = m.atoms.indexOf(atom);
    for (let k = hydrogensOf(m, idx).length; k < want; k++) attach(m, idx, 'H', 1, view);
  }
  function fillAllHydrogens(m, view) {
    const heavy = m.atoms.filter((a) => a.e !== 'H');
    for (const a of heavy) fillHydrogens(m, m.atoms.indexOf(a), view);
  }
  function removeAllHydrogens(m) { deleteAtoms(m, m.atoms.map((a, i) => (a.e === 'H' ? i : -1)).filter((i) => i >= 0)); }

  // 水素を後ろに並べ替える（OpenChemLib が水素を末尾へ移すため、原子番号をそろえておく）
  function normalize(m) {
    const order = [...m.atoms.keys()].sort((x, y) => (m.atoms[x].e === 'H') - (m.atoms[y].e === 'H') || x - y);
    const map = [];
    order.forEach((old, k) => { map[old] = k; });
    m.atoms = order.map((i) => m.atoms[i]);
    m.bonds = m.bonds.map((b) => ({ a: map[b.a], b: map[b.b], o: b.o }));
    return map;
  }

  /* ---------- 簡易力場（結合長・VSEPR 角・二重結合のねじれ・原子の重なり） ---------- */
  function relax(m, iters = 500) {
    const n = m.atoms.length;
    if (n < 2) return;
    const P = m.atoms.map((a) => a.p.slice());
    const E = m.atoms.map((a) => a.e);
    // 1-2・1-3 の組を作る
    const adj = [...Array(n)].map(() => []);
    m.bonds.forEach((b) => { adj[b.a].push(b.b); adj[b.b].push(b.a); });
    const pairKey = (i, j) => (i < j ? i * n + j : j * n + i);
    const close = new Set();
    const terms = [];   // [i, j, r0, k, repulsiveOnly]
    m.bonds.forEach((b) => { terms.push([b.a, b.b, bondLen(E[b.a], E[b.b], b.o), 1.0, false]); close.add(pairKey(b.a, b.b)); });
    for (let j = 0; j < n; j++) {
      const ns = adj[j];
      if (ns.length < 2) continue;
      const lp = lonePairs(m, j);
      const theta = idealAngle(ns.length + lp, lp) / DEG;
      const many = ns.length + lp >= 5;
      for (let x = 0; x < ns.length; x++) {
        for (let y = x + 1; y < ns.length; y++) {
          const i = ns[x], k = ns[y];
          const ri = bondLen(E[i], E[j], m.bonds[findBond(m, i, j)].o), rk = bondLen(E[k], E[j], m.bonds[findBond(m, k, j)].o);
          const d0 = Math.sqrt(ri * ri + rk * rk - 2 * ri * rk * Math.cos(many ? Math.PI / 2 : theta));
          terms.push([i, k, d0, 0.5, many]);
          close.add(pairKey(i, k));
        }
      }
    }
    // 二重結合まわりの平面性（sin²φ を最小化：シス／トランスは現状を保つ）
    const tors = [];
    m.bonds.filter((b) => b.o === 2).forEach((b) => {
      for (const i of adj[b.a]) if (i !== b.b) for (const l of adj[b.b]) if (l !== b.a) tors.push([i, b.a, b.b, l]);
    });
    const vdwSum = (i, j) => (Chem.vdw(E[i]) + Chem.vdw(E[j])) * 0.62;

    function energyGrad(X, G) {
      let en = 0;
      for (const [i, j, r0, k, rep] of terms) {
        const d = sub(X[j], X[i]); const r = norm(d) || 1e-6;
        if (rep && r > r0) continue;
        const dr = r - r0; en += k * dr * dr;
        const f = mul(d, (2 * k * dr) / r);
        G[j] = add(G[j], f); G[i] = sub(G[i], f);
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (close.has(i * n + j)) continue;
          const d = sub(X[j], X[i]); const r = norm(d) || 1e-6;
          const r0 = vdwSum(i, j);
          if (r >= r0) continue;
          const dr = r - r0; en += 0.3 * dr * dr;
          const f = mul(d, (0.6 * dr) / r);
          G[j] = add(G[j], f); G[i] = sub(G[i], f);
        }
      }
      for (const t of tors) {   // 数値微分（項が少ないので十分速い）
        const f = () => { const s = Math.sin(Chem.dihedral(X[t[0]], X[t[1]], X[t[2]], X[t[3]]) / DEG); return 0.3 * s * s; };
        const e0 = f(); en += e0;
        for (const a of t) for (let c = 0; c < 3; c++) {
          const h = 1e-4, old = X[a][c];
          X[a][c] = old + h; const e1 = f(); X[a][c] = old;
          G[a][c] += (e1 - e0) / h;
        }
      }
      return en;
    }

    // 完全に重なった原子や一直線の退化を避けるため、わずかに揺らす
    for (const p of P) for (let c = 0; c < 3; c++) p[c] += (Math.random() - 0.5) * 0.02;
    let step = 0.05;
    let G = P.map(() => [0, 0, 0]);
    let en = energyGrad(P, G);
    for (let it = 0; it < iters; it++) {
      const trial = P.map((p, i) => {
        const g = G[i]; const gl = norm(g);
        const s = Math.min(step, 0.2 / (gl || 1));   // 1 回の移動を 0.2 Å までに制限
        return sub(p, mul(g, s));
      });
      const G2 = P.map(() => [0, 0, 0]);
      const en2 = energyGrad(trial, G2);
      if (en2 <= en) {
        for (let i = 0; i < n; i++) P[i] = trial[i];
        G = G2; en = en2; step = Math.min(step * 1.15, 0.3);
        if (en < 1e-6) break;
      } else {
        step *= 0.5;
        if (step < 1e-6) break;
      }
    }
    m.atoms.forEach((a, i) => { a.p = P[i]; });
  }

  /* ---------- 書き出し・集計 ---------- */
  function toMolfile(m) {
    const f = (x) => x.toFixed(4).padStart(10);
    const lines = ['Molecule Line', '  ML-builder 3D', '',
      // キラルフラグ 1：3D 座標どおりの絶対配置として扱う（0 だとラセミ扱いになる）
      `${String(m.atoms.length).padStart(3)}${String(m.bonds.length).padStart(3)}  0  0  1  0  0  0  0  0999 V2000`];
    for (const a of m.atoms) lines.push(`${f(a.p[0])}${f(a.p[1])}${f(a.p[2])} ${a.e.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
    for (const b of m.bonds) lines.push(`${String(b.a + 1).padStart(3)}${String(b.b + 1).padStart(3)}${String(b.o).padStart(3)}  0  0  0  0`);
    lines.push('M  END');
    return lines.join('\n');
  }
  // V2000 モルファイルを読み込む（保存した分子・メソ体への変換に使う）
  function fromMolfile(text) {
    const L = text.split(/\r?\n/);
    const na = parseInt(L[3].slice(0, 3)), nb = parseInt(L[3].slice(3, 6));
    const m = empty();
    for (let i = 0; i < na; i++) {
      const l = L[4 + i];
      m.atoms.push({ e: l.slice(31, 34).trim(), p: [parseFloat(l.slice(0, 10)), parseFloat(l.slice(10, 20)), parseFloat(l.slice(20, 30))] });
    }
    for (let i = 0; i < nb; i++) {
      const l = L[4 + na + i];
      const o = parseInt(l.slice(6, 9));
      m.bonds.push({ a: parseInt(l.slice(0, 3)) - 1, b: parseInt(l.slice(3, 6)) - 1, o: o >= 1 && o <= 3 ? o : 1 });
    }
    return m;
  }
  function counts(m) {
    const c = {};
    for (const a of m.atoms) c[a.e] = (c[a.e] || 0) + 1;
    return c;
  }
  const weight = (m) => m.atoms.reduce((s, a) => s + (WEIGHT[a.e] ?? 0), 0);
  // 原子価を超えた（無理のある）原子
  const strained = (m) => m.atoms.map((a, i) => (orderSum(m, i) > (MAXV[a.e] ?? 8) ? i : -1)).filter((i) => i >= 0);

  return {
    COV, STD, MAXV, empty, clone, fromMolfile, nbrs, orderSum, findBond, addAtom, attach, setBond, deleteAtoms,
    fillHydrogens, fillAllHydrogens, removeAllHydrogens, hydrogensOf, normalize, relax, toMolfile, counts, weight, strained
  };
})();
