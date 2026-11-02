// Driver Dashboard Logic Control with Real Leaflet Map Integration and Live GPS Broadcasting

let driverMap = null;
let driverBusMarker = null;
let driverCampusMarker = null;
let driverRouteLine = null;
let driverStopMarkers = [];
let driverWatchId = null;
let driverDashboardData = null;
let driverIsSharingGPS = false;

async function initDriverDashboard() {
  try {
    const res = await fetch('/api/driver/dashboard', {
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load driver dashboard');

    driverDashboardData = data;

    // Set Welcome Header
    const welcomeName = document.getElementById('driver-welcome-name');
    if (welcomeName) welcomeName.textContent = data.driver.name;

    const licenseBadge = document.getElementById('driver-license-badge');
    if (licenseBadge) licenseBadge.textContent = data.driver.licenseNumber || 'Verified Driver';

    // Populate Bus and Route Information
    const busNumEl = document.getElementById('driver-bus-num');
    if (busNumEl) busNumEl.textContent = data.bus ? data.bus.bus_number : 'Unassigned Bus';

    const routeNameEl = document.getElementById('driver-route-name');
    if (routeNameEl) routeNameEl.textContent = data.route ? (data.route.name || data.route.route_number) : 'Unassigned Route';

    const studentCountEl = document.getElementById('driver-student-count');
    if (studentCountEl) studentCountEl.textContent = `${data.student_count || 0} Students Assigned`;

    const capacityEl = document.getElementById('driver-bus-capacity');
    if (capacityEl && data.bus) {
      capacityEl.textContent = `Capacity: ${data.student_count || 0} / ${data.bus.capacity || 50} (${data.bus.capacity ? Math.round(((data.student_count || 0) / data.bus.capacity) * 100) : 0}%)`;
    }

    // Trip Status
    updateDriverTripUI(data.trip_status || 'idle');

    // Render Ordered Stops Checklist
    renderDriverStopsChecklist(data.stops || []);

    // Initialize Driver Leaflet Map
    initDriverMap(data);

  } catch (err) {
    console.error('Driver Dashboard Initialization Error:', err);
    alert(`Driver Dashboard Error: ${err.message}`);
  }
}

function updateDriverTripUI(status) {
  const statusBadge = document.getElementById('driver-trip-status-badge');
  const startBtn = document.getElementById('btn-driver-start-trip');
  const endBtn = document.getElementById('btn-driver-end-trip');

  if (status === 'in_progress') {
    if (statusBadge) {
      statusBadge.textContent = 'TRIP IN PROGRESS';
      statusBadge.className = 'status-pill status-pill-active';
    }
    if (startBtn) startBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'inline-flex';
  } else if (status === 'completed') {
    if (statusBadge) {
      statusBadge.textContent = 'TRIP COMPLETED';
      statusBadge.className = 'status-pill status-pill-resolved';
    }
    if (startBtn) {
      startBtn.style.display = 'inline-flex';
      startBtn.textContent = 'Start New Trip';
    }
    if (endBtn) endBtn.style.display = 'none';
  } else {
    if (statusBadge) {
      statusBadge.textContent = 'SCHEDULED / IDLE';
      statusBadge.className = 'status-pill status-pill-pending';
    }
    if (startBtn) {
      startBtn.style.display = 'inline-flex';
      startBtn.textContent = 'Start Trip';
    }
    if (endBtn) endBtn.style.display = 'none';
  }
}

async function startDriverTrip() {
  if (!confirm('Start official trip for this route? Live tracking will be broadcast to parents and students.')) return;
  try {
    const res = await fetch('/api/driver/trip/start', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start trip');
    updateDriverTripUI('in_progress');
    showNotification('Trip Started', data.message || 'College trip started.');
    // Automatically start GPS sharing
    if (!driverIsSharingGPS) toggleDriverGPS();
  } catch (err) {
    alert(`Could not start trip: ${err.message}`);
  }
}

async function endDriverTrip() {
  if (!confirm('Complete and end this trip?')) return;
  try {
    const res = await fetch('/api/driver/trip/end', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${globalState.token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to end trip');
    updateDriverTripUI('completed');
    showNotification('Trip Completed', data.message || 'Trip completed safely.');
    if (driverIsSharingGPS) toggleDriverGPS(); // Stop sharing GPS
  } catch (err) {
    alert(`Could not complete trip: ${err.message}`);
  }
}

function toggleDriverGPS() {
  const gpsBtn = document.getElementById('btn-driver-toggle-gps');
  const gpsStatusEl = document.getElementById('driver-gps-live-status');

  if (driverIsSharingGPS) {
    // Stop sharing
    if (driverWatchId) {
      navigator.geolocation.clearWatch(driverWatchId);
      driverWatchId = null;
    }
    driverIsSharingGPS = false;
    if (gpsBtn) {
      gpsBtn.className = 'btn btn-secondary';
      gpsBtn.innerHTML = '<span>📍</span> Start Sharing Live GPS';
    }
    if (gpsStatusEl) {
      gpsStatusEl.textContent = 'GPS Broadcasting Paused';
      gpsStatusEl.style.color = 'var(--text-muted)';
    }
    showNotification('GPS Paused', 'Stopped broadcasting live GPS coordinates.');
  } else {
    // Start sharing
    if (!navigator.geolocation) {
      alert('Geolocation API is not supported on this browser or device.');
      return;
    }

    driverIsSharingGPS = true;
    if (gpsBtn) {
      gpsBtn.className = 'btn btn-success';
      gpsBtn.innerHTML = '<span>📡</span> Live GPS Streaming Active';
    }
    if (gpsStatusEl) {
      gpsStatusEl.textContent = 'Transmitting Real GPS Location';
      gpsStatusEl.style.color = 'var(--secondary)';
    }

    driverWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const speed = position.coords.speed ? Math.round(position.coords.speed * 3.6) : 0;
        const heading = position.coords.heading || 0;

        // Update local speed indicator
        const speedVal = document.getElementById('driver-live-speed-val');
        if (speedVal) speedVal.textContent = `${speed} km/h`;

        // Update local map marker
        if (driverBusMarker) {
          driverBusMarker.setLatLng([lat, lng]);
        }

        // Send to backend location ingest
        if (driverDashboardData && driverDashboardData.bus) {
          fetch('/api/driver/location', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${globalState.token}`
            },
            body: JSON.stringify({
              busId: driverDashboardData.bus.id,
              latitude: lat,
              longitude: lng,
              speed,
              heading,
              timestamp: new Date().toISOString()
            })
          }).catch(e => console.warn('GPS broadcast failed:', e));
        }
      },
      (error) => {
        console.warn('Geolocation watch error:', error.message);
        if (gpsStatusEl) {
          gpsStatusEl.textContent = `GPS Signal Warning: ${error.message}`;
          gpsStatusEl.style.color = 'var(--warning)';
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000
      }
    );

    showNotification('GPS Streaming', 'Broadcasting live device GPS telemetry to Sri Sairam campus fleet monitor.');
  }
}

function renderDriverStopsChecklist(stops) {
  const container = document.getElementById('driver-stops-list');
  if (!container) return;

  if (!stops || stops.length === 0) {
    container.innerHTML = '<div style="padding: 16px; color: var(--text-muted); text-align: center;">No stops configured for this route yet.</div>';
    return;
  }

  container.innerHTML = stops.map((s, idx) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 8px; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--primary-glow); font-size: 0.82rem; font-weight: 700; color: var(--text-main);">
          ${s.sequence_order || idx + 1}
        </span>
        <div>
          <div style="font-weight: 600; color: var(--text-main); font-size: 0.95rem;">${s.name || s.stop_name}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">
            Coords: ${s.latitude ? s.latitude.toFixed(4) : 'N/A'}, ${s.longitude ? s.longitude.toFixed(4) : 'N/A'}
          </div>
        </div>
      </div>
      <div style="text-align: right;">
        <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: var(--secondary); font-size: 0.8rem; font-weight: 600;">
          🕒 ${s.pickup_time || '07:30 AM'}
        </span>
      </div>
    </div>
  `).join('');
}

function initDriverMap(data) {
  const mapContainer = document.getElementById('driver-map');
  if (!mapContainer) return;

  if (driverMap) {
    driverMap.remove();
    driverMap = null;
  }

  const campusLat = (data.campus && data.campus.latitude) || 12.9601;
  const campusLng = (data.campus && data.campus.longitude) || 80.0574;

  const initialLat = (data.bus && data.bus.latitude) ? data.bus.latitude : campusLat;
  const initialLng = (data.bus && data.bus.longitude) ? data.bus.longitude : campusLng;

  driverMap = L.map('driver-map', {
    center: [initialLat, initialLng],
    zoom: 13,
    attributionControl: true
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors | Sri Sairam Transport'
  }).addTo(driverMap);

  // College Marker
  const collegeIcon = L.divIcon({
    className: 'custom-college-marker',
    html: `<div style="background: #1e3a8a; border: 2px solid #60a5fa; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; box-shadow: 0 0 12px rgba(96,165,250,0.6);">🎓</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

  driverCampusMarker = L.marker([campusLat, campusLng], { icon: collegeIcon })
    .addTo(driverMap)
    .bindPopup('<b>Sri Sairam Engineering College</b><br>Sai Leo Nagar, West Tambaram, Chennai<br>Destination Terminal');

  // Bus Marker
  const busIcon = L.divIcon({
    className: 'custom-bus-marker',
    html: `<div style="background: #f59e0b; border: 2px solid #fff; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; box-shadow: 0 0 14px rgba(245,158,11,0.8);">🚌</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  driverBusMarker = L.marker([initialLat, initialLng], { icon: busIcon })
    .addTo(driverMap)
    .bindPopup(`<b>My Bus: ${data.bus ? data.bus.bus_number : 'Assigned Bus'}</b><br>Live GPS Ready`);

  // Render Stop Markers
  driverStopMarkers = [];
  const waypoints = [];

  if (Array.isArray(data.stops) && data.stops.length > 0) {
    data.stops.forEach((s, idx) => {
      const lat = parseFloat(s.latitude);
      const lng = parseFloat(s.longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        waypoints.push([lat, lng]);

        const stopIcon = L.divIcon({
          className: 'custom-stop-marker',
          html: `<div style="background: #3b82f6; color: #fff; border: 2px solid #fff; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">${s.sequence_order || idx + 1}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const stopMarker = L.marker([lat, lng], { icon: stopIcon })
          .addTo(driverMap)
          .bindPopup(`<b>Stop #${s.sequence_order || idx + 1}: ${s.name || s.stop_name}</b><br>Scheduled Time: ${s.pickup_time || '07:30 AM'}`);

        driverStopMarkers.push(stopMarker);
      }
    });

    waypoints.push([campusLat, campusLng]); // Ends at college gate

    // Polyline connecting stops to college
    driverRouteLine = L.polyline(waypoints, {
      color: '#3b82f6',
      weight: 5,
      opacity: 0.85,
      dashArray: '8, 8'
    }).addTo(driverMap);

    driverMap.fitBounds(driverRouteLine.getBounds(), { padding: [40, 40] });
  }

  setTimeout(() => {
    if (driverMap) driverMap.invalidateSize();
  }, 400);
}
