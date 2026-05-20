// Parent Dashboard Logic Control

let parentMap = null;
let parentBusMarker = null;
let parentStopMarkers = {};
let parentRouteLine = null;
let parentActiveStopGeofence = null;
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
      alert("No children associated with this parent account. Contact administrator.");
      return;
    }
    
    // Draw tabs
    renderParentChildrenTabs();
    
    // Load active child
    loadParentChildData(parentActiveChildIndex);

  } catch (err) {
    console.error('Failed to init parent panel:', err);
  }
}

// Render child selection tabs
function renderParentChildrenTabs() {
  const container = document.getElementById('parent-children-tabs');
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
    
    const firstLetter = child.profile.name.charAt(0);
    tab.innerHTML = `
      <div class="child-avatar">${firstLetter}</div>
      <div style="text-align: left;">
        <p style="font-weight: 700; font-size: 1rem;">${child.profile.name}</p>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${child.profile.class_grade}</span>
      </div>
    `;
    container.appendChild(tab);
  });
}

// Load chosen child details
function loadParentChildData(index) {
  const child = parentChildrenData[index];
  if (!child) return;
  
  // Populate statistics
  const totalDays = child.attendance.length;
  const presents = child.attendance.filter(a => a.status === 1).length;
  const absents = totalDays - presents;
  const percent = totalDays > 0 ? ((presents / totalDays) * 100).toFixed(1) : '100.0';
  
  document.getElementById('parent-child-present-days').textContent = presents;
  document.getElementById('parent-child-absent-days').textContent = absents;
  document.getElementById('parent-child-percent').textContent = `${percent}%`;
  
  if (parseFloat(percent) < 85) {
    document.getElementById('parent-child-percent').style.color = 'var(--warning)';
  } else {
    document.getElementById('parent-child-percent').style.color = 'var(--accent-indigo)';
  }
  
  // Draw attendance grid cells
  renderParentAttendanceGrid(child.attendance);

  // Render Past 1 Week Attendance list for parents
  const parentWeeklyListContainer = document.getElementById('parent-weekly-list');
  if (parentWeeklyListContainer) {
    parentWeeklyListContainer.innerHTML = '';
    const sortedAttendance = child.attendance
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
    
    if (sortedAttendance.length === 0) {
      parentWeeklyListContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; text-align: center; padding: 10px;">No attendance logs found.</p>`;
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
        parentWeeklyListContainer.appendChild(item);
      });
    }
  }
  
  // Draw receipts table
  renderParentReceiptsTable(child.payments, child.profile.name);
  
  // Initialize Child Tracking Map
  setTimeout(() => {
    initParentTrackingMap(child);
  }, 200);
}

