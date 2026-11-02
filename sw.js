'use strict';
/* サービスワーカー：ホーム画面から開いたときに素早く起動し、オフラインでも画面と一度見た分子を出せるようにする。
   ・アプリ本体と CDN のライブラリ：キャッシュを先に返し、裏で更新（stale-while-revalidate）
   ・PubChem / Wikidata の結果：ネットワーク優先、つながらないときはキャッシュ */
const VERSION = 'molecule-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'chem.js', 'builder.js', 'glass.js',
  'icon.svg', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/3dmol@2.4.2/build/3Dmol-min.js',
  'https://cdn.jsdelivr.net/npm/openchemlib@8.21.0/dist/openchemlib-full.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const data = /pubchem\.ncbi\.nlm\.nih\.gov|wikidata\.org/.test(url.hostname);
  const shell = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net';
  if (data) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || Response.error())));
  } else if (shell) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
      const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
