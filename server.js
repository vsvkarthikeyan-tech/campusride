const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');
const { ROUTE_GEOMETRIES, getRouteGeometry } = require('./routes-geometry');

const app = express();
const PORT = config.PORT;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory registration OTP store: { [email]: { code, expiresAt, userData } }
const activeOTPs = {};

// ----------------------------------------------------
// AUTHENTICATION & SECURITY MIDDLEWARE
// ----------------------------------------------------

/**
 * Standard JWT verification middleware using jsonwebtoken
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required: access token missing' });
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session token' });
    }
    req.user = user;
    next();
  });
}

/**
 * Role-based authorization middleware
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access forbidden: requires one of the following roles: [${roles.join(', ')}]`
      });
    }
    next();
  };
}

// ----------------------------------------------------
// PUBLIC & AUTHENTICATION ENDPOINTS
// ----------------------------------------------------

// Server Configuration & Campus metadata for frontend
app.get('/api/config', (req, res) => {
  res.json({
    campus: config.CAMPUS,
    demoMode: config.DEMO_MODE,
    simulationEnabled: simulationRunning,
    map: config.MAP
  });
});

// Route Road Geometry Endpoint
app.get('/api/routes/:id/geometry', (req, res) => {
  const routeId = req.params.id;
  const geometry = getRouteGeometry(routeId);
  if (!geometry) {
    // Fallback: collect stop coordinates
    const stops = db.getStops().filter(s => s.route_id === routeId).sort((a,b) => a.sequence_order - b.sequence_order);
    return res.json({
      routeId,
      geometry: stops.map(s => [s.latitude, s.longitude]),
      source: 'stops_fallback'
    });
  }
  res.json({
    routeId,
    geometry,
    source: 'verified_road_waypoints'
  });
});

// Register Account Request (Sends OTP)
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !phone || !password || !role) {
    return res.status(400).json({ error: 'All fields (name, email, phone, password, role) are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format' });
  }

  // Restrict self-registration to student or parent
  if (!['student', 'parent'].includes(role)) {
    return res.status(400).json({ error: 'Self-registration is only allowed for Student and Parent roles' });
  }

  // Check if user exists
  const existing = db.findUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'Email is already registered' });
  }

  // Generate 6-digit OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  activeOTPs[email.toLowerCase()] = {
    code: otpCode,
    expiresAt: Date.now() + 600000, // 10 minutes
    userData: { name, email: email.toLowerCase(), phone, password, role }
  };

  console.log(`\n--- [SMS/EMAIL OTP GATEWAY SIMULATOR] ---`);
  console.log(`To: ${phone} (${name})`);
  console.log(`Saitrack / CampusRide Verification OTP: ${otpCode}`);
  console.log(`Notice: Simulated SMS channel. Production deployments require Twilio/AWS SNS integration.`);
  console.log(`-----------------------------------------\n`);

  const responsePayload = {
    message: 'Verification code dispatched to registered mobile number',
    email: email.toLowerCase()
  };

  // Only expose OTP directly in response if explicitly enabled for local test scripts
  if (config.EXPOSE_MOCK_OTP) {
    responsePayload.mock_otp = otpCode;
  }

  res.json(responsePayload);
});

// Verify OTP & Activate Account
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and OTP verification code are required' });
  }

  const storedOtp = activeOTPs[email.toLowerCase()];
  if (!storedOtp) {
    return res.status(400).json({ error: 'No active registration found. Please request a new verification code.' });
  }

  if (storedOtp.expiresAt < Date.now()) {
    delete activeOTPs[email.toLowerCase()];
    return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
  }

  if (storedOtp.code !== code.toString().trim()) {
    return res.status(400).json({ error: 'Incorrect verification code. Please check and try again.' });
  }

  const u = storedOtp.userData;
  const userId = `usr_${Date.now()}`;

  // Insert core user with salted Bcrypt password hash
  const newUser = db.insertUser({
    id: userId,
    name: u.name,
    email: u.email,
    password_hash: db.hashPassword(u.password),
    role: u.role,
    phone: u.phone,
    created_at: new Date().toISOString()
  });

  // Role-specific setup
  if (u.role === 'student') {
    db.insertStudent({
      user_id: userId,
      rfid_tag: `RFID_SEC_${Date.now().toString().slice(-4)}`,
      class_grade: "1st Year",
      route_id: "route_1",
      boarding_stop_id: "stop_1_1"
    });

    db.insertPayment({
      id: `pay_${Date.now()}`,
      student_id: userId,
      amount: 2500.00,
      currency: "INR",
      gpay_token: null,
      status: "pending",
      simulated: true,
      timestamp: new Date().toISOString()
    });
  } else if (u.role === 'parent') {
    db.insertParent({ user_id: userId });
    // Link to pre-seeded student for demonstration if available
    const demoStudent = db.findUserById('usr_student_1');
    if (demoStudent) {
      db.linkParentStudent(userId, "usr_student_1");
    }
  }

  delete activeOTPs[email.toLowerCase()];
  res.json({ message: 'Verification successful! Your account is activated.', role: u.role });
});

// User Login (Bcrypt verified + JWT issued)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.findUserByEmail(email);
  if (!user || !db.verifyPassword(user, password)) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone
  };

  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

  res.json({
    message: 'Login successful',
    token,
    user: payload
  });
});

// ----------------------------------------------------
// STUDENT DASHBOARD ENDPOINTS
// ----------------------------------------------------

app.get('/api/student/dashboard', authenticateToken, requireRole('student'), (req, res) => {
  const details = db.getStudentDetails(req.user.id);
  if (!details) return res.status(404).json({ error: 'Student profile not found' });

  const payments = db.getPayments().filter(p => p.student_id === req.user.id);
  const attendance = db.getAttendance().filter(a => a.student_id === req.user.id);
  const stops = db.getStops().filter(s => s.route_id === details.route_id);

  // Co-riders on the same route
  const todayStr = new Date().toISOString().split('T')[0];
  const coRiders = db.getStudents()
    .filter(st => st.route_id === details.route_id)
    .map(st => {
      const u = db.findUserById(st.user_id);
      if (!u) return null;
      const route = db.getRoutes().find(r => r.id === st.route_id);
      const stop = db.getStops().find(s => s.id === st.boarding_stop_id);
      const todayAtt = db.getAttendance().find(a => a.student_id === st.user_id && a.date === todayStr);
      return {
        student_id: st.user_id,
        name: u.name,
        class_grade: st.class_grade,
        route_id: st.route_id,
        routeName: route ? route.name : 'Unassigned',
        boarding_stop_id: st.boarding_stop_id,
        stopName: stop ? stop.name : 'Unassigned Stop',
        status: todayAtt ? todayAtt.status : -1,
        marked_by: todayAtt ? todayAtt.marked_by : null,
        timestamp: todayAtt ? todayAtt.timestamp : null
      };
    })
    .filter(Boolean);

  res.json({
    profile: details,
    stops,
    payments,
    attendance,
    coRiders,
    campus: config.CAMPUS
  });
});

app.post('/api/student/boarding', authenticateToken, requireRole('student'), (req, res) => {
  const { stopId } = req.body;
  if (!stopId) return res.status(400).json({ error: 'stopId is required' });

  // Verify stop exists
  const stop = db.getStops().find(s => s.id === stopId);
  if (!stop) return res.status(404).json({ error: 'Specified stop does not exist' });

  const success = db.updateStudentStop(req.user.id, stopId);
  if (success) {
    res.json({ message: 'Boarding point updated successfully', stop });
  } else {
    res.status(500).json({ error: 'Failed to update boarding stop' });
  }
});

// Student Manual RFID Demo Tap
app.post('/api/student/rfid-tap', authenticateToken, requireRole('student'), (req, res) => {
  const studentId = req.user.id;
  const details = db.getStudentDetails(studentId);
  if (!details) return res.status(404).json({ error: 'Student profile not found' });

  const todayStr = new Date().toISOString().split('T')[0];
  const existingIdx = db.data.attendance.findIndex(a => a.student_id === studentId && a.date === todayStr);

  const record = {
    id: existingIdx !== -1 ? db.data.attendance[existingIdx].id : `att_${studentId}_rfid_${Date.now().toString(36)}`,
    student_id: studentId,
    date: todayStr,
    status: 1, // Present
    marked_by: 'Student_Manual_RFID_Demo_Tap',
    timestamp: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    db.data.attendance[existingIdx] = record;
  } else {
    db.data.attendance.push(record);
  }
  db.save();

  // Broadcast WebSocket notification to parents, admins, and student
  broadcastSocketMessage({
    type: 'rfid_boarded',
    studentId: studentId,
    studentName: details.name,
    busNumber: details.busNumber || 'College Bus',
    stopName: details.stopName || 'Boarding stop',
    timestamp: record.timestamp,
    status: 1,
    is_demo: true,
    channel: 'websocket_in_app'
  });

  res.json({
    message: 'ID Card simulation scanned successfully. Attendance logged as Present.',
    record,
    is_demo: true
  });
});

// Student Panic Emergency Dispatch
app.post('/api/student/panic', authenticateToken, (req, res) => {
  const { latitude, longitude, message, type, location_type } = req.body;
  
  // Validate coordinates if provided
  let lat = parseFloat(latitude);
  let lng = parseFloat(longitude);
  let resolvedLocationType = location_type || 'browser_gps';

  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    // Fallback to student boarding stop coordinates
    const details = db.getStudentDetails(req.user.id);
    if (details && details.boardingStop) {
      lat = details.boardingStop.latitude;
      lng = details.boardingStop.longitude;
      resolvedLocationType = 'stop_fallback';
    } else {
      lat = config.CAMPUS.latitude;
      lng = config.CAMPUS.longitude;
      resolvedLocationType = 'campus_fallback';
    }
  }

  const alertId = `alert_${Date.now()}`;
  const alert = db.insertAlert({
    id: alertId,
    user_id: req.user.id,
    type: type || 'student_panic',
    message: message || `Emergency Panic Triggered by ${req.user.name}`,
    latitude: lat,
    longitude: lng,
    location_type: resolvedLocationType,
    status: 'active',
    resolved_by: null,
    timestamp: new Date().toISOString()
  });

  broadcastSocketMessage({
    type: 'emergency_alert',
    alert: {
      ...alert,
      userName: req.user.name,
      userPhone: req.user.phone,
      userRole: req.user.role
    }
  });

  res.json({
    message: 'Emergency alert logged and broadcast to campus administration and family.',
    alertId,
    coordinates: { lat, lng, location_type: resolvedLocationType }
  });
});

// ----------------------------------------------------
// PARENT DASHBOARD ENDPOINTS
// ----------------------------------------------------

app.get('/api/parent/children', authenticateToken, requireRole('parent'), (req, res) => {
  const links = db.getParentStudents().filter(ps => ps.parent_id === req.user.id);
  const children = links.map(link => {
    const details = db.getStudentDetails(link.student_id);
    if (!details) return null;

    const payments = db.getPayments().filter(p => p.student_id === link.student_id);
    const attendance = db.getAttendance().filter(a => a.student_id === link.student_id);
    const route = db.getRoutes().find(r => r.id === details.route_id);
    const stops = db.getStops().filter(s => s.route_id === details.route_id);

    return {
      profile: details,
      route,
      stops,
      payments,
      attendance
    };
  }).filter(Boolean);

  res.json({ children, campus: config.CAMPUS });
});

// ----------------------------------------------------
// REAL HARDWARE INGEST ENDPOINTS (GPS & UHF RFID)
// ----------------------------------------------------

/**
 * Driver / GPS Device Location Ingest Endpoint
 * Allows physical GPS tracking hardware or authenticated drivers to update location.
 */
