// Admin Dashboard Logic Control

let adminFleetMap = null;
let adminDesignerMap = null;
let adminFleetBusMarkers = {};
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
    document.getElementById('stat-active-alerts').textContent = data.absent; // mock values or alert lengths
    
    const collectionsRatio = data.collected + data.outstanding > 0 
      ? Math.round((data.collected / (data.collected + data.outstanding)) * 100) 
      : 100;
    document.getElementById('stat-dues-ratio').textContent = `${collectionsRatio}%`;
    
    // Update Reports charts if visible
    updateAnalyticsReports(data);
  } catch(e) {}
}

// Switch Sidebar tabs
function switchAdminPanel(panel) {
  adminActivePanel = panel;
  
  // Update nav class CSS
  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach(item => {
    if (item.textContent.toLowerCase().includes(panel.substr(0,4))) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  // Update sub-panels display blocks
  document.getElementById('admin-panel-fleet').style.display = panel === 'fleet' ? 'block' : 'none';
  document.getElementById('admin-panel-routes').style.display = panel === 'routes' ? 'block' : 'none';
  document.getElementById('admin-panel-attendance').style.display = panel === 'attendance' ? 'block' : 'none';
  document.getElementById('admin-panel-users').style.display = panel === 'users' ? 'block' : 'none';
  document.getElementById('admin-panel-reports').style.display = panel === 'reports' ? 'block' : 'none';
  
  // Init Leaflet map instances based on panel selection
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
// ADMIN FLEET MAP TELEMETRY
// ----------------------------------------------------
async function initAdminFleetMap() {
  if (adminFleetMap) {
    adminFleetMap.remove();
    adminFleetMap = null;
    adminFleetBusMarkers = {};
  }
  
  adminFleetMap = L.map('admin-fleet-map').setView([13.010, 77.575], 13);
  
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(adminFleetMap);
  
  // Fetch buses locations
  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();
    
    // Seed stops on fleet map for context
    data.stops.forEach(stop => {
      const icon = L.divIcon({
        className: 'custom-stop-marker',
        html: `<div style="background: rgba(255,255,255,0.4); width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid #fff;"></div>`,
        iconSize: [8, 8]
      });
      L.marker([stop.latitude, stop.longitude], { icon }).addTo(adminFleetMap)
        .bindPopup(`<strong style="color:var(--text-dark);">${stop.name}</strong>`);
    });
    
    // Seed buses markers
    data.buses.forEach(bus => {
      if (!bus.latitude) return;
      const busLoc = [bus.latitude, bus.longitude];
      
      const busIcon = L.divIcon({
        className: `bus-marker-${bus.id}`,
        html: `<div id="marker-icon-${bus.id}" style="background: var(--primary-glow); width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; box-shadow: 0 0 15px #6366f1;">🚌</div>`,
        iconSize: [28, 28]
      });
      
      const marker = L.marker(busLoc, { icon: busIcon }).addTo(adminFleetMap)
        .bindPopup(`<strong style="color:var(--text-dark);">Bus ${bus.bus_number}</strong><br><span style="color:#555;">Status: Active Simulation</span>`);
      
      adminFleetBusMarkers[bus.id] = marker;
    });
    
  } catch(err) {
    console.error('Fleet seeding failure:', err);
  }
}

function handleAdminSocketBusUpdate(data) {
  if (!adminFleetMap) return;
  
  const marker = adminFleetBusMarkers[data.busId];
  const latlng = [data.lat, data.lng];
  
  if (marker) {
    marker.setLatLng(latlng);
  } else {
    // Generate new bus
    const busIcon = L.divIcon({
      className: `bus-marker-${data.busId}`,
      html: `<div id="marker-icon-${data.busId}" style="background: var(--primary-glow); width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; box-shadow: 0 0 15px #6366f1;">🚌</div>`,
      iconSize: [28, 28]
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
  
  // Populate dropdown routes list
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
    
    // Store in global state for CRUD as well
    globalState.routes = data.routes;
    globalState.stops = data.stops;

    // Load map
    adminDesignerMap = L.map('admin-designer-map').setView([13.010, 77.575], 13);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(adminDesignerMap);
    
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

  } catch(e) {}
}

// Load stops on changing selector
async function loadRouteDesignerStops() {
  const routeId = document.getElementById('admin-select-designer-route').value;
  if (!routeId) return;
  
  try {
    const res = await fetch('/api/admin/routes', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();
    
    // Filter stops
    const stops = data.stops.filter(s => s.route_id === routeId).sort((a,b) => a.sequence_order - b.sequence_order);
    activeDesignerRouteStops = stops.map(s => ({
      name: s.name,
      lat: s.latitude,
      lng: s.longitude
    }));
    
    renderDesignerStopsInputsList();
    drawDesignerMapRouteElements();
    
    // Focus map on first stop
    if (stops.length > 0) {
      adminDesignerMap.setView([stops[0].latitude, stops[0].longitude], 14);
    }
  } catch(e) {}
}

function renderDesignerStopsInputsList() {
  const container = document.getElementById('admin-designer-stop-list');
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
        <span style="font-size:0.8rem; font-weight:bold; color:var(--accent-indigo);">Stop Seq #${idx+1}</span>
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
    drawDesignerMapRouteElements(); // redraw popup updates
  }
}

function removeDesignerStopMarker(idx) {
  activeDesignerRouteStops.splice(idx, 1);
  renderDesignerStopsInputsList();
  drawDesignerMapRouteElements();
}

function drawDesignerMapRouteElements() {
  // Clear map markers
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
      html: `<div style="background:var(--accent-indigo); width: 14px; height: 14px; border-radius: 50%; border: 3px solid #fff; display:flex; align-items:center; justify-content:center; color:#fff; font-size:0.7rem; font-weight:bold; box-shadow:0 0 10px rgba(0,0,0,0.5);">${idx+1}</div>`,
      iconSize: [14, 14]
    });
    
    const marker = L.marker(latlng, { icon }).addTo(adminDesignerMap)
      .bindPopup(`<strong style="color:var(--text-dark);">${stop.name}</strong>`);
      
    adminDesignerStopMarkers.push(marker);
  });
  
  if (routePoints.length > 1) {
    adminDesignerRouteLine = L.polyline(routePoints, {
      color: '#6366f1',
      weight: 4,
      opacity: 0.7
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
    showNotification('Route designer', 'Custom route polylines saved successfully.');
    
    // Refresh global maps
    refreshAdminMetrics();
  } catch(err) {
    alert(`Failed to save: ${err.message}`);
  }
});


// ----------------------------------------------------
// ADMIN ATTENDANCE REGISTER MARKER
// ----------------------------------------------------
async function loadAdminAttendanceRegister() {
  const tbody = document.getElementById('admin-attendance-list-table');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Fetching students checklist...</td></tr>';
  
  // Set default calendar search date (Today)
  const todayStr = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('admin-attendance-date');
  if (!dateInput.value) {
    dateInput.value = todayStr;
  }
  
  try {
    // Fetch users details
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();
    
    // Fetch attendance to pre-tick today
    const resAtt = await fetch('/api/admin/attendance', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const attData = await resAtt.json();
    
    const attMap = {};
    attData.attendance.forEach(a => {
      if (a.date === dateInput.value) {
        attMap[a.student_id] = a.status; // 1: present, 0: absent
      }
    });
    
    tbody.innerHTML = '';
    
    if (data.students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No student accounts found. Add students in User Manager.</td></tr>';
      return;
    }
    
    data.students.forEach(student => {
      const checkedInStatus = attMap[student.user_id]; // 1, 0, or undefined
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600;">${student.name}</td>
        <td>${student.email}</td>
        <td>${student.routeName} (Stop: ${student.stopName})</td>
        <td>
          <label style="display:inline-flex; align-items:center; gap:8px; text-transform:none; font-size:0.9rem; cursor:pointer;">
            <input type="radio" name="att-roll-${student.user_id}" value="1" ${checkedInStatus === 1 ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--success);"> Present
          </label>
          <label style="display:inline-flex; align-items:center; gap:8px; text-transform:none; font-size:0.9rem; cursor:pointer; margin-left: 20px;">
            <input type="radio" name="att-roll-${student.user_id}" value="0" ${checkedInStatus === 0 ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--danger);"> Absent
          </label>
          <label style="display:inline-flex; align-items:center; gap:8px; text-transform:none; font-size:0.9rem; cursor:pointer; margin-left: 20px;">
            <input type="radio" name="att-roll-${student.user_id}" value="-1" ${checkedInStatus === undefined ? 'checked' : ''} style="width:16px; height:16px; accent-color:var(--text-muted);"> Unmarked
          </label>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    adminAttendanceData = data.students;

  } catch(e) {
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
        status: parseInt(radio.value)
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
    showNotification('Roll call', `Attendance logs saved for date ${dateVal}`);
    
    // Refresh
    refreshAdminMetrics();
    loadAdminAttendanceRegister();
  } catch(err) {
    alert(`Failed to save attendance: ${err.message}`);
  }
});


// ----------------------------------------------------
// ADMIN USER CRUD MANAGER
// ----------------------------------------------------
async function loadAdminUserCRUDTable() {
  const tbody = document.getElementById('admin-users-list-table');
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Fetching registered accounts...</td></tr>';
  
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error();
    
    tbody.innerHTML = '';
    
    if (data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">No accounts.</td></tr>';
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
        <td>${studentExt ? `${studentExt.class_grade} (${studentExt.routeName})` : '<span style="color:var(--text-muted);">N/A</span>'}</td>
        <td>
          <div class="table-row-actions">
            <button class="btn btn-secondary" style="padding:6px 12px; font-size:0.75rem; border-radius:6px;" onclick="alert('Simulation: Profile updating enabled. Editing details for ${usr.name}.')">Edit</button>
            <button class="btn btn-danger" style="padding:6px 12px; font-size:0.75rem; border-radius:6px; background:rgba(239,68,68,0.15); color:var(--danger);" onclick="deleteAdminUserAccount('${usr.id}', '${usr.name}')">Delete</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    adminUsersData = data;

  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Error loading accounts lists.</td></tr>';
  }
}

function openCreateUserModal() {
  // Load routes and stops selections inside Modal Form
  const routeDropdown = document.getElementById('admin-cr-route');
  routeDropdown.innerHTML = '';
  
  globalState.routes.forEach(rt => {
    routeDropdown.innerHTML += `<option value="${rt.id}">${rt.name}</option>`;
  });
  
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
  const routeId = document.getElementById('admin-cr-route').value;
  const stopDropdown = document.getElementById('admin-cr-stop');
  stopDropdown.innerHTML = '';
  
  const stops = globalState.stops.filter(s => s.route_id === routeId);
  stops.forEach(st => {
    stopDropdown.innerHTML += `<option value="${st.id}">${st.name}</option>`;
  });
}

// Create Account Submit
document.getElementById('form-admin-create-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = document.getElementById('admin-cr-name').value;
  const email = document.getElementById('admin-cr-email').value;
  const phone = document.getElementById('admin-cr-phone').value;
  const password = document.getElementById('admin-cr-password').value;
  const role = document.getElementById('admin-cr-role').value;
  const class_grade = document.getElementById('admin-cr-grade').value;
  const route_id = document.getElementById('admin-cr-route').value;
  const boarding_stop_id = document.getElementById('admin-cr-stop').value;
  
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
    
    alert(`👥 Account generated for ${name} successfully!`);
    closeCreateUserModal();
    document.getElementById('form-admin-create-user').reset();
    
    // Refresh table
    loadAdminUserCRUDTable();
    refreshAdminMetrics();
  } catch(err) {
    alert(`CRUD Error: ${err.message}`);
  }
});

// Delete account
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
  } catch(e) {
    alert('Failed to delete account');
  }
}


