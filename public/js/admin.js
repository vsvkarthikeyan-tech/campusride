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

  const panels = ['fleet', 'users', 'routes', 'assignments', 'attendance', 'bulk-attendance', 'upload-history', 'reports'];
  panels.forEach(p => {
    const el = document.getElementById(`admin-panel-${p}`);
    if (el) el.style.display = p === panel ? 'block' : 'none';
  });

  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(item => {
    const text = item.textContent.toLowerCase();
    const match = (panel === 'bulk-attendance' && text.includes('bulk')) ||
                  (panel === 'upload-history' && text.includes('history')) ||
                  (panel === 'attendance' && text.includes('register')) ||
                  (panel === 'fleet' && text.includes('fleet')) ||
                  (panel === 'routes' && text.includes('route')) ||
                  (panel === 'assignments' && text.includes('assignment')) ||
                  (panel === 'users' && text.includes('user')) ||
                  (panel === 'reports' && text.includes('reports'));
    if (match) item.classList.add('active');
    else item.classList.remove('active');
  });

  if (panel === 'fleet') {
    setTimeout(initAdminFleetMap, 200);
  } else if (panel === 'routes') {
    loadAdminRoutesCatalog();
    setTimeout(initAdminDesignerMap, 200);
  } else if (panel === 'assignments') {
    loadAdminAssignmentsPanel();
  } else if (panel === 'attendance') {
    loadAdminAttendanceRegister();
  } else if (panel === 'bulk-attendance') {
    initBulkAttendancePanel();
  } else if (panel === 'upload-history') {
    loadAttendanceUploadHistory();
  } else if (panel === 'users') {
    loadAdminUserCRUDTable();
  } else if (panel === 'reports') {
    refreshAdminMetrics();
    loadAdminStatsAndReports();
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

    // Distinct color palette for Sri Sairam college bus routes
    const routeColors = {
      route_1: '#6366f1', // Indigo (Valasaravakkam – Porur)
      route_2: '#ec4899', // Pink (Kandigai – Rathnamangalam)
      route_3: '#10b981', // Emerald (Pammal – Pozhichallur)
      route_4: '#f59e0b', // Amber (Mappedu – Thiruvancherry)
      route_5: '#06b6d4'  // Cyan (Tambaram – Perungalathur)
    };

    // Draw road geometry for each route
    for (const rt of data.routes) {
      const color = routeColors[rt.id] || '#8b5cf6';
      try {
        const geoRes = await fetch(`/api/routes/${rt.id}/geometry`);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.geometry && geoData.geometry.length > 0) {
            const line = L.polyline(geoData.geometry, {
              color,
              weight: 4,
              opacity: 0.75,
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
// CENTRAL USER MANAGEMENT (MODULE 1 & 2)
// Super Admin / Admin, Student, Driver, Parent
// ----------------------------------------------------

let currentAdminUsersList = [];
let lastGeneratedTempPassword = '';

// Load Users with search and multi-criteria filters
async function loadAdminUserCRUDTable() {
  const tbody = document.getElementById('admin-users-list-table');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:25px;">Fetching institutional user directory...</td></tr>';

  const search = document.getElementById('user-search-input') ? document.getElementById('user-search-input').value.trim() : '';
  const role = document.getElementById('user-role-filter') ? document.getElementById('user-role-filter').value : 'all';
  const department = document.getElementById('user-dept-filter') ? document.getElementById('user-dept-filter').value : 'all';
  const year = document.getElementById('user-year-filter') ? document.getElementById('user-year-filter').value : 'all';
  const status = document.getElementById('user-status-filter') ? document.getElementById('user-status-filter').value : 'all';

  const queryParams = new URLSearchParams();
  if (search) queryParams.set('search', search);
  if (role && role !== 'all') queryParams.set('role', role);
  if (department && department !== 'all') queryParams.set('department', department);
  if (year && year !== 'all') queryParams.set('year', year);
  if (status && status !== 'all') queryParams.set('status', status);

  try {
    const res = await fetch(`/api/admin/users?${queryParams.toString()}`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load users');

    currentAdminUsersList = data.users || [];
    tbody.innerHTML = '';

    if (currentAdminUsersList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:30px;">No matching accounts found for the applied filters.</td></tr>';
      return;
    }

    currentAdminUsersList.forEach(usr => {
      const tr = document.createElement('tr');
      const roleBadgeClass = usr.role === 'admin' ? 'badge-role-admin'
        : usr.role === 'student' ? 'badge-role-student'
        : usr.role === 'driver' ? 'badge-role-driver'
        : 'badge-role-parent';

      const roleLabel = usr.role === 'admin' ? 'Super Admin'
        : usr.role === 'student' ? 'Student'
        : usr.role === 'driver' ? 'Driver'
        : 'Parent';

      const isActive = usr.status === 'active';
      const statusPillHtml = `
        <span class="status-pill ${isActive ? 'active' : 'inactive'}" 
              title="Click to toggle status" 
              onclick="toggleUserStatus('${usr.id}', '${usr.status}')">
          ${isActive ? 'Active' : 'Inactive'}
        </span>
      `;

      // Standardized academic year & dept presentation
      let deptYearHtml = '<span style="color:var(--text-muted);">-</span>';
      if (usr.role === 'student') {
        const yrDisplay = usr.academic_year_display || (usr.year ? `${usr.year}th Year` : '1st Year');
        deptYearHtml = `
          <div><strong>${usr.department || 'CSE'}</strong></div>
          <span class="badge-academic-year">${yrDisplay}</span>
        `;
      } else if (usr.role === 'driver') {
        deptYearHtml = `<span style="font-size:0.75rem; color:#fcd34d;">Lic: ${usr.license_number || 'N/A'}</span>`;
      } else if (usr.role === 'parent' && usr.linked_student_name) {
        deptYearHtml = `<span style="font-size:0.75rem; color:#6ee7b7;">Child: ${usr.linked_student_name}</span>`;
      }

      // Route & Bus details
      let routeBusHtml = '<span style="color:var(--text-muted);">-</span>';
      if (usr.routeName && usr.routeName !== 'Unassigned') {
        routeBusHtml = `
          <div style="font-weight:600; font-size:0.82rem; color:#e2e8f0;">${usr.routeName}</div>
          <small style="color:var(--accent-indigo);">${usr.busNumber || 'Bus Unassigned'}</small>
        `;
      }

      const lastLoginStr = usr.last_login_at 
        ? new Date(usr.last_login_at).toLocaleDateString() + ' ' + new Date(usr.last_login_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '<span style="color:var(--text-muted); font-size:0.78rem;">Never</span>';

      tr.innerHTML = `
        <td style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${usr.student_id || usr.id}</td>
        <td style="font-weight:600;">${usr.name}</td>
        <td style="font-size:0.85rem;">${usr.email}</td>
        <td><span class="badge-role ${roleBadgeClass}">${roleLabel}</span></td>
        <td>${deptYearHtml}</td>
        <td>${routeBusHtml}</td>
        <td>${statusPillHtml}</td>
        <td>${lastLoginStr}</td>
        <td style="text-align: right;">
          <div style="display:inline-flex; gap:6px;">
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.75rem;" title="Edit Profile" onclick="openEditUserModal('${usr.id}')">✏️</button>
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.75rem;" title="Reset Password" onclick="resetUserPasswordByAdmin('${usr.id}', '${usr.name}')">🔑</button>
            <button class="btn btn-danger" style="padding:4px 8px; font-size:0.75rem; background:rgba(239,68,68,0.15); color:var(--danger);" title="Delete User" onclick="deleteAdminUserAccount('${usr.id}', '${usr.name}')">🗑️</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Failed to load users:', err);
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--danger);padding:20px;">Error loading users: ${err.message}</td></tr>`;
  }
}

// User Filter & Search Handlers
let userSearchDebounceTimer = null;
function handleUserSearchFilter() {
  clearTimeout(userSearchDebounceTimer);
  userSearchDebounceTimer = setTimeout(loadAdminUserCRUDTable, 250);
}

function resetUserFilters() {
  if (document.getElementById('user-search-input')) document.getElementById('user-search-input').value = '';
  if (document.getElementById('user-role-filter')) document.getElementById('user-role-filter').value = 'all';
  if (document.getElementById('user-dept-filter')) document.getElementById('user-dept-filter').value = 'all';
  if (document.getElementById('user-year-filter')) document.getElementById('user-year-filter').value = 'all';
  if (document.getElementById('user-status-filter')) document.getElementById('user-status-filter').value = 'all';
  loadAdminUserCRUDTable();
}

// Export User Directory to Excel (Module 1)
async function exportUsersToExcel() {
  const search = document.getElementById('user-search-input') ? document.getElementById('user-search-input').value.trim() : '';
  const role = document.getElementById('user-role-filter') ? document.getElementById('user-role-filter').value : 'all';
  const department = document.getElementById('user-dept-filter') ? document.getElementById('user-dept-filter').value : 'all';
  const year = document.getElementById('user-year-filter') ? document.getElementById('user-year-filter').value : 'all';
  const status = document.getElementById('user-status-filter') ? document.getElementById('user-status-filter').value : 'all';

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (role && role !== 'all') params.set('role', role);
  if (department && department !== 'all') params.set('department', department);
  if (year && year !== 'all') params.set('year', year);
  if (status && status !== 'all') params.set('status', status);

  try {
    const res = await fetch(`/api/admin/users/export-excel?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    if (!res.ok) throw new Error('Failed to generate user export spreadsheet');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Sri_Sairam_CampusRide_Users_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('User Export', 'Excel user directory downloaded successfully.');
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
}

// Open & Populate Create User Modal (Module 1 & 2)
async function openCreateUserModal() {
  await populateRoutesAndBusesDropdowns();
  toggleAdminCreateUserFields();
  document.getElementById('admin-create-user-modal').classList.add('active');
}

function closeCreateUserModal() {
  document.getElementById('admin-create-user-modal').classList.remove('active');
}

function toggleAdminCreateUserFields() {
  const role = document.getElementById('admin-cr-role').value;
  const stdFields = document.getElementById('student-specific-fields');
  const drvFields = document.getElementById('driver-specific-fields');
  const parFields = document.getElementById('parent-specific-fields');

  if (stdFields) stdFields.style.display = role === 'student' ? 'grid' : 'none';
  if (drvFields) drvFields.style.display = role === 'driver' ? 'grid' : 'none';
  if (parFields) parFields.style.display = role === 'parent' ? 'grid' : 'none';
}

async function populateRoutesAndBusesDropdowns() {
  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) return;

    globalState.routes = data.routes;
    globalState.stops = data.stops;
    globalState.buses = data.buses;

    // Fill route dropdown
    const routeDropdown = document.getElementById('admin-cr-route');
    if (routeDropdown) {
      routeDropdown.innerHTML = '';
      data.routes.forEach(rt => {
        routeDropdown.innerHTML += `<option value="${rt.id}">${rt.route_number || ''} ${rt.name}</option>`;
      });
    }

    // Fill driver bus dropdown
    const drvBusDropdown = document.getElementById('admin-cr-driver-bus');
    if (drvBusDropdown) {
      drvBusDropdown.innerHTML = '<option value="">-- No Bus Assigned --</option>';
      data.buses.forEach(b => {
        drvBusDropdown.innerHTML += `<option value="${b.id}">${b.bus_number} (${b.capacity || 50} seats)</option>`;
      });
    }

    // Fill parent student link dropdown
    const parentStudentDropdown = document.getElementById('admin-cr-parent-student');
    if (parentStudentDropdown) {
      parentStudentDropdown.innerHTML = '<option value="">-- Choose Student to Link --</option>';
      const students = (currentAdminUsersList || []).filter(u => u.role === 'student');
      students.forEach(st => {
        parentStudentDropdown.innerHTML += `<option value="${st.id}">${st.name} (${st.student_id || st.id})</option>`;
      });
    }

    loadAdminCreateUserStopsAndBuses();
  } catch (err) {}
}

function loadAdminCreateUserStopsAndBuses() {
  const routeId = document.getElementById('admin-cr-route') ? document.getElementById('admin-cr-route').value : null;
  const stopDropdown = document.getElementById('admin-cr-stop');
  const busDropdown = document.getElementById('admin-cr-bus');

  if (stopDropdown && routeId && globalState.stops) {
    stopDropdown.innerHTML = '';
    const stops = globalState.stops.filter(s => s.route_id === routeId).sort((a, b) => a.sequence_order - b.sequence_order);
    stops.forEach(st => {
      stopDropdown.innerHTML += `<option value="${st.id}">Stop #${st.sequence_order}: ${st.name} (${st.pickup_time || '07:30 AM'})</option>`;
    });
  }

  if (busDropdown && routeId && globalState.buses) {
    busDropdown.innerHTML = '';
    const buses = globalState.buses.filter(b => b.route_id === routeId);
    if (buses.length === 0) {
      busDropdown.innerHTML = '<option value="">No bus configured for route</option>';
    } else {
      buses.forEach(b => {
        busDropdown.innerHTML += `<option value="${b.id}">${b.bus_number} (${b.capacity || 50} seats)</option>`;
      });
    }
  }
}

// Form Submit: Create User
document.getElementById('form-admin-create-user').addEventListener('submit', async (e) => {
  e.preventDefault();

  const role = document.getElementById('admin-cr-role').value;
  const name = document.getElementById('admin-cr-name').value.trim();
  const email = document.getElementById('admin-cr-email').value.trim();
  const phone = document.getElementById('admin-cr-phone').value.trim();
  const autoPass = document.getElementById('admin-cr-auto-pass') ? document.getElementById('admin-cr-auto-pass').checked : true;

  const payload = {
    role,
    name,
    email,
    phone,
    password: autoPass ? '' : 'sairam123'
  };

  if (role === 'student') {
    payload.student_id = document.getElementById('admin-cr-student-id').value.trim();
    payload.department = document.getElementById('admin-cr-dept').value;
    payload.academic_year = parseInt(document.getElementById('admin-cr-year').value, 10);
    payload.route_id = document.getElementById('admin-cr-route').value;
    payload.bus_id = document.getElementById('admin-cr-bus').value;
    payload.boarding_stop_id = document.getElementById('admin-cr-stop').value;
  } else if (role === 'driver') {
    payload.license_number = document.getElementById('admin-cr-license').value.trim();
    payload.bus_id = document.getElementById('admin-cr-driver-bus').value;
  } else if (role === 'parent') {
    payload.linked_student_id = document.getElementById('admin-cr-parent-student').value;
  }

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create account');

    closeCreateUserModal();
    document.getElementById('form-admin-create-user').reset();

    // Show temporary password if generated
    if (data.temp_password) {
      showTempPasswordModal(data.temp_password, data.user);
    } else {
      alert(`Account created for ${name} successfully!`);
    }

    loadAdminUserCRUDTable();
    refreshAdminMetrics();
  } catch (err) {
    alert(`Account Creation Error: ${err.message}`);
  }
});

// One-Time Temporary Password Display Modal Handlers
function showTempPasswordModal(tempPassword, user) {
  lastGeneratedTempPassword = tempPassword;
  const disp = document.getElementById('display-temp-password-text');
  if (disp) disp.textContent = tempPassword;
  document.getElementById('modal-temp-password').classList.add('active');
}

function copyTempPasswordToClipboard() {
  if (lastGeneratedTempPassword) {
    navigator.clipboard.writeText(lastGeneratedTempPassword).then(() => {
      showNotification('Password Copied', 'Temporary password copied to clipboard.');
    });
  }
}

function closeTempPasswordModal() {
  lastGeneratedTempPassword = '';
  document.getElementById('modal-temp-password').classList.remove('active');
}

// Reset Password: Admin generates new temporary password (Module 1)
async function resetUserPasswordByAdmin(userId, name) {
  const confirmReset = confirm(`Generate a new temporary password for ${name}? The user must change it upon their next login.`);
  if (!confirmReset) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password reset failed');

    showTempPasswordModal(data.temp_password, { name });
    loadAdminUserCRUDTable();
  } catch (err) {
    alert(`Password Reset Failed: ${err.message}`);
  }
}

// Toggle Account Status (Active / Inactive)
async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update status');

    showNotification('Status Updated', `User status changed to ${newStatus}.`);
    loadAdminUserCRUDTable();
  } catch (err) {
    alert(`Status Update Failed: ${err.message}`);
  }
}

// Delete User Account
async function deleteAdminUserAccount(userId, name) {
  const confirmDel = confirm(`⚠️ DANGER: Permanently delete account and all associations for ${name}?`);
  if (!confirmDel) return;

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete user');

    alert(`Account removed: ${name}`);
    loadAdminUserCRUDTable();
    refreshAdminMetrics();
  } catch (err) {
    alert(`Delete Failed: ${err.message}`);
  }
}

// Open Edit User Modal (Module 1)
function openEditUserModal(userId) {
  const user = currentAdminUsersList.find(u => u.id === userId);
  if (!user) return alert('User record not found');

  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-name').value = user.name || '';
  document.getElementById('edit-user-email').value = user.email || '';
  document.getElementById('edit-user-phone').value = user.phone || '';
  document.getElementById('edit-user-role-display').value = (user.role || '').toUpperCase();

  const stdSec = document.getElementById('edit-student-section');
  if (user.role === 'student') {
    stdSec.style.display = 'grid';
    document.getElementById('edit-user-dept').value = user.department || 'CSE';
    document.getElementById('edit-user-year').value = String(user.year || 1);
    document.getElementById('edit-user-rfid').value = user.rfid_tag || '';

    // Routes dropdown
    const routeDropdown = document.getElementById('edit-user-route');
    routeDropdown.innerHTML = '';
    (globalState.routes || []).forEach(rt => {
      routeDropdown.innerHTML += `<option value="${rt.id}" ${rt.id === user.route_id ? 'selected' : ''}>${rt.route_number || ''} ${rt.name}</option>`;
    });

    loadEditUserStopsAndBuses(user.bus_id, user.boarding_stop_id);
  } else {
    stdSec.style.display = 'none';
  }

  document.getElementById('admin-edit-user-modal').classList.add('active');
}

function loadEditUserStopsAndBuses(preselectedBusId, preselectedStopId) {
  const routeId = document.getElementById('edit-user-route').value;
  const busDropdown = document.getElementById('edit-user-bus');
  const stopDropdown = document.getElementById('edit-user-stop');

  if (busDropdown && globalState.buses) {
    busDropdown.innerHTML = '';
    const buses = globalState.buses.filter(b => b.route_id === routeId);
    buses.forEach(b => {
      busDropdown.innerHTML += `<option value="${b.id}" ${b.id === preselectedBusId ? 'selected' : ''}>${b.bus_number}</option>`;
    });
  }

  if (stopDropdown && globalState.stops) {
    stopDropdown.innerHTML = '';
    const stops = globalState.stops.filter(s => s.route_id === routeId);
    stops.forEach(st => {
      stopDropdown.innerHTML += `<option value="${st.id}" ${st.id === preselectedStopId ? 'selected' : ''}>${st.name}</option>`;
    });
  }
}

function closeEditUserModal() {
  document.getElementById('admin-edit-user-modal').classList.remove('active');
}

// Form Submit: Edit User
document.getElementById('form-admin-edit-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const userId = document.getElementById('edit-user-id').value;
  const user = currentAdminUsersList.find(u => u.id === userId);

  const payload = {
    name: document.getElementById('edit-user-name').value.trim(),
    email: document.getElementById('edit-user-email').value.trim(),
    phone: document.getElementById('edit-user-phone').value.trim()
  };

  if (user && user.role === 'student') {
    payload.department = document.getElementById('edit-user-dept').value;
    payload.academic_year = parseInt(document.getElementById('edit-user-year').value, 10);
    payload.route_id = document.getElementById('edit-user-route').value;
    payload.bus_id = document.getElementById('edit-user-bus').value;
    payload.boarding_stop_id = document.getElementById('edit-user-stop').value;
    payload.rfid_tag = document.getElementById('edit-user-rfid').value.trim();
  }

  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update user profile');

    closeEditUserModal();
    showNotification('User Updated', 'Profile updated successfully.');
    loadAdminUserCRUDTable();
  } catch (err) {
    alert(`Update Failed: ${err.message}`);
  }
});

// ----------------------------------------------------
// SRI SAIRAM BUS ROUTES MANAGEMENT (MODULE 3, 4, 5)
// ----------------------------------------------------

let adminRoutesCatalog = [];

async function loadAdminRoutesCatalog() {
  const container = document.getElementById('admin-routes-catalog-grid');
  if (!container) return;
  container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:25px;color:var(--text-muted);">Loading routes from database...</div>';

  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load routes');

    adminRoutesCatalog = data.routes || [];
    globalState.routes = adminRoutesCatalog;
    globalState.stops = data.stops;
    globalState.buses = data.buses;

    if (document.getElementById('routes-stat-active-count')) {
      document.getElementById('routes-stat-active-count').textContent = adminRoutesCatalog.length;
    }

    container.innerHTML = '';

    if (adminRoutesCatalog.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:25px;color:var(--text-muted);">No routes configured. Click "+ Add New Route" to create one.</div>';
      return;
    }

    adminRoutesCatalog.forEach(rt => {
      const card = document.createElement('div');
      card.className = 'route-catalog-card';

      const stopsList = (rt.stops || []).map(s => s.name).join(' ➔ ');
      const stopsSummary = stopsList.length > 90 ? stopsList.substring(0, 90) + '...' : stopsList;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:800; font-size:1.1rem; color:var(--accent-indigo);">${rt.route_number || 'Route'}</span>
              <span class="badge-verification-demo">${rt.verification_status || 'DEMO – PENDING VERIFICATION'}</span>
            </div>
            <h4 style="margin:5px 0 0 0; font-size:0.95rem; color:#fff;">${rt.name}</h4>
          </div>
        </div>

        <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.4;">
          <strong>Corridors / Stops:</strong> ${stopsSummary || 'No stops set yet.'}
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:rgba(255,255,255,0.02); border:1px solid var(--border-glass); border-radius:8px; padding:10px; font-size:0.8rem;">
          <div>Bus: <strong style="color:#fff;">${rt.bus_number || 'Unassigned'}</strong></div>
          <div>Driver: <strong style="color:#fff;">${rt.driver_name || 'Unassigned'}</strong></div>
          <div>Stops: <strong style="color:var(--accent-indigo);">${rt.stop_count || 0}</strong></div>
          <div>Students: <strong style="color:var(--success);">${rt.student_count || 0}</strong></div>
        </div>

        <div style="display:flex; gap:6px; margin-top:auto; flex-wrap:wrap;">
          <button class="btn btn-secondary" style="padding:6px 12px; font-size:0.78rem; flex:1;" onclick="focusRouteOnFleetMap('${rt.id}')">🗺️ Map</button>
          <button class="btn btn-secondary" style="padding:6px 12px; font-size:0.78rem; flex:1;" onclick="openStopsEditorModal('${rt.id}')">🚏 Stops</button>
          <button class="btn btn-secondary" style="padding:6px 12px; font-size:0.78rem;" onclick="openEditRouteModal('${rt.id}')">✏️</button>
          <button class="btn btn-danger" style="padding:6px 10px; font-size:0.78rem; background:rgba(239,68,68,0.15); color:var(--danger);" onclick="deleteRouteByAdmin('${rt.id}', '${rt.name}')">🗑️</button>
        </div>
      `;
      container.appendChild(card);
    });

  } catch (err) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:25px;color:var(--danger);">Failed to load routes: ${err.message}</div>`;
  }
}

// Open Route Editor Modal
function openCreateRouteModal() {
  document.getElementById('modal-route-title').textContent = 'Add Sri Sairam Bus Route';
  document.getElementById('route-editor-id').value = '';
  document.getElementById('form-admin-route-editor').reset();
  document.getElementById('route-editor-dest').value = 'Sri Sairam Engineering College';
  document.getElementById('modal-route-editor').classList.add('active');
}

function openEditRouteModal(routeId) {
  const route = adminRoutesCatalog.find(r => r.id === routeId);
  if (!route) return;

  document.getElementById('modal-route-title').textContent = `Edit Route ${route.route_number}`;
  document.getElementById('route-editor-id').value = route.id;
  document.getElementById('route-editor-number').value = route.route_number || '';
  document.getElementById('route-editor-name').value = route.name || '';
  document.getElementById('route-editor-start').value = route.start_location || '';
  document.getElementById('route-editor-dest').value = route.destination || 'Sri Sairam Engineering College';
  document.getElementById('route-editor-desc').value = route.description || '';

  document.getElementById('modal-route-editor').classList.add('active');
}

function closeRouteEditorModal() {
  document.getElementById('modal-route-editor').classList.remove('active');
}

// Form Submit: Route Editor
document.getElementById('form-admin-route-editor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const routeId = document.getElementById('route-editor-id').value;
  const route_number = document.getElementById('route-editor-number').value.trim();
  const name = document.getElementById('route-editor-name').value.trim();
  const start_location = document.getElementById('route-editor-start').value.trim();
  const destination = document.getElementById('route-editor-dest').value.trim();
  const description = document.getElementById('route-editor-desc').value.trim();

  const url = routeId ? `/api/admin/routes/${routeId}` : '/api/admin/routes';
  const method = routeId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ route_number, name, start_location, destination, description })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save route');

    closeRouteEditorModal();
    showNotification('Route Saved', `Route ${route_number} saved successfully.`);
    loadAdminRoutesCatalog();
  } catch (err) {
    alert(`Route Error: ${err.message}`);
  }
});

