// Parent Dashboard Logic Control with Real Leaflet Map Integration

let parentMap = null;
let parentBusMarker = null;
let parentCampusMarker = null;
let parentStopMarkers = {};
let parentRouteLine = null;
let parentActiveStopGeofence = null;
let parentMapLegend = null;
let parentActiveChildIndex = 0;
let parentChildrenData = [];

async function initParentDashboard() {
  try {
    const res = await fetch('/api/parent/children', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load children profiles');

    parentChildrenData = data.children;

    if (!parentChildrenData || parentChildrenData.length === 0) {
      alert("No children associated with this parent account. Please contact the college transport administrator.");
      return;
    }

    // Draw child selection tabs
    renderParentChildrenTabs();

    // Load first child data
    loadParentChildData(parentActiveChildIndex);

  } catch (err) {
    console.error('Failed to init parent panel:', err);
  }
}

function renderParentChildrenTabs() {
  const container = document.getElementById('parent-children-tabs');
  if (!container) return;
  container.innerHTML = '';

  parentChildrenData.forEach((child, idx) => {
    const isActive = idx === parentActiveChildIndex;
    const tab = document.createElement('div');
    tab.className = `parent-child-tab ${isActive ? 'active' : ''}`;
    tab.onclick = () => {
      parentActiveChildIndex = idx;
      renderParentChildrenTabs();
      loadParentChildData(idx);
    };

    const firstLetter = child.profile.name ? child.profile.name.charAt(0) : 'C';
    tab.innerHTML = `
      <div class="child-avatar">${firstLetter}</div>
      <div style="text-align: left;">
        <p style="font-weight: 700; font-size: 1rem;">${child.profile.name}</p>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${child.profile.class_grade} • ${child.profile.busNumber || 'Bus'}</span>
      </div>
    `;
    container.appendChild(tab);
  });
}

function loadParentChildData(index) {
  const child = parentChildrenData[index];
  if (!child) return;

  // 1. Populate Attendance Statistics
  const totalDays = child.attendance.length;
  const presents = child.attendance.filter(a => a.status === 1).length;
  const absents = totalDays - presents;
  const percent = totalDays > 0 ? ((presents / totalDays) * 100).toFixed(1) : '100.0';

  document.getElementById('parent-child-present-days').textContent = presents;
  document.getElementById('parent-child-absent-days').textContent = absents;
  document.getElementById('parent-child-percent').textContent = `${percent}%`;
  document.getElementById('parent-child-percent').style.color = parseFloat(percent) < 85 ? 'var(--warning)' : 'var(--accent-indigo)';

  // 2. Render Attendance Grid Cells
  renderParentAttendanceGrid(child.attendance);

  // 3. Render Past 1 Week Attendance List
  renderParentWeeklyList(child.attendance);

  // 4. Render Receipts Table
  renderParentReceiptsTable(child.payments, child.profile.name);

  // 5. Update GPS Status Badge
  updateParentGPSBadge(child.profile.busLocation);

  // 6. Initialize Real Leaflet Tracking Map
  setTimeout(() => {
    initParentTrackingMap(child);
  }, 200);
}

function updateParentGPSBadge(busLoc) {
  const badge = document.getElementById('parent-eta-countdown');
  if (!badge) return;

  if (!busLoc || !busLoc.last_update) {
    badge.textContent = 'GPS Signal Pending';
    badge.style.background = 'rgba(239, 68, 68, 0.15)';
    badge.style.color = 'var(--danger)';
    return;
  }

  const ageMs = Date.now() - new Date(busLoc.last_update).getTime();
  if (busLoc.is_simulated) {
    badge.textContent = '🧪 Simulation Telemetry';
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = '#fbbf24';
  } else if (ageMs < 45000) {
    badge.textContent = '🟢 Live GPS Connected';
    badge.style.background = 'rgba(16, 185, 129, 0.15)';
    badge.style.color = 'var(--success)';
  } else {
    badge.textContent = '🟡 Telemetry Idle';
    badge.style.background = 'rgba(245, 158, 11, 0.15)';
    badge.style.color = 'var(--warning)';
  }
}

function renderParentAttendanceGrid(attendance) {
  const container = document.getElementById('parent-attendance-grid-container');
  if (!container) return;
  container.innerHTML = '';

  const attMap = {};
  attendance.forEach(a => {
    attMap[a.date] = a.status;
  });

  const today = new Date();
  const daysList = [];

  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dStr = d.toISOString().split('T')[0];
    daysList.push({
      dateNum: d.getDate(),
      status: attMap[dStr]
    });
  }

  daysList.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'attendance-cell';
    cell.textContent = day.dateNum;

    if (day.status === 1) {
      cell.classList.add('present');
    } else if (day.status === 0) {
      cell.classList.add('absent');
    }
    container.appendChild(cell);
  });
}

