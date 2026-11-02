// ライブラリ（サンプル）の分子のデータをまとめて data/samples.js に保存する。
// アプリはこのファイルを同梱して端末に保存するので、電波がなくても表示できる。
//   node scripts/fetch-samples.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const WD = 'https://www.wikidata.org/w/api.php';
const PROPS = 'Title,IUPACName,MolecularFormula,MolecularWeight,ExactMass,SMILES,InChIKey,Charge,XLogP';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// app.js の SAMPLES から [和名, CID] を取り出す
const app = readFileSync('app.js', 'utf8');
const block = app.slice(app.indexOf('const SAMPLES = ['), app.indexOf('];', app.indexOf('const SAMPLES = [')));
const samples = [...block.matchAll(/\['([^']+)', (\d+)\]/g)].map((m) => ({ ja: m[1], cid: +m[2] }));

async function get(url, type = 'json') {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'molecule-app (github.com/401T/molecule)' } });
    if (r.ok) return type === 'json' ? r.json() : r.text();
    if (r.status === 404) return null;
    await sleep(800 * (i + 1));
  }
  throw new Error(`failed: ${url}`);
}

const out = {};
for (const { ja, cid } of samples) {
  const props = (await get(`${PUG}/compound/cid/${cid}/property/${PROPS}/JSON`)).PropertyTable.Properties[0];
  const sdf = await get(`${PUG}/compound/cid/${cid}/record/SDF?record_type=3d`, 'text');
  let desc = null, qid = null;
  try {   // 説明文（Wikidata）は取れなければ省く
    const s = await get(`${WD}?action=query&list=search&srsearch=haswbstatement:P662=${cid}&srlimit=1&format=json`);
    qid = s?.query?.search?.[0]?.title || null;
    if (qid) {
      const e = await get(`${WD}?action=wbgetentities&ids=${qid}&props=descriptions&languages=ja&format=json`);
      desc = e?.entities?.[qid]?.descriptions?.ja?.value || null;
    }
  } catch (e) { console.warn('  wikidata skipped', cid); }
  out[cid] = { ja, desc, qid, props, sdf };
  console.log(cid, ja, sdf ? '3D' : '(no 3D)');
  await sleep(600);   // PubChem・Wikidata に負荷をかけない（PubChem は毎秒 5 回まで）
}
mkdirSync('data', { recursive: true });
writeFileSync('data/samples.js', `// 同梱したサンプル分子のデータ（scripts/fetch-samples.mjs で生成）\nwindow.SAMPLE_DATA = ${JSON.stringify(out)};\n`);
console.log(`saved ${Object.keys(out).length} molecules`);
