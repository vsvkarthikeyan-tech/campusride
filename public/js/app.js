// Saitrack (RYTT) SPA Router Coordinator and Global WebSocket Linkages

const globalState = {
  token: null,
  user: null,
  socket: null,
  routes: [],
  stops: []
};

// Start routing check on window load
window.addEventListener('DOMContentLoaded', () => {
  // Check if session token exists
  const loggedIn = checkAuthSession();
  
  if (!loggedIn) {
    routeToView('auth');
  }
});

// SPA view switcher
function routeToView(viewName) {
  const viewAuth = document.getElementById('view-auth');
  const viewStudent = document.getElementById('view-student');
  const viewParent = document.getElementById('view-parent');
  const viewAdmin = document.getElementById('view-admin');
  
  // Hide all
  viewAuth.style.display = 'none';
  viewStudent.style.display = 'none';
  viewParent.style.display = 'none';
  viewAdmin.style.display = 'none';
  
  // Reset maps to avoid leaflet overlap sizing bugs
  if (studentMap) { studentMap.remove(); studentMap = null; }
  if (parentMap) { parentMap.remove(); parentMap = null; }
  if (adminFleetMap) { adminFleetMap.remove(); adminFleetMap = null; }
  if (adminDesignerMap) { adminDesignerMap.remove(); adminDesignerMap = null; }
  
  // Show active view and trigger bootstrap loaders
  if (viewName === 'auth') {
    viewAuth.style.display = 'flex';
  } else if (viewName === 'student') {
    viewStudent.style.display = 'block';
    initStudentDashboard();
  } else if (viewName === 'parent') {
    viewParent.style.display = 'block';
    initParentDashboard();
  } else if (viewName === 'admin') {
    viewAdmin.style.display = 'block';
    initAdminDashboard();
  }
}

// ----------------------------------------------------
// WEBSOCKET SUBSCRIBER TUNNEL
// ----------------------------------------------------
function initWebSocket() {
  if (globalState.socket) {
    globalState.socket.close();
  }
  
  // Detect protocol and origin
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  
  console.log(`Connecting WebSocket to ${wsUrl}...`);
  globalState.socket = new WebSocket(wsUrl);
  
  globalState.socket.onopen = () => {
    console.log('Saitrack real-time WebSocket channel established.');
  };
  
  globalState.socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // 1. Bus coordinate movement telemetries
      if (data.type === 'bus_location') {
        if (globalState.user.role === 'student') {
          handleStudentSocketBusUpdate(data);
        } else if (globalState.user.role === 'parent') {
          handleParentSocketBusUpdate(data);
        } else if (globalState.user.role === 'admin' && adminActivePanel === 'fleet') {
          handleAdminSocketBusUpdate(data);
        }
      }
      
      // 2. Geofence Proximity Alert triggers
      else if (data.type === 'proximity_alert') {
        if (globalState.user.role === 'parent') {
          handleParentProximityAlert(data);
        } else if (globalState.user.role === 'student' && globalState.user.id === data.studentId) {
          // Push notification directly to student dashboard log feed
          pushStudentNotificationLog('📍 Proximity Geofence', data.message);
          showNotification('Proximity Alert', data.message);
        }
      }
      
      // 3. Emergency Panic Signal triggers
      else if (data.type === 'emergency_alert') {
        if (globalState.user.role === 'admin') {
          handleAdminPanicAlertPropagation(data);
        } else if (globalState.user.role === 'parent') {
          handleParentPanicAlert(data);
        }
      }
      
      // 4. Alert updates resolved notifications
      else if (data.type === 'alert_status_changed') {
        if (globalState.user.role === 'admin') {
          refreshAdminMetrics();
          loadAdminAttendanceRegister();
        }
      }
      
      // 5. RFID Boarding Real-time updates
      else if (data.type === 'rfid_boarded') {
        showNotification('💳 ID Card Boarded', `${data.studentName} has boarded Bus ${data.busNumber} at Stop: ${data.stopName}!`);
        playBoardingChime();
        
        if (globalState.user.role === 'student') {
          if (globalState.user.id === data.studentId) {
            pushStudentNotificationLog('💳 Boarding Scanned', `Your RFID ID Card was scanned on Bus ${data.busNumber} at stop ${data.stopName}. Status: Present.`);
          } else {
            pushStudentNotificationLog('🏫 Co-Rider Boarded', `${data.studentName} boarded Bus ${data.busNumber} at ${data.stopName}.`);
          }
          initStudentDashboard();
        } else if (globalState.user.role === 'parent') {
          initParentDashboard();
        } else if (globalState.user.role === 'admin') {
          refreshAdminMetrics();
          loadAdminAttendanceRegister();
        }
      }
      
      // 6. Admin Manual override sync
      else if (data.type === 'attendance_override') {
        showNotification('📅 Attendance Modified', `The administrator has updated the check-in register logs.`);
        playBoardingChime();
        
        if (globalState.user.role === 'student') {
          initStudentDashboard();
        } else if (globalState.user.role === 'parent') {
          initParentDashboard();
        } else if (globalState.user.role === 'admin') {
          refreshAdminMetrics();
          loadAdminAttendanceRegister();
        }
      }
      
    } catch(err) {
      console.error('Socket message parse error:', err);
    }
  };
  
  globalState.socket.onclose = () => {
    console.log('Saitrack WebSocket channel closed.');
  };
}

// ----------------------------------------------------
// WEB AUDIO API SYNTHESIZER CHIME
// ----------------------------------------------------
function playBoardingChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // Play double beep (880Hz then 987Hz)
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
  } catch (err) {
    console.error('Failed to synthesize chimes:', err);
  }
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
  // Check if a container exists or create one dynamically
  let container = document.getElementById('saitrack-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'saitrack-toast-container';
    container.style.position = 'fixed';
    container.style.top = '100px';
    container.style.right = '30px';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '12px';
    document.body.appendChild(container);
  }
  
  const toast = document.createElement('div');
  toast.className = 'glass-panel';
  toast.style.padding = '15px 24px';
  toast.style.minWidth = '300px';
  toast.style.maxWidth = '400px';
  toast.style.background = 'rgba(16, 22, 42, 0.95)';
  toast.style.border = '1px solid rgba(99, 102, 241, 0.3)';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  toast.style.borderRadius = '12px';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '15px';
  toast.style.animation = 'fadeIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
  
  toast.innerHTML = `
    <div style="font-size: 1.5rem;">🔔</div>
    <div>
      <h4 style="font-size:0.9rem; font-weight:700; color:#fff;">${title}</h4>
      <p style="font-size:0.82rem; color:var(--text-muted); margin-top:2px;">${message}</p>
    </div>
  `;
  
  container.appendChild(toast);
  
  // Slide out after 5.5 seconds
  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease-in reverse forwards';
    setTimeout(() => {
      container.removeChild(toast);
    }, 300);
  }, 5500);
}
