'use strict';
/* ===== Configuración ===== */
const SLOTS = [
  { id: 'antes',   label: 'ANTES',        req: true },
  { id: 'despues', label: 'DESPUÉS',      req: true },
  { id: 'corr1',   label: 'CORRECCIÓN 1', req: true },
  { id: 'corr2',   label: 'CORRECCIÓN 2', req: true },
  { id: 'adic1',   label: 'ADICIONAL 1',  req: true },
  { id: 'adic2',   label: 'ADICIONAL 2',  req: true },
  { id: 'adic3',   label: 'ADICIONAL 3',  req: false },
  { id: 'adic4',   label: 'ADICIONAL 4',  req: false },
];
const MAX_PX = 1280, JPG_Q = 0.8;
const NOVEDAD = ['04011105400', '04100205400', '01421612000']; // cable de cobre y varilla
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ===== IndexedDB ===== */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('campo-eersa-galeria', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('orders', { keyPath: 'orden' });
      d.createObjectStore('works', { keyPath: 'orden' });
      d.createObjectStore('photos', { keyPath: 'key' });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const dbGet = (s, k) => rq(db.transaction(s).objectStore(s).get(k));
const dbAll = (s) => rq(db.transaction(s).objectStore(s).getAll());
const dbPut = (s, v, k) => rq(db.transaction(s, 'readwrite').objectStore(s).put(v, k));
const dbDel = (s, k) => rq(db.transaction(s, 'readwrite').objectStore(s).delete(k));
const dbPhotosOf = (orden) => rq(db.transaction('photos').objectStore('photos').getAll(IDBKeyRange.bound(orden + '|', orden + '|￿')));

/* ===== CSV ===== */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
function parseMateriales(s) {
  const out = [], re = /(\d+(?:[.,]\d+)?)\s*(UNIDAD|METRO)\s*\|\s*(.*?)\s*\|\s*(\d+)/gi; let m;
  while ((m = re.exec(s || ''))) {
    out.push({ code: m[4], desc: m[3].replace(/\s+/g, ' ').trim(), unit: m[2].toUpperCase() === 'METRO' ? 'm' : 'un', qty: parseFloat(m[1].replace(',', '.')) });
  }
  return out;
}
function csvToOrders(text) {
  const rows = parseCSV(text); const h = rows[0].map((x) => x.trim());
  const ix = (n) => h.indexOf(n);
  const need = ['Orden', 'Medidor', 'Cuenta', 'Materiales'];
  const miss = need.filter((n) => ix(n) < 0);
  if (miss.length) throw new Error('Faltan columnas en el CSV: ' + miss.join(', '));
  const g = (r, n) => (ix(n) >= 0 ? (r[ix(n)] || '').trim() : '');
  const out = [];
  for (const r of rows.slice(1)) {
    const orden = g(r, 'Orden'); if (!orden) continue;
    out.push({
      orden, medidor: g(r, 'Medidor'), cuenta: g(r, 'Cuenta'), cliente: g(r, 'Nombre cliente'),
      fechaEj: g(r, 'Fecha de ejecucion'), mru: g(r, 'MRU'), tecnico: g(r, 'Nombre tecnico'),
      actividades: g(r, 'Actividades'), mats: parseMateriales(g(r, 'Materiales')),
    });
  }
  return out;
}

/* ===== Utilidades ===== */
const hoy = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const validMat = (v) => /^(ok|\d+([.,]\d+)?)$/i.test(String(v ?? '').trim());
const matOk = (code, v) => (NOVEDAD.includes(code) ? validMat(v) : /^ok$/i.test(String(v ?? '').trim()));
const slotLabel = (id) => (SLOTS.find((s) => s.id === id) || {}).label || id;
function modal(title, html, btns) {
  return new Promise((res) => {
    $('#mTitle').textContent = title; $('#mBody').innerHTML = html; const b = $('#mBtns'); b.innerHTML = '';
    btns.forEach(([txt, val, cls]) => { const x = document.createElement('button'); x.className = 'btn ' + (cls || ''); x.textContent = txt; x.onclick = () => { $('#modal').hidden = true; res(val); }; b.appendChild(x); });
    $('#modal').hidden = false;
  });
}
const aviso = (t, lines) => modal(t, Array.isArray(lines) ? '<ul>' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>' : esc(lines), [['Entendido', true, 'primary']]);
const busy = (on) => { $('#busy').hidden = !on; };
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 20000);
}

