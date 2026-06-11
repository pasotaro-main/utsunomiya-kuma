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
  return degToJP(bearingDeg(la1, lo1, la2, lo2));
}
function bearingDeg(la1, lo1, la2, lo2) {
  const toR = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * toR) * Math.cos(la2 * toR);
  const x = Math.cos(la1 * toR) * Math.sin(la2 * toR) -
            Math.sin(la1 * toR) * Math.cos(la2 * toR) * Math.cos((lo2 - lo1) * toR);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function degToJP(deg) {
  const dirs = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
  return dirs[Math.round(deg / 45) % 8];
}
function destPoint(lat, lng, bearingDegV, distM) {
  const R = 6371000, toR = Math.PI / 180, toD = 180 / Math.PI;
  const br = bearingDegV * toR, d = distM / R, la1 = lat * toR, lo1 = lng * toR;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1),
                               Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 * toD, lo2 * toD];
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
// 情報元（出典）ごとの色分け
const SOURCE_COLORS = {
  '宇都宮市公式': '#e0431f', // 赤＝市の公式発表
  '下野新聞': '#14b8a6',     // ティール＝下野新聞
  'user': '#d97706',         // 橙＝みんなの投稿（未確認）
  'default': '#8a93a3'       // 灰＝その他
};
function sourceColor(s) { return SOURCE_COLORS[s && s.sourceName] || SOURCE_COLORS.default; }
function ageOpacity(idx, n) { return 0.5 + 0.5 * (n <= 1 ? 1 : idx / (n - 1)); } // 古いほど少し薄く

function renderLegend() {
  const el = document.getElementById('legend'); if (!el) return;
  const present = [...new Set((SIGHTINGS || []).map(s => s.sourceName).filter(Boolean))];
  const items = present.map(n => ({ c: SOURCE_COLORS[n] || SOURCE_COLORS.default, l: n }));
  items.push({ c: SOURCE_COLORS.user, l: 'みんなの投稿（未確認）' });
  items.push({ c: '#16a34a', l: 'ニュース/SNS（信憑性つき）' });
  if (DATA.predictionEnabled !== false) items.push({ c: '#a855f7', l: 'AI予測' });
  items.push({ c: '#2a8cff', l: '現在地' });
  el.innerHTML = '<div class="lg-title">凡例（情報元）</div>' +
    items.map(i => `<span class="lg-item"><span class="lg-dot" style="background:${i.c}"></span>${i.l}</span>`).join('');
}

/* ---------- ニュース・SNS情報（Claudeが信憑性つきで収集） ---------- */
let webMarkers = [];
function credColor(c) { return c === '高' ? '#16a34a' : c === '中' ? '#d97706' : '#6b7280'; }

