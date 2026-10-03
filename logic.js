// Stand: 03.10.2026 - Logik des Kanbantools (ohne Oberflaeche, testbar)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KanbanLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMIT = 5;        // maximal 5 Aufgaben in Next und in i.A.
  var BACK_INDEX = 3;   // Zurueckstufen in den Sammelkorb: Platz 4
  var AREAS = ['sammel', 'next', 'ia'];
  var MAX_TITLE = 200;
  var MAX_TAG = 40;
  var MAX_NOTES = 5000;

  function uid() {
    // 15 Zeichen, passt spaeter zum ID Format von PocketBase
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var buf = new Uint8Array(15);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(buf);
    } else {
      for (var i = 0; i < 15; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    var out = '';
    for (var j = 0; j < 15; j++) out += chars[buf[j] % chars.length];
    return out;
  }

  function now() { return new Date().toISOString(); }

  function clip(value, max) {
    return String(value == null ? '' : value).slice(0, max);
  }

  function emptyState() { return { version: 1, tasks: [] }; }

  function find(state, id) {
    return state.tasks.find(function (t) { return t.id === id; }) || null;
  }

  function inArea(state, area) {
    return state.tasks
      .filter(function (t) { return t.area === area; })
      .sort(function (a, b) { return a.pos - b.pos; });
  }

  function renumber(state) {
    AREAS.forEach(function (area) {
      inArea(state, area).forEach(function (t, i) { t.pos = i; });
    });
  }

  // Warten Aufgaben (aus i.A. zurueck) zaehlen nicht zu den 5 in Next
  function counted(state, area) {
    return inArea(state, area).filter(function (t) { return !t.waiting; }).length;
  }

  function isFull(state, area) {
    return area !== 'sammel' && counted(state, area) >= LIMIT;
  }

  // Aufgabe in einen Bereich an Position index setzen (Infinity = ans Ende)
  function placeAt(state, task, area, index) {
    var list = inArea(state, area).filter(function (t) { return t.id !== task.id; });
    var i = Math.max(0, Math.min(index, list.length));
    list.splice(i, 0, task);
    task.area = area;
    list.forEach(function (t, k) { t.pos = k; });
    renumber(state);
  }

  function addTask(state, data) {
    var title = clip(data.title, MAX_TITLE).trim();
    if (!title) return null;
    var t = {
      id: uid(),
      title: title,
      tag: clip(data.tag, MAX_TAG).trim(),
      notes: clip(data.notes, MAX_NOTES),
      area: 'sammel',
      pos: 0,
      waiting: false,
      created: now(),
      updated: now()
    };
    state.tasks.push(t);
    placeAt(state, t, 'sammel', Infinity);
    return t;
  }

  function updateTask(state, id, data) {
    var t = find(state, id);
    if (!t) return false;
    var title = clip(data.title, MAX_TITLE).trim();
    if (!title) return false;
    t.title = title;
    t.tag = clip(data.tag, MAX_TAG).trim();
    t.notes = clip(data.notes, MAX_NOTES);
    t.updated = now();
    return true;
  }

  // Einen Platz nachfuellen: erste (Prio 1) nicht wartende Aufgabe aus from nach to
  function pullOne(state, from, to, excludeId) {
    if (isFull(state, to)) return null;
    var cand = inArea(state, from).find(function (t) {
      return !t.waiting && t.id !== excludeId;
    });
    if (!cand) return null;
    cand.waiting = false;
    placeAt(state, cand, to, Infinity);
    cand.updated = now();
    return cand;
  }

  // freedArea: Bereich, in dem genau ein gezaehlter Platz frei geworden ist
  function refill(state, freedArea, excludeId) {
    if (freedArea === 'ia') {
      // i.A. holt aus Next, danach holt Next aus dem Sammelkorb
      if (pullOne(state, 'next', 'ia', excludeId)) {
        pullOne(state, 'sammel', 'next', excludeId);
      }
    } else if (freedArea === 'next') {
      pullOne(state, 'sammel', 'next', excludeId);
    }
  }

  // Erledigt oder geloescht (erledigte Aufgaben werden geloescht)
  function removeTask(state, id) {
    var t = find(state, id);
    if (!t) return false;
    var area = t.area;
    var wasCounted = area !== 'sammel' && !t.waiting;
    state.tasks = state.tasks.filter(function (x) { return x.id !== id; });
    renumber(state);
    if (wasCounted) refill(state, area);
    return true;
  }

  // Weitergeben in den naechsten Bereich. Voller Zielbereich: blockiert.
  function forward(state, id) {
    var t = find(state, id);
    if (!t) return { ok: false, reason: 'Aufgabe nicht gefunden.' };
    if (t.area === 'sammel') {
      if (isFull(state, 'next')) {
        return { ok: false, reason: 'Next ist voll (5). Erst dort eine Aufgabe erledigen, weitergeben oder zurückstufen.' };
      }
      t.waiting = false;
      placeAt(state, t, 'next', Infinity);
      t.updated = now();
      return { ok: true };
    }
    if (t.area === 'next') {
      if (isFull(state, 'ia')) {
        return { ok: false, reason: 'i.A. ist voll (5). Erst dort eine Aufgabe fertigstellen oder zurückgeben.' };
      }
      var wasCounted = !t.waiting;
      t.waiting = false;   // Warten Markierung endet in i.A.
      placeAt(state, t, 'ia', Infinity);
      t.updated = now();
      if (wasCounted) refill(state, 'next');
      return { ok: true };
    }
    return { ok: false, reason: 'In i.A. gibt es nur „Fertig“ oder „Zurück“.' };
  }

  // Zurueckstufen: Next -> Sammelkorb (Platz 4), i.A. -> Next (ganz oben, Warten)
  function back(state, id) {
    var t = find(state, id);
    if (!t) return { ok: false, reason: 'Aufgabe nicht gefunden.' };
    if (t.area === 'next') {
      var wasCounted = !t.waiting;
      t.waiting = false;
      placeAt(state, t, 'sammel', BACK_INDEX);
      t.updated = now();
      if (wasCounted) refill(state, 'next', t.id);
      return { ok: true };
    }
    if (t.area === 'ia') {
      t.waiting = true;
      placeAt(state, t, 'next', 0);
      t.updated = now();
      refill(state, 'ia');
      return { ok: true };
    }
    return { ok: false, reason: 'Aus dem Sammelkorb gibt es kein Zurück.' };
  }

  // Sortieren innerhalb eines Bereichs (Drag und Drop)
  function reorder(state, area, from, to) {
    var list = inArea(state, area);
    if (from < 0 || from >= list.length) return false;
    var moved = list.splice(from, 1)[0];
    var i = Math.max(0, Math.min(to, list.length));
    list.splice(i, 0, moved);
    list.forEach(function (t, k) { t.pos = k; });
    return true;
  }

  function tags(state) {
    var seen = {};
    state.tasks.forEach(function (t) { if (t.tag) seen[t.tag] = true; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'de'); });
  }

  // Prueft und bereinigt Daten (aus dem Browser Speicher oder einem Import)
  function sanitize(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) return null;
    var ids = {};
    var out = emptyState();
    for (var i = 0; i < data.tasks.length; i++) {
      var r = data.tasks[i];
      if (!r || typeof r !== 'object') continue;
      var title = clip(r.title, MAX_TITLE).trim();
      if (!title) continue;
      var area = AREAS.indexOf(r.area) >= 0 ? r.area : 'sammel';
      var id = (typeof r.id === 'string' && /^[a-z0-9]{15}$/.test(r.id) && !ids[r.id]) ? r.id : uid();
      ids[id] = true;
      out.tasks.push({
        id: id,
        title: title,
        tag: clip(r.tag, MAX_TAG).trim(),
        notes: clip(r.notes, MAX_NOTES),
        area: area,
        pos: typeof r.pos === 'number' && isFinite(r.pos) ? r.pos : i,
        waiting: area === 'next' && r.waiting === true,
        created: typeof r.created === 'string' ? r.created : now(),
        updated: typeof r.updated === 'string' ? r.updated : now()
      });
    }
    renumber(out);
    return out;
  }

  return {
    LIMIT: LIMIT,
    BACK_INDEX: BACK_INDEX,
    AREAS: AREAS,
    emptyState: emptyState,
    find: find,
    inArea: inArea,
    counted: counted,
    isFull: isFull,
    addTask: addTask,
    updateTask: updateTask,
    removeTask: removeTask,
    forward: forward,
    back: back,
    reorder: reorder,
    tags: tags,
    sanitize: sanitize
  };
});