/* ===== GPS ===== */
let gps = null, gpsWatch = null, gpsErr = null;
function updGps() {
  const c = $('#gpsChip'); c.hidden = false;
  const cg = $('#camGps'); if (cg) cg.textContent = gps ? 'GPS ±' + Math.round(gps.acc) + ' m' : (gpsErr === 1 ? 'GPS sin permiso' : 'Buscando GPS…');
  if (gpsErr === 1) { c.className = 'chip bad'; c.textContent = 'GPS sin permiso'; return; }
  if (!gps) { c.className = 'chip warn'; c.textContent = 'Buscando GPS…'; return; }
  c.className = 'chip ' + (gps.acc <= 25 ? 'ok' : 'warn'); c.textContent = 'GPS ±' + Math.round(gps.acc) + ' m';
}
function startGPS() {
  if (!navigator.geolocation || gpsWatch != null) return; updGps();
  gpsWatch = navigator.geolocation.watchPosition(
    (p) => { gpsErr = null; gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }; updGps(); },
    (e) => { gpsErr = e.code; updGps(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
}
function stopGPS() { if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; gps = null; $('#gpsChip').hidden = true; }
function getFix() {
  return new Promise((res) => {
    if (gps && Date.now() - gps.ts < 45000) return res(gps);
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      (p) => { gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }; updGps(); res(gps); },
      () => res(gps && Date.now() - gps.ts < 180000 ? gps : null), { enableHighAccuracy: true, timeout: 9000, maximumAge: 0 });
  });
}
const fmtCoord = (f) => (f ? f.lat.toFixed(6) + ', ' + f.lon.toFixed(6) : 'SIN GPS');


/* ===== Coordenadas desde la foto de galería (EXIF) ===== */
function parseTiffGps(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p) => v.getUint16(p, le), u32 = (p) => v.getUint32(p, le);
  if (u16(t + 2) !== 42) return null;
  const ifd0 = t + u32(t + 4); let gpsOff = null;
  for (let i = 0, n = u16(ifd0); i < n; i++) { const e = ifd0 + 2 + i * 12; if (u16(e) === 0x8825) gpsOff = t + u32(e + 8); }
  if (gpsOff == null) return null;
  const g = {};
  for (let i = 0, n = u16(gpsOff); i < n; i++) {
    const e = gpsOff + 2 + i * 12, tag = u16(e);
    if (tag === 1 || tag === 3) g[tag] = String.fromCharCode(v.getUint8(e + 8));
    if (tag === 2 || tag === 4) {
      const o = t + u32(e + 8); const r = (k) => u32(o + k * 8) / (u32(o + k * 8 + 4) || 1);
      g[tag] = r(0) + r(1) / 60 + r(2) / 3600;
    }
  }
  if (g[2] == null || g[4] == null) return null;
  const lat = g[1] === 'S' ? -g[2] : g[2], lon = g[3] === 'W' ? -g[4] : g[4];
  if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, acc: null, ts: Date.now() };
}
async function readExifGps(file) {
  try {
    const v = new DataView(await file.slice(0, 262144).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o), len = v.getUint16(o + 2);
      if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return parseTiffGps(v, o + 10);
      if ((m & 0xFF00) !== 0xFF00 || m === 0xFFDA) break;
      o += 2 + len;
    }
  } catch (_) { /* sin EXIF */ }
  return null;
}

/* ===== Imagen + marca de agua ===== */
async function loadBitmap(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); });
  }
}
async function stampPhoto(file, rotulo, o, fix) {
  const bmp = await loadBitmap(file);
  const sw = bmp.width, sh = bmp.height, k = Math.min(1, MAX_PX / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, w, h);
  const lines = [rotulo, 'Número de orden: ' + o.orden, 'Número de medidor: ' + o.medidor, 'Coordenadas: ' + fmtCoord(fix) + (fix && fix.note ? ' (' + fix.note + ')' : '')];
  if (o.cuenta) lines.push('Cuenta contrato: ' + o.cuenta);
  const fs = Math.max(14, Math.round(Math.min(w, h) / 24)), pad = Math.round(fs * 0.5), lh = Math.round(fs * 1.3);
  const bh = lines.length * lh + pad * 2;
  x.fillStyle = 'rgba(0,0,0,0.62)'; x.fillRect(0, h - bh, w, bh);
  x.textBaseline = 'top';
  lines.forEach((t, i) => {
    x.font = (i === 0 ? 'bold ' : '') + fs + 'px sans-serif';
    x.fillStyle = i === 0 ? '#ffd54a' : '#ffffff';
    x.fillText(t, pad, h - bh + pad + i * lh, w - pad * 2);
  });
  if (bmp.close) bmp.close();
  return await new Promise((res) => c.toBlob(res, 'image/jpeg', JPG_Q));
}
async function shrink(blob, maxW) {
  const bmp = await loadBitmap(blob); const k = Math.min(1, maxW / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.7));
  return { data: new Uint8Array(await b.arrayBuffer()), w, h };
}

