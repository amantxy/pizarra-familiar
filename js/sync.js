'use strict';
/* Sincronización en la nube (Supabase) entre varios dispositivos.
   Acceso con cuenta (email + contraseña): solo los emails autorizados en la base de datos
   pueden leer y escribir. Cada dispositivo fusiona sus cambios con los remotos (fusión a tres bandas). */

const SYNC_URL = 'https://ooagxaekxswwrhpsxpjd.supabase.co';
// Clave pública (anon): es seguro incluirla en el cliente; la tabla solo es accesible mediante funciones.
const SYNC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYWd4YWVreHN3d3JocHN4cGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2NjA2NTEsImV4cCI6MjEwOTIzNjY1MX0.BlKNz66TRkLJZkE5uYzN9SeL0y4GzXVQZad7p7zogUM';
const SYNC_KEYS = ['profiles', 'events', 'chores', 'rewards', 'ledger', 'meals', 'groceries', 'pantry', 'lists', 'settings', 'photos'];
const CFG_KEY = 'pizarra.sync';

let syncCfg = (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } })();
let syncBusy = false, syncTimer = null, syncStatus = syncCfg.session ? 'Pendiente de sincronizar…' : '';
const saveCfg = () => localStorage.setItem(CFG_KEY, JSON.stringify(syncCfg));
const pickSync = s => JSON.parse(JSON.stringify(Object.fromEntries(SYNC_KEYS.map(k => [k, s[k]]))));

/* — Fusión a tres bandas: base (última sincronización), local y remoto — */
const sEq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const sObj = v => v && typeof v === 'object' && !Array.isArray(v);
const sIdArr = a => Array.isArray(a) && a.every(x => sObj(x) && x.id);
function mergeKey(inB, bv, inL, lv, inR, rv, rec) {
  if (!inL && !inR) return { skip: true };
  if (!inL) return inB && sEq(bv, rv) ? { skip: true } : { v: rv };   // borrado aquí
  if (!inR) return inB && sEq(bv, lv) ? { skip: true } : { v: lv };   // borrado allí
  return { v: rec(bv, lv, rv) };
}
function merge3(b, l, r) {
  if (sEq(l, r)) return l;
  if (sEq(b, l)) return r;
  if (sEq(b, r)) return l;
  if (sObj(l) && sObj(r)) {
    const bb = sObj(b) ? b : {}, out = {};
    for (const k of new Set([...Object.keys(l), ...Object.keys(r), ...Object.keys(bb)])) {
      const m = mergeKey(k in bb, bb[k], k in l, l[k], k in r, r[k], merge3);
      if (!m.skip) out[k] = m.v;
    }
    return out;
  }
  if (sIdArr(l) && sIdArr(r)) {
    const mp = a => new Map((Array.isArray(a) ? a : []).filter(x => x && x.id).map(x => [x.id, x]));
    const B = mp(b), L = mp(l), R = mp(r), out = [];
    for (const id of [...L.keys(), ...[...R.keys()].filter(k => !L.has(k))]) {
      const m = mergeKey(B.has(id), B.get(id), L.has(id), L.get(id), R.has(id), R.get(id), merge3);
      if (!m.skip) out.push(m.v);
    }
    return out;
  }
  return l; // conflicto sobre el mismo dato: gana este dispositivo
}