// Draw attendance grid
function renderParentAttendanceGrid(attendance) {
  const container = document.getElementById('parent-attendance-grid-container');
  container.innerHTML = '';
  
  // Map attendance by date YYYY-MM-DD
  const attMap = {};
  attendance.forEach(a => {
    attMap[a.date] = a.status;
  });
  
  // Draw last 28 days of school logs
  const today = new Date();
  const daysList = [];
  
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dayOfWeek = d.getDay();
    
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    const dStr = d.toISOString().split('T')[0];
    const status = attMap[dStr]; // 1: present, 0: absent, undefined: no record
    
    daysList.push({
      dateNum: d.getDate(),
      status: status
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

// Render Receipts list table
function renderParentReceiptsTable(payments, childName) {
  const tbody = document.getElementById('parent-receipts-list');
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
    const gpayTok = p.gpay_token ? `<code style="color:var(--accent-indigo); font-size:0.8rem;">${p.gpay_token.substring(0, 12)}...</code>` : '<span style="color:var(--text-muted);">N/A</span>';
    
    tr.innerHTML = `
      <td style="font-weight:600;">${monthName}</td>
      <td style="font-weight:bold;">₹${p.amount.toFixed(2)}</td>
      <td>${gpayTok}</td>
      <td><span style="color:${badgeColor}; font-weight:600; font-size:0.85rem; text-transform:uppercase;">● ${p.status}</span></td>
      <td>
        ${p.status === 'completed' 
          ? `<button class="btn btn-secondary" style="padding:6px 12px; font-size:0.75rem; border-radius:6px;" onclick="simulateReceiptDownload('${p.id}', '${childName}', ${p.amount}, '${p.gpay_token}')">PDF Receipt</button>` 
          : `<span style="color:var(--text-muted); font-size:0.8rem;">Payment Due</span>`
        }
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// SIMULATED PDF RECEIPT DOWNLOAD
function simulateReceiptDownload(id, childName, amount, token) {
  alert(`
--------------------------------------------------
          SAITRACK DIGITAL PAYMENT RECEIPT
--------------------------------------------------
Transaction ID: ${id}
Gateway Channel: Google Pay (UPI Settlement)
Student Name: ${childName}
Settlement Token: ${token}
Billing Amount: INR ${amount.toFixed(2)}
Status: SUCCESSFUL (Secured)

Generated on: ${new Date().toLocaleString()}
This is an automated, PCI-compliant payment invoice.
--------------------------------------------------

Simulation: Custom receipt saved to browser downloads folder successfully!
  `);
}

// Init tracking map for parent
function initParentTrackingMap(child) {
  if (parentMap) {
    parentMap.remove();
    parentMap = null;
    parentBusMarker = null;
    parentStopMarkers = {};
    parentRouteLine = null;
    parentActiveStopGeofence = null;
  }
  
  const stops = child.profile.boarding_stop_id ? child.profile.boarding_stop_id : null;
  const boardingStop = child.profile.boardingLocation || { latitude: 12.996, longitude: 77.572 };
  
  // Find coordinates of assigned boarding point
  const matchedStop = child.profile.boarding_stop_id 
    ? child.profile.busLocation // fallback or use the database coordinates
    : null;
    
  // Since we populated details on backend db.js, let's look up coordinates
  const stopsList = child.profile.busId === 'bus_1' 
    ? [{latitude: 13.0230, longitude: 77.5500, name: "Yeshwanthpur"}, {latitude: 13.0160, longitude: 77.5640, name: "Ramaiah Gate"}, {latitude: 12.9980, longitude: 77.5630, name: "Malleshwaram 18th Cross"}, {latitude: 12.9990, longitude: 77.5710, name: "IISc East Gate"}]
    : [{latitude: 13.0350, longitude: 77.5970, name: "Hebbal"}, {latitude: 13.0180, longitude: 77.5930, name: "RT Nagar"}, {latitude: 13.0070, longitude: 77.5800, name: "Sadashivanagar"}, {latitude: 12.9960, longitude: 77.5720, name: "IISc Main Gate"}];
    
  const myStop = stopsList[1]; // default mock boarding stop
  const centerCoord = [myStop.latitude, myStop.longitude];
  
  parentMap = L.map('parent-map').setView(centerCoord, 14);
  
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(parentMap);
  
  const routePoints = [];
  stopsList.forEach((stop, idx) => {
    const latlng = [stop.latitude, stop.longitude];
    routePoints.push(latlng);
    
    // Boarding stop highlights
    const isBoarding = idx === 1; // mock boarding
    const icon = L.divIcon({
      className: 'custom-stop-marker',
      html: `<div style="background: ${isBoarding ? '#10b981' : '#6366f1'}; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
      iconSize: [14, 14]
    });
    
    L.marker(latlng, { icon }).addTo(parentMap)
      .bindPopup(`<strong style="color:var(--text-dark);">${stop.name}</strong><br><span style="color:#555;">Child boarding point</span>`);
  });
  
  // Draw route polyline
  parentRouteLine = L.polyline(routePoints, {
    color: '#8b5cf6',
    weight: 4,
    opacity: 0.6,
    dashArray: '8, 8'
  }).addTo(parentMap);
  
  // Circle geofence boarding stop
  parentActiveStopGeofence = L.circle([myStop.latitude, myStop.longitude], {
    color: '#10b981',
    fillColor: '#10b981',
    fillOpacity: 0.15,
    radius: 120
  }).addTo(parentMap);
  
  // Pre-draw bus marker
  const initialBusLoc = child.profile.busLocation ? [child.profile.busLocation.lat, child.profile.busLocation.lng] : [stopsList[0].latitude, stopsList[0].longitude];
  const busIcon = L.divIcon({
    className: 'custom-bus-marker',
    html: `<div style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; box-shadow: 0 0 15px #8b5cf6;">🚌</div>`,
    iconSize: [28, 28]
  });
  
  parentBusMarker = L.marker(initialBusLoc, { icon: busIcon }).addTo(parentMap)
    .bindPopup(`<strong style="color:var(--text-dark);">Bus ${child.profile.busNumber}</strong><br><span style="color:#555;">Live updates active</span>`);
}