app.post('/api/driver/location', (req, res) => {
  // Allow authentication either via Bearer Token (driver/admin) or X-Device-Key
  const authHeader = req.headers['authorization'];
  const deviceKey = req.headers['x-device-key'];
  let authorized = false;

  if (deviceKey && deviceKey === config.GPS_DEVICE_API_KEY) {
    authorized = true;
  } else if (authHeader) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (['driver', 'admin'].includes(decoded.role)) {
        authorized = true;
      }
    } catch (err) {}
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Unauthorized: valid driver credentials or device key required' });
  }

  const { busId, latitude, longitude, speed, heading, timestamp } = req.body;
  if (!busId || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'busId, latitude, and longitude are required' });
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid latitude or longitude coordinates' });
  }

  const bus = db.updateBusLocation(busId, lat, lng, speed, heading, false);
  if (!bus) {
    return res.status(404).json({ error: `Bus not found for ID: ${busId}` });
  }

  // Broadcast real GPS coordinates to connected users
  broadcastSocketMessage({
    type: 'bus_location',
    busId: bus.id,
    busNumber: bus.bus_number,
    lat,
    lng,
    speed: bus.speed_kmh || 0,
    heading: bus.heading || 0,
    timestamp: bus.last_update,
    is_simulated: false,
    status: 'live'
  });

  res.json({
    message: 'Bus location updated successfully via live GPS telemetry',
    bus: {
      id: bus.id,
      bus_number: bus.bus_number,
      latitude: bus.latitude,
      longitude: bus.longitude,
      speed_kmh: bus.speed_kmh,
      last_update: bus.last_update,
      is_simulated: false
    }
  });
});

