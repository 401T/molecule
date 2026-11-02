'use strict';
/* サービスワーカー：ホーム画面から開いたときに、電波がなくても画面と一度見た分子を出せるようにする。
   ・アプリ本体（HTML・CSS・JS）：ネットワーク優先。公開した新しい版をすぐ使い、つながらないときだけ保存分を使う
     （保存分を先に返すと、新しい HTML と古い CSS が食い違って表示が崩れるため）
   ・CDN のライブラリ：版つきの URL なので保存分を優先
   ・PubChem / Wikidata の結果：ネットワーク優先、つながらないときは保存分 */
const VERSION = 'molecule-202611021244-43e6874';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'chem.js', 'builder.js', 'glass.js',
  'icon.svg', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js',
  'https://cdn.jsdelivr.net/npm/openchemlib@8.21.0/dist/openchemlib-full.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const networkFirst = (req, ignoreSearch) => fetch(req, { cache: 'no-cache' }).then((res) => {
  if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
  return res;
}).catch(() => caches.match(req, { ignoreSearch }).then((hit) => hit || Response.error()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(networkFirst(req, true));
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
  } else if (/pubchem\.ncbi\.nlm\.nih\.gov|wikidata\.org/.test(url.hostname)) {
    e.respondWith(networkFirst(req, false));
  }
});
