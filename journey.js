// =============================================
// SafeHer — journey.js  (integrated, compat build)
// Uses the global firebase/auth/db from config.js
// =============================================

// Current logged-in user (set by onAuthStateChanged)
let currentUserName = "User";
let _encKey = null;

const JOURNEY_DOC_ID = "currentJourney";

// ================= 🔐 E2E LOCATION ENCRYPTION =================
function setEncryptionKey(uid) {
  if (typeof CryptoJS === 'undefined') return;
  _encKey = CryptoJS.SHA256(uid + '_safeher_loc_v1').toString();
}

function encryptCoords(lat, lng) {
  if (!_encKey || typeof CryptoJS === 'undefined') return { lat, lng };
  const plain = JSON.stringify({ lat, lng });
  return { enc: CryptoJS.AES.encrypt(plain, _encKey).toString() };
}

function decryptCoords(stored) {
  if (!stored) return { lat: null, lng: null };
  if (stored.enc && _encKey && typeof CryptoJS !== 'undefined') {
    try {
      const bytes = CryptoJS.AES.decrypt(stored.enc, _encKey);
      const plain = bytes.toString(CryptoJS.enc.Utf8);
      return plain ? JSON.parse(plain) : { lat: null, lng: null };
    } catch(e) { return { lat: null, lng: null }; }
  }
  return { lat: stored.lat || null, lng: stored.lng || null };
}

// Emergency contacts loaded dynamically from sessionStorage
let EMERGENCY_CONTACTS = [];

async function loadEmergencyContacts() {
  // 1. Try sessionStorage first (fastest)
  try {
    const stored = sessionStorage.getItem('emergencyContacts');
    if (stored) {
      const parsed = JSON.parse(stored);
      const mapped = parsed.filter(c => c.name).map((c, i) => ({
        id: c.relation ? c.relation.toLowerCase().replace(/\s+/g,'_') : 'contact' + i,
        name: c.name,
        phone: c.phone || '',
        email: c.email || '',
        isParent: c.relation === 'Father' || c.relation === 'Mother'
      }));
      if (mapped.length > 0) {
        EMERGENCY_CONTACTS = mapped;
        renderContactList();
        return;
      }
    }
  } catch(e) {}

  // 2. Fallback: read from Firestore alerts collection
  try {
    const uid = auth.currentUser ? auth.currentUser.uid : null;
    if (!uid || !db) { renderContactList(); return; }
    const snap = await db.collection('alerts')
      .where('fromUid', '==', uid)
      .where('type', '==', 'new_user')
      .get();
    const contacts = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.toName) contacts.push({
        id: (d.relation || 'contact').toLowerCase().replace(/\s+/g,'_'),
        name: d.toName,
        phone: d.plainPhone || '',
        email: d.toEmail || '',
        isParent: d.relation === 'Father' || d.relation === 'Mother'
      });
    });
    if (contacts.length > 0) {
      EMERGENCY_CONTACTS = contacts;
      sessionStorage.setItem('emergencyContacts', JSON.stringify(
        contacts.map(c => ({ name: c.name, relation: c.id, phone: c.phone, email: c.email }))
      ));
    }
  } catch(e) {
    console.warn('Could not load contacts from Firestore:', e);
  }
  renderContactList();
}

function renderContactList() {
  const container = document.getElementById('contactsSection');
  if (!container) return;
  const contacts = EMERGENCY_CONTACTS.length > 0 ? EMERGENCY_CONTACTS : [
    { id: 'contact1', name: 'Emergency Contact 1', isParent: true },
    { id: 'contact2', name: 'Emergency Contact 2', isParent: true }
  ];
  const listHTML = contacts.map(c => `
    <div class="contact-item">
      <div class="c-av">${c.name.charAt(0).toUpperCase()}</div>
      <div><div class="c-name">${c.name}</div><div class="c-role">Emergency Contact</div></div>
      <div class="c-notif" id="notif-${c.id}">✓ Notified</div>
    </div>
  `).join('');
  container.innerHTML = `<div class="s-label">Emergency Contacts</div>${listHTML}`;
}

let journeyActive   = false;
let userLat = null, userLng = null;
let destLat = null, destLng = null;
let timerSeconds    = 0;
let timerInterval   = null;
let watchId         = null;
let routeLine       = null;
let userMarker      = null;
let destMarker      = null;
let noResponseTimer = null;
let deviationWarned = false;
let sosActive       = false;   // true once SOS is confirmed sent — prevents re-trigger
let deviationCountdownInterval = null;
let deviationCountdownSec = 60;
let map             = null;
let destinationName = "";

// ── Shared heatmap / risk zones (same Firestore data map.html writes to) ──
let heatLayer       = null;
let zoneLayers      = [];
let heatmapReports  = [];   // raw report objects from 'heatmap' collection
let verifiedZones   = [];   // admin-confirmed zones from 'dangerZones' collection
let currentZones    = [];   // RiskEngine.mergeVerifiedZones() output

const DEVIATION_M      = 300;
const NO_RESPONSE_SEC  = 120;

