(function() {
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function preloadImage(url) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() { resolve({ url: url, width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = function() { reject(new Error('Failed to load image ' + url)); };
      img.src = url;
    });
  }

  function showOverlayMessage(text) {
    var el = document.getElementById('bottom-overlay');
    if (!el) return;
    el.textContent = String(text || '');
    el.classList.add('show');
  }

  function init() {
    if (!window.Marzipano) {
      console.error('Marzipano not available');
      return;
    }

    var hasDeviceOrientation = 'DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window;
    
    var panoElement = document.getElementById('pano');
    var viewer = new Marzipano.Viewer(panoElement, {
      controls: { mouseViewMode: 'drag' }
    });

    var gl = document.createElement('canvas').getContext('webgl');
    if (!gl) {
      showOverlayMessage('WebGL is not available on this device/browser.');
      return;
    }
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    function downscaleToMaxWidth(imageUrl, imageWidth, imageHeight, maxWidth) {
      return new Promise(function(resolve, reject) {
        var img = new Image();
        img.onload = function() {
          var scale = Math.min(1, maxWidth / imageWidth);
          var targetW = Math.floor(imageWidth * scale);
          var targetH = Math.floor(imageHeight * scale);
          try {
            var canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetW, targetH);
            var dataUrl = canvas.toDataURL('image/webp', 0.9);
            resolve({ url: dataUrl, width: targetW, height: targetH });
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = function() { reject(new Error('Failed to load original image for downscale')); };
        img.src = imageUrl;
      });
    }

    function makeSourceAndGeometry(imgInfo) {
      var src = Marzipano.ImageUrlSource.fromString(imgInfo.url);
      var geom = new Marzipano.EquirectGeometry([{ width: imgInfo.width }]);
      return { source: src, geometry: geom };
    }

    var images = [
      { id: 'view1', url: 'views/1/img1.webp', initial: { yawDeg: 49.47, pitchDeg: -1.66, fovDeg: 67.10 } },
      { id: 'view2', url: 'views/2/img2.webp', initial: { yawDeg: 91.19, pitchDeg: -0.57, fovDeg: 67.10 } }
    ];

    Promise.all(images.map(function(entry) {
      return preloadImage(entry.url).then(function(info) {
        var proceed = function(imgInfo) {
          var sg = makeSourceAndGeometry(imgInfo);
          return { id: entry.id, initial: entry.initial, img: imgInfo, source: sg.source, geometry: sg.geometry };
        };
        if (info.width > maxTex) {
          return downscaleToMaxWidth(info.url, info.width, info.height, maxTex).then(proceed);
        }
        return proceed(info);
      });
    })).then(function(loaded) {
      function rad(deg) { return deg * Math.PI / 180; }
      var defaultViewParameters = { yaw: 0, pitch: 0, fov: rad(90) };
      var limiter = Marzipano.RectilinearView.limit.hfov(40 * Math.PI / 180, 100 * Math.PI / 180);

      var scenesById = {};
      loaded.forEach(function(item) {
        var initCfg = item.initial || { yawDeg: 0, pitchDeg: 0, fovDeg: 90 };
        var initialParams = { yaw: rad(initCfg.yawDeg), pitch: rad(initCfg.pitchDeg), fov: rad(initCfg.fovDeg) };
        var view = new Marzipano.RectilinearView(initialParams, limiter);
        var scene = viewer.createScene({ source: item.source, geometry: item.geometry, view: view, pinFirstLevel: true });
        scenesById[item.id] = { scene: scene, view: view, initial: initialParams };
      });

      function switchTo(id) {
        var target = scenesById[id];
        if (!target) return;
        target.scene.switchTo({ transitionDuration: 700 });
        target.view.setParameters(target.initial || defaultViewParameters);
        var b1 = document.getElementById('btn-view-1');
        var b2 = document.getElementById('btn-view-2');
        if (id === 'view1') {
          b1.classList.add('active'); b1.setAttribute('aria-selected', 'true');
          b2.classList.remove('active'); b2.setAttribute('aria-selected', 'false');
        } else {
          b2.classList.add('active'); b2.setAttribute('aria-selected', 'true');
          b1.classList.remove('active'); b1.setAttribute('aria-selected', 'false');
        }
      }

      (function addSalonHotspot() {
        var salon = scenesById['view1'];
        if (!salon) return;
        var el = document.createElement('img');
        el.className = 'hotspot-icon';
        el.src = 'assets/icons/ic_nav.svg';
        el.alt = 'Ir al Baño';
        el.addEventListener('click', function() { switchTo('view2'); });
        var pos = { yaw: 1.124835, pitch: 0.116398 };
        salon.scene.hotspotContainer().createHotspot(el, pos);
      })();

      (function addBanoHotspot() {
        var bano = scenesById['view2'];
        if (!bano) return;
        var el = document.createElement('img');
        el.className = 'hotspot-icon';
        el.src = 'assets/icons/ic_nav.svg';
        el.alt = 'Volver al Salón';
        el.addEventListener('click', function() { switchTo('view1'); });
        var pos = { yaw: 1.537769, pitch: 0.145077 };
        bano.scene.hotspotContainer().createHotspot(el, pos);
      })();

      switchTo('view1');

      var gyroBtn = document.getElementById('gyro-btn');
      var resetBtn = document.getElementById('reset-btn');
      var btn1 = document.getElementById('btn-view-1');
      var btn2 = document.getElementById('btn-view-2');

      btn1.addEventListener('click', function() { switchTo('view1'); });
      btn2.addEventListener('click', function() { switchTo('view2'); });

      var controls = viewer.controls();
      var deviceOrientationMethod = null;

      function updateGyroButton(enabled) {
        gyroBtn.textContent = enabled ? 'Disable Gyro' : 'Enable Gyro';
        gyroBtn.setAttribute('aria-pressed', String(enabled));
      }

      function enableGyro() {
        if (!deviceOrientationMethod) {
          try {
            if (typeof DeviceOrientationControlMethod !== 'function') {
              throw new Error('DeviceOrientationControlMethod not found');
            }
            deviceOrientationMethod = new DeviceOrientationControlMethod();
            controls.registerMethod('deviceOrientation', deviceOrientationMethod);
          } catch (e) {
            console.warn('DeviceOrientation control unavailable:', e);
            return false;
          }
        }
        controls.enableMethod('deviceOrientation');
        updateGyroButton(true);
        return true;
      }

      function disableGyro() {
        if (deviceOrientationMethod) {
          controls.disableMethod('deviceOrientation');
          updateGyroButton(false);
        }
      }

      function requestPermissionIfNeeded() {
        var Dio = window.DeviceOrientationEvent;
        var Dmo = window.DeviceMotionEvent;
        var need = (Dio && typeof Dio.requestPermission === 'function') || (Dmo && typeof Dmo.requestPermission === 'function');
        if (!need) return Promise.resolve('granted');

        var req = Dio && typeof Dio.requestPermission === 'function'
          ? Dio.requestPermission()
          : Dmo.requestPermission();

        return req.catch(function(err) {
          console.warn('Permission request failed:', err);
          throw err;
        });
      }

      gyroBtn.addEventListener('click', function() {
        var isEnabled = gyroBtn.getAttribute('aria-pressed') === 'true';
        if (isEnabled) {
          disableGyro();
          return;
        }
        requestPermissionIfNeeded().then(function(result) {
          if (result && result !== 'granted') return;
          enableGyro();
        }).catch(function() {
          // denied -> keep mouse/touch controls
        });
      });

      resetBtn.addEventListener('click', function() {
        var current = viewer.scene();
        if (!current) return;
        // find active scene and animate back to its initial POV
        for (var id in scenesById) {
          var s = scenesById[id];
          if (s.scene === current) {
            var initial = s.initial || defaultViewParameters;
            current.lookTo(initial, { transitionDuration: 600 });
            break;
          }
        }
      });

      // Debug logging removed for production

      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          disableGyro();
        }
      });

      updateGyroButton(false);
      if (typeof DeviceOrientationControlMethod !== 'function') {
        gyroBtn.disabled = true;
        gyroBtn.title = 'Device orientation not supported on this device/browser';
      }
    }).catch(function(err) {
      console.warn(err && err.message ? err.message : err);
      showOverlayMessage('Unable to load panorama image on this device.');
    });
  }

  var primary = 'https://unpkg.com/marzipano@0.10.2/dist/marzipano.js';
  var fallback = 'https://www.marzipano.net/demos/vendor/marzipano.js';
  var deviceOrientationPlugin = 'https://www.marzipano.net/demos/device-orientation/DeviceOrientationControlMethod.js';

  loadScript(primary)
    .catch(function() { return loadScript(fallback); })
    .then(function(){ return loadScript(deviceOrientationPlugin); })
    .then(init)
    .catch(function(err) { console.error(err); });
})();


