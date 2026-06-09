/* 宇都宮熊 — クマ目撃マップ */
'use strict';

const $ = (id) => document.getElementById(id);
let DATA = null;
let SIGHTINGS = [];
let map, meMarker, meAccCircle, meRadiusCircle;
let markers = [];      // {sighting, marker}
let pathLine = null;
let nearest = null;    // {d, s}
let radius = 500;

/* ---------- ユーティリティ ---------- */
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR;
  const a = Math.sin(dLa / 2) ** 2 +
            Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function bearingJP(la1, lo1, la2, lo2) {
  const toR = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * toR) * Math.cos(la2 * toR);
  const x = Math.cos(la1 * toR) * Math.sin(la2 * toR) -
            Math.sin(la1 * toR) * Math.cos(la2 * toR) * Math.cos((lo2 - lo1) * toR);
  let deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  return dirs[Math.round(deg / 45) % 8];
}
function fmtDist(m) {
  if (m < 1000) return Math.round(m / 10) * 10 + 'm';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km';
}
function whenLabel(s) {
  const [, mo, d] = s.date.split('-');
  return `${+mo}/${+d}${s.time ? ' ' + s.time : ''}`;
}
function lerpColor(a, b, t) {
  const ah = a.match(/\w\w/g).map(h => parseInt(h, 16));
  const bh = b.match(/\w\w/g).map(h => parseInt(h, 16));
  const r = ah.map((v, i) => Math.round(v + (bh[i] - v) * t));
  return `rgb(${r[0]},${r[1]},${r[2]})`;
}
function ageColor(idx, n) {
  // 古い(灰) → 新しい(赤)
  return lerpColor('8a93a3', 'ff5a36', n <= 1 ? 1 : idx / (n - 1));
}

/* ---------- 地図 ---------- */
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true })
        .setView(DATA.center, 14);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap'
  }).addTo(map);
}

function makeIcon(s, idx, n) {
  if (s.latest) {
    return L.divIcon({
      className: '', html: `<div class="bear-marker bear-latest">🐻</div>`,
      iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22]
    });
  }
  const c = ageColor(idx, n);
  const sz = 22 + Math.round(8 * (n <= 1 ? 1 : idx / (n - 1)));
  return L.divIcon({
    className: '',
    html: `<div class="bear-marker" style="width:${sz}px;height:${sz}px;background:${c};font-size:${Math.round(sz*0.42)}px">${idx + 1}</div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -sz / 2]
  });
}

function popupHtml(s) {
  return `<b>${s.area}</b><br>` +
    `<span class="popup-when">${whenLabel(s)}</span>` +
    (s.detail ? `<br>${s.detail}` : '') +
    (s.source ? `<br><a href="${s.source}" target="_blank" rel="noopener">出典（下野新聞）↗</a>` : '');
}

function renderMarkers() {
  const n = SIGHTINGS.length;
  markers = SIGHTINGS.map((s, i) => {
    const m = L.marker([s.lat, s.lng], { icon: makeIcon(s, i, n), zIndexOffset: s.latest ? 1000 : i })
              .bindPopup(popupHtml(s));
    m.on('click', () => focusSighting(s, false));
    return { sighting: s, marker: m };
  });
  pathLine = L.polyline(SIGHTINGS.map(s => [s.lat, s.lng]), {
    color: '#ff8a5c', weight: 3, opacity: .7, dashArray: '2 8', lineCap: 'round'
  });
}

function showAllOnMap() {
  pathLine.addTo(map);
  markers.forEach(({ marker }) => marker.addTo(map));
  const latest = markers.find(m => m.sighting.latest) || markers[markers.length - 1];
  if (latest) latest.marker.openPopup();
}

function focusSighting(s, openList) {
  map.flyTo([s.lat, s.lng], 16, { duration: .6 });
  const hit = markers.find(m => m.sighting === s);
  if (hit) setTimeout(() => hit.marker.openPopup(), 350);
  if (openList) setSheet(false);
}

/* ---------- 一覧・カード ---------- */
function renderList() {
  const list = $('list');
  const n = SIGHTINGS.length;
  // 新しい順
  [...SIGHTINGS].reverse().forEach((s) => {
    const idx = s.id - 1;
    const li = document.createElement('li');
    if (s.latest) li.classList.add('is-latest');
    li.innerHTML =
      `<span class="dot" style="background:${s.latest ? '#ff5a36' : ageColor(idx, n)}">${s.latest ? '🐻' : idx + 1}</span>` +
      `<div class="li-main"><div class="li-place">${s.area}</div>` +
      (s.detail ? `<div class="li-detail">${s.detail}</div>` : '') + `</div>` +
      `<div class="li-when">${whenLabel(s)}</div>`;
    li.addEventListener('click', () => focusSighting(s, true));
    list.appendChild(li);
  });
  $('count').textContent = `全${n}地点`;

  const latest = SIGHTINGS.find(s => s.latest) || SIGHTINGS[SIGHTINGS.length - 1];
  $('latestPlace').textContent = latest.area;
  $('latestDate').textContent = whenLabel(latest) + ' に確認';
  $('gotoLatest').addEventListener('click', () => focusSighting(latest, false));

  const story = $('storyList');
  (DATA.timeline || []).forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${t.when}</b> — ${t.text}`;
    story.appendChild(li);
  });

  $('disclaimer').innerHTML =
    `${DATA.note || ''}<br>データ出典：<a href="${DATA.source.mymaps}" target="_blank" rel="noopener">${DATA.source.mymapsName}↗</a>` +
    `<br>更新：${(DATA.updatedAt || '').slice(0, 10)}`;
}

