'use strict';
/* Pizarra Familiar — calendario, tareas con puntos, comidas, compra, listas y marco de fotos.
   Sin servidor: todo se guarda en el dispositivo (localStorage + IndexedDB). */

/* ───────────── Utilidades ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const p2 = n => String(n).padStart(2, '0');
const uid = () => Math.random().toString(36).slice(2, 10);
const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
const todayStr = () => iso(new Date());
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAYS_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const COLORS = ['#e86a5c', '#3d8fd1', '#3f9d6b', '#e0a32e', '#8e63c9', '#e0699f', '#2aa7a7', '#7b8794'];
const fmtLong = d => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

/* ───────────── Estado ───────────── */
const KEY = 'pizarra.v1';
const defaults = () => ({
  profiles: [{ id: 'p1', name: 'Familia', color: COLORS[0] }],
  events: [], chores: [], rewards: [], ledger: [],
  meals: {}, groceries: [], pantry: [], lists: [], photos: [],
  settings: { theme: 'auto', accent: COLORS[0], bedtime: '22:30', wake: '07:00', saverMin: 5, city: 'Madrid', lat: 40.4168, lon: -3.7038 }
});
let S = load();
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw) { const d = defaults(); return { ...d, ...raw, settings: { ...d.settings, ...(raw.settings || {}) } }; }
  } catch (e) { /* estado corrupto: se reinicia */ }
  return defaults();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('No se pudo guardar (almacenamiento lleno)'); } if (typeof scheduleSync === 'function') scheduleSync(); }
const profile = id => S.profiles.find(p => p.id === id) || S.profiles[0];
const profOpts = (withAll) => [...(withAll ? [{ value: '', label: 'Todos' }] : []), ...S.profiles.map(p => ({ value: p.id, label: p.name }))];