// Delete Route
async function deleteRouteByAdmin(routeId, routeName) {
  const confirmDel = confirm(`Are you sure you want to remove route '${routeName}'?`);
  if (!confirmDel) return;

  try {
    const res = await fetch(`/api/admin/routes/${routeId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Delete failed');

    showNotification('Route Removed', 'Route deleted successfully.');
    loadAdminRoutesCatalog();
  } catch (err) {
    alert(`Delete Error: ${err.message}`);
  }
}

// Manage Stops Modal (Module 4)
async function openStopsEditorModal(routeId) {
  const route = adminRoutesCatalog.find(r => r.id === routeId);
  if (!route) return;

  document.getElementById('modal-stops-route-title').textContent = `${route.route_number}: ${route.name} - Stops`;
  document.getElementById('add-stop-route-id').value = route.id;
  document.getElementById('modal-stops-editor').classList.add('active');

  await refreshStopsEditorTable(route.id);
}

function closeStopsEditorModal() {
  document.getElementById('modal-stops-editor').classList.remove('active');
}

async function refreshStopsEditorTable(routeId) {
  const tbody = document.getElementById('stops-editor-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Loading stops...</td></tr>';

  try {
    const res = await fetch(`/api/routes/${routeId}`);
    const data = await res.json();
    const stops = (data.route && data.route.stops) || [];

    tbody.innerHTML = '';
    if (stops.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No stops configured yet for this route. Add one above.</td></tr>';
      return;
    }

    stops.forEach((s, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:700; color:var(--accent-indigo);">${s.sequence_order || idx + 1}</td>
        <td style="font-weight:600;">${s.name}</td>
        <td><span style="color:#fcd34d;">${s.pickup_time || '07:30 AM'}</span></td>
        <td style="font-family:monospace; font-size:0.75rem; color:var(--text-muted);">${(s.latitude || 0).toFixed(4)}, ${(s.longitude || 0).toFixed(4)}</td>
        <td style="text-align:right;">
          <button class="btn btn-danger" style="padding:4px 8px; font-size:0.75rem; background:rgba(239,68,68,0.15); color:var(--danger);" onclick="deleteStopByAdmin('${s.id}', '${routeId}')">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:15px;color:var(--danger);">${err.message}</td></tr>`;
  }
}

// Add Stop Form Submit
document.getElementById('form-add-stop-inline').addEventListener('submit', async (e) => {
  e.preventDefault();
  const routeId = document.getElementById('add-stop-route-id').value;
  const name = document.getElementById('add-stop-name').value.trim();
  const pickup_time = document.getElementById('add-stop-time').value.trim();
  const latitude = parseFloat(document.getElementById('add-stop-lat').value);
  const longitude = parseFloat(document.getElementById('add-stop-lng').value);

  try {
    const res = await fetch(`/api/admin/routes/${routeId}/stops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ name, pickup_time, latitude, longitude })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add stop');

    document.getElementById('add-stop-name').value = '';
    showNotification('Stop Added', `${name} appended to route stops.`);
    refreshStopsEditorTable(routeId);
    loadAdminRoutesCatalog();
  } catch (err) {
    alert(`Add Stop Error: ${err.message}`);
  }
});

// Delete Stop
async function deleteStopByAdmin(stopId, routeId) {
  try {
    const res = await fetch(`/api/admin/stops/${stopId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    if (!res.ok) throw new Error('Failed to delete stop');

    refreshStopsEditorTable(routeId);
    loadAdminRoutesCatalog();
  } catch (err) {
    alert(`Delete Stop Error: ${err.message}`);
  }
}

// Focus Route on Leaflet Fleet Map
function focusRouteOnFleetMap(routeId) {
  switchAdminPanel('fleet');
  setTimeout(() => {
    filterFleetMap(routeId);
  }, 300);
}

// ----------------------------------------------------
// BUS AND STUDENT ASSIGNMENTS (MODULE 8)
// Capacity checks, seat meters, assignments
// ----------------------------------------------------

let adminAssignmentsData = null;

async function loadAdminAssignmentsPanel() {
  const busesGrid = document.getElementById('admin-assignments-buses-grid');
  if (!busesGrid) return;
  busesGrid.innerHTML = '<div style="color:var(--text-muted);padding:20px;">Computing fleet seat allocations...</div>';

  try {
    const res = await fetch('/api/admin/assignments', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load assignments');

    adminAssignmentsData = data;
    busesGrid.innerHTML = '';

    data.buses.forEach(b => {
      const card = document.createElement('div');
      card.style.background = 'rgba(255,255,255,0.02)';
      card.style.border = '1px solid var(--border-glass)';
      card.style.borderRadius = '12px';
      card.style.padding = '14px';

      const pct = b.percent_full || 0;
      const meterColor = pct >= 100 ? 'red' : pct >= 80 ? 'yellow' : 'green';
      const isFull = b.is_full;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <strong style="color:#fff; font-size:0.95rem;">${b.bus_number}</strong>
            <span style="font-size:0.75rem; color:var(--text-muted); margin-left:6px;">(${b.license_plate || 'TN-09'})</span>
          </div>
          <span style="font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:12px; ${isFull ? 'background:rgba(239,68,68,0.2);color:#f87171;' : 'background:rgba(16,185,129,0.2);color:#34d399;'}">
            ${isFull ? 'BUS FULL' : `${b.available_seats} SEATS LEFT`}
          </span>
        </div>

        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">
          Route: <strong style="color:#e2e8f0;">${b.route_name}</strong>
        </div>
        <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px;">
          Driver: <strong style="color:#e2e8f0;">${b.driver_name}</strong>
        </div>

        <div style="display:flex; justify-content:space-between; font-size:0.78rem; color:#94a3b8;">
          <span>Occupancy: ${b.assigned_students} / ${b.capacity} seats</span>
          <span>${pct}%</span>
        </div>
        <div class="capacity-meter-wrap">
          <div class="capacity-meter-bar ${meterColor}" style="width: ${Math.min(100, pct)}%;"></div>
        </div>

        <div style="margin-top:10px;">
          <button class="btn btn-secondary" style="width:100%; padding:6px; font-size:0.78rem;" onclick="viewBusStudents('${b.id}')">
            👥 View Students (${b.assigned_students})
          </button>
        </div>
      `;
      busesGrid.appendChild(card);
    });

    // Populate student dropdown in assignment form
    const studentSelect = document.getElementById('assign-select-student');
    if (studentSelect) {
      studentSelect.innerHTML = '<option value="">-- Choose Student --</option>';
      const studentsRes = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${globalState.token}` } });
      const stdData = await studentsRes.json();
      (stdData.users || []).filter(u => u.role === 'student').forEach(st => {
        studentSelect.innerHTML += `<option value="${st.id}">${st.name} (${st.student_id || st.id}) - ${st.academic_year_display || '1st Year'}</option>`;
      });
    }

    // Populate route dropdown
    const routeSelect = document.getElementById('assign-select-route');
    if (routeSelect) {
      routeSelect.innerHTML = '<option value="">-- Choose Route --</option>';
      data.routes.forEach(rt => {
        routeSelect.innerHTML += `<option value="${rt.id}">${rt.route_number || ''} ${rt.name}</option>`;
      });
    }

  } catch (err) {
    busesGrid.innerHTML = `<div style="color:var(--danger);padding:20px;">${err.message}</div>`;
  }
}

function handleAssignRouteChange() {
  const routeId = document.getElementById('assign-select-route').value;
  const busSelect = document.getElementById('assign-select-bus');
  const stopSelect = document.getElementById('assign-select-stop');

  if (busSelect && adminAssignmentsData) {
    busSelect.innerHTML = '<option value="">-- Choose Bus --</option>';
    const buses = adminAssignmentsData.buses.filter(b => b.route_id === routeId);
    buses.forEach(b => {
      const disabledAttr = b.is_full ? 'disabled' : '';
      const fullLabel = b.is_full ? ' (FULL - 0 SEATS LEFT)' : ` (${b.available_seats} seats available)`;
      busSelect.innerHTML += `<option value="${b.id}" ${disabledAttr}>${b.bus_number}${fullLabel}</option>`;
    });
  }

  if (stopSelect && globalState.stops) {
    stopSelect.innerHTML = '<option value="">-- Choose Stop --</option>';
    const stops = globalState.stops.filter(s => s.route_id === routeId);
    stops.forEach(st => {
      stopSelect.innerHTML += `<option value="${st.id}">Stop #${st.sequence_order}: ${st.name}</option>`;
    });
  }
}

// Form Submit: Assign Student (With capacity enforcement)
document.getElementById('form-assign-student').addEventListener('submit', async (e) => {
  e.preventDefault();

  const user_id = document.getElementById('assign-select-student').value;
  const route_id = document.getElementById('assign-select-route').value;
  const bus_id = document.getElementById('assign-select-bus').value;
  const boarding_stop_id = document.getElementById('assign-select-stop').value;

  if (!user_id || !route_id || !bus_id || !boarding_stop_id) {
    return alert('Please select student, route, bus, and boarding stop.');
  }

  try {
    const res = await fetch('/api/admin/assignments/student', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ user_id, route_id, bus_id, boarding_stop_id })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Assignment failed');

    showNotification('Student Assigned', data.message);
    document.getElementById('form-assign-student').reset();
    loadAdminAssignmentsPanel();
  } catch (err) {
    alert(`Assignment Error: ${err.message}`);
  }
});

// View Bus Students Modal
async function viewBusStudents(busId) {
  const modal = document.getElementById('modal-bus-students');
  const tbody = document.getElementById('modal-bus-students-table-body');
  if (!modal || !tbody) return;

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Loading students on bus...</td></tr>';
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/admin/buses/${busId}/students`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    document.getElementById('modal-bus-students-title').textContent = `${data.bus.bus_number} - Assigned Students`;
    document.getElementById('modal-bus-students-subtitle').textContent = `Total Occupancy: ${data.assigned_count} / ${data.capacity} seats (${data.available_seats} remaining)`;

    tbody.innerHTML = '';
    if (data.students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No students assigned to this bus yet.</td></tr>';
      return;
    }

    data.students.forEach(st => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${st.student_id || st.user_id}</td>
        <td style="font-weight:600;">${st.name}</td>
        <td>${st.department}</td>
        <td><span class="badge-academic-year">${st.year_display}</span></td>
        <td>${st.stop_name}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:20px;">${err.message}</td></tr>`;
  }
}

function closeBusStudentsModal() {
  document.getElementById('modal-bus-students').classList.remove('active');
}

// ----------------------------------------------------
// DASHBOARD ANALYTICS & INSTITUTIONAL METRICS (MODULE 9)
// ----------------------------------------------------
async function loadAdminStatsAndReports() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const stats = await res.json();
    if (!res.ok) return;

    if (document.getElementById('stat-total-students')) {
      document.getElementById('stat-total-students').textContent = stats.totalStudents;
    }
    if (document.getElementById('stat-active-buses')) {
      document.getElementById('stat-active-buses').textContent = stats.totalBuses;
    }
  } catch (e) {}
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
Student Name,Academic Year,Route Name,Boarding Point,Attendance Present Days,Attendance Absent Days,Dues Outstanding Status
Arun Kumar,4th Year,Route 1 (Valasaravakkam – Porur),Lakshmi Nagar Porur,26,4,CLEARED
Parent Reference,Linked to student Arun Kumar,,,-,-,-
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

