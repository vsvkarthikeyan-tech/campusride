const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');

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
      alerts: []
    };
    this.init();
  }

  init() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        console.log('Database loaded successfully from file.');
        return;
      } catch (err) {
        console.error('Error reading database file, recreating seed data...', err);
      }
    }
    this.seed();
    this.save();
  }

  save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save database file:', err);
    }
  }

  seed() {
    console.log('Seeding initial mock data...');

    // 1. Seed Users (Passwords: student123, parent123, admin123, driver123, driver456)
    const users = [
      {
        id: "usr_student_1",
        name: "Rahul Kumar",
        email: "student@saitrack.com",
        password_hash: "student123",
        role: "student",
        phone: "+919876543210",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_student_2",
        name: "Aditya Sharma",
        email: "aditya@saitrack.com",
        password_hash: "student123",
        role: "student",
        phone: "+919876543220",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_student_3",
        name: "Neha Patel",
        email: "neha@saitrack.com",
        password_hash: "student123",
        role: "student",
        phone: "+919876543230",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_student_4",
        name: "Priya Nair",
        email: "priya@saitrack.com",
        password_hash: "student123",
        role: "student",
        phone: "+919876543240",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_parent_1",
        name: "Sanjay Kumar",
        email: "parent@saitrack.com",
        password_hash: "parent123",
        role: "parent",
        phone: "+919876543211",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_parent_2",
        name: "Meera Nair",
        email: "parent2@saitrack.com",
        password_hash: "parent123",
        role: "parent",
        phone: "+919876543221",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_admin_1",
        name: "Principal Mehra",
        email: "admin@saitrack.com",
        password_hash: "admin123",
        role: "admin",
        phone: "+919876543212",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_driver_1",
        name: "Ramesh Singh",
        email: "ramesh@saitrack.com",
        password_hash: "driver123",
        role: "student",
        phone: "+919876543213",
        created_at: new Date().toISOString()
      },
      {
        id: "usr_driver_2",
        name: "Gopal Prasad",
        email: "gopal@saitrack.com",
        password_hash: "driver456",
        role: "student",
        phone: "+919876543214",
        created_at: new Date().toISOString()
      }
    ];

    // 2. Seed Routes & Stops (Bangalore, India area coordinates)
    const routes = [
      {
        id: "route_1",
        name: "Greenfield Campus Express (Route 1)",
        description: "Services the eastern sector, Yeshwanthpur, and Malleshwaram regions."
      },
      {
        id: "route_2",
        name: "Metro Connector Loop (Route 2)",
        description: "Links Hebbal, RT Nagar, and Mathikere to the main campus gates."
      }
    ];

    const stops = [
      // Route 1 stops
      { id: "stop_1_1", route_id: "route_1", name: "Yeshwanthpur Metro Hub", latitude: 13.0230, longitude: 77.5500, sequence_order: 1 },
      { id: "stop_1_2", route_id: "route_1", name: "Ramaiah Hospital Gate", latitude: 13.0160, longitude: 77.5640, sequence_order: 2 },
      { id: "stop_1_3", route_id: "route_1", name: "Malleshwaram 18th Cross", latitude: 12.9980, longitude: 77.5630, sequence_order: 3 },
      { id: "stop_1_4", route_id: "route_1", name: "IISc East Gate Gatehouse", latitude: 12.9990, longitude: 77.5710, sequence_order: 4 },
      // Route 2 stops
      { id: "stop_2_1", route_id: "route_2", name: "Hebbal Flyover Junction", latitude: 13.0350, longitude: 77.5970, sequence_order: 1 },
      { id: "stop_2_2", route_id: "route_2", name: "RT Nagar Post Office", latitude: 13.0180, longitude: 77.5930, sequence_order: 2 },
      { id: "stop_2_3", route_id: "route_2", name: "Sadashivanagar Police Station", latitude: 13.0070, longitude: 77.5800, sequence_order: 3 },
      { id: "stop_2_4", route_id: "route_2", name: "IISc Main Campus Gate", latitude: 12.9960, longitude: 77.5720, sequence_order: 4 }
    ];

    // 3. Seed Students and Parents link
    const students = [
      {
        user_id: "usr_student_1",
        class_grade: "1st Year",
        route_id: "route_1",
        boarding_stop_id: "stop_1_2"
      },
      {
        user_id: "usr_student_2",
        class_grade: "2nd Year",
        route_id: "route_1",
        boarding_stop_id: "stop_1_1"
      },
      {
        user_id: "usr_student_3",
        class_grade: "3rd Year",
        route_id: "route_2",
        boarding_stop_id: "stop_2_2"
      },
      {
        user_id: "usr_student_4",
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

    // 4. Seed Buses
    const buses = [
      {
        id: "bus_1",
        bus_number: "KA-04-AB-1234",
        driver_id: "usr_driver_1",
        route_id: "route_1",
        latitude: 13.0230,
        longitude: 77.5500,
        last_update: new Date().toISOString(),
        speed_kmh: 35,
        status: "active"
      },
      {
        id: "bus_2",
        bus_number: "KA-04-CD-5678",
        driver_id: "usr_driver_2",
        route_id: "route_2",
        latitude: 13.0350,
        longitude: 77.5970,
        last_update: new Date().toISOString(),
        speed_kmh: 40,
        status: "active"
      }
    ];

    // 5. Seed 30-day Attendance for all 4 students (different patterns)
    const attendance = [];
    const today = new Date();
    const studentIds = ["usr_student_1", "usr_student_2", "usr_student_3", "usr_student_4"];
    
    studentIds.forEach(studentId => {
      for (let i = 30; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        
        // Skip weekends
        const day = date.getDay();
        if (day === 0 || day === 6) continue;

        const dateStr = date.toISOString().split('T')[0];
        // Vary absences per student for premium realistic data
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

    // 6. Seed Payments (1 Pending, 3 Completed for each child)
    const payments = [];
    studentIds.forEach((studentId) => {
      payments.push({
        id: `pay_due_${studentId}_${Date.now().toString(36)}`,
        student_id: studentId,
        amount: 2500.00,
        currency: "INR",
        gpay_token: null,
        status: "pending",
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
          timestamp: new Date(today.getFullYear(), today.getMonth() - m, 3).toISOString()
        });
      }
    });

    // 7. Seed initial alerts
    const alerts = [
      {
        id: "alert_seed_1",
        user_id: "usr_student_1",
        type: "student_panic",
        message: "Panic alert triggered near Malleshwaram Stop.",
        latitude: 12.9982,
        longitude: 77.5632,
        status: "resolved",
        resolved_by: "usr_admin_1",
        timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
        resolved_timestamp: new Date(Date.now() - 3600000 * 23.8).toISOString()
      }
    ];

    this.data = { users, students, parents, parent_student, attendance, routes, stops, buses, payments, alerts };
  }

  // Helper Relational Methods
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

  // Custom DB operations
  findUserByEmail(email) {
    return this.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  }

  findUserById(id) {
    return this.data.users.find(u => u.id === id);
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
    this.data.parent_student.push({ parent_id, student_id });
    this.save();
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
      busNumber: bus ? bus.bus_number : 'Unassigned Bus',
      busId: bus ? bus.id : null,
      busLocation: bus ? { lat: bus.latitude, lng: bus.longitude } : null
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

  updateBusLocation(busId, lat, lon) {
    const bus = this.data.buses.find(b => b.id === busId);
    if (bus) {
      bus.latitude = lat;
      bus.longitude = lon;
      bus.last_update = new Date().toISOString();
      this.save();
      return bus;
    }
    return null;
  }

  insertAlert(alert) {
    this.data.alerts.unshift(alert); // Newest first
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
      // Check if attendance already exists for this student on this date
      const existingIdx = this.data.attendance.findIndex(a => a.student_id === r.student_id && a.date === r.date);
      const record = {
        id: existingIdx !== -1 ? this.data.attendance[existingIdx].id : `att_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        student_id: r.student_id,
        date: r.date,
        status: parseInt(r.status),
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