/* ===== Estado ===== */
let ORDERS = [], WORKS = {}, filtro = 'todas', cur = null; // cur = {o, w}
const orderMap = () => Object.fromEntries(ORDERS.map((o) => [o.orden, o]));
async function loadAll() {
  ORDERS = (await dbAll('orders')).sort((a, b) => Number(a.orden) - Number(b.orden)); WORKS = Object.fromEntries((await dbAll('works')).map((w) => [w.orden, w]));
}
const saveWork = (w) => { WORKS[w.orden] = w; return dbPut('works', w); };
function faltantes(o, w) {
  const m = [];
  if (!w.ejecutor || w.ejecutor === 'Nadie') m.push('Elegir "Ejecutado por" (Alcocer o Garcés)');
  SLOTS.filter((s) => s.req && !w.fotos[s.id]).forEach((s) => m.push('Falta la foto: ' + s.label));
  Object.entries(w.fotos).forEach(([id, f]) => { if (!f.ok) m.push('Foto sin coordenadas, vuelve a tomarla: ' + slotLabel(id)); });
  o.mats.forEach((x) => { if (!matOk(x.code, w.mats[x.code])) m.push((NOVEDAD.includes(x.code) ? 'Material sin llenar (número u OK): ' : 'Material sin confirmar (marcar OK): ') + x.desc.slice(0, 38)); });
  return m;
}

/* ===== Vista: lista ===== */
function renderCsvBox() {
  const n = ORDERS.length;
  $('#csvBox').innerHTML = n
    ? `<b>${n} órdenes cargadas.</b> <button class="btn small" id="btnCsv">Cargar otro CSV</button>`
    : `<b>Aún no hay órdenes.</b><p class="muted">Carga el CSV con las órdenes del día para empezar.</p><button class="btn primary" id="btnCsv">Cargar CSV</button>`;
  $('#btnCsv').onclick = () => $('#csvIn').click();
  $('#listBox').hidden = !n;
}
function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  const est = (o) => (WORKS[o.orden] ? (WORKS[o.orden].estado === 'completa' ? 'ok' : 'curso') : 'pend');
  const items = ORDERS.filter((o) => (filtro === 'todas' || est(o) === filtro) && (!q || (o.orden + ' ' + o.medidor + ' ' + o.cuenta).toLowerCase().includes(q)));
  $('#list').innerHTML = items.slice(0, 150).map((o) => {
    const e = est(o);
    return `<div class="item" data-o="${esc(o.orden)}"><div><b>Orden ${esc(o.orden)}</b><div class="muted">Medidor ${esc(o.medidor)}</div></div><span class="badge ${e}">${{ ok: 'Completa', curso: 'En curso', pend: 'Pendiente' }[e]}</span></div>`;
  }).join('') + (items.length > 150 ? `<p class="muted">Mostrando 150 de ${items.length}. Usa el buscador.</p>` : '') + (items.length ? '' : '<p class="muted">Sin resultados.</p>');
  $('#list').querySelectorAll('.item').forEach((el) => (el.onclick = () => openOrder(el.dataset.o)));
}

