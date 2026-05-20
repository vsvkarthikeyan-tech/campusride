// Student Dashboard Logic Control

let studentMap = null;
let studentBusMarker = null;
let studentStopMarkers = {};
let studentRouteLine = null;
let studentActiveStopGeofence = null;
let studentDashboardData = null;

async function initStudentDashboard() {
  try {
    const res = await fetch('/api/student/dashboard', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load student dashboard');
    
    studentDashboardData = data;
    
    // Set Welcome Header
    document.getElementById('student-welcome-name').textContent = globalState.user.name;
    
    // Load stops list options
    renderBoardingStopsList(data.stops, data.profile.boarding_stop_id);
    
    // Populate stats
    document.getElementById('student-bus-num').textContent = data.profile.busNumber || 'Unassigned';
    
    // Load Payments outstanding amount
    const pendingPay = data.payments.find(p => p.status === 'pending');
    const paymentCard = document.getElementById('payment-card-outstanding');
    const payBtn = document.getElementById('btn-pay-gpay');
    
    if (pendingPay) {
      document.getElementById('outstanding-amount').textContent = `₹${pendingPay.amount.toFixed(2)}`;
      paymentCard.style.background = 'linear-gradient(135deg, rgba(16, 22, 42, 0.95) 0%, rgba(99, 102, 241, 0.15) 100%)';
      paymentCard.style.borderColor = 'rgba(99, 102, 241, 0.2)';
      payBtn.style.display = 'block';
      payBtn.setAttribute('data-payment-id', pendingPay.id);
      payBtn.setAttribute('data-amount', pendingPay.amount);
    } else {
      document.getElementById('outstanding-amount').textContent = '₹0.00';
      paymentCard.style.background = 'linear-gradient(135deg, rgba(16, 22, 42, 0.9) 0%, rgba(16, 185, 129, 0.08) 100%)';
      paymentCard.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      paymentCard.querySelector('span').textContent = 'FEES FULLY PAID';
      paymentCard.querySelector('span').style.background = 'rgba(16, 185, 129, 0.2)';
      paymentCard.querySelector('span').style.color = '#34d399';
      payBtn.style.display = 'none';
    }
    
    // Set Attendance status
    const todayStr = new Date().toISOString().split('T')[0];
    const todayAtt = data.attendance.find(a => a.date === todayStr);
    const attCard = document.getElementById('student-attendance-card');
    const attStatus = document.getElementById('student-attendance-status');
    const attTime = document.getElementById('student-attendance-time');
    
    if (todayAtt) {
      const timeStr = new Date(todayAtt.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      let sourceStr = 'administrator';
      if (todayAtt.marked_by && todayAtt.marked_by.includes('RFID')) {
        sourceStr = todayAtt.marked_by.includes('Device') ? 'RFID Scanner' : 'RFID Manual Tap';
      }
      
      if (todayAtt.status === 1) {
        attCard.querySelector('div').textContent = '🟢';
        attStatus.textContent = 'Marked Present Today';
        attTime.textContent = `Checked in by ${sourceStr} on ${timeStr}`;
      } else {
        attCard.querySelector('div').textContent = '🔴';
        attStatus.textContent = 'Marked Absent Today';
        attTime.textContent = `Absent logged on ${timeStr}`;
      }
    } else {
      attCard.querySelector('div').textContent = '🟡';
      attStatus.textContent = 'Roll Call Pending';
      attTime.textContent = 'Today\'s attendance is not marked yet';
    }
    
    // Overall month percentage
    const presents = data.attendance.filter(a => a.status === 1).length;
    const total = data.attendance.length;
    const percent = total > 0 ? ((presents / total) * 100).toFixed(1) : '100.0';
    document.getElementById('student-attendance-percent').textContent = `${percent}%`;
    if (parseFloat(percent) < 85) {
      document.getElementById('student-attendance-percent').style.color = 'var(--warning)';
    } else {
      document.getElementById('student-attendance-percent').style.color = 'var(--success)';
    }

    // Refresh RFID Scanner Widget status
    const rfidWidget = document.getElementById('rfid-pulse-scanner-widget');
    const rfidTitle = document.getElementById('rfid-scanner-status-title');
    const rfidDesc = document.getElementById('rfid-scanner-status-desc');
    const rfidIcon = document.getElementById('rfid-glowing-icon');
    const rfidBtn = document.getElementById('btn-rfid-simulate-tap');
    
    if (rfidWidget && rfidTitle && rfidDesc && rfidIcon && rfidBtn) {
      if (todayAtt && todayAtt.status === 1) {
        rfidWidget.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        rfidWidget.style.background = 'rgba(16, 185, 129, 0.04)';
        rfidTitle.textContent = 'RFID Card Scanned';
        rfidTitle.style.color = '#34d399';
        const checkinSource = todayAtt.marked_by && todayAtt.marked_by.includes('RFID') ? 'RFID Scanner' : 'Admin override';
        rfidDesc.textContent = `Boarded successfully via ${checkinSource}!`;
        rfidIcon.style.filter = 'drop-shadow(0 0 15px rgba(16, 185, 129, 0.6))';
        rfidIcon.textContent = '🟢';
        
        rfidBtn.disabled = true;
        rfidBtn.style.opacity = '0.5';
        rfidBtn.style.cursor = 'not-allowed';
        rfidBtn.querySelector('span').textContent = 'Boarding Scan Logged';
      } else {
        rfidWidget.style.borderColor = 'rgba(99, 102, 241, 0.3)';
        rfidWidget.style.background = 'rgba(255, 255, 255, 0.02)';
        rfidTitle.textContent = 'RFID Scanner Idle';
        rfidTitle.style.color = '#fff';
        rfidDesc.textContent = 'Ready for scan check-in';
        rfidIcon.style.filter = 'drop-shadow(0 0 10px rgba(99, 102, 241, 0.3))';
        rfidIcon.textContent = '📇';
        
        rfidBtn.disabled = false;
        rfidBtn.style.opacity = '1';
        rfidBtn.style.cursor = 'pointer';
        rfidBtn.querySelector('span').textContent = 'Tap Card to Scan Present';
      }
    }

    // Render co-riders
    renderCoRidersList(data.coRiders);

    // Initialize RFID Click binding
    initRFIDSimulationScanner();

    // Render Past 1 Week Attendance list
    const weeklyListContainer = document.getElementById('student-weekly-list');
    if (weeklyListContainer) {
      weeklyListContainer.innerHTML = '';
      const sortedAttendance = data.attendance
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);
      
      if (sortedAttendance.length === 0) {
        weeklyListContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; text-align: center; padding: 10px;">No attendance logs found.</p>`;
      } else {
        sortedAttendance.forEach(record => {
          const [year, month, day] = record.date.split('-').map(Number);
          const attDate = new Date(year, month - 1, day);
          const dayName = attDate.toLocaleDateString(undefined, { weekday: 'long' });
          const formattedDate = attDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          
          const isPresent = record.status === 1;
          const statusLabel = isPresent ? 'Present' : 'Absent';
          const statusStyle = isPresent 
            ? 'background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2);' 
            : 'background: rgba(239, 68, 68, 0.12); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.2);';
          
          const item = document.createElement('div');
          item.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-glass); border-radius: 10px; transition: var(--transition-smooth);";
          item.onmouseover = () => item.style.background = 'rgba(255, 255, 255, 0.05)';
          item.onmouseout = () => item.style.background = 'rgba(255, 255, 255, 0.02)';
          
          item.innerHTML = `
            <div>
              <p style="font-weight: 600; font-size: 0.88rem; color: var(--text-main); margin: 0;">${dayName}</p>
              <span style="font-size: 0.74rem; color: var(--text-muted);">${formattedDate}</span>
            </div>
            <span style="padding: 3px 8px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; ${statusStyle}">${statusLabel}</span>
          `;
          weeklyListContainer.appendChild(item);
        });
      }
    }
    
    // Initialize leaflet map
    setTimeout(() => {
      initStudentMap(data);
    }, 200);

  } catch (err) {
    console.error('Failed student dashboard init:', err);
  }
}

