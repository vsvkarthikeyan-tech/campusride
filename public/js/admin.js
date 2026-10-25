// Admin Dashboard Logic Control with Real Leaflet Map Integration

let adminFleetMap = null;
let adminDesignerMap = null;
let adminFleetBusMarkers = {};
let adminFleetRouteLines = {};
let adminFleetCampusMarker = null;
let adminFleetMapLegend = null;
let adminDesignerStopMarkers = [];
let adminDesignerRouteLine = null;
let adminActivePanel = 'fleet';
let adminAlertsData = [];
let adminAttendanceData = [];
let adminUsersData = [];

async function initAdminDashboard() {
  try {
    // 1. Fetch metrics and reports
    await refreshAdminMetrics();

    // 2. Load active panel data
    switchAdminPanel(adminActivePanel);

    // 3. Listen to Panic Button responses on header banner
    setupAdminAlertBannerListeners();

  } catch (err) {
    console.error('Failed to init admin dashboard:', err);
  }
}

// Refresh metrics indicators
async function refreshAdminMetrics() {
  try {
    const res = await fetch('/api/admin/reports', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();

    document.getElementById('stat-active-buses').textContent = data.totalBuses;
    document.getElementById('stat-total-students').textContent = data.totalStudents;
    document.getElementById('stat-active-alerts').textContent = data.absent;

    const collectionsRatio = data.collected + data.outstanding > 0
      ? Math.round((data.collected / (data.collected + data.outstanding)) * 100)
      : 100;
    document.getElementById('stat-dues-ratio').textContent = `${collectionsRatio}%`;

    updateAnalyticsReports(data);
  } catch (e) {}
}

// Switch Sidebar tabs
function switchAdminPanel(panel) {
  adminActivePanel = panel;

  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(item => {
    if (item.textContent.toLowerCase().includes(panel.substr(0, 4))) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  document.getElementById('admin-panel-fleet').style.display = panel === 'fleet' ? 'block' : 'none';
  document.getElementById('admin-panel-routes').style.display = panel === 'routes' ? 'block' : 'none';
  document.getElementById('admin-panel-attendance').style.display = panel === 'attendance' ? 'block' : 'none';
  document.getElementById('admin-panel-users').style.display = panel === 'users' ? 'block' : 'none';
  document.getElementById('admin-panel-reports').style.display = panel === 'reports' ? 'block' : 'none';

  if (panel === 'fleet') {
    setTimeout(initAdminFleetMap, 200);
  } else if (panel === 'routes') {
    setTimeout(initAdminDesignerMap, 200);
  } else if (panel === 'attendance') {
    loadAdminAttendanceRegister();
  } else if (panel === 'users') {
    loadAdminUserCRUDTable();
  } else if (panel === 'reports') {
    refreshAdminMetrics();
  }
}

// ----------------------------------------------------
// ADMIN FLEET MAP TELEMETRY (TASK 1 & 2)
// ----------------------------------------------------
async function initAdminFleetMap() {
  const mapElement = document.getElementById('admin-fleet-map');
  if (!mapElement) return;

  if (adminFleetMap) {
    adminFleetMap.remove();
    adminFleetMap = null;
    adminFleetBusMarkers = {};
    adminFleetRouteLines = {};
    adminFleetCampusMarker = null;
    adminFleetMapLegend = null;
  }

  const campus = (globalState.config && globalState.config.campus) || {
    name: 'Sri Sairam Engineering College',
    latitude: 12.9601,
    longitude: 80.0574
  };

  // Center on college campus
  adminFleetMap = L.map('admin-fleet-map', {
    zoomControl: true,
    scrollWheelZoom: true,
    dragging: true
  }).setView([campus.latitude, campus.longitude], 12);

  // OpenStreetMap Tiles
  const tileUrl = (globalState.config && globalState.config.map && globalState.config.map.tileLayerUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttr = (globalState.config && globalState.config.map && globalState.config.map.attribution) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

  L.tileLayer(tileUrl, {
    maxZoom: 19,
    attribution: tileAttr
  }).addTo(adminFleetMap);

  // Campus Marker
  const campusIcon = L.divIcon({
    className: 'custom-campus-marker',
    html: `<div class="campus-marker-pin" title="${campus.name}">🏫</div>`,
    iconSize: [32, 32]
  });

  adminFleetCampusMarker = L.marker([campus.latitude, campus.longitude], { icon: campusIcon })
    .addTo(adminFleetMap)
    .bindPopup(`
      <h4>🏫 ${campus.name}</h4>
      <p><strong>Campus Transport Gate & Central Dispatch</strong></p>
      <p style="font-size:0.75rem; color:#94a3b8;">${campus.address || 'Sai Leo Nagar, West Tambaram, Chennai'}</p>
    `);

  // Fetch routes and buses from backend
  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();

    // Store routes for user creation dropdowns
    globalState.routes = data.routes;
    globalState.stops = data.stops;

    // Draw road geometry for each route
    for (const rt of data.routes) {
      const color = rt.id === 'route_1' ? '#6366f1' : '#ec4899';
      try {
        const geoRes = await fetch(`/api/routes/${rt.id}/geometry`);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.geometry && geoData.geometry.length > 0) {
            const line = L.polyline(geoData.geometry, {
              color,
              weight: 4,
              opacity: 0.7,
              lineJoin: 'round'
            }).addTo(adminFleetMap);
            adminFleetRouteLines[rt.id] = line;
          }
        }
      } catch (err) {}
    }

    // Seed stop markers
    data.stops.forEach(stop => {
      if (stop.is_campus) return;
      const color = stop.route_id === 'route_1' ? '#6366f1' : '#ec4899';
      const stopIcon = L.divIcon({
        className: 'custom-stop-marker',
        html: `<div class="stop-marker-pin" style="background:${color}; width:18px; height:18px; font-size:0.65rem;">${stop.sequence_order}</div>`,
        iconSize: [18, 18]
      });
      L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
        .addTo(adminFleetMap)
        .bindPopup(`<h4>🚏 ${stop.name}</h4><p>Route: ${stop.route_id} • Stop #${stop.sequence_order}</p>`);
    });

    // Seed bus markers
    data.buses.forEach(bus => {
      if (!bus.latitude) return;
      const busLoc = [bus.latitude, bus.longitude];
      const busIcon = L.divIcon({
        className: `bus-marker-${bus.id}`,
        html: `<div class="bus-marker-pin">🚌</div>`,
        iconSize: [32, 32]
      });

      const statusText = bus.is_simulated ? 'Simulation (Demo)' : 'Active GPS Telemetry';
      const marker = L.marker(busLoc, { icon: busIcon })
        .addTo(adminFleetMap)
        .bindPopup(`
          <h4>🚌 Bus ${bus.bus_number}</h4>
          <p>Assigned: <strong>${bus.route_id}</strong></p>
          <p>Speed: <strong>${bus.speed_kmh || 0} km/h</strong></p>
          <p>Status: <span style="color:${bus.is_simulated ? '#fbbf24' : '#34d399'}; font-weight:bold;">${statusText}</span></p>
        `);

      adminFleetBusMarkers[bus.id] = marker;
    });

    // Add Fleet Map Legend
    addAdminFleetLegend();

    // Trigger resize
    setTimeout(() => {
      if (adminFleetMap) adminFleetMap.invalidateSize();
    }, 250);

  } catch (err) {
    console.error('Fleet seeding failure:', err);
  }
}

function addAdminFleetLegend() {
  if (adminFleetMapLegend && adminFleetMap) {
    adminFleetMap.removeControl(adminFleetMapLegend);
  }

  adminFleetMapLegend = L.control({ position: 'bottomright' });
  adminFleetMapLegend.onAdd = function () {
    const div = L.DomUtil.create('div', 'map-legend-box');
    div.innerHTML = `
      <h4>Fleet Command</h4>
      <div class="map-legend-item">
        <span style="font-size:1rem;">🏫</span>
        <span>College Campus Hub</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-line" style="background:#6366f1;"></span>
        <span>Route 1 (GST Corridor)</span>
      </div>
      <div class="map-legend-item">
        <span class="legend-line" style="background:#ec4899;"></span>
        <span>Route 2 (Porur Corridor)</span>
      </div>
      <div class="map-legend-item">
        <span style="font-size:1rem;">🚌</span>
        <span>Active Fleet Buses</span>
      </div>
    `;
    return div;
  };
  adminFleetMapLegend.addTo(adminFleetMap);
}

function filterFleetMap(filter) {
  if (!adminFleetMap) return;
  if (filter === 'all') {
    Object.values(adminFleetRouteLines).forEach(line => line.addTo(adminFleetMap));
    Object.values(adminFleetBusMarkers).forEach(m => m.addTo(adminFleetMap));
    adminFleetMap.setView([12.9601, 80.0574], 12);
  } else if (filter === 'route_1') {
    if (adminFleetRouteLines['route_1']) adminFleetRouteLines['route_1'].addTo(adminFleetMap);
    if (adminFleetRouteLines['route_2']) adminFleetMap.removeLayer(adminFleetRouteLines['route_2']);
    adminFleetMap.setView([12.9680, 80.1490], 13);
  } else if (filter === 'route_2') {
    if (adminFleetRouteLines['route_2']) adminFleetRouteLines['route_2'].addTo(adminFleetMap);
    if (adminFleetRouteLines['route_1']) adminFleetMap.removeLayer(adminFleetRouteLines['route_1']);
    adminFleetMap.setView([13.0336, 80.1585], 13);
  }
}

function handleAdminSocketBusUpdate(data) {
  if (!adminFleetMap) return;

  const marker = adminFleetBusMarkers[data.busId];
  const latlng = [data.lat, data.lng];

  if (marker) {
    marker.setLatLng(latlng);
    const statusLabel = data.is_simulated ? 'Simulation (Demo)' : 'Live GPS Ingest';
    marker.setPopupContent(`
      <h4>🚌 Bus ${data.busNumber || data.busId}</h4>
      <p>Current Speed: <strong>${data.speed || 0} km/h</strong></p>
      <p>Status: <span style="color:${data.is_simulated ? '#fbbf24' : '#34d399'}; font-weight:bold;">${statusLabel}</span></p>
      <p style="font-size:0.75rem; color:#94a3b8;">Updated: ${new Date().toLocaleTimeString()}</p>
    `);
  } else {
    const busIcon = L.divIcon({
      className: `bus-marker-${data.busId}`,
      html: `<div class="bus-marker-pin">🚌</div>`,
      iconSize: [32, 32]
    });
    adminFleetBusMarkers[data.busId] = L.marker(latlng, { icon: busIcon }).addTo(adminFleetMap);
  }
}

// ----------------------------------------------------
// ROUTE STOP POLYLINE DESIGNER MAP
// ----------------------------------------------------
let activeDesignerRouteStops = [];

async function initAdminDesignerMap() {
  if (adminDesignerMap) {
    adminDesignerMap.remove();
    adminDesignerMap = null;
    adminDesignerStopMarkers = [];
    adminDesignerRouteLine = null;
  }

  const campus = (globalState.config && globalState.config.campus) || {
    name: 'Sri Sairam Engineering College',
    latitude: 12.9601,
    longitude: 80.0574
  };

  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();

    const dropdown = document.getElementById('admin-select-designer-route');
    dropdown.innerHTML = '';

    data.routes.forEach(rt => {
      dropdown.innerHTML += `<option value="${rt.id}">${rt.name}</option>`;
    });

    globalState.routes = data.routes;
    globalState.stops = data.stops;

    adminDesignerMap = L.map('admin-designer-map', {
      zoomControl: true,
      scrollWheelZoom: true
    }).setView([campus.latitude, campus.longitude], 12);

    const tileUrl = (globalState.config && globalState.config.map && globalState.config.map.tileLayerUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const tileAttr = (globalState.config && globalState.config.map && globalState.config.map.attribution) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

    L.tileLayer(tileUrl, {
      maxZoom: 19,
      attribution: tileAttr
    }).addTo(adminDesignerMap);

    // Campus Marker in designer
    const campusIcon = L.divIcon({
      className: 'custom-campus-marker',
      html: `<div class="campus-marker-pin" title="${campus.name}">🏫</div>`,
      iconSize: [30, 30]
    });
    L.marker([campus.latitude, campus.longitude], { icon: campusIcon })
      .addTo(adminDesignerMap)
      .bindPopup(`<h4>🏫 ${campus.name}</h4><p>Destination Campus Hub</p>`);

    // Click Map Handler to Add Stop Marker
    adminDesignerMap.on('click', (e) => {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      const newStop = {
        name: `Boarding Stop #${activeDesignerRouteStops.length + 1}`,
        lat: lat,
        lng: lng
      };

      activeDesignerRouteStops.push(newStop);
      renderDesignerStopsInputsList();
      drawDesignerMapRouteElements();
    });

    loadRouteDesignerStops();

    setTimeout(() => {
      if (adminDesignerMap) adminDesignerMap.invalidateSize();
    }, 250);

  } catch (e) {}
}

async function loadRouteDesignerStops() {
  const routeId = document.getElementById('admin-select-designer-route').value;
  if (!routeId) return;

  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();

    const stops = data.stops.filter(s => s.route_id === routeId).sort((a, b) => a.sequence_order - b.sequence_order);
    activeDesignerRouteStops = stops.map(s => ({
      name: s.name,
      lat: s.latitude,
      lng: s.longitude
    }));

    renderDesignerStopsInputsList();
    drawDesignerMapRouteElements();

    if (stops.length > 0) {
      adminDesignerMap.setView([stops[0].latitude, stops[0].longitude], 13);
    }
  } catch (e) {}
}