/* ===== Vista: orden ===== */
async function openOrder(orden) {
  const o = orderMap()[orden]; if (!o) return;
  let w = WORKS[orden] || { orden, estado: 'en_curso', ejecutor: 'Nadie', mats: {}, fotos: {}, fecha: null, descargada: false, abierta: Date.now() };
  // Reconciliar fotos guardadas por si hubo un cierre inesperado
  const ph = await dbPhotosOf(orden);
  ph.forEach((p) => { if (!w.fotos[p.slot]) w.fotos[p.slot] = { ts: p.ts, lat: p.lat, lon: p.lon, ok: p.ok }; });
  if (w.estado === 'completa') { w = { ...w, estado: 'en_curso' }; }
  await saveWork(w); await dbPut('kv', orden, 'activa');
  cur = { o, w };
  $('#viewHome').hidden = true; $('#viewOrden').hidden = false; window.scrollTo(0, 0);
  history.pushState({ orden: 1 }, '');
  startGPS(); renderOrder(); await renderPhotos();
}
function renderOrder() {
  const { o, w } = cur;
  $('#oNum').textContent = o.orden; $('#oMed').textContent = o.medidor;
  $('#oExtra').textContent = [o.cuenta && 'Cuenta contrato: ' + o.cuenta, o.cliente, o.actividades].filter(Boolean).join(' · ');
  $('#ejecutor').value = w.ejecutor || 'Nadie';
  $('#mats tbody').innerHTML = o.mats.map((m) => {
    const v = w.mats[m.code] ?? '';
    const nov = NOVEDAD.includes(m.code);
    const ctl = nov
      ? `<div class="matIn"><input class="mat" data-c="${m.code}" inputmode="text" autocomplete="off" value="${esc(v)}" placeholder="# u OK"><button data-ok="${m.code}">OK</button></div>`
      : `<button class="okbtn ${/^ok$/i.test(v) ? 'on' : ''}" data-tog="${m.code}">${/^ok$/i.test(v) ? '✔ OK' : 'OK'}</button>`;
    return `<tr class="${nov ? 'nov' : ''}"><td>${esc(m.desc)}<div class="muted small">${esc(m.code)}</div></td><td class="q">${m.qty} ${m.unit}</td><td>${ctl}</td></tr>`;
  }).join('');
  $('#mats').querySelectorAll('input.mat').forEach((i) => (i.oninput = onMatInput));
  $('#mats').querySelectorAll('button[data-ok]').forEach((b) => (b.onclick = () => { const i = $(`input.mat[data-c="${b.dataset.ok}"]`); i.value = 'OK'; onMatInput({ target: i }); }));
  $('#mats').querySelectorAll('button[data-tog]').forEach((b) => (b.onclick = () => {
    const on = !/^ok$/i.test(cur.w.mats[b.dataset.tog] ?? ''); cur.w.mats[b.dataset.tog] = on ? 'OK' : '';
    b.classList.toggle('on', on); b.textContent = on ? '✔ OK' : 'OK'; saveWork(cur.w);
  }));
  $('#faltan').hidden = true;
}
let tMat;
function onMatInput(e) {
  const i = e.target, v = i.value.trim();
  i.classList.toggle('bad', v !== '' && !validMat(v));
  cur.w.mats[i.dataset.c] = v;
  clearTimeout(tMat); const wk = cur.w; tMat = setTimeout(() => saveWork(wk), 250);
}
async function renderPhotos() {
  const { o, w } = cur; const ph = Object.fromEntries((await dbPhotosOf(o.orden)).map((p) => [p.slot, p]));
  const n = SLOTS.filter((s) => s.req && w.fotos[s.id]).length;
  $('#fotoCount').textContent = `(${n}/6 obligatorias · ${Object.keys(w.fotos).length} en total)`;
  $('#grid').innerHTML = SLOTS.map((s) => {
    const p = ph[s.id];
    if (!p) return `<button class="tile ${s.req ? 'req' : 'opt'}" data-s="${s.id}">📷<br>${s.label}${s.req ? '' : '<br><small>(opcional)</small>'}</button>`;
    const url = URL.createObjectURL(p.blob);
    return `<button class="tile ${p.ok ? 'done' : 'nogps'}" data-s="${s.id}"><img src="${url}" onload="window.URL.revokeObjectURL(this.src)"><span class="tag ${p.ok ? '' : 'w'}">${s.label}${p.ok ? ' ✓' : ' · SIN GPS'}</span></button>`;
  }).join('');
  $('#grid').querySelectorAll('.tile').forEach((t) => (t.onclick = () => takePhoto(t.dataset.s)));
}
let pendingSlot = null, camStream = null, camSlot = null;
function takePhoto(slot) {
  if (cur.w.fotos[slot] && !confirm('Ya hay una foto en ' + slotLabel(slot) + '. ¿Reemplazarla?')) return;
  openCamera(slot);
}
function nativeCam(slot) { pendingSlot = slot; $('#cam').value = ''; $('#cam').click(); }
async function openCamera(slot) {
  camSlot = slot;
  if (!navigator.mediaDevices?.getUserMedia) return nativeCam(slot);
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
  } catch (e) {
    await aviso('Cámara integrada no disponible', 'No se pudo abrir la cámara dentro de la app (' + (e.name || e.message) + '). Se usará la cámara del teléfono.');
    return nativeCam(slot);
  }
  camStream.getVideoTracks().forEach((t) => (t.onended = () => closeCam()));
  const v = $('#camVideo'); v.srcObject = camStream; v.play().catch(() => {});
  $('#camLabel').textContent = slotLabel(slot) + ' · Orden ' + cur.o.orden; $('#camOv').hidden = false; updGps();
}
function closeCam() {
  if (camStream) camStream.getTracks().forEach((t) => t.stop());
  camStream = null; $('#camVideo').srcObject = null; $('#camOv').hidden = true;
}
$('#camCancel').onclick = closeCam;
$('#camNative').onclick = () => { const s = camSlot; closeCam(); nativeCam(s); };
$('#camGal').onclick = () => { const s = camSlot; closeCam(); pendingSlot = s; $('#gal').value = ''; $('#gal').click(); };
$('#camShot').onclick = async () => {
  const v = $('#camVideo'); if (!v.videoWidth || !camSlot) return;
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); const slot = camSlot;
  closeCam(); await procesarFoto(slot, blob);
};
async function procesarFoto(slot, file, galeria) {
  if (!cur || !file) return; busy(true);
  try {
    let fix;
    if (galeria) {
      fix = await readExifGps(file);
      if (!fix) { const f = await getFix(); fix = f ? { lat: f.lat, lon: f.lon, acc: f.acc, ts: f.ts, note: 'ubicación actual' } : null; }
    } else fix = await getFix();
    const blob = await stampPhoto(file, slotLabel(slot) + (galeria ? ' · GALERÍA' : ''), cur.o, fix);
    const ts = Date.now();
    await dbPut('photos', { key: cur.o.orden + '|' + slot, orden: cur.o.orden, slot, blob, lat: fix?.lat ?? null, lon: fix?.lon ?? null, acc: fix?.acc ?? null, ts, ok: !!fix, origen: galeria ? (fix?.note ? 'galeria-ubicacion-actual' : 'galeria-exif') : 'camara' });
    cur.w.fotos[slot] = { ts, lat: fix?.lat ?? null, lon: fix?.lon ?? null, ok: !!fix };
    await saveWork(cur.w); await renderPhotos();
    busy(false);
    if (!fix) await aviso('Sin coordenadas', 'No se pudo obtener el GPS. La foto quedó marcada "SIN GPS". Actívalo y vuelve a tomarla antes de guardar la orden.');
  } catch (err) { busy(false); await aviso('No se pudo guardar la foto', String(err.message || err)); }
}
$('#gal').addEventListener('change', async (e) => {
  const file = e.target.files[0]; const slot = pendingSlot; pendingSlot = null;
  if (file && slot) await procesarFoto(slot, file, true);
});
$('#cam').addEventListener('change', async (e) => {
  const file = e.target.files[0]; const slot = pendingSlot; pendingSlot = null;
  if (file && slot) await procesarFoto(slot, file);
});
$('#ejecutor').onchange = (e) => { cur.w.ejecutor = e.target.value; saveWork(cur.w); };
$('#allOk').onclick = () => { cur.o.mats.forEach((m) => { if (!matOk(m.code, cur.w.mats[m.code])) cur.w.mats[m.code] = 'OK'; }); saveWork(cur.w); renderOrder(); };