/* ───────────── Calendario: ocurrencias, ICS ───────────── */
function occursOn(ev, ds) {
  if (ds < ev.date) return false;
  if (ev.until && ds > ev.until) return false;
  if (ev.date === ds) return true;
  const a = fromIso(ev.date), b = fromIso(ds);
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekly': return Math.round((b - a) / 864e5) % 7 === 0;
    case 'monthly': return a.getDate() === b.getDate();
    case 'yearly': return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    default: return false;
  }
}
let calFilter = '';
function eventsOn(ds, filter = calFilter) {
  return S.events.filter(e => occursOn(e, ds) && (!filter || e.profile === filter))
    .sort((a, b) => (a.allDay ? '' : a.start || '').localeCompare(b.allDay ? '' : b.start || '') || a.title.localeCompare(b.title));
}
function parseICS(txt) {
  txt = txt.replace(/\r?\n[ \t]/g, '');
  const out = [];
  for (const b of txt.split('BEGIN:VEVENT').slice(1)) {
    const g = k => { const m = b.match(new RegExp('^' + k + '[^:\\n]*:(.*)$', 'mi')); return m ? m[1].trim().replace(/\r$/, '') : ''; };
    const dt = g('DTSTART'); if (!dt) continue;
    const m = dt.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?(Z)?/); if (!m) continue;
    let date = `${m[1]}-${m[2]}-${m[3]}`, start = '';
    if (m[4]) {
      if (m[6]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); date = iso(d); start = `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
      else start = `${m[4]}:${m[5]}`;
    }
    const em = g('DTEND').match(/T(\d{2})(\d{2})/);
    const rr = (g('RRULE').match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/) || [])[1];
    out.push({
      id: uid(), title: g('SUMMARY').replace(/\\([,;nN\\])/g, (_, c) => (c === 'n' || c === 'N') ? '\n' : c) || 'Evento',
      date, allDay: !m[4], start, end: em && !m[6] ? `${em[1]}:${em[2]}` : '', profile: S.profiles[0].id,
      repeat: rr ? rr.toLowerCase() : 'none', notes: g('DESCRIPTION').replace(/\\n/gi, '\n').replace(/\\([,;])/g, '$1')
    });
  }
  return out;
}
function buildICS() {
  const esc = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pizarra Familiar//ES'];
  for (const e of S.events) {
    const d = e.date.replace(/-/g, '');
    L.push('BEGIN:VEVENT', `UID:${e.id}@pizarra`, `DTSTAMP:${d}T000000`);
    if (e.allDay || !e.start) L.push(`DTSTART;VALUE=DATE:${d}`);
    else { L.push(`DTSTART:${d}T${e.start.replace(':', '')}00`); if (e.end) L.push(`DTEND:${d}T${e.end.replace(':', '')}00`); }
    L.push(`SUMMARY:${esc(e.title)}`);
    if (e.notes) L.push(`DESCRIPTION:${esc(e.notes)}`);
    if (e.repeat && e.repeat !== 'none') L.push(`RRULE:FREQ=${e.repeat.toUpperCase()}`);
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}

/* ───────────── Texto/voz rápidos ───────────── */
function parseQuick(text) {
  const raw = text.trim();
  const shop = raw.match(/^(?:añade|añadir|agrega|apunta|pon|compra)\s+(.+?)\s+(?:a|en)\s+la\s+(?:lista\s+de\s+la\s+)?compra\.?$/i);
  if (shop) return { kind: 'shop', items: shop[1].split(/\s*(?:,| y )\s*/).filter(Boolean) };
  let t = ' ' + raw.toLowerCase() + ' ';
  let d = new Date(), start = '';
  const cut = re => { const m = t.match(re); if (m) t = t.replace(re, ' '); return m; };
  if (cut(/ pasado mañana /)) d = addDays(d, 2);
  else if (cut(/ mañana (?!por la)/)) d = addDays(d, 1);
  else if (cut(/ hoy /)) { /* hoy */ }
  else {
    const wd = t.match(/ (?:el |este |el próximo )?(domingo|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado) /);
    if (wd) {
      const idx = DAYS_FULL.findIndex(n => n.normalize('NFD').replace(/[̀-ͯ]/g, '') === wd[1].normalize('NFD').replace(/[̀-ͯ]/g, ''));
      let diff = (idx - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
      d = addDays(d, diff); t = t.replace(wd[0], ' ');
    } else {
      const dm = t.match(/ (?:el )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) /);
      if (dm) {
        d = new Date(d.getFullYear(), MONTHS.indexOf(dm[2]), +dm[1]);
        if (d < addDays(new Date(), -1)) d.setFullYear(d.getFullYear() + 1);
        t = t.replace(dm[0], ' ');
      }
    }
  }
  const tm = t.match(/ a las (\d{1,2})(?:[:.](\d{2})| y (media|cuarto)| (\d{2}))?\s*(?:h|horas)?\s*(de la tarde|de la noche|de la mañana|pm|am)? /);
  if (tm) {
    let hh = +tm[1], mm = tm[2] ? +tm[2] : tm[4] ? +tm[4] : tm[3] === 'media' ? 30 : tm[3] === 'cuarto' ? 15 : 0;
    if (/tarde|noche|pm/.test(tm[5] || '') && hh < 12) hh += 12;
    start = `${p2(hh)}:${p2(mm)}`; t = t.replace(tm[0], ' ');
  }
  t = t.replace(/ (?:añade|añadir|agrega|apunta|crea|recuérdame|recuerdame|pon|cita|evento|que|tengo|tenemos) /g, ' ')
       .replace(/\s+/g, ' ').trim();
  const title = (t || raw).replace(/^./, c => c.toUpperCase());
  return { kind: 'event', title, date: iso(d), start };
}
function quickAdd(text) {
  if (!text.trim()) return;
  const r = parseQuick(text);
  if (r.kind === 'shop') {
    r.items.forEach(i => addGrocery(i)); save(); toast(`🛒 Añadido a la compra: ${r.items.join(', ')}`);
  } else {
    S.events.push({ id: uid(), title: r.title, date: r.date, allDay: !r.start, start: r.start, end: '', profile: calFilter || S.profiles[0].id, repeat: 'none', notes: '' });
    save(); toast(`📅 ${r.title} · ${fromIso(r.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}${r.start ? ' ' + r.start : ''}`);
  }
  render();
}
function listen(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Tu navegador no admite dictado por voz');
  const rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = false;
  btn.classList.add('rec');
  rec.onresult = e => { const t = e.results[0][0].transcript; if (input) input.value = t; quickAdd(t); };
  rec.onerror = () => toast('No se pudo escuchar');
  rec.onend = () => btn.classList.remove('rec');
  rec.start();
}

/* ───────────── Tareas y puntos ───────────── */
const balance = pid => S.ledger.filter(l => l.profile === pid).reduce((a, l) => a + l.pts, 0);
function choreDue(c, ds) {
  if (c.repeat === 'once') return c.date === ds;
  if (ds < (c.date || '0000')) return false;
  if (c.repeat === 'weekly') return (c.days || []).includes(fromIso(ds).getDay());
  return true; // daily
}
function toggleChore(c, ds) {
  c.done = c.done || {};
  if (c.done[ds]) {
    delete c.done[ds];
    S.ledger = S.ledger.filter(l => l.ref !== `${c.id}:${ds}`);
  } else {
    c.done[ds] = true;
    S.ledger.push({ id: uid(), profile: c.profile, pts: +c.points || 0, date: ds, ref: `${c.id}:${ds}`, label: c.title });
    if (+c.points) toast(`⭐ +${c.points} para ${profile(c.profile).name}`);
  }
  save(); render();
}

/* ───────────── Compra y despensa ───────────── */
function addGrocery(text) {
  text = text.trim(); if (!text) return false;
  if (S.groceries.some(g => g.text.toLowerCase() === text.toLowerCase() && !g.done)) return false;
  S.groceries.push({ id: uid(), text, done: false }); return true;
}
function mealToGroceries(m) {
  const items = (m.ingredients || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  let n = 0;
  for (const i of items) {
    if (S.pantry.some(p => p.text.toLowerCase() === i.toLowerCase())) continue;
    if (addGrocery(i)) n++;
  }
  return n;
}

/* ───────────── Fotos (IndexedDB) ───────────── */
const photoDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('pizarra-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => res(this.db = r.result); r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode), st = t.objectStore('photos'), rq = fn(st);
      t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()).then(r => r || []); },
  put(p) { return this.tx('readwrite', s => s.put(p)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); }
};
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const c = h('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
}

/* ───────────── Modal genérico ───────────── */
function modal(title, fields, { onSave, onDelete, saveLabel = 'Guardar' } = {}) {
  const dlg = h('dialog', { class: 'modal' });
  const form = h('form', { novalidate: false });
  const get = {};
  form.append(h('h2', null, title));
  for (const f of fields) {
    let inp, label = h('label', { class: 'field' + (f.type === 'checkbox' ? ' inline' : '') });
    if (f.type === 'select') {
      inp = h('select', null, f.options.map(o => h('option', { value: o.value }, o.label))); inp.value = f.value ?? '';
      get[f.name] = () => inp.value;
    } else if (f.type === 'textarea') {
      inp = h('textarea', { rows: 3, placeholder: f.placeholder }); inp.value = f.value || ''; get[f.name] = () => inp.value;
    } else if (f.type === 'checkbox') {
      inp = h('input', { type: 'checkbox' }); inp.checked = !!f.value; get[f.name] = () => inp.checked;
      if (f.onchange) inp.addEventListener('change', () => f.onchange(inp.checked, form));
    } else if (f.type === 'days') {
      const boxes = [1, 2, 3, 4, 5, 6, 0].map((d, i) => { const c = h('input', { type: 'checkbox' }); c.checked = (f.value || []).includes(d); return [d, c, h('label', null, c, DOW[i])]; });
      inp = h('div', { class: 'checks' }, boxes.map(b => b[2]));
      get[f.name] = () => boxes.filter(b => b[1].checked).map(b => b[0]);
    } else {
      inp = h('input', { type: f.type || 'text', placeholder: f.placeholder, required: f.required, min: f.min, max: f.max, step: f.step });
      inp.value = f.value ?? ''; get[f.name] = () => f.type === 'number' ? +inp.value : inp.value;
    }
    inp.name = f.name;
    label.append(...(f.type === 'checkbox' ? [inp, h('span', null, f.label)] : [h('span', null, f.label), inp]));
    form.append(label);
  }
  const close = () => { dlg.close(); dlg.remove(); };
  form.append(h('div', { class: 'actions' },
    onDelete && h('button', { type: 'button', class: 'btn danger left', onclick: () => { if (confirm('¿Eliminar?')) { onDelete(); save(); close(); render(); } } }, 'Eliminar'),
    h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancelar'),
    h('button', { type: 'submit', class: 'btn primary' }, saveLabel)));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = {}; for (const k in get) v[k] = get[k]();
    onSave(v); save(); close(); render();
  });
  dlg.append(form); document.body.append(dlg); dlg.showModal();
  dlg.addEventListener('cancel', () => dlg.remove());
  const first = form.querySelector('input:not([type=checkbox]),textarea'); first && first.focus();
  return form;
}

/* ───────────── Formularios de entidades ───────────── */
function eventForm(ev, dflt = {}) {
  const e = ev || { id: uid(), title: '', date: dflt.date || todayStr(), allDay: false, start: '09:00', end: '', profile: calFilter || S.profiles[0].id, repeat: 'none', notes: '' };
  modal(ev ? 'Editar evento' : 'Nuevo evento', [
    { name: 'title', label: 'Título', value: e.title, required: true, placeholder: 'Dentista, cumpleaños…' },
    { name: 'date', label: 'Fecha', type: 'date', value: e.date, required: true },
    { name: 'allDay', label: 'Todo el día', type: 'checkbox', value: e.allDay },
    { name: 'start', label: 'Inicio', type: 'time', value: e.start },
    { name: 'end', label: 'Fin', type: 'time', value: e.end },
    { name: 'profile', label: 'Para', type: 'select', options: profOpts(), value: e.profile },
    { name: 'repeat', label: 'Repetir', type: 'select', value: e.repeat || 'none', options: [['none', 'No se repite'], ['daily', 'Cada día'], ['weekly', 'Cada semana'], ['monthly', 'Cada mes'], ['yearly', 'Cada año']].map(([value, label]) => ({ value, label })) },
    { name: 'notes', label: 'Notas', type: 'textarea', value: e.notes }
  ], {
    onSave: v => { Object.assign(e, v); if (!ev) S.events.push(e); },
    onDelete: ev && (() => { S.events = S.events.filter(x => x.id !== ev.id); })
  });
}
function choreForm(c) {
  const e = c || { id: uid(), title: '', profile: S.profiles[0].id, points: 1, moment: 'mañana', repeat: 'daily', days: [1, 2, 3, 4, 5], date: todayStr(), done: {} };
  modal(c ? 'Editar tarea' : 'Nueva tarea o rutina', [
    { name: 'title', label: 'Tarea', value: e.title, required: true, placeholder: 'Hacer la cama, sacar la basura…' },
    { name: 'profile', label: 'Quién', type: 'select', options: profOpts(), value: e.profile },
    { name: 'points', label: 'Puntos (estrellas)', type: 'number', min: 0, max: 100, value: e.points },
    { name: 'moment', label: 'Momento del día', type: 'select', value: e.moment, options: ['mañana', 'tarde', 'noche', 'cualquier momento'].map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    { name: 'repeat', label: 'Frecuencia', type: 'select', value: e.repeat, options: [{ value: 'daily', label: 'Todos los días' }, { value: 'weekly', label: 'Días concretos de la semana' }, { value: 'once', label: 'Una sola vez' }] },
    { name: 'days', label: 'Días (si es semanal)', type: 'days', value: e.days },
    { name: 'date', label: 'Fecha de inicio / única', type: 'date', value: e.date }
  ], { onSave: v => { Object.assign(e, v); if (!c) S.chores.push(e); }, onDelete: c && (() => { S.chores = S.chores.filter(x => x.id !== c.id); }) });
}
function rewardForm(r) {
  const e = r || { id: uid(), title: '', cost: 10 };
  modal(r ? 'Editar premio' : 'Nuevo premio', [
    { name: 'title', label: 'Premio', value: e.title, required: true, placeholder: 'Elegir la peli, helado…' },
    { name: 'cost', label: 'Coste en estrellas', type: 'number', min: 1, value: e.cost }
  ], { onSave: v => { Object.assign(e, v); if (!r) S.rewards.push(e); }, onDelete: r && (() => { S.rewards = S.rewards.filter(x => x.id !== r.id); }) });
}
function mealForm(ds, slot) {
  const cur = (S.meals[ds] || {})[slot] || {};
  modal(`${slot[0].toUpperCase() + slot.slice(1)} · ${fmtLong(fromIso(ds))}`, [
    { name: 'title', label: 'Plato', value: cur.title, placeholder: 'Lentejas con verduras' },
    { name: 'ingredients', label: 'Ingredientes (separados por comas)', type: 'textarea', value: cur.ingredients },
    { name: 'url', label: 'Enlace a la receta / vídeo', type: 'url', value: cur.url }
  ], {
    onSave: v => {
      S.meals[ds] = S.meals[ds] || {};
      if (!v.title && !v.ingredients) delete S.meals[ds][slot]; else S.meals[ds][slot] = v;
    },
    onDelete: cur.title ? (() => { delete S.meals[ds][slot]; }) : null
  });
}

/* ───────────── Vistas ───────────── */
const NAV = [['home', '🏠', 'Inicio'], ['cal', '📅', 'Calendario'], ['chores', '⭐', 'Tareas'], ['meals', '🍽️', 'Comidas'], ['lists', '📝', 'Listas'], ['photos', '🖼️', 'Fotos'], ['settings', '⚙️', 'Ajustes']];
let view = location.hash.slice(1) || 'home';
if (!NAV.some(n => n[0] === view)) view = 'home';
const cal = { mode: 'month', cursor: new Date(), sel: todayStr() };
let mealWeek = mondayOf(new Date());
let choreProfile = '';

function render() {
  const nav = $('#nav'); nav.replaceChildren(
    ...NAV.filter(n => n[0] !== 'settings').map(navBtn), h('div', { class: 'spacer' }), navBtn(NAV[6]));
  const main = $('#main'); const y = main.scrollTop;
  main.replaceChildren(({ home: viewHome, cal: viewCal, chores: viewChores, meals: viewMeals, lists: viewLists, photos: viewPhotos, settings: viewSettings })[view]());
  main.scrollTop = y;
}
function navBtn([id, ico, label]) {
  return h('button', { class: view === id ? 'on' : '', onclick: () => { view = id; location.hash = id; render(); }, 'aria-label': label }, h('span', { class: 'ico' }, ico), label);
}
const head = (title, ...actions) => h('div', { class: 'page-head' }, h('h1', null, title), ...actions);
const checkRow = (text, done, onToggle, extra) =>
  h('div', { class: 'row' + (done ? ' done' : '') }, h('input', { type: 'checkbox', checked: done, onchange: onToggle }), h('span', { class: 'grow' }, text), extra);
function addInput(placeholder, onAdd) {
  const inp = h('input', { placeholder });
  const go = () => { if (inp.value.trim()) { onAdd(inp.value.trim()); inp.value = ''; } };
  inp.addEventListener('keydown', e => e.key === 'Enter' && go());
  return h('div', { class: 'add-row' }, inp, h('button', { class: 'btn', onclick: go }, 'Añadir'));
}

/* — Inicio — */
let weatherCache = null;
const WX = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 57 ? '🌦️' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌧️' : c <= 86 ? '🌨️' : '⛈️';
async function loadWeather() {
  const { lat, lon } = S.settings; const k = `${lat},${lon}`;
  if (weatherCache && weatherCache.k === k && Date.now() - weatherCache.t < 6e5) return weatherCache.d;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3`);
    const d = await r.json(); weatherCache = { k, t: Date.now(), d }; return d;
  } catch (e) { return null; }
}
function viewHome() {
  const now = new Date(), ds = iso(now);
  const clock = h('div', { class: 'clock', id: 'clock' }, now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
  const wx = h('div', { class: 'weather' });
  loadWeather().then(d => {
    if (!d || !d.current) return;
    wx.replaceChildren(h('span', null, `${WX(d.current.weather_code)} ${Math.round(d.current.temperature_2m)}°  ${S.settings.city}`),
      ...d.daily.time.slice(1).map((t, i) => h('span', { class: 'day' }, `${DAYS_FULL[fromIso(t).getDay()].slice(0, 3)} ${WX(d.daily.weather_code[i + 1])} ${Math.round(d.daily.temperature_2m_min[i + 1])}°/${Math.round(d.daily.temperature_2m_max[i + 1])}°`)));
  });
  const input = h('input', { placeholder: 'Escribe o dicta: «cita con el dentista el martes a las 5» o «añade leche a la compra»' });
  const mic = h('button', { class: 'btn mic icon', title: 'Dictar', 'aria-label': 'Dictar', onclick: () => listen(mic, input) }, '🎤');
  input.addEventListener('keydown', e => e.key === 'Enter' && (quickAdd(input.value)));
  const quick = h('div', { class: 'quick' }, input, mic, h('button', { class: 'btn primary', onclick: () => quickAdd(input.value) }, 'Añadir'));

  const today = eventsOn(ds, '');
  const upcoming = [];
  for (let i = 1; i <= 14 && upcoming.length < 5; i++) { const d = iso(addDays(now, i)); eventsOn(d, '').forEach(e => upcoming.length < 5 && upcoming.push([d, e])); }
  const evRow = (e, d) => h('div', { class: 'row', onclick: () => eventForm(e), style: { cursor: 'pointer' } },
    h('span', { class: 'dot', style: { background: profile(e.profile).color } }), h('span', { class: 'time' }, e.allDay ? 'Día' : e.start || ''), h('span', { class: 'grow' }, e.title),
    d && h('span', { class: 'muted' }, fromIso(d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })));
  const agenda = h('section', { class: 'card' }, h('h2', null, '📅 ', h('span', { class: 'grow' }, 'Hoy'), h('button', { class: 'btn small', onclick: () => eventForm(null) }, '+ Evento')),
    today.length ? today.map(e => evRow(e)) : h('div', { class: 'empty' }, 'Nada en la agenda de hoy.'),
    upcoming.length > 0 && h('div', { class: 'group-title' }, 'Próximamente'), upcoming.map(([d, e]) => evRow(e, d)));

  const due = S.chores.filter(c => choreDue(c, ds));
  const chores = h('section', { class: 'card' }, h('h2', null, '⭐ ', h('span', { class: 'grow' }, 'Tareas de hoy'), h('button', { class: 'btn small', onclick: () => { view = 'chores'; render(); } }, 'Ver todas')),
    due.length ? due.map(c => checkRow(c.title, !!(c.done || {})[ds], () => toggleChore(c, ds), h('span', { class: 'chip', style: { background: profile(c.profile).color } }, profile(c.profile).name))) : h('div', { class: 'empty' }, 'No hay tareas para hoy.'),
    S.profiles.length > 1 || balance(S.profiles[0].id) ? h('div', { class: 'points-row', style: { marginTop: '10px', marginBottom: 0 } }, S.profiles.map(p => h('span', { class: 'chip', style: { background: p.color } }, `${p.name}: ${balance(p.id)} ⭐`))) : null);

  const meal = S.meals[ds] || {};
  const meals = h('section', { class: 'card' }, h('h2', null, '🍽️ ', h('span', { class: 'grow' }, 'Menú de hoy'), h('button', { class: 'btn small', onclick: () => { view = 'meals'; render(); } }, 'Planificar')),
    ['desayuno', 'comida', 'cena'].map(s => h('div', { class: 'row', onclick: () => mealForm(ds, s), style: { cursor: 'pointer' } }, h('span', { class: 'time', style: { minWidth: '72px' } }, s), h('span', { class: 'grow' }, (meal[s] || {}).title || h('span', { class: 'muted' }, '—')))));

  const shop = h('section', { class: 'card' }, h('h2', null, '🛒 ', h('span', { class: 'grow' }, 'Compra')),
    S.groceries.length ? S.groceries.slice(0, 8).map(g => checkRow(g.text, g.done, () => { g.done = !g.done; save(); render(); })) : h('div', { class: 'empty' }, 'La lista está vacía.'),
    S.groceries.length > 8 && h('div', { class: 'muted' }, `+${S.groceries.length - 8} más en Comidas`),
    addInput('Añadir a la compra', t => { addGrocery(t); save(); render(); }));

  const kiosk = h('button', { class: 'btn', onclick: kioskMode }, '🖥️ Modo pizarra');
  return h('div', null, head('Pizarra familiar', kiosk), quick,
    h('div', { class: 'grid' }, h('section', { class: 'card clock-card' }, clock, h('div', { class: 'date', id: 'date' }, fmtLong(now)), wx), agenda, chores, meals, shop));
}

