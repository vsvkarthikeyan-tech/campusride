// Student Dashboard Logic Control with Real Leaflet Map Integration

let studentMap = null;
let studentBusMarker = null;
let studentCampusMarker = null;
let studentStopMarkers = {};
let studentRouteLine = null;
let studentActiveStopGeofence = null;
let studentDashboardData = null;
let studentMapLegend = null;

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

    // Populate bus stats
    document.getElementById('student-bus-num').textContent = data.profile.busNumber || 'Unassigned';

    // Update GPS status indicator
    updateStudentGPSStatus(data.profile.busLocation);

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
      const dueBadge = paymentCard.querySelector('span');
      if (dueBadge) {
        dueBadge.textContent = 'FEES FULLY PAID';
        dueBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        dueBadge.style.color = '#34d399';
      }
      payBtn.style.display = 'none';
    }

    // Set Attendance status
    const todayStr = new Date().toISOString().split('T')[0];
    const todayAtt = data.attendance.find(a => a.date === todayStr);
    const attCard = document.getElementById('student-attendance-card');
    const attStatus = document.getElementById('student-attendance-status');
    const attTime = document.getElementById('student-attendance-time');

    if (todayAtt) {
      const timeStr = new Date(todayAtt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let sourceStr = 'administrator';
      if (todayAtt.marked_by) {
        if (todayAtt.marked_by.includes('UHF_RFID_Reader')) {
          sourceStr = 'UHF Bus RFID Reader';
        } else if (todayAtt.marked_by.includes('RFID')) {
          sourceStr = 'RFID ID Scanner';
        }
      }

      if (todayAtt.status === 1) {
        attCard.querySelector('div').textContent = '🟢';
        attStatus.textContent = 'Marked Present Today';
        attTime.textContent = `Boarded via ${sourceStr} at ${timeStr}`;
      } else {
        attCard.querySelector('div').textContent = '🔴';
        attStatus.textContent = 'Marked Absent Today';
        attTime.textContent = `Absent logged at ${timeStr}`;
      }
    } else {
      attCard.querySelector('div').textContent = '🟡';
      attStatus.textContent = 'Roll Call Pending';
      attTime.textContent = 'Bus boarding not recorded yet today';
    }

    // Overall month percentage
    const presents = data.attendance.filter(a => a.status === 1).length;
    const total = data.attendance.length;
    const percent = total > 0 ? ((presents / total) * 100).toFixed(1) : '100.0';
    document.getElementById('student-attendance-percent').textContent = `${percent}%`;
    document.getElementById('student-attendance-percent').style.color = parseFloat(percent) < 85 ? 'var(--warning)' : 'var(--success)';

    // Refresh RFID Simulator Widget status
    updateRFIDWidgetUI(todayAtt);

    // Render co-riders
    renderCoRidersList(data.coRiders);

    // Initialize RFID Click binding
    initRFIDSimulationScanner();

    // Render Past 1 Week Attendance list
    renderWeeklyAttendance(data.attendance);

    // Initialize Real Leaflet Map with OpenStreetMap
    setTimeout(() => {
      initStudentMap(data);
    }, 200);

  } catch (err) {
    console.error('Failed student dashboard init:', err);
  }
}

function updateStudentGPSStatus(busLoc) {
  const badge = document.getElementById('student-bus-badge');
  const speedEl = document.getElementById('student-bus-speed');
  if (!badge) return;

  if (!busLoc || !busLoc.last_update) {
    badge.textContent = 'GPS Signal Unavailable';
    badge.style.background = 'rgba(239, 68, 68, 0.15)';
    badge.style.color = 'var(--danger)';
    badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    if (speedEl) speedEl.textContent = '0 km/h (No Signal)';
    return;
  }

  const ageMs = Date.now() - new Date(busLoc.last_update).getTime();
  const speed = busLoc.speed || 0;
  if (speedEl) speedEl.textContent = `${speed} km/h`;

  if (busLoc.is_simulated) {
    badge.textContent = '🧪 Simulation Telemetry (Demo)';
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = '#fbbf24';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
  } else if (ageMs < 45000) {
    const secsAgo = Math.max(1, Math.round(ageMs / 1000));
    badge.textContent = `🟢 Live GPS (${secsAgo}s ago)`;
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.color = 'var(--success)';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
  } else if (ageMs < 180000) {
    const minsAgo = Math.round(ageMs / 60000);
    badge.textContent = `🟡 Stale GPS (${minsAgo}m ago)`;
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = 'var(--warning)';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
  } else {
    badge.textContent = '🔴 GPS Signal Lost (>3m)';
    badge.style.background = 'rgba(239, 68, 68, 0.15)';
    badge.style.color = 'var(--danger)';
    badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
  }
}