async function guardarOrden() {
  clearTimeout(tMat); const { o, w } = cur; const f = faltantes(o, w);
  if (f.length) {
    $('#faltan').hidden = false; $('#faltan').innerHTML = '<b>No se puede guardar. Falta:</b><ul>' + f.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    $('#faltan').scrollIntoView({ behavior: 'smooth', block: 'center' }); return false;
  }
  w.estado = 'completa'; w.fecha = w.fecha || hoy(); w.completada = Date.now(); w.descargada = false;
  await saveWork(w); await dbDel('kv', 'activa'); closeOrder(); return true;
}
function closeOrder() {
  cur = null; stopGPS(); $('#viewOrden').hidden = true; $('#viewHome').hidden = false; renderList(); renderReporte(); window.scrollTo(0, 0);
}
$('#btnSave').onclick = guardarOrden;
$('#btnDiscard').onclick = async () => {
  const r = await modal('¿Descartar esta orden?', 'Se borrarán las fotos y los datos de la orden ' + esc(cur.o.orden) + '. No se puede deshacer.', [['Cancelar', false], ['Sí, descartar', true, 'danger']]);
  if (!r) return;
  const ph = await dbPhotosOf(cur.o.orden); for (const p of ph) await dbDel('photos', p.key);
  delete WORKS[cur.o.orden]; await dbDel('works', cur.o.orden); await dbDel('kv', 'activa'); closeOrder();
};
// El botón "atrás" del teléfono no deja salir de una orden sin guardarla
window.addEventListener('popstate', async () => {
  if (!cur) return; history.pushState({ orden: 1 }, '');
  if (!$('#camOv').hidden) { closeCam(); return; }
  const f = faltantes(cur.o, cur.w);
  await aviso('Termina la orden antes de salir', f.length ? f : ['La orden está completa: toca "Guardar orden".']);
});