// 事案ステータス（捕獲済み等）のバナー
function renderStatus() {
  const el = document.getElementById('statusBanner');
  const st = DATA.incidentStatus;
  if (!el) return;
  el.classList.remove('captured', 'caution');
  if (st && (st.state === 'captured' || st.state === 'caution')) {
    el.classList.remove('hidden');
    el.classList.add(st.state);
    const title = st.state === 'caution'
      ? '⚠️ 1頭は捕獲・「2頭目」の可能性で警戒継続'
      : '✅ このクマは捕獲されました（終息）';
    el.innerHTML =
      `<div class="sb-title">${title}</div>` +
      `<div class="sb-text">${escapeHtml(st.text || '')}</div>` +
      (st.sourceUrl ? `<a href="${st.sourceUrl}" target="_blank" rel="noopener" class="sb-src">出典（${escapeHtml(st.source || '報道')}）↗</a>` : '');
    if (st.lat) el.onclick = () => map.flyTo([st.lat, st.lng], 16, { duration: .6 });
  } else {
    el.classList.add('hidden');
  }
}
function renderWebReports() {
  webMarkers.forEach(m => map.removeLayer(m)); webMarkers = [];
  const items = (DATA.webReports || []);
  // 地図ピンは「信憑性が中以上・場所特定済み」だけ（低やデマを地図に出さない）
  items.forEach(r => {
    if (typeof r.lat === 'number' && typeof r.lng === 'number' && r.credibility !== '低') {
      const col = credColor(r.credibility);
      const icon = L.divIcon({ className: '', html: `<div class="news-marker" style="border-color:${col}">📰<span class="news-cred" style="background:${col}">${r.credibility}</span></div>`, iconSize: [34, 28], iconAnchor: [17, 14], popupAnchor: [0, -14] });
      const m = L.marker([r.lat, r.lng], { icon, zIndexOffset: 700 }).bindPopup(webPopup(r));
      m.addTo(map); webMarkers.push(m);
    }
  });
  renderWebList(items);
}
function webPopup(r) {
  const col = credColor(r.credibility);
  return `<b>📰 ${escapeHtml(r.kind || '情報')}</b> <span class="tag" style="background:${col}">信憑性${escapeHtml(r.credibility || '')}</span><br>` +
    `<span class="popup-when">${r.date ? escapeHtml(r.date.slice(5)) : ''}${r.time ? ' ' + escapeHtml(r.time) : ''} ${escapeHtml(r.place || '')}</span><br>` +
    `${escapeHtml(r.summary || '')}` +
    (r.sourceUrl ? `<br><a href="${r.sourceUrl}" target="_blank" rel="noopener">${escapeHtml(r.source || '出典')}↗</a>` : (r.source ? `<br><span class="popup-when">${escapeHtml(r.source)}</span>` : ''));
}
function renderWebList(items) {
  const wrap = document.getElementById('webList'), empty = document.getElementById('webEmpty');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!items.length) { if (empty) empty.classList.remove('hidden'); return; }
  if (empty) empty.classList.add('hidden');
  items.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))).forEach(r => {
    const col = credColor(r.credibility);
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${col}">📰</span>` +
      `<div class="li-main"><div class="li-place">${escapeHtml(r.summary || r.place || '情報')} <span class="tag" style="background:${col}">信憑性${escapeHtml(r.credibility || '')}</span></div>` +
      `<div class="li-detail">${escapeHtml(r.place || '')}${r.source ? ' ・ ' + escapeHtml(r.source) : ''}${r.credReason ? '（' + escapeHtml(r.credReason) + '）' : ''}</div></div>` +
      `<div class="li-when">${r.date ? escapeHtml(r.date.slice(5)) : ''}${r.time ? ' ' + escapeHtml(r.time) : ''}</div>`;
    if (typeof r.lat === 'number') li.onclick = () => map.flyTo([r.lat, r.lng], 15, { duration: .5 });
    wrap.appendChild(li);
  });
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

function isUnverified(s) { return s.status && s.status !== 'official'; }
function statusTag(s) {
  if (s.status === 'user') return ' <span class="tag tag-user">未確認・投稿</span>';
  if (s.status === 'official_locating') return ' <span class="tag tag-locating">位置推定</span>';
  return '';
}