function updateRFIDWidgetUI(todayAtt) {
  const rfidWidget = document.getElementById('rfid-pulse-scanner-widget');
  const rfidTitle = document.getElementById('rfid-scanner-status-title');
  const rfidDesc = document.getElementById('rfid-scanner-status-desc');
  const rfidIcon = document.getElementById('rfid-glowing-icon');
  const rfidBtn = document.getElementById('btn-rfid-simulate-tap');

  if (rfidWidget && rfidTitle && rfidDesc && rfidIcon && rfidBtn) {
    if (todayAtt && todayAtt.status === 1) {
      rfidWidget.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      rfidWidget.style.background = 'rgba(16, 185, 129, 0.04)';
      rfidTitle.textContent = 'RFID Boarding Recorded';
      rfidTitle.style.color = '#34d399';
      const checkinSource = todayAtt.marked_by && todayAtt.marked_by.includes('UHF') ? 'UHF Bus Reader' : 'RFID Tap';
      rfidDesc.textContent = `Status logged via ${checkinSource}!`;
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
      rfidBtn.querySelector('span').textContent = 'Simulate ID Card Tap';
    }
  }
}

function renderWeeklyAttendance(attendance) {
  const weeklyListContainer = document.getElementById('student-weekly-list');
  if (!weeklyListContainer) return;
  weeklyListContainer.innerHTML = '';

  const sortedAttendance = attendance
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  if (sortedAttendance.length === 0) {
    weeklyListContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; text-align: center; padding: 10px;">No attendance logs found.</p>`;
    return;
  }

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
    item.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border-glass); border-radius: 10px;";
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

function renderCoRidersList(coRiders) {
  const container = document.getElementById('student-coriders-list');
  if (!container) return;
  container.innerHTML = '';

  if (!coRiders || coRiders.length === 0) {
    container.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No co-riders assigned to this route.</td></tr>`;
    return;
  }

  coRiders.sort((a, b) => {
    if (a.student_id === globalState.user.id) return -1;
    if (b.student_id === globalState.user.id) return 1;
    return a.name.localeCompare(b.name);
  });

  coRiders.forEach(rider => {
    let statusBadge = '';
    if (rider.status === 1) {
      const sourceLabel = rider.marked_by && rider.marked_by.includes('UHF') ? 'UHF Reader' : (rider.marked_by && rider.marked_by.includes('RFID') ? 'RFID' : 'Admin');
      statusBadge = `<span style="background: rgba(16, 185, 129, 0.12); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; display: inline-block;">🟢 Present (${sourceLabel})</span>`;
    } else if (rider.status === 0) {
      statusBadge = `<span style="background: rgba(239, 68, 68, 0.12); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; display: inline-block;">🔴 Absent</span>`;
    } else {
      statusBadge = `<span style="background: rgba(245, 158, 11, 0.12); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.25); padding: 4px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; display: inline-block;">🟡 Pending</span>`;
    }

    const timeStr = rider.timestamp ? new Date(rider.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const tr = document.createElement('tr');
    tr.style.cssText = "border-bottom: 1px solid var(--border-glass);";
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

function initRFIDSimulationScanner() {
  const btnTap = document.getElementById('btn-rfid-simulate-tap');
  const widget = document.getElementById('rfid-pulse-scanner-widget');
  if (!btnTap || !widget) return;

  const triggerScan = async () => {
    if (btnTap.disabled) return;
    const rfidTitle = document.getElementById('rfid-scanner-status-title');
    const rfidDesc = document.getElementById('rfid-scanner-status-desc');

    rfidTitle.textContent = 'Simulating Card Scan...';
    rfidDesc.textContent = 'Sending RFID event to school server...';
    btnTap.disabled = true;

    try {
      const res = await fetch('/api/student/rfid-tap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${globalState.token}`
        }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');

      showNotification('💳 ID Card Boarded', data.message);
      initStudentDashboard();
    } catch (err) {
      alert(`RFID Simulation Error: ${err.message}`);
      initStudentDashboard();
    }
  };

  btnTap.onclick = triggerScan;
  widget.onclick = triggerScan;
}

