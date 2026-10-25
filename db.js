const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

const DB_FILE = path.join(__dirname, 'db.json');
const DB_TMP_FILE = path.join(__dirname, 'db.json.tmp');

class MockDB {
  constructor() {
    this.data = {
      users: [],
      students: [],
      parents: [],
      parent_student: [],
      attendance: [],
      routes: [],
      stops: [],
      buses: [],
      payments: [],
      alerts: [],
      rfid_scans: [] // Scan event audit log
    };
    this.init();
  }

  init() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        if (!this.data.rfid_scans) this.data.rfid_scans = [];

        // Automatic data migration for legacy records
        let modified = false;

        // 1. Fix driver roles if mistakenly labeled as student
        this.data.users.forEach(u => {
          if (u.id.startsWith('usr_driver_') && u.role !== 'driver') {
            u.role = 'driver';
            modified = true;
          }
        });

        // 2. Ensure students have an assigned RFID tag
        this.data.students.forEach((st, idx) => {
          if (!st.rfid_tag) {
            st.rfid_tag = `RFID_SEC_00${idx + 1}`;
            modified = true;
          }
        });

        // 3. Migrate plaintext passwords to bcrypt hashes
        this.data.users.forEach(u => {
          if (u.password_hash && !u.password_hash.startsWith('$2a$') && !u.password_hash.startsWith('$2b$')) {
            try {
              u.password_hash = bcrypt.hashSync(u.password_hash, 10);
              modified = true;
            } catch (hashErr) {
              console.error(`Failed to migrate password for ${u.email}:`, hashErr);
            }
          }
        });

        // 4. Update routes and stops to verified Sri Sairam Engineering College coordinates if old sample data exists
        if (this.data.routes && this.data.routes.length > 0 && this.data.stops && this.data.stops.length > 0) {
          const firstStop = this.data.stops[0];
          // If first stop is Yeshwanthpur (old Bangalore sample), migrate to verified Sri Sairam Chennai coordinates
          if (firstStop.name && firstStop.name.includes('Yeshwanthpur')) {
            this.migrateToVerifiedCampusData();
            modified = true;
          }
        }