// ================= FIREBASE HELPERS =================
async function saveJourneyToFirebase() {
  try {
    if (!journeyActive || !db) return;
    const uid = auth.currentUser ? auth.currentUser.uid : 'anon';
    const userCoords = encryptCoords(userLat, userLng);
    const destCoords = encryptCoords(destLat, destLng);
    await db.collection("journeys").doc(uid).set({
      active: journeyActive,
      userCoords,
      destCoords,
      timerSeconds,
      destinationName,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error("Firebase save error:", err);
  }
}

async function loadJourneyFromFirebase() {
  try {
    if (!db || !auth.currentUser) return null;
    const snap = await db.collection("journeys").doc(auth.currentUser.uid).get();
    if (!snap.exists) return null;
    const data = snap.data();
    if (!data.active) return null;
    const userCoords = decryptCoords(data.userCoords || { lat: data.userLat, lng: data.userLng });
    const destCoords = decryptCoords(data.destCoords || { lat: data.destLat, lng: data.destLng });
    return { ...data, userLat: userCoords.lat, userLng: userCoords.lng, destLat: destCoords.lat, destLng: destCoords.lng };
  } catch (err) {
    console.error("Firebase load error:", err);
    return null;
  }
}

async function clearJourneyFromFirebase() {
  try {
    if (!db || !auth.currentUser) return;
    await db.collection("journeys").doc(auth.currentUser.uid).delete();
  } catch (err) {
    console.error("Firebase delete error:", err);
  }
}

// ── Map ──
function initMap(lat, lng) {
  if (map) {
    map.setView([lat, lng], 15, { animate: true });
    setTimeout(() => map.invalidateSize({ animate: false }), 100);
    return;
  }
  map = L.map('map', {
    zoomControl: true,
    smoothWheelZoom: true,
    smoothSensitivity: 1,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    preferCanvas: true
  }).setView([lat, lng], 15);

  // Dark CartoDB tile — matches SafeHer dark theme perfectly
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Reflow map whenever its container size changes (sidebar toggles, window resize)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(document.getElementById('map'));
  }
  window.addEventListener('resize', () => map.invalidateSize({ animate: false }));
  setTimeout(() => map.invalidateSize({ animate: false }), 200);

  // Map now exists — paint whatever heatmap/zone data has already loaded.
  renderHeatmapAndZones();
}

// ── Shared heatmap (reports made on map.html, shown here too) ──
function loadHeatmapData() {
  if (!db) return;
  db.collection('heatmap').onSnapshot(snapshot => {
    heatmapReports = [];
    snapshot.forEach(doc => {
      const p = doc.data();
      if (p.lat && p.lng) {
        heatmapReports.push({
          lat: parseFloat(p.lat),
          lng: parseFloat(p.lng),
          reason: p.reason || 'Past incident',
          time: p.time || new Date().toISOString()
        });
      }
    });
    renderHeatmapAndZones();
  }, err => {
    console.warn('heatmap read error:', err.message);
    addLog(`⚠️ Couldn't load shared reports (${err.code})`);
  });
}

function loadVerifiedZonesData() {
  if (!db) return;
  db.collection('dangerZones').onSnapshot(snapshot => {
    verifiedZones = [];
    snapshot.forEach(doc => {
      const z = doc.data();
      if (z.lat && z.lng) {
        verifiedZones.push({
          lat: parseFloat(z.lat),
          lng: parseFloat(z.lng),
          radius: z.radius || 180,
          label: z.label || 'Marked unsafe area'
        });
      }
    });
    renderHeatmapAndZones();
  }, err => {
    console.warn('dangerZones read error:', err.message);
    addLog(`⚠️ Couldn't load shared danger zones (${err.code})`);
  });
}

function renderHeatmapAndZones() {
  if (!map || typeof RiskEngine === 'undefined') return;

  if (heatLayer) map.removeLayer(heatLayer);
  if (heatmapReports.length) {
    const pts = RiskEngine.weightedHeatPoints(heatmapReports);
    const maxWeight = Math.max.apply(null, pts.map(p => p[2]).concat([0.05]));
    heatLayer = L.heatLayer(pts, {
      radius: 35, blur: 25, maxZoom: 17, max: maxWeight,
      gradient: { 0.2: '#22c97a', 0.5: '#f5a623', 0.8: '#e84040' }
    }).addTo(map);
  }

  zoneLayers.forEach(l => map.removeLayer(l));
  zoneLayers = [];
  if (!heatmapReports.length && !verifiedZones.length) { currentZones = []; return; }

  const computed = RiskEngine.buildZones(heatmapReports, { epsMeters: 150, minPts: 1 });
  currentZones = RiskEngine.mergeVerifiedZones(computed, verifiedZones);

  currentZones.forEach(z => {
    if (z.verified) {
      const circle = L.circle([z.lat, z.lng], {
        radius: z.radius, color: '#e84040', weight: 3, dashArray: '8,6',
        fillColor: '#e84040', fillOpacity: 0.22
      }).addTo(map).bindPopup(
        `<b>🚫 Marked Unsafe Area</b><br>${z.reasons.join(', ')}`
      ).bindTooltip('🚫 Avoid this area', { permanent: true, direction: 'top', className: 'zone-warn-label' });
      zoneLayers.push(circle);
    } else {
      const color = z.level === 'high' ? '#e84040' : z.level === 'medium' ? '#f5a623' : '#22c97a';
      const label = z.level === 'high' ? '⚠️ High-risk zone' : z.level === 'medium' ? '⚠️ Medium-risk zone' : 'Low-risk zone';
      const c2 = L.circle([z.lat, z.lng], {
        radius: z.radius, color, weight: 2, fillColor: color, fillOpacity: 0.25
      }).addTo(map).bindPopup(
        `<b>${label}</b><br>${z.reportCount} report(s) · ${z.reasons.join(', ')}`
      );
      zoneLayers.push(c2);
    }
  });
}

// ── Warn if the planned route passes near a risk zone ──
function checkRouteRisk() {
  const banner = document.getElementById('riskBanner');
  if (!banner) return;
  if (!routeCoords.length || !currentZones.length || typeof RiskEngine === 'undefined') {
    banner.style.display = 'none';
    return;
  }
  const hits = RiskEngine.routeIntersectsZones(routeCoords, currentZones, 60);
  if (hits.length) {
    const worst = hits[0];
    banner.textContent = `⚠️ Your route passes near a ${worst.zone.level || 'marked'} risk zone (${worst.zone.reasons.join(', ')}). Stay alert.`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function makeIcon(emoji, color) {
  return L.divIcon({
    html: `<div style="background:${color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);">${emoji}</div>`,
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

// ── Location ──
function getCurrentLocation() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej('Geolocation not supported'); return; }
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      e => rej(e.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

async function geocodeDest(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (!data.length) throw new Error('Place not found. Try a more specific name.');
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name };
}

// ── Haversine ──
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  if (!dx && !dy) return haversine(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return haversine(px, py, ax + t * dx, ay + t * dy);
}

// ── Route (real roads via OSRM) ──
let routeCoords = [];       // planned road route segments
let glowLine = null;
let deviatedLine = null;    // red path the user actually took
let rerouteLine = null;     // green reroute from current pos
let reroute_glowLine = null;
let breadcrumbs = [];       // live GPS trail [[lat,lng], ...]

async function drawRoute(sLa, sLo, dLa, dLo) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${sLo},${sLa};${dLo},${dLa}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      routeCoords = coords.map(c => ({ lat: c[0], lng: c[1] }));
      _renderRouteLine(coords);
      return;
    }
  } catch(e) {
    console.warn('OSRM routing failed, using straight line:', e);
  }
  const coords = [[sLa, sLo], [dLa, dLo]];
  routeCoords = coords.map(c => ({ lat: c[0], lng: c[1] }));
  _renderRouteLine(coords);
}

function _renderRouteLine(coords) {
  if (routeLine) map.removeLayer(routeLine);
  if (glowLine) map.removeLayer(glowLine);
  glowLine = L.polyline(coords, { color: '#c84b9e', weight: 12, opacity: 0.15, lineJoin: 'round', lineCap: 'round' }).addTo(map);
  routeLine = L.polyline(coords, { color: '#c84b9e', weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [60, 60], animate: true, duration: 0.8 });
  checkRouteRisk();
}

// ── Deviation ──
function distToRoute(lat, lng) {
  if (!routeCoords || routeCoords.length < 2) {
    // Fallback: check against route line endpoints
    if (!routeLine) return 0;
    const pts = routeLine.getLatLngs();
    if (pts.length < 2) return 0;
    return ptSegDist(lat, lng, pts[0].lat, pts[0].lng, pts[pts.length-1].lat, pts[pts.length-1].lng);
  }
  let minDist = Infinity;
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const d = ptSegDist(lat, lng,
      routeCoords[i].lat, routeCoords[i].lng,
      routeCoords[i+1].lat, routeCoords[i+1].lng);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function checkDeviation(lat, lng) {
  // Only check when a real journey is active, route is drawn, and not already warned
  if (!journeyActive || !routeLine || deviationWarned || sosActive) return;
  // Wait until we have at least 2 breadcrumbs so the first GPS fix doesn't false-fire
  if (breadcrumbs.length < 2) return;
  const dist = distToRoute(lat, lng);
  if (dist > DEVIATION_M) { deviationWarned = true; onDeviation(); }
}

function onDeviation() {
  addLog('⚠️ Route deviation detected — awaiting confirmation');
  setBadge('sos');
  showDeviationOverlay();
}

function showDeviationOverlay() {
  const overlay = document.getElementById('deviationOverlay');
  if (!overlay) return;
  overlay.classList.add('show');
  deviationCountdownSec = 10;
  const countEl = document.getElementById('devCountdown');
  if (countEl) { countEl.textContent = deviationCountdownSec; countEl.className = 'dev-countdown urgent'; }
  clearInterval(deviationCountdownInterval);
  deviationCountdownInterval = setInterval(async () => {
    deviationCountdownSec--;
    if (countEl) {
      countEl.textContent = deviationCountdownSec;
      if (deviationCountdownSec <= 5) countEl.className = 'dev-countdown urgent';
    }
    if (deviationCountdownSec <= 0) {
      clearInterval(deviationCountdownInterval);
      deviationCountdownInterval = null;
      closeDeviationOverlay();
      if (!sosActive) {
        sosActive = true;
        addLog('🆘 No response to deviation — SOS triggered!');
        await notifyAllContacts('deviation');
        setBadge('sos');
        await showDeviationMap();
        showSOSSentBanner();
      }
    }
  }, 1000);
}

function closeDeviationOverlay() {
  const overlay = document.getElementById('deviationOverlay');
  if (overlay) overlay.classList.remove('show');
  clearInterval(deviationCountdownInterval);
  deviationCountdownInterval = null;
}

async function confirmSafe() {
  closeDeviationOverlay();
  addLog('✅ Deviation confirmed safe — recalculating route…');
  setBadge('active');
  showSafeConfirmedBanner();
  // Reroute from current position to destination
  if (userLat && destLat) {
    await drawRoute(userLat, userLng, destLat, destLng);
    addLog('🗺️ Route recalculated from current position');
  }
  // Give a 30s cooldown before deviation can re-trigger (GPS may still be off-route briefly)
  setTimeout(() => { deviationWarned = false; }, 30000);
}

// ── SOS Alert modal — kept for HTML compatibility but no longer used for new flow ──
let sosCountdownInterval = null;

function showSOSAlert() {
  // No-op: SOS now fires directly via triggerSOS() → _fireSOS()
}

function closeSOSAlert() {
  const modal = document.getElementById('sosAlertModal');
  if (modal) modal.classList.remove('show');
  clearInterval(sosCountdownInterval);
  sosCountdownInterval = null;
}

window.cancelSOS = function() {
  closeSOSAlert();
  if (sosActive) return;  // already sent — can't cancel
  deviationWarned = false;
  addLog('🚫 SOS cancelled by user');
  setBadge('active');
  if (userLat && destLat) drawRoute(userLat, userLng, destLat, destLng);
};

// ── Deviation Map — Google Maps style ──
async function showDeviationMap() {
  // 1. Dim original planned route to grey dashed
  if (routeLine) routeLine.setStyle({ color: '#8a7fa8', weight: 4, opacity: 0.5, dashArray: '8 6' });
  if (glowLine)  glowLine.setStyle({ opacity: 0 });

  // 2. Draw actual path user took — red trail
  if (deviatedLine) map.removeLayer(deviatedLine);
  if (breadcrumbs.length >= 2) {
    L.polyline(breadcrumbs, { color: '#e84040', weight: 12, opacity: 0.15, lineJoin: 'round', lineCap: 'round' }).addTo(map);
    deviatedLine = L.polyline(breadcrumbs, { color: '#e84040', weight: 5, opacity: 1, lineJoin: 'round', lineCap: 'round' }).addTo(map);
  }

  // 3. Fetch + draw reroute from current position to destination — green
  if (rerouteLine)      map.removeLayer(rerouteLine);
  if (reroute_glowLine) map.removeLayer(reroute_glowLine);
  if (userLat && destLat) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${destLng},${destLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.[0]) {
        const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        reroute_glowLine = L.polyline(coords, { color: '#22c97a', weight: 12, opacity: 0.15, lineJoin: 'round', lineCap: 'round' }).addTo(map);
        rerouteLine      = L.polyline(coords, { color: '#22c97a', weight: 5,  opacity: 1,    lineJoin: 'round', lineCap: 'round' }).addTo(map);
        addLog('🗺️ Safe reroute shown — follow the green path');
      }
    } catch(e) { console.warn('Reroute fetch failed:', e); }
  }

  // 4. Pulsing red circle marker at deviation point
  if (userLat) {
    L.circleMarker([userLat, userLng], {
      radius: 16, color: '#e84040', fillColor: '#e84040', fillOpacity: 0.2, weight: 3
    }).addTo(map).bindPopup('<b>⚠️ You deviated here</b>').openPopup();
  }

  // 5. Fit map to show original route + deviation + reroute all at once
  const allPoints = [
    ...(routeCoords.length ? routeCoords.map(c => [c.lat, c.lng]) : []),
    ...breadcrumbs
  ];
  if (allPoints.length >= 2) {
    map.fitBounds(L.latLngBounds(allPoints), { padding: [56, 56], animate: true, duration: 1 });
  }
}

// ── Safe Confirmed Banner ──
function showSafeConfirmedBanner() {
  const old = document.getElementById('safeConfirmedBanner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = 'safeConfirmedBanner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:1.5rem;">✅</span>
      <div>
        <div style="font-weight:700;font-size:.95rem;">You're Safe</div>
        <div style="font-size:.78rem;opacity:.85;margin-top:3px;">Route recalculated — continue your journey safely</div>
      </div>
      <button onclick="document.getElementById('safeConfirmedBanner').remove()"
        style="margin-left:auto;background:transparent;border:none;color:inherit;font-size:1.1rem;cursor:pointer;opacity:.7;">✕</button>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#22c97a;color:#0a1a12;padding:16px 20px;border-radius:16px;
    z-index:999;box-shadow:0 8px 32px rgba(34,201,122,.45);
    max-width:380px;width:calc(100% - 40px);
    animation:slideUp .4s cubic-bezier(.22,.68,0,1.2);
    font-family:'DM Sans',sans-serif;font-weight:500;`;
  document.body.appendChild(banner);
  setTimeout(() => { const b = document.getElementById('safeConfirmedBanner'); if (b) b.remove(); }, 5000);
}

// ── SOS Sent Banner ──
function showSOSSentBanner() {
  const old = document.getElementById('sosSentBanner');
  if (old) old.remove();

  const contactNames = EMERGENCY_CONTACTS.length > 0
    ? EMERGENCY_CONTACTS.map(c => `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span style="color:#22c97a;font-size:.85rem;">✓</span><span>${c.name}</span></div>`).join('')
    : '<div style="opacity:.75;font-size:.82rem;margin-top:4px;">All emergency contacts</div>';

  const banner = document.createElement('div');
  banner.id = 'sosSentBanner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <span style="font-size:1.6rem;animation:sosPulse .5s infinite alternate;">🆘</span>
      <div>
        <div style="font-weight:700;font-size:.98rem;letter-spacing:.01em;">SOS Alert Sent</div>
        <div style="font-size:.78rem;opacity:.85;margin-top:2px;">Your location was shared with:</div>
      </div>
    </div>
    <div style="background:rgba(0,0,0,.2);border-radius:10px;padding:10px 12px;font-size:.84rem;font-weight:500;margin-bottom:12px;">
      ${contactNames}
    </div>
    <div style="font-size:.73rem;opacity:.7;margin-bottom:12px;">🔴 Red = your path &nbsp;|&nbsp; 🟣 Purple = planned route &nbsp;|&nbsp; 🟢 Green = safe reroute</div>
    <div style="display:flex;gap:8px;">
      <button onclick="endJourney(false);document.getElementById('sosSentBanner').remove();"
        style="flex:1;padding:10px;border-radius:10px;border:none;background:rgba(255,255,255,.18);color:#fff;font-weight:600;cursor:pointer;font-size:.83rem;font-family:inherit;">
        🛑 End Journey
      </button>
      <button onclick="resumeAfterSOS()"
        style="flex:1.4;padding:10px;border-radius:10px;border:none;background:#fff;color:#c0071a;font-weight:700;cursor:pointer;font-size:.83rem;font-family:inherit;">
        ✅ I'm Safe — Resume
      </button>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#c0071a;color:#fff;padding:18px 20px;border-radius:18px;
    z-index:999;box-shadow:0 8px 40px rgba(192,7,26,.6);
    max-width:420px;width:calc(100% - 40px);
    animation:slideUp .4s cubic-bezier(.22,.68,0,1.2);
    font-family:'DM Sans',sans-serif;`;
  document.body.appendChild(banner);
}

window.resumeAfterSOS = async function() {
  const banner = document.getElementById('sosSentBanner');
  if (banner) banner.remove();
  sosActive = false;
  deviationWarned = false;
  setBadge('active');
  addLog('✅ Resumed — route recalculated from current position');
  if (deviatedLine)     { map.removeLayer(deviatedLine);     deviatedLine = null; }
  if (rerouteLine)      { map.removeLayer(rerouteLine);      rerouteLine = null; }
  if (reroute_glowLine) { map.removeLayer(reroute_glowLine); reroute_glowLine = null; }
  breadcrumbs = [];
  if (userLat && destLat) await drawRoute(userLat, userLng, destLat, destLng);
};

// ── Simulations ──
window.simulateDeviation = async function() {
  if (!userLat || !destLat) { addLog('⚠️ Start a journey first'); return; }

  // Clear any previous sim state
  const oldBanner = document.getElementById('sosSentBanner');
  if (oldBanner) oldBanner.remove();
  if (deviatedLine)     { map.removeLayer(deviatedLine);     deviatedLine = null; }
  if (rerouteLine)      { map.removeLayer(rerouteLine);      rerouteLine = null; }
  if (reroute_glowLine) { map.removeLayer(reroute_glowLine); reroute_glowLine = null; }

  // Build a fake deviated breadcrumb trail:
  // Goes ~0.015° north-west (off the planned route) in 12 steps
  const fakeCrumbs = [];
  const steps = 12;
  const offLat =  0.015;   // northward drift
  const offLng = -0.018;   // westward drift
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Curve away from original path using sine for realism
    const dLat = offLat * t + 0.003 * Math.sin(t * Math.PI * 3);
    const dLng = offLng * t + 0.003 * Math.cos(t * Math.PI * 2);
    fakeCrumbs.push([userLat + dLat, userLng + dLng]);
  }
  breadcrumbs = fakeCrumbs;

  // Move the user marker to the fake deviated end point
  const endPt = fakeCrumbs[fakeCrumbs.length - 1];
  if (userMarker) userMarker.setLatLng(endPt);

  addLog('🧪 Simulating deviation…');
  deviationWarned = true;
  setBadge('sos');

  // Show the full deviation map exactly as it appears in real SOS
  await showDeviationMap();
  showSOSSentBanner();
  addLog('🆘 [SIM] SOS sent — deviation map shown');
};

window.simulateSafeRoute = async function() {
  if (!userLat || !destLat) { addLog('⚠️ Start a journey first'); return; }

  // Clear any deviation sim layers
  const oldBanner = document.getElementById('sosSentBanner');
  if (oldBanner) oldBanner.remove();
  closeDeviationOverlay();
  closeSOSAlert();
  if (deviatedLine)     { map.removeLayer(deviatedLine);     deviatedLine = null; }
  if (rerouteLine)      { map.removeLayer(rerouteLine);      rerouteLine = null; }
  if (reroute_glowLine) { map.removeLayer(reroute_glowLine); reroute_glowLine = null; }
  breadcrumbs = [];
  deviationWarned = false;

  // Redraw the clean planned route in full pink
  await drawRoute(userLat, userLng, destLat, destLng);

  // Animate user marker smoothly along the real route
  setBadge('active');
  addLog('🧪 Simulating safe journey along route…');

  if (routeCoords.length < 2) {
    addLog('ℹ️ Route not loaded yet — try again in a moment');
    return;
  }

  // Pick every 4th coord to animate through quickly
  const steps = routeCoords.filter((_, i) => i % 4 === 0);
  let i = 0;
  const interval = setInterval(() => {
    if (i >= steps.length) {
      clearInterval(interval);
      addLog('✅ [SIM] Safe journey complete — arrived at destination');
      setBadge('idle');
      return;
    }
    const pt = steps[i];
    if (userMarker) userMarker.setLatLng([pt.lat, pt.lng]);
    map.panTo([pt.lat, pt.lng], { animate: true, duration: 0.3 });
    i++;
  }, 350);
};

// ── Watch ──
function startWatch() {
  if (!navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(async pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    userLat = lat; userLng = lng;
    breadcrumbs.push([lat, lng]);
    if (userMarker) { userMarker.setLatLng([lat, lng]); map.panTo([lat, lng], { animate: true, duration: 0.5 }); }
    else {
      userMarker = L.marker([lat, lng], { icon: makeIcon('🙍‍♀️', '#c84b9e') })
        .addTo(map).bindPopup('<b>You</b>');
    }
    checkDeviation(lat, lng);
    await saveJourneyToFirebase();
    if (destLat && journeyActive && haversine(lat, lng, destLat, destLng) < 50) {
      addLog('📍 Arrived at destination!');
      endJourney(true);
    }
  }, e => addLog('📡 ' + e.message), { enableHighAccuracy: true, maximumAge: 5000 });
}

// ══════════════════════════════════════════════
// ── EMAIL via EmailJS ──
// Sign up free at https://emailjs.com
// Replace the three constants below with your
// EmailJS Public Key, Service ID, and Template ID
// ══════════════════════════════════════════════
const EMAILJS_PUBLIC_KEY  = 'MGmHO2t5iJvz_iUqq';   // e.g. 'user_xxxxxxxxxxxxxxxx'
const EMAILJS_SERVICE_ID  = 'service_pk6bw75';   // e.g. 'service_abc123'
const EMAILJS_TEMPLATE_ID = 'template_ytcnf4u';  // e.g. 'template_xyz789'

// EmailJS template must have these variables:
//   {{to_email}}     — recipient email
//   {{to_name}}      — recipient name
//   {{subject}}      — email subject line
//   {{user_name}}    — SafeHer user's name
//   {{destination}}  — journey destination
//   {{start_time}}   — journey start time
//   {{event_time}}   — time of this event
//   {{location_url}} — Google Maps link (SOS only)
//   {{message}}      — full readable message body

let journeyStartTime = null;   // set when journey begins

function _emailJSReady() {
  return typeof emailjs !== 'undefined'
    && EMAILJS_PUBLIC_KEY !== 'YOUR_EMAILJS_PUBLIC_KEY';
}

async function _sendEmail(toEmail, toName, subject, templateParams) {
  if (!toEmail) { console.warn('No email for', toName); return; }
  if (!_emailJSReady()) {
    console.warn('[SafeHer] EmailJS not configured — skipping email to', toEmail);
    return;
  }
  try {
    await emailjs.send(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      { to_email: toEmail, to_name: toName, subject, ...templateParams },
      EMAILJS_PUBLIC_KEY
    );
    console.log('[SafeHer] Email sent to', toEmail);
  } catch (err) {
    console.error('[SafeHer] EmailJS send failed:', err);
  }
}

// ── Save alert to Firestore ──
async function _saveAlert(contact, type, subject, message, locUrl) {
  if (!db) return;
  try {
    const uid = auth.currentUser ? auth.currentUser.uid : 'anon';
    await db.collection('alerts').add({
      fromUid:     uid,
      fromName:    currentUserName,
      toName:      contact.name,
      toEmail:     contact.email || '',
      toPhone:     contact.phone || '',
      relation:    contact.id,
      type,
      subject,
      message,
      destination: destinationName || '',
      locationUrl: locUrl || null,
      lat:         userLat || null,
      lng:         userLng || null,
      read:        false,
      createdAt:   Date.now()
    });
  } catch (err) {
    console.warn('Firestore alert save failed:', err);
  }
}

// ── Mark contact as notified in the UI ──
function _markNotified(contactId) {
  const el = document.getElementById('notif-' + contactId);
  if (el) el.style.display = 'block';
}

// ══════════════════════════════════════════════
// notifyParents — Journey START and ARRIVED
// Only emails parent contacts (Father / Mother)
// ══════════════════════════════════════════════
async function notifyParents(type) {
  const dest    = destinationName || 'destination';
  const name    = currentUserName;
  const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const parents = EMERGENCY_CONTACTS.filter(c => c.isParent);
  const targets = parents.length > 0 ? parents : EMERGENCY_CONTACTS;

  let subject, message;
  if (type === 'start') {
    journeyStartTime = now;
    subject = `SafeHer — ${name} has started a journey`;
    message =
      `Hi,\n\n` +
      `${name} has started a journey to ${dest} at ${now}.\n\n` +
      `You will receive another email when she arrives safely.\n\n` +
      `— SafeHer`;
  } else {
    const started = journeyStartTime || 'earlier';
    subject = `SafeHer — ${name} has arrived safely ✅`;
    message =
      `Hi,\n\n` +
      `${name} has arrived safely at ${dest}.\n\n` +
      `Journey started: ${started}\n` +
      `Arrived at:      ${now}\n\n` +
      `No issues were detected during the journey.\n\n` +
      `— SafeHer`;
  }

  const templateParams = {
    user_name:    name,
    destination:  dest,
    start_time:   journeyStartTime || now,
    event_time:   now,
    location_url: '',
    message
  };

  for (const c of targets) {
    _markNotified(c.id);
    await _sendEmail(c.email, c.name, subject, templateParams);
    await _saveAlert(c, 'journey_' + type, subject, message, null);
  }

  addLog(`📧 Parents emailed (${type})`);
}

// ══════════════════════════════════════════════
// notifyAllContacts — SOS / Deviation / No-response
// Emails EVERY emergency contact with live location
// ══════════════════════════════════════════════
async function notifyAllContacts(type) {
  const locUrl  = userLat ? `https://maps.google.com/?q=${userLat},${userLng}` : null;
  const now     = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const name    = currentUserName;
  const dest    = destinationName || 'destination';
  const started = journeyStartTime || 'earlier';

  const subjectMap = {
    sos:         `🆘 SOS ALERT — ${name} needs help!`,
    deviation:   `⚠️ ALERT — ${name} has deviated from her route`,
    no_response: `🆘 ALERT — ${name} is not responding`
  };
  const bodyMap = {
    sos:
      `EMERGENCY — ${name} has triggered an SOS alert.\n\n` +
      `Journey: ${dest}\n` +
      `Started: ${started}\n` +
      `Alert time: ${now}\n\n` +
      (locUrl ? `Live location:\n${locUrl}\n\n` : '') +
      `Please contact her immediately or alert emergency services.\n\n— SafeHer`,

    deviation:
      `ALERT — ${name} has moved away from her planned route and did not respond.\n\n` +
      `Journey: ${dest}\n` +
      `Started: ${started}\n` +
      `Alert time: ${now}\n\n` +
      (locUrl ? `Last known location:\n${locUrl}\n\n` : '') +
      `Please check on her immediately.\n\n— SafeHer`,

    no_response:
      `ALERT — ${name}'s journey timer has expired and she has not responded.\n\n` +
      `Journey: ${dest}\n` +
      `Started: ${started}\n` +
      `Alert time: ${now}\n\n` +
      (locUrl ? `Last known location:\n${locUrl}\n\n` : '') +
      `Please contact her immediately.\n\n— SafeHer`
  };

  const subject = subjectMap[type] || `🆘 SafeHer Emergency Alert — ${name}`;
  const message = bodyMap[type]    || `Emergency alert for ${name} at ${now}.`;

  const templateParams = {
    user_name:    name,
    destination:  dest,
    start_time:   started,
    event_time:   now,
    location_url: locUrl || 'Location unavailable',
    message
  };

  for (const c of EMERGENCY_CONTACTS) {
    _markNotified(c.id);
    await _sendEmail(c.email, c.name, subject, templateParams);
    await _saveAlert(c, 'journey_' + type, subject, message, locUrl);
  }

  addLog(`📧 All ${EMERGENCY_CONTACTS.length} contacts emailed (${type})`);
}

// ── Timer ──
function startTimer(min) {
  timerSeconds = min * 60;
  clearInterval(timerInterval);
  renderTimer();
  timerInterval = setInterval(async () => {
    timerSeconds--;
    renderTimer();
    await saveJourneyToFirebase();
    if (timerSeconds <= 0) {
      clearInterval(timerInterval); timerInterval = null;
      addLog('⏰ Timer up — awaiting response…');
      startNoResponse();
    }
  }, 1000);
}

function resumeTimerFromSavedSeconds(seconds) {
  timerSeconds = seconds;
  clearInterval(timerInterval);
  renderTimer();
  timerInterval = setInterval(async () => {
    timerSeconds--;
    renderTimer();
    await saveJourneyToFirebase();
    if (timerSeconds <= 0) {
      clearInterval(timerInterval); timerInterval = null;
      addLog('⏰ Timer up — awaiting response…');
      startNoResponse();
    }
  }, 1000);
}

function renderTimer() {
  const el = document.getElementById('timerDisplay');
  if (!el) return;
  const m = Math.floor(Math.abs(timerSeconds) / 60);
  const s = Math.abs(timerSeconds) % 60;
  el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.className = 'timer-display' + (timerSeconds <= 0 ? ' danger' : timerSeconds <= 60 ? ' warn' : '');
}

function startNoResponse() {
  noResponseTimer = setTimeout(async () => {
    if (journeyActive) {
      addLog('🆘 No response — Auto SOS!');
      await notifyAllContacts('no_response');
      setBadge('sos');
    }
  }, NO_RESPONSE_SEC * 1000);
}

async function extendTime() {
  timerSeconds += 300;
  addLog('⏱️ +5 minutes added');
  renderTimer();
  if (noResponseTimer) { clearTimeout(noResponseTimer); noResponseTimer = null; }
  if (!timerInterval) {
    timerInterval = setInterval(async () => {
      timerSeconds--;
      renderTimer();
      await saveJourneyToFirebase();
      if (timerSeconds <= 0) { clearInterval(timerInterval); timerInterval = null; startNoResponse(); }
    }, 1000);
  }
  await saveJourneyToFirebase();
}

// ── Start ──
async function startJourney() {
  const destQ = document.getElementById('destInput').value.trim();
  const etaM = parseInt(document.getElementById('etaInput').value);
  if (!destQ) { alert('Enter a destination.'); return; }
  if (!etaM || etaM < 1) { alert('Enter estimated travel time.'); return; }

  const btn = document.getElementById('startBtn');
  btn.textContent = '📡 Locating…';
  btn.disabled = true;

  try {
    const loc = await getCurrentLocation();
    userLat = loc.lat; userLng = loc.lng;
    document.getElementById('startInput').value = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
    const dest = await geocodeDest(destQ);
    destLat = dest.lat; destLng = dest.lng;
    destinationName = destQ;

    initMap(userLat, userLng);
    if (userMarker) map.removeLayer(userMarker);
    if (destMarker) map.removeLayer(destMarker);

    userMarker = L.marker([userLat, userLng], { icon: makeIcon('🙍‍♀️', '#c84b9e') })
      .addTo(map).bindPopup('<b>You</b>').openPopup();
    destMarker = L.marker([destLat, destLng], { icon: makeIcon('🏁', '#22c97a') })
      .addTo(map).bindPopup(`<b>Destination</b><br>${dest.name.split(',').slice(0, 2).join(',')}`);
    await drawRoute(userLat, userLng, destLat, destLng);

    journeyActive = true;
    document.getElementById('setupSection').style.display = 'none';
    document.getElementById('timerSection').style.display = 'block';
    const ss = document.getElementById('simSection');
    if (ss) ss.style.display = 'block';
    setBadge('active');
    // Re-render map after sidebar DOM changes to prevent layout collapse
    setTimeout(() => { if (map) map.invalidateSize({ animate: false }); }, 150);

    startWatch();
    startTimer(etaM);
    await notifyParents('start');

    addLog(`🗺️ Journey → ${destQ}`);
    addLog(`⏱️ ETA ${etaM} min`);

    await saveJourneyToFirebase();
    btn.textContent = '🗺️ Start Journey';
    btn.disabled = false;
  } catch (err) {
    alert('Error: ' + err);
    btn.textContent = '🗺️ Start Journey';
    btn.disabled = false;
  }
}

// ── End ──
async function endJourney(arrived = true) {
  if (!journeyActive) return;
  journeyActive = false;
  sosActive = false;
  deviationWarned = false;
  clearInterval(timerInterval); timerInterval = null;
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (noResponseTimer) { clearTimeout(noResponseTimer); noResponseTimer = null; }
  closeDeviationOverlay();
  closeSOSAlert();
  await clearJourneyFromFirebase();

  if (arrived) {
    await notifyParents('arrived');
    addLog('✅ Arrived safely');
    setBadge('idle');
    showArrivedBanner();
  } else {
    setBadge('idle');
    addLog('🛑 Journey ended');
  }

  // Reset UI back to setup
  document.getElementById('timerSection').style.display = 'none';
  const ss = document.getElementById('simSection');
  if (ss) ss.style.display = 'none';
  document.getElementById('setupSection').style.display = 'block';
}

function showArrivedBanner() {
  const old = document.getElementById('arrivedBanner');
  if (old) old.remove();

  const contactNames = EMERGENCY_CONTACTS.length > 0
    ? EMERGENCY_CONTACTS.map(c =>
        `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
           <span style="color:#0a1a12;font-size:.85rem;opacity:.7;">✓</span>
           <span>${c.name} notified</span>
         </div>`).join('')
    : '<div style="opacity:.75;font-size:.82rem;margin-top:4px;">All emergency contacts notified</div>';

  const banner = document.createElement('div');
  banner.id = 'arrivedBanner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      <span style="font-size:1.6rem;">✅</span>
      <div>
        <div style="font-weight:700;font-size:.98rem;">You Arrived Safely!</div>
        <div style="font-size:.78rem;opacity:.8;margin-top:2px;">Your contacts have been informed</div>
      </div>
    </div>
    <div style="background:rgba(0,0,0,.12);border-radius:10px;padding:10px 12px;font-size:.84rem;font-weight:500;margin-bottom:14px;">
      ${contactNames}
    </div>
    <button onclick="location.href='home.html'"
      style="width:100%;padding:12px;border-radius:12px;border:none;background:#0a1a12;color:#22c97a;
             font-weight:700;cursor:pointer;font-size:.88rem;font-family:inherit;">
      ← Back to Dashboard
    </button>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#22c97a;color:#0a1a12;padding:20px;border-radius:18px;
    z-index:999;box-shadow:0 8px 40px rgba(34,201,122,.5);
    max-width:380px;width:calc(100% - 40px);
    animation:slideUp .4s cubic-bezier(.22,.68,0,1.2);
    font-family:'DM Sans',sans-serif;`;
  document.body.appendChild(banner);
}

// ── SOS (manual trigger) ──
function triggerSOS() {
  if (sosActive) return;          // already sent — ignore duplicate taps
  sosActive = true;
  closeDeviationOverlay();
  closeSOSAlert();
  _fireSOS();
}

async function _fireSOS() {
  await notifyAllContacts('sos');
  addLog('🆘 SOS SENT — all contacts alerted with your location');
  setBadge('sos');
  await showDeviationMap();
  showSOSSentBanner();
  // Mark all contacts as notified in the sidebar
  EMERGENCY_CONTACTS.forEach(c => _markNotified(c.id));
}

// ── Helpers ──
function setBadge(state) {
  const el = document.getElementById('headerBadge');
  const map_ = { active: ['badge-active', 'Journey Active'], sos: ['badge-sos', 'SOS Active'], idle: ['badge-idle', 'Idle'] };
  const [cls, label] = map_[state] || map_.idle;
  el.className = `badge ${cls}`;
  el.innerHTML = `<span class="badge-dot"></span> ${label}`;
}

function addLog(msg) {
  const list = document.getElementById('logList');
  if (list.children.length === 1 && list.children[0].style.color) list.innerHTML = '';
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const el = document.createElement('div');
  el.className = 'log-item';
  el.innerHTML = `<span class="log-t">${t}</span><span class="log-m">${msg}</span>`;
  list.prepend(el);
}

// Expose to HTML onclick handlers
window.startJourney = startJourney;
window.extendTime = extendTime;
window.endJourney = endJourney;
window.triggerSOS = triggerSOS;
window.confirmSafe = confirmSafe;
window.cancelSOS = cancelSOS;
window.simulateDeviation = window.simulateDeviation;
window.simulateSafeRoute = window.simulateSafeRoute;

// ── Boot ──
window.addEventListener('DOMContentLoaded', () => {
  // Use global auth from config.js (compat build)
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUserName = sessionStorage.getItem('userName')
        || user.displayName
        || (user.email ? user.email.split('@')[0] : null)
        || "User";
      setEncryptionKey(user.uid);
    } else {
      location.href = 'index.html';
      return;
    }

    loadEmergencyContacts();
    loadHeatmapData();
    loadVerifiedZonesData();

    const savedJourney = await loadJourneyFromFirebase();
    if (savedJourney) {
      journeyActive = true;
      userLat = savedJourney.userLat; userLng = savedJourney.userLng;
      destLat = savedJourney.destLat; destLng = savedJourney.destLng;
      timerSeconds = savedJourney.timerSeconds || 0;
      destinationName = savedJourney.destinationName || "Saved Destination";

      initMap(userLat, userLng);
      userMarker = L.marker([userLat, userLng], { icon: makeIcon('🙍‍♀️', '#c84b9e') })
        .addTo(map).bindPopup('<b>You</b>').openPopup();
      destMarker = L.marker([destLat, destLng], { icon: makeIcon('🏁', '#22c97a') })
        .addTo(map).bindPopup(`<b>Destination</b><br>${destinationName}`);
      await drawRoute(userLat, userLng, destLat, destLng);

      document.getElementById('startInput').value = `${userLat.toFixed(5)}, ${userLng.toFixed(5)}`;
      document.getElementById('destInput').value = destinationName;
      document.getElementById('setupSection').style.display = 'none';
      document.getElementById('timerSection').style.display = 'block';
      const ss = document.getElementById('simSection');
      if (ss) ss.style.display = 'block';
      setBadge('active');
      addLog(`🔁 Restored journey for ${currentUserName}`);
      startWatch();
      resumeTimerFromSavedSeconds(timerSeconds);
      return;
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(p => {
        initMap(p.coords.latitude, p.coords.longitude);
        L.marker([p.coords.latitude, p.coords.longitude], { icon: makeIcon('🙍‍♀️', '#c84b9e') })
          .addTo(map).bindPopup(`<b>${currentUserName}</b>`).openPopup();
        document.getElementById('startInput').value = `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`;
      }, () => initMap(13.0827, 80.2707));
    } else {
      initMap(13.0827, 80.2707);
    }
  });
});