/* ---------- ボトムシート ---------- */
const PEEK = 196;
let sheetExpanded = false;
function setSheet(expanded) {
  const sheet = $('sheet');
  const h = sheet.offsetHeight;
  const off = expanded ? 0 : Math.max(0, h - PEEK);
  sheet.style.setProperty('--sheet-offset', off + 'px');
  document.documentElement.style.setProperty('--sheet-peek', PEEK + 'px');
  sheetExpanded = expanded;
}
function initSheetDrag() {
  const sheet = $('sheet'), handle = $('sheetHandle');
  let startY = 0, startOff = 0, dragging = false, h = 0;
  const getOff = () => parseFloat(getComputedStyle(sheet).getPropertyValue('--sheet-offset')) || 0;
  const onDown = (e) => {
    dragging = true; h = sheet.offsetHeight;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    startOff = getOff();
    sheet.style.transition = 'none';
  };
  const onMove = (e) => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const off = Math.min(Math.max(0, startOff + (y - startY)), h - PEEK);
    sheet.style.setProperty('--sheet-offset', off + 'px');
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false; sheet.style.transition = '';
    setSheet(getOff() < (h - PEEK) / 2);
  };
  handle.addEventListener('touchstart', onDown, { passive: true });
  handle.addEventListener('touchmove', onMove, { passive: true });
  handle.addEventListener('touchend', onUp);
  handle.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  handle.addEventListener('click', () => setSheet(!sheetExpanded));
}

/* ---------- 時系列再生 ---------- */
let playing = false, playTimer = null;
function playTimeline() {
  if (playing) { stopPlay(); return; }
  playing = true; $('playBtn').classList.add('playing'); $('playBtn').textContent = '⏸';
  markers.forEach(({ marker }) => map.removeLayer(marker));
  map.removeLayer(pathLine);
  const pts = [];
  let i = 0;
  const step = () => {
    if (i >= markers.length) { stopPlay(); showAllOnMap(); return; }
    const { sighting, marker } = markers[i];
    marker.addTo(map);
    pts.push([sighting.lat, sighting.lng]);
    pathLine.setLatLngs(pts); if (!map.hasLayer(pathLine)) pathLine.addTo(map);
    map.panTo([sighting.lat, sighting.lng], { animate: true, duration: .5 });
    if (sighting.latest) marker.openPopup();
    i++; playTimer = setTimeout(step, 850);
  };
  step();
}
function stopPlay() {
  playing = false; clearTimeout(playTimer);
  $('playBtn').classList.remove('playing'); $('playBtn').textContent = '▶';
}

/* ---------- 音 ---------- */
let actx = null, beepTimer = null;
function ensureAudio() {
  if (!actx) { const C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); }
  if (actx && actx.state === 'suspended') actx.resume();
}
function beep() {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'square'; o.frequency.value = 920;
  o.connect(g); g.connect(actx.destination);
  const t = actx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
  o.start(t); o.stop(t + 0.3);
}
function startBeep() { if (beepTimer) return; beep(); beepTimer = setInterval(beep, 750); }
function stopBeep() { clearInterval(beepTimer); beepTimer = null; }

/* ---------- アラート ---------- */
let alarmActive = false, silenced = false;
function triggerAlarm(best, lat, lng) {
  alarmActive = true;
  $('alert').classList.remove('hidden');
  updateAlarm(best, lat, lng);
  startBeep();
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 500]);
}
function updateAlarm(best, lat, lng) {
  $('alertDist').textContent = fmtDist(best.d);
  $('alertSub').textContent = `${best.s.area}（${bearingJP(lat, lng, best.s.lat, best.s.lng)}の方向）`;
}
function stopAlarm() {
  alarmActive = false; $('alert').classList.add('hidden'); stopBeep();
  if (navigator.vibrate) navigator.vibrate(0);
}