        if (modified) {
          this.save();
          console.log('Database migrated and saved with security and verified campus coordinates.');
        } else {
          console.log('Database loaded successfully from file.');
        }
        return;
      } catch (err) {
        console.error('Error reading database file, recreating seed data...', err);
      }
    }
    this.seed();
    this.save();
  }

  /**
   * Atomic save: write to a temporary file then rename to DB_FILE.
   * This prevents corrupted files if the process is terminated mid-write.
   */
  save() {
    try {
      const jsonStr = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(DB_TMP_FILE, jsonStr, 'utf8');
      fs.renameSync(DB_TMP_FILE, DB_FILE);
    } catch (err) {
      console.error('Failed to atomically save database file:', err);
      // Fallback direct write if rename fails on some file systems
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
      } catch (fallbackErr) {
        console.error('Fatal: Fallback save also failed:', fallbackErr);
      }
    }
  }

  /**
   * Verified institutional routes and stops for Sri Sairam Engineering College (Chennai)
   */
  migrateToVerifiedCampusData() {
    console.log(`Configuring verified routes for campus: ${config.CAMPUS.name} (${config.CAMPUS.latitude}, ${config.CAMPUS.longitude})`);

    this.data.routes = [
      {
        id: "route_1",
        name: "Route 1 — Guindy to Sri Sairam Campus (GST Corridor)",
        description: "Services Guindy Kathipara, Pallavaram, Chromepet, and West Tambaram to Sai Leo Nagar."
      },
      {
        id: "route_2",
        name: "Route 2 — Koyambedu to Sri Sairam Campus (Porur / Kundrathur Loop)",
        description: "Services Koyambedu CMBT, Porur Toll, Kundrathur, and Somangalam to Sai Leo Nagar."
      }
    ];

    this.data.stops = [
      // Route 1 Stops (Guindy -> Pallavaram -> Chromepet -> West Tambaram -> Sri Sairam College)
      { id: "stop_1_1", route_id: "route_1", name: "Guindy Kathipara Hub", latitude: 13.0067, longitude: 80.2025, sequence_order: 1 },
      { id: "stop_1_2", route_id: "route_1", name: "Pallavaram Bus Stand", latitude: 12.9680, longitude: 80.1490, sequence_order: 2 },
      { id: "stop_1_3", route_id: "route_1", name: "Chromepet MIT Gate", latitude: 12.9516, longitude: 80.1408, sequence_order: 3 },
      { id: "stop_1_4", route_id: "route_1", name: "Tambaram West Bus Terminus", latitude: 12.9249, longitude: 80.1000, sequence_order: 4 },
      { id: "stop_1_5", route_id: "route_1", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, is_campus: true },

      // Route 2 Stops (Koyambedu -> Porur -> Kundrathur -> Somangalam -> Sri Sairam College)
      { id: "stop_2_1", route_id: "route_2", name: "Koyambedu CMBT Metro", latitude: 13.0674, longitude: 80.2057, sequence_order: 1 },
      { id: "stop_2_2", route_id: "route_2", name: "Porur Toll Junction", latitude: 13.0336, longitude: 80.1585, sequence_order: 2 },
      { id: "stop_2_3", route_id: "route_2", name: "Kundrathur Murugan Temple Gate", latitude: 12.9976, longitude: 80.0964, sequence_order: 3 },
      { id: "stop_2_4", route_id: "route_2", name: "Somangalam Junction", latitude: 12.9723, longitude: 80.0732, sequence_order: 4 },
      { id: "stop_2_5", route_id: "route_2", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, is_campus: true }
    ];

    // Update buses initial coordinates to first stop of their routes
    this.data.buses.forEach(b => {
      if (b.id === 'bus_1') {
        b.latitude = 13.0067;
        b.longitude = 80.2025;
        b.bus_number = "TN-11-AB-1234";
      } else if (b.id === 'bus_2') {
        b.latitude = 13.0674;
        b.longitude = 80.2057;
        b.bus_number = "TN-11-CD-5678";
      }
      b.last_update = new Date().toISOString();
      b.is_simulated = false;
    });
  }

  seed() {
    console.log('Seeding initial verified CampusRide dataset...');

    // 1. Seed Users with secure Bcrypt hashes
    const saltRounds = 10;
    const users = [
      {
        id: "usr_student_1",
        name: "Rahul Kumar",
        email: "student@saitrack.com",
        password_hash: bcrypt.hashSync("student123", saltRounds),
        role: "student",
        phone: "+919876543210",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_student_2",
        name: "Aditya Sharma",
        email: "aditya@saitrack.com",
        password_hash: bcrypt.hashSync("student123", saltRounds),
        role: "student",
        phone: "+919876543220",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_student_3",
        name: "Neha Patel",
        email: "neha@saitrack.com",
        password_hash: bcrypt.hashSync("student123", saltRounds),
        role: "student",
        phone: "+919876543230",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_student_4",
        name: "Priya Nair",
        email: "priya@saitrack.com",
        password_hash: bcrypt.hashSync("student123", saltRounds),
        role: "student",
        phone: "+919876543240",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_parent_1",
        name: "Sanjay Kumar",
        email: "parent@saitrack.com",
        password_hash: bcrypt.hashSync("parent123", saltRounds),
        role: "parent",
        phone: "+919876543211",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_parent_2",
        name: "Meera Nair",
        email: "parent2@saitrack.com",
        password_hash: bcrypt.hashSync("parent123", saltRounds),
        role: "parent",
        phone: "+919876543221",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_admin_1",
        name: "Principal Mehra",
        email: "admin@saitrack.com",
        password_hash: bcrypt.hashSync("admin123", saltRounds),
        role: "admin",
        phone: "+919876543212",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_driver_1",
        name: "Ramesh Singh",
        email: "ramesh@saitrack.com",
        password_hash: bcrypt.hashSync("driver123", saltRounds),
        role: "driver",
        phone: "+919876543213",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_driver_2",
        name: "Gopal Prasad",
        email: "gopal@saitrack.com",
        password_hash: bcrypt.hashSync("driver456", saltRounds),
        role: "driver",
        phone: "+919876543214",
        created_at: new Date().toISOString()
      }
    ];

    // 2. Verified Routes and Stops
    const routes = [
      {
        id: "route_1",
        name: "Route 1 — Guindy to Sri Sairam Campus (GST Corridor)",
        description: "Services Guindy Kathipara, Pallavaram, Chromepet, and West Tambaram to Sai Leo Nagar."
      },
      {
        id: "route_2",
        name: "Route 2 — Koyambedu to Sri Sairam Campus (Porur / Kundrathur Loop)",
        description: "Services Koyambedu CMBT, Porur Toll, Kundrathur, and Somangalam to Sai Leo Nagar."
      }
    ];

    const stops = [
      // Route 1 Stops
      { id: "stop_1_1", route_id: "route_1", name: "Guindy Kathipara Hub", latitude: 13.0067, longitude: 80.2025, sequence_order: 1 },
      { id: "stop_1_2", route_id: "route_1", name: "Pallavaram Bus Stand", latitude: 12.9680, longitude: 80.1490, sequence_order: 2 },
      { id: "stop_1_3", route_id: "route_1", name: "Chromepet MIT Gate", latitude: 12.9516, longitude: 80.1408, sequence_order: 3 },
      { id: "stop_1_4", route_id: "route_1", name: "Tambaram West Bus Terminus", latitude: 12.9249, longitude: 80.1000, sequence_order: 4 },
      { id: "stop_1_5", route_id: "route_1", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, is_campus: true },

      // Route 2 Stops
      { id: "stop_2_1", route_id: "route_2", name: "Koyambedu CMBT Metro", latitude: 13.0674, longitude: 80.2057, sequence_order: 1 },
      { id: "stop_2_2", route_id: "route_2", name: "Porur Toll Junction", latitude: 13.0336, longitude: 80.1585, sequence_order: 2 },
      { id: "stop_2_3", route_id: "route_2", name: "Kundrathur Murugan Temple Gate", latitude: 12.9976, longitude: 80.0964, sequence_order: 3 },
      { id: "stop_2_4", route_id: "route_2", name: "Somangalam Junction", latitude: 12.9723, longitude: 80.0732, sequence_order: 4 },
      { id: "stop_2_5", route_id: "route_2", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, is_campus: true }
    ];

    // 3. Students with RFID Tags
    const students = [
      {
        user_id: "usr_student_1",
        rfid_tag: "RFID_SEC_001",
        class_grade: "1st Year",
        route_id: "route_1",
        boarding_stop_id: "stop_1_2"
      },
      {
        user_id: "usr_student_2",
        rfid_tag: "RFID_SEC_002",
        class_grade: "2nd Year",
        route_id: "route_1",
        boarding_stop_id: "stop_1_1"
      },
      {
        user_id: "usr_student_3",
        rfid_tag: "RFID_SEC_003",
        class_grade: "3rd Year",
        route_id: "route_2",
        boarding_stop_id: "stop_2_2"
      },
      {
        user_id: "usr_student_4",
        rfid_tag: "RFID_SEC_004",
        class_grade: "1st Year",
        route_id: "route_2",
        boarding_stop_id: "stop_2_3"
      }
    ];

    const parents = [
      { user_id: "usr_parent_1" },
      { user_id: "usr_parent_2" }
    ];

    const parent_student = [
      { parent_id: "usr_parent_1", student_id: "usr_student_1" },
      { parent_id: "usr_parent_1", student_id: "usr_student_2" },
      { parent_id: "usr_parent_2", student_id: "usr_student_3" },
      { parent_id: "usr_parent_2", student_id: "usr_student_4" }
    ];

    // 4. Buses
    const buses = [
      {
        id: "bus_1",
        bus_number: "TN-11-AB-1234",
        driver_id: "usr_driver_1",
        route_id: "route_1",
        latitude: 13.0067,
        longitude: 80.2025,
        last_update: new Date().toISOString(),
        speed_kmh: 35,
        heading: 215,
        status: "active",
        is_simulated: false
      },
      {
        id: "bus_2",
        bus_number: "TN-11-CD-5678",
        driver_id: "usr_driver_2",
        route_id: "route_2",
        latitude: 13.0674,
        longitude: 80.2057,
        last_update: new Date().toISOString(),
        speed_kmh: 40,
        heading: 230,
        status: "active",
        is_simulated: false
      }
    ];

    // 5. Seed Attendance
    const attendance = [];
    const today = new Date();
    const studentIds = ["usr_student_1", "usr_student_2", "usr_student_3", "usr_student_4"];

    studentIds.forEach(studentId => {
      for (let i = 30; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const day = date.getDay();
        if (day === 0 || day === 6) continue;

        const dateStr = date.toISOString().split('T')[0];
        let isAbsent = false;
        if (studentId === "usr_student_1") isAbsent = (i === 4 || i === 12 || i === 18 || i === 25);
        else if (studentId === "usr_student_2") isAbsent = (i === 6 || i === 15 || i === 22);
        else if (studentId === "usr_student_3") isAbsent = (i === 2 || i === 9 || i === 17 || i === 28);
        else if (studentId === "usr_student_4") isAbsent = (i === 5 || i === 14 || i === 20);

        attendance.push({
          id: `att_${studentId}_${i}_${Date.now().toString(36)}`,
          student_id: studentId,
          date: dateStr,
          status: isAbsent ? 0 : 1,
          marked_by: "usr_admin_1",
          timestamp: date.toISOString()
        });
      }
    });

    // 6. Seed Payments
    const payments = [];
    studentIds.forEach((studentId) => {
      payments.push({
        id: `pay_due_${studentId}_${Date.now().toString(36)}`,
        student_id: studentId,
        amount: 2500.00,
        currency: "INR",
        gpay_token: null,
        status: "pending",
        simulated: true,
        timestamp: new Date(today.getFullYear(), today.getMonth(), 5).toISOString()
      });

      for (let m = 1; m <= 3; m++) {
        payments.push({
          id: `pay_rcpt_${studentId}_${m}_${Date.now().toString(36)}`,
          student_id: studentId,
          amount: 2500.00,
          currency: "INR",
          gpay_token: `gpay_tok_${studentId.substring(4, 9)}_${m}`,
          status: "completed",
          simulated: true,
          timestamp: new Date(today.getFullYear(), today.getMonth() - m, 3).toISOString()
        });
      }
    });

    // 7. Seed Alerts
    const alerts = [
      {
        id: "alert_seed_1",
        user_id: "usr_student_1",
        type: "student_panic",
        message: "Panic alert triggered near Pallavaram Stop.",
        latitude: 12.9680,
        longitude: 80.1490,
        status: "resolved",
        resolved_by: "usr_admin_1",
        timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
        resolved_timestamp: new Date(Date.now() - 3600000 * 23.8).toISOString()
      }
    ];

    this.data = {
      users,
      students,
      parents,
      parent_student,
      attendance,
      routes,
      stops,
      buses,
      payments,
      alerts,
      rfid_scans: []
    };
  }

  // Password Security Helpers
  hashPassword(plaintext) {
    return bcrypt.hashSync(plaintext, 10);
  }

  verifyPassword(user, plaintext) {
    if (!user || !user.password_hash || !plaintext) return false;
    
    // Check if bcrypt hashed
    if (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$')) {
      return bcrypt.compareSync(plaintext, user.password_hash);
    }
    
    // Legacy plaintext support with auto-migration to bcrypt
    if (user.password_hash === plaintext) {
      try {
        user.password_hash = this.hashPassword(plaintext);
        this.save();
        console.log(`Auto-migrated legacy password to bcrypt for ${user.email}`);
      } catch (err) {}
      return true;
    }
    return false;
  }

  // Getters
  getUsers() { return this.data.users; }
  getStudents() { return this.data.students; }
  getParents() { return this.data.parents; }
  getParentStudents() { return this.data.parent_student; }
  getAttendance() { return this.data.attendance; }
  getRoutes() { return this.data.routes; }
  getStops() { return this.data.stops; }
  getBuses() { return this.data.buses; }
  getPayments() { return this.data.payments; }
  getAlerts() { return this.data.alerts; }
  getRFIDScans() { return this.data.rfid_scans || []; }

  // User finders
  findUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  findStudentByRFID(tag) {
    if (!tag) return null;
    const cleanTag = tag.trim().toUpperCase();
    return this.data.students.find(s => (s.rfid_tag && s.rfid_tag.toUpperCase() === cleanTag) || s.user_id === tag);
  }

  insertUser(user) {
    this.data.users.push(user);
    this.save();
    return user;
  }

  insertStudent(student) {
    this.data.students.push(student);
    this.save();
    return student;
  }

  insertParent(parent) {
    this.data.parents.push(parent);
    this.save();
    return parent;
  }

  linkParentStudent(parent_id, student_id) {
    // Avoid duplicates
    const exists = this.data.parent_student.some(ps => ps.parent_id === parent_id && ps.student_id === student_id);
    if (!exists) {
      this.data.parent_student.push({ parent_id, student_id });
      this.save();
    }
  }

  getStudentDetails(userId) {
    const student = this.data.students.find(s => s.user_id === userId);
    if (!student) return null;
    const user = this.findUserById(userId);
    const route = this.data.routes.find(r => r.id === student.route_id);
    const stop = this.data.stops.find(st => st.id === student.boarding_stop_id);
    const bus = this.data.buses.find(b => b.route_id === student.route_id);
    return {
      ...student,
      name: user ? user.name : '',
      phone: user ? user.phone : '',
      email: user ? user.email : '',
      routeName: route ? route.name : 'Unassigned',
      stopName: stop ? stop.name : 'Unassigned Stop',
      boardingStop: stop || null,
      busNumber: bus ? bus.bus_number : 'Unassigned Bus',
      busId: bus ? bus.id : null,
      busLocation: bus ? { 
        lat: bus.latitude, 
        lng: bus.longitude, 
        speed: bus.speed_kmh,
        heading: bus.heading,
        last_update: bus.last_update,
        is_simulated: !!bus.is_simulated
      } : null
    };
  }

  updateStudentStop(userId, stopId) {
    const student = this.data.students.find(s => s.user_id === userId);
    if (student) {
      student.boarding_stop_id = stopId;
      this.save();
      return true;
    }
    return false;
  }

  updateBusLocation(busId, lat, lon, speed, heading, isSimulated = false) {
    const bus = this.data.buses.find(b => b.id === busId);
    if (bus) {
      bus.latitude = parseFloat(lat);
      bus.longitude = parseFloat(lon);
      if (typeof speed !== 'undefined' && speed !== null) bus.speed_kmh = parseFloat(speed);
      if (typeof heading !== 'undefined' && heading !== null) bus.heading = parseFloat(heading);
      bus.last_update = new Date().toISOString();
      bus.is_simulated = !!isSimulated;
      this.save();
      return bus;
    }
    return null;
  }

  /**
   * Process an incoming RFID tap or UHF gate scan event.
   * Includes duplicate check to debounce repeated reads within RFID_DEBOUNCE_MS.
   */
  recordRFIDScan({ rfid_tag, bus_id, reader_id, timestamp }) {
    const student = this.findStudentByRFID(rfid_tag);
    if (!student) {
      return { success: false, error: 'Unknown RFID tag: No student mapped to this card' };
    }

    const scanTime = timestamp ? new Date(timestamp) : new Date();
    const scanTimeMs = scanTime.getTime();
    const todayStr = scanTime.toISOString().split('T')[0];

    // Duplicate debouncing: check scans for this student within debounce window
    if (!this.data.rfid_scans) this.data.rfid_scans = [];
    const recentScan = this.data.rfid_scans.find(s => 
      s.student_id === student.user_id && 
      s.bus_id === bus_id &&
      (scanTimeMs - new Date(s.timestamp).getTime()) < config.RFID_DEBOUNCE_MS
    );

    if (recentScan) {
      return { 
        success: true, 
        duplicate: true, 
        message: 'Duplicate scan ignored (within debounce cooldown window)', 
        student,
        lastScanTime: recentScan.timestamp 
      };
    }

    // Log the scan event in audit log
    const scanEvent = {
      id: `scan_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      rfid_tag,
      student_id: student.user_id,
      bus_id,
      reader_id: reader_id || 'UHF_Bus_Gate_Reader',
      timestamp: scanTime.toISOString()
    };
    this.data.rfid_scans.unshift(scanEvent);
    if (this.data.rfid_scans.length > 500) this.data.rfid_scans.pop();

    // Mark Attendance
    const existingIdx = this.data.attendance.findIndex(a => a.student_id === student.user_id && a.date === todayStr);
    const record = {
      id: existingIdx !== -1 ? this.data.attendance[existingIdx].id : `att_${student.user_id}_rfid_${Date.now().toString(36)}`,
      student_id: student.user_id,
      date: todayStr,
      status: 1, // Present
      marked_by: reader_id ? `UHF_RFID_Reader_${reader_id}` : 'UHF_RFID_Reader_Bus',
      timestamp: scanTime.toISOString()
    };

    if (existingIdx !== -1) {
      this.data.attendance[existingIdx] = record;
    } else {
      this.data.attendance.push(record);
    }

    this.save();
    return { 
      success: true, 
      duplicate: false, 
      student, 
      record, 
      scanEvent 
    };
  }

  insertAlert(alert) {
    this.data.alerts.unshift(alert);
    this.save();
    return alert;
  }

  resolveAlert(alertId, adminId) {
    const alert = this.data.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'resolved';
      alert.resolved_by = adminId;
      alert.resolved_timestamp = new Date().toISOString();
      this.save();
      return alert;
    }
    return null;
  }

  acknowledgeAlert(alertId) {
    const alert = this.data.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.status = 'acknowledged';
      this.save();
      return alert;
    }
    return null;
  }

  insertPayment(payment) {
    this.data.payments.unshift(payment);
    this.save();
    return payment;
  }

  updatePaymentStatus(paymentId, status, token) {
    const payment = this.data.payments.find(p => p.id === paymentId);
    if (payment) {
      payment.status = status;
      if (token) payment.gpay_token = token;
      payment.timestamp = new Date().toISOString();
      this.save();
      return payment;
    }
    return null;
  }

  insertAttendance(record) {
    this.data.attendance.push(record);
    this.save();
    return record;
  }

  bulkMarkAttendance(records, markedBy) {
    const results = [];
    records.forEach(r => {
      const existingIdx = this.data.attendance.findIndex(a => a.student_id === r.student_id && a.date === r.date);
      const record = {
        id: existingIdx !== -1 ? this.data.attendance[existingIdx].id : `att_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        student_id: r.student_id,
        date: r.date,
        status: parseInt(r.status, 10),
        marked_by: markedBy,
        timestamp: new Date().toISOString()
      };
      
      if (existingIdx !== -1) {
        this.data.attendance[existingIdx] = record;
      } else {
        this.data.attendance.push(record);
      }
      results.push(record);
    });
    this.save();
    return results;
  }
}

module.exports = new MockDB();
