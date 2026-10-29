/* INSPECTION HUB service worker: keeps the app screens on the phone, and shows
   phone notifications sent by the engine through Firebase Cloud Messaging. */
self.window = self; // config.js stores its settings on "window", which a service worker does not have
importScripts('config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

var CACHE = 'inspection-hub-v25';
var SHELL = ['./', './index.html', './app.css?v=24', './app.js?v=24', './config.js?v=24', './manifest.webmanifest',
  './icons/seal-320.webp', './icons/seal-96.webp', './icons/icon-192.png', './icons/favicon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () { }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // engine calls go straight to Google
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('./index.html'); }); }));
});

/* ---- notifications ---- */
var CFG = self.HUB_CONFIG || {};
if (CFG.FIREBASE) {
  try {
    firebase.initializeApp(CFG.FIREBASE);
    firebase.messaging().onBackgroundMessage(function (payload) {
      var d = (payload && payload.data) || {};
      return self.registration.showNotification(d.title || 'Inspection Hub', {
        body: d.body || '',
        icon: 'icons/icon-192.png',
        badge: 'icons/badge-96.png',
        tag: (d.view || 'hub') + '-' + Date.now(),
        vibrate: [200, 100, 200],
        data: { view: d.view || '' }
      });
    });
  } catch (err) { /* not configured yet */ }
}
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var view = (e.notification.data && e.notification.data.view) || '';
  var target = new URL('./' + (view ? '#' + view : ''), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0) {
        list[i].postMessage({ view: view });
        return list[i].focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});
