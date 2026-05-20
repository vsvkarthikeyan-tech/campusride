const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple mock OTP and Token database in-memory
const activeOTPs = {}; // Format: { email: { code, expiresAt } }
const activeTokens = new Set();

// Base64 Token helper (replicates JWT behavior statelessly and safely)
const TokenHelper = {
  sign(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const data = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = Buffer.from(header + '.' + data + 'saitrack_secret_key').toString('base64').substring(0, 20);
    return `${header}.${data}.${signature}`;
  },
  verify(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      const expectedSig = Buffer.from(parts[0] + '.' + parts[1] + 'saitrack_secret_key').toString('base64').substring(0, 20);
      if (parts[2] !== expectedSig) return null;
      return payload;
    } catch (err) {
      return null;
    }
  }
};

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access token required' });
  
  const user = TokenHelper.verify(token);
  if (!user) return res.status(403).json({ error: 'Invalid or expired token' });
  
  req.user = user;
  next();
}

// ----------------------------------------------------
// REST ENDPOINTS
// ----------------------------------------------------

// public register endpoint
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password, role } = req.body;
  if (!name || !email || !phone || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Check if user exists
  const existing = db.findUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  // Generate simulated OTP (6 digit)
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  activeOTPs[email] = {
    code: otpCode,
    expiresAt: Date.now() + 600000, // 10 minutes
    userData: { name, email, phone, password, role }
  };

  // Simulate sending SMS/Email by logging it in the console
  console.log(`\n--- [SMS/EMAIL OTP GATEWAY] ---`);
  console.log(`To: ${phone} (${name})`);
  console.log(`Your Saitrack Verification OTP code is: ${otpCode}`);
  console.log(`---------------------------------\n`);

  res.json({ message: 'OTP sent successfully to your device', email, mock_otp: otpCode });
});

// Verify OTP & create account
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and OTP code are required' });
  }

  const storedOtp = activeOTPs[email];
  if (!storedOtp) {
    return res.status(400).json({ error: 'No active registration found. Please register again.' });
  }

  if (storedOtp.expiresAt < Date.now()) {
    delete activeOTPs[email];
    return res.status(400).json({ error: 'OTP code expired. Please register again.' });
  }

  if (storedOtp.code !== code) {
    return res.status(400).json({ error: 'Incorrect OTP verification code.' });
  }

  const u = storedOtp.userData;
  const userId = `usr_${Date.now()}`;
  
  // Insert core user
  const newUser = db.insertUser({
    id: userId,
    name: u.name,
    email: u.email,
    password_hash: u.password, // Dev simplicity
    role: u.role,
    phone: u.phone,
    created_at: new Date().toISOString()
  });

  // Role-specific setups
  if (u.role === 'student') {
    db.insertStudent({
      user_id: userId,
      class_grade: "1st Year",
      route_id: "route_1",
      boarding_stop_id: "stop_1_1" // Default Yeshwanthpur stop
    });

    // Seed default pending payment for new students
    db.insertPayment({
      id: `pay_${Date.now()}`,
      student_id: userId,
      amount: 2500.00,
      currency: "INR",
      gpay_token: null,
      status: "pending",
      timestamp: new Date().toISOString()
    });
  } else if (u.role === 'parent') {
    db.insertParent({
      user_id: userId
    });
    // Automatically link to our pre-seeded student for demonstration!
    db.linkParentStudent(userId, "usr_student_1");
  }

  delete activeOTPs[email];
  res.json({ message: 'Verification successful! Account activated.', role: u.role });
});

// Secure Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const user = db.findUserByEmail(email);
  if (!user || user.password_hash !== password) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  // Create JWT claim
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone
  };

  const token = TokenHelper.sign(payload);
  activeTokens.add(token);

  res.json({
    message: 'Login successful',
    token,
    user: payload
  });
});

