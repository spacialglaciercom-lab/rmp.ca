/**
 * Local fallback version of Leaflet map HTML for iOS WebView.
 * This version uses a simple inline approach to avoid CDN dependency issues.
 * Used when CDN loading fails or for offline scenarios.
 */
export function getLeafletRouteMapHTMLLocal(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; font-family: Arial, sans-serif; }
    #map { width: 100%; height: 100%; background: #f0f0f0; position: relative; }
    .map-error { 
      position: absolute; 
      top: 50%; 
      left: 50%; 
      transform: translate(-50%, -50%); 
      text-align: center; 
      padding: 20px; 
      background: white; 
      border-radius: 8px; 
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
    }
    .map-error h3 { color: #333; margin-bottom: 10px; }
    .map-error p { color: #666; margin-bottom: 15px; }
    .retry-button {
      background: #007AFF;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    }
    .retry-button:hover { background: #0056b3; }
    .simple-map {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #e8f4f8;
    }
    .point {
      position: absolute;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #007AFF;
      border: 2px solid white;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
      transform: translate(-50%, -50%);
    }
    .route-line {
      position: absolute;
      background: #007AFF;
      height: 2px;
      transform-origin: left center;
    }
  </style>
</head>
<body>
  <div id="map">
    <div class="simple-map" id="simpleMap">
      <div class="map-error" id="errorMessage">
        <h3>Map Loading</h3>
        <p>Offline map — shows your route and points.</p>
        <button class="retry-button" onclick="retryMapLoad()">Try Online Map</button>
      </div>
    </div>
  </div>
  <script>
    let mapData = null;
    let simpleMapEl = document.getElementById('simpleMap');
    let errorEl = document.getElementById('errorMessage');
    
    function retryMapLoad() {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'retryMapLoad' }));
      }
    }
    
    function renderSimpleMap() {
      if (!mapData) return;
      
      // Hide error message
      if (errorEl) errorEl.style.display = 'none';
      
      // Clear existing content
      const existingPoints = simpleMapEl.querySelectorAll('.point, .route-line');
      existingPoints.forEach(el => el.remove());
      
      // Render collection points
      if (mapData.collectionPoints && mapData.collectionPoints.length > 0) {
        mapData.collectionPoints.forEach((point, index) => {
          const pointEl = document.createElement('div');
          pointEl.className = 'point';
          pointEl.style.left = (20 + (index * 15)) + '%';
          pointEl.style.top = (20 + (index * 10)) + '%';
          pointEl.style.background = getMarkerColor(point.collectionType);
          simpleMapEl.appendChild(pointEl);
        });
      }
      
      // Render route points
      if (mapData.routePoints && mapData.routePoints.length > 1) {
        mapData.routePoints.forEach((point, index) => {
          if (index === 0 || index === mapData.routePoints.length - 1) {
            const pointEl = document.createElement('div');
            pointEl.className = 'point';
            pointEl.style.left = (30 + (index * 40)) + '%';
            pointEl.style.top = (50 + (index * 20)) + '%';
            pointEl.style.background = index === 0 ? '#22c55e' : '#ef4444';
            simpleMapEl.appendChild(pointEl);
          }
        });
      }
    }
    
    function getMarkerColor(collectionType) {
      if (collectionType === 'residential') return '#3b82f6';
      if (collectionType === 'commercial') return '#f59e0b';
      if (collectionType === 'industrial') return '#ef4444';
      return '#6366f1';
    }
    
    // Fallback map data handler
    window.setMapData = function(payload) {
      console.log('Fallback map data received:', payload);
      mapData = typeof payload === 'string' ? JSON.parse(payload) : payload;
      renderSimpleMap();
    };
    
    // Initialize
    setTimeout(function() {
      console.log('Map fallback initialized');
    }, 1000);
  </script>
</body>
</html>
  `;
}

/**
 * Local fallback version for navigation map
 */
export function getLeafletNavigationMapHTMLLocal(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; font-family: Arial, sans-serif; }
    #map { width: 100%; height: 100%; background: #f0f0f0; position: relative; }
    .nav-error { 
      position: absolute; 
      top: 50%; 
      left: 50%; 
      transform: translate(-50%, -50%); 
      text-align: center; 
      padding: 20px; 
      background: white; 
      border-radius: 8px; 
      box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
    }
    .nav-error h3 { color: #333; margin-bottom: 10px; }
    .nav-error p { color: #666; }
    .simple-nav-map {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .nav-point {
      position: absolute;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: white;
      border: 2px solid #333;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 12px;
      transform: translate(-50%, -50%);
    }
    .start-point {
      background: #16A34A;
      color: white;
      border-color: white;
    }
    .end-point {
      background: #ef4444;
      color: white;
      border-color: white;
    }
    .user-location {
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #2563eb;
      border: 3px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      transform: translate(-50%, -50%);
    }
  </style>
</head>
<body>
  <div id="map">
    <div class="simple-nav-map" id="simpleNavMap">
      <div class="nav-error" id="navErrorMessage">
        <h3>Navigation Map</h3>
        <p>Offline mode - Navigation continues with basic guidance</p>
      </div>
    </div>
  </div>
  <script>
    let navMapData = null;
    let userLocationEl = null;
    const simpleNavEl = document.getElementById('simpleNavMap');
    const errorEl = document.getElementById('navErrorMessage');
    
    function renderSimpleNavMap() {
      if (!navMapData) return;
      
      // Hide error message
      if (errorEl) errorEl.style.display = 'none';
      
      // Clear existing content (except error message)
      const existingPoints = simpleNavEl.querySelectorAll('.nav-point, .user-location');
      existingPoints.forEach(el => el.remove());
      
      // Render route points
      if (navMapData.routeCoords && navMapData.routeCoords.length > 1) {
        const first = navMapData.routeCoords[0];
        const last = navMapData.routeCoords[navMapData.routeCoords.length - 1];
        
        // Start marker
        const startEl = document.createElement('div');
        startEl.className = 'nav-point start-point';
        startEl.style.left = '20%';
        startEl.style.top = '50%';
        startEl.textContent = 'S';
        simpleNavEl.appendChild(startEl);
        
        // End marker
        const endEl = document.createElement('div');
        endEl.className = 'nav-point end-point';
        endEl.style.left = '80%';
        endEl.style.top = '50%';
        endEl.textContent = 'E';
        simpleNavEl.appendChild(endEl);
      }
    }
    
    // Fallback navigation functions
    window.setMapData = function(payload) {
      console.log('Fallback navigation map data received:', payload);
      navMapData = payload;
      renderSimpleNavMap();
    };
    
    window.setUserLocation = function(lat, lon, follow) {
      console.log('Fallback user location:', lat, lon, follow);
      
      if (!userLocationEl) {
        userLocationEl = document.createElement('div');
        userLocationEl.className = 'user-location';
        simpleNavEl.appendChild(userLocationEl);
      }
      
      // Simple positioning (in a real app, you'd convert lat/lon to screen coords)
      userLocationEl.style.left = '50%';
      userLocationEl.style.top = '60%';
      
      if (follow) {
        console.log('Following user location (simulated)');
      }
    };
    
    // Initialize
    setTimeout(function() {
      console.log('Navigation fallback initialized');
    }, 1000);
  </script>
</body>
</html>
  `;
}