/**
 * UHF RFID Reader Ingest Endpoint (Physical Bus Scanners)
 */
app.post('/api/rfid/scan', (req, res) => {
  const readerKey = req.headers['x-reader-key'];
  const authHeader = req.headers['authorization'];
  let authorized = false;

  if (readerKey && readerKey === config.RFID_READER_API_KEY) {
    authorized = true;
  } else if (authHeader) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (['driver', 'admin'].includes(decoded.role)) authorized = true;
    } catch (e) {}
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Unauthorized: valid RFID reader API key or staff token required' });
  }

  const { rfid_tag, bus_id, reader_id, timestamp } = req.body;
  if (!rfid_tag || !bus_id) {
    return res.status(400).json({ error: 'rfid_tag and bus_id are required' });
  }

  const bus = db.getBuses().find(b => b.id === bus_id);
  if (!bus) {
    return res.status(404).json({ error: `Bus not found for ID: ${bus_id}` });
  }

  const scanResult = db.recordRFIDScan({
    rfid_tag,
    bus_id,
    reader_id,
    timestamp
  });

  if (!scanResult.success) {
    return res.status(404).json({ error: scanResult.error });
  }

  if (scanResult.duplicate) {
    return res.status(200).json({
      status: 'ignored',
      message: scanResult.message,
      lastScanTime: scanResult.lastScanTime
    });
  }

  const studentUser = db.findUserById(scanResult.student.user_id);
  const stop = db.getStops().find(s => s.id === scanResult.student.boarding_stop_id);

  console.log(`\n--- [💳 UHF RFID PHYSICAL GATE EVENT] ---`);
  console.log(`Student: ${studentUser ? studentUser.name : scanResult.student.user_id}`);
  console.log(`RFID Tag: ${rfid_tag}`);
  console.log(`Bus: ${bus.bus_number}`);
  console.log(`Status: PRESENT logged.`);
  console.log(`-----------------------------------------\n`);

  // Broadcast WebSocket event
  broadcastSocketMessage({
    type: 'rfid_boarded',
    studentId: scanResult.student.user_id,
    studentName: studentUser ? studentUser.name : 'Student',
    busNumber: bus.bus_number,
    stopName: stop ? stop.name : 'Assigned Stop',
    timestamp: scanResult.record.timestamp,
    status: 1,
    is_hardware_rfid: true,
    channel: 'websocket_in_app'
  });

  res.json({
    message: 'RFID scan validated and attendance logged',
    record: scanResult.record,
    student: {
      id: scanResult.student.user_id,
      name: studentUser ? studentUser.name : ''
    }
  });
});