/* — Calendario — */
function viewCal() {
  const c = cal.cursor;
  const step = n => { if (cal.mode === 'month') cal.cursor = new Date(c.getFullYear(), c.getMonth() + n, 1); else cal.cursor = addDays(c, n * (cal.mode === 'week' ? 7 : 1)); render(); };
  const title = cal.mode === 'month' ? `${MONTHS[c.getMonth()]} ${c.getFullYear()}` : cal.mode === 'week' ? `Semana del ${mondayOf(c).getDate()} de ${MONTHS[mondayOf(c).getMonth()]}` : fmtLong(c);
  const modeBtn = (m, l) => h('button', { class: cal.mode === m ? 'on' : '', onclick: () => { cal.mode = m; render(); } }, l);
  const filter = h('div', { class: 'profile-filter' },
    h('button', { class: 'pill' + (!calFilter ? ' on' : ''), onclick: () => { calFilter = ''; render(); } }, 'Todos'),
    S.profiles.map(p => h('button', { class: 'pill' + (calFilter === p.id ? ' on' : ''), style: { '--c': p.color }, onclick: () => { calFilter = p.id; render(); } }, p.name)));
  const bar = h('div', { class: 'cal-head' }, h('h2', null, title),
    h('button', { class: 'btn icon', onclick: () => step(-1), 'aria-label': 'Anterior' }, '◀'),
    h('button', { class: 'btn', onclick: () => { cal.cursor = new Date(); cal.sel = todayStr(); render(); } }, 'Hoy'),
    h('button', { class: 'btn icon', onclick: () => step(1), 'aria-label': 'Siguiente' }, '▶'),
    h('div', { class: 'seg' }, modeBtn('month', 'Mes'), modeBtn('week', 'Semana'), modeBtn('day', 'Día')));
  let body;
  if (cal.mode === 'month') {
    const first = new Date(c.getFullYear(), c.getMonth(), 1), start = mondayOf(first);
    const rows = (addDays(start, 35).getMonth() === c.getMonth() && addDays(start, 35) < new Date(c.getFullYear(), c.getMonth() + 1, 1)) ? 42 : 35;
    const cells = Array.from({ length: rows }, (_, i) => addDays(start, i));
    body = h('div', { class: 'month' }, DOW.map(d => h('div', { class: 'dow' }, d)), cells.map(d => {
      const ds = iso(d), evs = eventsOn(ds);
      return h('button', { class: `cell${d.getMonth() !== c.getMonth() ? ' out' : ''}${ds === todayStr() ? ' today' : ''}${ds === cal.sel ? ' sel' : ''}`, onclick: () => { cal.sel = ds; cal.cursor = d; cal.mode = 'month'; render(); }, ondblclick: () => eventForm(null, { date: ds }) },
        h('span', { class: 'n' }, d.getDate()),
        evs.slice(0, 3).map(e => h('span', { class: 'ev', style: { background: profile(e.profile).color } }, (e.start ? e.start + ' ' : '') + e.title)),
        evs.length > 3 && h('span', { class: 'more' }, `+${evs.length - 3} más`),
        h('span', { class: 'dots' }, evs.slice(0, 5).map(e => h('span', { class: 'dot', style: { background: profile(e.profile).color, width: '7px', height: '7px' } }))));
    }));
  } else if (cal.mode === 'week') {
    const m = mondayOf(c);
    body = h('div', { class: 'week' }, Array.from({ length: 7 }, (_, i) => {
      const d = addDays(m, i), ds = iso(d);
      return h('div', { class: 'col' + (ds === todayStr() ? ' today' : '') }, h('h3', null, d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' })),
        eventsOn(ds).map(e => evCard(e)), h('button', { class: 'btn small', onclick: () => eventForm(null, { date: ds }) }, '+'));
    }));
  } else {
    const ds = iso(c), evs = eventsOn(ds);
    body = h('div', { class: 'card' }, evs.length ? evs.map(e => evCard(e)) : h('div', { class: 'empty' }, 'Sin eventos este día.'), h('button', { class: 'btn primary', onclick: () => eventForm(null, { date: ds }) }, '+ Nuevo evento'));
  }
  const selPanel = cal.mode === 'month' ? h('div', { class: 'card', style: { marginTop: '14px' } }, h('h2', null, h('span', { class: 'grow', style: { textTransform: 'capitalize' } }, fmtLong(fromIso(cal.sel))), h('button', { class: 'btn small primary', onclick: () => eventForm(null, { date: cal.sel }) }, '+ Evento')),
    eventsOn(cal.sel).length ? eventsOn(cal.sel).map(e => evCard(e)) : h('div', { class: 'empty' }, 'Sin eventos. Doble clic en un día para añadir uno rápido.')) : null;
  return h('div', null, head('Calendario'), bar, filter, body, selPanel);
}
const evCard = e => h('div', { class: 'evcard', style: { '--c': profile(e.profile).color }, onclick: () => eventForm(e) },
  e.title, h('small', null, `${e.allDay ? 'Todo el día' : e.start + (e.end ? '–' + e.end : '')} · ${profile(e.profile).name}${e.repeat && e.repeat !== 'none' ? ' · 🔁' : ''}`));

/* — Tareas — */
function viewChores() {
  const ds = todayStr();
  const prof = h('div', { class: 'profile-filter' }, h('button', { class: 'pill' + (!choreProfile ? ' on' : ''), onclick: () => { choreProfile = ''; render(); } }, 'Todos'),
    S.profiles.map(p => h('button', { class: 'pill' + (choreProfile === p.id ? ' on' : ''), style: { '--c': p.color }, onclick: () => { choreProfile = p.id; render(); } }, p.name)));
  const pts = h('div', { class: 'points-row' }, S.profiles.map(p => h('div', { class: 'pbox', style: { '--c': p.color } }, h('span', { class: 'muted' }, p.name), h('b', null, h('span', { class: 'stars' }, '⭐'), ' ', balance(p.id)))));
  const due = S.chores.filter(c => choreDue(c, ds) && (!choreProfile || c.profile === choreProfile));
  const todayCard = h('section', { class: 'card' }, h('h2', null, '✅ Hoy'),
    ['mañana', 'tarde', 'noche', 'cualquier momento'].map(m => {
      const g = due.filter(c => c.moment === m); if (!g.length) return null;
      return [h('div', { class: 'group-title' }, m), g.map(c => checkRow(c.title, !!(c.done || {})[ds], () => toggleChore(c, ds), h('span', { class: 'chip', style: { background: profile(c.profile).color } }, `${profile(c.profile).name} · ${c.points}⭐`)))];
    }), !due.length && h('div', { class: 'empty' }, 'No hay tareas para hoy.'));
  const manage = h('section', { class: 'card' }, h('h2', null, '🗂️ ', h('span', { class: 'grow' }, 'Todas las tareas y rutinas'), h('button', { class: 'btn small primary', onclick: () => choreForm() }, '+ Nueva')),
    S.chores.length ? S.chores.map(c => h('div', { class: 'row', onclick: () => choreForm(c), style: { cursor: 'pointer' } }, h('span', { class: 'dot', style: { background: profile(c.profile).color } }),
      h('span', { class: 'grow' }, c.title), h('span', { class: 'muted' }, c.repeat === 'daily' ? 'a diario' : c.repeat === 'once' ? 'una vez' : (c.days || []).map(d => DOW[(d + 6) % 7]).join(' '), ` · ${c.points}⭐`))) : h('div', { class: 'empty' }, 'Crea tareas con puntos y repítelas por días.'));
  const rewards = h('section', { class: 'card' }, h('h2', null, '🎁 ', h('span', { class: 'grow' }, 'Premios'), h('button', { class: 'btn small primary', onclick: () => rewardForm() }, '+ Premio')),
    S.rewards.length ? S.rewards.map(r => h('div', { class: 'row' }, h('span', { class: 'grow' }, r.title), h('span', { class: 'muted' }, `${r.cost}⭐`),
      h('button', { class: 'btn small', onclick: () => redeem(r) }, 'Canjear'), h('button', { class: 'btn small', onclick: () => rewardForm(r), 'aria-label': 'Editar' }, '✏️'))) : h('div', { class: 'empty' }, 'Añade premios que se canjean con estrellas.'),
    S.ledger.filter(l => l.pts < 0).slice(-3).reverse().map(l => h('div', { class: 'muted', style: { fontSize: '.85rem' } }, `🎉 ${profile(l.profile).name} canjeó «${l.label}» (${l.date})`)));
  return h('div', null, head('Tareas y premios'), pts, prof, h('div', { class: 'grid' }, todayCard, rewards, manage));
}
function redeem(r) {
  const who = S.profiles.length === 1 ? S.profiles[0].id : null;
  const go = pid => {
    if (balance(pid) < r.cost) return toast(`A ${profile(pid).name} le faltan ${r.cost - balance(pid)} ⭐`);
    S.ledger.push({ id: uid(), profile: pid, pts: -r.cost, date: todayStr(), ref: 'reward:' + r.id, label: r.title });
    save(); toast(`🎉 ${profile(pid).name} canjea ${r.title}`); render();
  };
  if (who) return go(who);
  modal('¿Quién canjea?', [{ name: 'who', label: 'Perfil', type: 'select', options: profOpts() }], { onSave: v => go(v.who), saveLabel: 'Canjear' });
}

/* — Comidas — */
function viewMeals() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(mealWeek, i));
  const nav = h('div', { class: 'cal-head' }, h('h2', null, `Semana del ${days[0].getDate()} ${MONTHS[days[0].getMonth()]}`),
    h('button', { class: 'btn icon', onclick: () => { mealWeek = addDays(mealWeek, -7); render(); } }, '◀'),
    h('button', { class: 'btn', onclick: () => { mealWeek = mondayOf(new Date()); render(); } }, 'Hoy'),
    h('button', { class: 'btn icon', onclick: () => { mealWeek = addDays(mealWeek, 7); render(); } }, '▶'),
    h('button', { class: 'btn primary', onclick: () => { let n = 0; days.forEach(d => Object.values(S.meals[iso(d)] || {}).forEach(m => n += mealToGroceries(m))); save(); toast(`🛒 ${n} ingredientes añadidos`); render(); } }, '🛒 Semana → compra'));
  const table = h('div', { class: 'scroll-x' }, h('table', { class: 'meal-table' }, h('thead', null, h('tr', null, h('th'), days.map(d => h('th', null, d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' }))))),
    h('tbody', null, ['desayuno', 'comida', 'cena'].map(s => h('tr', null, h('td', { class: 'label' }, s), days.map(d => {
      const ds = iso(d), m = (S.meals[ds] || {})[s];
      return h('td', { class: 'slot' + (ds === todayStr() ? ' today' : ''), onclick: () => mealForm(ds, s) },
        m ? [m.title, m.url && h('a', { href: m.url, target: '_blank', rel: 'noopener', onclick: e => e.stopPropagation() }, ' ▶')] : h('span', { class: 'muted' }, '+'));
    }))))));
  const groc = h('section', { class: 'card' }, h('h2', null, '🛒 ', h('span', { class: 'grow' }, 'Lista de la compra'),
    h('button', { class: 'btn small', onclick: () => { S.groceries = S.groceries.filter(g => !g.done); save(); render(); } }, 'Quitar marcados')),
    S.groceries.length ? S.groceries.map(g => checkRow(g.text, g.done, () => { g.done = !g.done; save(); render(); }, h('button', { class: 'btn small', title: 'Pasar a la despensa', onclick: () => { S.groceries = S.groceries.filter(x => x !== g); if (!S.pantry.some(p => p.text.toLowerCase() === g.text.toLowerCase())) S.pantry.push({ id: uid(), text: g.text }); save(); render(); } }, '→ 🥫'))) : h('div', { class: 'empty' }, 'Vacía.'),
    addInput('Añadir producto', t => { addGrocery(t); save(); render(); }));
  const pantry = h('section', { class: 'card' }, h('h2', null, '🥫 Despensa'), h('div', { class: 'muted', style: { fontSize: '.85rem' } }, 'Lo que ya tienes no se añade a la compra desde los menús.'),
    S.pantry.length ? S.pantry.map(p => h('div', { class: 'row' }, h('span', { class: 'grow' }, p.text), h('button', { class: 'btn small', onclick: () => { S.pantry = S.pantry.filter(x => x !== p); save(); render(); } }, '✕'))) : h('div', { class: 'empty' }, 'Sin artículos.'),
    addInput('Añadir a la despensa', t => { S.pantry.push({ id: uid(), text: t }); save(); render(); }));
  return h('div', null, head('Comidas y compra'), nav, table, h('div', { class: 'grid', style: { marginTop: '16px' } }, groc, pantry));
}

/* — Listas — */
function viewLists() {
  const cards = S.lists.map(l => h('section', { class: 'card' }, h('h2', null, h('span', { class: 'grow' }, l.name), h('button', { class: 'btn small', onclick: () => { l.items = l.items.filter(i => !i.done); save(); render(); } }, 'Limpiar'),
    h('button', { class: 'btn small danger', onclick: () => { if (confirm(`¿Eliminar la lista «${l.name}»?`)) { S.lists = S.lists.filter(x => x !== l); save(); render(); } } }, '🗑')),
    l.items.length ? l.items.map(i => checkRow(i.text, i.done, () => { i.done = !i.done; save(); render(); })) : h('div', { class: 'empty' }, 'Lista vacía.'),
    addInput('Añadir elemento', t => { l.items.push({ id: uid(), text: t, done: false }); save(); render(); })));
  return h('div', null, head('Listas', h('button', { class: 'btn primary', onclick: () => modal('Nueva lista', [{ name: 'name', label: 'Nombre', required: true, placeholder: 'Pendientes, regalos, maleta…' }], { onSave: v => S.lists.push({ id: uid(), name: v.name, items: [] }) }) }, '+ Nueva lista')),
    cards.length ? h('div', { class: 'grid' }, cards) : h('div', { class: 'empty' }, 'Crea listas de cosas pendientes, regalos, viajes…'));
}

/* — Fotos — */
function viewPhotos() {
  const grid = h('div', { class: 'photos' }), file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const refresh = async () => {
    let all = []; try { all = await photoDB.all(); } catch (e) { /* sin IndexedDB */ }
    grid.replaceChildren(...(all.length ? all.map(p => h('div', { class: 'photo' }, h('img', { src: URL.createObjectURL(p.blob), alt: p.name, loading: 'lazy' }),
      h('button', { 'aria-label': 'Borrar', onclick: async () => { await photoDB.del(p.id); S.photos = S.photos.filter(x => x.id !== p.id); if (typeof noteDeletedPhoto === 'function') noteDeletedPhoto(p.id); save(); refresh(); } }, '✕'))) : [h('div', { class: 'empty' }, 'Sube fotos para el salvapantallas.')]));
  };
  file.addEventListener('change', async () => {
    for (const f of file.files) { try { const id = uid(); await photoDB.put({ id, name: f.name, blob: await shrink(f) }); S.photos.push({ id, name: f.name }); } catch (e) { toast('No se pudo subir ' + f.name); } }
    save(); file.value = ''; refresh();
  });
  refresh();
  return h('div', null, head('Fotos', h('button', { class: 'btn', onclick: startSaver }, '▶ Probar salvapantallas'), h('button', { class: 'btn primary', onclick: () => file.click() }, '+ Subir fotos')), file,
    h('p', { class: 'muted' }, `Se muestran como salvapantallas tras ${S.settings.saverMin} min sin tocar la pantalla. Si sincronizas, las fotos se comparten entre vuestros dispositivos.`), grid);
}

/* — Ajustes — */
function viewSettings() {
  const st = S.settings, set = (k, v) => { st[k] = v; save(); applyTheme(); };
  const field = (label, el) => h('label', { class: 'field', style: { marginBottom: '10px' } }, h('span', null, label), el);
  const sel = (opts, val, fn) => { const s = h('select', null, opts.map(([v, l]) => h('option', { value: v }, l))); s.value = val; s.onchange = () => fn(s.value); return s; };
  const inp = (type, val, fn, extra) => { const i = h('input', { type, ...(extra || {}) }); i.value = val; i.onchange = () => fn(i.value); return i; };
  const profiles = h('section', { class: 'card' }, h('h2', null, '👪 ', h('span', { class: 'grow' }, 'Perfiles (máx. 8)'), h('button', { class: 'btn small primary', disabled: S.profiles.length >= 8, onclick: () => modal('Nuevo perfil', [{ name: 'name', label: 'Nombre', required: true }, { name: 'color', label: 'Color', type: 'color', value: COLORS[S.profiles.length % 8] }], { onSave: v => S.profiles.push({ id: uid(), ...v }) }) }, '+ Perfil')),
    S.profiles.map(p => h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: p.color } }), h('span', { class: 'grow' }, p.name),
      h('button', { class: 'btn small', onclick: () => modal('Editar perfil', [{ name: 'name', label: 'Nombre', value: p.name, required: true }, { name: 'color', label: 'Color', type: 'color', value: p.color }], { onSave: v => Object.assign(p, v), onDelete: S.profiles.length > 1 ? (() => { S.profiles = S.profiles.filter(x => x !== p); }) : null }) }, '✏️'))));
  const look = h('section', { class: 'card' }, h('h2', null, '🎨 Aspecto y pantalla'),
    field('Tema', sel([['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], st.theme, v => set('theme', v))),
    field('Color principal', inp('color', st.accent, v => set('accent', v))),
    field('Salvapantallas tras (minutos, 0 = nunca)', inp('number', st.saverMin, v => { set('saverMin', Math.max(0, +v)); resetIdle(); }, { min: 0, max: 120 })),
    field('Hora de dormir (pantalla en reposo)', inp('time', st.bedtime, v => set('bedtime', v))),
    field('Hora de despertar', inp('time', st.wake, v => set('wake', v))));
  const place = h('section', { class: 'card' }, h('h2', null, '🌤️ Ubicación del tiempo'), h('div', { class: 'muted', style: { marginBottom: '8px' } }, `Ahora: ${st.city}`),
    addInput('Buscar ciudad (p. ej. Sevilla)', async q => {
      try {
        const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=es`)).json();
        if (!r.results) return toast('Ciudad no encontrada');
        const c = r.results[0]; Object.assign(st, { city: c.name, lat: c.latitude, lon: c.longitude }); weatherCache = null; save(); render();
      } catch (e) { toast('Sin conexión'); }
    }));
  const data = h('section', { class: 'card' }, h('h2', null, '💾 Datos y copias'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => download(`pizarra-copia-${todayStr()}.json`, JSON.stringify(S, null, 1), 'application/json') }, '⬇ Copia de seguridad (JSON)'),
      h('button', { class: 'btn', onclick: () => pickFile('.json,application/json', t => { try { const d = JSON.parse(t); if (!d.profiles) throw 0; S = { ...defaults(), ...d }; save(); applyTheme(); toast('Copia restaurada'); render(); } catch (e) { toast('Archivo no válido'); } }) }, '⬆ Restaurar')),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => download('pizarra.ics', buildICS(), 'text/calendar') }, '📅 Exportar calendario (.ics)'),
      h('button', { class: 'btn', onclick: () => pickFile('.ics,text/calendar', t => { const ev = parseICS(t); S.events.push(...ev); save(); toast(`${ev.length} eventos importados`); render(); }) }, '📥 Importar .ics')),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, h('input', { id: 'icsurl', placeholder: 'URL de calendario .ics (Google, iCloud…)' })),
      h('button', { class: 'btn', onclick: async () => { const u = $('#icsurl').value.trim(); if (!u) return; try { const ev = parseICS(await (await fetch(u)).text()); S.events.push(...ev); save(); toast(`${ev.length} eventos importados`); render(); } catch (e) { toast('No se pudo leer (el servidor puede bloquear el acceso). Descarga el .ics e impórtalo.'); } } }, 'Importar')),
    h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { if (confirm('Se borrarán TODOS los datos de este dispositivo.') && confirm('¿Seguro?')) { localStorage.removeItem(KEY); S = defaults(); applyTheme(); render(); } } }, '🗑 Borrar todo')));
  const install = h('section', { class: 'card' }, h('h2', null, '📲 Instalar'), h('p', { class: 'muted' }, 'Funciona en móvil, tableta, ordenador y pantallas táctiles con navegador. Instálala para usarla a pantalla completa y sin conexión.'),
    h('button', { class: 'btn primary', onclick: async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } else toast('Menú del navegador → «Instalar app» o «Añadir a pantalla de inicio»'); } }, 'Instalar app'),
    h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '.85rem' } }, 'Los datos se guardan en este dispositivo; usa la copia de seguridad para pasarlos a otro.'));
  return h('div', null, head('Ajustes'), h('div', { class: 'grid' }, syncCard(), profiles, look, place, data, install));
}
function pickFile(accept, cb) {
  const i = h('input', { type: 'file', accept }); i.onchange = () => i.files[0] && i.files[0].text().then(cb); i.click();
}

/* ───────────── Salvapantallas, reposo y modo pizarra ───────────── */
let idleT, saverOn = null, slideT, deferredInstall = null, sleepSnooze = 0;
function resetIdle() {
  clearTimeout(idleT);
  if (!saverOn && S.settings.saverMin > 0) idleT = setTimeout(startSaver, S.settings.saverMin * 6e4);
}
const inSleep = () => {
  const n = new Date(), m = n.getHours() * 60 + n.getMinutes(), t = s => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
  const b = t(S.settings.bedtime), w = t(S.settings.wake);
  return b === w ? false : b > w ? (m >= b || m < w) : (m >= b && m < w);
};
async function startSaver(sleep = false) {
  if (saverOn) return;
  const ov = $('#overlay'); ov.className = sleep === true ? 'sleep' : ''; ov.hidden = false; saverOn = sleep === true ? 'sleep' : 'photos';
  const clk = h('div', { class: 'oclock' }, h('b', null, ''), h('span', null, ''));
  const tick = () => { const n = new Date(); clk.firstChild.textContent = n.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); clk.lastChild.textContent = sleep === true ? '' : fmtLong(n); };
  tick(); ov.replaceChildren(clk); const clockT = setInterval(tick, 5000);
  let urls = [];
  if (sleep !== true) {
    try { urls = (await photoDB.all()).map(p => URL.createObjectURL(p.blob)); } catch (e) { /* sin fotos */ }
    if (urls.length) {
      let i = 0; const layers = [h('div', { class: 'bg' }), h('div', { class: 'bg' })]; ov.prepend(...layers);
      const show = () => { const l = layers[i % 2]; l.style.backgroundImage = `url(${urls[Math.floor(Math.random() * urls.length)]})`; l.classList.add('show'); layers[(i + 1) % 2].classList.remove('show'); i++; };
      show(); slideT = setInterval(show, 12000);
    }
  }
  ov.onclick = () => { clearInterval(clockT); clearInterval(slideT); ov.hidden = true; ov.replaceChildren(); urls.forEach(u => URL.revokeObjectURL(u)); if (saverOn === 'sleep') sleepSnooze = Date.now() + 30 * 6e4; saverOn = null; resetIdle(); };
}
async function kioskMode() {
  try { await document.documentElement.requestFullscreen(); } catch (e) { /* no soportado */ }
  try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); toast('Modo pizarra: pantalla siempre encendida'); } catch (e) { toast('Pantalla completa activada'); }
}
['pointerdown', 'keydown', 'wheel'].forEach(ev => addEventListener(ev, () => { if (!saverOn) resetIdle(); }, { passive: true }));
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'home') render(); });

function applyTheme() {
  const r = document.documentElement; r.dataset.theme = S.settings.theme;
  r.style.setProperty('--accent', S.settings.accent);
  const m = document.querySelector('meta[name=theme-color]'); m && m.setAttribute('content', S.settings.accent);
}

/* Reloj y comprobaciones periódicas */
setInterval(() => {
  const c = $('#clock'); const n = new Date();
  if (c) { c.textContent = n.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); const d = $('#date'); d && (d.textContent = fmtLong(n)); }
}, 1000);
setInterval(() => { if (!saverOn && inSleep() && Date.now() > sleepSnooze) startSaver(true); }, 30000);
setInterval(() => { if (view === 'home' && !document.querySelector('dialog[open]') && !saverOn) render(); }, 5 * 6e4);

/* Arranque */
applyTheme(); render(); resetIdle();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
