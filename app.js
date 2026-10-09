// Stand: 09.10.2026 - Oberflaeche von EasyKanban (lokal im Browser, ohne Server)
(function () {
  'use strict';

  var L = window.KanbanLogic;
  var KEY = 'kanbanState';
  var TAB_KEY = 'kanbanTab';
  var NAMES = { sammel: 'Sammelkorb', next: 'Next', ia: 'i.A.' };
  var IDS = { sammel: 'Sammel', next: 'Next', ia: 'Ia' };

  var state = load();
  var currentTab = readTab();
  var openId = null;
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;   // nie innerHTML mit Nutzertext
    return e;
  }

  // ---------- Speichern und Laden ----------

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(KEY);
      if (raw) {
        var s = L.sanitize(JSON.parse(raw));
        if (s) return s;
      }
    } catch (e) {
      // Beschaedigte Daten: Sicherungskopie anlegen, bevor etwas ueberschrieben wird
      try { if (raw) localStorage.setItem(KEY + 'Backup', raw); } catch (e2) {}
    }
    return L.emptyState();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('Speichern im Browser nicht möglich (privater Modus oder Speicher voll).');
      return false;
    }
  }

  function readTab() {
    try {
      var v = localStorage.getItem(TAB_KEY);
      if (L.AREAS.indexOf(v) >= 0) return v;
    } catch (e) {}
    return 'sammel';
  }

  function setTab(area) {
    currentTab = area;
    try { localStorage.setItem(TAB_KEY, area); } catch (e) {}
    renderTabs();
  }

  // ---------- Aenderungen mit Rueckgaengig ----------

  function mutate(fn, message) {
    var snap = JSON.stringify(state);
    var res = fn();
    if (!res || res.ok === false) {
      if (res && res.reason) toast(res.reason);
      return false;
    }
    save();
    render();
    if (message) {
      toast(message, function () {
        var s = L.sanitize(JSON.parse(snap));
        if (s) { state = s; save(); render(); }
      });
    }
    return true;
  }

  function doForward(id) { mutate(function () { return L.forward(state, id); }); }
  function doBack(id) { mutate(function () { return L.back(state, id); }); }
  function doRemove(id, message) {
    mutate(function () { return { ok: L.removeTask(state, id) }; }, message);
  }

  // ---------- Filter nach Stichwort (nur Anzeige, die Daten bleiben unveraendert) ----------

  var ALL = '__all';
  var NONE = '__none';
  var filterKey = ALL;   // Start immer mit "Alle", wird nicht gespeichert
  var filterName = '';
  var lastPrefill = '';

  function tagKey(tag) { return String(tag || '').trim().toLowerCase(); }

  function matches(t) {
    if (filterKey === ALL) return true;
    var k = tagKey(t.tag);
    if (filterKey === NONE) return k === '';
    return k !== '' && 't:' + k === filterKey;
  }

  // Stichwoerter ohne Beachtung der Gross und Kleinschreibung zusammenfassen
  function tagGroups() {
    var groups = {};
    state.tasks.forEach(function (t) {
      var name = String(t.tag || '').trim();
      if (!name) return;
      var k = name.toLowerCase();
      var g = groups[k] || (groups[k] = {});
      g[name] = (g[name] || 0) + 1;
    });
    return Object.keys(groups).map(function (k) {
      var variants = groups[k];
      var best = null;
      Object.keys(variants).forEach(function (n) {
        if (best === null || variants[n] > variants[best] || (variants[n] === variants[best] && n < best)) best = n;
      });
      return { key: 't:' + k, name: best };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
  }

  // Stichwort Feld bei aktivem Filter vorausfuellen, damit neue Aufgaben nicht sofort verschwinden
  function syncPrefill() {
    var input = $('addTag');
    var want = filterKey.indexOf('t:') === 0 ? filterName : '';
    if (input.value === '' || input.value === lastPrefill) input.value = want;
    lastPrefill = want;
  }

  function renderFilter() {
    var sel = $('filterSel');
    var groups = tagGroups();
    var hasNone = state.tasks.some(function (t) { return tagKey(t.tag) === ''; });
    var current = null;
    groups.forEach(function (g) { if (g.key === filterKey) current = g; });
    var valid = filterKey === ALL || (filterKey === NONE && hasNone && groups.length > 0) || current !== null;
    if (!valid) {
      // das gewaehlte Stichwort gibt es nicht mehr: zurueck auf "Alle"
      filterKey = ALL;
      filterName = '';
      syncPrefill();
    } else {
      filterName = current ? current.name : '';
    }
    sel.textContent = '';
    function opt(value, text) {
      var o = document.createElement('option');
      o.value = value;
      o.textContent = text;   // Nutzertext nie als HTML
      sel.appendChild(o);
    }
    opt(ALL, 'Alle');
    groups.forEach(function (g) { opt(g.key, g.name); });
    if (hasNone && groups.length) opt(NONE, 'Ohne Stichwort');
    sel.value = filterKey;
    sel.disabled = groups.length === 0;
    sel.classList.toggle('active', filterKey !== ALL);
  }

  // ---------- Anzeige ----------

  function render() {
    renderFilter();
    L.AREAS.forEach(renderArea);
    renderTags();
    renderTabs();
  }

  function renderArea(area) {
    var list = document.querySelector('.list[data-area="' + area + '"]');
    var tasks = L.inArea(state, area);
    var shown = 0;
    list.textContent = '';
    tasks.forEach(function (t) {
      var card = createCard(t);
      if (matches(t)) shown++; else card.classList.add('filteredOut');   // nur ausblenden, nicht verschieben
      list.appendChild(card);
    });

    var empty = document.querySelector('[data-empty="' + area + '"]');
    if (!empty.dataset.def) empty.dataset.def = empty.textContent;
    if (tasks.length === 0) {
      empty.textContent = empty.dataset.def;
      empty.hidden = false;
    } else if (shown === 0) {
      empty.textContent = filterKey === NONE
        ? 'Keine Aufgaben ohne Stichwort.'
        : 'Keine Aufgaben mit Stichwort „' + filterName + '“.';
      empty.hidden = false;
    } else {
      empty.hidden = true;
    }

    // Zaehler zeigen immer die echten Gesamtzahlen (die Grenze von 5 gilt fuer alle Aufgaben)
    var counted = L.counted(state, area);
    var waiting = tasks.length - counted;
    var text;
    var full = false;
    if (area === 'sammel') {
      text = String(tasks.length);
    } else {
      text = counted + '/' + L.LIMIT + (waiting ? ' · ' + waiting + ' wartet' : '');
      full = counted >= L.LIMIT;
    }
    var badge = $('count' + IDS[area]);
    badge.textContent = text;
    badge.classList.toggle('full', full);
    $('tab' + IDS[area]).textContent = area === 'sammel' ? String(tasks.length) : counted + '/' + L.LIMIT;
  }

  function renderTags() {
    var dl = $('tagList');
    dl.textContent = '';
    L.tags(state).forEach(function (tag) {
      var o = document.createElement('option');
      o.value = tag;
      dl.appendChild(o);
    });
  }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.area === currentTab);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.area === currentTab);
    });
  }

  function iconButton(text, label, cls, handler) {
    var b = el('button', 'iconBtn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', function (e) { e.stopPropagation(); handler(); });
    return b;
  }

  function createCard(t) {
    var li = el('li', 'card' + (t.waiting ? ' waiting' : ''));
    li.dataset.id = t.id;

    var handle = el('button', 'handle', '⋮⋮');
    handle.type = 'button';
    handle.title = 'Zum Sortieren ziehen';
    handle.setAttribute('aria-label', 'Zum Sortieren ziehen');
    li.appendChild(handle);

    var body = el('button', 'body');
    body.type = 'button';
    body.appendChild(el('span', 'title', t.title));
    var meta = el('span', 'meta');
    if (t.waiting) meta.appendChild(el('span', 'badge', 'Warten'));
    if (t.tag) meta.appendChild(el('span', 'chip', t.tag));
    if (meta.childNodes.length) body.appendChild(meta);
    body.addEventListener('click', function () { openDialog(t.id); });
    li.appendChild(body);

    var actions = el('div', 'actions');
    if (t.area === 'sammel') {
      actions.appendChild(iconButton('›', 'Weiter zu Next', '', function () { doForward(t.id); }));
    } else if (t.area === 'next') {
      actions.appendChild(iconButton('‹', 'Zurück in den Sammelkorb (Platz 4)', '', function () { doBack(t.id); }));
      actions.appendChild(iconButton('›', 'Weiter zu i.A.', '', function () { doForward(t.id); }));
    } else {
      actions.appendChild(iconButton('↩ Zurück', 'Zurück zu Next (Warten)', '', function () { doBack(t.id); }));
      actions.appendChild(iconButton('✓ Fertig', 'Fertig (wird gelöscht)', 'primary', function () {
        doRemove(t.id, 'Aufgabe erledigt.');
      }));
    }
    li.appendChild(actions);
    return li;
  }

  // ---------- Hinweis unten ----------

  function toast(message, undoFn) {
    var box = $('toast');
    clearTimeout(toastTimer);
    box.textContent = '';
    box.appendChild(el('span', '', message));
    if (undoFn) {
      var b = el('button', '', 'Rückgängig');
      b.type = 'button';
      b.addEventListener('click', function () {
        box.classList.remove('show');
        clearTimeout(toastTimer);
        undoFn();
      });
      box.appendChild(b);
    }
    box.classList.add('show');
    toastTimer = setTimeout(function () { box.classList.remove('show'); }, undoFn ? 7000 : 4500);
  }

  // ---------- Popup ----------

  function openDialog(id) {
    var t = L.find(state, id);
    if (!t) return;
    openId = id;
    $('dlgArea').textContent = NAMES[t.area];
    $('dlgWait').hidden = !t.waiting;
    $('dlgTitleInput').value = t.title;
    $('dlgTag').value = t.tag;
    $('dlgNotes').value = t.notes;
    renderMoves(t);
    $('dlg').showModal();
  }

  function renderMoves(t) {
    var row = $('dlgMoves');
    row.textContent = '';
    function add(text, cls, fn) {
      var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
      b.type = 'button';
      b.addEventListener('click', function () { moveFromDialog(fn); });
      row.appendChild(b);
    }
    var id = t.id;
    if (t.area === 'sammel') {
      add('Weiter zu Next ›', '', function () { doForward(id); });
    } else if (t.area === 'next') {
      add('‹ Zurück in den Sammelkorb', '', function () { doBack(id); });
      add('Weiter zu i.A. ›', '', function () { doForward(id); });
    } else {
      add('↩ Zurück zu Next (Warten)', '', function () { doBack(id); });
      add('✓ Fertig', 'primary', function () { doRemove(id, 'Aufgabe erledigt.'); });
    }
  }

  function applyEdits() {
    var title = $('dlgTitleInput').value.trim();
    if (!title) {
      $('dlgTitleInput').reportValidity();
      return false;
    }
    L.updateTask(state, openId, {
      title: title,
      tag: $('dlgTag').value,
      notes: $('dlgNotes').value
    });
    save();
    return true;
  }

  function closeDialog() {
    openId = null;
    if ($('dlg').open) $('dlg').close();
  }

  function moveFromDialog(fn) {
    if (!applyEdits()) return;
    closeDialog();
    render();
    fn();
  }

  $('dlgForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!applyEdits()) return;
    closeDialog();
    render();
  });
  $('dlgCancel').addEventListener('click', closeDialog);
  $('dlgDelete').addEventListener('click', function () {
    var id = openId;
    closeDialog();
    doRemove(id, 'Aufgabe gelöscht.');
  });
  $('dlg').addEventListener('click', function (e) {
    if (e.target === $('dlg')) closeDialog();   // Klick auf den Hintergrund
  });
  $('dlg').addEventListener('close', function () { openId = null; });

  // ---------- Neue Aufgabe ----------

  $('addForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('addTitle').value.trim();
    if (!title) return;
    var tag = $('addTag').value;
    var visible = matches({ tag: tag });
    mutate(function () { return { ok: !!L.addTask(state, { title: title, tag: tag }) }; },
      visible ? undefined : 'Aufgabe angelegt, aber durch den Filter ausgeblendet.');
    $('addTitle').value = '';
    $('addTitle').focus();
  });

  // ---------- Diktieren (Spracherkennung des Browsers) ----------

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var mic = $('micBtn');
  var rec = null;

  if (!SR) {
    mic.disabled = true;
    mic.title = 'Diktieren wird von diesem Browser nicht unterstützt';
  }

  mic.addEventListener('click', function () {
    if (!SR) {
      toast('Diktieren wird von diesem Browser nicht unterstützt (z. B. Chrome oder Edge verwenden).');
      return;
    }
    if (rec) { rec.stop(); return; }

    rec = new SR();
    rec.lang = 'de-DE';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    mic.classList.add('listening');

    rec.onresult = function (ev) {
      var text = ev.results[0][0].transcript.trim();
      if (!text) return;
      text = text.charAt(0).toUpperCase() + text.slice(1);
      var title = text;
      var notes = '';
      if (text.length > 200) {   // langes Diktat: Anfang als Titel, alles in die Notizen
        title = text.slice(0, 60).trim() + ' …';
        notes = text;
      }
      var tag = $('addTag').value;
      var message = matches({ tag: tag })
        ? 'Diktat im Sammelkorb gespeichert.'
        : 'Diktat gespeichert, aber durch den Filter ausgeblendet.';
      mutate(function () {
        return { ok: !!L.addTask(state, { title: title, tag: tag, notes: notes }) };
      }, message);
    };

    rec.onerror = function (ev) {
      var map = {
        'not-allowed': 'Mikrofon nicht erlaubt. Bitte Zugriff im Browser freigeben (funktioniert nur über HTTPS oder localhost).',
        'service-not-allowed': 'Mikrofon nicht erlaubt. Bitte Zugriff im Browser freigeben (funktioniert nur über HTTPS oder localhost).',
        'no-speech': 'Nichts gehört. Bitte noch einmal versuchen.',
        'audio-capture': 'Kein Mikrofon gefunden.',
        'network': 'Die Spracherkennung braucht eine Internetverbindung.'
      };
      toast(map[ev.error] || 'Diktieren fehlgeschlagen (' + ev.error + ').');
    };

    rec.onend = function () {
      rec = null;
      mic.classList.remove('listening');
    };

    try {
      rec.start();
    } catch (e) {
      rec = null;
      mic.classList.remove('listening');
      toast('Diktieren konnte nicht gestartet werden.');
    }
  });

  // ---------- Export (Sicherung als Datei) ----------

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var d = new Date();
    var a = document.createElement('a');
    a.href = url;
    a.download = 'easykanban_export_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // ---------- Sortieren per Ziehen (Maus und Touch) ----------

  function setupDrag() {
    document.querySelectorAll('.list').forEach(function (list) {
      list.addEventListener('pointerdown', function (e) {
        var handle = e.target.closest('.handle');
        if (!handle) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        var item = handle.closest('.card');
        var area = list.dataset.area;
        e.preventDefault();

        var from = Array.prototype.indexOf.call(list.children, item);
        var rect = item.getBoundingClientRect();
        var offY = e.clientY - rect.top;

        var ph = document.createElement('li');
        ph.className = 'placeholder';
        ph.style.height = rect.height + 'px';
        list.insertBefore(ph, item);

        item.classList.add('dragging');
        item.style.width = rect.width + 'px';
        item.style.left = rect.left + 'px';
        item.style.top = rect.top + 'px';
        handle.setPointerCapture(e.pointerId);

        function move(ev) {
          item.style.top = (ev.clientY - offY) + 'px';
          var before = null;
          var kids = Array.prototype.slice.call(list.children);
          for (var i = 0; i < kids.length; i++) {
            var c = kids[i];
            if (c === item || c === ph) continue;
            var r = c.getBoundingClientRect();
            if (ev.clientY < r.top + r.height / 2) { before = c; break; }
          }
          if (before) {
            if (ph.nextSibling !== before) list.insertBefore(ph, before);
          } else if (list.lastChild !== ph) {
            list.appendChild(ph);
          }
          if (ev.clientY < 70) window.scrollBy(0, -12);
          else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
        }

        function finish(commit) {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', cancel);
          var rest = Array.prototype.slice.call(list.children).filter(function (c) { return c !== item; });
          var to = rest.indexOf(ph);
          if (commit && to !== -1 && to !== from) {
            L.reorder(state, area, from, to);
            save();
          }
          render();
        }
        function up() { finish(true); }
        function cancel() { finish(false); }

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', cancel);
      });
    });
  }

  // ---------- Start ----------

  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.dataset.area); });
  });

  $('filterSel').addEventListener('change', function (e) {
    filterKey = e.target.value;
    render();
    syncPrefill();
  });

  // Aenderungen in einem anderen Tab desselben Browsers uebernehmen
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { state = load(); render(); }
  });

  setupDrag();
  render();

  // Offline Betrieb (nur ueber HTTPS oder localhost moeglich)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