// ----------------------------------------------------
// PAYMENTS APIS (WITH CLEAR SIMULATION DISCLAIMERS)
// ----------------------------------------------------

app.post('/api/payments/create', authenticateToken, (req, res) => {
  const { amount, paymentId } = req.body;
  if (!amount || !paymentId) {
    return res.status(400).json({ error: 'amount and paymentId are required' });
  }

  res.json({
    message: 'Google Pay transaction initialized (Sandbox / Test Mode)',
    gatewayToken: `gpay_sess_${Date.now()}`,
    simulated: true,
    notice: 'Demonstration payment channel - No real bank charges will occur.'
  });
});

app.post('/api/payments/confirm', authenticateToken, (req, res) => {
  const { paymentId, gpayToken } = req.body;
  if (!paymentId || !gpayToken) {
    return res.status(400).json({ error: 'paymentId and gpayToken required' });
  }

  const updated = db.updatePaymentStatus(paymentId, 'completed', gpayToken);
  if (updated) {
    res.json({
      message: 'Payment verified and receipt registered (Simulated)',
      payment: updated,
      simulated: true,
      notice: 'Demonstration invoice auto-logged.'
    });
  } else {
    res.status(404).json({ error: 'Payment record not found' });
  }
});

// ----------------------------------------------------
// ADMIN ENDPOINTS
// ----------------------------------------------------

