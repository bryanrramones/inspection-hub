/* AIR page: requestors send their Acceptance and Inspection Report without signing in.
   They type the email they used on the request form, pick the request, and send photos
   or a PDF. The engine saves the files to the Inspection Team's Drive and tells the leaders. */
(function () {
  var CFG = window.HUB_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var state = { email: '', reqs: [], row: null, files: [] };
  var MAX_PDF = 10 * 1024 * 1024;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function call(action, payload) {
    payload.action = action;
    return fetch(CFG.ENGINE_URL, { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'No connection. Please check your internet and try again.' }; });
  }

  /* Step 1 */
  $('find').onclick = function () {
    var email = $('email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { $('findMsg').textContent = 'Please type a valid email.'; return; }
    $('find').disabled = true; $('findMsg').textContent = 'Looking for your request…';
    call('airFind', { email: email }).then(function (r) {
      $('find').disabled = false;
      if (!r.ok) { $('findMsg').textContent = r.error || 'Something went wrong.'; return; }
      $('findMsg').textContent = '';
      state.email = email; state.reqs = r.requests; state.row = r.requests.length === 1 ? r.requests[0].row : null;
      drawReqs();
      $('cReq').classList.remove('hidden');
      $('cFiles').classList.remove('hidden');
      $('cReq').scrollIntoView({ behavior: 'smooth' });
    });
  };
  $('email').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('find').click(); });

  /* Step 2 */
  function drawReqs() {
    $('reqs').innerHTML = state.reqs.map(function (q) {
      return '<button class="item' + (q.row === state.row ? ' sel' : '') + '" data-row="' + q.row + '">' +
        '<div class="item-title">' + esc(q.office) + '</div>' +
        '<div class="item-sub">📅 ' + esc(q.dateText) + ' · ' + esc(q.timeText) + '</div>' +
        '<div class="item-sub">📍 ' + esc(q.place) + '</div>' +
        (q.goods ? '<div class="item-sub">📦 ' + esc(q.goods) + '</div>' : '') +
        '<div class="item-sub"><b>' + esc(q.status) + '</b>' + (q.air ? ' · AIR already sent: ' + q.air + ' file' + (q.air === 1 ? '' : 's') : '') + '</div></button>';
    }).join('') + (state.reqs.length > 1 ? '<p class="hint" style="margin:4px 0 0">Tap the request this AIR is for.</p>' : '');
    Array.prototype.forEach.call(document.querySelectorAll('#reqs [data-row]'), function (b) {
      b.onclick = function () { state.row = +b.getAttribute('data-row'); drawReqs(); updateSend(); };
    });
    updateSend();
  }

  /* Step 3 */
  $('takeBtn').onclick = function () { $('takeIn').value = ''; $('takeIn').click(); };
  $('pickBtn').onclick = function () { $('pickIn').value = ''; $('pickIn').click(); };
  $('takeIn').onchange = $('pickIn').onchange = function (e) {
    Array.prototype.forEach.call(e.target.files || [], addFile);
    drawFiles();
  };
  function addFile(file) {
    var pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    var img = /^image\//.test(file.type);
    if (!pdf && !img) { alert('"' + file.name + '" is not a photo or PDF.'); return; }
    if (pdf && file.size > MAX_PDF) { alert('"' + file.name + '" is too large (10 MB at most).'); return; }
    if (state.files.length >= 15) { alert('You can send up to 15 files at a time.'); return; }
    state.files.push({ file: file, pdf: pdf, url: img ? URL.createObjectURL(file) : '', status: '' });
  }
  function drawFiles() {
    $('files').innerHTML = state.files.map(function (f, i) {
      return '<div class="f">' + (f.pdf ? '📄<br>' + esc(f.file.name) : '<img src="' + f.url + '" alt="">') +
        (f.status ? '<div class="st">' + esc(f.status) + '</div>' : '<button data-x="' + i + '" aria-label="Remove">×</button>') + '</div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-x]'), function (b) {
      b.onclick = function () { state.files.splice(+b.getAttribute('data-x'), 1); drawFiles(); };
    });
    updateSend();
  }
  function updateSend() {
    $('send').disabled = !(state.row && state.files.length);
    $('sendMsg').textContent = !state.row ? 'Choose your request above first.' : (!state.files.length ? 'Add at least one photo or PDF.' : '');
  }

  /* Photos are made smaller (still readable) so they send quickly on mobile data. */
  function prepare(f) {
    return new Promise(function (resolve, reject) {
      if (f.pdf) {
        var fr = new FileReader();
        fr.onload = function () { resolve({ mime: 'application/pdf', data: String(fr.result).split(',')[1] }); };
        fr.onerror = reject; fr.readAsDataURL(f.file); return;
      }
      var im = new Image();
      im.onload = function () {
        var max = 2200, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        resolve({ mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      im.onerror = function () { reject(new Error('This photo could not be read. Please take it again.')); };
      im.src = f.url;
    });
  }
  $('send').onclick = function () {
    var list = state.files.slice(), i = 0, sent = 0;
    $('send').disabled = true; $('takeBtn').disabled = $('pickBtn').disabled = true;
    (function next() {
      if (i >= list.length) return finish();
      var f = list[i];
      f.status = 'Sending…'; drawFiles(); $('send').disabled = true;
      $('sendMsg').textContent = 'Sending ' + (i + 1) + ' of ' + list.length + '…';
      prepare(f).then(function (d) {
        return call('airUpload', { email: state.email, row: state.row, mime: d.mime, data: d.data, fileName: f.file.name, last: i === list.length - 1 });
      }).then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || 'Sending failed.');
        f.status = 'Sent ✓'; sent++; i++; drawFiles(); next();
      }).catch(function (err) {
        f.status = 'Not sent'; drawFiles();
        $('sendMsg').textContent = err.message + ' Tap Send to try again.';
        state.files = list.slice(i); state.files.forEach(function (x) { x.status = ''; });
        $('takeBtn').disabled = $('pickBtn').disabled = false; drawFiles();
      });
    })();
    function finish() {
      var q = state.reqs.filter(function (x) { return x.row === state.row; })[0] || {};
      $('doneMsg').innerHTML = sent + ' file' + (sent === 1 ? '' : 's') + ' sent for <b>' + esc(q.office || '') + '</b> (' + esc(q.dateText || '') + '). The Inspection Team has been notified.';
      $('cReq').classList.add('hidden'); $('cFiles').classList.add('hidden'); $('cEmail').classList.add('hidden');
      $('cDone').classList.remove('hidden');
      state.files = []; drawFiles();
      $('takeBtn').disabled = $('pickBtn').disabled = false;
      window.scrollTo(0, 0);
    }
  };
  $('more').onclick = function () {
    $('cDone').classList.add('hidden'); $('cEmail').classList.remove('hidden');
    $('cReq').classList.remove('hidden'); $('cFiles').classList.remove('hidden'); updateSend();
  };
})();
