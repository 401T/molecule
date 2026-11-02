'use strict';
/* 幾何・化学の計算（UI に依存しない純粋関数） */
const Chem = (() => {
  /* ---------- ベクトル ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / (norm(a) || 1));
  const dist = (a, b) => norm(sub(a, b));
  const centroid = (P) => mul(P.reduce(add, [0, 0, 0]), 1 / P.length);
  const DEG = 180 / Math.PI;

  /* ---------- 元素データ ---------- */
  // Jmol / CPK 配色
  const COLORS = {
    H: '#FFFFFF', He: '#D9FFFF', Li: '#CC80FF', Be: '#C2FF00', B: '#FFB5B5', C: '#909090', N: '#3050F8', O: '#FF0D0D',
    F: '#90E050', Ne: '#B3E3F5', Na: '#AB5CF2', Mg: '#8AFF00', Al: '#BFA6A6', Si: '#F0C8A0', P: '#FF8000', S: '#FFFF30',
    Cl: '#1FF01F', Ar: '#80D1E3', K: '#8F40D4', Ca: '#3DFF00', Sc: '#E6E6E6', Ti: '#BFC2C7', V: '#A6A6AB', Cr: '#8A99C7',
    Mn: '#9C7AC7', Fe: '#E06633', Co: '#F090A0', Ni: '#50D050', Cu: '#C88033', Zn: '#7D80B0', Ga: '#C28F8F', Ge: '#668F8F',
    As: '#BD80E3', Se: '#FFA100', Br: '#A62929', Kr: '#5CB8D1', Rb: '#702EB0', Sr: '#00FF00', Mo: '#54B5B5', Ru: '#248F8F',
    Rh: '#0A7D8C', Pd: '#006985', Ag: '#C0C0C0', Cd: '#FFD98F', Sn: '#668080', Sb: '#9E63B5', Te: '#D47A00', I: '#940094',
    Xe: '#429EB0', Cs: '#57178F', Ba: '#00C900', Gd: '#45FFC7', W: '#2194D6', Os: '#266696', Ir: '#175487', Pt: '#D0D0E0',
    Au: '#FFD123', Hg: '#B8B8D0', Pb: '#575961', Bi: '#9E4FB5', U: '#008FFF'
  };
  // ファンデルワールス半径 [Å]（Bondi 1964、未収載は Mantina 2009 など）
  const VDW = {
    H: 1.20, He: 1.40, Li: 1.82, Be: 1.53, B: 1.92, C: 1.70, N: 1.55, O: 1.52, F: 1.47, Ne: 1.54, Na: 2.27, Mg: 1.73,
    Al: 1.84, Si: 2.10, P: 1.80, S: 1.80, Cl: 1.75, Ar: 1.88, K: 2.75, Ca: 2.31, Ni: 1.63, Cu: 1.40, Zn: 1.39, Ga: 1.87,
    Ge: 2.11, As: 1.85, Se: 1.90, Br: 1.85, Kr: 2.02, Pd: 1.63, Ag: 1.72, Cd: 1.58, In: 1.93, Sn: 2.17, Sb: 2.06, Te: 2.06,
    I: 1.98, Xe: 2.16, Pt: 1.75, Au: 1.66, Hg: 1.55, Tl: 1.96, Pb: 2.02, Bi: 2.07, U: 1.86
  };
  const ELEM_JA = {
    H: '水素', He: 'ヘリウム', Li: 'リチウム', Be: 'ベリリウム', B: 'ホウ素', C: '炭素', N: '窒素', O: '酸素', F: 'フッ素',
    Ne: 'ネオン', Na: 'ナトリウム', Mg: 'マグネシウム', Al: 'アルミニウム', Si: 'ケイ素', P: 'リン', S: '硫黄', Cl: '塩素',
    Ar: 'アルゴン', K: 'カリウム', Ca: 'カルシウム', Ti: 'チタン', Cr: 'クロム', Mn: 'マンガン', Fe: '鉄', Co: 'コバルト',
    Ni: 'ニッケル', Cu: '銅', Zn: '亜鉛', Ge: 'ゲルマニウム', As: 'ヒ素', Se: 'セレン', Br: '臭素', Kr: 'クリプトン',
    Pd: 'パラジウム', Ag: '銀', Sn: 'スズ', I: 'ヨウ素', Xe: 'キセノン', Pt: '白金', Au: '金', Hg: '水銀', Pb: '鉛'
  };
  const color = (e) => COLORS[e] || '#FF1493';
  const vdw = (e) => VDW[e] || 2.0;
  // 球の色が明るいか（ラベル文字色の切替用）
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 150;
  }

  /* ---------- 3×3 対称行列の固有分解（Jacobi 法） ---------- */
  function eigSym3(A) {
    const a = A.map((r) => r.slice());
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
      if (off < 1e-18) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    const vals = [a[0][0], a[1][1], a[2][2]];
    const vecs = [0, 1, 2].map((i) => [V[0][i], V[1][i], V[2][i]]);
    const order = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
    return { values: order.map((i) => vals[i]), vectors: order.map((i) => vecs[i]) };
  }

  /* ---------- 最小二乗平面 ---------- */
  function fitPlane(P) {
    const c = centroid(P);
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const p of P) {
      const d = sub(p, c);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
    }
    const { vectors } = eigSym3(C);
    let n = unit(vectors[0]);
    if (P.length === 3) n = unit(cross(sub(P[1], P[0]), sub(P[2], P[0])));
    const rms = Math.sqrt(P.reduce((s, p) => s + dot(sub(p, c), n) ** 2, 0) / P.length);
    return { c, n, u: unit(vectors[2]), v: unit(cross(n, unit(vectors[2]))), rms };
  }

  /* ---------- 対称操作の判定 ---------- */
  // op(p) で全原子が同じ元素の原子に重なるか。重なれば最大ずれ [Å] を返す
  function matchOp(atoms, op, tol) {
    let maxDev = 0;
    for (const a of atoms) {
      const q = op(a.p);
      let best = Infinity;
      for (const b of atoms) {
        if (b.e !== a.e) continue;
        const d = dist(q, b.p);
        if (d < best) best = d;
      }
      if (best > tol) return null;
      if (best > maxDev) maxDev = best;
    }
    return maxDev;
  }
  const reflect = (c, n) => (p) => sub(p, mul(n, 2 * dot(sub(p, c), n)));

  // 鏡映面（σ）と対称心（i）を探す。鏡映面は必ず重心を通る
  function findSymmetry(atoms, tol = 0.2) {
    const c = centroid(atoms.map((a) => a.p));
    const planes = [];
    const tested = [];
    const consider = (n) => {
      n = unit(n);
      if (tested.some((m) => Math.abs(dot(m, n)) > 0.996)) return;
      tested.push(n);
      const dev = matchOp(atoms, reflect(c, n), tol);
      if (dev != null) planes.push({ c, n, dev });
    };
    const all = fitPlane(atoms.map((a) => a.p));
    if (atoms.length >= 3 && all.rms < tol / 2) consider(all.n);           // 平面分子：分子面そのもの
    if (atoms.length <= 400) {
      for (let i = 0; i < atoms.length; i++) {
        for (let j = i + 1; j < atoms.length; j++) {
          if (atoms[i].e !== atoms[j].e) continue;
          const d = sub(atoms[j].p, atoms[i].p);
          if (norm(d) < 0.3) continue;
          const n = unit(d);
          const mid = mul(add(atoms[i].p, atoms[j].p), 0.5);
          if (Math.abs(dot(sub(mid, c), n)) > tol) continue;             // 重心を通らない面は対象外
          consider(n);
        }
      }
    }
    const inv = matchOp(atoms, (p) => sub(mul(c, 2), p), tol);
    return { planes, inversion: inv, center: c };
  }

  // 任意の平面が鏡映面かどうか
  function testMirror(atoms, c, n, tol = 0.2) {
    let worst = 0, bad = 0;
    for (const a of atoms) {
      const q = reflect(c, n)(a.p);
      let best = Infinity;
      for (const b of atoms) if (b.e === a.e) best = Math.min(best, dist(q, b.p));
      if (best > tol) bad++;
      worst = Math.max(worst, best);
    }
    return { ok: bad === 0, worst, bad };
  }

  // 任意の点が対称心かどうか
  function testInversion(atoms, c, tol = 0.2) {
    let worst = 0, bad = 0;
    for (const a of atoms) {
      const q = sub(mul(c, 2), a.p);
      let best = Infinity;
      for (const b of atoms) if (b.e === a.e) best = Math.min(best, dist(q, b.p));
      if (best > tol) bad++;
      worst = Math.max(worst, best);
    }
    return { ok: bad === 0, worst, bad };
  }

  /* ---------- Cremer–Pople 環のパッカリング解析 ---------- */
  function ringFrame(P) {
    const N = P.length, c = centroid(P);
    const Q = P.map((p) => sub(p, c));
    let R1 = [0, 0, 0], R2 = [0, 0, 0];
    Q.forEach((q, j) => {
      R1 = add(R1, mul(q, Math.sin(2 * Math.PI * j / N)));
      R2 = add(R2, mul(q, Math.cos(2 * Math.PI * j / N)));
    });
    const ex = unit(R2);
    const ey = unit(sub(R1, mul(ex, dot(R1, ex))));
    return { c, ex, ey, n: cross(ex, ey), Q };
  }

  function cremerPople(P) {
    const N = P.length;
    const f = ringFrame(P);
    const z = f.Q.map((q) => dot(q, f.n));
    let a = 0, b = 0;
    z.forEach((zj, j) => { a += zj * Math.cos(4 * Math.PI * j / N); b += zj * Math.sin(4 * Math.PI * j / N); });
    const q2c = Math.sqrt(2 / N) * a, q2s = -Math.sqrt(2 / N) * b;
    const q2 = Math.hypot(q2c, q2s);
    const phi = ((Math.atan2(q2s, q2c) * DEG) % 360 + 360) % 360;
    const out = { N, frame: f, z, q2, phi, Q: q2 };
    if (N % 2 === 0) {
      const q3 = Math.sqrt(1 / N) * z.reduce((s, zj, j) => s + zj * (j % 2 ? -1 : 1), 0);
      out.q3 = q3;
      out.Q = Math.hypot(q2, q3);
      out.theta = Math.atan2(q2, q3) * DEG;
    }
    out.name = classifyRing(out);
    return out;
  }

  function classifyRing(cp) {
    if (cp.Q < 0.1) return '平面';
    if (cp.N === 6) {
      const t = cp.theta;
      const pm = cp.phi % 60, dphi = Math.min(pm, 60 - pm);     // 0: 舟形系列, 30: ねじれ舟形系列
      // θ≈0° と θ≈180° はどちらも椅子形（どちらになるかは原子の番号の向きで決まるだけ）
      if (t < 22.5 || t > 157.5) return '椅子形';
      if (t >= 67.5 && t <= 112.5) return dphi < 10 ? '舟形' : dphi > 20 ? 'ねじれ舟形' : '舟形〜ねじれ舟形';
      return dphi > 20 ? '半いす形' : dphi < 10 ? '封筒形（ソファ形）' : '半いす形〜封筒形';
    }
    if (cp.N === 5) {
      const pm = cp.phi % 36, d = Math.min(pm, 36 - pm);
      return d < 6 ? '封筒形' : d > 12 ? 'ねじれ形' : '封筒形〜ねじれ形';
    }
    return cp.Q > 0.3 ? 'ひだ状' : 'ほぼ平面';
  }

  // 六員環を (Q, θ, φ) の理想形に置き換えた環原子座標
  function ringTargets(P, Q, theta, phi) {
    const N = 6;
    const f = ringFrame(P);
    const t = theta / DEG, ph = phi / DEG;
    const q2 = Q * Math.sin(t), q3 = Q * Math.cos(t);
    const z = [];
    for (let j = 0; j < N; j++) z.push(Math.sqrt(2 / N) * q2 * Math.cos(ph + 4 * Math.PI * j / N) + Math.sqrt(1 / N) * q3 * (j % 2 ? -1 : 1));
    let d2 = 0, dz2 = 0;
    for (let j = 0; j < N; j++) {
      d2 += dist(P[j], P[(j + 1) % N]) ** 2;
      dz2 += (z[j] - z[(j + 1) % N]) ** 2;
    }
    const R = Math.sqrt(Math.max(0.5, (d2 - dz2) / N)) / (2 * Math.sin(Math.PI / N));
    return z.map((zj, j) => {
      const a = 2 * Math.PI * j / N;
      return add(add(add(f.c, mul(f.ex, R * Math.cos(a))), mul(f.ey, R * Math.sin(a))), mul(f.n, zj));
    });
  }

  // 拘束緩和用：環の面内座標は現状のまま、面外変位だけを (θ, φ) の形にそろえる。
  // Q を省略すると、現在の変位をその形に射影した振幅を使う（θ・φ だけを拘束）
  function ringRepucker(P, theta, phi, Q) {
    const N = 6;
    const f = ringFrame(P);
    const t = theta / DEG, ph = phi / DEG;
    const shape = [];
    for (let j = 0; j < N; j++) shape.push(Math.sqrt(2 / N) * Math.sin(t) * Math.cos(ph + 4 * Math.PI * j / N) + Math.sqrt(1 / N) * Math.cos(t) * (j % 2 ? -1 : 1));
    const z = f.Q.map((q) => dot(q, f.n));
    const amp = Q ?? Math.max(0.3, z.reduce((s, zj, j) => s + zj * shape[j], 0));
    return f.Q.map((q, j) => {
      const inPlane = sub(q, mul(f.n, dot(q, f.n)));
      return add(add(f.c, inPlane), mul(f.n, amp * shape[j]));
    });
  }

  // 環原子 i の局所座標系（前後の環原子から作る右手系）
  function localFrame(prev, p, next) {
    const a = sub(prev, p), b = sub(next, p);
    const e1 = unit(add(unit(a), unit(b)));
    const e2 = unit(cross(a, b));
    return [e1, e2, cross(e1, e2)];
  }

  // 環原子を targets に動かし、置換基は各環原子の局所座標系ごと剛体移動する（立体配置は保存）
  function moveRing(X, ring, subs, targets) {
    const N = ring.length;
    const old = ring.map((i) => X[i]);
    for (let k = 0; k < N; k++) {
      const Fo = localFrame(old[(k + N - 1) % N], old[k], old[(k + 1) % N]);
      const Fn = localFrame(targets[(k + N - 1) % N], targets[k], targets[(k + 1) % N]);
      for (const s of subs[k]) {
        const v = sub(X[s], old[k]);
        const l = [dot(v, Fo[0]), dot(v, Fo[1]), dot(v, Fo[2])];
        X[s] = add(targets[k], add(add(mul(Fn[0], l[0]), mul(Fn[1], l[1])), mul(Fn[2], l[2])));
      }
    }
    ring.forEach((i, k) => { X[i] = targets[k]; });
  }

  /* ---------- 計測 ---------- */
  function angle(a, b, c) {
    const u = sub(a, b), w = sub(c, b);
    return Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (norm(u) * norm(w))))) * DEG;
  }
  function dihedral(a, b, c, d) {
    const b1 = sub(b, a), b2 = sub(c, b), b3 = sub(d, c);
    const n1 = cross(b1, b2), n2 = cross(b2, b3);
    const m1 = cross(n1, unit(b2));
    return Math.atan2(dot(m1, n2), dot(n1, n2)) * DEG;
  }

  return {
    sub, add, mul, dot, cross, norm, unit, dist, centroid, DEG,
    COLORS, VDW, ELEM_JA, color, vdw, isLight,
    fitPlane, findSymmetry, testMirror, testInversion, cremerPople, ringTargets, ringRepucker, moveRing, angle, dihedral
  };
})();