/* ---------- 現在地・見守り ---------- */
let watchId = null;
function setMe(lat, lng, acc) {
  const ll = [lat, lng];
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 2000 }).addTo(map);
    meAccCircle = L.circle(ll, { radius: acc || 30, color: '#2a8cff', weight: 1, opacity: .4, fillOpacity: .08 }).addTo(map);
    meRadiusCircle = L.circle(ll, { radius: radius, color: '#ff5a36', weight: 1.5, dashArray: '4 6', fillColor: '#ff5a36', fillOpacity: .05 }).addTo(map);
  } else {
    meMarker.setLatLng(ll); meAccCircle.setLatLng(ll).setRadius(acc || 30);
    meRadiusCircle.setLatLng(ll).setRadius(radius);
  }
}
function onPos(pos) {
  const { latitude: lat, longitude: lng, accuracy: acc } = pos.coords;
  setMe(lat, lng, acc);
  let best = null;
  for (const s of SIGHTINGS) {
    const d = haversine(lat, lng, s.lat, s.lng);
    if (!best || d < best.d) best = { d, s };
  }
  nearest = best;
  renderProximity(best, lat, lng);
  if (best.d <= radius) {
    if (!alarmActive && !silenced) triggerAlarm(best, lat, lng);
  } else if (best.d > radius * 1.15) {
    silenced = false; if (alarmActive) stopAlarm();
  }
  if (alarmActive) updateAlarm(best, lat, lng);
}
function renderProximity(best, lat, lng) {
  const el = $('proximity');
  el.classList.remove('hidden', 'near', 'warn');
  const dir = bearingJP(lat, lng, best.s.lat, best.s.lng);
  if (best.d <= radius) { el.classList.add('near'); $('proxIcon').textContent = '🐻'; }
  else if (best.d <= radius * 2) { el.classList.add('warn'); $('proxIcon').textContent = '⚠️'; }
  else { $('proxIcon').textContent = '📍'; }
  $('proxText').textContent = `最寄りの目撃地点まで ${fmtDist(best.d)}（${dir}）`;
}
function onPosErr(err) {
  $('proximity').classList.remove('hidden');
  $('proxIcon').textContent = '⚠️';
  $('proxText').textContent = '現在地を取得できません（位置情報の許可が必要）';
}
function startWatch() {
  if (!navigator.geolocation) { alert('この端末では位置情報が使えません'); return; }
  ensureAudio();
  const btn = $('watchBtn');
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId); watchId = null;
    btn.classList.remove('active'); btn.innerHTML = '現在地で<br>見守り開始';
    $('proximity').classList.add('hidden'); $('radiusBar').classList.add('hidden');
    if (alarmActive) stopAlarm();
    return;
  }
  btn.classList.add('active'); btn.innerHTML = '見守り中<br>（停止）';
  $('radiusBar').classList.remove('hidden');
  $('proximity').classList.remove('hidden'); $('proxText').textContent = '現在地を取得中…';
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, {
    enableHighAccuracy: true, maximumAge: 4000, timeout: 20000
  });
}
function locateOnce() {
  if (meMarker) { map.flyTo(meMarker.getLatLng(), 16, { duration: .6 }); return; }
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    p => { setMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy); map.flyTo([p.coords.latitude, p.coords.longitude], 16); },
    () => alert('現在地を取得できませんでした'),
    { enableHighAccuracy: true, timeout: 15000 });
}

/* ---------- 半径設定 ---------- */
function initRadius() {
  const opts = [300, 500, 1000, 2000];
  const wrap = $('radiusOpts');
  opts.forEach(r => {
    const b = document.createElement('button');
    b.textContent = r < 1000 ? r + 'm' : (r / 1000) + 'km';
    if (r === radius) b.classList.add('sel');
    b.addEventListener('click', () => {
      radius = r;
      [...wrap.children].forEach(c => c.classList.remove('sel'));
      b.classList.add('sel');
      if (meRadiusCircle) meRadiusCircle.setRadius(radius);
      if (nearest) { // 再評価
        if (nearest.d > radius * 1.15 && alarmActive) stopAlarm();
      }
    });
    wrap.appendChild(b);
  });
}

/* ---------- 起動 ---------- */
// データ取得先: ①GitHub raw（10分おきに自動更新される最新版）→ ②同梱コピー（オフライン/フォールバック）
const DATA_SOURCES = [
  'https://raw.githubusercontent.com/pasotaro-main/utsunomiya-kuma/main/data/sightings.json',
  'data/sightings.json'
];
async function loadData() {
  for (const url of DATA_SOURCES) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch (e) { /* 次のソースへ */ }
  }
  return null;
}

async function boot() {
  DATA = await loadData();
  if (!DATA) {
    document.body.innerHTML = '<p style="padding:24px">データの読み込みに失敗しました。</p>';
    return;
  }
  SIGHTINGS = DATA.sightings.slice().sort((a, b) => a.id - b.id);
  radius = DATA.defaultRadiusM || 500;

  initMap();
  renderMarkers();
  showAllOnMap();
  renderList();
  initRadius();
  initSheetDrag();
  setSheet(false);

  // 最新地点に寄せる
  const latest = SIGHTINGS.find(s => s.latest) || SIGHTINGS[SIGHTINGS.length - 1];
  map.setView([latest.lat, latest.lng], 14);

  $('watchBtn').addEventListener('click', startWatch);
  $('locateBtn').addEventListener('click', locateOnce);
  $('playBtn').addEventListener('click', playTimeline);
  $('alertClose').addEventListener('click', () => { silenced = true; stopAlarm(); });
  window.addEventListener('resize', () => setSheet(sheetExpanded));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
