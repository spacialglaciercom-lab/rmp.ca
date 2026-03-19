/**
 * Self-contained Leaflet map HTML for use inside react-native-webview on native.
 * Loads Leaflet from CDN; exposes setMapData(payload) for updates (map type, bounds, points, route).
 * Sends postMessage to RN: { type: 'mapPress', lat, lon } | { type: 'pointClick', pointId } | { type: 'getTile', z, x, y, id }.
 * Two styles: standard (OSM) and dark (CARTO) — same as web route-map.
 * When offlineSupport is true, tiles are requested via getTile and RN serves cached tiles.
 */
export function getLeafletRouteMapHTML(options?: {
  offlineSupport?: boolean;
}): string {
  const offlineSupport = options?.offlineSupport ?? false;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    #map { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
  <script>
(function() {
  var TILE_STANDARD = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  var TILE_OSM_DIRECT = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIBUTION_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var ATTRIBUTION_DARK = ATTRIBUTION_OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';
  var DEFAULT_CENTER = [45.5, -74.5];
  var DEFAULT_ZOOM = 10;
  var OFFLINE_SUPPORT = ${offlineSupport};

  var currentIsDark = false;
  window.__resolveTile = function(id, dataUrl) {
    var el = document.getElementById('tile-' + id);
    if (!el) return;
    if (dataUrl) {
      el.src = dataUrl;
    } else {
      var parts = id.split('-');
      if (parts.length >= 3) {
        var z = parts[0], x = parts[1], y = parts[2];
        var url = currentIsDark
          ? 'https://a.basemaps.cartocdn.com/dark_all/' + z + '/' + x + '/' + y + '.png'
          : TILE_OSM_DIRECT.replace('{z}', z).replace('{x}', x).replace('{y}', y);
        el.src = url;
      }
    }
  };

  var OfflineTileLayer = L.TileLayer.extend({
    createTile: function(coords, done) {
      var tile = document.createElement('img');
      var id = coords.z + '-' + coords.x + '-' + coords.y;
      tile.id = 'tile-' + id;
      tile.alt = '';
      if (OFFLINE_SUPPORT && window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'getTile', z: coords.z, x: coords.x, y: coords.y, id: id }));
      } else {
        tile.src = this.getTileUrl(coords);
      }
      L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
      L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));
      return tile;
    }
  });

  var map = null;
  var tileLayer = null;
  var routeLine = null;
  var segmentLines = [];
  var markers = [];
  var seqMarkers = [];
  var tapMarker = null;

  function getMarkerColor(collectionType) {
    if (collectionType === 'residential') return '#3b82f6';
    if (collectionType === 'commercial') return '#f59e0b';
    if (collectionType === 'industrial') return '#ef4444';
    return '#6366f1';
  }

  function segmentRiskToColor(riskScore, colors) {
    if (riskScore >= 70) return colors.error || '#ef4444';
    if (riskScore >= 40) return colors.warning || '#ff6b4a';
    return colors.success || '#22c55e';
  }

  function clearOverlays() {
    segmentLines.forEach(function(l) { if (map && l) map.removeLayer(l); });
    segmentLines = [];
    markers.forEach(function(m) { if (map && m) map.removeLayer(m); });
    markers = [];
    seqMarkers.forEach(function(m) { if (map && m) map.removeLayer(m); });
    seqMarkers = [];
    if (tapMarker && map) map.removeLayer(tapMarker);
    tapMarker = null;
    if (routeLine && map) map.removeLayer(routeLine);
    routeLine = null;
  }

  function createSeqIcon(label) {
    return L.divIcon({
      html: '<span style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:#2196F3;color:white;font-size:11px;font-weight:700;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.3);">' + String(label) + '</span>',
      className: 'route-seq-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  function initMap(center, zoom) {
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView(center || DEFAULT_CENTER, zoom || DEFAULT_ZOOM);
    tileLayer = OFFLINE_SUPPORT
      ? new OfflineTileLayer(TILE_STANDARD, { attribution: ATTRIBUTION_OSM })
      : L.tileLayer(TILE_STANDARD, { attribution: ATTRIBUTION_OSM });
    tileLayer.addTo(map);
    map.on('click', function(e) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapPress', lat: e.latlng.lat, lon: e.latlng.lng }));
      }
    });
  }

  window.setMapData = function(payload) {
    if (!payload) return;
    var data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    var isDark = data.mapType === 'dark';
    var center = data.center || DEFAULT_CENTER;
    var zoom = data.zoom != null ? data.zoom : DEFAULT_ZOOM;
    var bounds = data.bounds;
    var colors = data.colors || { primary: '#6366f1', success: '#22c55e', warning: '#ff6b4a', error: '#ef4444' };

    if (!map) {
      initMap(Array.isArray(center) ? center : [center.lat || center[0], center.lng != null ? center.lng : center[1]], zoom);
    }

    if (tileLayer) {
      map.removeLayer(tileLayer);
    }
    currentIsDark = isDark;
    var url = isDark ? TILE_DARK : TILE_STANDARD;
    var attrib = isDark ? ATTRIBUTION_DARK : ATTRIBUTION_OSM;
    tileLayer = OFFLINE_SUPPORT
      ? new OfflineTileLayer(url, { attribution: attrib })
      : L.tileLayer(url, { attribution: attrib });
    tileLayer.addTo(map);

    clearOverlays();

    if (bounds && bounds.length === 2 && bounds[0] && bounds[1]) {
      try {
        var b = L.latLngBounds([bounds[0][0], bounds[0][1]], [bounds[1][0], bounds[1][1]]);
        map.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
      } catch (e) {}
    } else if (Array.isArray(center) && center.length >= 2) {
      map.setView(center, zoom);
    }

    var routePoints = data.routePoints || [];
    var segmentRisks = data.segmentRisks || [];
    if (routePoints.length > 1) {
      if (segmentRisks.length > 0) {
        var riskByIndex = {};
        segmentRisks.forEach(function(s) { riskByIndex[s.segmentIndex] = s.riskScore; });
        for (var i = 0; i < routePoints.length - 1; i++) {
          var risk = riskByIndex[i] || 0;
          var color = segmentRiskToColor(risk, colors);
          var seg = L.polyline([[routePoints[i].lat, routePoints[i].lon], [routePoints[i + 1].lat, routePoints[i + 1].lon]]], { color: color, weight: 4, opacity: 0.9 });
          seg.addTo(map);
          segmentLines.push(seg);
        }
      } else {
        var latlngs = routePoints.map(function(p) { return [p.lat, p.lon]; });
        routeLine = L.polyline(latlngs, { color: colors.primary, weight: 3, opacity: 0.7, dashArray: '5, 5' });
        routeLine.addTo(map);
      }
      routePoints.forEach(function(p, i) {
        if (p.label != null) {
          var m = L.marker([p.lat, p.lon], { icon: createSeqIcon(p.label) }).addTo(map);
          seqMarkers.push(m);
        }
      });
    }

    (data.collectionPoints || []).forEach(function(point) {
      var m = L.marker([point.latitude, point.longitude], { icon: L.divIcon({
        html: '<div style="width:12px;height:12px;border-radius:50%;background:' + getMarkerColor(point.collectionType) + ';border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>',
        className: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      })});
      m.addTo(map);
      m.pointId = point.id;
      m.on('click', function() {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'pointClick', pointId: point.id }));
        }
      });
      markers.push(m);
    });

    if (data.tapDestination) {
      var t = data.tapDestination;
      tapMarker = L.marker([t.lat, t.lon]).addTo(map);
      tapMarker.bindPopup('Directions here');
    }
  };
})();
  </script>