// ----------------------------------------------------
// CO-RIDERS ATTENDANCE REGISTER RENDERER
// ----------------------------------------------------
function renderCoRidersList(coRiders) {
  const container = document.getElementById('student-coriders-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!coRiders || coRiders.length === 0) {
    container.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No co-riders found on this route.</td></tr>`;
    return;
  }
  
  // Sort co-riders so current student is first, followed by name ascending
  coRiders.sort((a, b) => {
    if (a.student_id === globalState.user.id) return -1;
    if (b.student_id === globalState.user.id) return 1;
    return a.name.localeCompare(b.name);
  });
  
  coRiders.forEach(rider => {
    let statusBadge = '';
    
    if (rider.status === 1) {
      const sourceLabel = rider.marked_by && rider.marked_by.includes('RFID') ? 'RFID' : 'Admin';
      statusBadge = `<span style="background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; display: inline-block;">🟢 Present - ${sourceLabel}</span>`;
    } else if (rider.status === 0) {
      statusBadge = `<span style="background: rgba(239, 68, 68, 0.12); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; display: inline-block;">🔴 Absent</span>`;
    } else {
      statusBadge = `<span style="background: rgba(245, 158, 11, 0.12); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; display: inline-block;">🟡 Roll Call Pending</span>`;
    }
    
    const timeStr = rider.timestamp ? new Date(rider.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--';
    
    const tr = document.createElement('tr');
    tr.style.cssText = "border-bottom: 1px solid var(--border-glass); transition: var(--transition-smooth);";
    tr.onmouseover = () => tr.style.background = 'rgba(255, 255, 255, 0.01)';
    tr.onmouseout = () => tr.style.background = 'transparent';
    
    tr.innerHTML = `
      <td style="padding: 12px 8px; font-weight: 600; color: var(--text-main); font-size: 0.9rem;">
        ${rider.name}
        ${rider.student_id === globalState.user.id ? '<span style="font-size:0.65rem; padding: 2px 6px; background: rgba(99,102,241,0.2); color:#a5b4fc; border-radius:4px; margin-left:8px; font-weight:bold; border:1px solid rgba(99,102,241,0.3)">YOU</span>' : ''}
      </td>
      <td style="padding: 12px 8px; color: var(--text-muted); font-size: 0.84rem;">${rider.class_grade}</td>
      <td style="padding: 12px 8px; color: var(--text-muted); font-size: 0.84rem;">📍 ${rider.stopName}</td>
      <td style="padding: 12px 8px;">${statusBadge}</td>
      <td style="padding: 12px 8px; color: var(--text-muted); font-size: 0.8rem; font-weight: 500;">⏱️ ${timeStr}</td>
    `;
    container.appendChild(tr);
  });
}

// ----------------------------------------------------
// RFID SCANNER SIMULATOR LOGIC
// ----------------------------------------------------
function initRFIDSimulationScanner() {
  const btnTap = document.getElementById('btn-rfid-simulate-tap');
  const widget = document.getElementById('rfid-pulse-scanner-widget');
  
  if (!btnTap || !widget) return;
  
  const triggerScan = async (e) => {
    // Prevent double trigger if clicking both button and card widget
    e.stopPropagation();
    
    if (btnTap.disabled) return;
    
    // Play quick beep (sound synthesizer indicator that scanning started)
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch(err) {}

    // Trigger visual sweep-line animation
    const sweepLine = widget.querySelector('.scanner-sweep-line');
    if (sweepLine) {
      sweepLine.style.display = 'block';
      sweepLine.style.animation = 'scanSweep 1.5s ease-in-out infinite';
    }
    
    const rfidTitle = document.getElementById('rfid-scanner-status-title');
    const rfidDesc = document.getElementById('rfid-scanner-status-desc');
    
    rfidTitle.textContent = 'Scanning ID Card...';
    rfidDesc.textContent = 'Connecting with school database...';
    btnTap.disabled = true;
    btnTap.querySelector('span').textContent = 'Processing Scan...';
    
    // Simulate a brief delay of 1.2 seconds for realistic RFID hardware roundtrip
    setTimeout(async () => {
      try {
        const res = await fetch('/api/student/rfid-tap', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${globalState.token}`
          }
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'RFID scan rejected');
        
        // Hide sweep-line
        if (sweepLine) {
          sweepLine.style.display = 'none';
          sweepLine.style.animation = 'none';
        }
        
      } catch (err) {
        alert(`RFID Scanning Error: ${err.message}`);
        // Reset scanner UI
        if (sweepLine) {
          sweepLine.style.display = 'none';
          sweepLine.style.animation = 'none';
        }
        initStudentDashboard();
      }
    }, 1200);
  };
  
  btnTap.onclick = triggerScan;
  widget.onclick = triggerScan;
}