function renderBoardingStopsList(stops, selectedStopId) {
  const container = document.getElementById('student-boarding-list');
  if (!container) return;
  container.innerHTML = '';

  if (!stops || stops.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No stops assigned to this route.</p>`;
    return;
  }

  stops.sort((a, b) => a.sequence_order - b.sequence_order);

  stops.forEach(stop => {
    const isActive = stop.id === selectedStopId;
    const option = document.createElement('div');
    option.className = `boarding-stop-option ${isActive ? 'active' : ''}`;
    option.onclick = () => selectBoardingStop(stop.id);

    const isCampus = stop.is_campus;
    option.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <input type="radio" name="student-boarding" ${isActive ? 'checked' : ''}>
        <div>
          <p style="font-weight: 600; font-size: 0.92rem; color: ${isCampus ? '#fbbf24' : 'var(--text-main)'};">
            ${isCampus ? '🏫 ' : ''}${stop.name}
          </p>
          <span style="font-size: 0.76rem; color: var(--text-muted);">
            ${isCampus ? 'Destination Campus Hub' : `Stop Sequence #${stop.sequence_order}`}
          </span>
        </div>
      </div>
      <span style="font-size: 0.8rem; font-weight: bold; color: ${isActive ? 'var(--success)' : 'var(--text-muted)'};">
        ${isActive ? 'Selected Pickup' : '📍'}
      </span>
    `;
    container.appendChild(option);
  });
}

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

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update boarding stop');

    studentDashboardData.profile.boarding_stop_id = stopId;
    renderBoardingStopsList(studentDashboardData.stops, stopId);

    const selectedStop = studentDashboardData.stops.find(s => s.id === stopId);
    if (selectedStop && studentMap) {
      const latlng = [selectedStop.latitude, selectedStop.longitude];

      if (studentActiveStopGeofence) {
        studentActiveStopGeofence.setLatLng(latlng);
      } else {
        studentActiveStopGeofence = L.circle(latlng, {
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.18,
          radius: 120
        }).addTo(studentMap);
      }

      // Re-style markers to reflect new active pickup stop
      studentDashboardData.stops.forEach(s => {
        const marker = studentStopMarkers[s.id];
        if (marker && !s.is_campus) {
          const isCurrentBoarding = s.id === stopId;
          const icon = L.divIcon({
            className: 'custom-stop-marker',
            html: `<div class="stop-marker-pin" style="background: ${isCurrentBoarding ? '#10b981' : '#6366f1'};">${s.sequence_order}</div>`,
            iconSize: [22, 22]
          });
          marker.setIcon(icon);
        }
      });

      studentMap.setView(latlng, 15);
      showNotification('Boarding Stop Updated', `Pickup point set to: ${selectedStop.name}`);
    }
  } catch (err) {
    alert(`Failed to select stop: ${err.message}`);
  }
}

// ----------------------------------------------------
// REAL LEAFLET MAP WITH OPENSTREETMAP TILES (TASK 1 & 2)
// ----------------------------------------------------
async function initStudentMap(data) {
  const mapElement = document.getElementById('student-map');
  if (!mapElement) return;

  // Clean existing map instance safely
  if (studentMap) {
    studentMap.remove();
    studentMap = null;
    studentBusMarker = null;
    studentCampusMarker = null;
    studentStopMarkers = {};
    studentRouteLine = null;
    studentActiveStopGeofence = null;
    studentMapLegend = null;
  }

  const campus = (globalState.config && globalState.config.campus) || {
    name: 'Sri Sairam Engineering College',
    latitude: 12.9601,
    longitude: 80.0574
  };

  const boardingStop = data.stops.find(s => s.id === data.profile.boarding_stop_id) || data.stops[0];
  const centerCoord = boardingStop ? [boardingStop.latitude, boardingStop.longitude] : [campus.latitude, campus.longitude];

  // 1. Initialize Leaflet Map
  studentMap = L.map('student-map', {
    zoomControl: true,
    scrollWheelZoom: true,
    dragging: true
  }).setView(centerCoord, 14);

  // 2. OpenStreetMap Real Tiles with correct attribution
  const tileUrl = (globalState.config && globalState.config.map && globalState.config.map.tileLayerUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttr = (globalState.config && globalState.config.map && globalState.config.map.attribution) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

  L.tileLayer(tileUrl, {
    maxZoom: 19,
    attribution: tileAttr
  }).addTo(studentMap);

  // 3. College Campus Identifiable Marker
  const campusIcon = L.divIcon({
    className: 'custom-campus-marker',
    html: `<div class="campus-marker-pin" title="${campus.name}">🏫</div>`,
    iconSize: [32, 32]
  });

  studentCampusMarker = L.marker([campus.latitude, campus.longitude], { icon: campusIcon })
    .addTo(studentMap)
    .bindPopup(`
      <h4>🏫 ${campus.name}</h4>
      <p><strong>Main Campus & Transport Gate</strong></p>
      <p style="font-size:0.75rem; color:#94a3b8;">${campus.address || 'Sai Leo Nagar, West Tambaram, Chennai'}</p>
    `);

  // 4. Bus Stops Identifiable Markers
  data.stops.sort((a, b) => a.sequence_order - b.sequence_order);

  data.stops.forEach(stop => {
    if (stop.is_campus) return; // Campus marker is placed separately

    const isBoarding = stop.id === data.profile.boarding_stop_id;
    const stopIcon = L.divIcon({
      className: 'custom-stop-marker',
      html: `<div class="stop-marker-pin" style="background: ${isBoarding ? '#10b981' : '#6366f1'};">${stop.sequence_order}</div>`,
      iconSize: [22, 22]
    });

    const marker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
      .addTo(studentMap)
      .bindPopup(`
        <h4>🚏 ${stop.name}</h4>
        <p>Route Stop #${stop.sequence_order}</p>
        <p style="margin-top:4px;">${isBoarding ? '<strong style="color:#34d399;">✓ Your Assigned Pickup Stop</strong>' : '<span style="color:#94a3b8;">Available stop on this route</span>'}</p>
      `);

    studentStopMarkers[stop.id] = marker;
  });

  // 5. Active Stop Geofence Circle (120m radius)
  if (boardingStop && !boardingStop.is_campus) {
    studentActiveStopGeofence = L.circle([boardingStop.latitude, boardingStop.longitude], {
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.18,
      radius: 120
    }).addTo(studentMap);
  }

  // 6. Draw Real Road Geometry Polyline (follows roads)
  await drawStudentRouteRoadGeometry(data.profile.route_id, data.stops, campus);

  // 7. Bus Marker with Live Telemetry Popup
  if (data.profile.busLocation && data.profile.busLocation.lat) {
    const busLoc = [data.profile.busLocation.lat, data.profile.busLocation.lng];
    const busIcon = L.divIcon({
      className: 'custom-bus-marker',
      html: `<div class="bus-marker-pin">🚌</div>`,
      iconSize: [32, 32]
    });

    const statusText = data.profile.busLocation.is_simulated ? 'Simulation (Demo)' : 'Live GPS Ingest';
    studentBusMarker = L.marker(busLoc, { icon: busIcon })
      .addTo(studentMap)
      .bindPopup(`
        <h4>🚌 Bus ${data.profile.busNumber || 'Route Bus'}</h4>
        <p>Route: <strong>${data.profile.routeName || 'College Route'}</strong></p>
        <p>Speed: <strong>${data.profile.busLocation.speed || 0} km/h</strong></p>
        <p>Status: <span style="color:${data.profile.busLocation.is_simulated ? '#fbbf24' : '#34d399'}; font-weight:bold;">${statusText}</span></p>
      `);
  }

  // 8. Add Map Legend Control
  addStudentMapLegend();

  // 9. Resize trigger
  setTimeout(() => {
    if (studentMap) studentMap.invalidateSize();
  }, 300);
}

async function drawStudentRouteRoadGeometry(routeId, stops, campus) {
  try {
    const res = await fetch(`/api/routes/${routeId}/geometry`);
    if (res.ok) {
      const data = await res.json();
      if (data.geometry && data.geometry.length > 0) {
        studentRouteLine = L.polyline(data.geometry, {
          color: '#6366f1',
          weight: 5,
          opacity: 0.8,
          lineJoin: 'round'
        }).addTo(studentMap);
        return;
      }
    }
  } catch (e) {
    console.warn('Could not fetch precomputed road geometry, calculating from stops:', e);
  }

  // Fallback: collect stop waypoints + campus
  const points = stops.map(s => [s.latitude, s.longitude]);
  studentRouteLine = L.polyline(points, {
    color: '#6366f1',
    weight: 4,
    opacity: 0.7,
    dashArray: '6, 8'
  }).addTo(studentMap);
}

function addStudentMapLegend() {
  if (studentMapLegend && studentMap) {
    studentMap.removeControl(studentMapLegend);
  }

  studentMapLegend = L.control({ position: 'bottomright' });
  studentMapLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend-box');
    div.innerHTML = `
      <h4>Map Legend</h4>
      <div class="map-legend-item">
        <span style="font-size:1rem;">🏫</span>
        <span>College Campus</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-dot" style="background:#10b981;"></span>
        <span>Your Boarding Stop</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-dot" style="background:#6366f1;"></span>
        <span>Other Bus Stops</span>
      </div>
      <div class="map-legend-item">
        <span style="font-size:1rem;">🚌</span>
        <span>College Bus Location</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-line" style="background:#6366f1;"></span>
        <span>Road Bus Route</span>
      </div>
    `;
    return div;
  };
  studentMapLegend.addTo(studentMap);
}

// ----------------------------------------------------
// REAL-TIME BUS TELEMETRY (TASK 3)
// ----------------------------------------------------
function handleStudentSocketBusUpdate(data) {
  if (!studentDashboardData || data.busId !== studentDashboardData.profile.busId) return;

  const latlng = [data.lat, data.lng];

  // Update existing bus marker smoothly without duplicating
  if (studentBusMarker) {
    studentBusMarker.setLatLng(latlng);
  } else if (studentMap) {
    const busIcon = L.divIcon({
      className: 'custom-bus-marker',
      html: `<div class="bus-marker-pin">🚌</div>`,
      iconSize: [32, 32]
    });
    studentBusMarker = L.marker(latlng, { icon: busIcon }).addTo(studentMap);
  }

  // Update popup content with latest telemetry
  if (studentBusMarker) {
    const statusLabel = data.is_simulated ? 'Simulation (Demo)' : 'Live GPS Ingest';
    studentBusMarker.setPopupContent(`
      <h4>🚌 Bus ${data.busNumber || studentDashboardData.profile.busNumber}</h4>
      <p>Current Speed: <strong>${data.speed || 0} km/h</strong></p>
      <p>Status: <span style="color:${data.is_simulated ? '#fbbf24' : '#34d399'}; font-weight:bold;">${statusLabel}</span></p>
      <p style="font-size:0.75rem; color:#94a3b8;">Updated: ${new Date().toLocaleTimeString()}</p>
    `);
  }

  // Update ETA & Status Widgets
  if (data.etaMin !== undefined) {
    document.getElementById('student-eta').textContent = `${data.etaMin} min`;
    const etaStatus = document.getElementById('student-eta-status');
    if (data.etaMin <= 2) {
      etaStatus.textContent = 'Bus is arriving shortly at stop!';
      etaStatus.style.color = 'var(--warning)';
    } else {
      etaStatus.textContent = 'Bus is en route';
      etaStatus.style.color = 'var(--success)';
    }
  }

  // Update GPS status badge
  updateStudentGPSStatus({
    speed: data.speed,
    last_update: data.timestamp || new Date().toISOString(),
    is_simulated: !!data.is_simulated
  });
}

// ----------------------------------------------------
// EMERGENCY PANIC WITH REAL GPS OR BOARDING POINT
// ----------------------------------------------------
function triggerPanicAlert() {
  const confirmPanic = confirm("🚨 DISPATCH EMERGENCY PANIC ALERT?\n\nThis will instantly alert the College Administrator, staff, and parents with your geolocated coordinates!");
  if (!confirmPanic) return;

  const dispatchAlert = (lat, lng, locType) => {
    fetch('/api/student/panic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({
        latitude: lat,
        longitude: lng,
        location_type: locType,
        message: `Emergency Panic Triggered by Student: ${globalState.user.name}`
      })
    })
    .then(res => res.json())
    .then(data => {
      alert(`🚨 EMERGENCY DISPATCH SENT!\nHelp has been requested.\nLocation: ${lat.toFixed(4)}, ${lng.toFixed(4)} (${locType})`);
      showNotification('EMERGENCY DISPATCH', 'Panic call logged to college transport control.');
    })
    .catch(err => {
      alert(`Failed to send alert: ${err.message}`);
    });
  };

  // Attempt real device GPS via HTML5 Geolocation API
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        dispatchAlert(pos.coords.latitude, pos.coords.longitude, 'browser_device_gps');
      },
      (geoErr) => {
        console.warn('Browser GPS unavailable, using boarding stop:', geoErr.message);
        fallbackToBoardingStopPanic(dispatchAlert);
      },
      { timeout: 5000, enableHighAccuracy: true }
    );
  } else {
    fallbackToBoardingStopPanic(dispatchAlert);
  }
}

function fallbackToBoardingStopPanic(dispatchAlert) {
  const boardingStop = studentDashboardData && studentDashboardData.stops
    ? studentDashboardData.stops.find(s => s.id === studentDashboardData.profile.boarding_stop_id)
    : null;
  const lat = boardingStop ? boardingStop.latitude : 12.9601;
  const lng = boardingStop ? boardingStop.longitude : 80.0574;
  dispatchAlert(lat, lng, 'boarding_stop_estimate');
}

// ----------------------------------------------------
// GOOGLE PAY MODAL CONTROLLER & SIMULATION
// ----------------------------------------------------
let activeGPayPaymentId = null;
let activeGPayAmount = 0;

function openGPayModal(paymentId, amount) {
  activeGPayPaymentId = paymentId;
  activeGPayAmount = amount;

  const overlay = document.getElementById('gpay-modal-overlay');
  const selState = document.getElementById('gpay-selection-state');
  const loadState = document.getElementById('gpay-loading-state');
  const succState = document.getElementById('gpay-success-state');
  const amountSpan = document.getElementById('gpay-sheet-amount');

  if (amountSpan) amountSpan.textContent = `₹${parseFloat(amount).toFixed(2)}`;
  if (selState) selState.style.display = 'block';
  if (loadState) loadState.style.display = 'none';
  if (succState) succState.style.display = 'none';
  if (overlay) overlay.classList.add('active');
}

function closeGPayModal() {
  const overlay = document.getElementById('gpay-modal-overlay');
  if (overlay) overlay.classList.remove('active');
}

async function processGPayPayment() {
  if (!activeGPayPaymentId) return;

  const selState = document.getElementById('gpay-selection-state');
  const loadState = document.getElementById('gpay-loading-state');
  const succState = document.getElementById('gpay-success-state');

  if (selState) selState.style.display = 'none';
  if (loadState) loadState.style.display = 'block';

  try {
    // 1. Initialize session
    const createRes = await fetch('/api/payments/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({
        amount: activeGPayAmount,
        paymentId: activeGPayPaymentId
      })
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.error || 'Payment init failed');

    // 2. Complete payment
    const gpayToken = createData.gatewayToken || `gpay_tok_${Date.now()}`;
    const confirmRes = await fetch('/api/payments/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({
        paymentId: activeGPayPaymentId,
        gpayToken
      })
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok) throw new Error(confirmData.error || 'Payment confirmation failed');

    // Brief delay to simulate banking gateway roundtrip
    setTimeout(() => {
      if (loadState) loadState.style.display = 'none';
      if (succState) succState.style.display = 'block';
      showNotification('Payment Complete', `Google Pay transaction successful for ₹${parseFloat(activeGPayAmount).toFixed(2)}.`);
      initStudentDashboard();
    }, 1200);

  } catch (err) {
    alert(`Payment Error: ${err.message}`);
    if (loadState) loadState.style.display = 'none';
    if (selState) selState.style.display = 'block';
  }
}

// Bind GPay trigger button on DOM content load
document.addEventListener('DOMContentLoaded', () => {
  const payBtn = document.getElementById('btn-pay-gpay');
  if (payBtn) {
    payBtn.addEventListener('click', () => {
      const pid = payBtn.getAttribute('data-payment-id');
      const amt = payBtn.getAttribute('data-amount') || 2500;
      if (pid) {
        openGPayModal(pid, amt);
      }
    });
  }
});