app.get('/api/admin/attendance', authenticateToken, requireRole('admin'), (req, res) => {
  res.json({ attendance: db.getAttendance(), students: db.getStudents(), users: db.getUsers() });
});

app.post('/api/admin/attendance/mark', authenticateToken, requireRole('admin'), (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'records array required' });
  }

  const results = db.bulkMarkAttendance(records, req.user.id);
  broadcastSocketMessage({
    type: 'attendance_override',
    records: results,
    marked_by: req.user.id
  });

  res.json({ message: 'Attendance records updated successfully', records: results });
});

app.get('/api/admin/routes', authenticateToken, requireRole('admin'), (req, res) => {
  res.json({
    routes: db.getRoutes(),
    stops: db.getStops(),
    buses: db.getBuses(),
    campus: config.CAMPUS
  });
});

app.post('/api/admin/routes/create', authenticateToken, requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name is required' });

  const routeId = `route_${Date.now()}`;
  db.data.routes.push({ id: routeId, name, description });
  db.save();

  res.json({ message: 'Route created successfully', routeId });
});

app.post('/api/admin/stops/create', authenticateToken, requireRole('admin'), (req, res) => {
  const { routeId, stops } = req.body;
  if (!routeId || !stops || !Array.isArray(stops)) {
    return res.status(400).json({ error: 'routeId and stops array required' });
  }

  db.data.stops = db.data.stops.filter(s => s.route_id !== routeId);

  stops.forEach((s, idx) => {
    db.data.stops.push({
      id: `stop_${Date.now()}_${idx}`,
      route_id: routeId,
      name: s.name,
      latitude: parseFloat(s.lat),
      longitude: parseFloat(s.lng),
      sequence_order: idx + 1
    });
  });
  db.save();

  res.json({ message: 'Route stops updated successfully' });
});

app.get('/api/admin/alerts', authenticateToken, requireRole('admin'), (req, res) => {
  const allAlerts = db.getAlerts().map(a => {
    const usr = db.findUserById(a.user_id);
    return {
      ...a,
      userName: usr ? usr.name : 'Unknown User',
      userPhone: usr ? usr.phone : 'N/A'
    };
  });
  res.json({ alerts: allAlerts });
});

app.post('/api/admin/alerts/action', authenticateToken, requireRole('admin'), (req, res) => {
  const { alertId, action } = req.body;
  if (!alertId || !action) return res.status(400).json({ error: 'alertId and action are required' });

  let updated;
  if (action === 'resolve') {
    updated = db.resolveAlert(alertId, req.user.id);
  } else {
    updated = db.acknowledgeAlert(alertId);
  }

  if (updated) {
    broadcastSocketMessage({ type: 'alert_status_changed', alert: updated });
    res.json({ message: `Alert ${action}d successfully`, alert: updated });
  } else {
    res.status(404).json({ error: 'Alert not found' });
  }
});