// Render selector stops
function renderBoardingStopsList(stops, selectedStopId) {
  const container = document.getElementById('student-boarding-list');
  container.innerHTML = '';
  
  if (!stops || stops.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No stops assigned to this route.</p>`;
    return;
  }
  
  // Sort stops by sequence
  stops.sort((a,b) => a.sequence_order - b.sequence_order);
  
  stops.forEach(stop => {
    const isActive = stop.id === selectedStopId;
    const option = document.createElement('div');
    option.className = `boarding-stop-option ${isActive ? 'active' : ''}`;
    option.onclick = () => selectBoardingStop(stop.id);
    
    option.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <input type="radio" name="student-boarding" ${isActive ? 'checked' : ''}>
        <div>
          <p style="font-weight: 600; font-size: 0.92rem;">${stop.name}</p>
          <span style="font-size: 0.76rem; color: var(--text-muted);">Stop Sequence #${stop.sequence_order}</span>
        </div>
      </div>
      <span style="font-size: 0.8rem; font-weight: bold; color: var(--text-muted);">📍</span>
    `;
    container.appendChild(option);
  });
}

// Call API to change boarding stop
async function selectBoardingStop(stopId) {
  try {
    const res = await fetch('/api/student/boarding', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ stopId })
    });
    
    if (!res.ok) throw new Error('API update failed');
    
    // Update local state details
    studentDashboardData.profile.boarding_stop_id = stopId;
    
    // Refresh radio inputs CSS
    renderBoardingStopsList(studentDashboardData.stops, stopId);
    
    // Reposition circle geofence on Map
    const selectedStop = studentDashboardData.stops.find(s => s.id === stopId);
    if (selectedStop && studentMap) {
      const latlng = [selectedStop.latitude, selectedStop.longitude];
      
      if (studentActiveStopGeofence) {
        studentActiveStopGeofence.setLatLng(latlng);
      } else {
        studentActiveStopGeofence = L.circle(latlng, {
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.15,
          radius: 120 // 120 meters geofence radius
        }).addTo(studentMap);
      }
      
      // Pan to boarding stop
      studentMap.setView(latlng, 15);
      showNotification('Boarding Stop', `Boarding stop updated: ${selectedStop.name}`);
    }
  } catch (err) {
    alert(`Failed to select stop: ${err.message}`);
  }
}

