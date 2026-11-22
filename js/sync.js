'use strict';
/* Sincronización en la nube (Supabase) entre varios dispositivos.
   Sin cuentas: quien tenga el código secreto de la pizarra puede leerla y editarla.
   Cada dispositivo fusiona sus cambios con los remotos (fusión a tres bandas) para no pisarse. */

const SYNC_URL = 'https://ooagxaekxswwrhpsxpjd.supabase.co';
// Clave pública (anon): es seguro incluirla en el cliente; la tabla solo es accesible mediante funciones.
const SYNC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYWd4YWVreHN3d3JocHN4cGpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2NjA2NTEsImV4cCI6MjEwOTIzNjY1MX0.BlKNz66TRkLJZkE5uYzN9SeL0y4GzXVQZad7p7zogUM';
const SYNC_KEYS = ['profiles', 'events', 'chores', 'rewards', 'ledger', 'meals', 'groceries', 'pantry', 'lists'];
const CFG_KEY = 'pizarra.sync';

let syncCfg = (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; } })();
let syncBusy = false, syncTimer = null, syncStatus = syncCfg.code ? 'Pendiente de sincronizar…' : '';
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

/* — Comunicación — */
async function syncRpc(fn, body) {
  const r = await fetch(`${SYNC_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SYNC_KEY, Authorization: 'Bearer ' + SYNC_KEY }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status}`);
  return r.json();
}
function setSyncStatus(t) {
  syncStatus = t; const el = document.getElementById('sync-status'); if (el) el.textContent = t;
}
async function syncNow() {
  if (!syncCfg.code || syncBusy) return;
  if (!navigator.onLine) return setSyncStatus('Sin conexión: se sincronizará al volver');
  syncBusy = true; setSyncStatus('Sincronizando…');
  try {
    for (let i = 0; i < 4; i++) {
      const pull = await syncRpc('pf_pull', { p_code: syncCfg.code });
      const local = pickSync(S);
      const merged = pull.exists ? merge3(syncCfg.base || {}, local, pull.data) : local;
      let version = pull.version;
      if (!pull.exists || !sEq(merged, pull.data)) {
        const res = await syncRpc('pf_push', { p_code: syncCfg.code, p_data: merged, p_version: pull.version });
        if (!res.ok) continue; // alguien guardó entre medias: reintentar
        version = res.version;
      }
      const changed = !sEq(merged, local);
      if (changed) {
        Object.assign(S, merged);
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* lleno */ }
        if (!document.querySelector('dialog[open]')) render();
      }
      syncCfg.base = merged; syncCfg.version = version; syncCfg.last = Date.now(); saveCfg();
      return setSyncStatus('Sincronizado a las ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    }
    setSyncStatus('Conflicto: se reintentará');
  } catch (e) {
    setSyncStatus('No se pudo sincronizar (se reintentará)');
  } finally { syncBusy = false; }
}
function scheduleSync() {
  if (!syncCfg.code) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500);
}

/* — Crear / unirse / salir — */
const newCode = () => 'pf-' + Array.from(crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
const inviteLink = () => `${location.origin}${location.pathname}#join=${syncCfg.code}`;
function startSync(code) {
  syncCfg = { code, base: {} }; saveCfg(); syncNow().then(() => { render(); });
}
function createBoard() { startSync(newCode()); toast('Pizarra compartida creada'); }
function joinBoard(code) {
  code = (code || '').trim().replace(/^.*#join=/, '');
  if (code.length < 20) return toast('Código no válido');
  startSync(code); toast('Unido a la pizarra compartida');
}
function leaveBoard() {
  if (!confirm('Este dispositivo dejará de sincronizar. Tus datos locales se conservan.')) return;
  syncCfg = {}; saveCfg(); setSyncStatus(''); render();
}
async function copyText(t, ok) {
  try { await navigator.clipboard.writeText(t); toast(ok); } catch (e) { prompt('Copia este texto:', t); }
}

/* — Tarjeta de Ajustes — */
function syncCard() {
  const c = h('section', { class: 'card' }, h('h2', null, '☁️ Sincronizar con otro dispositivo'));
  if (!syncCfg.code) {
    c.append(h('p', { class: 'muted' }, 'Crea una pizarra compartida y pasa el enlace a tu pareja o familia: lo que apuntéis se verá en todos los dispositivos. No hacen falta cuentas.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: createBoard }, 'Crear pizarra compartida')),
      h('div', { class: 'add-row' }, h('input', { id: 'joincode', placeholder: 'Pega aquí el enlace o código que te han pasado' }),
        h('button', { class: 'btn', onclick: () => joinBoard(document.getElementById('joincode').value) }, 'Unirme')));
  } else {
    c.append(h('p', { class: 'muted', id: 'sync-status' }, syncStatus),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => copyText(inviteLink(), 'Enlace copiado') }, '🔗 Copiar enlace de invitación'),
        h('button', { class: 'btn', onclick: syncNow }, '🔄 Sincronizar ahora')),
      h('p', { class: 'muted', style: { fontSize: '.85rem' } }, 'Quien tenga el enlace puede ver y editar la pizarra: compártelo solo con quien quieras. Las fotos del salvapantallas no se sincronizan.'),
      h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: leaveBoard }, 'Dejar de sincronizar')));
  }
  return c;
}

/* — Arranque — */
addEventListener('online', syncNow);
addEventListener('focus', syncNow);
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
setInterval(syncNow, 20000);
(function init() {
  const m = location.hash.match(/^#join=(.+)$/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    if (!syncCfg.code || syncCfg.code !== m[1]) {
      if (confirm('¿Unirte a la pizarra compartida? Se combinarán sus datos con los de este dispositivo.')) { joinBoard(m[1]); return; }
    }
  }
  if (syncCfg.code) syncNow();
})();