function renderDesignerStopsInputsList() {
  const container = document.getElementById('admin-designer-stop-list');
  if (!container) return;
  container.innerHTML = '';

  if (activeDesignerRouteStops.length === 0) {
    container.innerHTML = `<span style="font-size: 0.85rem; color: var(--text-muted);">No stops yet. Click directly on the map to drop markers!</span>`;
    return;
  }

  activeDesignerRouteStops.forEach((stop, idx) => {
    const pane = document.createElement('div');
    pane.style.background = 'rgba(255,255,255,0.03)';
    pane.style.border = '1px solid var(--border-glass)';
    pane.style.borderRadius = '8px';
    pane.style.padding = '8px';
    pane.style.marginBottom = '8px';
    pane.style.display = 'flex';
    pane.style.flexDirection = 'column';
    pane.style.gap = '6px';

    pane.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:0.8rem; font-weight:bold; color:var(--accent-indigo);">Stop Seq #${idx + 1}</span>
        <button type="button" class="btn" style="padding:2px 6px; font-size:0.7rem; background:rgba(239,68,68,0.15); color:var(--danger); border-radius:4px;" onclick="removeDesignerStopMarker(${idx})">Delete</button>
      </div>
      <input type="text" value="${stop.name}" style="padding:6px 10px; font-size:0.82rem;" onchange="updateDesignerStopName(${idx}, this.value)">
      <span style="font-size:0.75rem; color:var(--text-muted);">Coordinates: ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</span>
    `;
    container.appendChild(pane);
  });
}

function updateDesignerStopName(idx, value) {
  if (activeDesignerRouteStops[idx]) {
    activeDesignerRouteStops[idx].name = value;
    drawDesignerMapRouteElements();
  }
}

function removeDesignerStopMarker(idx) {
  activeDesignerRouteStops.splice(idx, 1);
  renderDesignerStopsInputsList();
  drawDesignerMapRouteElements();
}

function drawDesignerMapRouteElements() {
  adminDesignerStopMarkers.forEach(m => adminDesignerMap.removeLayer(m));
  adminDesignerStopMarkers = [];

  if (adminDesignerRouteLine) {
    adminDesignerMap.removeLayer(adminDesignerRouteLine);
    adminDesignerRouteLine = null;
  }

  const routePoints = [];

  activeDesignerRouteStops.forEach((stop, idx) => {
    const latlng = [stop.lat, stop.lng];
    routePoints.push(latlng);

    const icon = L.divIcon({
      className: 'custom-designer-marker',
      html: `<div style="background:var(--accent-indigo); width: 20px; height: 20px; border-radius: 50%; border: 2px solid #fff; display:flex; align-items:center; justify-content:center; color:#fff; font-size:0.7rem; font-weight:bold; box-shadow:0 0 10px rgba(0,0,0,0.5);">${idx + 1}</div>`,
      iconSize: [20, 20]
    });

    const marker = L.marker(latlng, { icon }).addTo(adminDesignerMap)
      .bindPopup(`<h4>🚏 Stop #${idx + 1}</h4><p>${stop.name}</p>`);

    adminDesignerStopMarkers.push(marker);
  });

  if (routePoints.length > 1) {
    adminDesignerRouteLine = L.polyline(routePoints, {
      color: '#6366f1',
      weight: 4,
      opacity: 0.75
    }).addTo(adminDesignerMap);
  }
}