</body>
</html>
`;
}

/**
 * Leaflet map for turn-by-turn navigation (native WebView).
 * setMapData({ mapType, routeCoords, primaryColor, mutedColor, traveledSegmentIndex })
 * setUserLocation(lat, lon, follow) — updates user marker; if follow=true, centers map.
 */
export function getLeafletNavigationMapHTML(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    #map { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
  <script>
(function() {
  var TILE_STANDARD = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_DARK = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  var ATTRIBUTION_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var ATTRIBUTION_DARK = ATTRIBUTION_OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';

  var map = null;
  var tileLayer = null;
  var routeLine = null;
  var traveledLine = null;
  var startMarker = null;
  var endMarker = null;
  var userMarker = null;

  function initMap(center, zoom) {
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView(center || [0, 0], zoom || 14);
    tileLayer = L.tileLayer(TILE_STANDARD, { attribution: ATTRIBUTION_OSM }).addTo(map);
  }

  window.setMapData = function(payload) {
    if (!payload) return;
    var data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    var isDark = data.mapType === 'dark';
    var routeCoords = data.routeCoords || [];
    var primary = data.primaryColor || '#16A34A';
    var muted = data.mutedColor || '#71717a';
    var traveledIndex = data.traveledSegmentIndex != null ? data.traveledSegmentIndex : -1;

    if (!map) {
      var c = routeCoords.length ? [routeCoords[0].latitude || routeCoords[0].lat, routeCoords[0].longitude != null ? routeCoords[0].longitude : routeCoords[0].lon] : [0, 0];
      initMap(c, 15);
    }

    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(isDark ? TILE_DARK : TILE_STANDARD, { attribution: isDark ? ATTRIBUTION_DARK : ATTRIBUTION_OSM }).addTo(map);

    if (routeLine) map.removeLayer(routeLine);
    if (traveledLine) map.removeLayer(traveledLine);
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);

    if (routeCoords.length < 2) return;
    var latlngs = routeCoords.map(function(p) { return [p.latitude != null ? p.latitude : p.lat, p.longitude != null ? p.longitude : p.lon]; });
    // Google Maps-like route styling with gradient effect
    routeLine = L.polyline(latlngs, { 
      color: primary, 
      weight: 8, 
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    
    // Add a subtle glow effect behind the main route line
    var routeGlow = L.polyline(latlngs, { 
      color: primary, 
      weight: 12, 
      opacity: 0.3,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
    
    if (traveledIndex >= 0 && traveledIndex < latlngs.length - 1) {
      var traveled = latlngs.slice(0, traveledIndex + 2);
      traveledLine = L.polyline(traveled, { 
        color: '#4CAF50', // Google Maps green for traveled portion
        weight: 8, 
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(map);
    }
    var first = latlngs[0];
    var last = latlngs[latlngs.length - 1];
    startMarker = L.marker(first, { icon: L.divIcon({ html: '<div style="width:28px;height:28px;border-radius:50%;background:' + primary + ';color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid white;">S</div>', className: '', iconSize: [28,28], iconAnchor: [14,14] }) }).addTo(map);
    endMarker = L.marker(last, { icon: L.divIcon({ html: '<div style="width:28px;height:28px;border-radius:50%;background:#ef4444;color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid white;">E</div>', className: '', iconSize: [28,28], iconAnchor: [14,14] }) }).addTo(map);
    map.fitBounds(L.latLngBounds(latlngs), { padding: [60, 60], maxZoom: 16 });
  };

  window.setUserLocation = function(lat, lon, follow) {
    if (!map) return;
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (userMarker) map.removeLayer(userMarker);
    // Google Maps-like blue dot with accuracy circle
    userMarker = L.circleMarker([lat, lon], {
      radius: 8,
      fillColor: '#4285F4',
      color: '#fff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);
    if (follow) map.setView([lat, lon], Math.max(map.getZoom(), 16));
  };
})();
  </script>
</body>
</html>
`;
}