function renderParentWeeklyList(attendance) {
  const container = document.getElementById('parent-weekly-list');
  if (!container) return;
  container.innerHTML = '';

  const sorted = attendance
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  if (sorted.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; text-align: center; padding: 10px;">No attendance logs found.</p>`;
    return;
  }

  sorted.forEach(record => {
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
    container.appendChild(item);
  });
}

function renderParentReceiptsTable(payments, childName) {
  const tbody = document.getElementById('parent-receipts-list');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!payments || payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">No fee payments recorded.</td></tr>`;
    return;
  }

  payments.forEach(p => {
    const tr = document.createElement('tr');
    const dateObj = new Date(p.timestamp);
    const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
    const badgeColor = p.status === 'completed' ? 'var(--success)' : 'var(--warning)';
    const gpayTok = p.gpay_token
      ? `<code style="color:var(--accent-indigo); font-size:0.8rem;">${p.gpay_token.substring(0, 14)}...</code>`
      : '<span style="color:var(--text-muted);">Simulated Due</span>';

    tr.innerHTML = `
      <td style="font-weight:600;">${monthName}</td>
      <td style="font-weight:bold;">₹${p.amount.toFixed(2)}</td>
      <td>${gpayTok}</td>
      <td><span style="color:${badgeColor}; font-weight:600; font-size:0.85rem; text-transform:uppercase;">● ${p.status}</span></td>
      <td>
        ${p.status === 'completed'
          ? `<button class="btn btn-secondary" style="padding:6px 12px; font-size:0.75rem; border-radius:6px;" onclick="simulateReceiptDownload('${p.id}', '${childName}', ${p.amount}, '${p.gpay_token}')">View Receipt</button>`
          : `<span style="color:var(--text-muted); font-size:0.8rem;">Payment Due</span>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function simulateReceiptDownload(id, childName, amount, token) {
  alert(`--------------------------------------------------\nCAMPUSRIDE / SAITRACK DIGITAL PAYMENT RECEIPT\n--------------------------------------------------\nInvoice ID: ${id}\nStudent Name: ${childName}\nPayment Gateway: Google Pay UPI (Simulated Channel)\nToken Ref: ${token || 'N/A'}\nAmount Paid: INR ${amount.toFixed(2)}\nStatus: COMPLETED (Verified)\nDate: ${new Date().toLocaleString()}\n\nNote: Simulated payment receipt for demonstration.\n--------------------------------------------------`);
}

// ----------------------------------------------------
// REAL LEAFLET MAP WITH OPENSTREETMAP TILES (TASK 1 & 2)
// ----------------------------------------------------
async function initParentTrackingMap(child) {
  const mapElement = document.getElementById('parent-map');
  if (!mapElement) return;

  if (parentMap) {
    parentMap.remove();
    parentMap = null;
    parentBusMarker = null;
    parentCampusMarker = null;
    parentStopMarkers = {};
    parentRouteLine = null;
    parentActiveStopGeofence = null;
    parentMapLegend = null;
  }

  const campus = (globalState.config && globalState.config.campus) || {
    name: 'Sri Sairam Engineering College',
    latitude: 12.9601,
    longitude: 80.0574
  };

  const stops = child.stops || [];
  const boardingStop = stops.find(s => s.id === child.profile.boarding_stop_id) || stops[0];
  const centerCoord = boardingStop ? [boardingStop.latitude, boardingStop.longitude] : [campus.latitude, campus.longitude];

  // 1. Initialize Map
  parentMap = L.map('parent-map', {
    zoomControl: true,
    scrollWheelZoom: true,
    dragging: true
  }).setView(centerCoord, 14);

  // 2. OpenStreetMap Real Tiles
  const tileUrl = (globalState.config && globalState.config.map && globalState.config.map.tileLayerUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttr = (globalState.config && globalState.config.map && globalState.config.map.attribution) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

  L.tileLayer(tileUrl, {
    maxZoom: 19,
    attribution: tileAttr
  }).addTo(parentMap);

  // 3. College Campus Marker
  const campusIcon = L.divIcon({
    className: 'custom-campus-marker',
    html: `<div class="campus-marker-pin" title="${campus.name}">🏫</div>`,
    iconSize: [32, 32]
  });

  parentCampusMarker = L.marker([campus.latitude, campus.longitude], { icon: campusIcon })
    .addTo(parentMap)
    .bindPopup(`
      <h4>🏫 ${campus.name}</h4>
      <p><strong>Main College Campus & Transport Gate</strong></p>
      <p style="font-size:0.75rem; color:#94a3b8;">${campus.address || 'West Tambaram, Chennai'}</p>
    `);

  // 4. Stops Markers
  stops.sort((a, b) => a.sequence_order - b.sequence_order);

  stops.forEach(stop => {
    if (stop.is_campus) return;

    const isBoarding = stop.id === child.profile.boarding_stop_id;
    const stopIcon = L.divIcon({
      className: 'custom-stop-marker',
      html: `<div class="stop-marker-pin" style="background: ${isBoarding ? '#10b981' : '#8b5cf6'};">${stop.sequence_order}</div>`,
      iconSize: [22, 22]
    });

    const marker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
      .addTo(parentMap)
      .bindPopup(`
        <h4>🚏 ${stop.name}</h4>
        <p>Route Stop #${stop.sequence_order}</p>
        <p style="margin-top:4px;">${isBoarding ? `<strong style="color:#34d399;">✓ ${child.profile.name}'s Pickup Stop</strong>` : '<span style="color:#94a3b8;">Transit stop</span>'}</p>
      `);

    parentStopMarkers[stop.id] = marker;
  });

  // 5. Geofence around child's boarding stop
  if (boardingStop && !boardingStop.is_campus) {
    parentActiveStopGeofence = L.circle([boardingStop.latitude, boardingStop.longitude], {
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.18,
      radius: 120
    }).addTo(parentMap);
  }

  // 6. Draw Real Road Geometry Polyline
  await drawParentRouteRoadGeometry(child.profile.route_id, stops, campus);

  // 7. Bus Marker
  const initialBusLoc = (child.profile.busLocation && child.profile.busLocation.lat)
    ? [child.profile.busLocation.lat, child.profile.busLocation.lng]
    : (stops.length > 0 ? [stops[0].latitude, stops[0].longitude] : [campus.latitude, campus.longitude]);

  const busIcon = L.divIcon({
    className: 'custom-bus-marker',
    html: `<div class="bus-marker-pin">🚌</div>`,
    iconSize: [32, 32]
  });

  parentBusMarker = L.marker(initialBusLoc, { icon: busIcon })
    .addTo(parentMap)
    .bindPopup(`
      <h4>🚌 Bus ${child.profile.busNumber || 'Route Bus'}</h4>
      <p>Assigned Route: <strong>${child.route ? child.route.name : 'College Route'}</strong></p>
      <p>Speed: <strong>${child.profile.busLocation ? child.profile.busLocation.speed : 0} km/h</strong></p>
    `);

  // 8. Add Map Legend
  addParentMapLegend(child.profile.name);

  // 9. Resize trigger
  setTimeout(() => {
    if (parentMap) parentMap.invalidateSize();
  }, 300);
}

async function drawParentRouteRoadGeometry(routeId, stops, campus) {
  try {
    const res = await fetch(`/api/routes/${routeId}/geometry`);
    if (res.ok) {
      const data = await res.json();
      if (data.geometry && data.geometry.length > 0) {
        parentRouteLine = L.polyline(data.geometry, {
          color: '#8b5cf6',
          weight: 5,
          opacity: 0.8,
          lineJoin: 'round'
        }).addTo(parentMap);
        return;
      }
    }
  } catch (e) {
    console.warn('Could not fetch precomputed road geometry, using stops:', e);
  }

  const points = stops.map(s => [s.latitude, s.longitude]);
  parentRouteLine = L.polyline(points, {
    color: '#8b5cf6',
    weight: 4,
    opacity: 0.7,
    dashArray: '6, 8'
  }).addTo(parentMap);
}

function addParentMapLegend(childName) {
  if (parentMapLegend && parentMap) {
    parentMap.removeControl(parentMapLegend);
  }

  parentMapLegend = L.control({ position: 'bottomright' });
  parentMapLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend-box');
    div.innerHTML = `
      <h4>Transport Legend</h4>
      <div class="map-legend-item">
        <span style="font-size:1rem;">🏫</span>
        <span>College Campus</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-dot" style="background:#10b981;"></span>
        <span>${childName}'s Stop</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-dot" style="background:#8b5cf6;"></span>
        <span>Route Stops</span>
      </div>
      <div class="map-legend-item">
        <span style="font-size:1rem;">🚌</span>
        <span>Bus Location</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-line" style="background:#8b5cf6;"></span>
        <span>Road Corridor</span>
      </div>
    `;
    return div;
  };
  parentMapLegend.addTo(parentMap);
}

// ----------------------------------------------------
// WEBSOCKET TELEMETRY & ALERTS (TASK 3 & 6)
// ----------------------------------------------------
function handleParentSocketBusUpdate(data) {
  if (parentChildrenData.length === 0) return;

  const activeChild = parentChildrenData[parentActiveChildIndex];
  if (!activeChild || data.busId !== activeChild.profile.busId) return;

  const latlng = [data.lat, data.lng];

  if (parentBusMarker) {
    parentBusMarker.setLatLng(latlng);
  } else if (parentMap) {
    const busIcon = L.divIcon({
      className: 'custom-bus-marker',
      html: `<div class="bus-marker-pin">🚌</div>`,
      iconSize: [32, 32]
    });
    parentBusMarker = L.marker(latlng, { icon: busIcon }).addTo(parentMap);
  }

  if (parentBusMarker) {
    const statusLabel = data.is_simulated ? 'Simulation (Demo)' : 'Live GPS Ingest';
    parentBusMarker.setPopupContent(`
      <h4>🚌 Bus ${data.busNumber || activeChild.profile.busNumber}</h4>
      <p>Speed: <strong>${data.speed || 0} km/h</strong></p>
      <p>Status: <span style="color:${data.is_simulated ? '#fbbf24' : '#34d399'}; font-weight:bold;">${statusLabel}</span></p>
      <p style="font-size:0.75rem; color:#94a3b8;">Updated: ${new Date().toLocaleTimeString()}</p>
    `);
  }

  if (data.etaMin !== undefined) {
    document.getElementById('parent-eta-countdown').textContent = `ETA: ${data.etaMin} min`;
  }
}

function handleParentProximityAlert(data) {
  if (parentChildrenData.length === 0) return;

  const activeChild = parentChildrenData[parentActiveChildIndex];
  if (data.studentId !== activeChild.profile.user_id) return;

  const feed = document.getElementById('parent-alerts-feed');
  if (!feed) return;

  const item = document.createElement('div');
  item.className = 'notification-item';
  item.style.border = '1px solid rgba(245, 158, 11, 0.35)';
  item.style.borderRadius = '8px';
  item.style.marginBottom = '8px';
  item.style.background = 'rgba(245, 158, 11, 0.06)';

  item.innerHTML = `
    <div>🔔</div>
    <div>
      <p style="font-weight: 600; color: var(--warning);">Proximity Warning: Bus Approaching Stop</p>
      <p style="font-size: 0.85rem; color: var(--text-main); margin-top: 2px;">${data.message}</p>
      <span class="notification-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `;

  if (feed.querySelector('.notification-item') && feed.querySelector('.notification-item').textContent.includes('All safety indicators')) {
    feed.innerHTML = '';
  }

  feed.prepend(item);
  showNotification('Proximity Warning', data.message);
}

function handleParentPanicAlert(data) {
  if (parentChildrenData.length === 0) return;

  const activeChild = parentChildrenData[parentActiveChildIndex];
  if (data.alert.user_id !== activeChild.profile.user_id) return;

  const feed = document.getElementById('parent-alerts-feed');
  if (!feed) return;

  const item = document.createElement('div');
  item.className = 'notification-item';
  item.style.border = '1px solid rgba(239, 68, 68, 0.45)';
  item.style.borderRadius = '8px';
  item.style.marginBottom = '8px';
  item.style.background = 'rgba(239, 68, 68, 0.1)';

  item.innerHTML = `
    <div style="font-size: 1.3rem; animation: shake 0.5s infinite alternate;">🚨</div>
    <div>
      <p style="font-weight: 700; color: var(--danger);">EMERGENCY PANIC ALERT ACTIVE</p>
      <p style="font-size: 0.88rem; color: #fecaca; margin-top: 2px;">Your child ${data.alert.userName} dispatched an emergency signal. Coordinates: ${data.alert.latitude.toFixed(4)}, ${data.alert.longitude.toFixed(4)} (${data.alert.location_type || 'GPS'})</p>
      <span class="notification-time">${new Date(data.alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  `;

  if (feed.querySelector('.notification-item') && feed.querySelector('.notification-item').textContent.includes('All safety indicators')) {
    feed.innerHTML = '';
  }

  feed.prepend(item);
  alert(`⚠️ URGENT PARENT NOTIFICATION:\nEmergency Panic Alert triggered by child ${data.alert.userName}!\nCollege administration and safety staff have been alerted.`);
}