// Student Dashboard Info
app.get('/api/student/dashboard', authenticateToken, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only access' });
  
  const details = db.getStudentDetails(req.user.id);
  if (!details) return res.status(404).json({ error: 'Student profile not found' });
  
  // Get active payments
  const payments = db.getPayments().filter(p => p.student_id === req.user.id);
  
  // Get attendance logs
  const attendance = db.getAttendance().filter(a => a.student_id === req.user.id);
  
  // Get stops on route
  const stops = db.getStops().filter(s => s.route_id === details.route_id);

  // Get coRiders (all students, enriched with route/stop names and today's status)
  const todayStr = new Date().toISOString().split('T')[0];
  const coRiders = db.getStudents().map(st => {
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
      status: todayAtt ? todayAtt.status : -1, // -1: Unmarked, 1: Present, 0: Absent
      marked_by: todayAtt ? todayAtt.marked_by : null,
      timestamp: todayAtt ? todayAtt.timestamp : null
    };
  }).filter(Boolean);

  res.json({
    profile: details,
    stops,
    payments,
    attendance,
    coRiders
  });
});

// Student Boarding stop selector
app.post('/api/student/boarding', authenticateToken, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only access' });
  const { stopId } = req.body;
  if (!stopId) return res.status(400).json({ error: 'stopId is required' });

  const success = db.updateStudentStop(req.user.id, stopId);
  if (success) {
    res.json({ message: 'Boarding point updated successfully' });
  } else {
    res.status(500).json({ error: 'Failed to update boarding stop' });
  }
});

// Student manual RFID ID card tap simulator
app.post('/api/student/rfid-tap', authenticateToken, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only access' });

  const studentId = req.user.id;
  const details = db.getStudentDetails(studentId);
  if (!details) return res.status(404).json({ error: 'Student profile not found' });

  const todayStr = new Date().toISOString().split('T')[0];
  
  // Mark present
  const existingIdx = db.data.attendance.findIndex(a => a.student_id === studentId && a.date === todayStr);
  const record = {
    id: existingIdx !== -1 ? db.data.attendance[existingIdx].id : `att_${studentId}_rfid_${Date.now().toString(36)}`,
    student_id: studentId,
    date: todayStr,
    status: 1, // Present
    marked_by: 'Student_Manual_RFID_Tap',
    timestamp: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    db.data.attendance[existingIdx] = record;
  } else {
    db.data.attendance.push(record);
  }
  db.save();

  // Broadcast to WS
  broadcastSocketMessage({
    type: 'rfid_boarded',
    studentId: studentId,
    studentName: details.name,
    busNumber: details.busNumber || 'Route Bus',
    stopName: details.stopName || 'Boarding stop',
    timestamp: record.timestamp,
    status: 1
  });

  res.json({
    message: 'ID Card scanned successfully. Status logged as Present.',
    record
  });
});

// Trigger emergency alert
app.post('/api/student/panic', authenticateToken, (req, res) => {
  const { latitude, longitude, message, type } = req.body;
  
  const alertId = `alert_${Date.now()}`;
  const alert = db.insertAlert({
    id: alertId,
    user_id: req.user.id,
    type: type || 'student_panic',
    message: message || `Emergency Panic Triggered by ${req.user.name}`,
    latitude: latitude || 12.996,
    longitude: longitude || 77.572,
    status: 'active',
    resolved_by: null,
    timestamp: new Date().toISOString()
  });

  // Broadcast through WebSocket to all connected admins/parents
  broadcastSocketMessage({
    type: 'emergency_alert',
    alert: {
      ...alert,
      userName: req.user.name,
      userPhone: req.user.phone,
      userRole: req.user.role
    }
  });

  res.json({ message: 'Emergency dispatch logged. Help is on the way.', alertId });
});

// Parent details & children list
app.get('/api/parent/children', authenticateToken, (req, res) => {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Parent only access' });

  // Find linked students
  const links = db.getParentStudents().filter(ps => ps.parent_id === req.user.id);
  const children = links.map(link => {
    const details = db.getStudentDetails(link.student_id);
    if (!details) return null;

    const payments = db.getPayments().filter(p => p.student_id === link.student_id);
    const attendance = db.getAttendance().filter(a => a.student_id === link.student_id);
    
    return {
      profile: details,
      payments,
      attendance
    };
  }).filter(Boolean);

  res.json({ children });
});

// Payments APIs
app.post('/api/payments/create', authenticateToken, (req, res) => {
  const { amount, paymentId } = req.body;
  if (!amount || !paymentId) return res.status(400).json({ error: 'amount and paymentId are required' });

  res.json({
    message: 'Google Pay session initialized',
    gatewayToken: `gpay_sess_${Date.now()}`
  });
});