// ====================================================
// MODULE 1 - 8: EXCEL BULK ATTENDANCE & UNDO MANAGEMENT
// ====================================================

let bulkSelectedExcelFile = null;
let bulkPreviewData = null;
let bulkActivePreviewFilter = 'all';
let activeUndoUploadObj = null;
let activeUploadDetailsObj = null;

// Initialize Bulk Attendance Panel
function initBulkAttendancePanel() {
  const dateInput = document.getElementById('bulk-attendance-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  setupExcelDropzoneListeners();
}

// Drag-and-Drop Dropzone setup
function setupExcelDropzoneListeners() {
  const dropzone = document.getElementById('bulk-excel-dropzone');
  if (!dropzone || dropzone._listenersAttached) return;
  dropzone._listenersAttached = true;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleFileCandidate(files[0]);
    }
  }, false);
}

function triggerExcelFileInput() {
  const fileInput = document.getElementById('bulk-excel-file-input');
  if (fileInput) fileInput.click();
}

function handleExcelFileSelected(event) {
  const files = event.target.files;
  if (files && files.length > 0) {
    handleFileCandidate(files[0]);
  }
}

function handleFileCandidate(file) {
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') {
    alert('⚠️ Invalid File Type: Please upload a valid Microsoft Excel file (.xlsx or .xls).');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('⚠️ File Too Large: Maximum allowed file size is 5MB.');
    return;
  }

  bulkSelectedExcelFile = file;
  updateSelectedFileUI(file);
}

