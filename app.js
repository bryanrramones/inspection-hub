/* INSPECTION HUB - phone app for the Inspection Team, Provincial Government of Quirino.
   One app: inspectors see their schedule and status; team leaders also see requests,
   suggested inspectors and the team board. All data lives in the INSPECTION TEAM sheet. */
(function () {
  'use strict';
  var CFG = window.HUB_CONFIG || {};
  var TZ = 'Asia/Manila';
  var KEY = { token: 'hub.token', me: 'hub.me', email: 'hub.email', push: 'hub.pushAt', installed: 'hub.installed' };
  var state = { token: null, me: null, tab: null, team: null, teamFilter: 'all' };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- storage (never trusted to exist) ---------- */
  function store(op, k, v) {
    try {
      if (op === 'get') return localStorage.getItem(k);
      if (op === 'set') localStorage.setItem(k, v);
      if (op === 'del') localStorage.removeItem(k);
    } catch (e) { /* private mode */ }
    return null;
  }

  /* ---------- engine calls ---------- */
  function call(action, payload) {
    payload = payload || {};
    payload.action = action;
    if (state.token && !payload.token) payload.token = state.token;
    if (!CFG.ENGINE_URL) return Promise.resolve({ ok: false, error: 'The app is not connected to the engine yet.' });
    return fetch(CFG.ENGINE_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'No connection. Please check your internet and try again.', offline: true }; })
      .then(function (r) {
        if (r && r.signedOut) { signOut(true); toast('Please sign in again.', true); }
        return r;
      });
  }
  function busy(on) { $('busy').classList.toggle('hidden', !on); }
  var toastTimer;
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, err ? 5200 : 3200);
  }

  /* ---------- formatting ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function parts(ms) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p;
  }
  function todayYmd(offsetDays) {
    var d = new Date(Date.now() + (offsetDays || 0) * 864e5);
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  }
  function ymdOf(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ms)); }
  function niceYmd(s) {
    if (!s) return '';
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function rangeText(a, b) { return !b || a === b ? niceYmd(a) : niceYmd(a) + ' to ' + niceYmd(b); }
  function t12(hm) { if (!hm) return ''; var t = hm.split(':'), h = +t[0]; return ((h + 11) % 12 + 1) + ':' + t[1] + (h < 12 ? ' AM' : ' PM'); }
  function initials(n) { return String(n || '?').replace(/^#/, '').split(/\s+/).filter(function (w) { return /^[A-Za-z]/.test(w) && w.length > 2; }).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?'; }
  function title(n) { return String(n || '').replace(/^#/, '').toLowerCase().replace(/(^|[\s.-])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function firstName(n) { var w = String(n || '').replace(/^#/, '').split(/\s+/)[0]; return title(w); }
  function dateBox(ms) {
    if (!ms) return '<div class="datebox"><div class="d">?</div></div>';
    var p = parts(ms), isToday = ymdOf(ms) === todayYmd();
    return '<div class="datebox' + (isToday ? ' today' : '') + '"><div class="m">' + p.month + '</div><div class="d">' + p.day + '</div><div class="w">' + (isToday ? 'Today' : p.weekday) + '</div></div>';
  }
  function statusChip(s) {
    if (!s || s === 'Available') return '<span class="chip green">Available</span>';
    if (/Leave/.test(s)) return '<span class="chip red">' + esc(s) + '</span>';
    if (/Official/.test(s)) return '<span class="chip blue">' + esc(s) + '</span>';
    return '<span class="chip amber">' + esc(s) + '</span>';
  }
  function entryText(e) {
    return e.status === 'Unavailable (hours)'
      ? rangeText(e.fromDate, e.toDate) + ', ' + t12(e.fromTime) + ' to ' + t12(e.toTime)
      : rangeText(e.fromDate, e.toDate);
  }

  /* ---------- bottom sheet & confirm ---------- */
  function openSheet(html) {
    var s = $('sheet');
    s.onclick = null;
    s.innerHTML = '<div class="grab"></div><button class="close" data-close aria-label="Close">×</button>' + html;
    s.classList.remove('hidden'); $('scrim').classList.remove('hidden');
    s.scrollTop = 0;
    return s;
  }
  function closeSheet() { $('sheet').classList.add('hidden'); $('scrim').classList.add('hidden'); $('sheet').innerHTML = ''; }
  $('scrim').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', function (e) { if (e.target.hasAttribute('data-close')) closeSheet(); });

  function confirmBox(heading, html, okLabel, cancelLabel, danger) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.innerHTML = '<div class="scrim" style="z-index:30"></div><div class="sheet" style="z-index:31"><div class="grab"></div><h3>' + esc(heading) + '</h3>' +
        '<div style="font-size:14.5px">' + html + '</div><div style="height:14px"></div>' +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-ok>' + esc(okLabel || 'Yes') + '</button>' +
        '<button class="btn link" data-no>' + esc(cancelLabel || 'Cancel') + '</button></div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click', function (e) {
        if (e.target.hasAttribute('data-ok')) { wrap.remove(); resolve(true); }
        else if (e.target.hasAttribute('data-no') || e.target.classList.contains('scrim')) { wrap.remove(); resolve(false); }
      });
    });
  }

  /* ============ SIGN IN ============ */
  function showFront() {
    $('app').classList.add('hidden'); $('front').classList.remove('hidden');
    $('stepEmail').classList.remove('hidden'); $('stepCode').classList.add('hidden');
    $('email').value = store('get', KEY.email) || '';
    homeBar();
  }
  $('btnCode').addEventListener('click', function () {
    var email = $('email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('Please type your email address.', true); return; }
    busy(true);
    call('requestCode', { email: email }).then(function (r) {
      busy(false);
      if (!r.ok) { toast(r.error, true); return; }
      store('set', KEY.email, email);
      $('codeHint').textContent = 'We sent a 6-digit code to ' + email + '. It works for 10 minutes.';
      $('stepEmail').classList.add('hidden'); $('stepCode').classList.remove('hidden');
      $('code').value = ''; $('code').focus();
    });
  });
  $('code').addEventListener('input', function () { if (this.value.replace(/\D/g, '').length === 6) $('btnVerify').click(); });
  $('btnVerify').addEventListener('click', function () {
    var code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) { toast('The code has 6 digits.', true); return; }
    busy(true);
    call('verifyCode', { email: $('email').value.trim().toLowerCase(), code: code }).then(function (r) {
      busy(false);
      if (!r.ok) { toast(r.error, true); return; }
      state.token = r.token; state.me = r.me;
      store('set', KEY.token, r.token); store('set', KEY.me, JSON.stringify(r.me));
      startApp();
    });
  });
  $('btnBack').addEventListener('click', function () { $('stepCode').classList.add('hidden'); $('stepEmail').classList.remove('hidden'); });

  function signOut(silent) {
    if (!silent && state.token) call('logout', {});
    state.token = null; state.me = null;
    store('del', KEY.token); store('del', KEY.me); store('del', KEY.push);
    closeSheet(); showFront();
  }

  /* ============ APP SHELL ============ */
  var TABS = {
    requests: { label: 'Requests', ic: '📥', render: renderRequests },
    team: { label: 'Team', ic: '👥', render: renderTeam },
    schedule: { label: 'Schedule', ic: '📅', render: renderSchedule },
    status: { label: 'My Status', ic: '🟢', render: renderStatus }
  };
  function myTabs() {
    var t = [];
    if (state.me.isLeader) t.push('requests', 'team');
    if (state.me.isInspector) t.push('schedule', 'status');
    return t.length ? t : ['status'];
  }
  function startApp() {
    $('front').classList.add('hidden'); $('app').classList.remove('hidden');
    $('hello').textContent = 'Hi, ' + firstName(state.me.name) + (state.me.isLeader ? ' · Team Leader' : ' · Inspector');
    var tabs = myTabs();
    $('tabs').innerHTML = tabs.map(function (k) {
      return '<button class="tab" data-tab="' + k + '"><span class="ic">' + TABS[k].ic + '</span>' + TABS[k].label + '<span class="dot hidden" id="dot-' + k + '"></span></button>';
    }).join('');
    var want = (location.hash || '').replace('#', '');
    go(tabs.indexOf(want) > -1 ? want : tabs[0]);
    initPush();
    homeBar();
    if (isInstalled() && !store('get', KEY.installed)) { store('set', KEY.installed, '1'); toast('Inspection Hub is installed on this phone ✓'); }
    // refresh who I am in the background (roles may have changed)
    call('me', {}).then(function (r) {
      if (r.ok) { state.me = r.me; store('set', KEY.me, JSON.stringify(r.me)); }
    });
  }
  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (b) go(b.getAttribute('data-tab'));
  });
  function go(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    try { history.replaceState(null, '', '#' + tab); } catch (e) { }
    $('view').innerHTML = '<div class="empty">Loading…</div>';
    window.scrollTo(0, 0);
    TABS[tab].render();
  }
  function refresh() { if (state.tab) TABS[state.tab].render(); }
  function failView(r) {
    $('view').innerHTML = '<div class="empty">' + esc(r.error || 'Something went wrong.') + '<br><br><button class="btn ghost" id="retry" style="max-width:200px;margin:0 auto">Try again</button></div>';
    $('retry').onclick = refresh;
  }

  /* ---------- menu ---------- */
  $('btnMenu').addEventListener('click', function () {
    var pushOn = ('Notification' in window) && Notification.permission === 'granted';
    openSheet('<h3>' + esc(title(state.me.name)) + '</h3><p class="hint" style="margin-top:-8px">' + esc(state.me.email) + '</p>' +
      '<div class="menu-list card" style="padding:0 14px">' +
      '<button data-m="refresh">🔄 Refresh</button>' +
      '<button data-m="push">🔔 ' + (pushOn ? 'Notifications are on - test again' : 'Turn on notifications') + '</button>' +
      '<button data-m="install">📲 Add to home screen</button>' +
      '<button data-m="out">🚪 Sign out</button></div>');
    $('sheet').onclick = function (e) {
      var m = e.target.getAttribute('data-m');
      if (e.target.hasAttribute('data-close')) return closeSheet();
      if (m === 'refresh') { closeSheet(); refresh(); }
      if (m === 'push') { closeSheet(); enablePush(true); }
      if (m === 'install') installHelp();
      if (m === 'out') confirmBox('Sign out?', 'You will need a new code from your email to sign in again.', 'Sign out', 'Stay signed in', true).then(function (y) { if (y) signOut(); });
    };
  });
  /* ---------- installing on the phone, with clear confirmation ---------- */
  var deferredInstall = null, installTimer = null;
  function isInstalled() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; hideInstallBar(); showInstallBar(); });
  window.addEventListener('appinstalled', function () {
    clearTimeout(installTimer); deferredInstall = null; hideInstallBar();
    store('set', KEY.installed, '1');
    closeSheet();
    toast('Inspection Hub is installed. You will find it on your home screen.');
    if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification('Inspection Hub is installed', { body: 'Open it from your home screen.', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png' });
      }).catch(function () { });
    }
  });
  function showInstallBar() {
    if (isInstalled() || document.getElementById('installBar')) return;
    var b = document.createElement('div');
    b.id = 'installBar';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:15;max-width:520px;margin:0 auto;background:#fff;border:2px solid #f57c00;border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 20px rgba(0,0,0,.18)';
    b.innerHTML = '<img src="icons/icon-192.png" alt="" style="width:36px;height:36px;border-radius:50%"><div style="flex:1;font-size:13.5px"><b>Install Inspection Hub</b><br>One tap. Opens like an app.</div>' +
      '<button class="btn primary" style="width:auto;padding:9px 14px;font-size:13.5px" id="installGo">Install</button><button style="background:none;border:0;font-size:22px;color:#5b6770" id="installX" aria-label="Not now">×</button>';
    document.body.appendChild(b);
    document.getElementById('installGo').onclick = startInstall;
    document.getElementById('installX').onclick = hideInstallBar;
  }
  function hideInstallBar() { var b = document.getElementById('installBar'); if (b) b.remove(); }
  function startInstall() {
    if (!deferredInstall) return installHelp();
    var p = deferredInstall; deferredInstall = null; hideInstallBar(); closeSheet();
    p.prompt();
    p.userChoice.then(function (c) {
      if (!c || c.outcome !== 'accepted') { toast('Not installed. You can install it anytime from the ⋮ menu.'); return; }
      toast('Installing… a message will appear here when it is done.');
      clearTimeout(installTimer);
      installTimer = setTimeout(installStuck, 30000);
    });
  }
  function installStuck() {
    if (isInstalled() || store('get', KEY.installed)) return;
    openSheet('<h3>Still installing?</h3>' +
      '<div class="note amber"><b>No confirmation yet.</b>Check the last page of your home screen and your app drawer for Inspection Hub.</div>' +
      '<div class="note blue"><b>Xiaomi, Redmi, POCO, Oppo, Realme, Vivo</b>Settings → Apps → Chrome → Other permissions → allow <span style="font-weight:700">Home screen shortcuts</span>. Close Chrome, open this page again, then install.</div>' +
      '<div class="note green"><b>Quick alternative</b>Chrome ⋮ → Add to Home screen → <span style="font-weight:700">Create shortcut</span>.</div>');
  }
  /* ---------- instant home-screen shortcut (no Google Play wait) ---------- */
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
  function homeBar() {
    if (isInstalled() || store('get', KEY.installed) || store('get', 'hub.homeBarOff') || !(isAndroid() || isIOS())) return;
    if (document.getElementById('installBar')) return;
    var b = document.createElement('div');
    b.id = 'installBar';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:15;max-width:520px;margin:0 auto;background:#fff;border:2px solid #f57c00;border-radius:14px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 6px 20px rgba(0,0,0,.18)';
    b.innerHTML = '<img src="icons/icon-192.png" alt="" style="width:36px;height:36px;border-radius:50%"><div style="flex:1;font-size:13.5px"><b>Add to your home screen</b><br>Takes 1 second.</div>' +
      '<button class="btn primary" style="width:auto;padding:9px 14px;font-size:13.5px" id="installGo">How?</button><button style="background:none;border:0;font-size:22px;color:#5b6770" id="installX" aria-label="Not now">\u00d7</button>';
    document.body.appendChild(b);
    document.getElementById('installGo').onclick = homeGuide;
    document.getElementById('installX').onclick = function () { store('set', 'hub.homeBarOff', String(Date.now())); hideInstallBar(); };
  }
  function homeGuide() {
    var steps = isIOS()
      ? ['Tap the <b>Share</b> button (square with an arrow) at the bottom of Safari.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. The Inspection Hub icon appears right away.']
      : ['Tap <b>\u22ee</b> at the <b>top-right</b> of Chrome.', 'Tap <b>Add to Home screen</b>.', 'Tap <b>Add</b>. The Inspection Hub icon appears right away.'];
    openSheet('<h3>Add to your home screen</h3>' + steps.map(function (s, i) {
      return '<div class="item" style="display:flex;gap:12px;align-items:center;margin-bottom:8px"><div class="avatar">' + (i + 1) + '</div><div>' + s + '</div></div>';
    }).join('') +
      (isIOS() ? '' : '<div class="note blue"><b>Xiaomi, Redmi, POCO, Oppo, Vivo</b>If no icon appears: Settings \u2192 Apps \u2192 Chrome \u2192 Other permissions \u2192 allow <span style="font-weight:700">Home screen shortcuts</span>, then try again.</div>') +
      '<button class="btn primary" id="homeDone">Done, it is on my home screen</button><button class="btn link" data-close>Later</button>');
    document.getElementById('homeDone').onclick = function () {
      store('set', KEY.installed, '1'); hideInstallBar(); closeSheet();
      toast('Great! From now on, open Inspection Hub from your home screen.');
    };
  }
  function installHelp() {
    if (isInstalled()) { openSheet('<h3>Already installed ✓</h3><div class="note green"><b>Inspection Hub is installed on this phone.</b>You are using the installed app right now.</div>'); return; }
    if (deferredInstall) return startInstall();
    homeGuide();
  }

  /* ============ INSPECTOR: SCHEDULE ============ */
  function renderSchedule() {
    call('mySchedule', {}).then(function (r) {
      if (state.tab !== 'schedule') return;
      if (!r.ok) return failView(r);
      var html = pushBanner();
      html += '<h2 class="sec">Upcoming inspections</h2>';
      html += r.upcoming.length ? '<div class="list">' + r.upcoming.map(jobCard).join('') + '</div>'
        : '<div class="empty">No inspections assigned to you yet.<br>You will get a notification when you are assigned.</div>';
      if (r.recent.length) {
        html += '<h2 class="sec">Last 14 days</h2><div class="list">' + r.recent.map(jobCard).join('') + '</div>';
      }
      $('view').innerHTML = html;
      wirePushBanner();
    });
  }
  function jobCard(j) {
    var f = j.findings || '';
    var fchip = !f ? '' : (f === 'Approved' ? '<span class="chip green">Findings filed</span>' :
      (/NO REPORT/.test(f) ? '<span class="chip amber">Report not uploaded</span>' :
        (f === 'REJECTED' ? '<span class="chip red">Rejected</span>' : '<span class="chip">' + esc(f) + '</span>')));
    var past = j.start && j.start < Date.now();
    return '<div class="item"><div class="item-top">' + dateBox(j.start) +
      '<div class="item-main"><div class="item-title">' + esc(j.office) + '</div>' +
      '<div class="item-sub">🕘 ' + esc(j.timeText || 'Time not stated') + '</div>' +
      '<div class="item-sub">📍 ' + esc(j.place || 'Venue not stated') + '</div>' +
      '<div class="item-sub">📦 ' + esc(j.goods || '') + '</div>' +
      (j.rep ? '<div class="item-sub">👤 ' + esc(j.rep) + (j.repContact ? ' · <a class="inline" href="tel:' + esc(String(j.repContact).replace(/[^\d+]/g, '')) + '">' + esc(j.repContact) + '</a>' : '') + '</div>' : '') +
      '<div class="meta"><span class="chip gold">' + esc(j.ref) + '</span>' + (j.amountText ? '<span class="chip">' + esc(j.amountText) + '</span>' : '') + fchip + '</div>' +
      '</div></div><div class="actions">' +
      (past ? '' : '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(j.calendarLink) + '">Add to Calendar</a>') +
      '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(j.findingsLink) + '">File findings</a></div></div>';
  }

  /* ============ INSPECTOR: MY STATUS ============ */
  function renderStatus() {
    call('myStatus', {}).then(function (r) {
      if (state.tab !== 'status') return;
      if (!r.ok) return failView(r);
      $('view').innerHTML = statusPage(r.entries, null);
      wireStatusPage(null);
      wirePushBanner();
    });
  }
  function currentOf(entries) {
    var today = todayYmd();
    return entries.filter(function (e) { return e.fromDate <= today && e.toDate >= today; })[0] || null;
  }
  function statusPage(entries, person) {
    var cur = currentOf(entries);
    var who = person ? title(person.name) : 'You';
    var hero = !cur
      ? '<div class="status-hero"><div class="icon">✅</div><div><div class="big">Available today</div><div class="small">' + (person ? who + ' can be assigned.' : 'Team leaders can assign you to inspections.') + '</div></div></div>'
      : '<div class="status-hero ' + (/Leave/.test(cur.status) ? 'off' : /Official/.test(cur.status) ? 'ob' : 'hrs') + '"><div class="icon">' + (/Leave/.test(cur.status) ? '🏖️' : /Official/.test(cur.status) ? '🧳' : '⏰') + '</div><div><div class="big">' + esc(cur.status) + '</div><div class="small">' + esc(entryText(cur)) + (cur.note ? ' · ' + esc(cur.note) : '') + '</div></div></div>';
    var html = (person ? '' : pushBanner()) + hero;
    html += '<h2 class="sec">' + (person ? 'Set a status for ' + esc(firstName(person.name)) : 'Not available? Tell the team') + '</h2>' +
      '<div class="choice">' +
      '<button data-type="hours"><span class="ic">⏰</span><div><b>Unavailable for some hours</b><span>e.g. 1:00 PM to 3:00 PM on a given day</span></div></button>' +
      '<button data-type="ob"><span class="ic">🧳</span><div><b>Official Business</b><span>Out of the office on official business</span></div></button>' +
      '<button data-type="leave"><span class="ic">🏖️</span><div><b>On Leave</b><span>On leave for one or more days</span></div></button>' +
      '</div>';
    html += '<h2 class="sec">' + (person ? 'Upcoming' : 'Your upcoming status') + '</h2>';
    html += entries.length ? '<div class="list">' + entries.map(function (e) {
      return '<div class="item"><div class="item-top"><div class="item-main">' + statusChip(e.status) +
        '<div class="item-title" style="margin-top:6px">' + esc(entryText(e)) + '</div>' +
        (e.note ? '<div class="item-sub">' + esc(e.note) + '</div>' : '') +
        '</div><button class="btn link" style="width:auto;margin:0" data-remove="' + esc(e.id) + '">Cancel</button></div></div>';
    }).join('') + '</div>' : '<div class="empty">Nothing scheduled - ' + (person ? 'available' : 'you are available') + ' every working day.</div>';
    return html;
  }
  function wireStatusPage(person, root) {
    root = root || $('view');
    Array.prototype.forEach.call(root.querySelectorAll('[data-type]'), function (b) {
      b.onclick = function () { statusForm(b.getAttribute('data-type'), person); };
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-remove]'), function (b) {
      b.onclick = function () {
        confirmBox('Cancel this status?', 'The team will see ' + (person ? esc(firstName(person.name)) : 'you') + ' as available again for those dates.', 'Yes, cancel it', 'Keep it', true).then(function (y) {
          if (!y) return;
          busy(true);
          call('removeStatus', { id: b.getAttribute('data-remove') }).then(function (r) {
            busy(false);
            if (!r.ok) return toast(r.error, true);
            toast('Status cancelled.');
            if (person) { closeSheet(); state.team = null; renderTeam(); } else refresh();
          });
        });
      };
    });
  }
  function statusForm(type, person) {
    var t = todayYmd();
    var names = { hours: 'Unavailable for some hours', ob: 'Official Business', leave: 'On Leave' };
    var html = '<h3>' + names[type] + (person ? ' - ' + esc(firstName(person.name)) : '') + '</h3>';
    if (type === 'hours') {
      html += '<div class="field"><label>Date</label><input type="date" id="fFrom" value="' + t + '" min="' + t + '"></div>' +
        '<div class="row2 field"><div><label>From</label><input type="time" id="fT1" value="13:00"></div><div><label>To</label><input type="time" id="fT2" value="15:00"></div></div>' +
        '<div class="field"><label>Same hours until (optional)</label><input type="date" id="fTo" min="' + t + '"></div>';
    } else {
      html += '<div class="row2 field"><div><label>From</label><input type="date" id="fFrom" value="' + t + '" min="' + t + '"></div>' +
        '<div><label>To</label><input type="date" id="fTo" value="' + t + '" min="' + t + '"></div></div>';
    }
    html += '<div class="field"><label>Note (optional)</label><input type="text" id="fNote" maxlength="120" placeholder="' + (type === 'ob' ? 'e.g. Seminar in Santiago City' : type === 'leave' ? 'e.g. Vacation leave' : 'e.g. Meeting at the Capitol') + '"></div>' +
      '<button class="btn primary" id="fSave">Save</button>';
    openSheet(html);
    $('fFrom').addEventListener('change', function () { var to = $('fTo'); if (to && type !== 'hours' && (!to.value || to.value < this.value)) to.value = this.value; });
    $('fSave').onclick = function () {
      var p = { type: type, fromDate: $('fFrom').value, toDate: ($('fTo') && $('fTo').value) || $('fFrom').value, note: $('fNote').value.trim() };
      if (type === 'hours') { p.fromTime = $('fT1').value; p.toTime = $('fT2').value; }
      if (person) p.forEmail = person.email;
      busy(true);
      call('setStatus', p).then(function (r) {
        busy(false);
        if (!r.ok) return toast(r.error, true);
        closeSheet(); toast('Saved. The team leaders have been notified.');
        if (person) { state.team = null; renderTeam(); } else refresh();
      });
    };
  }

  /* ============ LEADER: REQUESTS ============ */
  function renderRequests() {
    call('requests', {}).then(function (r) {
      if (state.tab !== 'requests') return;
      if (!r.ok) return failView(r);
      var dot = $('dot-requests');
      if (dot) { dot.textContent = r.pending.length; dot.classList.toggle('hidden', !r.pending.length); }
      var html = pushBanner();
      html += '<h2 class="sec">Waiting for a decision (' + r.pending.length + ')</h2>';
      html += r.pending.length ? '<div class="list">' + r.pending.map(reqCard).join('') + '</div>' : '<div class="empty">All caught up. New requests will appear here, and you will get a notification.</div>';
      if (r.decided.length) {
        html += '<h2 class="sec">Recently decided</h2><div class="list">' + r.decided.slice(0, 12).map(function (d) {
          return '<div class="item"><div class="item-top">' + dateBox(d.start) + '<div class="item-main"><div class="item-title">' + esc(d.office) + '</div>' +
            '<div class="item-sub">' + (d.action === 'Approved' ? '👤 ' + esc(title(d.inspectorName)) : '✖ ' + esc(d.deniedWhy || 'Denied')) + '</div>' +
            '<div class="meta">' + (d.action === 'Approved' ? '<span class="chip green">Approved</span>' : '<span class="chip red">Denied</span>') + '<span class="chip gold">' + esc(d.ref) + '</span>' + (d.assignor ? '<span class="chip">by ' + esc(d.assignor) + '</span>' : '') + '</div></div></div></div>';
        }).join('') + '</div>';
      }
      $('view').innerHTML = html;
      wirePushBanner();
      Array.prototype.forEach.call(document.querySelectorAll('[data-row]'), function (b) {
        b.onclick = function () { openRequest(+b.getAttribute('data-row')); };
      });
    });
  }
  function reqCard(q) {
    var chips = '<span class="chip green">' + esc(q.goodsTeam || 'Goods type not stated') + '</span>';
    if (q.late) chips += '<span class="chip red">Schedule already passed</span>';
    if (q.warnings && q.warnings.length) chips += '<span class="chip amber">Outside working hours/days</span>';
    if (q.amountText) chips += '<span class="chip">' + esc(q.amountText) + '</span>';
    return '<button class="item" data-row="' + q.row + '"><div class="item-top">' + dateBox(q.start) +
      '<div class="item-main"><div class="item-title">' + esc(q.office) + '</div>' +
      '<div class="item-sub">🕘 ' + esc(q.timeText || '-') + ' · 📍 ' + esc(q.place || '-') + '</div>' +
      '<div class="item-sub">' + esc(q.reqType || '') + (q.po ? ' · PO ' + esc(q.po) : '') + '</div>' +
      '<div class="meta">' + chips + '</div></div></div></button>';
  }

  function openRequest(row) {
    openSheet('<div class="empty">Finding available inspectors…</div>');
    call('suggest', { row: row }).then(function (r) {
      if (!r.ok) { closeSheet(); return toast(r.error, true); }
      var q = r.request, sel = null, showOthers = !r.match.length;
      function personRow(p, i, group) {
        return '<button class="item pick" data-pick="' + group + ':' + i + '"><div class="person"><div class="radio"></div><div class="avatar">' + initials(p.name) + '</div>' +
          '<div class="item-main"><div class="item-title">' + esc(title(p.name)) + '</div>' +
          '<div class="load">' + esc(p.office) + ' · Team ' + esc(p.teams.join(', ')) + ' · ' + p.load + ' inspection' + (p.load === 1 ? '' : 's') + ' in 30 days</div></div></div></button>';
      }
      function draw() {
        var h = '<h3>' + esc(q.office) + '</h3>' +
          '<dl class="kv"><dt>Schedule</dt><dd>' + esc(q.dateText) + ' · ' + esc(q.timeText) + '</dd>' +
          '<dt>Venue</dt><dd>' + esc(q.place) + '</dd>' +
          '<dt>Goods</dt><dd>' + esc(q.goods) + '</dd>' +
          '<dt>Request type</dt><dd>' + esc(q.reqType) + '</dd>' +
          (q.po ? '<dt>PO / Contract</dt><dd>' + esc(q.po) + '</dd>' : '') +
          (q.amountText ? '<dt>Amount</dt><dd>' + esc(q.amountText) + '</dd>' : '') +
          '<dt>Requested by</dt><dd>' + esc(q.personnel) + (q.position ? ' (' + esc(q.position) + ')' : '') + '</dd>' +
          '<dt>Contact</dt><dd>' + (q.contact ? '<a class="inline" href="tel:' + esc(String(q.contact).replace(/[^\d+]/g, '')) + '">' + esc(q.contact) + '</a>' : '-') + '</dd>' +
          '<dt>Email</dt><dd>' + esc(q.reqEmail) + '</dd>' +
          (q.rep ? '<dt>On-site rep.</dt><dd>' + esc(q.rep) + (q.repContact ? ' · ' + esc(q.repContact) : '') + '</dd>' : '') +
          '<dt>Sheet row</dt><dd>' + q.row + '</dd></dl>';
        if (q.warnings && q.warnings.length) h += '<div class="note amber"><b>Outside normal working hours/days</b>' + q.warnings.map(esc).join('<br>') + '<br>An approved request letter from the Local Chief Executive is needed.</div>';
        if (q.start && q.start < Date.now()) h += '<div class="note red"><b>The requested schedule has already passed.</b>Check with the requesting office before approving.</div>';
        h += '<h2 class="sec">Team ' + esc(q.goodsCode || '?') + ' · ' + esc(r.team) + '</h2>';
        if (r.match.length) h += '<div class="list">' + r.match.map(function (p, i) { return personRow(p, i, 'm'); }).join('') + '</div>';
        else h += '<div class="note amber"><b>No one from this team is available.</b>Showing available inspectors from the other teams instead.</div>';
        if (r.others.length) {
          if (showOthers) h += '<h2 class="sec">Other teams (available)</h2><div class="list">' + r.others.map(function (p, i) { return personRow(p, i, 'o'); }).join('') + '</div>';
          else h += '<button class="btn link" id="moreBtn">Show available inspectors from other teams (' + r.others.length + ')</button>';
        }
        if (!r.match.length && !r.others.length) h += '<div class="note red"><b>No available inspector at this schedule.</b>Everyone is on leave, on official business, unavailable or already booked.</div>';
        if (r.unavailable.length) {
          h += '<details style="margin-top:14px"><summary class="hint" style="cursor:pointer">Not available at this schedule (' + r.unavailable.length + ')</summary><div class="list" style="margin-top:8px">' +
            r.unavailable.map(function (p) { return '<div class="item"><div class="person"><div class="avatar" style="opacity:.55">' + initials(p.name) + '</div><div class="item-main"><div class="item-title">' + esc(title(p.name)) + (p.sameTeam ? ' <span class="chip green">this team</span>' : '') + '</div><div class="load">' + esc(p.reason) + '</div></div></div></div>'; }).join('') + '</div></details>';
        }
        h += '<div style="height:16px"></div><div class="row2"><button class="btn ghost" id="denyBtn" style="color:var(--red);border-color:var(--red)">Deny</button>' +
          '<button class="btn primary" id="approveBtn"' + (sel ? '' : ' disabled') + '>Approve</button></div>' +
          '<p class="hint" style="text-align:center">' + (sel ? 'Assigning ' + esc(title(sel.name)) : 'Choose an inspector to approve') + '</p>';
        var s = openSheet(h);
        Array.prototype.forEach.call(s.querySelectorAll('[data-pick]'), function (b) {
          var k = b.getAttribute('data-pick').split(':'), p = (k[0] === 'm' ? r.match : r.others)[+k[1]];
          if (sel && sel.email === p.email && sel.name === p.name) b.classList.add('sel');
          b.onclick = function () { sel = p; var y = s.scrollTop; draw(); $('sheet').scrollTop = y; };
        });
        if ($('moreBtn')) $('moreBtn').onclick = function () { showOthers = true; var y = s.scrollTop; draw(); $('sheet').scrollTop = y; };
        $('approveBtn').onclick = function () { if (sel) approve(q, sel, false); };
        $('denyBtn').onclick = function () { denyForm(q); };
      }
      draw();
    });
  }

  function approve(q, p, letter) {
    var msg = 'Approve the request of <b>' + esc(q.office) + '</b> on <b>' + esc(q.dateText) + ' ' + esc(q.timeText) + '</b> and assign <b>' + esc(title(p.name)) + '</b>?' +
      '<div class="note green" style="margin-bottom:0"><b>These will receive an email right away:</b>Requestor: ' + esc(q.reqEmail) + '<br>Inspector: ' + esc(title(p.name)) + ' (' + esc(p.email) + ')<br>Commission on Audit<br>Monitoring copy</div>' +
      '<p class="hint">' + esc(firstName(p.name)) + ' will also get a phone notification. This cannot be undone.</p>';
    (letter ? Promise.resolve(true) : confirmBox('Approve and notify?', msg, 'Approve and send', 'Go back')).then(function (y) {
      if (!y) return;
      busy(true);
      call('decide', { row: q.row, decision: 'Approved', inspector: p.name, inspectorEmail: p.email, letterConfirmed: letter }).then(function (r) {
        busy(false);
        if (r.needLetter) {
          return confirmBox('Approved request letter?', '<div class="note amber" style="margin-top:0"><b>This falls outside normal working hours or days.</b>' + r.warnings.map(esc).join('<br>') + '</div>' +
            'An inspection outside working hours or on a non-working day needs an <b>approved request letter from the Local Chief Executive</b> or his duly authorized representative.<br><br>Has an approved request letter been provided?',
            'Yes, send the notices', 'No, secure the letter first').then(function (ok) {
              if (ok) approve(q, p, true); else toast('Nothing was sent. Secure the approved request letter first.');
            });
        }
        if (!r.ok) return toast(r.error, true);
        doneSheet(r, q);
      });
    });
  }
  function denyForm(q) {
    var reasons = ['Incomplete documents', 'Insufficient notice before the schedule', 'Not within the scope of the Inspection Team'];
    openSheet('<h3>Deny - ' + esc(q.office) + '</h3><div class="field"><label>Reason for denying (sent to the requestor)</label>' +
      '<textarea id="dReason" rows="4" placeholder="State the reason"></textarea></div>' +
      '<div class="meta" style="margin:-4px 0 16px">' + reasons.map(function (x) { return '<button class="chip" data-r="' + esc(x) + '" style="border:0">' + esc(x) + '</button>'; }).join('') + '</div>' +
      '<button class="btn danger" id="dSend">Deny and notify the requestor</button><button class="btn link" id="dBack">Back</button>');
    Array.prototype.forEach.call(document.querySelectorAll('[data-r]'), function (b) { b.onclick = function () { $('dReason').value = b.getAttribute('data-r'); }; });
    $('dBack').onclick = function () { openRequest(q.row); };
    $('dSend').onclick = function () {
      var reason = $('dReason').value.trim();
      if (!reason) return toast('Please state the reason.', true);
      confirmBox('Deny this request?', 'The requestor (' + esc(q.reqEmail) + ') will be emailed that the request was denied, with your reason. This cannot be undone.', 'Deny and send', 'Go back', true).then(function (y) {
        if (!y) return;
        busy(true);
        call('decide', { row: q.row, decision: 'Denied', reason: reason }).then(function (r) {
          busy(false);
          if (!r.ok) return toast(r.error, true);
          doneSheet(r, q);
        });
      });
    };
  }
  function doneSheet(r, q) {
    var h = '<h3>' + (r.action === 'Approved' ? '✅ Approved' : '✖ Denied') + '</h3>' +
      '<dl class="kv"><dt>Office</dt><dd>' + esc(q.office) + '</dd><dt>Reference</dt><dd>' + esc(r.ref) + '</dd>' +
      (r.inspector ? '<dt>Inspector</dt><dd>' + esc(title(r.inspector)) + '</dd>' : '') + '</dl>';
    if (r.sent && r.sent.length) h += '<div class="note green"><b>Emails sent</b>' + r.sent.map(esc).join(', ') + '</div>';
    if (r.failed && r.failed.length) h += '<div class="note red"><b>Some emails did not go through</b>' + r.failed.map(esc).join('<br>') + '<br>Use "Send notification" in the spreadsheet for this row to resend.</div>';
    if (r.travelOrder && r.travelOrder.length) h += '<div class="note blue"><b>Reminder: prepare a Travel Order</b>' + r.travelOrder.map(esc).join('<br>') +
      '<br>In the spreadsheet: Inspection Team menu → Prepare Travel Order for selected row (row ' + q.row + ').</div>';
    h += '<button class="btn primary" data-close>Done</button>';
    openSheet(h);
    refresh();
  }

  /* ============ LEADER: TEAM BOARD ============ */
  function renderTeam() {
    var draw = function (d) {
      var people = d.people.filter(function (p) { return state.teamFilter === 'all' || p.teams.indexOf(state.teamFilter) > -1; });
      var c = { a: 0, l: 0, o: 0, h: 0 };
      people.forEach(function (p) { if (p.today === 'Available') c.a++; else if (/Leave/.test(p.today)) c.l++; else if (/Official/.test(p.today)) c.o++; else c.h++; });
      var html = pushBanner() + '<div class="filters"><button data-f="all" class="' + (state.teamFilter === 'all' ? 'on' : '') + '">All</button>' +
        Object.keys(d.goods).map(function (k) { return '<button data-f="' + k + '" class="' + (state.teamFilter === k ? 'on' : '') + '">Team ' + k + '</button>'; }).join('') + '</div>';
      if (state.teamFilter !== 'all') html += '<p class="hint" style="margin-top:-4px">Team ' + state.teamFilter + ': ' + esc(d.goods[state.teamFilter]) + '</p>';
      html += '<div class="counts"><div><b>' + c.a + '</b><span>Available</span></div><div><b>' + c.h + '</b><span>Some hours</span></div><div><b>' + c.o + '</b><span>Official Bus.</span></div><div><b>' + c.l + '</b><span>On Leave</span></div></div>';
      html += '<div class="list">' + people.map(function (p, i) {
        var next = p.entries.filter(function (e) { return e.fromDate > todayYmd(); })[0];
        return '<button class="item" data-p="' + d.people.indexOf(p) + '"><div class="person"><div class="avatar">' + initials(p.name) + '</div><div class="item-main">' +
          '<div class="item-title">' + esc(title(p.name)) + '</div><div class="load">' + esc(p.office) + ' · Team ' + esc(p.teams.join(', ')) + (p.hasApp ? '' : ' · no app yet') + '</div>' +
          '<div class="meta">' + statusChip(p.today) + (p.jobsToday.length ? '<span class="chip gold">' + p.jobsToday.length + ' inspection' + (p.jobsToday.length > 1 ? 's' : '') + ' today</span>' : '') +
          (next ? '<span class="chip">Next: ' + esc(next.status.replace(' (hours)', '')) + ' ' + esc(niceYmd(next.fromDate)) + '</span>' : '') + '</div></div></div></button>';
      }).join('') + '</div>';
      $('view').innerHTML = html;
      wirePushBanner();
      Array.prototype.forEach.call(document.querySelectorAll('[data-f]'), function (b) { b.onclick = function () { state.teamFilter = b.getAttribute('data-f'); draw(d); }; });
      Array.prototype.forEach.call(document.querySelectorAll('[data-p]'), function (b) { b.onclick = function () { personSheet(d.people[+b.getAttribute('data-p')]); }; });
    };
    call('team', {}).then(function (r) {
      if (state.tab !== 'team') return;
      if (!r.ok) return failView(r);
      state.team = r; draw(r);
    });
  }
  function personSheet(p) {
    var h = '<h3>' + esc(title(p.name)) + '</h3><p class="hint" style="margin-top:-8px">' + esc(p.office) + ' · Team ' + esc(p.teams.join(', ')) + ' · ' + esc(p.email || 'no email on file') + '</p>';
    if (p.jobsToday.length) h += '<div class="note blue"><b>Inspections today</b>' + p.jobsToday.map(esc).join('<br>') + '</div>';
    h += statusPage(p.entries, p);
    var s = openSheet(h);
    wireStatusPage(p, s);
  }

  /* ============ PHONE NOTIFICATIONS ============ */
  var swReg = null, messaging = null;
  function pushReady() { return !!(CFG.FIREBASE && CFG.VAPID_KEY && window.firebase && 'serviceWorker' in navigator && 'Notification' in window); }
  function pushBanner() {
    if (!pushReady() || Notification.permission === 'granted') return '';
    if (Notification.permission === 'denied') return '<div class="banner"><span class="ic">🔕</span><div>Notifications are blocked for this app. Turn them on in your phone\'s browser settings for this site so you don\'t miss assignments.</div></div>';
    return '<div class="banner"><span class="ic">🔔</span><div><b>Turn on notifications</b><br>' + (state.me.isLeader ? 'Get alerted when a new request comes in.' : 'Get alerted when you are assigned.') + '</div><button class="btn primary" id="pushBtn">Turn on</button></div>';
  }
  function wirePushBanner() { var b = $('pushBtn'); if (b) b.onclick = function () { enablePush(true); }; }
  function initPush() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      if (!pushReady()) return;
      try { if (!firebase.apps.length) firebase.initializeApp(CFG.FIREBASE); messaging = firebase.messaging(); } catch (e) { return; }
      messaging.onMessage(function (payload) {
        var d = (payload && payload.data) || {};
        toast((d.title ? d.title + ' - ' : '') + (d.body || ''));
        refresh();
      });
      var last = +(store('get', KEY.push) || 0);
      if (Notification.permission === 'granted' && Date.now() - last > 864e5) enablePush(false);
    }).catch(function () { });
  }
  function enablePush(loud) {
    if (!pushReady()) { if (loud) toast('Notifications are not set up on this phone or browser yet.', true); return; }
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    ask.then(function (perm) {
      if (perm !== 'granted') { if (loud) toast('Notifications were not allowed.', true); refresh(); return; }
      var waitReg = navigator.serviceWorker.ready; // wait until the helper is fully started (first install)
      return waitReg.then(function (reg) {
        if (!messaging) { if (!firebase.apps.length) firebase.initializeApp(CFG.FIREBASE); messaging = firebase.messaging(); }
        return messaging.getToken({ vapidKey: CFG.VAPID_KEY, serviceWorkerRegistration: reg });
      }).then(function (tok) {
        if (!tok) throw new Error('no token');
        return call('registerDevice', { fcmToken: tok, device: navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 80) });
      }).then(function (r) {
        if (r && r.ok) { store('set', KEY.push, String(Date.now())); if (loud) toast('Notifications are on for this phone.'); refresh(); }
        else if (loud) toast((r && r.error) || 'Could not turn on notifications.', true);
      });
    }).catch(function () { if (loud) toast('Could not turn on notifications on this phone.', true); });
  }

  /* ============ START ============ */
  window.addEventListener('hashchange', function () {
    var t = location.hash.replace('#', '');
    if (state.me && TABS[t] && t !== state.tab && myTabs().indexOf(t) > -1) go(t);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.me) refresh(); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.view && state.me && myTabs().indexOf(e.data.view) > -1) go(e.data.view);
    });
  }
  /* Start the background helper right away, like Gabbrielle does, so the phone can install the app even before sign-in. */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
  state.token = store('get', KEY.token);
  try { state.me = JSON.parse(store('get', KEY.me) || 'null'); } catch (e) { state.me = null; }
  if (state.token && state.me) startApp(); else showFront();
})();