app.get('/api/admin/users', authenticateToken, requireRole('admin'), (req, res) => {
  const enrichedStudents = db.getStudents().map(s => {
    const usr = db.findUserById(s.user_id);
    const rt = db.getRoutes().find(r => r.id === s.route_id);
    const st = db.getStops().find(stop => stop.id === s.boarding_stop_id);
    return {
      user_id: s.user_id,
      rfid_tag: s.rfid_tag || 'N/A',
      class_grade: s.class_grade,
      route_id: s.route_id,
      routeName: rt ? rt.name : 'None',
      boarding_stop_id: s.boarding_stop_id,
      stopName: st ? st.name : 'None',
      name: usr ? usr.name : 'Deleted',
      email: usr ? usr.email : '',
      phone: usr ? usr.phone : '',
      created_at: usr ? usr.created_at : ''
    };
  });

  res.json({
    students: enrichedStudents,
    users: db.getUsers().filter(u => u.role !== 'admin')
  });
});

app.post('/api/admin/users/create', authenticateToken, requireRole('admin'), (req, res) => {
  const { name, email, phone, password, role, class_grade, route_id, boarding_stop_id, rfid_tag } = req.body;
  if (!name || !email || !phone || !password || !role) {
    return res.status(400).json({ error: 'Required fields missing' });
  }

  const existing = db.findUserByEmail(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });

  const userId = `usr_${Date.now()}`;
  db.insertUser({
    id: userId,
    name,
    email,
    password_hash: db.hashPassword(password),
    role,
    phone,
    created_at: new Date().toISOString()
  });

  if (role === 'student') {
    db.insertStudent({
      user_id: userId,
      rfid_tag: rfid_tag || `RFID_SEC_${Date.now().toString().slice(-4)}`,
      class_grade: class_grade || 'Unassigned',
      route_id: route_id || 'route_1',
      boarding_stop_id: boarding_stop_id || 'stop_1_1'
    });
  }

  res.json({ message: 'User created successfully', userId });
});

app.post('/api/admin/users/update', authenticateToken, requireRole('admin'), (req, res) => {
  const { user_id, name, email, phone, class_grade, route_id, boarding_stop_id, rfid_tag } = req.body;

  const user = db.findUserById(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;

  if (user.role === 'student') {
    const student = db.getStudents().find(s => s.user_id === user_id);
    if (student) {
      if (class_grade) student.class_grade = class_grade;
      if (route_id) student.route_id = route_id;
      if (boarding_stop_id) student.boarding_stop_id = boarding_stop_id;
      if (rfid_tag) student.rfid_tag = rfid_tag;
    }
  }
  db.save();

  res.json({ message: 'User profile updated successfully' });
});

app.post('/api/admin/users/delete', authenticateToken, requireRole('admin'), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  db.data.users = db.data.users.filter(u => u.id !== user_id);
  db.data.students = db.data.students.filter(s => s.user_id !== user_id);
  db.data.parents = db.data.parents.filter(p => p.user_id !== user_id);
  db.data.parent_student = db.data.parent_student.filter(ps => ps.student_id !== user_id && ps.parent_id !== user_id);
  db.save();

  res.json({ message: 'User deleted successfully' });
});

app.get('/api/admin/reports', authenticateToken, requireRole('admin'), (req, res) => {
  const payments = db.getPayments();
  const attendance = db.getAttendance();

  const collected = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
  const outstanding = payments.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0);

  const totalAtt = attendance.length;
  const present = attendance.filter(a => a.status === 1).length;
  const absent = totalAtt - present;

  res.json({
    collected,
    outstanding,
    present,
    absent,
    totalBuses: db.getBuses().length,
    totalStudents: db.getStudents().length
  });
});