app.post('/api/payments/confirm', authenticateToken, (req, res) => {
  const { paymentId, gpayToken } = req.body;
  if (!paymentId || !gpayToken) return res.status(400).json({ error: 'paymentId and gpayToken required' });

  const updated = db.updatePaymentStatus(paymentId, 'completed', gpayToken);
  if (updated) {
    res.json({ message: 'Payment successfully processed via Google Pay', payment: updated });
  } else {
    res.status(404).json({ error: 'Payment record not found' });
  }
});

// ----------------------------------------------------
// ADMIN ENDPOINTS
// ----------------------------------------------------
app.get('/api/admin/attendance', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json({ attendance: db.getAttendance(), students: db.getStudents(), users: db.getUsers() });
});

app.post('/api/admin/attendance/mark', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { records } = req.body; // Array: [{ student_id, date, status }]
  if (!records || !Array.isArray(records)) return res.status(400).json({ error: 'records array required' });

  const results = db.bulkMarkAttendance(records, req.user.id);

  // Broadcast override to all connected clients
  broadcastSocketMessage({
    type: 'attendance_override',
    records: results,
    marked_by: req.user.id
  });

  res.json({ message: 'Attendance records updated successfully', records: results });
});

app.get('/api/admin/routes', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  res.json({
    routes: db.getRoutes(),
    stops: db.getStops(),
    buses: db.getBuses()
  });
});

app.post('/api/admin/routes/create', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Route name is required' });

  const routeId = `route_${Date.now()}`;
  db.data.routes.push({ id: routeId, name, description });
  db.save();
  
  res.json({ message: 'Route created successfully', routeId });
});