function updateSelectedFileUI(file) {
  const container = document.getElementById('bulk-selected-file-container');
  const nameEl = document.getElementById('bulk-selected-filename');
  const sizeEl = document.getElementById('bulk-selected-filesize');

  if (container && nameEl && sizeEl) {
    nameEl.textContent = file.name;
    sizeEl.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    container.style.display = 'block';
  }
}

function clearSelectedExcelFile(event) {
  if (event) event.stopPropagation();
  bulkSelectedExcelFile = null;
  const fileInput = document.getElementById('bulk-excel-file-input');
  if (fileInput) fileInput.value = '';
  const container = document.getElementById('bulk-selected-file-container');
  if (container) container.style.display = 'none';
}

function resetBulkAttendanceUpload() {
  clearSelectedExcelFile();
  bulkPreviewData = null;
  document.getElementById('btn-bulk-confirm').style.display = 'none';

  // Reset summary cards
  document.getElementById('summary-total-records').textContent = '0';
  document.getElementById('summary-valid-records').textContent = '0';
  document.getElementById('summary-invalid-records').textContent = '0';
  document.getElementById('summary-duplicate-records').textContent = '0';
  document.getElementById('summary-already-present').textContent = '0';

  // Reset preview table
  const tbody = document.getElementById('bulk-attendance-preview-table');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No Excel file uploaded yet. Select or drop a .xlsx / .xls file and click "Upload and Preview".
        </td>
      </tr>
    `;
  }
}

// ----------------------------------------------------
// MODULE 1: DOWNLOAD EXCEL TEMPLATE
// ----------------------------------------------------
async function downloadExcelTemplate() {
  try {
    const res = await fetch('/api/admin/bulk-attendance/template', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to download template');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CampusRide_Bulk_Attendance_Template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('Excel Template', 'Download started for attendance spreadsheet template.');
  } catch (err) {
    alert(`Could not download template: ${err.message}`);
  }
}

// ----------------------------------------------------
// MODULE 2: VALIDATION AND PREVIEW
// ----------------------------------------------------
async function handleExcelUploadAndPreview() {
  if (!bulkSelectedExcelFile) {
    alert('Please select or drag-and-drop an Excel file (.xlsx, .xls) first.');
    return;
  }

  const attendanceDate = document.getElementById('bulk-attendance-date').value;
  const session = document.getElementById('bulk-attendance-session').value;

  if (!attendanceDate) {
    alert('Please specify an Attendance Date.');
    return;
  }

  const previewBtn = document.getElementById('btn-bulk-preview');
  previewBtn.disabled = true;
  previewBtn.textContent = 'Validating File...';

  const formData = new FormData();
  formData.append('file', bulkSelectedExcelFile);
  formData.append('attendance_date', attendanceDate);
  formData.append('session', session);

  try {
    const res = await fetch('/api/admin/bulk-attendance/preview', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${globalState.token}`
      },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to parse and validate Excel file');
    }

    bulkPreviewData = data;

    // Update Summary Cards
    document.getElementById('summary-total-records').textContent = data.summary.total;
    document.getElementById('summary-valid-records').textContent = data.summary.valid;
    document.getElementById('summary-invalid-records').textContent = data.summary.invalid;
    document.getElementById('summary-duplicate-records').textContent = data.summary.duplicates;
    document.getElementById('summary-already-present').textContent = data.summary.alreadyPresent;

    // Render Preview Table
    renderBulkPreviewTable(data.rows);

    // Toggle Confirm button
    const confirmBtn = document.getElementById('btn-bulk-confirm');
    if (data.summary.valid > 0) {
      confirmBtn.style.display = 'inline-flex';
      confirmBtn.textContent = `✓ Confirm and Mark Attendance (${data.summary.valid} Eligible)`;
    } else {
      confirmBtn.style.display = 'none';
      alert('ℹ️ No eligible student records found in this file to mark present. Please review the validation errors below.');
    }

    showNotification('Excel Validation', `Processed ${data.summary.total} rows: ${data.summary.valid} valid, ${data.summary.invalid + data.summary.duplicates + data.summary.alreadyPresent} flagged.`);
  } catch (err) {
    alert(`Validation Error:\n${err.message}`);
    resetBulkAttendanceUpload();
  } finally {
    previewBtn.disabled = false;
    previewBtn.textContent = '🔍 Upload and Preview';
  }
}