/* ===== Reportes ===== */
function worksDe(fecha) { return Object.values(WORKS).filter((w) => w.estado === 'completa' && (!fecha || w.fecha === fecha)).sort((a, b) => (a.completada || 0) - (b.completada || 0)); }
async function renderReporte() {
  const f = $('#repFecha').value || hoy(); if (!$('#repFecha').value) $('#repFecha').value = f;
  const ws = worksDe(f); const todas = worksDe(null); const sin = todas.filter((w) => !w.descargada);
  const encurso = Object.values(WORKS).filter((w) => w.estado !== 'completa').length;
  $('#repResumen').innerHTML = `<p>${ws.length} orden(es) completada(s) en esta fecha.${encurso ? ' <b>' + encurso + ' en curso (no se incluyen).</b>' : ''}</p>`;
  $('#riesgo').innerHTML = sin.length ? `<div class="alertBox"><b>${sin.length} orden(es) completadas aún sin descargar.</b> Descarga el reporte al terminar la jornada.</div>` : '<p class="muted">Todo lo completado ya fue descargado.</p>';
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate(); const libre = (e.quota - e.usage) / 1048576;
      $('#storInfo').textContent = `Usado: ${(e.usage / 1048576).toFixed(0)} MB · Libre: ${libre.toFixed(0)} MB` + (libre < 300 ? ' ⚠ POCO ESPACIO: descarga y libera.' : '');
    }
  } catch (_) { /* nada */ }
}
function csvCell(v) { v = String(v ?? ''); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
async function buildDocx(ws, titulo) {
  const D = docx; const om = orderMap(); const children = [];
  const LN = { style: D.BorderStyle.SINGLE, size: 4, color: '000000' };
  const borders = { top: LN, bottom: LN, left: LN, right: LN, insideHorizontal: LN, insideVertical: LN };
  const HDR = 'D9E1F2', LBL = 'F2F2F2';
  const cell = (w, text, o = {}) => new D.TableCell({
    width: { size: w, type: D.WidthType.DXA }, columnSpan: o.span, verticalAlign: D.VerticalAlign.CENTER,
    margins: { left: 108, right: 108, top: 0, bottom: 0 },
    shading: o.fill ? { type: D.ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
    children: o.children || [new D.Paragraph({ alignment: o.center ? D.AlignmentType.CENTER : D.AlignmentType.LEFT, children: [new D.TextRun({ text: String(text ?? ''), size: o.sz || 18, bold: !!o.b })] })],
  });
  const row = (h, cells) => new D.TableRow({ height: { value: h, rule: D.HeightRule.EXACT }, cantSplit: true, children: cells });
  const table = (cols, rows) => new D.Table({ width: { size: cols.reduce((a, b) => a + b, 0), type: D.WidthType.DXA }, columnWidths: cols, layout: D.TableLayoutType.FIXED, alignment: D.AlignmentType.CENTER, borders, rows });
  const spacer = () => new D.Paragraph({ spacing: { after: 40 }, children: [] });
  const fmtF = (f) => (f ? f.split('-').reverse().join('/') : '');
  const cumple = (m, real) => { if (/^ok$/i.test(real)) return 'SÍ'; const n = parseFloat(String(real).replace(',', '.')); return Math.abs(n - m.qty) < 1e-9 ? 'SÍ' : 'NO'; };
  const COLS = [['Cable cobre (m)', ['04011105400', '04100205400']], ['Fulmi-nantes (u)', ['21071200501']], ['Clavos (u)', ['100']], ['Grapas (u)', ['21393610200']],
    ['Tubo EMT (m)', ['21370200200']], ['Varilla (u)', ['01421612000']], ['Conector (u)', ['21394010200']], ['Arandela (u)', ['21090200800']], ['Resanado cemento', []]];
  const usados = new Set(COLS.flatMap((c) => c[1]));
  const slotNames = Object.fromEntries(SLOTS.map((s, i) => [s.id, (i + 1) + '. ' + s.label]));

  const fotoRows = async (lista, pm) => {
    const rows = [];
    for (let i = 0; i < lista.length; i += 2) {
      const par = [lista[i], lista[i + 1]];
      rows.push(row(312, par.map((s) => cell(5272, s ? slotNames[s.id] : '', { fill: s ? HDR : undefined, b: true, sz: 16, center: true }))));
      const cs = [];
      for (const s of par) {
        if (!s || !pm[s.id]) { cs.push(cell(5272, s ? 'Sin foto' : '', { center: true, sz: 16 })); continue; }
        const im = await shrink(pm[s.id].blob, 900); let W = 336, H = Math.round((336 * im.h) / im.w); if (H > 184) { H = 184; W = Math.round((184 * im.w) / im.h); }
        cs.push(new D.TableCell({ width: { size: 5272, type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.CENTER, margins: { left: 108, right: 108, top: 0, bottom: 0 },
          children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.ImageRun({ type: 'jpg', data: im.data, transformation: { width: W, height: H } })] })] }));
      }
      rows.push(row(2891, cs));
    }
    return rows;
  };

  let n = 0;
  for (const w of ws) {
    const o = om[w.orden]; if (!o) continue; n++;
    const ph = await dbPhotosOf(w.orden); const pm = Object.fromEntries(ph.map((p) => [p.slot, p]));
    const c1 = pm.antes?.ok ? pm.antes : ph.find((p) => p.ok);
    children.push(new D.Paragraph({ pageBreakBefore: n > 1, spacing: { after: 60 }, children: [
      new D.TextRun({ text: 'INFORME DE REVISIÓN DE PUESTA A TIERRA', bold: true, size: 26 }),
      new D.TextRun({ text: '    Contrato 13-DIL-26 · Hoja N° ' + n })] }));
    const act = o.actividades.replace(/,\s*/g, ', ');
    children.push(table([2041, 3231, 2041, 3231], [
      row(425, [cell(2041, 'FECHA DE REVISIÓN', { fill: HDR, b: true, sz: 16 }), cell(3231, fmtF(w.fecha)), cell(2041, 'ORDEN', { fill: HDR, b: true, sz: 16 }), cell(3231, o.orden)]),
      row(425, [cell(2041, 'MEDIDOR', { fill: HDR, b: true, sz: 16 }), cell(3231, o.medidor), cell(2041, 'COORDENADAS (lat, lon)', { fill: HDR, b: true, sz: 16 }), cell(3231, c1 ? c1.lat.toFixed(6) + ', ' + c1.lon.toFixed(6) : 'SIN GPS')]),
      row(425, [cell(2041, 'TÉCNICO / GRUPO', { fill: HDR, b: true, sz: 16 }), cell(3231, w.ejecutor), cell(2041, 'ACTIVIDAD', { fill: HDR, b: true, sz: 16 }), cell(3231, act, { sz: act.length > 34 ? 14 : 18 })]),
    ]));
    children.push(spacer());
    const byCol = COLS.map(([, codes]) => o.mats.find((m) => codes.includes(m.code)));
    children.push(table([1871, ...COLS.map(() => 964)], [
      row(482, [cell(1871, 'MATERIAL', { fill: HDR, b: true, sz: 16 }), ...COLS.map(([t]) => cell(964, t, { fill: HDR, b: true, sz: 14, center: true }))]),
      row(340, [cell(1871, 'Cantidad registrada', { fill: LBL, sz: 15 }), ...byCol.map((m) => cell(964, m ? m.qty : '—', { center: true }))]),
      row(340, [cell(1871, 'Cantidad verificada', { fill: LBL, sz: 15 }), ...byCol.map((m) => cell(964, m ? String(w.mats[m.code] ?? '').toUpperCase() : '', { center: true }))]),
      row(340, [cell(1871, '¿Cumple? (SÍ / NO)', { fill: LBL, sz: 15 }), ...byCol.map((m) => cell(964, m ? cumple(m, w.mats[m.code] ?? '') : '', { center: true, b: true }))]),
    ]));
    children.push(spacer());
    children.push(table([5272, 5272], await fotoRows(SLOTS.slice(0, 6), pm)));
    children.push(spacer());
    const otros = o.mats.filter((m) => !usados.has(m.code)).map((m) => `${m.desc}: ${m.qty} ${m.unit} — ${String(w.mats[m.code] ?? '').toUpperCase()}`);
    const obs = otros.length ? 'Otros materiales: ' + otros.join('; ') : '';
    children.push(table([5272, 5273], [
      row(312, [cell(10545, 'OBSERVACIONES', { fill: HDR, b: true, sz: 16, span: 2 })]),
      row(1134, [cell(10545, obs, { sz: 16, span: 2 })]),
      row(397, [cell(5272, 'Revisó: ______________________', { sz: 16 }), cell(5273, 'Resultado:   ☐ CUMPLE    ☐ REVISAR    ☐ NO CUMPLE', { sz: 16 })]),
    ]));
    const extra = SLOTS.slice(6).filter((s) => pm[s.id]);
    if (extra.length) {
      children.push(new D.Paragraph({ pageBreakBefore: true, spacing: { after: 60 }, children: [new D.TextRun({ text: `FOTOS ADICIONALES — Orden ${o.orden} · Medidor ${o.medidor}`, bold: true, size: 22 })] }));
      children.push(table([5272, 5272], await fotoRows(extra, pm)));
    }
  }
  const doc = new D.Document({
    title: 'Informe de revisión de puesta a tierra — ' + titulo,
    styles: { default: { document: { run: { font: 'Arial', size: 18 }, paragraph: { spacing: { after: 0 } } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 567, bottom: 567, left: 680, right: 680 } } }, children }],
  });
  return await D.Packer.toBlob(doc);
}
async function generar(modo, fecha) {
  const ws = worksDe(modo === 'todo' ? null : fecha);
  if (!ws.length) { await aviso('Nada que descargar', 'No hay órdenes completadas para esa selección.'); return; }
  busy(true);
  try {
    const om = orderMap(); const tag = modo === 'todo' ? 'RESPALDO_' + hoy() : fecha;
    const titulo = modo === 'todo' ? 'Respaldo de todas las fechas' : 'Fecha de trabajo: ' + fecha.split('-').reverse().join('/');
    const docBlob = await buildDocx(ws, titulo);
    if (modo === 'docx') { download(docBlob, `Reporte_${tag}.docx`); }
    else {
      const zip = new JSZip(); zip.file(`Reporte_${tag}.docx`, docBlob);
      let csv = '﻿orden,medidor,cuenta_contrato,fecha,ejecutado_por,latitud,longitud,fotos,materiales(codigo:csv>real)\n';
      for (const w of ws) {
        const o = om[w.orden]; if (!o) continue; const ph = await dbPhotosOf(w.orden); const c1 = ph.find((p) => p.ok);
        const dir = zip.folder(String(o.medidor));
        for (const s of SLOTS) { const p = ph.find((x) => x.slot === s.id); if (p) dir.file(`${String(SLOTS.indexOf(s) + 1).padStart(2, '0')}_${s.label.replace(/ /g, '_').replace('Ó', 'O').replace('É', 'E')}_orden${o.orden}.jpg`, p.blob); }
        csv += [o.orden, o.medidor, o.cuenta, w.fecha, w.ejecutor, c1?.lat ?? '', c1?.lon ?? '', ph.length, o.mats.map((m) => `${m.code}:${m.qty}>${w.mats[m.code] ?? ''}`).join(' | ')].map(csvCell).join(',') + '\n';
      }
      zip.file(`datos_${tag}.csv`, csv);
      download(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `Trabajos_${tag}.zip`);
    }
    if (modo !== 'docx') { for (const w of ws) { w.descargada = true; await saveWork(w); } }
  } catch (err) { busy(false); await aviso('Error al generar el reporte', String(err.message || err)); return; }
  busy(false); renderReporte();
}
$('#btnZip').onclick = () => generar('zip', $('#repFecha').value);
$('#btnDocx').onclick = () => generar('docx', $('#repFecha').value);
$('#btnBackup').onclick = () => generar('todo');
$('#repFecha').onchange = renderReporte;