function makeIcon(s, idx, n) {
  if (s.latest) {
    return L.divIcon({
      className: '', html: `<div class="bear-marker bear-latest">🐻</div>`,
      iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22]
    });
  }
  if (isUnverified(s)) {
    return L.divIcon({
      className: '', html: `<div class="bear-marker bear-unverified">?</div>`,
      iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14]
    });
  }
  const c = sourceColor(s);
  const frac = (n <= 1 ? 1 : idx / (n - 1));
  const sz = 22 + Math.round(8 * frac);
  return L.divIcon({
    className: '',
    html: `<div class="bear-marker" style="width:${sz}px;height:${sz}px;background:${c};opacity:${ageOpacity(idx, n)};font-size:${Math.round(sz*0.42)}px">${idx + 1}</div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2], popupAnchor: [0, -sz / 2]
  });
}

function popupHtml(s) {
  const src = s.sourceName || '出典';
  return `<b>${s.area}</b>${statusTag(s)}<br>` +
    `<span class="popup-when">${whenLabel(s)} ごろ</span>` +
    (s.detail ? `<br>${s.detail}` : '') +
    (s.reporter ? `<br><span class="popup-when">投稿: ${s.reporter}</span>` : '') +
    (s.source ? `<br><a href="${s.source}" target="_blank" rel="noopener">${src}↗</a>` : '');
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

/* ---------- AI 次の出没エリア予想（直近の移動ベクトルから推定・参考） ---------- */
let predictLayers = [];
function predictNext() {
  const pts = SIGHTINGS.filter(s => !isUnverified(s));
  const n = pts.length;
  if (n < 3) return null;
  const W = Math.min(6, n);
  const recent = pts.slice(n - W);
  const last = recent[recent.length - 1];
  // 連続ステップの平均距離と、直近区間の正味方位
  let stepSum = 0;
  for (let i = 1; i < recent.length; i++)
    stepSum += haversine(recent[i - 1].lat, recent[i - 1].lng, recent[i].lat, recent[i].lng);
  const stepAvg = stepSum / (recent.length - 1);
  const netBearing = bearingDeg(recent[0].lat, recent[0].lng, last.lat, last.lng);
  const dist = Math.max(stepAvg, 300);
  const [plat, plng] = destPoint(last.lat, last.lng, netBearing, dist);
  const radius = Math.min(Math.max(stepAvg * 0.9, 400), 1600);
  return { lat: plat, lng: plng, bearing: netBearing, dist, radius, from: last };
}
function renderPrediction() {
  predictLayers.forEach(l => map.removeLayer(l));
  predictLayers = [];
  const card = document.getElementById('predictCard');
  if (DATA.predictionEnabled === false) {
    if (card) card.classList.add('hidden'); // 予測機能は停止中（データ側スイッチ）
    return;
  }
  const ist = DATA.incidentStatus && DATA.incidentStatus.state;
  if (ist === 'captured' || ist === 'caution') {
    if (card) card.classList.add('hidden'); // 捕獲/警戒中は個体を特定できないため予測を出さない
    return;
  }
  const latest = SIGHTINGS.find(s => s.latest) || SIGHTINGS[SIGHTINGS.length - 1];

  // ①Claudeの予測（30分ごとのスケジュールで生成）を優先 → 無ければ②クライアント簡易計算
  const ap = DATA.aiPrediction;
  const byClaude = !!(ap && typeof ap.lat === 'number' && typeof ap.lng === 'number' && latest);
  const p = byClaude
    ? { lat: ap.lat, lng: ap.lng, radius: ap.radius || 1500, from: latest }
    : predictNext();
  if (!p) { if (card) card.classList.add('hidden'); return; }

  const line = L.polyline([[p.from.lat, p.from.lng], [p.lat, p.lng]],
    { color: '#a855f7', weight: 3, opacity: .85, dashArray: '6 6' });
  const circle = L.circle([p.lat, p.lng],
    { radius: p.radius, color: '#a855f7', weight: 2, fillColor: '#a855f7', fillOpacity: .12 });
  const popup = byClaude
    ? `<b>🔮 AI予測（Claude）</b><br><span class="popup-when">${escapeHtml(ap.areaText || '次の出没エリア')}<br>${escapeHtml(ap.reasoning || '')}</span>`
    : `<b>🔮 AI予測（参考）</b><br><span class="popup-when">直近の動きから推定した次の出没エリア。誤差が大きいため目安です。</span>`;
  const marker = L.marker([p.lat, p.lng], {
    icon: L.divIcon({ className: '', html: '<div class="predict-marker">🔮予測</div>', iconSize: [62, 26], iconAnchor: [31, 13] }),
    zIndexOffset: 1500
  }).bindPopup(popup);
  [circle, line, marker].forEach(l => { l.addTo(map); predictLayers.push(l); });

  if (card) {
    card.classList.remove('hidden');
    if (byClaude) {
      card.innerHTML =
        `<div class="predict-head">🔮 AI予測（Claude）${ap.direction ? ` ・ ${escapeHtml(ap.direction)}方向` : ''}</div>` +
        `<div class="predict-body"><b>${escapeHtml(ap.areaText || '')}</b><br>` +
        `<span class="predict-reason">${escapeHtml(ap.reasoning || '')}</span><br>` +
        `<span class="predict-note">${ap.horizon ? `想定: ${escapeHtml(ap.horizon)}／` : ''}クマの動きは不規則です。避難判断は公式情報を優先。${ap.updatedAt ? `（予測更新 ${String(ap.updatedAt).slice(5, 16).replace('T', ' ')}）` : ''}</span></div>`;
    } else {
      card.innerHTML =
        `<div class="predict-head">🔮 AI予測（参考・自動計算）</div>` +
        `<div class="predict-body">直近の移動から、次は <b>${degToJP(p.bearing)}</b>方向・約 <b>${fmtDist(p.dist)}</b> 先（${p.from.town || '最新地点'}付近の${degToJP(p.bearing)}側）に向かう可能性。<br>` +
        `<span class="predict-note">※クマの動きは不規則です。紫の円は誤差の目安。避難判断は公式情報を優先。</span></div>`;
    }
    card.onclick = () => { map.flyTo([p.lat, p.lng], 15, { duration: .6 }); marker.openPopup(); };
  }
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
    if (isUnverified(s)) li.classList.add('is-unverified');
    const dotBg = isUnverified(s) ? '#6b7280' : sourceColor(s);
    const dotTxt = s.latest ? '🐻' : (isUnverified(s) ? '?' : idx + 1);
    li.innerHTML =
      `<span class="dot" style="background:${dotBg}">${dotTxt}</span>` +
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

  const src = DATA.source || {};
  $('disclaimer').innerHTML =
    `${DATA.note || ''}<br>データ出典：<a href="${src.official || '#'}" target="_blank" rel="noopener">${src.officialName || '宇都宮市公式'}↗</a>` +
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
  // 捕獲済みなら全画面アラートは鳴らさない（過去地点での誤警報を防ぐ。距離表示は残す）
  const captured = DATA.incidentStatus && DATA.incidentStatus.state === 'captured';
  if (best.d <= radius && !captured) {
    if (!alarmActive && !silenced) triggerAlarm(best, lat, lng);
  } else if (best.d > radius * 1.15 || captured) {
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

/* ---------- 投稿（Googleログイン＋Firestore・未確認・信頼度UP） ---------- */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCeOQaWfUB4IAWl5jaw1Hi9NumC5NJ5UZE",
  authDomain: "utsunomiya-kuma.firebaseapp.com",
  projectId: "utsunomiya-kuma",
  storageBucket: "utsunomiya-kuma.firebasestorage.app",
  messagingSenderId: "312666318631",
  appId: "1:312666318631:web:c4ad6b9dc1c89b30cbab02"
};
let fbAuth = null, fbDb = null, fbUser = null;
let USER_REPORTS = [], reportMarkers = [], reportPin = null;

function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtReportWhen(iso) { const d = new Date(iso); if (isNaN(d)) return iso || ''; return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

function initSocial() {
  if (typeof firebase === 'undefined') { console.warn('firebase未ロード（投稿機能オフ）'); return; }
  firebase.initializeApp(FIREBASE_CONFIG);
  fbAuth = firebase.auth();
  fbDb = firebase.firestore();
  fbAuth.onAuthStateChanged((u) => { fbUser = u; updateAuthChip(); updateReportAuth(); });
  fbDb.collection('reports').orderBy('createdAt', 'desc').limit(300)
    .onSnapshot((snap) => {
      USER_REPORTS = [];
      snap.forEach(d => { const r = d.data(); r._id = d.id; if (r.lat && r.lng) USER_REPORTS.push(r); });
      renderReports();
    }, (e) => console.warn('reports購読エラー', e));
  $('reportBtn').addEventListener('click', openReportModal);
  $('reportCancel').addEventListener('click', closeReportModal);
  $('reportCurrent').addEventListener('click', pinToCurrent);
  $('reportSubmit').addEventListener('click', submitReport);
}

function updateAuthChip() {
  const chip = $('authChip'); if (!chip) return;
  chip.innerHTML = fbUser
    ? `ログイン中: <b>${escapeHtml(fbUser.displayName || '名無し')}</b> <button id="signOutBtn" class="link-btn">ログアウト</button>`
    : `<button id="signInBtn" class="link-btn">Googleでログイン</button>`;
  const si = $('signInBtn'); if (si) si.onclick = signIn;
  const so = $('signOutBtn'); if (so) so.onclick = () => fbAuth.signOut();
}
async function signIn() {
  try { await fbAuth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }
  catch (e) { alert('ログインに失敗しました: ' + (e.message || e)); }
}

// 場所(≤400m)×時間(≤3h)の近さで「同じ目撃と思われる投稿数」＝信頼度
function corroborationCount(r) {
  const t = Date.parse(r.sightedAt); let n = 0;
  for (const o of USER_REPORTS) {
    const dt = Math.abs(Date.parse(o.sightedAt) - t) / 3600000;
    if (haversine(r.lat, r.lng, o.lat, o.lng) <= 400 && (isNaN(dt) || dt <= 3)) n++;
  }
  return Math.max(1, n);
}
function confOpacity(c) { return Math.min(0.3 + 0.2 * (c - 1), 0.92); }

function renderReports() {
  reportMarkers.forEach(m => map.removeLayer(m));
  reportMarkers = [];
  USER_REPORTS.forEach(r => {
    const c = corroborationCount(r), op = confOpacity(c);
    const icon = L.divIcon({
      className: '',
      html: `<div class="report-marker" style="opacity:${op}">📣${c > 1 ? `<span class="rep-badge">${c}</span>` : ''}</div>`,
      iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15]
    });
    const m = L.marker([r.lat, r.lng], { icon, zIndexOffset: 800 }).bindPopup(reportPopup(r, c));
    m.addTo(map); reportMarkers.push(m);
  });
  renderReportsList();
}
function reportPopup(r, c) {
  return `<b>📣 未確認・投稿</b>${c > 1 ? ` <span class="tag tag-conf">近くに${c}件</span>` : ''}<br>` +
    `<span class="popup-when">${fmtReportWhen(r.sightedAt)} ごろ</span>` +
    (r.note ? `<br>${escapeHtml(r.note)}` : '') +
    `<br><span class="popup-when">投稿: ${escapeHtml(r.displayName || '名無し')}</span>`;
}
function renderReportsList() {
  const list = $('reportsList'), empty = $('reportsEmpty');
  if (!list) return;
  list.innerHTML = '';
  if (!USER_REPORTS.length) { if (empty) empty.classList.remove('hidden'); return; }
  if (empty) empty.classList.add('hidden');
  USER_REPORTS.slice().sort((a, b) => Date.parse(b.sightedAt) - Date.parse(a.sightedAt)).forEach(r => {
    const c = corroborationCount(r);
    const li = document.createElement('li');
    li.className = 'is-report';
    li.innerHTML = `<span class="dot" style="background:#b45309;opacity:${confOpacity(c)}">📣</span>` +
      `<div class="li-main"><div class="li-place">${escapeHtml(r.note || '目撃情報')} ${c > 1 ? `<span class="tag tag-conf">${c}件</span>` : ''}</div>` +
      `<div class="li-detail">投稿: ${escapeHtml(r.displayName || '名無し')}</div></div>` +
      `<div class="li-when">${fmtReportWhen(r.sightedAt)}</div>`;
    li.onclick = () => map.flyTo([r.lat, r.lng], 16, { duration: .5 });
    list.appendChild(li);
  });
}

function openReportModal() {
  if (!fbAuth) { alert('投稿機能を準備中です'); return; }
  const c = meMarker ? meMarker.getLatLng() : map.getCenter();
  if (!reportPin) {
    reportPin = L.marker(c, {
      draggable: true, zIndexOffset: 3000,
      icon: L.divIcon({ className: '', html: '<div class="report-pin">📍ここ</div>', iconSize: [54, 30], iconAnchor: [27, 30] })
    });
    reportPin.on('drag', updateReportLoc);
  } else reportPin.setLatLng(c);
  reportPin.addTo(map);
  updateReportLoc();
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  $('reportTime').value = now.toISOString().slice(0, 16);
  $('reportModal').classList.remove('hidden');
  setSheet(false);
  updateReportAuth();
}
function closeReportModal() { $('reportModal').classList.add('hidden'); if (reportPin) map.removeLayer(reportPin); }
function updateReportLoc() {
  if (!reportPin) return; const ll = reportPin.getLatLng();
  $('reportLoc').textContent = `場所：緯度 ${ll.lat.toFixed(5)}, 経度 ${ll.lng.toFixed(5)}（ピンをドラッグで調整）`;
}
function pinToCurrent() {
  if (meMarker && reportPin) { reportPin.setLatLng(meMarker.getLatLng()); map.panTo(meMarker.getLatLng()); updateReportLoc(); }
  else if (navigator.geolocation && reportPin) navigator.geolocation.getCurrentPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude]; reportPin.setLatLng(ll); map.panTo(ll); updateReportLoc();
  });
}
function updateReportAuth() {
  const el = $('reportAuth'); if (!el) return;
  el.innerHTML = fbUser
    ? `<span class="ok">✓ ${escapeHtml(fbUser.displayName || '')} としてログイン中</span>`
    : `<button id="reportSignIn" class="report-btn primary" style="width:100%">Googleでログインして投稿</button>`;
  const b = $('reportSignIn'); if (b) b.onclick = signIn;
}
async function submitReport() {
  if (!fbUser) { signIn(); return; }
  if (!reportPin) return;
  const ll = reportPin.getLatLng();
  const t = $('reportTime').value;
  if (!t) { alert('目撃した日時を入れてください'); return; }
  try {
    await fbDb.collection('reports').add({
      uid: fbUser.uid,
      displayName: fbUser.displayName || '名無し',
      lat: +ll.lat.toFixed(5), lng: +ll.lng.toFixed(5),
      sightedAt: new Date(t).toISOString(),
      note: ($('reportNote').value || '').slice(0, 200),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'user'
    });
    $('reportNote').value = '';
    closeReportModal();
    alert('投稿しました。ありがとうございます！（未確認として薄く表示され、同じ場所・時間帯の投稿が増えると濃くなります）');
  } catch (e) { alert('投稿に失敗しました: ' + (e.message || e)); }
}

/* ---------- 起動 ---------- */
// データ取得先: ①GitHub raw（10分おきに自動更新される最新版）→ ②同梱コピー（オフライン/フォールバック）
const RAW_DATA = 'https://raw.githubusercontent.com/pasotaro-main/utsunomiya-kuma/main/data/sightings.json';
const DATA_SOURCES = [
  RAW_DATA + '?t=' + Math.floor(Date.now() / 60000), // 1分ごとにキャッシュ回避（最新を取りに行く）
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
  renderStatus();
  renderList();
  renderPrediction();
  renderLegend();
  renderWebReports();
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

  try { initSocial(); } catch (e) { console.warn('投稿機能の初期化に失敗', e); }

  if ('serviceWorker' in navigator) {
    // 新しいSWが有効化されたら自動で1回リロード（更新を確実に届ける）
    let refreshing = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !refreshing) { refreshing = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();
