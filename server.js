const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const config = require('./config');
const db = require('./db');
const { ROUTE_GEOMETRIES, getRouteGeometry } = require('./routes-geometry');
const excelService = require('./excel-service');

const app = express();
const PORT = config.PORT;

// Multer memory storage configuration for secure Excel upload (limit: 5MB)
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      return cb(new Error('Invalid file format: Only Excel (.xlsx and .xls) files are accepted.'));
    }
    cb(null, true);
  }
});

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
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

  // Academic Year Validation (Module 2: Strictly reject school classes)
  const incomingYear = req.body.academic_year || req.body.class_grade || req.body.year;
  if (incomingYear && db.isSchoolGrade(incomingYear)) {
    return res.status(400).json({
      error: 'Invalid academic year. School class grades (9th-12th) are not permitted. CampusRide is for Sri Sairam Engineering College (1st - 4th Year only).'
    });
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
    userData: {
      name,
      email: email.toLowerCase(),
      phone,
      password,
      role,
      department: req.body.department || 'CSE',
      year: db.parseAcademicYear(incomingYear) || 1
    }
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
    const studentYear = u.year || 1;
    db.insertStudent({
      user_id: userId,
      student_id: `SEC-${Date.now().toString().slice(-4)}`,
      rfid_tag: `RFID_SEC_${Date.now().toString().slice(-4)}`,
      department: u.department || 'CSE',
      year: studentYear,
      class_grade: db.formatAcademicYear(studentYear),
      route_id: "route_1",
      bus_id: "bus_1",
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

// User Login (Bcrypt verified + JWT issued + Status Check + Last Login Audit)
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.findUserByEmail(email);
  if (!user || !db.verifyPassword(user, password)) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  // Account Status Check (Module 1)
  if (user.status === 'inactive') {
    return res.status(403).json({ error: 'Your account has been deactivated by administrator. Please contact transport admin.' });
  }

  // Audit: Record Last Login Timestamp
  user.last_login_at = new Date().toISOString();
  db.save();

  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    status: user.status || 'active',
    must_change_password: !!user.must_change_password
  };

  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN });

  res.json({
    message: 'Login successful',
    token,
    user: payload,
    must_change_password: !!user.must_change_password
  });
});

// User Self Password Change (Module 1: Force password change on first login or user update)
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  const user = db.findUserById(req.user.id);
  if (!user || !db.verifyPassword(user, current_password)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  user.password_hash = db.hashPassword(new_password);
  user.must_change_password = false;
  db.save();

  res.json({ success: true, message: 'Password updated successfully. You can now use your new password.' });
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
      user_id: link.student_id,
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

// ----------------------------------------------------
// EXCEL BULK ATTENDANCE MANAGEMENT SYSTEM ENDPOINTS
// ----------------------------------------------------

// 1. Download Excel Template
app.get('/api/admin/bulk-attendance/template', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const students = db.getStudents().map(s => {
      const u = db.findUserById(s.user_id);
      return {
        student_id: s.student_id || 'ST001',
        student_name: u ? u.name : 'Student Name',
        department: s.department || 'CSE',
        year: s.year || 1
      };
    });

    const buffer = await excelService.generateTemplate(students);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="CampusRide_Bulk_Attendance_Template.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Failed to generate attendance template:', err);
    res.status(500).json({ error: `Template generation failed: ${err.message}` });
  }
});

// 2. Upload and Preview Excel Attendance File
app.post('/api/admin/bulk-attendance/preview', authenticateToken, requireRole('admin'), (req, res) => {
  excelUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds limit: Maximum allowed size is 5MB' });
      }
      return res.status(400).json({ error: uploadErr.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file provided. Please select or drag a .xlsx or .xls file.' });
    }

    const attendanceDate = req.body.attendance_date || new Date().toISOString().split('T')[0];
    const session = req.body.session || 'Morning';

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
      return res.status(400).json({ error: 'Invalid attendance date format. Expected YYYY-MM-DD.' });
    }

    // Validate session
    const allowedSessions = ['Morning', 'Afternoon', 'Full Day'];
    if (!allowedSessions.includes(session)) {
      return res.status(400).json({ error: `Invalid session. Allowed sessions: [${allowedSessions.join(', ')}]` });
    }

    try {
      const validationResult = await excelService.parseAndValidateExcel(req.file.buffer, {
        attendanceDate,
        session,
        db
      });

      res.json({
        success: true,
        filename: req.file.originalname,
        file_size: req.file.size,
        attendance_date: attendanceDate,
        session: session,
        summary: validationResult.summary,
        rows: validationResult.rows
      });
    } catch (err) {
      console.error('Excel validation failed:', err);
      res.status(400).json({ error: err.message || 'Validation error while parsing Excel file' });
    }
  });
});