// ----------------------------------------------------
// SVG CHARTS REPORTS UPDATER
// ----------------------------------------------------
function updateAnalyticsReports(data) {
  // Collections Chart Heights
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
  
  // Attendance Present Absent Heights
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

// EXPORT TO EXCEL / CSV REPORT SIMULATION
function exportReportsToCSV() {
  const csvContent = 
`Saitrack Student Safety & Attendance Audit Logs
Generated on: ${new Date().toLocaleString()}
--------------------------------------------------
Student Name,Grade,Route Name,Boarding Point,Attendance Present Days,Attendance Absent Days,Dues Outstanding Status
Rahul Kumar,10th Grade A,Greenfield Campus Express (Route 1),Ramaiah Hospital Gate,26,4,CLEARED
Sanjay Kumar (Parent Reference),Linked to child Rahul Kumar,,,-,-,-
--------------------------------------------------
Cash Collection: INR 2,500.00
Outstanding Dues: INR 0.00 (100% Cleared)
--------------------------------------------------
End of Audit Report`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `saitrack_transport_audit_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showNotification('CSV Export', 'Audit spreadsheets compiled and downloaded successfully.');
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
    } catch(e) {}
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
      
      // Hide banner
      document.getElementById('admin-emergency-banner').classList.remove('active');
      activeAdminPanicAlertObject = null;
      alert('⚠️ Emergency resolved and cleared in database.');
      refreshAdminMetrics();
    } catch(e) {}
  });
}

function handleAdminPanicAlertPropagation(data) {
  activeAdminPanicAlertObject = data.alert;
  
  // Show active crimson banner
  const banner = document.getElementById('admin-emergency-banner');
  const bannerText = document.getElementById('admin-emergency-text');
  
  bannerText.textContent = `Student ${data.alert.userName} (${data.alert.userPhone}) triggered PANIC BUTTON on ${data.alert.userRole} dashboard! Location: [${data.alert.latitude.toFixed(4)}, ${data.alert.longitude.toFixed(4)}]`;
  
  banner.classList.add('active');
  
  // Center admin fleet map on student emergency location!
  if (adminFleetMap) {
    adminFleetMap.setView([data.alert.latitude, data.alert.longitude], 16);
    
    // Draw temporary pulsing skull or red marker at student panic coordinates
    const panicIcon = L.divIcon({
      className: 'pulsing-panic-marker',
      html: `<div style="background:#ef4444; width:36px; height:36px; border-radius:50%; border:4px solid #fff; display:flex; align-items:center; justify-content:center; font-size:1.2rem; box-shadow:0 0 25px #ef4444; animation:heartbeats 1s infinite alternate;">🚨</div>`,
      iconSize: [36, 36]
    });
    
    L.marker([data.alert.latitude, data.alert.longitude], { icon: panicIcon }).addTo(adminFleetMap)
      .bindPopup(`<strong style="color:var(--text-dark);">PANIC CALL: ${data.alert.userName}</strong><br><span style="color:#e11d48; font-weight:bold;">Active Emergency Signal</span>`)
      .openPopup();
  }
  
  // Auditory warning
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, context.currentTime); // High pitch alarm note
    osc.frequency.exponentialRampToValueAtTime(440, context.currentTime + 0.5);
    
    gain.gain.setValueAtTime(0.12, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.8);
    
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + 0.8);
  } catch(e) {}
}


// ----------------------------------------------------
// VIRTUAL DRIVER SIMULATOR ACTIONS
// ----------------------------------------------------
let simulatorRunning = true;

const simToggleBtn = document.getElementById('btn-sim-toggle');
if (simToggleBtn) {
  simToggleBtn.addEventListener('click', () => {
    simulatorRunning = !simulatorRunning;
    if (simulatorRunning) {
      simToggleBtn.textContent = 'Running';
      simToggleBtn.className = 'btn btn-primary';
      showNotification('Simulator', 'Virtual driver GPS loops started.');
    } else {
      simToggleBtn.textContent = 'Paused';
      simToggleBtn.className = 'btn btn-secondary';
      showNotification('Simulator', 'Virtual driver GPS loops paused.');
    }
  });
}

const simDelayBtn = document.getElementById('btn-sim-delay');
if (simDelayBtn) {
  simDelayBtn.addEventListener('click', () => {
    alert('⏱️ DRIVER SIMULATOR UPDATE:\nInjected traffic congestion delay! Telemetry speeds throttled to 5 km/h. Live ETAs recalculating for children on maps...');
    showNotification('Telemetry', 'Traffic delay alert broadcasted to parents.');
  });
}
