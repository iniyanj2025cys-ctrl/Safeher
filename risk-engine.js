/**
 * risk-engine.js — SafeHer shared risk scoring module
 * Unsupervised, fully client-side. No training data required.
 *
 * Pipeline:
 *   raw report  ->  computeWeight()  ->  weighted heat point [lat,lng,weight]
 *   raw reports ->  buildZones()     ->  DBSCAN clusters -> risk zones (low/medium/high)
 *   route + zones -> routeIntersectsZones() -> proximity warnings
 *
 * Used by both map.html (reporting + heatmap) and journey.js (live route risk check),
 * so weighting/clustering logic is defined once and stays consistent everywhere.
 */
(function (global) {

  // -- Base severity per report reason -------------------------
  // Tune these -- they're the only "hand-picked" numbers in the whole engine.
  const SEVERITY_MAP = {
    'Past incident':        1.0,
    'Suspicious activity':  0.85,
    'Isolated road':        0.7,
    'Forest area':          0.7,
    'Poor lighting':        0.55
  };
  const DEFAULT_SEVERITY = 0.6;

  // -- Haversine distance in meters ----------------------------
  function haversine(la1, lo1, la2, lo2) {
    const R = 6371000, r = Math.PI / 180;
    const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // -- Exponential time decay -----------------------------------
  // Half-life of 21 days: a report is half as influential after 3 weeks.
  function decayFactor(reportTime, now, halfLifeDays) {
    halfLifeDays = halfLifeDays || 21;
    const ageDays = Math.max(0, (now - reportTime) / 86400000);
    return Math.pow(0.5, ageDays / halfLifeDays);
  }

  // -- Circular time-of-day relevance (Gaussian kernel) ----------
  // A report from 11pm matters more right now if it's also ~11pm now.
  // Wraps around midnight correctly (23:00 and 00:00 are "close").
  function timeOfDayFactor(reportTime, now, sigmaHours) {
    sigmaHours = sigmaHours || 3;
    const reportHour = reportTime.getHours() + reportTime.getMinutes() / 60;
    const nowHour    = now.getHours() + now.getMinutes() / 60;
    let diff = Math.abs(reportHour - nowHour);
    diff = Math.min(diff, 24 - diff);
    return Math.exp(-(diff * diff) / (2 * sigmaHours * sigmaHours));
  }

  // -- Combined weight for a single report, at a given moment ----
  // floor (0.4) so an old/off-hour report doesn't vanish to ~0 -- it's still
  // somewhat relevant, just deprioritized vs a fresh, well-timed one.
  function computeWeight(report, now, opts) {
    now = now || new Date();
    opts = opts || {};
    const reportTime = new Date(report.time);
    const severity = SEVERITY_MAP[report.reason] !== undefined
      ? SEVERITY_MAP[report.reason] : DEFAULT_SEVERITY;

    const decay = decayFactor(reportTime, now, opts.halfLifeDays);
    const tod   = timeOfDayFactor(reportTime, now, opts.sigmaHours);

    const weight = severity * decay * (0.4 + 0.6 * tod);
    return Math.max(0, Math.min(1, weight));
  }

  // -- [lat, lng, weight] array for leaflet.heat -----------------
  function weightedHeatPoints(reports, now, opts) {
    now = now || new Date();
    return reports.map(r => [r.lat, r.lng, computeWeight(r, now, opts)]);
  }

  // -- DBSCAN over haversine distance ----------------------------
  // Returns an array of cluster labels (same length/order as points).
  // -1 = noise (not part of any zone), otherwise a 0-indexed cluster id.
  function dbscan(points, epsMeters, minPts) {
    const n = points.length;
    const labels = new Array(n).fill(undefined);

    function regionQuery(idx) {
      const neighbors = [];
      for (let j = 0; j < n; j++) {
        if (haversine(points[idx].lat, points[idx].lng, points[j].lat, points[j].lng) <= epsMeters) {
          neighbors.push(j);
        }
      }
      return neighbors;
    }

    let clusterId = 0;
    for (let i = 0; i < n; i++) {
      if (labels[i] !== undefined) continue;
      const neighbors = regionQuery(i);
      if (neighbors.length < minPts) { labels[i] = -1; continue; }

      labels[i] = clusterId;
      const seeds = neighbors.filter(j => j !== i);
      while (seeds.length) {
        const j = seeds.shift();
        if (labels[j] === -1) labels[j] = clusterId;       // border point reclaimed from noise
        if (labels[j] !== undefined) continue;
        labels[j] = clusterId;
        const jNeighbors = regionQuery(j);
        if (jNeighbors.length >= minPts) {
          jNeighbors.forEach(k => {
            if (labels[k] === undefined || labels[k] === -1) seeds.push(k);
          });
        }
      }
      clusterId++;
    }
    return labels;
  }

  // -- Build risk zones from raw reports -------------------------
  // eps/minPts are DBSCAN params -- eps in meters, minPts = min reports to form a zone.
  function buildZones(reports, opts) {
    opts = opts || {};
    const epsMeters = opts.epsMeters || 150;
    const minPts     = opts.minPts || 2;
    const now        = opts.now || new Date();

    if (!reports.length) return [];

    const weighted = reports.map(r => Object.assign({}, r, { weight: computeWeight(r, now, opts) }));
    const labels = dbscan(weighted, epsMeters, minPts);

    const groups = {};
    labels.forEach((label, i) => {
      if (label === -1 || label === undefined) return;
      (groups[label] = groups[label] || []).push(weighted[i]);
    });

    const zones = Object.keys(groups).map(key => {
      const members = groups[key];
      const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
      const lng = members.reduce((s, m) => s + m.lng, 0) / members.length;
      const totalWeight = members.reduce((s, m) => s + m.weight, 0);
      const avgWeight = totalWeight / members.length;

      let radius = 0;
      members.forEach(m => {
        const d = haversine(lat, lng, m.lat, m.lng);
        if (d > radius) radius = d;
      });
      radius = Math.max(radius + 40, 60); // pad + sensible minimum so single tight clusters still show

      let level = 'low';
      if (totalWeight >= 2.2 || avgWeight >= 0.8) level = 'high';
      else if (totalWeight >= 1.2 || avgWeight >= 0.6) level = 'medium';

      const reasonSet = {};
      members.forEach(m => { reasonSet[m.reason] = true; });

      return {
        lat, lng, radius,
        reportCount: members.length,
        totalWeight: +totalWeight.toFixed(2),
        avgWeight: +avgWeight.toFixed(2),
        level,
        reasons: Object.keys(reasonSet)
      };
    });

    zones.sort((a, b) => b.totalWeight - a.totalWeight);
    return zones;
  }

  // -- Does a planned route pass near any risk zone? --------------
  // routeCoords: array of {lat,lng} OR [lat,lng] pairs.
  // Returns zones within bufferMeters of the route, nearest first.
  function routeIntersectsZones(routeCoords, zones, bufferMeters) {
    bufferMeters = bufferMeters || 50;
    const hits = [];
    zones.forEach(zone => {
      let minDist = Infinity;
      for (let i = 0; i < routeCoords.length; i++) {
        const pt = routeCoords[i];
        const lat = pt.lat !== undefined ? pt.lat : pt[0];
        const lng = pt.lng !== undefined ? pt.lng : pt[1];
        const d = haversine(lat, lng, zone.lat, zone.lng) - zone.radius;
        if (d < minDist) minDist = d;
      }
      if (minDist <= bufferMeters) {
        hits.push({ zone: zone, distanceMeters: Math.max(0, Math.round(minDist)) });
      }
    });
    return hits.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  // -- Merge admin-verified danger zones with computed (DBSCAN) zones -----
  // Verified zones bypass weighting/clustering entirely — they're a small,
  // human-confirmed list (e.g. "this stretch is known unsafe"), always shown
  // as max-severity regardless of report volume or decay. Useful when the
  // unsupervised pipeline alone may not have enough reports yet to form a
  // cluster around a spot you already know is dangerous.
  function mergeVerifiedZones(computedZones, verifiedZones) {
    verifiedZones = verifiedZones || [];
    const forced = verifiedZones.map(v => ({
      lat: v.lat,
      lng: v.lng,
      radius: v.radius || 150,
      reportCount: v.reportCount || 0,
      totalWeight: Infinity,
      avgWeight: 1,
      level: 'high',
      verified: true,
      reasons: [v.label || 'Marked unsafe area']
    }));
    return forced.concat(computedZones || []);
  }

  global.RiskEngine = {
    SEVERITY_MAP: SEVERITY_MAP,
    haversine: haversine,
    computeWeight: computeWeight,
    weightedHeatPoints: weightedHeatPoints,
    dbscan: dbscan,
    buildZones: buildZones,
    routeIntersectsZones: routeIntersectsZones,
    mergeVerifiedZones: mergeVerifiedZones
  };

})(window);