// Initialize Leaflet Map
function initStudentMap(data) {
  const container = document.getElementById('student-map');
  
  // Clean map instance
  if (studentMap) {
    studentMap.remove();
    studentMap = null;
    studentBusMarker = null;
    studentStopMarkers = {};
    studentRouteLine = null;
    studentActiveStopGeofence = null;
  }
  
  const boardingStop = data.stops.find(s => s.id === data.profile.boarding_stop_id) || data.stops[0];
  const centerCoord = boardingStop ? [boardingStop.latitude, boardingStop.longitude] : [12.996, 77.572];
  
  studentMap = L.map('student-map', {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView(centerCoord, 14);
  
  // Add dark styled tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(studentMap);
  
  // Drop marker for each stop
  const routePoints = [];
  data.stops.sort((a,b) => a.sequence_order - b.sequence_order);
  
  data.stops.forEach(stop => {
    const latlng = [stop.latitude, stop.longitude];
    routePoints.push(latlng);
    
    const isBoarding = stop.id === data.profile.boarding_stop_id;
    
    // Custom marker style
    const icon = L.divIcon({
      className: 'custom-stop-marker',
      html: `<div style="background: ${isBoarding ? '#10b981' : '#6366f1'}; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
      iconSize: [14, 14]
    });
    
    const marker = L.marker(latlng, { icon }).addTo(studentMap)
      .bindPopup(`<strong style="color:var(--text-dark);">${stop.name}</strong><br><span style="color:#555;">Boarding stop sequence #${stop.sequence_order}</span>`);
    
    studentStopMarkers[stop.id] = marker;
  });
  
  // Draw polyline
  if (routePoints.length > 1) {
    studentRouteLine = L.polyline(routePoints, {
      color: '#6366f1',
      weight: 4,
      opacity: 0.6,
      dashArray: '8, 8'
    }).addTo(studentMap);
  }
  
  // Highlight active stop with geofence circle
  if (boardingStop) {
    studentActiveStopGeofence = L.circle([boardingStop.latitude, boardingStop.longitude], {
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.15,
      radius: 120
    }).addTo(studentMap);
  }
  
  // Pre-draw bus at current database location
  if (data.profile.busLocation && data.profile.busLocation.lat) {
    const busLoc = [data.profile.busLocation.lat, data.profile.busLocation.lng];
    const busIcon = L.divIcon({
      className: 'custom-bus-marker',
      html: `<div style="background: var(--primary-glow); width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; box-shadow: 0 0 15px #6366f1;">🚌</div>`,
      iconSize: [28, 28]
    });
    
    studentBusMarker = L.marker(busLoc, { icon: busIcon }).addTo(studentMap)
      .bindPopup(`<strong style="color:var(--text-dark);">Bus ${data.profile.busNumber}</strong><br><span style="color:#555;">Real-time location updates active</span>`);
  }
}

// Handle real-time WebSocket movements
function handleStudentSocketBusUpdate(data) {
  // Ensure we are viewing student panel and the bus is assigned
  if (!studentMap || !studentDashboardData || data.busId !== studentDashboardData.profile.busId) return;

  const latlng = [data.lat, data.lng];
  
  // Slide marker coordinates
  if (studentBusMarker) {
    studentBusMarker.setLatLng(latlng);
  } else {
    const busIcon = L.divIcon({
      className: 'custom-bus-marker',
      html: `<div style="background: var(--primary-glow); width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; box-shadow: 0 0 15px #6366f1;">🚌</div>`,
      iconSize: [28, 28]
    });
    studentBusMarker = L.marker(latlng, { icon: busIcon }).addTo(studentMap);
  }
  
  // Update ETA widget
  document.getElementById('student-eta').textContent = `${data.etaMin} min`;
  document.getElementById('student-bus-speed').textContent = `${data.speed} km/h`;
  
  if (data.etaMin <= 2) {
    document.getElementById('student-eta-status').textContent = 'Bus is arriving shortly!';
    document.getElementById('student-eta-status').style.color = 'var(--warning)';
  } else {
    document.getElementById('student-eta-status').textContent = 'Bus is moving smoothly';
    document.getElementById('student-eta-status').style.color = 'var(--success)';
  }
}

// EMERGENCY PANIC SENDER
function triggerPanicAlert() {
  const confirmPanic = confirm("🚨 DISPATCH EMERGENCY PANIC ALERT?\n\nThis will instantly alert the School Administrator, drivers, and parents with your geolocated coordinates!");
  if (!confirmPanic) return;
  
  // Mock current location near their boarding stop
  const boardingStop = studentDashboardData.stops.find(s => s.id === studentDashboardData.profile.boarding_stop_id);
  const lat = boardingStop ? boardingStop.latitude + 0.0002 : 12.9962;
  const lng = boardingStop ? boardingStop.longitude + 0.0002 : 77.5722;
  
  fetch('/api/student/panic', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${globalState.token}`
    },
    body: JSON.stringify({
      latitude: lat,
      longitude: lng,
      message: `Emergency Panic Triggered by Student: ${globalState.user.name}`
    })
  })
  .then(res => res.json())
  .then(data => {
    alert("🚨 EMERGENCY DISPATCH SENT! Help is on the way. Administrator has been notified.");
    showNotification('EMERGENCY', 'Panic call logged to school authority.');
  })
  .catch(err => {
    alert(`Failed to send alert: ${err.message}`);
  });
}

// GOOGLE PAY TRANSACTION SHEET SIMULATION
const payBtn = document.getElementById('btn-pay-gpay');
if (payBtn) {
  payBtn.addEventListener('click', () => {
    const amount = payBtn.getAttribute('data-amount');
    const paymentId = payBtn.getAttribute('data-payment-id');
    
    // Set amount in GPay sheet
    document.getElementById('gpay-sheet-amount').textContent = `₹${parseFloat(amount).toFixed(2)}`;
    
    // Reset GPay sheet display blocks
    document.getElementById('gpay-selection-state').style.display = 'block';
    document.getElementById('gpay-loading-state').style.display = 'none';
    document.getElementById('gpay-success-state').style.display = 'none';
    
    // Show GPay overlay
    document.getElementById('gpay-modal-overlay').classList.add('active');
  });
}

function closeGPayModal() {
  document.getElementById('gpay-modal-overlay').classList.remove('active');
}

async function processGPayPayment() {
  const selectionPane = document.getElementById('gpay-selection-state');
  const loadingPane = document.getElementById('gpay-loading-state');
  
  selectionPane.style.display = 'none';
  loadingPane.style.display = 'flex';
  
  const paymentId = payBtn.getAttribute('data-payment-id');
  
  // 1. Initialize API payment create
  try {
    const resSess = await fetch('/api/payments/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ amount: 2500.00, paymentId })
    });
    
    if (!resSess.ok) throw new Error('Failed to init gateway session');
    
    // 2. Wait 2.5 seconds to simulate secure gateway authorization
    setTimeout(async () => {
      try {
        const resConfirm = await fetch('/api/payments/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${globalState.token}`
          },
          body: JSON.stringify({
            paymentId,
            gpayToken: 'gpay_tok_success_998811'
          })
        });
        
        if (!resConfirm.ok) throw new Error('Transaction confirmation declined');
        
        // Hide loading spinner, show Success checkbox
        loadingPane.style.display = 'none';
        document.getElementById('gpay-success-state').style.display = 'flex';
        
        // Reload Student Dashboard stats to clear Outstanding fees widget
        initStudentDashboard();
        
      } catch (err) {
        alert(`Checkout declined: ${err.message}`);
        closeGPayModal();
      }
    }, 2500);
    
  } catch (err) {
    alert(`Transaction Failed: ${err.message}`);
    closeGPayModal();
  }
}