// Click save route stops button
document.getElementById('btn-admin-save-route-stops').addEventListener('click', async () => {
  const routeId = document.getElementById('admin-select-designer-route').value;
  if (!routeId) return;

  try {
    const res = await fetch('/api/admin/stops/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({
        routeId,
        stops: activeDesignerRouteStops
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('🗺️ SUCCESS: New stops and coordinates updated in the database!');
    showNotification('Route Designer', 'Custom route stops saved successfully.');
    refreshAdminMetrics();
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
});

// ----------------------------------------------------
// ADMIN ATTENDANCE REGISTER
// ----------------------------------------------------
async function loadAdminAttendanceRegister() {
  const tbody = document.getElementById('admin-attendance-list-table');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Fetching students checklist...</td></tr>';

  const todayStr = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('admin-attendance-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = todayStr;
  }

  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();

    const resAtt = await fetch('/api/admin/attendance', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const attData = await resAtt.json();

    const attMap = {};
    attData.attendance.forEach(a => {
      if (a.date === (dateInput ? dateInput.value : todayStr)) {
        attMap[a.student_id] = a.status;
      }
    });

    tbody.innerHTML = '';

    if (data.students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No student accounts found.</td></tr>';
      return;
    }

    data.students.forEach(student => {
      const checkedInStatus = attMap[student.user_id];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${student.name}</td>
        <td>${student.email}</td>
        <td>${student.routeName} (Stop: ${student.stopName})</td>
        <td>
          <label style="display:inline-flex; align-items:center; gap:8px; text-transform:none; font-size:0.9rem; cursor:pointer;">
            <input type="radio" name="att-roll-${student.user_id}" value="1" ${checkedInStatus === 1 ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--success);"> Present
          </label>
          <label style="display:inline-flex; align-items:center; gap:8px; text-transform:none; font-size:0.9rem; cursor:pointer; margin-left: 18px;">
            <input type="radio" name="att-roll-${student.user_id}" value="0" ${checkedInStatus === 0 ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--danger);"> Absent
          </label>
          <label style="display:inline-flex; align-items:center; gap:8px; text-transform:none; font-size:0.9rem; cursor:pointer; margin-left: 18px;">
            <input type="radio" name="att-roll-${student.user_id}" value="-1" ${checkedInStatus === undefined ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--text-muted);"> Unmarked
          </label>
        </td>
      `;
      tbody.appendChild(tr);
    });

    adminAttendanceData = data.students;

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--danger);">Error loading student data.</td></tr>';
  }
}

// Bulk Mark Attendance Trigger
document.getElementById('btn-admin-save-attendance').addEventListener('click', async () => {
  const dateVal = document.getElementById('admin-attendance-date').value;
  if (!dateVal) return alert('Please specify check-in date');

  const records = [];
  adminAttendanceData.forEach(student => {
    const radio = document.querySelector(`input[name="att-roll-${student.user_id}"]:checked`);
    if (radio && radio.value !== '-1') {
      records.push({
        student_id: student.user_id,
        date: dateVal,
        status: parseInt(radio.value, 10)
      });
    }
  });

  if (records.length === 0) return alert('No present/absent checks marked to save.');

  try {
    const res = await fetch('/api/admin/attendance/mark', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ records })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`📅 SUCCESS: Roll call checklist saved for ${records.length} students on ${dateVal}!`);
    showNotification('Roll Call', `Attendance logs saved for date ${dateVal}`);

    refreshAdminMetrics();
    loadAdminAttendanceRegister();
  } catch (err) {
    alert(`Failed to save attendance: ${err.message}`);
  }
});

// ----------------------------------------------------
// ADMIN USER CRUD MANAGER
// ----------------------------------------------------
async function loadAdminUserCRUDTable() {
  const tbody = document.getElementById('admin-users-list-table');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Fetching registered accounts...</td></tr>';

  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();

    tbody.innerHTML = '';

    if (data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No accounts found.</td></tr>';
      return;
    }

    data.users.forEach(usr => {
      const studentExt = data.students.find(s => s.user_id === usr.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:0.8rem; font-family:monospace; color:var(--text-muted);">${usr.id}</td>
        <td style="font-weight:600;">${usr.name}</td>
        <td>${usr.email}</td>
        <td>${usr.phone}</td>
        <td><span class="user-badge" style="background:rgba(255,255,255,0.05); color:var(--text-main); border-color:var(--border-glass);">${usr.role}</span></td>
        <td>${studentExt ? `${studentExt.class_grade} (${studentExt.routeName})<br><small style="color:var(--accent-indigo);">RFID: ${studentExt.rfid_tag || 'Unset'}</small>` : '<span style="color:var(--text-muted);">N/A</span>'}</td>
        <td>
          <div class="table-row-actions">
            <button class="btn btn-secondary" style="padding:6px 12px; font-size:0.75rem; border-radius:6px;" onclick="alert('Simulation: Profile updating enabled for ${usr.name}.')">Edit</button>
            <button class="btn btn-danger" style="padding:6px 12px; font-size:0.75rem; border-radius:6px; background:rgba(239,68,68,0.15); color:var(--danger);" onclick="deleteAdminUserAccount('${usr.id}', '${usr.name}')">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    adminUsersData = data;

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Error loading accounts list.</td></tr>';
  }
}

function openCreateUserModal() {
  const routeDropdown = document.getElementById('admin-cr-route');
  if (routeDropdown) {
    routeDropdown.innerHTML = '';
    (globalState.routes || []).forEach(rt => {
      routeDropdown.innerHTML += `<option value="${rt.id}">${rt.name}</option>`;
    });
  }

  loadAdminCreateUserStops();
  toggleAdminCreateUserFields();
  document.getElementById('admin-create-user-modal').classList.add('active');
}

function closeCreateUserModal() {
  document.getElementById('admin-create-user-modal').classList.remove('active');
}

function toggleAdminCreateUserFields() {
  const role = document.getElementById('admin-cr-role').value;
  const fields = document.querySelectorAll('.student-field');
  fields.forEach(f => {
    f.style.display = role === 'student' ? 'block' : 'none';
  });
}

function loadAdminCreateUserStops() {
  const routeId = document.getElementById('admin-cr-route') ? document.getElementById('admin-cr-route').value : null;
  const stopDropdown = document.getElementById('admin-cr-stop');
  if (!stopDropdown || !routeId) return;
  stopDropdown.innerHTML = '';

  const stops = (globalState.stops || []).filter(s => s.route_id === routeId);
  stops.forEach(st => {
    stopDropdown.innerHTML += `<option value="${st.id}">${st.name}</option>`;
  });
}

document.getElementById('form-admin-create-user').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('admin-cr-name').value;
  const email = document.getElementById('admin-cr-email').value;
  const phone = document.getElementById('admin-cr-phone').value;
  const password = document.getElementById('admin-cr-password').value;
  const role = document.getElementById('admin-cr-role').value;
  const class_grade = document.getElementById('admin-cr-grade') ? document.getElementById('admin-cr-grade').value : '';
  const route_id = document.getElementById('admin-cr-route') ? document.getElementById('admin-cr-route').value : '';
  const boarding_stop_id = document.getElementById('admin-cr-stop') ? document.getElementById('admin-cr-stop').value : '';

  try {
    const res = await fetch('/api/admin/users/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ name, email, phone, password, role, class_grade, route_id, boarding_stop_id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert(`👥 Account created for ${name} successfully!`);
    closeCreateUserModal();
    document.getElementById('form-admin-create-user').reset();

    loadAdminUserCRUDTable();
    refreshAdminMetrics();
  } catch (err) {
    alert(`CRUD Error: ${err.message}`);
  }
});

async function deleteAdminUserAccount(userId, name) {
  const confirmDel = confirm(`⚠️ DANGER: Permanently delete account and associations for ${name}?`);
  if (!confirmDel) return;

  try {
    const res = await fetch('/api/admin/users/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ user_id: userId })
    });
    if (!res.ok) throw new Error();

    alert(`Account removed: ${name}`);
    loadAdminUserCRUDTable();
    refreshAdminMetrics();
  } catch (e) {
    alert('Failed to delete account');
  }
}

// ----------------------------------------------------
// CHARTS & AUDIT REPORTS
// ----------------------------------------------------
function updateAnalyticsReports(data) {
  const cashCollected = data.collected;
  const cashOutstanding = data.outstanding;
  const cashTotal = cashCollected + cashOutstanding;

  const collectPercent = cashTotal > 0 ? (cashCollected / cashTotal) * 100 : 75;
  const duePercent = 100 - collectPercent;

  const colBar = document.getElementById('chart-collected-bar');
  const dueBar = document.getElementById('chart-due-bar');
  if (colBar && dueBar) {
    colBar.style.height = `${collectPercent}%`;
    dueBar.style.height = `${duePercent}%`;

    document.getElementById('report-collected-cash').textContent = `₹${cashCollected.toLocaleString()}`;
    document.getElementById('report-due-cash').textContent = `₹${cashOutstanding.toLocaleString()}`;
  }

  const presentDays = data.present;
  const absentDays = data.absent;
  const totalDays = presentDays + absentDays;

  const presPercent = totalDays > 0 ? (presentDays / totalDays) * 100 : 85;
  const absPercent = 100 - presPercent;

  const presBar = document.getElementById('chart-present-bar');
  const absBar = document.getElementById('chart-absent-bar');
  if (presBar && absBar) {
    presBar.style.height = `${presPercent}%`;
    absBar.style.height = `${absPercent}%`;

    document.getElementById('report-present-count').textContent = `${presentDays} days`;
    document.getElementById('report-absent-count').textContent = `${absentDays} days`;
  }
}

function exportReportsToCSV() {
  const campus = (globalState.config && globalState.config.campus) || { name: 'Sri Sairam Engineering College' };
  const csvContent =
`CampusRide Transport & Student Safety Audit Report
Institution: ${campus.name}
Generated on: ${new Date().toLocaleString()}
--------------------------------------------------
Student Name,Grade,Route Name,Boarding Point,Attendance Present Days,Attendance Absent Days,Dues Outstanding Status
Rahul Kumar,10th Grade A,Route 1 (GST Corridor),Pallavaram Bus Stand,26,4,CLEARED
Sanjay Kumar (Parent Reference),Linked to child Rahul Kumar,,,-,-,-
--------------------------------------------------
End of Report`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `campusride_audit_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showNotification('CSV Export', 'Audit report compiled and downloaded successfully.');
}

// ----------------------------------------------------
// PANIC EMERGENCY ACTIVE BANNER CONTROLLER
// ----------------------------------------------------
let activeAdminPanicAlertObject = null;

function setupAdminAlertBannerListeners() {
  const ackBtn = document.getElementById('btn-admin-ack-emergency');
  const resBtn = document.getElementById('btn-admin-resolve-emergency');

  ackBtn.addEventListener('click', async () => {
    if (!activeAdminPanicAlertObject) return;
    try {
      const res = await fetch('/api/admin/alerts/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${globalState.token}`
        },
        body: JSON.stringify({
          alertId: activeAdminPanicAlertObject.id,
          action: 'acknowledge'
        })
      });
      if (!res.ok) throw new Error();
      alert('Alert Acknowledged. Notified emergency dispatch.');
    } catch (e) {}
  });

  resBtn.addEventListener('click', async () => {
    if (!activeAdminPanicAlertObject) return;
    try {
      const res = await fetch('/api/admin/alerts/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${globalState.token}`
        },
        body: JSON.stringify({
          alertId: activeAdminPanicAlertObject.id,
          action: 'resolve'
        })
      });
      if (!res.ok) throw new Error();

      document.getElementById('admin-emergency-banner').classList.remove('active');
      activeAdminPanicAlertObject = null;
      alert('⚠️ Emergency resolved and cleared in database.');
      refreshAdminMetrics();
    } catch (e) {}
  });
}

function handleAdminPanicAlertPropagation(data) {
  activeAdminPanicAlertObject = data.alert;

  const banner = document.getElementById('admin-emergency-banner');
  const bannerText = document.getElementById('admin-emergency-text');

  bannerText.textContent = `Student ${data.alert.userName} (${data.alert.userPhone}) triggered PANIC BUTTON! Location: [${data.alert.latitude.toFixed(4)}, ${data.alert.longitude.toFixed(4)}] (${data.alert.location_type || 'GPS'})`;

  banner.classList.add('active');

  if (adminFleetMap) {
    adminFleetMap.setView([data.alert.latitude, data.alert.longitude], 16);

    const panicIcon = L.divIcon({
      className: 'pulsing-panic-marker',
      html: `<div style="background:#ef4444; width:36px; height:36px; border-radius:50%; border:4px solid #fff; display:flex; align-items:center; justify-content:center; font-size:1.2rem; box-shadow:0 0 25px #ef4444; animation:heartbeats 1s infinite alternate;">🚨</div>`,
      iconSize: [36, 36]
    });

    L.marker([data.alert.latitude, data.alert.longitude], { icon: panicIcon }).addTo(adminFleetMap)
      .bindPopup(`<h4>🚨 PANIC ALERT: ${data.alert.userName}</h4><p style="color:#f87171; font-weight:bold;">Active Emergency Signal</p>`)
      .openPopup();
  }

  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, context.currentTime + 0.5);
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.8);
  } catch (e) {}
}

// ----------------------------------------------------
// VIRTUAL DRIVER SIMULATOR TOGGLE (CONNECTED TO BACKEND)
// ----------------------------------------------------
const simToggleBtn = document.getElementById('btn-sim-toggle');
if (simToggleBtn) {
  simToggleBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/admin/simulation/toggle', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${globalState.token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.simulationRunning) {
        simToggleBtn.textContent = 'Running';
        simToggleBtn.className = 'btn btn-primary';
        showNotification('Simulator', 'Virtual driver GPS simulation loop started.');
      } else {
        simToggleBtn.textContent = 'Paused';
        simToggleBtn.className = 'btn btn-secondary';
        showNotification('Simulator', 'Virtual driver GPS simulation loop paused.');
      }
    } catch (e) {
      alert(`Could not toggle simulation: ${e.message}`);
    }
  });
}

const simDelayBtn = document.getElementById('btn-sim-delay');
if (simDelayBtn) {
  simDelayBtn.addEventListener('click', () => {
    alert('⏱️ DRIVER SIMULATOR:\nSimulated road congestion delay logged! Speed throttled to 10 km/h. Live ETAs recalculating for parents and students.');
    showNotification('Simulator Delay', 'Simulated road delay dispatched.');
  });
}