/* — Autenticación y peticiones — */
const sErr = (e, fallback) => {
  const m = (e && e.body && (e.body.msg || e.body.error_description || e.body.message)) || '';
  if (/invalid login/i.test(m)) return 'Email o contraseña incorrectos';
  if (/not confirmed/i.test(m)) return 'Aún no has confirmado el email: revisa tu correo';
  if (/already registered/i.test(m)) return 'Ese email ya tiene cuenta: inicia sesión';
  if (/password/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres';
  if (/rate limit/i.test(m)) return 'Demasiados intentos: espera unos minutos';
  return m || fallback;
};
async function sFetch(path, { method = 'POST', body, headers = {}, auth = true, raw = false } = {}) {
  const token = auth ? await ensureToken() : null;
  const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;
  const r = await fetch(SYNC_URL + path, {
    method, body: body === undefined ? undefined : isBlob ? body : JSON.stringify(body),
    headers: { apikey: SYNC_KEY, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined && !isBlob ? { 'Content-Type': 'application/json' } : {}), ...headers }
  });
  if (!r.ok) { const e = new Error(path + ': ' + r.status); e.status = r.status; try { e.body = await r.json(); } catch (x) { /* sin cuerpo */ } throw e; }
  return raw ? r : r.json().catch(() => ({}));
}
function storeSession(j) {
  syncCfg.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || (syncCfg.session && syncCfg.session.email) };
  saveCfg();
}
async function ensureToken() {
  const s = syncCfg.session; if (!s) return null;
  if (s.expires_at - 60000 > Date.now()) return s.access_token;
  try { storeSession(await sFetch('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token }, auth: false })); }
  catch (e) { if (e.status && e.status < 500) { delete syncCfg.session; saveCfg(); } throw e; }
  return syncCfg.session.access_token;
}
async function signIn(email, pw) {
  try { storeSession(await sFetch('/auth/v1/token?grant_type=password', { body: { email: email.trim(), password: pw }, auth: false })); syncCfg.base = syncCfg.base || {}; saveCfg(); toast('Sesión iniciada'); syncNow().then(render); render(); }
  catch (e) { toast(sErr(e, 'No se pudo iniciar sesión')); }
}
async function signUp(email, pw) {
  try {
    const j = await sFetch('/auth/v1/signup?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { body: { email: email.trim(), password: pw }, auth: false });
    if (j.access_token) { storeSession(j); syncNow().then(render); render(); } else toast('Cuenta creada: confirma el email que te hemos enviado y luego inicia sesión');
  } catch (e) { toast(sErr(e, 'No se pudo crear la cuenta')); }
}
async function recover(email) {
  if (!email.trim()) return toast('Escribe tu email primero');
  try { await sFetch('/auth/v1/recover', { body: { email: email.trim() }, auth: false }); toast('Te hemos enviado un email para cambiar la contraseña'); }
  catch (e) { toast(sErr(e, 'No se pudo enviar el email')); }
}
function signOut() {
  if (!confirm('Este dispositivo dejará de sincronizar. Tus datos locales se conservan.')) return;
  syncCfg = {}; saveCfg(); setSyncStatus(''); render();
}

/* — Sincronización de datos — */
function setSyncStatus(t) {
  syncStatus = t; const el = document.getElementById('sync-status'); if (el) el.textContent = t;
}
const rpc = (fn, body) => sFetch('/rest/v1/rpc/' + fn, { body });
async function syncNow() {
  if (!syncCfg.session || syncBusy) return;
  if (!navigator.onLine) return setSyncStatus('Sin conexión: se sincronizará al volver');
  syncBusy = true; setSyncStatus('Sincronizando…');
  try {
    for (let i = 0; i < 4; i++) {
      const pull = await rpc('pf_pull', {});
      const local = pickSync(S);
      const merged = pull.exists ? merge3(syncCfg.base || {}, local, pull.data) : local;
      let version = pull.version;
      if (!pull.exists || !sEq(merged, pull.data)) {
        const res = await rpc('pf_push', { p_data: merged, p_version: pull.version });
        if (!res.ok) continue; // alguien guardó entre medias: reintentar
        version = res.version;
      }
      if (!sEq(merged, local)) {
        Object.assign(S, merged);
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* lleno */ }
        if (!document.querySelector('dialog[open]')) render();
      }
      syncCfg.base = merged; syncCfg.version = version; saveCfg();
      await syncPhotos();
      return setSyncStatus('Sincronizado a las ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    }
    setSyncStatus('Conflicto: se reintentará');
  } catch (e) {
    setSyncStatus(e.status === 403 || (e.body && e.body.code === '42501') ? 'Tu email no está autorizado en esta pizarra' : e.status === 401 || !syncCfg.session ? 'Sesión caducada: inicia sesión otra vez' : 'No se pudo sincronizar (se reintentará)');
  } finally { syncBusy = false; }
}
function scheduleSync() {
  if (!syncCfg.session) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500);
}

/* — Fotos: el índice va en el estado; los archivos, en almacenamiento privado — */
function noteDeletedPhoto(id) { if (!syncCfg.session) return; (syncCfg.pendingDel = syncCfg.pendingDel || []).push(id); saveCfg(); }
async function syncPhotos() {
  try {
    S.photos = S.photos || [];
    const local = await photoDB.all(); const ids = new Set(local.map(p => p.id));
    let dirty = false;
    for (const p of local) if (!S.photos.some(x => x.id === p.id)) { S.photos.push({ id: p.id, name: p.name }); dirty = true; }
    const up = new Set(syncCfg.uploaded || []);
    for (const p of S.photos) {
      if (ids.has(p.id) && !up.has(p.id)) {
        const rec = local.find(x => x.id === p.id);
        await sFetch(`/storage/v1/object/pf-photos/${p.id}.jpg`, { body: rec.blob, headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' } }); up.add(p.id);
      } else if (!ids.has(p.id)) {
        const r = await sFetch(`/storage/v1/object/authenticated/pf-photos/${p.id}.jpg`, { method: 'GET', raw: true });
        await photoDB.put({ id: p.id, name: p.name, blob: await r.blob() }); up.add(p.id); ids.add(p.id); dirty = 'view';
      }
    }
    const keep = new Set(S.photos.map(p => p.id));
    for (const id of [...ids]) if (!keep.has(id) && up.has(id)) { await photoDB.del(id); dirty = 'view'; }
    for (const id of syncCfg.pendingDel || []) { try { await sFetch(`/storage/v1/object/pf-photos/${id}.jpg`, { method: 'DELETE' }); } catch (e) { /* ya no existe */ } }
    syncCfg.pendingDel = []; syncCfg.uploaded = [...up].filter(id => keep.has(id)); saveCfg();
    if (dirty === true) save();
    if (dirty === 'view' && view === 'photos' && !document.querySelector('dialog[open]')) render();
  } catch (e) { /* las fotos se reintentan en la siguiente sincronización */ }
}

/* — Tarjeta de Ajustes — */
function syncCard() {
  const c = h('section', { class: 'card' }, h('h2', null, '☁️ Sincronización entre dispositivos'));
  if (!syncCfg.session) {
    const em = h('input', { type: 'email', placeholder: 'Tu email', autocomplete: 'email' }), pw = h('input', { type: 'password', placeholder: 'Contraseña (mín. 6)', autocomplete: 'current-password' });
    c.append(h('p', { class: 'muted' }, 'Inicia sesión para sincronizar todo (calendario, tareas, comidas, compra, listas, fotos y ajustes). Solo pueden entrar los emails autorizados.'),
      h('div', { class: 'field' }, em), h('div', { class: 'field', style: { marginTop: '8px' } }, pw),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => signIn(em.value, pw.value) }, 'Iniciar sesión'),
        h('button', { class: 'btn', onclick: () => signUp(em.value, pw.value) }, 'Crear cuenta'),
        h('button', { class: 'btn small', onclick: () => recover(em.value) }, '¿Olvidaste la contraseña?')));
  } else {
    c.append(h('p', { class: 'muted' }, 'Sesión: ' + (syncCfg.session.email || '')), h('p', { class: 'muted', id: 'sync-status' }, syncStatus),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: syncNow }, '🔄 Sincronizar ahora'), h('button', { class: 'btn danger', onclick: signOut }, 'Cerrar sesión')));
  }
  return c;
}

/* — Arranque — */
addEventListener('online', syncNow);
addEventListener('focus', syncNow);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
setInterval(syncNow, 20000);
if (syncCfg.session) syncNow();
