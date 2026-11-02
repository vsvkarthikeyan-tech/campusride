const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

const DB_FILE = path.join(__dirname, 'db.json');
const DB_TMP_FILE = path.join(__dirname, 'db.json.tmp');

/**
 * Standardizes engineering college academic years (Module 2)
 * Strictly allows 1st Year, 2nd Year, 3rd Year, 4th Year.
 */
function formatAcademicYear(year) {
  const y = parseInt(year, 10);
  if (y === 1) return '1st Year';
  if (y === 2) return '2nd Year';
  if (y === 3) return '3rd Year';
  if (y === 4) return '4th Year';
  return '1st Year';
}

function parseAcademicYear(val) {
  if (!val) return 1;
  const s = String(val).trim();
  if (/^[1-4]$/.test(s)) return parseInt(s, 10);
  if (/^1(st)?(\s*year)?$/i.test(s)) return 1;
  if (/^2(nd)?(\s*year)?$/i.test(s)) return 2;
  if (/^3(rd)?(\s*year)?$/i.test(s)) return 3;
  if (/^4(th)?(\s*year)?$/i.test(s)) return 4;
  return 1;
}

function isSchoolGrade(val) {
  if (!val) return false;
  const s = String(val).trim();
  return /^(9|10|11|12)(th)?(\s*(grade|std|standard))?/i.test(s);
}

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
      rfid_scans: [], // Scan event audit log
      attendance_uploads: [], // Bulk attendance upload records
      attendance_audit_log: [] // Audit log for uploads and rollbacks
    };
    this.init();
  }

  init() {
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        if (!this.data.rfid_scans) this.data.rfid_scans = [];
        if (!this.data.attendance_uploads) this.data.attendance_uploads = [];
        if (!this.data.attendance_audit_log) this.data.attendance_audit_log = [];

        // Automatic data migration for legacy records
        let modified = false;

        // 1. Fix driver roles if mistakenly labeled as student
        this.data.users.forEach(u => {
          if (u.id.startsWith('usr_driver_') && u.role !== 'driver') {
            u.role = 'driver';
            modified = true;
          }
        });

        // 2. Ensure students have assigned RFID tag, student_id, department, and year
        // 2. Ensure default demo students (DEMO-ST001 to DEMO-ST010) exist and are synchronized
        const demoRoster = [
          { student_id: 'DEMO-ST001', name: 'Arun Kumar', department: 'CCE', year: 4 },
          { student_id: 'DEMO-ST002', name: 'Priya S', department: 'CSE', year: 3 },
          { student_id: 'DEMO-ST003', name: 'Karthik R', department: 'ECE', year: 2 },
          { student_id: 'DEMO-ST004', name: 'Divya M', department: 'IT', year: 4 },
          { student_id: 'DEMO-ST005', name: 'Rahul S', department: 'EEE', year: 3 },
          { student_id: 'DEMO-ST006', name: 'Nisha P', department: 'CCE', year: 2 },
          { student_id: 'DEMO-ST007', name: 'Vignesh K', department: 'CSE', year: 1 },
          { student_id: 'DEMO-ST008', name: 'Meena R', department: 'AIDS', year: 3 },
          { student_id: 'DEMO-ST009', name: 'Sanjay V', department: 'ECE', year: 4 },
          { student_id: 'DEMO-ST010', name: 'Harini T', department: 'IT', year: 2 }
        ];

        demoRoster.forEach((demo, idx) => {
          const demoUserId = `usr_demo_${idx + 1}`;
          let user = this.data.users.find(u => u.id === demoUserId || u.email === `demo${idx + 1}@saitrack.com`);
          if (!user) {
            user = {
              id: demoUserId,
              name: demo.name,
              email: `demo${idx + 1}@saitrack.com`,
              password_hash: bcrypt.hashSync('student123', 10),
              role: 'student',
              phone: `+91987654310${idx}`,
              created_at: new Date().toISOString()
            };
            this.data.users.push(user);
            modified = true;
          } else {
            if (user.name !== demo.name) {
              user.name = demo.name;
              modified = true;
            }
          }

          let student = this.data.students.find(s => s.user_id === user.id || s.student_id === demo.student_id);
          if (!student) {
            student = {
              user_id: user.id,
              student_id: demo.student_id,
              department: demo.department,
              year: demo.year,
              class_grade: `${demo.year}th Year`,
              route_id: idx % 2 === 0 ? 'route_1' : 'route_2',
              boarding_stop_id: idx % 2 === 0 ? 'stop_1_1' : 'stop_2_1',
              rfid_tag: `RFID_DEMO_0${idx + 1}`
            };
            this.data.students.push(student);
            modified = true;
          } else {
            if (student.student_id !== demo.student_id || student.department !== demo.department || student.year !== demo.year) {
              student.student_id = demo.student_id;
              student.department = demo.department;
              student.year = demo.year;
              modified = true;
            }
          }
        });

        // Ensure legacy students have rfid tags and student_ids
        this.data.students.forEach((st, idx) => {
          if (!st.rfid_tag) {
            st.rfid_tag = `RFID_SEC_00${idx + 1}`;
            modified = true;
          }
          if (!st.student_id) {
            st.student_id = `ST00${idx + 1}`;
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

        // 5. Rename all legacy "Test Cadet" records to authentic student names
        const realisticStudentNames = [
          'Aakash Verma',
          'Sneha Patel',
          'Rohan Sharma',
          'Ananya Iyer',
          'Manish Reddy',
          'Kavita Nair',
          'Deepak Joshi',
          'Swati Mukherjee',
          'Vikram Malhotra',
          'Pooja Das',
          'Aditya Rao',
          'Varun Kapoor',
          'Bhavna Sen'
        ];
        let repIdx = 0;
        this.data.users.forEach(u => {
          if (u.name && u.name.toLowerCase().includes('cadet')) {
            u.name = realisticStudentNames[repIdx % realisticStudentNames.length];
            repIdx++;
            modified = true;
          }
        });

        // 6. MODULE 2: Standardize all student academic years and eliminate school classes
        this.data.students.forEach(st => {
          let y = st.year;
          let cg = st.class_grade || '';

          if (cg.includes('10th Grade')) y = 4;
          else if (cg.includes('12th Grade')) y = 3;
          else if (cg.includes('9th Grade')) y = 2;
          else if (cg.includes('11th Grade')) y = 1;
          else if (!y) y = parseAcademicYear(cg);
          else y = parseAcademicYear(y);

          const stdGrade = formatAcademicYear(y);
          if (st.year !== y || st.class_grade !== stdGrade) {
            st.year = y;
            st.class_grade = stdGrade;
            modified = true;
          }
        });

        // 7. MODULE 1: Ensure user account status, must_change_password, and last_login_at
        this.data.users.forEach(u => {
          if (!u.status) {
            u.status = 'active';
            modified = true;
          }
          if (u.must_change_password === undefined) {
            u.must_change_password = false;
            modified = true;
          }
          if (u.last_login_at === undefined) {
            u.last_login_at = null;
            modified = true;
          }
        });

        // 8. MODULE 3 & 4: Ensure Sri Sairam Engineering College 5 Demo Starter Routes, Stops, and Buses exist
        if (this.migrateToSairamFiveRoutes()) {
          modified = true;
        }

        // 9. MODULE 8: Ensure all students have bus_id assigned
        this.data.students.forEach(st => {
          if (!st.bus_id && st.route_id) {
            const rt = this.data.routes.find(r => r.id === st.route_id);
            if (rt && rt.bus_id) {
              st.bus_id = rt.bus_id;
              modified = true;
            } else {
              const bus = this.data.buses.find(b => b.route_id === st.route_id);
              if (bus) {
                st.bus_id = bus.id;
                modified = true;
              }
            }
          }
        });

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
   * Modules 3 & 4: Configures at least 5 editable starter demo routes based on Sairam transport documentation.
   */
  migrateToSairamFiveRoutes() {
    let changed = false;
    if (!this.data.routes) this.data.routes = [];
    if (!this.data.stops) this.data.stops = [];
    if (!this.data.buses) this.data.buses = [];

    // Ensure Additional Drivers (usr_driver_3, usr_driver_4, usr_driver_5)
    const extraDrivers = [
      { id: "usr_driver_1", name: "Ramesh Singh", email: "ramesh@saitrack.com", phone: "+919876543213" },
      { id: "usr_driver_2", name: "Gopal Prasad", email: "gopal@saitrack.com", phone: "+919876543214" },
      { id: "usr_driver_3", name: "Murugan K", email: "murugan@saitrack.com", phone: "+919876543215" },
      { id: "usr_driver_4", name: "Senthil Nathan", email: "senthil@saitrack.com", phone: "+919876543216" },
      { id: "usr_driver_5", name: "Rajesh Kumar", email: "rajesh@saitrack.com", phone: "+919876543217" }
    ];

    extraDrivers.forEach(d => {
      let u = this.data.users.find(usr => usr.id === d.id || usr.email === d.email);
      if (!u) {
        u = {
          id: d.id,
          name: d.name,
          email: d.email,
          phone: d.phone,
          password_hash: bcrypt.hashSync("driver123", 10),
          role: "driver",
          status: "active",
          must_change_password: false,
          created_at: new Date().toISOString()
        };
        this.data.users.push(u);
        changed = true;
      }
    });

    // Five Editable Demo Starter Routes (Sri Sairam Engineering College)
    const sairamRoutes = [
      {
        id: "route_1",
        route_number: "R-01",
        name: "Route 1: Valasaravakkam – Porur – Kundrathur",
        start_location: "Valasaravakkam",
        destination: "Sri Sairam Engineering College",
        description: "Services Valasaravakkam, Porur, Karampakkam, Kovur, and Kundrathur to Sai Leo Nagar.",
        status: "active",
        verification_status: "DEMO – PENDING TRANSPORT OFFICE VERIFICATION",
        bus_id: "bus_1",
        driver_id: "usr_driver_1"
      },
      {
        id: "route_2",
        route_number: "R-02",
        name: "Route 2: Kandigai – Rathnamangalam – Vandalur",
        start_location: "Kandigai Police Quarters",
        destination: "Sri Sairam Engineering College",
        description: "Services Kandigai, Rathnamangalam, Kolapakkam, and Vandalur Zoo to Sai Leo Nagar.",
        status: "active",
        verification_status: "DEMO – PENDING TRANSPORT OFFICE VERIFICATION",
        bus_id: "bus_2",
        driver_id: "usr_driver_2"
      },
      {
        id: "route_3",
        route_number: "R-03",
        name: "Route 3: Pammal – Pozhichallur – Thiruneermalai",
        start_location: "Pammal",
        destination: "Sri Sairam Engineering College",
        description: "Services Pammal, Pozhichallur, Nagalkeni, and Thiruneermalai to Sai Leo Nagar.",
        status: "active",
        verification_status: "DEMO – PENDING TRANSPORT OFFICE VERIFICATION",
        bus_id: "bus_3",
        driver_id: "usr_driver_3"
      },
      {
        id: "route_4",
        route_number: "R-04",
        name: "Route 4: Mappedu – Thiruvancherry",
        start_location: "Mappedu",
        destination: "Sri Sairam Engineering College",
        description: "Services Mappedu, Thiruvancherry, Lakshmi Ammal College area, and Bharath Univ area.",
        status: "active",
        verification_status: "DEMO – PENDING TRANSPORT OFFICE VERIFICATION",
        bus_id: "bus_4",
        driver_id: "usr_driver_4"
      },
      {
        id: "route_5",
        route_number: "R-05",
        name: "Route 5: Tambaram – Perungalathur – College",
        start_location: "Tambaram Railway Station area",
        destination: "Sri Sairam Engineering College",
        description: "Services Tambaram Railway Station, West Tambaram, Perungalathur, and Vandalur to Sai Leo Nagar.",
        status: "active",
        verification_status: "DEMO – PENDING TRANSPORT OFFICE VERIFICATION",
        bus_id: "bus_5",
        driver_id: "usr_driver_5"
      }
    ];

    sairamRoutes.forEach(sr => {
      const existing = this.data.routes.find(r => r.id === sr.id);
      if (!existing) {
        this.data.routes.push(sr);
        changed = true;
      } else {
        if (!existing.route_number || !existing.verification_status || !existing.bus_id || existing.name !== sr.name) {
          existing.route_number = sr.route_number;
          existing.name = sr.name;
          existing.start_location = sr.start_location;
          existing.destination = sr.destination;
          existing.description = sr.description;
          existing.status = existing.status || 'active';
          existing.verification_status = sr.verification_status;
          existing.bus_id = sr.bus_id;
          existing.driver_id = sr.driver_id;
          changed = true;
        }
      }
    });

    // 5 Institutional Buses with Configured Seating Capacity (50 seats)
    const sairamBuses = [
      { id: "bus_1", bus_number: "TN-11-AB-1234", capacity: 50, driver_id: "usr_driver_1", route_id: "route_1", latitude: 13.0403, longitude: 80.1723, last_update: new Date().toISOString(), speed_kmh: 38, status: "active", is_simulated: false, heading: 215 },
      { id: "bus_2", bus_number: "TN-11-CD-5678", capacity: 50, driver_id: "usr_driver_2", route_id: "route_2", latitude: 12.8720, longitude: 80.1410, last_update: new Date().toISOString(), speed_kmh: 42, status: "active", is_simulated: false, heading: 320 },
      { id: "bus_3", bus_number: "TN-11-EF-9012", capacity: 50, driver_id: "usr_driver_3", route_id: "route_3", latitude: 12.9720, longitude: 80.1380, last_update: new Date().toISOString(), speed_kmh: 35, status: "active", is_simulated: false, heading: 195 },
      { id: "bus_4", bus_number: "TN-11-GH-3456", capacity: 50, driver_id: "usr_driver_4", route_id: "route_4", latitude: 12.8710, longitude: 80.1480, last_update: new Date().toISOString(), speed_kmh: 30, status: "active", is_simulated: false, heading: 240 },
      { id: "bus_5", bus_number: "TN-11-IJ-7890", capacity: 50, driver_id: "usr_driver_5", route_id: "route_5", latitude: 12.9255, longitude: 80.1170, last_update: new Date().toISOString(), speed_kmh: 40, status: "active", is_simulated: false, heading: 260 }
    ];

    sairamBuses.forEach(sb => {
      const existing = this.data.buses.find(b => b.id === sb.id);
      if (!existing) {
        this.data.buses.push(sb);
        changed = true;
      } else {
        if (!existing.capacity || existing.capacity !== 50 || !existing.route_id) {
          existing.capacity = 50;
          existing.route_id = sb.route_id;
          existing.driver_id = sb.driver_id;
          changed = true;
        }
      }
    });

    // Sairam College Stops for all 5 Routes
    const sairamStops = [
      // Route 1: Valasaravakkam – Porur – Kundrathur
      { id: "stop_1_1", route_id: "route_1", name: "Valasaravakkam", latitude: 13.0403, longitude: 80.1723, sequence_order: 1, pickup_time: "07:10 AM" },
      { id: "stop_1_2", route_id: "route_1", name: "Lakshmi Nagar, Porur", latitude: 13.0336, longitude: 80.1585, sequence_order: 2, pickup_time: "07:22 AM" },
      { id: "stop_1_3", route_id: "route_1", name: "Karampakkam", latitude: 13.0280, longitude: 80.1470, sequence_order: 3, pickup_time: "07:30 AM" },
      { id: "stop_1_4", route_id: "route_1", name: "Pannichery", latitude: 13.0180, longitude: 80.1250, sequence_order: 4, pickup_time: "07:38 AM" },
      { id: "stop_1_5", route_id: "route_1", name: "Kovur", latitude: 13.0080, longitude: 80.1110, sequence_order: 5, pickup_time: "07:45 AM" },
      { id: "stop_1_6", route_id: "route_1", name: "Kundrathur", latitude: 12.9976, longitude: 80.0964, sequence_order: 6, pickup_time: "07:55 AM" },
      { id: "stop_1_7", route_id: "route_1", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 7, pickup_time: "08:15 AM", is_campus: true },

      // Route 2: Kandigai – Rathnamangalam – Vandalur
      { id: "stop_2_1", route_id: "route_2", name: "Kandigai Police Quarters", latitude: 12.8720, longitude: 80.1410, sequence_order: 1, pickup_time: "07:15 AM" },
      { id: "stop_2_2", route_id: "route_2", name: "Kandigai", latitude: 12.8790, longitude: 80.1425, sequence_order: 2, pickup_time: "07:22 AM" },
      { id: "stop_2_3", route_id: "route_2", name: "Rathnamangalam", latitude: 12.8680, longitude: 80.1210, sequence_order: 3, pickup_time: "07:32 AM" },
      { id: "stop_2_4", route_id: "route_2", name: "Kolapakkam", latitude: 12.8850, longitude: 80.0980, sequence_order: 4, pickup_time: "07:42 AM" },
      { id: "stop_2_5", route_id: "route_2", name: "Vandalur Zoo", latitude: 12.8800, longitude: 80.0815, sequence_order: 5, pickup_time: "07:52 AM" },
      { id: "stop_2_6", route_id: "route_2", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 6, pickup_time: "08:15 AM", is_campus: true },

      // Route 3: Pammal – Pozhichallur – Thiruneermalai
      { id: "stop_3_1", route_id: "route_3", name: "Pammal", latitude: 12.9720, longitude: 80.1380, sequence_order: 1, pickup_time: "07:20 AM" },
      { id: "stop_3_2", route_id: "route_3", name: "Pozhichallur", latitude: 12.9810, longitude: 80.1430, sequence_order: 2, pickup_time: "07:30 AM" },
      { id: "stop_3_3", route_id: "route_3", name: "Nagalkeni", latitude: 12.9620, longitude: 80.1310, sequence_order: 3, pickup_time: "07:40 AM" },
      { id: "stop_3_4", route_id: "route_3", name: "Thiruneermalai", latitude: 12.9570, longitude: 80.1150, sequence_order: 4, pickup_time: "07:50 AM" },
      { id: "stop_3_5", route_id: "route_3", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, pickup_time: "08:15 AM", is_campus: true },

      // Route 4: Mappedu – Thiruvancherry
      { id: "stop_4_1", route_id: "route_4", name: "Mappedu", latitude: 12.8710, longitude: 80.1480, sequence_order: 1, pickup_time: "07:15 AM" },
      { id: "stop_4_2", route_id: "route_4", name: "Thiruvancherry", latitude: 12.8860, longitude: 80.1400, sequence_order: 2, pickup_time: "07:25 AM" },
      { id: "stop_4_3", route_id: "route_4", name: "Lakshmi Ammal College area", latitude: 12.9020, longitude: 80.1310, sequence_order: 3, pickup_time: "07:35 AM" },
      { id: "stop_4_4", route_id: "route_4", name: "Bharath Engineering College area", latitude: 12.9150, longitude: 80.1250, sequence_order: 4, pickup_time: "07:45 AM" },
      { id: "stop_4_5", route_id: "route_4", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, pickup_time: "08:15 AM", is_campus: true },

      // Route 5: Tambaram – Perungalathur – College
      { id: "stop_5_1", route_id: "route_5", name: "Tambaram Railway Station area", latitude: 12.9255, longitude: 80.1170, sequence_order: 1, pickup_time: "07:25 AM" },
      { id: "stop_5_2", route_id: "route_5", name: "Tambaram", latitude: 12.9249, longitude: 80.1000, sequence_order: 2, pickup_time: "07:35 AM" },
      { id: "stop_5_3", route_id: "route_5", name: "Perungalathur", latitude: 12.9050, longitude: 80.0880, sequence_order: 3, pickup_time: "07:45 AM" },
      { id: "stop_5_4", route_id: "route_5", name: "Vandalur", latitude: 12.8910, longitude: 80.0810, sequence_order: 4, pickup_time: "07:55 AM" },
      { id: "stop_5_5", route_id: "route_5", name: `${config.CAMPUS.name} Main Gate`, latitude: config.CAMPUS.latitude, longitude: config.CAMPUS.longitude, sequence_order: 5, pickup_time: "08:15 AM", is_campus: true }
    ];

    sairamStops.forEach(ss => {
      const existing = this.data.stops.find(s => s.id === ss.id);
      if (!existing) {
        this.data.stops.push(ss);
        changed = true;
      } else {
        if (existing.name !== ss.name || existing.pickup_time !== ss.pickup_time) {
          existing.name = ss.name;
          existing.pickup_time = ss.pickup_time;
          existing.latitude = ss.latitude;
          existing.longitude = ss.longitude;
          existing.sequence_order = ss.sequence_order;
          changed = true;
        }
      }
    });

    return changed;
  }

  migrateToVerifiedCampusData() {
    return this.migrateToSairamFiveRoutes();
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
    if (!user.id) user.id = `usr_${Date.now()}`;
    if (!user.status) user.status = 'active';
    if (user.must_change_password === undefined) user.must_change_password = false;
    if (!user.created_at) user.created_at = new Date().toISOString();
    this.data.users.push(user);
    this.save();
    return user;
  }

  getEnrichedUsers(filters = {}) {
    let users = this.data.users || [];

    if (filters.role && filters.role !== 'all') {
      users = users.filter(u => u.role === filters.role);
    }
    if (filters.status && filters.status !== 'all') {
      users = users.filter(u => (u.status || 'active') === filters.status);
    }
    if (filters.department && filters.department !== 'all') {
      users = users.filter(u => {
        const st = this.data.students.find(s => s.user_id === u.id);
        return st && (st.department || '').toUpperCase() === filters.department.toUpperCase();
      });
    }
    if (filters.academic_year && filters.academic_year !== 'all') {
      users = users.filter(u => {
        const st = this.data.students.find(s => s.user_id === u.id);
        return st && (String(st.year) === String(filters.academic_year) || (st.class_grade || '').includes(String(filters.academic_year)));
      });
    }
    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      users = users.filter(u => {
        const st = this.data.students.find(s => s.user_id === u.id);
        const nameMatch = (u.name || '').toLowerCase().includes(q);
        const emailMatch = (u.email || '').toLowerCase().includes(q);
        const idMatch = (u.id || '').toLowerCase().includes(q);
        const studentIdMatch = st && (st.student_id || '').toLowerCase().includes(q);
        const deptMatch = st && (st.department || '').toLowerCase().includes(q);
        const roleMatch = (u.role || '').toLowerCase().includes(q);
        return nameMatch || emailMatch || idMatch || studentIdMatch || deptMatch || roleMatch;
      });
    }

    return users.map(u => {
      const student = this.data.students.find(s => s.user_id === u.id);
      const driverBus = this.data.buses.find(b => b.driver_id === u.id);
      let route = null;
      let stop = null;
      let bus = null;

      if (student) {
        route = this.data.routes.find(r => r.id === student.route_id);
        stop = this.data.stops.find(st => st.id === student.boarding_stop_id);
        bus = this.data.buses.find(b => b.id === student.bus_id || b.route_id === student.route_id);
      } else if (driverBus) {
        bus = driverBus;
        route = this.data.routes.find(r => r.id === driverBus.route_id);
      }

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        status: u.status || 'active',
        must_change_password: !!u.must_change_password,
        created_at: u.created_at,
        last_login_at: u.last_login_at || null,
        // Student-specific fields
        student_id: student ? (student.student_id || 'ST001') : null,
        department: student ? student.department : null,
        year: student ? student.year : null,
        class_grade: student ? (student.class_grade || formatAcademicYear(student.year)) : null,
        route_id: student ? student.route_id : (route ? route.id : null),
        routeName: route ? route.name : null,
        boarding_stop_id: student ? student.boarding_stop_id : null,
        stopName: stop ? stop.name : null,
        bus_id: bus ? bus.id : null,
        busNumber: bus ? bus.bus_number : null,
        rfid_tag: student ? student.rfid_tag : null
      };
    });
  }

  updateUser(id, updates = {}) {
    const user = this.findUserById(id);
    if (!user) return null;
    if (updates.name !== undefined) user.name = updates.name;
    if (updates.email !== undefined) user.email = updates.email;
    if (updates.phone !== undefined) user.phone = updates.phone;
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.status !== undefined) user.status = updates.status;
    if (updates.must_change_password !== undefined) user.must_change_password = updates.must_change_password;
    if (updates.last_login_at !== undefined) user.last_login_at = updates.last_login_at;
    if (updates.password_hash !== undefined) user.password_hash = updates.password_hash;
    this.save();
    return user;
  }

  setUserStatus(id, status) {
    const user = this.findUserById(id);
    if (!user) return null;
    user.status = status === 'inactive' ? 'inactive' : 'active';
    this.save();
    return user;
  }

  resetUserPassword(id, plainTempPass) {
    const user = this.findUserById(id);
    if (!user) return null;
    user.password_hash = bcrypt.hashSync(plainTempPass, 10);
    user.must_change_password = true;
    this.save();
    return user;
  }

  deleteUser(id) {
    const user = this.findUserById(id);
    if (!user) return false;
    this.data.users = this.data.users.filter(u => u.id !== id);
    this.data.students = this.data.students.filter(s => s.user_id !== id);
    this.data.parents = this.data.parents.filter(p => p.user_id !== id);
    this.data.parent_student = this.data.parent_student.filter(ps => ps.parent_id !== id && ps.student_id !== id);
    this.data.buses.forEach(b => {
      if (b.driver_id === id) b.driver_id = null;
    });
    this.save();
    return true;
  }

  // --- ROUTE & STOP MANAGEMENT (MODULES 3 & 4) ---
  findRouteById(id) {
    return (this.data.routes || []).find(r => r.id === id);
  }

  insertRoute(route) {
    if (!route.id) route.id = `route_${Date.now()}`;
    if (!route.status) route.status = 'active';
    if (!route.verification_status) route.verification_status = 'DEMO – PENDING TRANSPORT OFFICE VERIFICATION';
    this.data.routes.push(route);
    this.save();
    return route;
  }

  updateRoute(id, updates = {}) {
    const route = this.findRouteById(id);
    if (!route) return null;
    if (updates.route_number !== undefined) route.route_number = updates.route_number;
    if (updates.name !== undefined) route.name = updates.name;
    if (updates.start_location !== undefined) route.start_location = updates.start_location;
    if (updates.destination !== undefined) route.destination = updates.destination;
    if (updates.description !== undefined) route.description = updates.description;
    if (updates.status !== undefined) route.status = updates.status;
    if (updates.verification_status !== undefined) route.verification_status = updates.verification_status;
    if (updates.bus_id !== undefined) route.bus_id = updates.bus_id;
    if (updates.driver_id !== undefined) route.driver_id = updates.driver_id;
    this.save();
    return route;
  }

  deleteRoute(id) {
    const idx = this.data.routes.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.data.routes.splice(idx, 1);
    this.data.stops = this.data.stops.filter(s => s.route_id !== id);
    this.data.students.forEach(st => {
      if (st.route_id === id) {
        st.route_id = null;
        st.boarding_stop_id = null;
        st.bus_id = null;
      }
    });
    this.data.buses.forEach(b => {
      if (b.route_id === id) b.route_id = null;
    });
    this.save();
    return true;
  }

  findStopById(id) {
    return (this.data.stops || []).find(s => s.id === id);
  }

  insertStop(stop) {
    if (!stop.id) stop.id = `stop_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    this.data.stops.push(stop);
    this.save();
    return stop;
  }

  updateStop(id, updates = {}) {
    const stop = this.findStopById(id);
    if (!stop) return null;
    if (updates.name !== undefined) stop.name = updates.name;
    if (updates.latitude !== undefined) stop.latitude = parseFloat(updates.latitude);
    if (updates.longitude !== undefined) stop.longitude = parseFloat(updates.longitude);
    if (updates.sequence_order !== undefined) stop.sequence_order = parseInt(updates.sequence_order, 10);
    if (updates.pickup_time !== undefined) stop.pickup_time = updates.pickup_time;
    if (updates.is_campus !== undefined) stop.is_campus = updates.is_campus;
    this.save();
    return stop;
  }

  deleteStop(id) {
    const idx = this.data.stops.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this.data.stops.splice(idx, 1);
    this.data.students.forEach(st => {
      if (st.boarding_stop_id === id) st.boarding_stop_id = null;
    });
    this.save();
    return true;
  }

  // --- BUS & ASSIGNMENT MANAGEMENT (MODULE 8) ---
  findBusById(id) {
    return (this.data.buses || []).find(b => b.id === id);
  }

  updateBus(id, updates = {}) {
    const bus = this.findBusById(id);
    if (!bus) return null;
    if (updates.bus_number !== undefined) bus.bus_number = updates.bus_number;
    if (updates.capacity !== undefined) bus.capacity = parseInt(updates.capacity, 10);
    if (updates.driver_id !== undefined) bus.driver_id = updates.driver_id;
    if (updates.route_id !== undefined) bus.route_id = updates.route_id;
    if (updates.status !== undefined) bus.status = updates.status;
    this.save();
    return bus;
  }

  getRouteStudentCount(routeId) {
    return (this.data.students || []).filter(s => s.route_id === routeId).length;
  }

  getBusStudentCount(busId) {
    const bus = this.findBusById(busId);
    if (!bus) return 0;
    return (this.data.students || []).filter(s => s.bus_id === busId || (!s.bus_id && s.route_id === bus.route_id)).length;
  }

  assignStudent(userId, { route_id, boarding_stop_id, bus_id, department, year }) {
    let student = this.data.students.find(s => s.user_id === userId);
    if (!student) {
      student = {
        user_id: userId,
        student_id: `ST${Date.now().toString().slice(-4)}`,
        department: department || 'CSE',
        year: year ? parseAcademicYear(year) : 1,
        class_grade: formatAcademicYear(year ? parseAcademicYear(year) : 1),
        route_id: route_id || null,
        boarding_stop_id: boarding_stop_id || null,
        bus_id: bus_id || null,
        rfid_tag: `RFID_SEC_${Date.now().toString().slice(-4)}`
      };
      this.data.students.push(student);
    } else {
      if (route_id !== undefined) student.route_id = route_id;
      if (boarding_stop_id !== undefined) student.boarding_stop_id = boarding_stop_id;
      if (bus_id !== undefined) student.bus_id = bus_id;
      if (department) student.department = department;
      if (year) {
        student.year = parseAcademicYear(year);
        student.class_grade = formatAcademicYear(student.year);
      }
    }
    this.save();
    return student;
  }

  // --- COMPREHENSIVE DASHBOARD METRICS (MODULE 9) ---
  getAdminStats() {
    const students = this.data.students || [];
    const drivers = (this.data.users || []).filter(u => u.role === 'driver');
    const parents = (this.data.users || []).filter(u => u.role === 'parent');
    const buses = this.data.buses || [];
    const routes = this.data.routes || [];
    const activeRoutes = routes.filter(r => r.status === 'active');

    // Students by Academic Year
    const studentsByYear = {
      '1st Year': 0,
      '2nd Year': 0,
      '3rd Year': 0,
      '4th Year': 0
    };
    students.forEach(s => {
      const g = s.class_grade || formatAcademicYear(s.year);
      if (studentsByYear[g] !== undefined) {
        studentsByYear[g]++;
      } else {
        studentsByYear['1st Year']++;
      }
    });

    // Students by Department
    const studentsByDepartment = {};
    students.forEach(s => {
      const dept = s.department || 'General';
      studentsByDepartment[dept] = (studentsByDepartment[dept] || 0) + 1;
    });

    // Route-wise student count and bus capacity
    const routeWiseCounts = routes.map(r => {
      const assignedCount = students.filter(s => s.route_id === r.id).length;
      const bus = buses.find(b => b.id === r.bus_id || b.route_id === r.id);
      const cap = bus ? (bus.capacity || 50) : 50;
      return {
        route_id: r.id,
        route_number: r.route_number || r.id,
        route_name: r.name,
        status: r.status,
        verification_status: r.verification_status,
        student_count: assignedCount,
        bus_id: bus ? bus.id : null,
        bus_number: bus ? bus.bus_number : 'Unassigned',
        capacity: cap,
        occupancy_percent: Math.min(100, Math.round((assignedCount / cap) * 100))
      };
    });

    // Today's attendance summary
    const today = new Date().toISOString().split('T')[0];
    const todayAtt = (this.data.attendance || []).filter(a => a.date === today);
    const presentCount = todayAtt.filter(a => a.status === 1).length;

    return {
      totalStudents: students.length,
      totalDrivers: drivers.length,
      totalParents: parents.length,
      totalBuses: buses.length,
      totalRoutes: routes.length,
      activeRoutes: activeRoutes.length,
      studentsByYear,
      byAcademicYear: studentsByYear,
      studentsByDepartment,
      byDepartment: studentsByDepartment,
      studentsByDept: studentsByDepartment,
      routeWiseCounts,
      attendanceSummary: {
        total: todayAtt.length,
        present: presentCount,
        absent: Math.max(0, todayAtt.length - presentCount),
        rate: todayAtt.length > 0 ? Math.round((presentCount / todayAtt.length) * 100) : 0
      },
      uploadHistoryCount: (this.data.attendance_uploads || []).length
    };
  }

  insertStudent(student) {
    if (student.year && !student.class_grade) {
      student.class_grade = formatAcademicYear(student.year);
    }
    this.data.students.push(student);
    this.save();
    return student;
  }

  insertParent(parent) {
    this.data.parents.push(parent);
    this.save();
    return parent;
  }

  insertDriver(driver) {
    if (!this.data.drivers) this.data.drivers = [];
    this.data.drivers.push(driver);
    this.save();
    return driver;
  }

  linkParentStudent(parent_id, student_id) {
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
      student_id: student.student_id || 'ST001',
      department: student.department || 'General',
      year: student.year || 1,
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
      session: 'Full Day',
      status: 1, // Present
      source: 'RFID',
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
      const wasBulkUploaded = existingIdx !== -1 && this.data.attendance[existingIdx].attendance_upload_id;
      const record = {
        id: existingIdx !== -1 ? this.data.attendance[existingIdx].id : `att_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        student_id: r.student_id,
        date: r.date,
        session: r.session || (existingIdx !== -1 ? (this.data.attendance[existingIdx].session || 'Full Day') : 'Full Day'),
        status: parseInt(r.status, 10),
        source: 'MANUAL',
        marked_by: markedBy,
        timestamp: new Date().toISOString(),
        attendance_upload_id: existingIdx !== -1 ? this.data.attendance[existingIdx].attendance_upload_id : undefined,
        modified_after_upload: wasBulkUploaded ? true : false
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

  // --- EXCEL BULK ATTENDANCE & AUDIT MANAGEMENT METHODS ---

  findStudentByStudentId(studentId, nameHint = null) {
    if (!studentId) return null;
    const cleanId = String(studentId).trim().toUpperCase();
    const strippedId = cleanId.replace(/^DEMO-?/i, '');
    const cleanNameHint = nameHint ? String(nameHint).toLowerCase().replace(/[^a-z0-9]/g, '') : null;

    // Helper to get user's name
    const getUserName = (userId) => {
      const u = this.findUserById(userId);
      return u ? (u.name || '') : '';
    };

    // Find all matching student candidates in students array
    const candidates = this.data.students.filter(s => {
      const sId = (s.student_id || '').toUpperCase();
      const uId = (s.user_id || '').toUpperCase();
      const sStripped = sId.replace(/^DEMO-?/i, '');
      return sId === cleanId || 
             uId === cleanId || 
             sStripped === cleanId || 
             sId === strippedId || 
             sStripped === strippedId;
    });

    if (candidates.length === 0) return null;

    let chosen = null;

    // 1. If nameHint provided, prefer candidate whose name matches nameHint
    if (cleanNameHint) {
      chosen = candidates.find(c => {
        const cName = getUserName(c.user_id).toLowerCase().replace(/[^a-z0-9]/g, '');
        return cName === cleanNameHint || cName.includes(cleanNameHint) || cleanNameHint.includes(cName);
      });
    }

    // 2. Exact match on student_id
    if (!chosen) {
      chosen = candidates.find(s => (s.student_id || '').toUpperCase() === cleanId);
    }

    // 3. Exact match on user_id
    if (!chosen) {
      chosen = candidates.find(s => (s.user_id || '').toUpperCase() === cleanId);
    }

    // 4. If cleanId is unprefixed, prefer DEMO- prefixed match if available
    if (!chosen && !cleanId.startsWith('DEMO-')) {
      const pref = `DEMO-${cleanId}`;
      chosen = candidates.find(s => (s.student_id || '').toUpperCase() === pref);
    }

    // 5. Fallback to first candidate
    if (!chosen) {
      chosen = candidates[0];
    }

    const user = this.findUserById(chosen.user_id);
    return {
      ...chosen,
      name: user ? user.name : '',
      email: user ? user.email : '',
      phone: user ? user.phone : ''
    };
  }

  getAttendanceUploads() {
    return this.data.attendance_uploads || [];
  }

  getAttendanceUploadById(id) {
    return (this.data.attendance_uploads || []).find(u => u.id === id);
  }

  saveAttendanceUpload(upload) {
    if (!this.data.attendance_uploads) this.data.attendance_uploads = [];
    const idx = this.data.attendance_uploads.findIndex(u => u.id === upload.id);
    if (idx !== -1) {
      this.data.attendance_uploads[idx] = upload;
    } else {
      this.data.attendance_uploads.unshift(upload);
    }
    this.save();
    return upload;
  }

  getAttendanceAuditLog() {
    return this.data.attendance_audit_log || [];
  }

  insertAttendanceAudit(entry) {
    if (!this.data.attendance_audit_log) this.data.attendance_audit_log = [];
    this.data.attendance_audit_log.unshift(entry);
    if (this.data.attendance_audit_log.length > 2000) {
      this.data.attendance_audit_log.pop();
    }
    this.save();
    return entry;
  }

  markExcelBulkAttendance({ upload_id, date, session, records, admin_id, admin_name }) {
    if (!this.data.attendance) this.data.attendance = [];
    const createdRecords = [];

    records.forEach(rec => {
      const targetUserId = (rec.dbStudent && rec.dbStudent.userId) || rec.userId || rec.student_id;
      if (!targetUserId) return;

      // Check if student already has attendance for this date and session
      const existing = this.data.attendance.find(a => 
        a.student_id === targetUserId && 
        a.date === date && 
        (session === 'Full Day' || a.session === 'Full Day' || a.session === session)
      );

      // Prevent duplicate attendance records. Do not overwrite existing attendance.
      if (existing) {
        return;
      }

      const newRecord = {
        id: `att_${targetUserId}_bulk_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        student_id: targetUserId,
        student_code: rec.studentId,
        student_name: rec.studentName,
        department: rec.department,
        year: rec.year,
        date: date,
        session: session || 'Full Day',
        status: 1, // Present
        source: 'EXCEL_BULK_UPLOAD',
        attendance_upload_id: upload_id,
        marked_by: admin_name ? `${admin_name} (Excel Bulk Upload)` : `Admin ${admin_id} (Excel Bulk Upload)`,
        admin_id: admin_id,
        timestamp: new Date().toISOString(),
        modified_after_upload: false
      };

      this.data.attendance.push(newRecord);
      createdRecords.push(newRecord);
    });

    // Append to audit trail (never physically deleted)
    this.insertAttendanceAudit({
      id: `aud_bulk_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      event: 'UPLOAD_CONFIRMED',
      attendance_upload_id: upload_id,
      admin_id,
      admin_name,
      timestamp: new Date().toISOString(),
      details: {
        date,
        session,
        marked_present_count: createdRecords.length
      }
    });

    this.save();
    return createdRecords;
  }

  rollbackExcelUpload({ upload_id, admin_id, admin_name }) {
    if (!this.data.attendance_uploads) this.data.attendance_uploads = [];
    const upload = this.data.attendance_uploads.find(u => u.id === upload_id);
    if (!upload) {
      return { success: false, error: `Upload with ID '${upload_id}' not found` };
    }

    // Idempotency check: prevent repeated or concurrent rollback
    if (upload.status === 'UNDONE') {
      return { success: false, error: `Upload '${upload_id}' has already been undone (Idempotent rollback protection)` };
    }

    // Find all attendance records created by this specific upload ID
    const matchingRecords = this.data.attendance.filter(a => a.attendance_upload_id === upload_id);

    // Records that have been modified after upload require manual review
    const modifiedRecords = matchingRecords.filter(a => a.modified_after_upload === true);
    const unmodifiedRecords = matchingRecords.filter(a => a.modified_after_upload !== true);

    // Reverse ONLY records created by this particular Excel upload.
    // Preserve RFID scans (source: RFID), manual roll-calls (source: MANUAL), and other uploads.
    this.data.attendance = this.data.attendance.filter(a => {
      if (a.attendance_upload_id === upload_id) {
        if (a.modified_after_upload === true) {
          // Flag for manual review, unhook from upload_id so it is retained with audit note
          a.flagged_for_manual_review = true;
          a.review_note = `Retained during rollback of upload ${upload_id} due to subsequent modifications`;
          return true; // Keep for manual review
        }
        return false; // Safely reverse/delete record created by this upload
      }
      return true; // Keep all other records
    });

    upload.status = 'UNDONE';
    upload.rollback_info = {
      admin_id,
      admin_name: admin_name || admin_id,
      timestamp: new Date().toISOString(),
      reversed_count: unmodifiedRecords.length,
      manual_review_count: modifiedRecords.length,
      manual_review_students: modifiedRecords.map(r => r.student_id)
    };

    // Log Rollback event to Audit Log (Never physically deleted)
    this.insertAttendanceAudit({
      id: `aud_rb_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      event: 'UPLOAD_ROLLBACK',
      attendance_upload_id: upload_id,
      admin_id,
      admin_name: admin_name || admin_id,
      timestamp: new Date().toISOString(),
      details: {
        reversed_count: unmodifiedRecords.length,
        manual_review_count: modifiedRecords.length,
        filename: upload.filename,
        original_date: upload.attendance_date,
        original_session: upload.session
      }
    });

    this.save();

    return {
      success: true,
      upload,
      reversed_count: unmodifiedRecords.length,
      manual_review_count: modifiedRecords.length
    };
  }

  // ----------------------------------------------------
  // ACADEMIC YEAR UTILITIES (MODULE 2)
  // ----------------------------------------------------
  isSchoolGrade(val) {
    if (!val) return false;
    const str = String(val).toLowerCase();
    return str.includes('9th') || str.includes('10th') || str.includes('11th') || str.includes('12th') ||
           str.includes('9 th') || str.includes('10 th') || str.includes('11 th') || str.includes('12 th') ||
           str.includes('grade') || str.includes('standard') || str.includes('std');
  }

  parseAcademicYear(val) {
    if (val === null || val === undefined) return null;
    const s = String(val).trim().toLowerCase();
    if (s === '1' || s.includes('1st') || s.includes('first')) return 1;
    if (s === '2' || s.includes('2nd') || s.includes('second')) return 2;
    if (s === '3' || s.includes('3rd') || s.includes('third')) return 3;
    if (s === '4' || s.includes('4th') || s.includes('fourth')) return 4;
    return null;
  }

  formatAcademicYear(year) {
    const y = parseInt(year, 10);
    if (y === 1) return '1st Year';
    if (y === 2) return '2nd Year';
    if (y === 3) return '3rd Year';
    if (y === 4) return '4th Year';
    return `${year || 1}st Year`;
  }

  // ----------------------------------------------------
  // USER MANAGEMENT METHODS (MODULE 1)
  // ----------------------------------------------------
  getEnrichedUsers(filters = {}) {
    let users = this.getUsers();
    const students = this.getStudents();
    const parents = this.getParents();
    const parentStudent = this.data.parent_student || [];
    const routes = this.getRoutes();
    const stops = this.getStops();
    const buses = this.getBuses();

    let enriched = users.map(u => {
      let extra = {};
      if (u.role === 'student') {
        const s = students.find(st => st.user_id === u.id);
        const r = s ? routes.find(rt => rt.id === s.route_id) : null;
        const b = s ? buses.find(bus => bus.id === s.bus_id || bus.route_id === s.route_id) : null;
        const stp = s ? stops.find(st => st.id === s.boarding_stop_id) : null;
        extra = {
          student_id: s ? s.student_id : u.id,
          department: s ? s.department : 'CSE',
          year: s ? s.year : 1,
          academic_year_display: this.formatAcademicYear(s ? s.year : 1),
          class_grade: this.formatAcademicYear(s ? s.year : 1),
          route_id: s ? s.route_id : null,
          routeName: r ? r.name : 'Unassigned',
          bus_id: b ? b.id : null,
          busNumber: b ? b.bus_number : 'Unassigned',
          boarding_stop_id: s ? s.boarding_stop_id : null,
          stopName: stp ? stp.name : 'Unassigned',
          rfid_tag: s ? s.rfid_tag : null
        };
      } else if (u.role === 'driver') {
        const b = buses.find(bus => bus.driver_id === u.id);
        const r = b ? routes.find(rt => rt.id === b.route_id) : null;
        extra = {
          bus_id: b ? b.id : null,
          busNumber: b ? b.bus_number : 'Unassigned',
          route_id: r ? r.id : null,
          routeName: r ? r.name : 'Unassigned',
          license_number: u.license_number || 'TN-09-Verified'
        };
      } else if (u.role === 'parent') {
        const link = parentStudent.find(ps => ps.parent_id === u.id);
        const linkedChild = link ? this.findUserById(link.student_id) : null;
        extra = {
          linked_student_id: link ? link.student_id : null,
          linked_student_name: linkedChild ? linkedChild.name : null
        };
      }

      return {
        ...u,
        status: u.status || 'active',
        must_change_password: !!u.must_change_password,
        last_login_at: u.last_login_at || null,
        ...extra
      };
    });

    if (filters.search) {
      const q = filters.search.toLowerCase();
      enriched = enriched.filter(u =>
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q)) ||
        (u.id && u.id.toLowerCase().includes(q)) ||
        (u.student_id && String(u.student_id).toLowerCase().includes(q)) ||
        (u.department && u.department.toLowerCase().includes(q))
      );
    }
    if (filters.role && filters.role !== 'all') {
      enriched = enriched.filter(u => u.role === filters.role);
    }
    if (filters.department && filters.department !== 'all') {
      enriched = enriched.filter(u => u.department && u.department.toUpperCase() === filters.department.toUpperCase());
    }
    if (filters.year && filters.year !== 'all') {
      enriched = enriched.filter(u => String(u.year) === String(filters.year));
    }
    if (filters.status && filters.status !== 'all') {
      enriched = enriched.filter(u => u.status === filters.status);
    }

    return enriched;
  }

  updateUser(id, updates = {}) {
    const user = this.findUserById(id);
    if (!user) return null;

    if (updates.name) user.name = updates.name;
    if (updates.email) user.email = updates.email;
    if (updates.phone) user.phone = updates.phone;
    if (updates.status) user.status = updates.status;

    if (user.role === 'student') {
      let student = this.data.students.find(s => s.user_id === id);
      if (student) {
        if (updates.department) student.department = updates.department;
        if (updates.year) {
          student.year = updates.year;
          student.class_grade = this.formatAcademicYear(updates.year);
        }
        if (updates.route_id) student.route_id = updates.route_id;
        if (updates.bus_id) student.bus_id = updates.bus_id;
        if (updates.boarding_stop_id) student.boarding_stop_id = updates.boarding_stop_id;
        if (updates.student_id) student.student_id = updates.student_id;
        if (updates.rfid_tag) student.rfid_tag = updates.rfid_tag;
      }
    } else if (user.role === 'driver') {
      if (!this.data.drivers) this.data.drivers = [];
      let driver = this.data.drivers.find(d => d.user_id === id);
      if (driver) {
        if (updates.license_number) driver.license_number = updates.license_number;
        if (updates.bus_id) driver.bus_id = updates.bus_id;
      }
      if (updates.bus_id) {
        this.updateBus(updates.bus_id, { driver_id: id });
      }
    } else if (user.role === 'parent') {
      if (updates.linked_student_id) {
        this.linkParentStudent(id, updates.linked_student_id);
      }
    }

    this.save();
    return user;
  }

  setUserStatus(id, status) {
    const user = this.findUserById(id);
    if (!user) return null;
    user.status = status;
    this.save();
    return user;
  }

  resetUserPassword(id, plainTempPass) {
    const user = this.findUserById(id);
    if (!user) return null;
    user.password_hash = this.hashPassword(plainTempPass);
    user.must_change_password = true;
    this.save();
    return user;
  }

  deleteUser(id) {
    this.data.users = this.data.users.filter(u => u.id !== id);
    this.data.students = this.data.students.filter(s => s.user_id !== id);
    this.data.parents = this.data.parents.filter(p => p.user_id !== id);
    if (this.data.drivers) this.data.drivers = this.data.drivers.filter(d => d.user_id !== id);
    if (this.data.parent_student) this.data.parent_student = this.data.parent_student.filter(ps => ps.student_id !== id && ps.parent_id !== id);
    this.save();
    return true;
  }

  // ----------------------------------------------------
  // ROUTE, BUS, STOP & ASSIGNMENT METHODS (MODULE 3, 4, 8)
  // ----------------------------------------------------
  findRouteById(id) {
    return this.getRoutes().find(r => r.id === id);
  }

  insertRoute(route) {
    this.data.routes.push(route);
    this.save();
    return route;
  }

  updateRoute(id, updates = {}) {
    const route = this.findRouteById(id);
    if (!route) return null;
    Object.assign(route, updates);
    this.save();
    return route;
  }

  deleteRoute(id) {
    this.data.routes = this.data.routes.filter(r => r.id !== id);
    this.data.stops = this.data.stops.filter(s => s.route_id !== id);
    this.save();
    return true;
  }

  findStopById(id) {
    return this.getStops().find(s => s.id === id);
  }

  insertStop(stop) {
    this.data.stops.push(stop);
    this.save();
    return stop;
  }

  updateStop(id, updates = {}) {
    const stop = this.findStopById(id);
    if (!stop) return null;
    Object.assign(stop, updates);
    this.save();
    return stop;
  }

  deleteStop(id) {
    this.data.stops = this.data.stops.filter(s => s.id !== id);
    this.save();
    return true;
  }

  findBusById(id) {
    return this.getBuses().find(b => b.id === id);
  }

  updateBus(id, updates = {}) {
    const bus = this.findBusById(id);
    if (!bus) return null;
    Object.assign(bus, updates);
    this.save();
    return bus;
  }

  getRouteStudentCount(routeId) {
    return this.getStudents().filter(s => s.route_id === routeId).length;
  }

  getBusStudentCount(busId) {
    const bus = this.findBusById(busId);
    if (!bus) return 0;
    return this.getStudents().filter(s => s.bus_id === busId || (bus.route_id && s.route_id === bus.route_id)).length;
  }

  assignStudent(userId, updates = {}) {
    const student = this.data.students.find(s => s.user_id === userId);
    if (!student) return null;
    if (updates.route_id) student.route_id = updates.route_id;
    if (updates.bus_id) student.bus_id = updates.bus_id;
    if (updates.boarding_stop_id) student.boarding_stop_id = updates.boarding_stop_id;
    this.save();
    return student;
  }

  logAudit(auditEntry) {
    if (!this.data.attendance_audit) this.data.attendance_audit = [];
    const entry = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      ...auditEntry
    };
    this.data.attendance_audit.push(entry);
    this.save();
    return entry;
  }

  getAdminStats() {
    const students = this.getStudents();
    const buses = this.getBuses();
    const routes = this.getRoutes();
    const users = this.getUsers();

    const studentsByYear = {
      '1st Year': 0,
      '2nd Year': 0,
      '3rd Year': 0,
      '4th Year': 0
    };

    const studentsByDept = {};

    students.forEach(s => {
      const yrName = this.formatAcademicYear(s.year || 1);
      if (studentsByYear[yrName] !== undefined) {
        studentsByYear[yrName]++;
      } else {
        studentsByYear['1st Year']++;
      }

      const dept = (s.department || 'CSE').toUpperCase();
      studentsByDept[dept] = (studentsByDept[dept] || 0) + 1;
    });

    const routeCapacityStats = routes.map(r => {
      const bus = buses.find(b => b.route_id === r.id);
      const cap = (bus && bus.capacity) || 50;
      const count = this.getRouteStudentCount(r.id);
      return {
        route_id: r.id,
        route_number: r.route_number || r.id,
        route_name: r.name,
        bus_number: bus ? bus.bus_number : 'Unassigned',
        capacity: cap,
        assigned_count: count,
        percent_full: Math.round((count / cap) * 100),
        status: count >= cap ? 'FULL' : 'AVAILABLE'
      };
    });

    return {
      totalStudents: students.length,
      totalDrivers: users.filter(u => u.role === 'driver').length,
      totalParents: users.filter(u => u.role === 'parent').length,
      totalBuses: buses.length,
      totalRoutes: routes.length,
      activeRoutes: routes.filter(r => r.status !== 'inactive').length,
      studentsByYear,
      studentsByDept,
      routeCapacityStats
    };
  }
}

module.exports = new MockDB();