// WS socket telemetry handler
function handleParentSocketBusUpdate(data) {
  if (!parentMap || parentChildrenData.length === 0) return;
  
  const activeChild = parentChildrenData[parentActiveChildIndex];
  if (!activeChild || data.busId !== activeChild.profile.busId) return;
  
  const latlng = [data.lat, data.lng];
  
  // Move bus
  if (parentBusMarker) {
    parentBusMarker.setLatLng(latlng);
  }
  
  // Update ETA badge
  document.getElementById('parent-eta-countdown').textContent = `ETA: ${data.etaMin} min`;
}

// WS proximity notification alerts
function handleParentProximityAlert(data) {
  if (parentChildrenData.length === 0) return;
  
  const activeChild = parentChildrenData[parentActiveChildIndex];
  if (data.studentId !== activeChild.profile.user_id) return;
  
  // Feed safety alerts
  const feed = document.getElementById('parent-alerts-feed');
  
  const item = document.createElement('div');
  item.className = 'notification-item';
  item.style.border = '1px solid rgba(245, 158, 11, 0.3)';
  item.style.borderRadius = '8px';
  item.style.marginBottom = '8px';
  item.style.background = 'rgba(245, 158, 11, 0.05)';
  
  item.innerHTML = `
    <div>🔔</div>
    <div>
      <p style="font-weight: 600; color: var(--warning);">Proximity Alert Triggered</p>
      <p style="font-size: 0.85rem; color: var(--text-main); margin-top: 2px;">${data.message}</p>
      <span class="notification-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
    </div>
  `;
  
  // Remove safety indicator if present
  if (feed.querySelector('.notification-item').textContent.includes('All safety indicators')) {
    feed.innerHTML = '';
  }
  
  feed.prepend(item);
  showNotification('Proximity Alert', data.message);
}

// WS student panic alert receiver in parent dashboard
function handleParentPanicAlert(data) {
  if (parentChildrenData.length === 0) return;
  
  const activeChild = parentChildrenData[parentActiveChildIndex];
  if (data.alert.user_id !== activeChild.profile.user_id) return;
  
  const feed = document.getElementById('parent-alerts-feed');
  
  const item = document.createElement('div');
  item.className = 'notification-item';
  item.style.border = '1px solid rgba(239, 68, 68, 0.4)';
  item.style.borderRadius = '8px';
  item.style.marginBottom = '8px';
  item.style.background = 'rgba(239, 68, 68, 0.08)';
  
  item.innerHTML = `
    <div style="font-size: 1.2rem; animation: shake 0.5s infinite alternate;">🚨</div>
    <div>
      <p style="font-weight: 700; color: var(--danger);">EMERGENCY PANIC ALERT ACTIVE</p>
      <p style="font-size: 0.88rem; color: #fecaca; margin-top: 2px;">Your child ${data.alert.userName} triggered the emergency panic button! GPS Coordinates: ${data.alert.latitude.toFixed(4)}, ${data.alert.longitude.toFixed(4)}</p>
      <span class="notification-time">${new Date(data.alert.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
    </div>
  `;
  
  if (feed.querySelector('.notification-item') && feed.querySelector('.notification-item').textContent.includes('All safety indicators')) {
    feed.innerHTML = '';
  }
  
  feed.prepend(item);
  
  // Play alert notification sound or display loud warnings
  alert(`⚠️ PARENT ALERT:\nEmergency Panic Alert triggered by child ${data.alert.userName}! Help is dispatched.`);
}