// Admin simulation toggle endpoint
app.post('/api/admin/simulation/toggle', authenticateToken, requireRole('admin'), (req, res) => {
  simulationRunning = !simulationRunning;
  res.json({
    message: `Virtual GPS simulation is now ${simulationRunning ? 'ACTIVE' : 'STOPPED'}`,
    simulationRunning
  });
});

// ----------------------------------------------------
// WEBSOCKET SERVER & REAL-TIME PROTOCOL
// ----------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const socketClients = new Set();

wss.on('connection', (ws) => {
  socketClients.add(ws);
  console.log(`WebSocket client connected. Total clients: ${socketClients.size}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Authenticated driver publishes coordinates over WebSocket
      if (data.type === 'driver_update') {
        const { busId, lat, lon, speed, heading, token } = data;
        
        // Verify driver JWT
        let isAuthorized = false;
        if (token) {
          try {
            const decoded = jwt.verify(token, config.JWT_SECRET);
            if (['driver', 'admin'].includes(decoded.role)) isAuthorized = true;
          } catch (e) {}
        }

        if (!isAuthorized) {
          return ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized driver location update' }));
        }

        const bus = db.updateBusLocation(busId, lat, lon, speed, heading, false);
        if (bus) {
          broadcastSocketMessage({
            type: 'bus_location',
            busId,
            busNumber: bus.bus_number,
            lat,
            lng: lon,
            speed: bus.speed_kmh,
            heading: bus.heading,
            timestamp: bus.last_update,
            is_simulated: false,
            status: 'live'
          });
        }
      }
    } catch (err) {
      console.error('Failed to parse WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    socketClients.delete(ws);
    console.log(`WebSocket client disconnected. Total clients: ${socketClients.size}`);
  });
});

function broadcastSocketMessage(obj) {
  const msg = JSON.stringify(obj);
  socketClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ----------------------------------------------------
// OPTIONAL VIRTUAL DRIVER SIMULATION LAYER
// Only runs if SIMULATION_ENABLED is true in config or toggled by admin
// ----------------------------------------------------
let simulationRunning = config.SIMULATION_ENABLED;
const busPathIndexes = { bus_1: 0, bus_2: 0 };

setInterval(() => {
  if (!simulationRunning) return;

  const activeBuses = db.getBuses();

  activeBuses.forEach(bus => {
    const geometry = ROUTE_GEOMETRIES[bus.route_id];
    if (!geometry || geometry.length === 0) return;

    let nextIdx = (busPathIndexes[bus.id] + 1) % geometry.length;
    busPathIndexes[bus.id] = nextIdx;

    const [nextLat, nextLng] = geometry[nextIdx];
    const speed = 32 + Math.round(Math.random() * 8);

    // Update database (explicitly tagged as simulated)
    db.updateBusLocation(bus.id, nextLat, nextLng, speed, 0, true);

    // Calculate approximate ETA to final stop (Sri Sairam College Campus Gate)
    const stopsLeft = Math.abs((geometry.length - 1) - nextIdx);
    const etaMin = Math.max(1, Math.round(stopsLeft * 1.8));

    // Broadcast simulated coordinates with explicit simulation flag
    broadcastSocketMessage({
      type: 'bus_location',
      busId: bus.id,
      busNumber: bus.bus_number,
      lat: nextLat,
      lng: nextLng,
      speed: speed,
      etaMin: etaMin,
      timestamp: new Date().toISOString(),
      is_simulated: true, // EXPLICIT SIMULATION NOTICE
      status: 'simulated'
    });
  });
}, 3000);

// Start HTTP Server
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` SaiTrack / CampusRide Server Active`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Campus: ${config.CAMPUS.name} (${config.CAMPUS.latitude}, ${config.CAMPUS.longitude})`);
  console.log(` Mode: ${config.DEMO_MODE ? 'Demonstration Mode' : 'Production Mode'}`);
  console.log(` GPS Simulation: ${simulationRunning ? 'Running' : 'Disabled (Awaiting live GPS hardware)'}`);
  console.log(`======================================================\n`);
});

module.exports = { app, server };