function renderBulkPreviewTable(rows) {
  const tbody = document.getElementById('bulk-attendance-preview-table');
  if (!tbody) return;

  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 25px;">No rows match filter.</td></tr>';
    return;
  }

  tbody.innerHTML = '';

  rows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.status = row.validationStatus;

    // Status badge styling
    let badgeClass = 'badge-valid';
    let icon = '✅';
    if (row.validationStatus === 'Valid') {
      badgeClass = 'badge-valid';
      icon = '✓';
    } else if (row.validationStatus.includes('Duplicate')) {
      badgeClass = 'badge-duplicate';
      icon = '⚠️';
    } else if (row.validationStatus.includes('Already')) {
      badgeClass = 'badge-already-present';
      icon = 'ℹ️';
    } else {
      badgeClass = 'badge-invalid';
      icon = '✕';
    }

    const failureReasonHtml = row.failureReason 
      ? `<div style="font-size: 0.75rem; color: #f87171; margin-top: 3px;">${row.failureReason}</div>`
      : '';

    tr.innerHTML = `
      <td style="color: var(--text-muted);">${idx + 1}</td>
      <td style="font-weight: 600; color: #fff;">${row.studentId}</td>
      <td>${row.studentName}</td>
      <td>${row.department}</td>
      <td>${row.year}</td>
      <td>
        <span class="badge-status ${badgeClass}">
          <span>${icon}</span> ${row.validationStatus}
        </span>
        ${failureReasonHtml}
      </td>
      <td style="font-weight: 500; color: ${row.isEligible ? 'var(--success)' : 'var(--text-muted)'};">
        ${row.attendanceStatus}
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function filterPreviewRows(filter, btn) {
  bulkActivePreviewFilter = filter;

  // Update active pill UI
  const pills = document.querySelectorAll('.filter-pill');
  pills.forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (!bulkPreviewData || !bulkPreviewData.rows) return;

  let filtered = bulkPreviewData.rows;
  if (filter === 'valid') {
    filtered = bulkPreviewData.rows.filter(r => r.validationStatus === 'Valid');
  } else if (filter === 'invalid') {
    filtered = bulkPreviewData.rows.filter(r => r.validationStatus !== 'Valid' && !r.validationStatus.includes('Duplicate') && !r.validationStatus.includes('Already'));
  } else if (filter === 'duplicates') {
    filtered = bulkPreviewData.rows.filter(r => r.validationStatus.includes('Duplicate'));
  } else if (filter === 'already') {
    filtered = bulkPreviewData.rows.filter(r => r.validationStatus.includes('Already'));
  }

  renderBulkPreviewTable(filtered);
}

// ----------------------------------------------------
// MODULE 3: CONFIRM AND MARK ATTENDANCE
// ----------------------------------------------------
function openConfirmBulkModal() {
  if (!bulkPreviewData || !bulkPreviewData.rows) {
    alert('Please upload and preview an Excel file first.');
    return;
  }

  const eligible = bulkPreviewData.rows.filter(r => r.isEligible);
  if (eligible.length === 0) {
    alert('No eligible records to mark as present.');
    return;
  }

  const skipped = bulkPreviewData.summary.invalid + bulkPreviewData.summary.duplicates + bulkPreviewData.summary.alreadyPresent;

  document.getElementById('modal-confirm-date').textContent = bulkPreviewData.attendance_date;
  document.getElementById('modal-confirm-session').textContent = bulkPreviewData.session;
  document.getElementById('modal-confirm-file').textContent = bulkPreviewData.filename;
  document.getElementById('modal-confirm-count').textContent = eligible.length;
  document.getElementById('modal-confirm-skipped').textContent = skipped;

  document.getElementById('modal-confirm-bulk-attendance').classList.add('active');
}

function closeConfirmBulkModal() {
  document.getElementById('modal-confirm-bulk-attendance').classList.remove('active');
}

async function executeConfirmBulkAttendance() {
  const confirmBtn = document.getElementById('btn-modal-do-confirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Recording Attendance...';

  try {
    const eligibleRecords = bulkPreviewData.rows.filter(r => r.isEligible);

    const res = await fetch('/api/admin/bulk-attendance/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({
        attendance_date: bulkPreviewData.attendance_date,
        session: bulkPreviewData.session,
        filename: bulkPreviewData.filename,
        file_size: bulkPreviewData.file_size,
        eligible_records: eligibleRecords,
        preview_summary: bulkPreviewData.summary,
        all_rows: bulkPreviewData.rows
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeConfirmBulkModal();
    alert(`🎉 SUCCESS:\n${data.message}\nUpload ID: ${data.upload_id}`);
    showNotification('Bulk Attendance', `${data.marked_present} students marked as PRESENT.`);

    resetBulkAttendanceUpload();
    refreshAdminMetrics();
    loadAdminAttendanceRegister();
  } catch (err) {
    alert(`Failed to confirm attendance: ${err.message}`);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm & Mark Attendance';
  }
}

// ----------------------------------------------------
// MODULE 4: ATTENDANCE UPLOAD HISTORY
// ----------------------------------------------------
async function loadAttendanceUploadHistory() {
  const tbody = document.getElementById('admin-upload-history-table');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 25px;">Fetching upload history...</td></tr>';

  try {
    const res = await fetch('/api/admin/bulk-attendance/history', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    tbody.innerHTML = '';

    if (!data.uploads || data.uploads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 30px;">No bulk attendance uploads recorded yet.</td></tr>';
      return;
    }

    data.uploads.forEach(u => {
      const tr = document.createElement('tr');
      const isUndone = u.status === 'UNDONE';
      const statusBadge = isUndone
        ? `<span class="badge-status badge-undone">UNDONE</span>`
        : `<span class="badge-status badge-completed">COMPLETED</span>`;

      const undoButton = isUndone
        ? `<button class="btn" style="padding: 4px 8px; font-size: 0.72rem; opacity: 0.5; cursor: not-allowed;" disabled title="Upload has already been undone">↩️ Undone</button>`
        : `<button class="btn btn-danger" style="padding: 4px 8px; font-size: 0.72rem;" onclick="openUndoModal('${u.id}')">↩️ Undo</button>`;

      tr.innerHTML = `
        <td><code style="color: var(--accent-indigo); font-size: 0.78rem;">${u.id}</code></td>
        <td style="font-weight: 600;">${u.filename}</td>
        <td>${u.admin_name || u.admin_id}</td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${new Date(u.upload_timestamp).toLocaleString()}</td>
        <td>${u.attendance_date}</td>
        <td>${u.session || 'Morning'}</td>
        <td style="text-align: center;">${u.total_records}</td>
        <td style="text-align: center; font-weight: 600; color: var(--success);">${u.marked_present}</td>
        <td style="text-align: center; color: ${u.failed_records > 0 ? 'var(--warning)' : 'var(--text-muted)'};">${u.failed_records}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.72rem;" onclick="openUploadDetailsModal('${u.id}')">👁️ Details</button>
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.72rem;" onclick="downloadUploadExcelReport('${u.id}')">📊 Report</button>
            ${undoButton}
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--danger); padding: 25px;">Failed to load history: ${err.message}</td></tr>`;
  }
}

