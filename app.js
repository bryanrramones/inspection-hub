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
  function closeSheet() { geoStop(); redrawPhotos = null; $('sheet').classList.add('hidden'); $('scrim').classList.add('hidden'); $('sheet').innerHTML = ''; }
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
    setTimeout(uploadQueue, 1500);
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
      var jobs = {};
      r.upcoming.concat(r.recent).forEach(function (j) { jobs[j.row] = j; });
      Array.prototype.forEach.call(document.querySelectorAll('[data-photo]'), function (b) {
        b.onclick = function () { photoSheet(jobs[+b.getAttribute('data-photo')]); };
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-confirm]'), function (b) {
        b.onclick = function () { confirmJob(jobs[+b.getAttribute('data-confirm')]); };
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-cant]'), function (b) {
        b.onclick = function () { cantForm(jobs[+b.getAttribute('data-cant')]); };
      });
    });
  }
  function respChip(j) {
    if (j.response === 'Confirmed') return '<span class="chip green">✔ Confirmed</span>';
    if (j.response === 'Declined') return '<span class="chip red">You can\'t make it - waiting for a new inspector</span>';
    return '<span class="chip amber">Please confirm</span>';
  }
  function confirmJob(j) {
    if (!j) return;
    busy(true);
    call('respond', { row: j.row, answer: 'confirm' }).then(function (r) {
      busy(false);
      if (!r.ok) return toast(r.error, true);
      toast('Confirmed. Thank you!'); refresh();
    });
  }
  function cantForm(j) {
    if (!j) return;
    var opts = [['ob', '🧳', 'Official Business', 'I am out on official business that day'],
      ['leave', '🏖️', 'On Leave', 'I am on leave that day'],
      ['hours', '⏰', 'Not available at that time', 'I have something else at that hour'],
      ['other', '💬', 'Other reason', 'Type the reason below']];
    var pick = null;
    openSheet('<h3>I can\'t do this inspection</h3>' +
      '<div class="item-sub" style="margin:-4px 0 12px">' + esc(j.office) + ' · ' + esc(j.dateText || '') + ' ' + esc(j.timeText || '') + '</div>' +
      '<div class="choice" id="cantOpts">' + opts.map(function (o) {
        return '<button data-why="' + o[0] + '"><span class="ic">' + o[1] + '</span><div><b>' + o[2] + '</b><span>' + o[3] + '</span></div></button>';
      }).join('') + '</div>' +
      '<div class="field"><label>Note (optional)</label><input type="text" id="cantNote" maxlength="150" placeholder="e.g. Seminar in Santiago City"></div>' +
      '<p class="hint">The team leaders will be told right away so they can assign someone else. ' +
      'If you choose Official Business, On Leave or Not available, your status will also be updated for that day.</p>' +
      '<button class="btn danger" id="cantSend" disabled>Send to the team leaders</button><button class="btn link" data-close>Back</button>');
    Array.prototype.forEach.call(document.querySelectorAll('[data-why]'), function (b) {
      b.onclick = function () {
        pick = b.getAttribute('data-why');
        Array.prototype.forEach.call(document.querySelectorAll('[data-why]'), function (x) { x.classList.toggle('sel', x === b); });
        $('cantSend').disabled = false;
        if (pick === 'other') $('cantNote').focus();
      };
    });
    $('cantSend').onclick = function () {
      var note = $('cantNote').value.trim();
      if (!pick) return toast('Please choose a reason.', true);
      if (pick === 'other' && !note) return toast('Please type the reason.', true);
      busy(true);
      call('respond', { row: j.row, answer: 'decline', reasonType: pick, note: note }).then(function (r) {
        busy(false);
        if (!r.ok) return toast(r.error, true);
        closeSheet(); toast('Sent. The team leaders will assign someone else.'); refresh();
      });
    };
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
      '<div class="meta">' + (past ? '' : respChip(j)) + '<span class="chip gold">' + esc(j.ref) + '</span>' + (j.amountText ? '<span class="chip">' + esc(j.amountText) + '</span>' : '') + fchip + '</div>' +
      '</div></div>' +
      (!past && !j.response ? '<div class="actions"><button class="btn ghost" data-cant="' + j.row + '" style="color:var(--red);border-color:var(--red)">I can\'t right now</button>' +
        '<button class="btn primary" data-confirm="' + j.row + '">✔ Confirm</button></div>' : '') +
      (j.response === 'Declined' ? '' : '<div class="actions">' +
      (past ? '' : '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(j.calendarLink) + '">Add to Calendar</a>') +
      '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(j.findingsLink) + '">File findings</a></div>') +
      (j.response === 'Declined' ? '' : '<div class="actions"><button class="btn ghost" data-photo="' + j.row + '">📷 Geotagged photos' + (j.photos ? ' · ' + j.photos + ' saved' : '') + '</button></div>') + '</div>';
  }

  /* ============ INSPECTOR: GEOTAGGED PHOTOS ============
     Camera only. Each photo is stamped on the phone (seal, team, inspector, reference,
     date/time, GPS, place), the GPS is also written into the file (EXIF), a copy is
     saved on the phone, and it is uploaded to the inspection's Drive folder.
     Uploads wait in a queue on the phone if there is no signal. */
  var geo = { fix: null, watch: null, place: '', placeFor: '' };
  var shots = {};            // row -> [{ url, status }] photos taken while the app is open
  var sealImg = null;
  function loadSeal() {
    if (sealImg) return Promise.resolve(sealImg);
    return new Promise(function (res) {
      var i = new Image(); i.onload = function () { sealImg = i; res(i); }; i.onerror = function () { res(null); };
      i.src = 'icons/seal-320.webp';
    });
  }
  function geoStart(onUpdate) {
    geoStop();
    if (!navigator.geolocation) return onUpdate('nogeo');
    geo.watch = navigator.geolocation.watchPosition(function (p) {
      var c = p.coords;
      if (!geo.fix || c.accuracy <= geo.fix.acc + 5 || Date.now() - geo.fix.t > 20000) {
        geo.fix = { lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy), t: Date.now() };
      }
      var k = geo.fix.lat.toFixed(3) + ',' + geo.fix.lng.toFixed(3);
      if (geo.placeFor !== k) {
        geo.placeFor = k;
        call('place', { lat: geo.fix.lat, lng: geo.fix.lng }).then(function (r) { if (r.ok && geo.placeFor === k) { geo.place = r.place || ''; onUpdate(); } });
      }
      onUpdate();
    }, function (err) { onUpdate(err && err.code === 1 ? 'denied' : 'error'); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }
  function geoStop() { if (geo.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(geo.watch); geo.watch = null; }
  function waitFix(ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() {
        if (geo.fix && Date.now() - geo.fix.t < 120000) return res(geo.fix);
        if (Date.now() - t0 > ms) return res(null);
        setTimeout(tick, 500);
      })();
    });
  }
  function dms(v, pos, neg) { return Math.abs(v).toFixed(5) + '° ' + (v >= 0 ? pos : neg); }

  /* ---- the stamp ---- */
  function stampPhoto(file, j, fix, place, when) {
    return Promise.all([createImageBitmap(file, { imageOrientation: 'from-image' }), loadSeal()]).then(function (a) {
      var img = a[0], seal = a[1];
      var k = Math.min(1, 1600 / Math.max(img.width, img.height));
      var W = Math.round(img.width * k), H = Math.round(img.height * k);
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d');
      g.drawImage(img, 0, 0, W, H);
      var base = Math.min(W, H), fs = Math.max(14, Math.round(base * 0.03)), lh = Math.round(fs * 1.32), pad = Math.round(fs * 0.8);
      var lines = [
        { t: 'PROVINCIAL GOVERNMENT OF QUIRINO', b: true, c: '#ffb74d' },
        { t: 'INSPECTION TEAM', b: true, c: '#ffffff' },
        { t: 'Inspector: ' + title(state.me.name), c: '#ffffff' },
        { t: j.office || '', c: '#ffffff' },
        { t: (j.ref || '') + '  ·  ' + when.text, c: '#ffffff' },
        { t: dms(fix.lat, 'N', 'S') + ', ' + dms(fix.lng, 'E', 'W') + '  (±' + fix.acc + ' m)', c: '#ffe0b2' },
        { t: place || 'Place name not available (no signal)', c: '#ffe0b2' }
      ];
      var bandH = pad * 2 + lh * lines.length;
      var grd = g.createLinearGradient(0, H - bandH, 0, H);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0.75)');
      g.fillStyle = grd; g.fillRect(0, H - bandH, W, bandH);
      g.fillStyle = '#f57c00'; g.fillRect(0, H - bandH, W, Math.max(4, Math.round(fs * 0.22)));
      var sealS = Math.round(Math.min(bandH - pad * 2, W * 0.22)), x = pad;
      if (seal) { g.drawImage(seal, pad, H - bandH + (bandH - sealS) / 2, sealS, sealS); x = pad * 2 + sealS; }
      var maxW = W - x - pad;
      g.textBaseline = 'top';
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = Math.round(fs * 0.15);
      lines.forEach(function (L, i) {
        g.font = (L.b ? '700 ' : '400 ') + fs + 'px Roboto, "Segoe UI", Arial, sans-serif';
        g.fillStyle = L.c;
        var t = L.t;
        if (g.measureText(t).width > maxW) { while (t.length > 4 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1); t += '…'; }
        g.fillText(t, x, H - bandH + pad + i * lh);
      });
      return new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.88); });
    }).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
      return new Blob([withExif(new Uint8Array(buf), fix, when, j)], { type: 'image/jpeg' });
    });
  }

  /* ---- GPS inside the file (EXIF) so it is a true geotagged photo ---- */
  function ascii(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?'); }
  function withExif(jpg, fix, when, j) {
    var SZ = { 1: 1, 2: 1, 4: 4, 5: 8 };
    function A(tag, s) { s = ascii(s) + '\0'; return { tag: tag, t: 2, len: s.length, v: s }; }
    function R(tag, arr) { return { tag: tag, t: 5, len: arr.length, v: arr }; }
    function deg(v) { v = Math.abs(v); var d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; }
    var desc = 'Inspection Team, Provincial Government of Quirino - ' + (j.ref || '') + ' - ' + (j.office || '');
    var ifd0 = [A(0x010E, desc), A(0x0132, when.exif), A(0x013B, state.me.name), { tag: 0x8769, t: 4, len: 1, v: 0 }, { tag: 0x8825, t: 4, len: 1, v: 0 }];
    var exif = [A(0x9003, when.exif), A(0x9011, '+08:00')];
    var gps = [{ tag: 0, t: 1, len: 4, v: [2, 3, 0, 0] }, A(1, fix.lat >= 0 ? 'N' : 'S'), R(2, deg(fix.lat)), A(3, fix.lng >= 0 ? 'E' : 'W'), R(4, deg(fix.lng)), R(0x1F, [[fix.acc, 1]])];
    function size(es) { var d = 0; es.forEach(function (e) { var n = e.len * SZ[e.t]; if (n > 4) d += n + (n % 2); }); return 2 + 12 * es.length + 4 + d; }
    var o0 = 8, o1 = o0 + size(ifd0), o2 = o1 + size(exif), total = o2 + size(gps);
    ifd0[3].v = o1; ifd0[4].v = o2;
    var tiff = new DataView(new ArrayBuffer(total));
    tiff.setUint16(0, 0x4D4D); tiff.setUint16(2, 42); tiff.setUint32(4, 8);
    function put(off, es) {
      tiff.setUint16(off, es.length);
      var data = off + 2 + 12 * es.length + 4;
      es.forEach(function (e, i) {
        var p = off + 2 + 12 * i, n = e.len * SZ[e.t], at = p + 8;
        tiff.setUint16(p, e.tag); tiff.setUint16(p + 2, e.t); tiff.setUint32(p + 4, e.len);
        if (n > 4) { tiff.setUint32(p + 8, data); at = data; data += n + (n % 2); }
        if (e.t === 2) for (var c = 0; c < e.v.length; c++) tiff.setUint8(at + c, e.v.charCodeAt(c));
        else if (e.t === 1) e.v.forEach(function (b, c) { tiff.setUint8(at + c, b); });
        else if (e.t === 4) tiff.setUint32(at, e.v);
        else e.v.forEach(function (r, c) { tiff.setUint32(at + c * 8, r[0]); tiff.setUint32(at + c * 8 + 4, r[1]); });
      });
      tiff.setUint32(off + 2 + 12 * es.length, 0);
    }
    put(o0, ifd0); put(o1, exif); put(o2, gps);
    var seg = new Uint8Array(4 + 6 + total);
    seg[0] = 0xFF; seg[1] = 0xE1; seg[2] = (seg.length - 2) >> 8; seg[3] = (seg.length - 2) & 255;
    seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); seg.set(new Uint8Array(tiff.buffer), 10);
    var rest = 2;   // drop the JFIF header the browser adds, keep everything else
    if (jpg[2] === 0xFF && jpg[3] === 0xE0) rest = 4 + ((jpg[4] << 8) | jpg[5]);
    var out = new Uint8Array(2 + seg.length + jpg.length - rest);
    out.set([0xFF, 0xD8], 0); out.set(seg, 2); out.set(jpg.subarray(rest), 2 + seg.length);
    return out;
  }

  /* ---- upload queue (kept on the phone until it reaches Drive) ---- */
  function db() {
    return new Promise(function (res, rej) {
      try {
        var q = indexedDB.open('inspection-hub', 1);
        q.onupgradeneeded = function () { q.result.createObjectStore('photos', { keyPath: 'id' }); };
        q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
      } catch (e) { rej(e); }
    });
  }
  function qDo(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction('photos', mode), st = tx.objectStore('photos'), out = fn(st);
        tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  var memQueue = [];   // fallback if the phone blocks storage
  function qAdd(item) { return qDo('readwrite', function (s) { s.put(item); }).catch(function () { memQueue.push(item); }); }
  function qAll() { return qDo('readonly', function (s) { return s.getAll(); }).catch(function () { return []; }).then(function (a) { return (a || []).concat(memQueue); }); }
  function qDel(id) { memQueue = memQueue.filter(function (x) { return x.id !== id; }); return qDo('readwrite', function (s) { s['delete'](id); }).catch(function () { }); }
  function b64(blob) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.readAsDataURL(blob); });
  }
  var uploading = false;
  function uploadQueue() {
    if (uploading || !state.token) return Promise.resolve();
    uploading = true;
    return qAll().then(function (items) {
      return items.reduce(function (p, it) {
        return p.then(function () {
          return b64(it.blob).then(function (data) {
            return call('uploadPhoto', { row: it.row, name: it.name, data: data, lat: it.lat, lng: it.lng, acc: it.acc, place: it.place, takenText: it.takenText });
          }).then(function (r) {
            var mine = (shots[it.row] || []).filter(function (s) { return s.id === it.id; })[0];
            if (r.ok) {
              if (mine) mine.status = 'saved';
              photoCount[it.row] = r.count;
              return qDel(it.id);
            }
            if (mine) mine.status = r.offline ? 'waiting' : 'failed';
            if (!r.offline && r.error) toast(r.error, true);
            if (r.offline) throw new Error('offline');
          });
        });
      }, Promise.resolve());
    }).catch(function () { }).then(function () { uploading = false; if (redrawPhotos) redrawPhotos(); });
  }
  window.addEventListener('online', function () { uploadQueue(); });
  var photoCount = {}, redrawPhotos = null;

  function nowStamp() {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p.month - 1];
    var h = +p.hour % 24, h12 = ((h + 11) % 12) + 1, hh = ('0' + h).slice(-2);
    return {
      text: mon + ' ' + (+p.day) + ', ' + p.year + '  ·  ' + h12 + ':' + p.minute + ':' + p.second + (h < 12 ? ' AM' : ' PM'),
      exif: p.year + ':' + p.month + ':' + p.day + ' ' + hh + ':' + p.minute + ':' + p.second,
      file: p.year + p.month + p.day + '-' + hh + p.minute + p.second
    };
  }
  function saveToPhone(blob, name) {
    try {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    } catch (e) { return false; }
  }

  function photoSheet(j) {
    if (!j) return;
    if (photoCount[j.row] == null) photoCount[j.row] = j.photos || 0;
    var geoMsg = '';
    function draw() {
      var list = shots[j.row] || [];
      var waiting = list.filter(function (s) { return s.status !== 'saved'; }).length;
      var loc = geo.fix
        ? '📍 ' + dms(geo.fix.lat, 'N', 'S') + ', ' + dms(geo.fix.lng, 'E', 'W') + ' (±' + geo.fix.acc + ' m)' + (geo.place ? '<br>' + esc(geo.place) : '')
        : (geoMsg === 'denied' ? '⚠️ Location is blocked. Allow Location for Inspection Hub in your phone settings, then try again.'
          : geoMsg === 'nogeo' ? '⚠️ This phone cannot share its location.' : '📍 Finding your location… Turn on Location (GPS) if it is off.');
      var h = '<h3>📷 Geotagged photos</h3>' +
        '<div class="item-sub" style="margin:-4px 0 12px">' + esc(j.office) + ' · ' + esc(j.ref) + '</div>' +
        '<div class="note ' + (geo.fix ? 'green' : 'amber') + '" style="margin-top:0">' + loc + '</div>' +
        '<button class="btn primary" id="snap"' + (geo.fix ? '' : ' disabled') + '>📷 Take photo</button>' +
        '<p class="hint" style="text-align:center">' + photoCount[j.row] + ' photo' + (photoCount[j.row] === 1 ? '' : 's') + ' saved in Drive for this inspection' +
        (waiting ? ' · ' + waiting + ' waiting to upload' : '') + '.<br>Each photo is also saved on your phone (Downloads / Gallery).</p>';
      if (list.length) {
        h += '<div class="shots">' + list.map(function (s) {
          var tag = s.status === 'saved' ? '✔ Saved' : s.status === 'failed' ? '⚠ Not saved' : s.status === 'waiting' ? '⏳ Waiting for signal' : '⬆ Uploading…';
          return '<div class="shot"><img src="' + s.url + '" alt=""><span class="' + s.status + '">' + tag + '</span></div>';
        }).join('') + '</div>';
        if (waiting) h += '<button class="btn ghost" id="retryUp">Try uploading again</button>';
      }
      h += '<button class="btn link" data-close>Done</button>';
      var y = $('sheet').scrollTop;
      openSheet(h);
      $('sheet').scrollTop = y;
      $('snap').onclick = snap;
      if ($('retryUp')) $('retryUp').onclick = function () { (shots[j.row] || []).forEach(function (s) { if (s.status !== 'saved') s.status = 'up'; }); draw(); uploadQueue(); };
    }
    function snap() {
      var inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        busy(true);
        waitFix(15000).then(function (fix) {
          if (!fix) { busy(false); return toast('Your location was not found, so the photo was not saved. Turn on Location (GPS) and try again.', true); }
          var when = nowStamp();
          return stampPhoto(f, j, fix, geo.place, when).then(function (blob) {
            var name = String(j.ref || 'INSPECTION').replace(/[^\w-]/g, '') + '_' + when.file + '.jpg';
            var item = { id: name + '_' + Math.random().toString(36).slice(2, 7), row: j.row, name: name, blob: blob, lat: fix.lat.toFixed(6), lng: fix.lng.toFixed(6), acc: fix.acc, place: geo.place, takenText: when.text };
            (shots[j.row] = shots[j.row] || []).push({ id: item.id, url: URL.createObjectURL(blob), status: 'up' });
            saveToPhone(blob, name);
            return qAdd(item).then(function () { busy(false); draw(); uploadQueue(); });
          });
        }).catch(function (e) { busy(false); toast('The photo could not be processed. Please try again.', true); });
      };
      inp.click();
    }
    redrawPhotos = function () { if ($('snap')) draw(); };
    draw();
    geoStart(function (msg) { geoMsg = msg || ''; if ($('snap')) draw(); });
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
      var nDot = r.pending.length + (r.needs || []).length;
      if (dot) { dot.textContent = nDot; dot.classList.toggle('hidden', !nDot); }
      var html = pushBanner();
      var needs = r.needs || [];
      if (needs.length) {
        html += '<h2 class="sec" style="color:var(--red)">Needs a new inspector (' + needs.length + ')</h2><div class="list">' + needs.map(function (q) {
          return '<button class="item" data-row="' + q.row + '" data-re="1"><div class="item-top">' + dateBox(q.start) +
            '<div class="item-main"><div class="item-title">' + esc(q.office) + '</div>' +
            '<div class="item-sub">🕘 ' + esc(q.timeText || '-') + ' · 📍 ' + esc(q.place || '-') + '</div>' +
            '<div class="item-sub">✖ ' + esc(title(q.inspectorName)) + ' can\'t: ' + esc(q.respWhy || 'no reason given') + '</div>' +
            '<div class="meta"><span class="chip red">Declined by inspector</span><span class="chip gold">' + esc(q.ref) + '</span></div></div></div></button>';
        }).join('') + '</div>';
      }
      html += '<h2 class="sec">Waiting for a decision (' + r.pending.length + ')</h2>';
      html += r.pending.length ? '<div class="list">' + r.pending.map(reqCard).join('') + '</div>' : '<div class="empty">All caught up. New requests will appear here, and you will get a notification.</div>';
      if (r.decided.length) {
        html += '<h2 class="sec">Recently decided</h2><div class="list">' + r.decided.slice(0, 12).map(function (d) {
          return '<div class="item"><div class="item-top">' + dateBox(d.start) + '<div class="item-main"><div class="item-title">' + esc(d.office) + '</div>' +
            '<div class="item-sub">' + (d.action === 'Approved' ? '👤 ' + esc(title(d.inspectorName)) : '✖ ' + esc(d.deniedWhy || 'Denied')) + '</div>' +
            '<div class="meta">' + (d.action === 'Approved' ? '<span class="chip green">Approved</span>' + (d.response === 'Confirmed' ? '<span class="chip green">✔ Inspector confirmed</span>' : d.response === 'Declined' ? '<span class="chip red">Inspector declined</span>' : (d.start && d.start > Date.now() ? '<span class="chip amber">Not yet confirmed</span>' : '')) : '<span class="chip red">Denied</span>') + '<span class="chip gold">' + esc(d.ref) + '</span>' + (d.assignor ? '<span class="chip">by ' + esc(d.assignor) + '</span>' : '') + (d.photos && d.photoFolder ? '<a class="chip blue" target="_blank" rel="noopener" href="' + esc(d.photoFolder) + '">📷 ' + d.photos + ' photo' + (d.photos === 1 ? '' : 's') + '</a>' : '') + '</div></div></div></div>';
        }).join('') + '</div>';
      }
      $('view').innerHTML = html;
      wirePushBanner();
      Array.prototype.forEach.call(document.querySelectorAll('[data-row]'), function (b) {
        b.onclick = function () { openRequest(+b.getAttribute('data-row'), b.hasAttribute('data-re')); };
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

  function openRequest(row, reassign) {
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
        if (reassign) h += '<div class="note red"><b>' + esc(title(q.inspectorName)) + ' can\'t do this inspection.</b>' + esc(q.respWhy || 'No reason given') + '<br>Choose a new inspector below.</div>';
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
        if (reassign) h += '<div style="height:16px"></div><button class="btn primary" id="approveBtn"' + (sel ? '' : ' disabled') + '>Assign new inspector</button>' +
          '<p class="hint" style="text-align:center">' + (sel ? 'Assigning ' + esc(title(sel.name)) : 'Choose the new inspector') + '</p>';
        else h += '<div style="height:16px"></div><div class="row2"><button class="btn ghost" id="denyBtn" style="color:var(--red);border-color:var(--red)">Deny</button>' +
          '<button class="btn primary" id="approveBtn"' + (sel ? '' : ' disabled') + '>Approve</button></div>' +
          '<p class="hint" style="text-align:center">' + (sel ? 'Assigning ' + esc(title(sel.name)) : 'Choose an inspector to approve') + '</p>';
        var s = openSheet(h);
        Array.prototype.forEach.call(s.querySelectorAll('[data-pick]'), function (b) {
          var k = b.getAttribute('data-pick').split(':'), p = (k[0] === 'm' ? r.match : r.others)[+k[1]];
          if (sel && sel.email === p.email && sel.name === p.name) b.classList.add('sel');
          b.onclick = function () { sel = p; var y = s.scrollTop; draw(); $('sheet').scrollTop = y; };
        });
        if ($('moreBtn')) $('moreBtn').onclick = function () { showOthers = true; var y = s.scrollTop; draw(); $('sheet').scrollTop = y; };
        $('approveBtn').onclick = function () { if (sel) (reassign ? reassignTo(q, sel) : approve(q, sel, false)); };
        if ($('denyBtn')) $('denyBtn').onclick = function () { denyForm(q); };
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
  function reassignTo(q, p) {
    var msg = 'Assign <b>' + esc(title(p.name)) + '</b> to <b>' + esc(q.office) + '</b> on <b>' + esc(q.dateText) + ' ' + esc(q.timeText) + '</b> in place of ' + esc(title(q.inspectorName)) + '?' +
      '<div class="note green" style="margin-bottom:0"><b>These will receive an email right away:</b>New inspector: ' + esc(title(p.name)) + ' (' + esc(p.email) + ')<br>Requestor (updated notice): ' + esc(q.reqEmail) + '<br>Commission on Audit (updated notice)<br>Monitoring copy</div>' +
      '<p class="hint">' + esc(firstName(p.name)) + ' will also get a phone notification and will be asked to confirm.</p>';
    confirmBox('Assign new inspector?', msg, 'Assign and send', 'Go back').then(function (y) {
      if (!y) return;
      busy(true);
      call('reassign', { row: q.row, inspector: p.name, inspectorEmail: p.email }).then(function (r) {
        busy(false);
        if (!r.ok) return toast(r.error, true);
        closeSheet();
        toast(title(r.inspector) + ' assigned.' + (r.failed && r.failed.length ? ' Some emails failed: ' + r.failed.join('; ') : ' Notices sent.'), r.failed && r.failed.length);
        refresh();
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
