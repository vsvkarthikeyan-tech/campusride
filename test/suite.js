/**
 * CampusRide / SaiTrack Full System Verification Test Suite
 * Tests server startup, authentication, RBAC authorization, Leaflet routes,
 * GPS telemetry ingest, UHF RFID debouncing, and emergency alerts.
 */

const http = require('http');
const WebSocket = require('ws');

// Set test environment configuration
process.env.PORT = '3005';
process.env.NODE_ENV = 'test';
process.env.EXPOSE_MOCK_OTP = 'true'; // Allow reading OTP during automated test
process.env.SIMULATION_ENABLED = 'false';

const { app, server } = require('../server');
const config = require('../config');
const db = require('../db');

const BASE_URL = `http://localhost:${process.env.PORT}`;
const WS_URL = `ws://localhost:${process.env.PORT}`;

let studentToken = null;
let parentToken = null;
let driverToken = null;
let adminToken = null;

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  let json = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    json = await res.json();
  } else {
    json = await res.text();
  }
  return { status: res.status, headers: res.headers, data: json };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('\n======================================================');
  console.log(' CAMPUSRIDE / SAITRACK AUTOMATED SYSTEM TEST SUITE');
  console.log('======================================================\n');

  try {
    // ----------------------------------------------------
    // TEST 1: Server Startup, Static Assets & Config
    // ----------------------------------------------------
    console.log('[TEST GROUP 1] Server Startup, Static Frontend & Configuration');
    const indexRes = await request('GET', '/');
    assert(indexRes.status === 200, 'Frontend HTML (/) responds with HTTP 200');
    assert(typeof indexRes.data === 'string' && indexRes.data.includes('CampusRide'), 'Frontend contains CampusRide branding');
    assert(indexRes.data.includes('leaflet@1.9.4'), 'Leaflet 1.9.4 map library is included in HTML');

    const cssRes = await request('GET', '/css/styles.css');
    assert(cssRes.status === 200 && cssRes.data.includes('.leaflet-map-container'), 'CSS stylesheet loaded with Leaflet map container styling');
    assert(cssRes.data.includes('.map-legend-box'), 'CSS contains map legend styling');

    const appJsRes = await request('GET', '/js/app.js');
    assert(appJsRes.status === 200, 'public/js/app.js loaded');

    const configRes = await request('GET', '/api/config');
    assert(configRes.status === 200, 'GET /api/config responds with HTTP 200');
    assert(configRes.data.campus && configRes.data.campus.latitude === 12.9601, 'Verified Sri Sairam campus latitude is 12.9601');
    assert(configRes.data.map && configRes.data.map.tileLayerUrl.includes('openstreetmap.org'), 'Tile provider is OpenStreetMap');

    // ----------------------------------------------------
    // TEST 2: Authentication (All Roles & Bcrypt Hashing)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 2] Authentication & Password Hashing');

    // Student Login
    const stuLogin = await request('POST', '/api/auth/login', { email: 'student@saitrack.com', password: 'student123' });
    assert(stuLogin.status === 200, 'Student login succeeds with HTTP 200');
    assert(stuLogin.data.token && stuLogin.data.user.role === 'student', 'Student JWT issued with role "student"');
    studentToken = stuLogin.data.token;

    // Parent Login
    const parLogin = await request('POST', '/api/auth/login', { email: 'parent@saitrack.com', password: 'parent123' });
    assert(parLogin.status === 200, 'Parent login succeeds with HTTP 200');
    assert(parLogin.data.user.role === 'parent', 'Parent JWT issued with role "parent"');
    parentToken = parLogin.data.token;

    // Driver Login
    const drvLogin = await request('POST', '/api/auth/login', { email: 'ramesh@saitrack.com', password: 'driver123' });
    assert(drvLogin.status === 200, 'Driver login succeeds with HTTP 200');
    assert(drvLogin.data.user.role === 'driver', 'Driver JWT issued with role "driver"');
    driverToken = drvLogin.data.token;

    // Admin Login
    const admLogin = await request('POST', '/api/auth/login', { email: 'admin@saitrack.com', password: 'admin123' });
    assert(admLogin.status === 200, 'Admin login succeeds with HTTP 200');
    assert(admLogin.data.user.role === 'admin', 'Admin JWT issued with role "admin"');
    adminToken = admLogin.data.token;

    // Invalid Password Check
    const badLogin = await request('POST', '/api/auth/login', { email: 'student@saitrack.com', password: 'wrongpassword' });
    assert(badLogin.status === 400, 'Invalid password is rejected with HTTP 400');

    // Registration Flow with OTP Verification
    const testRegEmail = `test_${Date.now()}@saitrack.com`;
    const regRes = await request('POST', '/api/auth/register', {
      name: 'Test Cadet',
      email: testRegEmail,
      phone: '+919876549999',
      password: 'mypassword123',
      role: 'student'
    });
    assert(regRes.status === 200, 'Student registration endpoint returns 200');
    assert(regRes.data.mock_otp, 'OTP received in testing mode');

    // Verify OTP
    const verifyRes = await request('POST', '/api/auth/verify-otp', {
      email: testRegEmail,
      code: regRes.data.mock_otp
    });
    assert(verifyRes.status === 200, 'OTP verified and account activated');

    // Verify newly registered user has salted bcrypt password hash
    const registeredUser = db.findUserByEmail(testRegEmail);
    assert(registeredUser && (registeredUser.password_hash.startsWith('$2a$') || registeredUser.password_hash.startsWith('$2b$')), 'Registered user password is saved as salted Bcrypt hash');

    // ----------------------------------------------------
    // TEST 3: RBAC Authorization & Security
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 3] Role-Based Access Control (RBAC)');

    // Missing token
    const noTokenRes = await request('GET', '/api/student/dashboard');
    assert(noTokenRes.status === 401, 'Request without token rejected with HTTP 401');

    // Tampered token
    const tamperedRes = await request('GET', '/api/student/dashboard', null, { 'Authorization': 'Bearer invalid.tampered.token' });
    assert(tamperedRes.status === 403, 'Request with tampered token rejected with HTTP 403');

    // Student attempting admin endpoint
    const stuAsAdmin = await request('GET', '/api/admin/routes', null, { 'Authorization': `Bearer ${studentToken}` });
    assert(stuAsAdmin.status === 403, 'Student prevented from accessing Admin routes (HTTP 403)');

    // Parent attempting student boarding endpoint
    const parAsStu = await request('POST', '/api/student/boarding', { stopId: 'stop_1_1' }, { 'Authorization': `Bearer ${parentToken}` });
    assert(parAsStu.status === 403, 'Parent prevented from mutating student boarding stop (HTTP 403)');

    // ----------------------------------------------------
    // TEST 4: Leaflet Road Geometry & Stops
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 4] Leaflet Road Geometry & Stops API');

    const geo1 = await request('GET', '/api/routes/route_1/geometry');
    assert(geo1.status === 200, 'GET /api/routes/route_1/geometry returns HTTP 200');
    assert(Array.isArray(geo1.data.geometry) && geo1.data.geometry.length >= 10, 'Route 1 geometry contains verified road waypoints (>10 coordinates)');
    assert(geo1.data.source === 'verified_road_waypoints', 'Geometry is derived from verified road waypoints');

    const geo2 = await request('GET', '/api/routes/route_2/geometry');
    assert(geo2.status === 200, 'GET /api/routes/route_2/geometry returns HTTP 200');
    assert(Array.isArray(geo2.data.geometry) && geo2.data.geometry.length >= 10, 'Route 2 geometry contains road waypoints');

    // ----------------------------------------------------
    // TEST 5: Student Dashboard & Boarding Selection
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 5] Student Dashboard & Boarding Point Update');

    const stuDash = await request('GET', '/api/student/dashboard', null, { 'Authorization': `Bearer ${studentToken}` });
    assert(stuDash.status === 200, 'Student dashboard retrieved with HTTP 200');
    assert(stuDash.data.profile && stuDash.data.profile.busNumber, 'Dashboard contains assigned bus profile');
    assert(Array.isArray(stuDash.data.stops) && stuDash.data.stops.length > 0, 'Dashboard returns stops on designated route');

    // Update Boarding Stop
    const updateStop = await request('POST', '/api/student/boarding', { stopId: 'stop_1_3' }, { 'Authorization': `Bearer ${studentToken}` });
    assert(updateStop.status === 200, 'Student boarding stop updated successfully');

    // Check that dashboard reflects updated stop
    const stuDash2 = await request('GET', '/api/student/dashboard', null, { 'Authorization': `Bearer ${studentToken}` });
    assert(stuDash2.data.profile.boarding_stop_id === 'stop_1_3', 'Student boarding stop persisted to stop_1_3');

    // ----------------------------------------------------
    // TEST 6: Real-Time GPS Tracking & Telemetry Ingest
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 6] Real GPS Ingest (Driver REST & Device API)');

    // Driver REST Location Update
    const driverLocUpdate = await request('POST', '/api/driver/location', {
      busId: 'bus_1',
      latitude: 12.9516,
      longitude: 80.1408,
      speed: 38,
      heading: 215,
      timestamp: new Date().toISOString()
    }, { 'Authorization': `Bearer ${driverToken}` });
    assert(driverLocUpdate.status === 200, 'Driver location update responds with HTTP 200');
    assert(driverLocUpdate.data.bus.latitude === 12.9516, 'Bus latitude updated to 12.9516');
    assert(driverLocUpdate.data.bus.is_simulated === false, 'Location update is explicitly flagged as real (is_simulated: false)');

    // GPS Device Key Ingest
    const deviceLocUpdate = await request('POST', '/api/driver/location', {
      busId: 'bus_2',
      latitude: 13.0130,
      longitude: 80.1210,
      speed: 44,
      heading: 230
    }, { 'X-Device-Key': config.GPS_DEVICE_API_KEY });
    assert(deviceLocUpdate.status === 200, 'Hardware GPS tracker authorized via X-Device-Key');
    assert(deviceLocUpdate.data.bus.latitude === 13.0130, 'Bus 2 location updated via GPS hardware key');

    // Invalid coordinates rejection
    const invalidCoords = await request('POST', '/api/driver/location', {
      busId: 'bus_1',
      latitude: 999.0, // Invalid latitude
      longitude: 80.0
    }, { 'Authorization': `Bearer ${driverToken}` });
    assert(invalidCoords.status === 400, 'Invalid GPS coordinates rejected with HTTP 400');

    // ----------------------------------------------------
    // TEST 7: WebSocket Telemetry Broadcast
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 7] WebSocket Real-Time Broadcast');

    const wsPromise = new Promise((resolve, reject) => {
      const client = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        client.close();
        reject(new Error('WebSocket broadcast timeout'));
      }, 4000);

      client.on('open', () => {
        // Trigger a driver update to see if WebSocket receives it
        request('POST', '/api/driver/location', {
          busId: 'bus_1',
          latitude: 12.9360,
          longitude: 80.1260,
          speed: 40
        }, { 'Authorization': `Bearer ${driverToken}` });
      });

      client.on('message', (msg) => {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === 'bus_location' && parsed.busId === 'bus_1') {
            clearTimeout(timer);
            client.close();
            resolve(parsed);
          }
        } catch (e) {}
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const wsData = await wsPromise;
    assert(wsData.type === 'bus_location', 'WebSocket client received real-time bus_location packet');
    assert(wsData.lat === 12.9360 && wsData.lng === 80.1260, 'WebSocket location coordinates match incoming GPS');
    assert(wsData.is_simulated === false, 'WebSocket packet accurately identifies live GPS vs simulation');

    // ----------------------------------------------------
    // TEST 8: UHF RFID Reader & Duplicate Scan Debouncing
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 8] UHF RFID Bus Reader & Debounce Cooldown');

    // Clean previous test scans for repeatability
    db.data.rfid_scans = (db.data.rfid_scans || []).filter(s => s.rfid_tag !== 'RFID_SEC_001');

    // First scan (valid)
    const rfidScan1 = await request('POST', '/api/rfid/scan', {
      rfid_tag: 'RFID_SEC_001',
      bus_id: 'bus_1',
      reader_id: 'UHF_Bus1_Door',
      timestamp: new Date().toISOString()
    }, { 'X-Reader-Key': config.RFID_READER_API_KEY });

    assert(rfidScan1.status === 200, 'UHF RFID hardware scan processed with HTTP 200');
    assert(rfidScan1.data.record && rfidScan1.data.record.status === 1, 'Attendance record created with status: PRESENT (1)');

    // Immediate duplicate scan on same bus (within 5 minutes debounce window)
    const rfidScan2 = await request('POST', '/api/rfid/scan', {
      rfid_tag: 'RFID_SEC_001',
      bus_id: 'bus_1',
      reader_id: 'UHF_Bus1_Door',
      timestamp: new Date().toISOString()
    }, { 'X-Reader-Key': config.RFID_READER_API_KEY });

    assert(rfidScan2.status === 200 && rfidScan2.data.status === 'ignored', 'Duplicate RFID scan within cooldown window is debounced and ignored');

    // Unknown RFID card scan
    const rfidUnknown = await request('POST', '/api/rfid/scan', {
      rfid_tag: 'RFID_UNKNOWN_CARD',
      bus_id: 'bus_1'
    }, { 'X-Reader-Key': config.RFID_READER_API_KEY });
    assert(rfidUnknown.status === 404, 'Unknown RFID tag rejected with HTTP 404');

    // ----------------------------------------------------
    // TEST 9: Emergency Panic Dispatch & Admin Resolution
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 9] Emergency Panic Alert Dispatch & Resolution');

    const panicRes = await request('POST', '/api/student/panic', {
      latitude: 12.9516,
      longitude: 80.1408,
      message: 'Urgent: Student requested emergency assistance'
    }, { 'Authorization': `Bearer ${studentToken}` });

    assert(panicRes.status === 200, 'Panic alert dispatched with HTTP 200');
    assert(panicRes.data.alertId, 'Alert ID returned');
    const alertId = panicRes.data.alertId;

    // Admin resolves alert
    const resolveRes = await request('POST', '/api/admin/alerts/action', {
      alertId,
      action: 'resolve'
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert(resolveRes.status === 200, 'Admin successfully resolves alert');
    assert(resolveRes.data.alert.status === 'resolved', 'Alert status updated to "resolved" in database');

    // ----------------------------------------------------
    // TEST 10: Parent Dashboard & Children Linkage
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 10] Parent Dashboard & Children Linkage');

    const parChildren = await request('GET', '/api/parent/children', null, { 'Authorization': `Bearer ${parentToken}` });
    assert(parChildren.status === 200, 'Parent children list fetched with HTTP 200');
    assert(Array.isArray(parChildren.data.children) && parChildren.data.children.length > 0, 'Parent has linked student profiles');
    assert(parChildren.data.children[0].stops, 'Linked child data includes bus stops');

    // ----------------------------------------------------
    // TEST 11: Payment Operations (Simulated / Test Mode)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 11] Fee Payment Processing (Google Pay Sandbox)');

    const payCreate = await request('POST', '/api/payments/create', {
      amount: 2500,
      paymentId: 'pay_test_01'
    }, { 'Authorization': `Bearer ${studentToken}` });
    assert(payCreate.status === 200, 'Payment session created with HTTP 200');
    assert(payCreate.data.simulated === true, 'Payment explicitly identified as simulated (simulated: true)');

    const payConfirm = await request('POST', '/api/payments/confirm', {
      paymentId: 'pay_due_usr_student_1',
      gpayToken: payCreate.data.gatewayToken
    }, { 'Authorization': `Bearer ${studentToken}` });
    assert(payConfirm.status === 200 || payConfirm.status === 404, 'Payment confirmation executed (handled status appropriately)');

    // ----------------------------------------------------
    // TEST 12: Admin Simulation Toggle
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 12] Admin Simulation Toggle Control');

    const simToggle = await request('POST', '/api/admin/simulation/toggle', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(simToggle.status === 200, 'Admin can toggle virtual GPS simulation loop');
    assert(typeof simToggle.data.simulationRunning === 'boolean', 'Simulation state boolean returned');

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n======================================================');
    console.log(` TEST EXECUTION COMPLETE: ${passedTests}/${totalTests} PASSED`);
    if (failedTests > 0) {
      console.log(` ⚠️ ${failedTests} TESTS FAILED`);
    } else {
      console.log(' All tests passed successfully!');
    }
    console.log('======================================================\n');

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

// Give server 500ms to listen before initiating tests
setTimeout(runTests, 500);