// ----------------------------------------------------
// MODULE 5: UNDO / ROLLBACK ATTENDANCE UPLOAD
// ----------------------------------------------------
async function openUndoModal(uploadId) {
  try {
    const res = await fetch(`/api/admin/bulk-attendance/history/${uploadId}`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const u = data.upload;
    if (u.status === 'UNDONE') {
      alert('This upload has already been undone.');
      return;
    }

    activeUndoUploadId = uploadId;

    document.getElementById('modal-undo-id').textContent = u.id;
    document.getElementById('modal-undo-filename').textContent = u.filename;
    document.getElementById('modal-undo-date-session').textContent = `${u.attendance_date} (${u.session || 'Morning'})`;
    document.getElementById('modal-undo-count').textContent = `${u.marked_present} records`;

    document.getElementById('modal-undo-upload').classList.add('active');
  } catch (err) {
    alert(`Could not load upload details for rollback: ${err.message}`);
  }
}

function closeUndoModal() {
  activeUndoUploadId = null;
  document.getElementById('modal-undo-upload').classList.remove('active');
}

async function executeRollbackUpload() {
  if (!activeUndoUploadId) return;

  const undoBtn = document.getElementById('btn-modal-do-undo');
  undoBtn.disabled = true;
  undoBtn.textContent = 'Rolling back records...';

  try {
    const res = await fetch('/api/admin/bulk-attendance/rollback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${globalState.token}`
      },
      body: JSON.stringify({ upload_id: activeUndoUploadId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    closeUndoModal();
    alert(`✅ ROLLBACK COMPLETE:\n${data.message}\nReversed Records: ${data.reversed_count}${data.manual_review_count > 0 ? `\n⚠️ Records requiring manual review: ${data.manual_review_count}` : ''}`);
    showNotification('Undo Rollback', `Successfully reversed ${data.reversed_count} attendance records.`);

    // Refresh history, registers, and metrics
    loadAttendanceUploadHistory();
    refreshAdminMetrics();
    loadAdminAttendanceRegister();
  } catch (err) {
    alert(`Rollback Failed: ${err.message}`);
  } finally {
    undoBtn.disabled = false;
    undoBtn.textContent = 'Confirm Undo Rollback';
  }
}

// ----------------------------------------------------
// UPLOAD DETAILS MODAL
// ----------------------------------------------------
async function openUploadDetailsModal(uploadId) {
  try {
    const res = await fetch(`/api/admin/bulk-attendance/history/${uploadId}`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const u = data.upload;
    activeUploadDetailsObj = u;

    document.getElementById('modal-details-title').textContent = `Inspection: ${u.filename} (${u.id})`;

    const metaContainer = document.getElementById('modal-details-meta');
    metaContainer.innerHTML = `
      <div><strong>Attendance Date:</strong> ${u.attendance_date}</div>
      <div><strong>Session:</strong> ${u.session}</div>
      <div><strong>Admin:</strong> ${u.admin_name || u.admin_id}</div>
      <div><strong>Uploaded At:</strong> ${new Date(u.upload_timestamp).toLocaleString()}</div>
      <div><strong>Marked Present:</strong> <span style="color: var(--success); font-weight: 600;">${u.marked_present}</span></div>
      <div><strong>Status:</strong> <span class="badge-status ${u.status === 'UNDONE' ? 'badge-undone' : 'badge-completed'}">${u.status}</span></div>
    `;

    const tbody = document.getElementById('modal-details-table-body');
    tbody.innerHTML = '';

    const allRows = (u.details && u.details.all_rows) || [];
    if (allRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">No row details stored for this upload.</td></tr>';
    } else {
      allRows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const isEligible = row.isEligible || row.validationStatus === 'Valid';
        tr.innerHTML = `
          <td style="color: var(--text-muted);">${idx + 1}</td>
          <td style="font-weight: 600;">${row.studentId}</td>
          <td>${row.studentName}</td>
          <td>${row.department || '-'}</td>
          <td>${row.year || '-'}</td>
          <td>
            <span class="badge-status ${isEligible ? 'badge-valid' : 'badge-invalid'}">
              ${row.validationStatus}
            </span>
          </td>
          <td style="font-size: 0.78rem; color: ${isEligible ? 'var(--success)' : '#f87171'};">
            ${row.failureReason || 'Marked Present successfully'}
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    const downloadBtn = document.getElementById('btn-details-download-report');
    downloadBtn.onclick = () => downloadUploadExcelReport(u.id);

    document.getElementById('modal-upload-details').classList.add('active');
  } catch (err) {
    alert(`Could not load upload details: ${err.message}`);
  }
}

function closeUploadDetailsModal() {
  document.getElementById('modal-upload-details').classList.remove('active');
}

// ----------------------------------------------------
// MODULE 6: DOWNLOAD REPORTS (EXCEL FORMAT)
// ----------------------------------------------------

// 1. Download Filtered Attendance Excel
async function downloadFilteredAttendanceExcel() {
  const date = document.getElementById('report-filter-date').value;
  const department = document.getElementById('report-filter-dept').value;
  const year = document.getElementById('report-filter-year').value;
  const session = document.getElementById('report-filter-session').value;

  const params = new URLSearchParams();
  if (date) params.append('date', date);
  if (department && department !== 'all') params.append('department', department);
  if (year && year !== 'all') params.append('year', year);
  if (session && session !== 'all') params.append('session', session);

  try {
    const res = await fetch(`/api/admin/bulk-attendance/reports/attendance-excel?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    if (!res.ok) throw new Error('Failed to generate attendance report');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CampusRide_Attendance_Report_${date || 'all'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('Report Download', 'Excel attendance report generated successfully.');
  } catch (err) {
    alert(`Download failed: ${err.message}`);
  }
}

function resetReportFilters() {
  document.getElementById('report-filter-date').value = '';
  document.getElementById('report-filter-dept').value = 'all';
  document.getElementById('report-filter-year').value = 'all';
  document.getElementById('report-filter-session').value = 'all';
}

// 2. Download Upload History & Audit Excel
async function downloadUploadHistoryExcel() {
  try {
    const res = await fetch('/api/admin/bulk-attendance/reports/history-excel', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    if (!res.ok) throw new Error('Failed to generate history report');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CampusRide_Upload_History_Audit.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('History Export', 'Excel upload history & audit trail downloaded.');
  } catch (err) {
    alert(`Failed to export history: ${err.message}`);
  }
}

// 3. Download Specific Upload Excel Report
async function downloadUploadExcelReport(uploadId) {
  try {
    const res = await fetch(`/api/admin/bulk-attendance/reports/upload/${uploadId}/excel`, {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    if (!res.ok) throw new Error('Failed to download upload report');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Upload_Report_${uploadId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('Upload Report', `Downloaded detailed Excel report for upload ${uploadId}.`);
  } catch (err) {
    alert(`Failed to download upload report: ${err.message}`);
  }
}

// 4. Download Invalid Records Report from Live Preview
async function downloadInvalidPreviewReport() {
  if (!bulkPreviewData || !bulkPreviewData.rows) {
    alert('No preview data available. Please upload a file first.');
    return;
  }

  const invalidRows = bulkPreviewData.rows.filter(r => !r.isEligible);
  if (invalidRows.length === 0) {
    alert('There are no invalid, duplicate, or skipped records in this file.');
    return;
  }

  let csvContent = "Student ID,Student Name,Department,Year,Validation Status,Failure Reason\n";
  invalidRows.forEach(r => {
    csvContent += `"${r.studentId}","${r.studentName}","${r.department}","${r.year}","${r.validationStatus}","${(r.failureReason || '').replace(/"/g, '""')}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invalid_Records_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification('Invalid Records', 'Exported invalid records report.');
}

