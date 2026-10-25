// Saitrack (RYTT) / CampusRide SPA Router Coordinator and Global WebSocket Linkages

const globalState = {
  token: null,
  user: null,
  socket: null,
  config: null,
  routes: [],
  stops: [],
  wsReconnectAttempts: 0,
  wsReconnectTimer: null
};

// Start routing check on window load
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Fetch system configuration (campus coordinates, demo mode flag, map tile settings)
  await fetchSystemConfig();

  // 2. Check if active session token exists
  const loggedIn = checkAuthSession();
  if (!loggedIn) {
    routeToView('auth');
  }

  // 3. Handle window resizing to keep Leaflet maps responsive
  window.addEventListener('resize', debounceMapResize, { passive: true });
});

async function fetchSystemConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      globalState.config = await res.json();
      renderConfigBadges();
    }
  } catch (err) {
    console.warn('Could not fetch server config, using defaults:', err);
    globalState.config = {
      campus: {
        name: 'Sri Sairam Engineering College',
        latitude: 12.9601,
        longitude: 80.0574
      },
      demoMode: true,
      map: {
        tileLayerUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
      }
    };
  }
}

function renderConfigBadges() {
  const brandSub = document.querySelector('.logo span span');
  if (brandSub && globalState.config) {
    if (globalState.config.demoMode) {
      brandSub.innerHTML = `RYTT <span class="demo-mode-pill" style="font-size:0.65rem; margin-left:6px;">DEMO DATA</span>`;
    }
  }
}

function debounceMapResize() {
  clearTimeout(window._mapResizeTimeout);
  window._mapResizeTimeout = setTimeout(() => {
    if (studentMap) studentMap.invalidateSize();
    if (parentMap) parentMap.invalidateSize();
    if (adminFleetMap) adminFleetMap.invalidateSize();
    if (adminDesignerMap) adminDesignerMap.invalidateSize();
  }, 200);
}

// SPA view switcher
function routeToView(viewName) {
  const viewAuth = document.getElementById('view-auth');
  const viewStudent = document.getElementById('view-student');
  const viewParent = document.getElementById('view-parent');
  const viewAdmin = document.getElementById('view-admin');

  // Hide all
  if (viewAuth) viewAuth.style.display = 'none';
  if (viewStudent) viewStudent.style.display = 'none';
  if (viewParent) viewParent.style.display = 'none';
  if (viewAdmin) viewAdmin.style.display = 'none';

  // Clean maps to prevent Leaflet container overlap
  if (studentMap) { studentMap.remove(); studentMap = null; }
  if (parentMap) { parentMap.remove(); parentMap = null; }
  if (adminFleetMap) { adminFleetMap.remove(); adminFleetMap = null; }
  if (adminDesignerMap) { adminDesignerMap.remove(); adminDesignerMap = null; }

  // Show active view and trigger bootstrap loaders
  if (viewName === 'auth') {
    if (viewAuth) viewAuth.style.display = 'flex';
  } else if (viewName === 'student') {
    if (viewStudent) {
      viewStudent.style.display = 'block';
      initStudentDashboard();
    }
  } else if (viewName === 'parent') {
    if (viewParent) {
      viewParent.style.display = 'block';
      initParentDashboard();
    }
  } else if (viewName === 'admin') {
    if (viewAdmin) {
      viewAdmin.style.display = 'block';
      initAdminDashboard();
    }
  }

  // Allow layout calculation then invalidate map sizes
  setTimeout(() => {
    debounceMapResize();
  }, 350);
}