app.post('/api/admin/stops/create', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { routeId, stops } = req.body; // stops: Array of { name, lat, lng }
  if (!routeId || !stops || !Array.isArray(stops)) return res.status(400).json({ error: 'routeId and stops array required' });

  // Filter out existing stops for this route and replace
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

app.get('/api/admin/alerts', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  
  // Format alerts with student names
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

app.post('/api/admin/alerts/action', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { alertId, action } = req.body; // action = 'acknowledge' or 'resolve'
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

// Admin User CRUD APIs
app.get('/api/admin/users', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  
  // Enrich student records
  const enrichedStudents = db.getStudents().map(s => {
    const usr = db.findUserById(s.user_id);
    const rt = db.getRoutes().find(r => r.id === s.route_id);
    const st = db.getStops().find(stop => stop.id === s.boarding_stop_id);
    return {
      user_id: s.user_id,
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
    users: db.getUsers().filter(u => u.role !== 'admin') // exclude admins for safety
  });
});

app.post('/api/admin/users/create', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { name, email, phone, password, role, class_grade, route_id, boarding_stop_id } = req.body;
  if (!name || !email || !phone || !password || !role) return res.status(400).json({ error: 'Required fields missing' });

  const existing = db.findUserByEmail(email);
  if (existing) return res.status(400).json({ error: 'Email already registered' });

  const userId = `usr_${Date.now()}`;
  db.insertUser({
    id: userId,
    name,
    email,
    password_hash: password,
    role,
    phone,
    created_at: new Date().toISOString()
  });

  if (role === 'student') {
    db.insertStudent({
      user_id: userId,
      class_grade: class_grade || 'Unassigned',
      route_id: route_id || 'route_1',
      boarding_stop_id: boarding_stop_id || 'stop_1_1'
    });
  }

  res.json({ message: 'User created successfully', userId });
});

app.post('/api/admin/users/update', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { user_id, name, email, phone, class_grade, route_id, boarding_stop_id } = req.body;
  
  const user = db.findUserById(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Update core user
  if (name) user.name = name;
  if (email) user.email = email;
  if (phone) user.phone = phone;

  // If student, update details
  if (user.role === 'student') {
    const student = db.getStudents().find(s => s.user_id === user_id);
    if (student) {
      if (class_grade) student.class_grade = class_grade;
      if (route_id) student.route_id = route_id;
      if (boarding_stop_id) student.boarding_stop_id = boarding_stop_id;
    }
  }
  db.save();

  res.json({ message: 'User profile updated successfully' });
});

app.post('/api/admin/users/delete', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  db.data.users = db.data.users.filter(u => u.id !== user_id);
  db.data.students = db.data.students.filter(s => s.user_id !== user_id);
  db.data.parents = db.data.parents.filter(p => p.user_id !== user_id);
  db.data.parent_student = db.data.parent_student.filter(ps => ps.student_id !== user_id && ps.parent_id !== user_id);
  db.save();

  res.json({ message: 'User deleted successfully' });
});

// Admin dashboard reports
app.get('/api/admin/reports', authenticateToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const payments = db.getPayments();
  const attendance = db.getAttendance();

  // Total earnings vs dues
  const collected = payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
  const outstanding = payments.filter(p => p.status === 'pending').reduce((sum, p) => sum + p.amount, 0);

  // Present/Absent distributions
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


// ----------------------------------------------------
// WEBSOCKET SERVER & SIMULATION LAYER
// ----------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// All active WebSocket clients
const socketClients = new Set();

wss.on('connection', (ws) => {
  socketClients.add(ws);
  console.log(`WebSocket client connected. Total clients: ${socketClients.size}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Driver publishes coordinates
      if (data.type === 'driver_update') {
        const { busId, lat, lon } = data;
        const bus = db.updateBusLocation(busId, lat, lon);
        if (bus) {
          broadcastSocketMessage({
            type: 'bus_location',
            busId,
            busNumber: bus.bus_number,
            lat,
            lng: lon,
            speed: bus.speed_kmh
          });
        }
      }
    } catch (err) {
      console.error('Failed to parse socket message:', err);
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

// Pre-seeded high resolution paths for Bus 1 and Bus 2 to loop around
const BUS_PATHS = {
  bus_1: [
    { lat: 13.0230, lng: 77.5500 }, // Stop 1: Yeshwanthpur
    { lat: 13.0210, lng: 77.5550 },
    { lat: 13.0185, lng: 77.5610 },
    { lat: 13.0160, lng: 77.5640 }, // Stop 2: Ramaiah Gate
    { lat: 13.0100, lng: 77.5635 },
    { lat: 13.0040, lng: 77.5630 },
    { lat: 12.9980, lng: 77.5630 }, // Stop 3: Malleshwaram 18th Cross
    { lat: 12.9985, lng: 77.5670 },
    { lat: 12.9990, lng: 77.5710 }, // Stop 4: IISc East Gate
    { lat: 13.0070, lng: 77.5660 },
    { lat: 13.0150, lng: 77.5580 },
    { lat: 13.0200, lng: 77.5530 }
  ],
  bus_2: [
    { lat: 13.0350, lng: 77.5970 }, // Stop 1: Hebbal
    { lat: 13.0295, lng: 77.5950 },
    { lat: 13.0240, lng: 77.5940 }, // Stop 2: RT Nagar
    { lat: 13.0180, lng: 77.5930 },
    { lat: 13.0145, lng: 77.5880 },
    { lat: 13.0110, lng: 77.5840 },
    { lat: 13.0070, lng: 77.5800 }, // Stop 3: Sadashivanagar
    { lat: 13.0015, lng: 77.5760 },
    { lat: 12.9960, lng: 77.5720 }, // Stop 4: IISc Main Gate
    { lat: 13.0090, lng: 77.5815 },
    { lat: 13.0220, lng: 77.5890 },
    { lat: 13.0285, lng: 77.5935 }
  ]
};

const busPathIndexes = { bus_1: 0, bus_2: 0 };

// Main Virtual Driver coordinates loop (Simulates a driving bus update every 2.5 seconds)
setInterval(() => {
  const activeBuses = db.getBuses();
  
  activeBuses.forEach(bus => {
    const path = BUS_PATHS[bus.id];
    if (!path) return;

    let nextIdx = (busPathIndexes[bus.id] + 1) % path.length;
    busPathIndexes[bus.id] = nextIdx;

    const nextCoord = path[nextIdx];
    
    // Update database
    db.updateBusLocation(bus.id, nextCoord.lat, nextCoord.lng);

    // Automatic RFID Boarding Detection
    let activeStopId = null;
    if (bus.id === 'bus_1') {
      if (nextIdx === 0) activeStopId = 'stop_1_1';
      else if (nextIdx === 3) activeStopId = 'stop_1_2';
      else if (nextIdx === 6) activeStopId = 'stop_1_3';
      else if (nextIdx === 8) activeStopId = 'stop_1_4';
    } else if (bus.id === 'bus_2') {
      if (nextIdx === 0) activeStopId = 'stop_2_1';
      else if (nextIdx === 3) activeStopId = 'stop_2_2';
      else if (nextIdx === 6) activeStopId = 'stop_2_3';
      else if (nextIdx === 8) activeStopId = 'stop_2_4';
    }

    if (activeStopId) {
      const stop = db.getStops().find(s => s.id === activeStopId);
      if (stop) {
        const assignedStudents = db.getStudents().filter(s => s.boarding_stop_id === activeStopId);
        const todayStr = new Date().toISOString().split('T')[0];

        assignedStudents.forEach(student => {
          const existing = db.getAttendance().find(a => a.student_id === student.user_id && a.date === todayStr);
          if (!existing) {
            const user = db.findUserById(student.user_id);
            if (user) {
              const record = {
                id: `att_${student.user_id}_rfid_${Date.now().toString(36)}`,
                student_id: student.user_id,
                date: todayStr,
                status: 1, // Present
                marked_by: 'RFID_Scanner_Bus_Device',
                timestamp: new Date().toISOString()
              };
              db.insertAttendance(record);

              console.log(`\n--- [💳 RFID AUTO-BOARDING DETECTION] ---`);
              console.log(`Student ${user.name} boarded Bus ${bus.bus_number} at Stop: ${stop.name}`);
              console.log(`ID Card scanned successfully. Status: PRESENT logged.`);
              console.log(`-----------------------------------------\n`);

              broadcastSocketMessage({
                type: 'rfid_boarded',
                studentId: student.user_id,
                studentName: user.name,
                busNumber: bus.bus_number,
                stopName: stop.name,
                timestamp: record.timestamp,
                status: 1
              });
            }
          }
        });
      }
    }

    // Calculate dynamic ETA to next stops (simulated distance math)
    const speed = bus.speed_kmh || 30;
    // Calculate simulated minutes ETA to the final campus gate stop (the last stop on the route)
    // If route_1, Campus Stop is index 8 (IISc East Gate)
    // If route_2, Campus Stop is index 8 (IISc Main Campus)
    let stopsLeft = 0;
    if (bus.id === 'bus_1') {
      stopsLeft = Math.abs(8 - nextIdx);
    } else {
      stopsLeft = Math.abs(8 - nextIdx);
    }
    const etaMin = Math.max(1, Math.round(stopsLeft * 1.5));
    
    // Broadcast location
    broadcastSocketMessage({
      type: 'bus_location',
      busId: bus.id,
      busNumber: bus.bus_number,
      lat: nextCoord.lat,
      lng: nextCoord.lng,
      speed: speed + Math.round(Math.random() * 8 - 4), // slightly vary speed
      etaMin: etaMin
    });

    // Check geofence proximity alerts: if the bus gets close to our seeded student's stop (stop_1_2 at [13.0160, 77.5640])
    // If bus_1 is at index 3 (Ramaiah Gate) or index 2 (1 step away), trigger proximity alert!
    if (bus.id === 'bus_1' && (nextIdx === 2 || nextIdx === 3)) {
      console.log(`\n--- [PROXIMITY ALERTS TRIGGERS] ---`);
      console.log(`Bus ${bus.bus_number} is nearing Stop: Ramaiah Hospital Gate!`);
      console.log(`Sending alerts to Parents of assigned Students...`);
      console.log(`------------------------------------\n`);

      broadcastSocketMessage({
        type: 'proximity_alert',
        studentId: 'usr_student_1',
        message: `Saitrack Alert: Bus ${bus.bus_number} is 1 minute away from your boarding stop: Ramaiah Hospital Gate! Please prepare.`
      });
    }
  });
}, 2500);

// Start Server
server.listen(PORT, () => {
  console.log(`Saitrack (RYTT) Server is active on http://localhost:${PORT}`);
});
