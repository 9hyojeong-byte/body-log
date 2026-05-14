/* ================================================================
   Body Log – Service Worker v4
   경로 자동 감지: GitHub Pages(/body-log/) 및 기타 환경 모두 대응
================================================================ */

const CACHE_VER = 'body-log-v4';

// SW 스크립트 위치에서 base 경로 자동 계산
// GitHub Pages: /body-log/sw.js  → base = /body-log
// 루트 배포:    /sw.js            → base = (empty string)
const BASE = self.location.pathname.replace(/\/sw\.js$/, '');

const PRECACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/manifest.json',
  BASE + '/icon-192.png',
  BASE + '/icon-512.png',
];

/* ── Install ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VER)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VER).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // http(s) 요청만 처리
  if (!url.protocol.startsWith('http')) return;

  // 외부 도메인(폰트, Sheets API 등) — 네트워크 직접 통과
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 408 }))
    );
    return;
  }

  // HTML — Network-first (항상 최신 코드 유지)
  const isHTML = (event.request.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VER).then(c => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(BASE + '/index.html'))
    );
    return;
  }

  // 정적 자산 — Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VER).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
