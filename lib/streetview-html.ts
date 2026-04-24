/**
 * Generates the HTML string for the Street View WebView.
 * Loads Google Maps JS API, creates a StreetViewPanorama with chrome disabled,
 * and exposes updatePosition/setPov callable from RN via injectJavaScript.
 */

export function generateStreetViewHTML(apiKey: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; }
  html, body, #sv { width: 100%; height: 100%; background: #111; }
</style>
</head><body>
<div id="sv"></div>
<script>
  var panorama;
  var ready = false;

  function initStreetView() {
    panorama = new google.maps.StreetViewPanorama(document.getElementById('sv'), {
      pov: { heading: 0, pitch: 0 },
      zoom: 0,
      disableDefaultUI: true,
      showRoadLabels: false,
      linksControl: false,
      panControl: false,
      zoomControl: false,
      addressControl: false,
      fullscreenControl: false,
      motionTracking: false,
      motionTrackingControl: false,
      clickToGo: false,
    });

    panorama.addListener('status_changed', function() {
      var status = panorama.getStatus();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'status',
        status: status,
        hasImagery: status === 'OK',
      }));
    });

    panorama.addListener('position_changed', function() {
      try {
        var sv = new google.maps.StreetViewService();
        sv.getPanorama({ location: panorama.getPosition(), radius: 50 }, function(data) {
          if (data && data.location && data.location.description) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'street_name',
              name: data.location.description,
            }));
          }
        });
      } catch(e) {}
    });

    ready = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  }

  window.updatePosition = function(lat, lng, heading) {
    if (!panorama) return;
    panorama.setPosition({ lat: lat, lng: lng });
    panorama.setPov({ heading: heading, pitch: 0 });
  };
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initStreetView" async defer></script>
</body></html>`;
}