/* ===== Navegación y arranque ===== */
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('#tabOrdenes').hidden = b.dataset.tab !== 'ordenes'; $('#tabReporte').hidden = b.dataset.tab !== 'reporte'; if (b.dataset.tab === 'reporte') renderReporte();
}));
document.querySelectorAll('.filters button').forEach((b) => (b.onclick = () => { filtro = b.dataset.f; document.querySelectorAll('.filters button').forEach((x) => x.classList.toggle('on', x === b)); renderList(); }));
$('#q').oninput = renderList;
$('#csvIn').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const nuevas = csvToOrders(await f.text()); if (!nuevas.length) throw new Error('El CSV no tiene órdenes.');
    for (const o of nuevas) await dbPut('orders', o);
    await loadAll(); renderCsvBox(); renderList(); await aviso('CSV cargado', `${nuevas.length} órdenes cargadas. Lo ya trabajado se conserva.`);
  } catch (err) { await aviso('No se pudo leer el CSV', String(err.message || err)); }
  e.target.value = '';
};
let deferredInstall;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#btnInstall').hidden = false; });
$('#btnInstall').onclick = async () => { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('#btnInstall').hidden = true; } };

(async function init() {
  db = await openDB();
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch (_) { /* nada */ }
  await loadAll(); renderCsvBox(); renderList(); renderReporte();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  // Recuperar la orden que estaba abierta si se cerró la app o se reinició el teléfono
  const activa = await dbGet('kv', 'activa');
  if (activa && orderMap()[activa]) { await openOrder(activa); await aviso('Orden en curso recuperada', 'Se cerró la app con la orden ' + activa + ' sin guardar. Continúa donde la dejaste.'); }
})();