// 3. Confirm and Mark Bulk Attendance
app.post('/api/admin/bulk-attendance/confirm', authenticateToken, requireRole('admin'), (req, res) => {
  const {
    attendance_date,
    session,
    filename,
    file_size,
    eligible_records,
    preview_summary,
    all_rows
  } = req.body;

  if (!attendance_date || !session) {
    return res.status(400).json({ error: 'Attendance date and session are required.' });
  }

  if (!eligible_records || !Array.isArray(eligible_records) || eligible_records.length === 0) {
    return res.status(400).json({ error: 'No eligible student records available to mark as Present.' });
  }

  const uploadId = `upl_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const adminName = req.user.name || 'Principal Mehra';

  try {
    // 1. Mark attendance for eligible students in database
    const markedRecords = db.markExcelBulkAttendance({
      upload_id: uploadId,
      date: attendance_date,
      session,
      records: eligible_records,
      admin_id: req.user.id,
      admin_name: adminName
    });

    // 2. Create and persist Upload History Record
    const uploadRecord = {
      id: uploadId,
      filename: filename || 'attendance_upload.xlsx',
      file_size: file_size || 0,
      admin_id: req.user.id,
      admin_name: adminName,
      upload_timestamp: new Date().toISOString(),
      attendance_date,
      session,
      total_records: preview_summary ? preview_summary.total : eligible_records.length,
      marked_present: markedRecords.length,
      failed_records: preview_summary ? (preview_summary.invalid + preview_summary.duplicates + preview_summary.alreadyPresent) : 0,
      status: 'COMPLETED',
      details: {
        preview_summary: preview_summary || null,
        all_rows: all_rows || eligible_records
      },
      rollback_info: null
    };

    db.saveAttendanceUpload(uploadRecord);

    // 3. Broadcast real-time WebSocket event
    broadcastSocketMessage({
      type: 'attendance_bulk_upload',
      uploadId,
      attendanceDate: attendance_date,
      session,
      markedCount: markedRecords.length,
      admin: adminName
    });

    res.json({
      message: `Successfully marked ${markedRecords.length} student(s) as PRESENT for ${attendance_date} (${session}).`,
      upload_id: uploadId,
      marked_present: markedRecords.length,
      upload: uploadRecord
    });
  } catch (err) {
    console.error('Confirm bulk attendance failed:', err);
    res.status(500).json({ error: `Failed to confirm and mark attendance: ${err.message}` });
  }
});

// 4. Attendance Upload History List
app.get('/api/admin/bulk-attendance/history', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const uploads = db.getAttendanceUploads();
    const auditLogs = db.getAttendanceAuditLog();
    res.json({ uploads, audit_logs: auditLogs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Attendance Upload Details
app.get('/api/admin/bulk-attendance/history/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const upload = db.getAttendanceUploadById(req.params.id);
  if (!upload) {
    return res.status(404).json({ error: `Upload with ID '${req.params.id}' not found.` });
  }
  res.json({ upload });
});

// 6. Undo / Rollback Attendance Upload
app.post('/api/admin/bulk-attendance/rollback', authenticateToken, requireRole('admin'), (req, res) => {
  const { upload_id } = req.body;
  if (!upload_id) {
    return res.status(400).json({ error: 'upload_id is required for rollback.' });
  }

  const adminName = req.user.name || 'Principal Mehra';
  const result = db.rollbackExcelUpload({
    upload_id,
    admin_id: req.user.id,
    admin_name: adminName
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  // Broadcast WebSocket notification for rollback
  broadcastSocketMessage({
    type: 'attendance_rollback',
    uploadId: upload_id,
    reversedCount: result.reversed_count,
    manualReviewCount: result.manual_review_count,
    admin: adminName
  });

  res.json({
    message: `Upload ${upload_id} reversed successfully. ${result.reversed_count} attendance records reversed.`,
    upload_id,
    reversed_count: result.reversed_count,
    manual_review_count: result.manual_review_count,
    upload: result.upload
  });
});

// 7. Download Filtered Attendance Report (Excel)
app.get('/api/admin/bulk-attendance/reports/attendance-excel', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { date, department, year, session } = req.query;
    let attendance = db.getAttendance();

    // Enrich attendance records
    let enriched = attendance.map(a => {
      const student = db.getStudents().find(s => s.user_id === a.student_id);
      const user = db.findUserById(a.student_id);
      return {
        ...a,
        student_code: (student && student.student_id) || a.student_code || a.student_id,
        student_name: (user && user.name) || a.student_name || 'Unknown',
        department: (student && student.department) || a.department || 'General',
        year: (student && student.year) || a.year || '-'
      };
    });

    // Apply filters
    if (date) enriched = enriched.filter(a => a.date === date);
    if (department && department !== 'all') enriched = enriched.filter(a => (a.department || '').toUpperCase() === department.toUpperCase());
    if (year && year !== 'all') enriched = enriched.filter(a => String(a.year) === String(year));
    if (session && session !== 'all') enriched = enriched.filter(a => (a.session || 'Full Day').toLowerCase() === session.toLowerCase());

    const buffer = await excelService.generateAttendanceReportExcel({
      attendanceRecords: enriched,
      filters: { date, department, year, session }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="CampusRide_Attendance_Report_${date || 'all'}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Failed to export attendance report:', err);
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

// 8. Download Specific Upload Report (Excel)
app.get('/api/admin/bulk-attendance/reports/upload/:id/excel', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const upload = db.getAttendanceUploadById(req.params.id);
    if (!upload) {
      return res.status(404).json({ error: 'Upload record not found' });
    }

    const buffer = await excelService.generateUploadReportExcel(upload);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Upload_Report_${upload.id}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

// 9. Download Upload History & Audit Report (Excel)
app.get('/api/admin/bulk-attendance/reports/history-excel', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const uploads = db.getAttendanceUploads();
    const auditLogs = db.getAttendanceAuditLog();

    const buffer = await excelService.generateUploadHistoryReportExcel(uploads, auditLogs);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="CampusRide_Upload_History_Audit.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

// ----------------------------------------------------
// ROUTE & STOP MANAGEMENT (MODULES 3, 4, 5)
// Sri Sairam Engineering College Bus Routes
// ----------------------------------------------------

// Public / Authenticated Route Directory for map display & student dashboards
app.get('/api/routes', (req, res) => {
  const routes = db.getRoutes().map(r => {
    const stops = db.getStops()
      .filter(s => s.route_id === r.id)
      .sort((a, b) => a.sequence_order - b.sequence_order);
    const bus = db.getBuses().find(b => b.route_id === r.id);
    const studentCount = db.getRouteStudentCount ? db.getRouteStudentCount(r.id) : 0;
    return {
      ...r,
      stops,
      bus_number: bus ? bus.bus_number : 'Unassigned',
      bus_id: bus ? bus.id : null,
      student_count: studentCount,
      verification_status: r.verification_status || 'DEMO – PENDING TRANSPORT OFFICE VERIFICATION'
    };
  });
  res.json({ routes, campus: config.CAMPUS });
});

app.get('/api/routes/:id', (req, res) => {
  const route = db.findRouteById ? db.findRouteById(req.params.id) : db.getRoutes().find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const stops = db.getStops()
    .filter(s => s.route_id === route.id)
    .sort((a, b) => a.sequence_order - b.sequence_order);
  const bus = db.getBuses().find(b => b.route_id === route.id);
  const studentCount = db.getRouteStudentCount ? db.getRouteStudentCount(route.id) : 0;

  res.json({
    route: {
      ...route,
      stops,
      bus: bus || null,
      student_count: studentCount
    }
  });
});

// Admin Route List with full relations
app.get('/api/admin/routes', authenticateToken, requireRole('admin'), (req, res) => {
  const enrichedRoutes = db.getRoutes().map(r => {
    const stops = db.getStops()
      .filter(s => s.route_id === r.id)
      .sort((a, b) => a.sequence_order - b.sequence_order);
    const bus = db.getBuses().find(b => b.route_id === r.id);
    const driver = bus ? db.findUserById(bus.driver_id) : null;
    const studentCount = db.getRouteStudentCount ? db.getRouteStudentCount(r.id) : 0;

    return {
      ...r,
      stops,
      stop_count: stops.length,
      bus_id: bus ? bus.id : null,
      bus_number: bus ? bus.bus_number : 'Unassigned',
      driver_name: driver ? driver.name : 'Unassigned',
      driver_phone: driver ? driver.phone : 'N/A',
      student_count: studentCount,
      verification_status: r.verification_status || 'DEMO – PENDING TRANSPORT OFFICE VERIFICATION'
    };
  });

  res.json({
    routes: enrichedRoutes,
    stops: db.getStops(),
    buses: db.getBuses(),
    campus: config.CAMPUS
  });
});

// Create new Route (Module 4)
app.post('/api/admin/routes', authenticateToken, requireRole('admin'), (req, res) => {
  const routeName = (req.body.name || req.body.route_name || '').trim();
  const routeNumber = (req.body.route_number || req.body.routeNumber || '').trim();
  const { start_location, destination, description, stops } = req.body;

  if (!routeName || !routeNumber) {
    return res.status(400).json({ error: 'Route Number and Route Name are required.' });
  }

  // Prevent duplicate route numbers
  const existing = db.getRoutes().find(r => (r.route_number || '').trim().toUpperCase() === routeNumber.toUpperCase());
  if (existing) {
    return res.status(400).json({ error: `Route number '${routeNumber}' is already assigned to ${existing.name}.` });
  }

  const routeId = `route_${Date.now()}`;
  const newRoute = {
    id: routeId,
    route_number: routeNumber,
    name: routeName,
    start_location: start_location || 'Pickup Point',
    destination: destination || 'Sri Sairam Engineering College',
    description: description || `Route ${routeNumber}: ${routeName}`,
    status: 'active',
    verification_status: 'DEMO – PENDING TRANSPORT OFFICE VERIFICATION',
    created_at: new Date().toISOString()
  };

  db.insertRoute(newRoute);

  // If initial stops provided
  if (Array.isArray(stops) && stops.length > 0) {
    stops.forEach((s, idx) => {
      const sLat = s.latitude !== undefined ? s.latitude : (s.coordinates ? s.coordinates[0] : (s.lat || 12.9601));
      const sLng = s.longitude !== undefined ? s.longitude : (s.coordinates ? s.coordinates[1] : (s.lng || 80.0574));
      db.insertStop({
        id: `stop_${Date.now()}_${idx}`,
        route_id: routeId,
        name: s.name || s.stop_name,
        latitude: parseFloat(sLat),
        longitude: parseFloat(sLng),
        sequence_order: idx + 1,
        pickup_time: s.pickup_time || '07:30 AM'
      });
    });
  }

  res.status(201).json({ message: 'Route registered successfully', route: newRoute });
});

// Backward-compatible alias for route creation
app.post('/api/admin/routes/create', authenticateToken, requireRole('admin'), (req, res) => {
  const name = req.body.name || req.body.route_name;
  const { description, route_number } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name is required' });

  const routeId = `route_${Date.now()}`;
  const newRoute = {
    id: routeId,
    route_number: route_number || `R-${Date.now().toString().slice(-2)}`,
    name,
    description: description || name,
    start_location: 'Boarding Locality',
    destination: 'Sri Sairam Engineering College',
    status: 'active',
    verification_status: 'DEMO – PENDING TRANSPORT OFFICE VERIFICATION',
    created_at: new Date().toISOString()
  };
  db.insertRoute(newRoute);
  res.json({ message: 'Route created successfully', routeId, route: newRoute });
});

// Update Route (Module 4)
app.put('/api/admin/routes/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const route = db.findRouteById(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const routeNumber = req.body.route_number || req.body.routeNumber;
  const name = req.body.name || req.body.route_name;
  const { start_location, destination, description, status, verification_status } = req.body;

  if (routeNumber && routeNumber !== route.route_number) {
    const dup = db.getRoutes().find(r => r.id !== req.params.id && (r.route_number || '').trim().toUpperCase() === routeNumber.trim().toUpperCase());
    if (dup) return res.status(400).json({ error: `Route number '${routeNumber}' is already assigned to ${dup.name}.` });
  }

  const updated = db.updateRoute(req.params.id, {
    ...(routeNumber ? { route_number: routeNumber.trim() } : {}),
    ...(name ? { name: name.trim() } : {}),
    ...(start_location ? { start_location: start_location.trim() } : {}),
    ...(destination ? { destination: destination.trim() } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(status ? { status } : {}),
    ...(verification_status ? { verification_status } : {})
  });

  res.json({ message: 'Route details updated successfully', route: updated });
});

// Delete or Deactivate Route (Module 4)
app.delete('/api/admin/routes/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const route = db.findRouteById(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const studentCount = db.getRouteStudentCount ? db.getRouteStudentCount(route.id) : 0;
  if (studentCount > 0 && req.query.force !== 'true') {
    return res.status(400).json({
      error: `Cannot delete route with ${studentCount} active students assigned. Please reassign students or pass force=true to unassign them.`
    });
  }

  db.deleteRoute(req.params.id);
  res.json({ message: `Route '${route.name}' removed successfully.` });
});

// Add Stop to Route (Module 4)
app.post('/api/admin/routes/:id/stops', authenticateToken, requireRole('admin'), (req, res) => {
  const route = db.findRouteById(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const stopName = (req.body.name || req.body.stop_name || '').trim();
  const lat = req.body.latitude !== undefined ? req.body.latitude : (req.body.coordinates ? req.body.coordinates[0] : req.body.lat);
  const lng = req.body.longitude !== undefined ? req.body.longitude : (req.body.coordinates ? req.body.coordinates[1] : req.body.lng);
  const { pickup_time, sequence_order, stop_sequence } = req.body;

  if (!stopName || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Stop name, latitude, and longitude are required.' });
  }

  const existingStops = db.getStops().filter(s => s.route_id === route.id);
  const nextSeq = sequence_order !== undefined ? parseInt(sequence_order, 10) : (stop_sequence !== undefined ? parseInt(stop_sequence, 10) : existingStops.length + 1);

  const newStop = {
    id: `stop_${Date.now()}`,
    route_id: route.id,
    name: stopName,
    stop_name: stopName,
    latitude: parseFloat(lat),
    longitude: parseFloat(lng),
    pickup_time: pickup_time || '07:30 AM',
    sequence_order: nextSeq
  };

  db.insertStop(newStop);
  res.status(201).json({ message: 'Boarding stop added successfully', stop: newStop });
});

// Update Stop (Module 4)
app.put('/api/admin/stops/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const stop = db.findStopById(req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });

  const { name, latitude, longitude, pickup_time, sequence_order } = req.body;
  const updated = db.updateStop(req.params.id, {
    ...(name ? { name: name.trim() } : {}),
    ...(latitude !== undefined ? { latitude: parseFloat(latitude) } : {}),
    ...(longitude !== undefined ? { longitude: parseFloat(longitude) } : {}),
    ...(pickup_time ? { pickup_time } : {}),
    ...(sequence_order !== undefined ? { sequence_order: parseInt(sequence_order, 10) } : {})
  });

  res.json({ message: 'Stop updated successfully', stop: updated });
});

// Delete Stop (Module 4)
app.delete('/api/admin/stops/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const stop = db.findStopById(req.params.id);
  if (!stop) return res.status(404).json({ error: 'Stop not found' });

  db.deleteStop(req.params.id);
  res.json({ message: 'Stop removed successfully.' });
});

// Backward-compatible bulk stop replace
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
      latitude: parseFloat(s.lat || s.latitude),
      longitude: parseFloat(s.lng || s.longitude),
      pickup_time: s.pickup_time || '07:30 AM',
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

// ----------------------------------------------------
// SECURE TEMPORARY PASSWORD GENERATOR (MODULE 1)
// Generates single-use temporary password; never stored in plaintext
// ----------------------------------------------------
function generateTemporaryPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$';
  let pass = 'SEC@';
  for (let i = 0; i < 6; i++) {
    pass += chars.charAt(crypto.randomInt(0, chars.length));
  }
  return pass;
}

// ----------------------------------------------------
// CENTRAL USER MANAGEMENT (MODULE 1 & 2)
// Super Admin / Admin, Student, Driver, Parent
// ----------------------------------------------------

// List all registered users with search, role, department, year, status filters
app.get('/api/admin/users', authenticateToken, requireRole('admin'), (req, res) => {
  const { search, role, department, year, status } = req.query;
  const enrichedUsers = db.getEnrichedUsers({ search, role, department, year, status });

  // Retain legacy structure if needed, plus complete modern users list
  const enrichedStudents = enrichedUsers.filter(u => u.role === 'student');

  res.json({
    users: enrichedUsers,
    total: enrichedUsers.length,
    students: enrichedStudents,
    legacy_users: enrichedUsers.filter(u => u.role !== 'admin')
  });
});

// Create Account (Module 1: Admin, Student, Driver, Parent)
app.post(['/api/admin/users', '/api/admin/users/create'], authenticateToken, requireRole('admin'), (req, res) => {
  const {
    name,
    email,
    phone,
    role,
    password,
    department,
    academic_year,
    year,
    class_grade,
    route_id,
    bus_id,
    boarding_stop_id,
    student_id,
    rfid_tag,
    license_number,
    linked_student_id
  } = req.body;

  const incomingYear = academic_year || year || class_grade;
  // Module 2: Strictly reject school-level class grades (9th-12th)
  if (role === 'student' && incomingYear && db.isSchoolGrade(incomingYear)) {
    return res.status(400).json({
      error: 'Invalid academic year. School class grades (9th-12th) are not permitted. CampusRide is for Sri Sairam Engineering College (1st - 4th Year only).'
    });
  }

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'Name, email, and user role are required.' });
  }

  const validRoles = ['admin', 'student', 'driver', 'parent'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  // Email format & uniqueness
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address format' });
  }

  const existing = db.findUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: `An account with email '${email}' already exists.` });
  }

  // Module 8: Bus Capacity validation if bus_id is specified
  if (role === 'student' && bus_id) {
    const bus = db.findBusById(bus_id);
    if (bus && bus.capacity) {
      const assignedCount = db.getBusStudentCount(bus_id);
      if (assignedCount >= bus.capacity) {
        return res.status(400).json({
          error: `Cannot assign student: Bus ${bus.bus_number} capacity exceeded. Maximum capacity is ${bus.capacity}, currently assigned: ${assignedCount}.`
        });
      }
    }
  }

  // Password handling: Secure Temporary Password generation
  let tempPassword = null;
  let rawPassword = password;
  let mustChangePassword = false;

  if (!rawPassword || rawPassword.trim() === '') {
    tempPassword = generateTemporaryPassword();
    rawPassword = tempPassword;
    mustChangePassword = true; // Required password change on first login
  }

  const userId = `usr_${role}_${Date.now().toString(36)}`;
  const passwordHash = db.hashPassword(rawPassword);

  const newUser = db.insertUser({
    id: userId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: (phone || '').trim(),
    role,
    password_hash: passwordHash,
    status: 'active',
    must_change_password: mustChangePassword,
    created_at: new Date().toISOString(),
    last_login_at: null
  });

  // Role-specific records
  let parsedYear = 1;
  const userEnriched = {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    role: newUser.role,
    phone: newUser.phone,
    status: newUser.status,
    created_at: newUser.created_at
  };

  if (role === 'student') {
    parsedYear = db.parseAcademicYear(incomingYear) || 1;
    const stdId = student_id || `SEC-${Date.now().toString().slice(-4)}`;
    db.insertStudent({
      user_id: userId,
      student_id: stdId,
      rfid_tag: rfid_tag || `RFID_SEC_${Date.now().toString().slice(-4)}`,
      department: department || 'CSE',
      year: parsedYear,
      class_grade: db.formatAcademicYear(parsedYear),
      route_id: route_id || null,
      bus_id: bus_id || null,
      boarding_stop_id: boarding_stop_id || null
    });
    userEnriched.academic_year = parsedYear;
    userEnriched.year = db.formatAcademicYear(parsedYear);
    userEnriched.department = department || 'CSE';
  } else if (role === 'driver') {
    const lic = license_number || req.body.licenseNumber || `TN-09-${Date.now().toString().slice(-6)}`;
    db.insertDriver({
      user_id: userId,
      license_number: lic,
      bus_id: bus_id || null
    });
    if (bus_id) {
      db.updateBus(bus_id, { driver_id: userId });
    }
    userEnriched.licenseNumber = lic;
  } else if (role === 'parent') {
    const lkId = linked_student_id || req.body.linkedStudentId || null;
    db.insertParent({ user_id: userId });
    if (lkId) {
      db.linkParentStudent(userId, lkId);
      userEnriched.linkedStudentId = lkId;
    }
  }

  // Audit log
  db.logAudit({
    event: 'USER_CREATED',
    admin_id: req.user.id,
    admin_name: req.user.name,
    details: { user_id: userId, name: newUser.name, email: newUser.email, role }
  });

  const responsePayload = {
    success: true,
    message: `Account for ${newUser.name} (${role}) created successfully.`,
    user: userEnriched
  };

  // Temporary password returned ONLY ONCE to authorized administrator
  if (tempPassword) {
    responsePayload.temp_password = tempPassword;
    responsePayload.tempPassword = tempPassword;
    responsePayload.notice = 'Temporary password generated securely. Share this once with the user. They must change it upon initial login.';
  }

  res.status(201).json(responsePayload);
});

// Edit User Profile (Module 1)
app.put('/api/admin/users/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const userId = req.params.id;
  const user = db.findUserById(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const {
    name,
    email,
    phone,
    department,
    academic_year,
    year,
    class_grade,
    route_id,
    bus_id,
    boarding_stop_id,
    student_id,
    rfid_tag,
    license_number,
    linked_student_id
  } = req.body;

  // Strict school-grade rejection
  const incomingYear = academic_year || year || class_grade;
  if (incomingYear && db.isSchoolGrade(incomingYear)) {
    return res.status(400).json({
      error: 'Invalid academic year. School class grades (9th-12th) are not permitted. CampusRide is for Sri Sairam Engineering College (1st - 4th Year only).'
    });
  }

  // Module 8: Bus Capacity validation if bus is changed
  if (user.role === 'student' && bus_id) {
    const studentRecord = db.getStudents().find(s => s.user_id === userId);
    if (!studentRecord || studentRecord.bus_id !== bus_id) {
      const bus = db.findBusById(bus_id);
      if (bus && bus.capacity) {
        const assignedCount = db.getBusStudentCount(bus_id);
        if (assignedCount >= bus.capacity) {
          return res.status(400).json({
            error: `Cannot assign student: Bus ${bus.bus_number} capacity exceeded. Maximum capacity is ${bus.capacity}, currently assigned: ${assignedCount}.`
          });
        }
      }
    }
  }

  // Update user
  db.updateUser(userId, {
    ...(name ? { name: name.trim() } : {}),
    ...(email ? { email: email.trim().toLowerCase() } : {}),
    ...(phone ? { phone: phone.trim() } : {}),
    ...(department ? { department } : {}),
    ...(incomingYear ? { year: db.parseAcademicYear(incomingYear), class_grade: db.formatAcademicYear(db.parseAcademicYear(incomingYear)) } : {}),
    ...(route_id ? { route_id } : {}),
    ...(bus_id ? { bus_id } : {}),
    ...(boarding_stop_id ? { boarding_stop_id } : {}),
    ...(student_id ? { student_id } : {}),
    ...(rfid_tag ? { rfid_tag } : {}),
    ...(license_number ? { license_number } : {}),
    ...(linked_student_id ? { linked_student_id } : {})
  });

  db.logAudit({
    event: 'USER_UPDATED',
    admin_id: req.user.id,
    admin_name: req.user.name,
    details: { user_id: userId, changes: req.body }
  });

  res.json({ message: 'User profile updated successfully.' });
});

// Backward-compatible alias for update
app.post('/api/admin/users/update', authenticateToken, requireRole('admin'), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  req.params.id = user_id;
  // Delegate to PUT handler logic
  const user = db.findUserById(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { name, email, phone, class_grade, academic_year, route_id, bus_id, boarding_stop_id, rfid_tag } = req.body;
  const incomingYear = academic_year || class_grade;
  if (incomingYear && db.isSchoolGrade(incomingYear)) {
    return res.status(400).json({ error: 'School classes (9th-12th) are not permitted.' });
  }

  db.updateUser(user_id, {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(incomingYear ? { year: db.parseAcademicYear(incomingYear), class_grade: db.formatAcademicYear(db.parseAcademicYear(incomingYear)) } : {}),
    ...(route_id ? { route_id } : {}),
    ...(bus_id ? { bus_id } : {}),
    ...(boarding_stop_id ? { boarding_stop_id } : {}),
    ...(rfid_tag ? { rfid_tag } : {})
  });

  res.json({ message: 'User profile updated successfully' });
});

// Activate or Deactivate Account (Module 1)
app.patch('/api/admin/users/:id/status', authenticateToken, requireRole('admin'), (req, res) => {
  const { status } = req.body;
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'active' or 'inactive'." });
  }

  if (req.params.id === req.user.id && status === 'inactive') {
    return res.status(400).json({ error: 'Safety precaution: You cannot deactivate your own administrative account.' });
  }

  const updated = db.setUserStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'User not found' });

  db.logAudit({
    event: 'USER_STATUS_CHANGED',
    admin_id: req.user.id,
    admin_name: req.user.name,
    details: { user_id: req.params.id, status }
  });

  res.json({ message: `Account has been set to ${status}.`, user: updated });
});

// Backward-compatible POST alias for status
app.post('/api/admin/users/status', authenticateToken, requireRole('admin'), (req, res) => {
  const { user_id, status } = req.body;
  if (!user_id || !status) return res.status(400).json({ error: 'user_id and status are required' });
  if (user_id === req.user.id && status === 'inactive') {
    return res.status(400).json({ error: 'Cannot deactivate your own account.' });
  }
  const updated = db.setUserStatus(user_id, status);
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ message: `Account status updated to ${status}.` });
});

// Reset Password: Generates new secure temporary password shown ONCE to admin (Module 1)
app.post('/api/admin/users/:id/reset-password', authenticateToken, requireRole('admin'), (req, res) => {
  const user = db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const tempPassword = generateTemporaryPassword();
  db.resetUserPassword(req.params.id, tempPassword);

  db.logAudit({
    event: 'PASSWORD_RESET_BY_ADMIN',
    admin_id: req.user.id,
    admin_name: req.user.name,
    details: { user_id: req.params.id, email: user.email }
  });

  res.json({
    success: true,
    message: `Password reset successfully for ${user.name}.`,
    temp_password: tempPassword,
    tempPassword: tempPassword,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: true,
      must_change_password: true
    },
    notice: 'Show this temporary password only once to the user. They will be forced to change it upon next login.'
  });
});

// Delete User safely (Module 1)
app.delete('/api/admin/users/:id', authenticateToken, requireRole('admin'), (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Safety precaution: You cannot delete your own administrative account.' });
  }

  const user = db.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.deleteUser(req.params.id);

  db.logAudit({
    event: 'USER_DELETED',
    admin_id: req.user.id,
    admin_name: req.user.name,
    details: { user_id: req.params.id, name: user.name, role: user.role }
  });

  res.json({ message: `User account for ${user.name} removed successfully.` });
});

// Backward-compatible POST alias for delete
app.post('/api/admin/users/delete', authenticateToken, requireRole('admin'), (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (user_id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });

  const user = db.findUserById(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.deleteUser(user_id);
  res.json({ message: 'User deleted successfully' });
});

// Export Users to Excel (Module 1)
app.get('/api/admin/users/export-excel', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { search, role, department, year, status } = req.query;
    const users = db.getEnrichedUsers({ search, role, department, year, status });

    const buffer = await excelService.generateUserExportExcel(users);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Sri_Sairam_CampusRide_Users.xlsx"');
    res.setHeader('Content-Length', buffer.length);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Failed to export user directory:', err);
    res.status(500).json({ error: `User export failed: ${err.message}` });
  }
});

// ----------------------------------------------------
// BUS AND STUDENT ASSIGNMENT MANAGEMENT (MODULE 8)
// ----------------------------------------------------

// Assignment overview
app.get('/api/admin/assignments', authenticateToken, requireRole('admin'), (req, res) => {
  const buses = db.getBuses().map(b => {
    const assignedStudents = db.getBusStudentCount(b.id);
    const capacity = b.capacity || 50;
    const route = db.getRoutes().find(r => r.id === b.route_id);
    const driver = db.findUserById(b.driver_id);
    return {
      ...b,
      capacity,
      assigned_students: assignedStudents,
      available_seats: Math.max(0, capacity - assignedStudents),
      percent_full: Math.round((assignedStudents / capacity) * 100),
      is_full: assignedStudents >= capacity,
      route_name: route ? route.name : 'Unassigned',
      route_number: route ? route.route_number : 'N/A',
      driver_name: driver ? driver.name : 'Unassigned Driver'
    };
  });

  const routes = db.getRoutes().map(r => {
    const studentCount = db.getRouteStudentCount(r.id);
    const bus = db.getBuses().find(b => b.route_id === r.id);
    return {
      ...r,
      student_count: studentCount,
      bus_number: bus ? bus.bus_number : 'Unassigned'
    };
  });

  const allStudents = db.getStudents();
  const unassignedStudents = allStudents.filter(s => !s.route_id || !s.bus_id).length;

  res.json({ buses, routes, total_students: allStudents.length, unassigned_students: unassignedStudents });
});

// Assign Bus to Route
app.post('/api/admin/assignments/bus-route', authenticateToken, requireRole('admin'), (req, res) => {
  const bus_id = req.body.bus_id || req.body.busId;
  const route_id = req.body.route_id || req.body.routeId;
  if (!bus_id || !route_id) {
    return res.status(400).json({ error: 'bus_id and route_id are required' });
  }

  const bus = db.findBusById(bus_id);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const route = db.findRouteById(route_id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  db.updateBus(bus_id, { route_id });
  res.json({ message: `Bus ${bus.bus_number} assigned to Route ${route.route_number} (${route.name}).` });
});

// Assign Driver to Bus
app.post('/api/admin/assignments/bus-driver', authenticateToken, requireRole('admin'), (req, res) => {
  const bus_id = req.body.bus_id || req.body.busId;
  const driver_id = req.body.driver_id || req.body.driverId;
  if (!bus_id || !driver_id) {
    return res.status(400).json({ error: 'bus_id and driver_id are required' });
  }

  const bus = db.findBusById(bus_id);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const driver = db.findUserById(driver_id);
  if (!driver || driver.role !== 'driver') {
    return res.status(400).json({ error: 'Invalid driver account.' });
  }

  db.updateBus(bus_id, { driver_id });
  res.json({ message: `Driver ${driver.name} assigned to Bus ${bus.bus_number}.` });
});

// Assign Student to Route and Bus (WITH STRICT BUS CAPACITY ENFORCEMENT)
app.post('/api/admin/assignments/student', authenticateToken, requireRole('admin'), (req, res) => {
  const user_id = req.body.user_id || req.body.userId;
  const route_id = req.body.route_id || req.body.routeId;
  const bus_id = req.body.bus_id || req.body.busId;
  const boarding_stop_id = req.body.boarding_stop_id || req.body.boardingStopId;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' });
  }

  const studentUser = db.findUserById(user_id);
  if (!studentUser || studentUser.role !== 'student') {
    return res.status(400).json({ error: 'Valid student user_id is required' });
  }

  const studentRecord = db.getStudents().find(s => s.user_id === user_id);

  // CRITICAL MODULE 8: Bus Capacity Validation
  if (bus_id) {
    const bus = db.findBusById(bus_id);
    if (!bus) return res.status(404).json({ error: 'Selected bus does not exist' });

    const isAlreadyOnThisBus = studentRecord && studentRecord.bus_id === bus_id;
    if (!isAlreadyOnThisBus) {
      const currentCount = db.getBusStudentCount(bus_id);
      const capacity = bus.capacity !== undefined ? bus.capacity : 50;
      if (currentCount >= capacity) {
        return res.status(400).json({
          error: `Bus Capacity Exceeded! Bus ${bus.bus_number} is full (${currentCount}/${capacity} seats occupied). Please select another bus.`
        });
      }
    }
  }

  const updatedStudent = db.assignStudent(user_id, {
    ...(route_id ? { route_id } : {}),
    ...(bus_id ? { bus_id } : {}),
    ...(boarding_stop_id ? { boarding_stop_id } : {})
  });

  db.logAudit({
    event: 'STUDENT_ASSIGNMENT_CHANGED',
    admin_id: req.user.id,
    admin_name: req.user.name,
    details: { user_id, route_id, bus_id, boarding_stop_id }
  });

  res.json({
    message: `Student ${studentUser.name} assigned successfully.`,
    student: updatedStudent
  });
});

// View all students assigned to a specific bus
app.get('/api/admin/buses/:id/students', authenticateToken, requireRole('admin'), (req, res) => {
  const bus = db.findBusById(req.params.id);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const students = db.getStudents()
    .filter(s => s.bus_id === bus.id)
    .map(s => {
      const u = db.findUserById(s.user_id);
      const r = db.findRouteById(s.route_id);
      const st = db.findStopById(s.boarding_stop_id);
      return {
        user_id: s.user_id,
        student_id: s.student_id,
        name: u ? u.name : 'Unknown',
        email: u ? u.email : '',
        department: s.department,
        year: s.year,
        year_display: db.formatAcademicYear(s.year),
        route_name: r ? r.name : 'Unassigned',
        stop_name: st ? st.name : 'Unassigned'
      };
    });

  res.json({
    bus,
    assigned_count: students.length,
    capacity: bus.capacity || 50,
    available_seats: Math.max(0, (bus.capacity || 50) - students.length),
    students
  });
});

// View all students assigned to a specific route
app.get('/api/admin/routes/:id/students', authenticateToken, requireRole('admin'), (req, res) => {
  const route = db.findRouteById(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  const students = db.getStudents()
    .filter(s => s.route_id === route.id)
    .map(s => {
      const u = db.findUserById(s.user_id);
      const b = db.findBusById(s.bus_id);
      const st = db.findStopById(s.boarding_stop_id);
      return {
        user_id: s.user_id,
        student_id: s.student_id,
        name: u ? u.name : 'Unknown',
        department: s.department,
        year: s.year,
        year_display: db.formatAcademicYear(s.year),
        bus_number: b ? b.bus_number : 'Unassigned',
        stop_name: st ? st.name : 'Unassigned'
      };
    });

  res.json({
    route,
    student_count: students.length,
    students
  });
});

// Update Bus configuration (capacity, driver, route, status) (Module 8)
app.put('/api/admin/buses/:id', authenticateToken, requireRole('admin'), (req, res) => {
  const bus = db.findBusById(req.params.id);
  if (!bus) return res.status(404).json({ error: 'Bus not found' });

  const { capacity, route_id, driver_id, status, bus_number } = req.body;
  const updated = db.updateBus(req.params.id, {
    ...(capacity !== undefined ? { capacity: parseInt(capacity, 10) } : {}),
    ...(route_id ? { route_id } : {}),
    ...(driver_id ? { driver_id } : {}),
    ...(status ? { status } : {}),
    ...(bus_number ? { bus_number: bus_number.trim() } : {})
  });

  res.json({ message: 'Bus updated successfully', bus: updated });
});

// ----------------------------------------------------
// DASHBOARD STATISTICS & INSTITUTIONAL REPORTS (MODULE 9)
// ----------------------------------------------------

// High-level analytics endpoint computed directly from real database records
app.get('/api/admin/stats', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const stats = db.getAdminStats();
    res.json({
      ...stats,
      byAcademicYear: stats.studentsByYear || stats.byAcademicYear,
      byDepartment: stats.studentsByDepartment || stats.studentsByDept
    });
  } catch (err) {
    console.error('Failed to compute admin stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Comprehensive institutional reports endpoint
app.get('/api/admin/reports', authenticateToken, requireRole('admin'), (req, res) => {
  const payments = db.getPayments();
  const attendance = db.getAttendance();
  const todayStr = new Date().toISOString().split('T')[0];

  const collected = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
  const outstanding = payments.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0);

  const todayAtt = attendance.filter(a => a.date === todayStr);
  const present = todayAtt.filter(a => a.status === 1).length;
  const totalEnrolled = db.getStudents().length;
  const absent = Math.max(0, totalEnrolled - present);

  const stats = db.getAdminStats();

  res.json({
    collected,
    outstanding,
    present,
    absent,
    attendance_rate: totalEnrolled > 0 ? Math.round((present / totalEnrolled) * 100) : 0,
    totalBuses: stats.totalBuses,
    totalRoutes: stats.totalRoutes,
    activeRoutes: stats.activeRoutes,
    totalStudents: stats.totalStudents,
    totalDrivers: stats.totalDrivers,
    totalParents: stats.totalParents,
    studentsByYear: stats.studentsByYear,
    studentsByDept: stats.studentsByDept,
    routeCapacityStats: stats.routeCapacityStats
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