// ----------------------------------------------------
// WEBSOCKET SUBSCRIBER TUNNEL WITH AUTO-RECONNECT
// ----------------------------------------------------
function initWebSocket() {
  if (globalState.wsReconnectTimer) {
    clearTimeout(globalState.wsReconnectTimer);
    globalState.wsReconnectTimer = null;
  }

  if (globalState.socket) {
    try {
      globalState.socket.onclose = null;
      globalState.socket.close();
    } catch (e) {}
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  console.log(`Connecting WebSocket to ${wsUrl}...`);
  try {
    globalState.socket = new WebSocket(wsUrl);
  } catch (err) {
    console.error('WebSocket initial instantiation failed:', err);
    scheduleWebSocketReconnect();
    return;
  }

  globalState.socket.onopen = () => {
    console.log('Saitrack / CampusRide real-time WebSocket channel established.');
    globalState.wsReconnectAttempts = 0;
  };

  globalState.socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // 1. Bus coordinate movement telemetries
      if (data.type === 'bus_location') {
        if (globalState.user && globalState.user.role === 'student') {
          handleStudentSocketBusUpdate(data);
        } else if (globalState.user && globalState.user.role === 'parent') {
          handleParentSocketBusUpdate(data);
        } else if (globalState.user && globalState.user.role === 'admin' && typeof adminActivePanel !== 'undefined' && adminActivePanel === 'fleet') {
          handleAdminSocketBusUpdate(data);
        }
      }

      // 2. Geofence Proximity Alert triggers
      else if (data.type === 'proximity_alert') {
        if (globalState.user && globalState.user.role === 'parent') {
          handleParentProximityAlert(data);
        } else if (globalState.user && globalState.user.role === 'student' && globalState.user.id === data.studentId) {
          pushStudentNotificationLog('📍 Proximity Geofence', data.message);
          showNotification('Proximity Alert', data.message);
        }
      }

      // 3. Emergency Panic Signal triggers
      else if (data.type === 'emergency_alert') {
        if (globalState.user && globalState.user.role === 'admin') {
          handleAdminPanicAlertPropagation(data);
        } else if (globalState.user && globalState.user.role === 'parent') {
          handleParentPanicAlert(data);
        }
      }

      // 4. Alert updates resolved notifications
      else if (data.type === 'alert_status_changed') {
        if (globalState.user && globalState.user.role === 'admin') {
          refreshAdminMetrics();
          loadAdminAttendanceRegister();
        }
      }

      // 5. RFID Boarding Real-time updates
      else if (data.type === 'rfid_boarded') {
        const title = data.is_hardware_rfid ? '💳 UHF RFID Reader Detected' : '💳 ID Card Scanned';
        showNotification(title, `${data.studentName} has boarded Bus ${data.busNumber} at Stop: ${data.stopName}!`);
        playBoardingChime();

        if (globalState.user && globalState.user.role === 'student') {
          if (globalState.user.id === data.studentId) {
            pushStudentNotificationLog('💳 Boarding Logged', `Your RFID ID Card was scanned on Bus ${data.busNumber} at ${data.stopName}. Status: Present.`);
          } else {
            pushStudentNotificationLog('🏫 Co-Rider Boarded', `${data.studentName} boarded Bus ${data.busNumber} at ${data.stopName}.`);
          }
          initStudentDashboard();
        } else if (globalState.user && globalState.user.role === 'parent') {
          initParentDashboard();
        } else if (globalState.user && globalState.user.role === 'admin') {
          refreshAdminMetrics();
          loadAdminAttendanceRegister();
        }
      }

      // 6. Admin Manual override sync
      else if (data.type === 'attendance_override') {
        showNotification('📅 Attendance Modified', `The administrator has updated the check-in register logs.`);
        playBoardingChime();

        if (globalState.user && globalState.user.role === 'student') {
          initStudentDashboard();
        } else if (globalState.user && globalState.user.role === 'parent') {
          initParentDashboard();
        } else if (globalState.user && globalState.user.role === 'admin') {
          refreshAdminMetrics();
          loadAdminAttendanceRegister();
        }
      }

    } catch (err) {
      console.error('Socket message parse error:', err);
    }
  };

  globalState.socket.onclose = () => {
    console.log('Saitrack WebSocket channel disconnected. Scheduling reconnect...');
    scheduleWebSocketReconnect();
  };

  globalState.socket.onerror = (err) => {
    console.warn('WebSocket connection encountered an error:', err);
  };
}

function scheduleWebSocketReconnect() {
  if (globalState.wsReconnectTimer) return;
  globalState.wsReconnectAttempts++;
  // Exponential backoff: 1s, 2s, 4s, 8s, capped at 15s
  const delay = Math.min(1000 * Math.pow(2, globalState.wsReconnectAttempts - 1), 15000);
  console.log(`WebSocket reconnect attempt #${globalState.wsReconnectAttempts} in ${delay}ms...`);
  globalState.wsReconnectTimer = setTimeout(() => {
    globalState.wsReconnectTimer = null;
    initWebSocket();
  }, delay);
}

// ----------------------------------------------------
// WEB AUDIO API SYNTHESIZER CHIME
// ----------------------------------------------------
function playBoardingChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const playBeep = (freq, startTime, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playBeep(880, now, 0.12);
    playBeep(987, now + 0.14, 0.18);
  } catch (err) {}
}

// Push notification directly to student feed widget
function pushStudentNotificationLog(title, msg) {
  const container = document.getElementById('student-notifications');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'notification-item';
  item.innerHTML = `
    <div>📍</div>
    <div>
      <p style="font-weight:600; color:var(--accent-indigo);">${title}</p>
      <p style="margin-top:2px;">${msg}</p>
      <span class="notification-time">Just now</span>
    </div>
  `;
  container.prepend(item);
}

// ----------------------------------------------------
// TOAST BANNER NOTIFICATION POPUPS SYSTEM
// ----------------------------------------------------
function showNotification(title, message) {
  let container = document.getElementById('saitrack-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'saitrack-toast-container';
    container.style.position = 'fixed';
    container.style.top = '90px';
    container.style.right = '25px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'glass-panel';
  toast.style.padding = '14px 20px';
  toast.style.minWidth = '300px';
  toast.style.maxWidth = '380px';
  toast.style.background = 'rgba(16, 22, 42, 0.96)';
  toast.style.border = '1px solid rgba(99, 102, 241, 0.35)';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  toast.style.borderRadius = '12px';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '12px';
  toast.style.animation = 'fadeIn 0.3s ease-out forwards';

  toast.innerHTML = `
    <div style="font-size: 1.4rem;">🔔</div>
    <div>
      <h4 style="font-size:0.88rem; font-weight:700; color:#fff;">${title}</h4>
      <p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px; line-height:1.3;">${message}</p>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease-in reverse forwards';
    setTimeout(() => {
      if (toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 300);
  }, 5000);
}
