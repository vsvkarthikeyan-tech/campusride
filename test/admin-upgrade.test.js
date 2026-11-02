/**
 * test/admin-upgrade.test.js
 * Comprehensive Test Suite for CampusRide Admin Portal and Transport Management Upgrade
 * 
 * Tests:
 * 1. Centralized User Management (4 roles: Admin, Student, Driver, Parent)
 * 2. Academic Year Standardization (1st Year - 4th Year, strict rejection of 9th-12th school grades)
 * 3. Sairam Bus Routes (5 starter routes, DEMO verification status, stop CRUD)
 * 4. Bus & Student Assignment + Bus Capacity Limit Enforcement (HTTP 400 on overflow)
 * 5. Excel User Export
 * 6. Admin Statistics & Dashboard APIs
 */

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

let adminToken = null;
let testStudentId = null;
let testDriverId = null;
let testParentId = null;
let testAdminId = null;
let testRouteId = null;
let testBusId = null;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const contentType = res.headers['content-type'] || '';
        let json = null;
        if (contentType.includes('application/json')) {
          try {
            json = JSON.parse(buffer.toString());
          } catch (e) {
            json = null;
          }
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json || buffer.toString(),
          raw: buffer
        });
      });
    });

    req.on('error', reject);
    if (body) {
      if (typeof body === 'object' && !(body instanceof Buffer)) {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n======================================================');
  console.log(' CAMPUSRIDE ADMIN & TRANSPORT MANAGEMENT UPGRADE SUITE');
  console.log(' Sri Sairam Engineering College Transport Upgrade');
  console.log('======================================================\n');

  // 1. Admin Login
  console.log('[TEST GROUP 1] Administrator Authentication');
  const loginRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/auth/login',
    method: 'POST'
  }, {
    email: 'admin@saitrack.com',
    password: 'admin123'
  });

  assert(loginRes.statusCode === 200, 'Admin login succeeded with HTTP 200');
  assert(loginRes.body.token, 'Auth token received');
  assert(loginRes.body.user.role === 'admin', 'User has admin role');
  adminToken = loginRes.body.token;

  const authHeaders = {
    'Authorization': `Bearer ${adminToken}`
  };

  // 2. Academic Year Standardization
  console.log('\n[TEST GROUP 2] Academic Year Standardization & School Grade Rejection');
  
  const testSuffix = Date.now();

  // Rejection of 9th Standard
  const schoolGradeRes1 = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Invalid School Kid',
    email: `school9.${testSuffix}@sairam.edu.in`,
    role: 'student',
    department: 'CSE',
    year: '9th Standard'
  });
  assert(schoolGradeRes1.statusCode === 400, '9th Standard registration rejected with HTTP 400');
  assert(schoolGradeRes1.body.error && schoolGradeRes1.body.error.includes('1st') && schoolGradeRes1.body.error.includes('4th Year'), 'Error clearly enforces 1st Year - 4th Year engineering years');

  // Rejection of 10th Standard
  const schoolGradeRes2 = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Invalid School Kid 2',
    email: `school10.${testSuffix}@sairam.edu.in`,
    role: 'student',
    department: 'ECE',
    year: '10th Standard'
  });
  assert(schoolGradeRes2.statusCode === 400, '10th Standard registration rejected with HTTP 400');

  // Rejection of 12th Grade
  const schoolGradeRes3 = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Invalid School Kid 3',
    email: `school12.${testSuffix}@sairam.edu.in`,
    role: 'student',
    department: 'MECH',
    year: '12th Grade'
  });
  assert(schoolGradeRes3.statusCode === 400, '12th Grade registration rejected with HTTP 400');

  // 3. User Management CRUD (4 Roles)
  console.log('\n[TEST GROUP 3] Centralized User Management & Role Support');

  // Create Student
  const createStudentRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Gowtham Ramesh',
    email: `gowtham.${testSuffix}@sairam.edu.in`,
    role: 'student',
    department: 'AIDS',
    year: '3rd Year',
    phone: '9876543210'
  });
  assert(createStudentRes.statusCode === 201, 'Student account created with HTTP 201');
  assert(createStudentRes.body.user && createStudentRes.body.user.role === 'student', 'Created user has student role');
  assert(createStudentRes.body.user.year === '3rd Year', 'Academic year formatted as 3rd Year');
  assert(createStudentRes.body.user.academic_year === 3, 'Academic year stored as integer 3 in DB');
  assert(createStudentRes.body.tempPassword, 'Secure temporary password generated');
  assert(createStudentRes.body.tempPassword.length >= 10, 'Temporary password meets length requirements');
  testStudentId = createStudentRes.body.user.id;

  // Create Driver
  const createDriverRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Murugan K',
    email: `murugan.${testSuffix}@sairam.edu.in`,
    role: 'driver',
    phone: '9840123456',
    licenseNumber: 'TN-05-2018-0098765'
  });
  assert(createDriverRes.statusCode === 201, 'Driver account created with HTTP 201');
  assert(createDriverRes.body.user.role === 'driver', 'Created user has driver role');
  assert(createDriverRes.body.user.licenseNumber === 'TN-05-2018-0098765', 'Driver license number preserved');
  testDriverId = createDriverRes.body.user.id;

  // Create Parent
  const createParentRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Ramesh Sundaram (Parent)',
    email: `ramesh.${testSuffix}@sairam.edu.in`,
    role: 'parent',
    phone: '9840998877',
    linkedStudentId: testStudentId
  });
  assert(createParentRes.statusCode === 201, 'Parent account created with HTTP 201');
  assert(createParentRes.body.user.role === 'parent', 'Created user has parent role');
  assert(createParentRes.body.user.linkedStudentId === testStudentId, 'Parent linked to student ID');
  testParentId = createParentRes.body.user.id;

  // Create Sub-Admin
  const createAdminRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Prof. Anitha Transport Officer',
    email: `anitha.${testSuffix}@sairam.edu.in`,
    role: 'admin',
    phone: '9444001122'
  });
  assert(createAdminRes.statusCode === 201, 'Admin account created with HTTP 201');
  assert(createAdminRes.body.user.role === 'admin', 'Created user has admin role');
  testAdminId = createAdminRes.body.user.id;

  // Search and Filter Users
  console.log('\n[TEST GROUP 4] User Search, Filter & Status Toggle');
  const searchRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users?search=Gowtham&role=student&year=3',
    method: 'GET',
    headers: authHeaders
  });
  assert(searchRes.statusCode === 200, 'User search API returns HTTP 200');
  assert(Array.isArray(searchRes.body.users), 'Users array returned');
  assert(searchRes.body.users.length >= 1, 'Search query found matching user');
  assert(searchRes.body.users[0].name.includes('Gowtham'), 'Matched Gowtham Ramesh');

  // Deactivate User
  const deactivateRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/users/${testStudentId}/status`,
    method: 'PATCH',
    headers: authHeaders
  }, { status: 'inactive' });
  assert(deactivateRes.statusCode === 200, 'User deactivated successfully');
  assert(deactivateRes.body.user.status === 'inactive', 'User status is inactive');

  // Reactivate User
  const reactivateRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/users/${testStudentId}/status`,
    method: 'PATCH',
    headers: authHeaders
  }, { status: 'active' });
  assert(reactivateRes.statusCode === 200, 'User reactivated successfully');
  assert(reactivateRes.body.user.status === 'active', 'User status is active');

  // Admin Reset Password
  const resetPassRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/users/${testStudentId}/reset-password`,
    method: 'POST',
    headers: authHeaders
  });
  assert(resetPassRes.statusCode === 200, 'Admin reset password succeeded');
  assert(resetPassRes.body.tempPassword, 'New single-use temporary password returned');
  assert(resetPassRes.body.user.mustChangePassword === true, 'mustChangePassword flag enabled for security');

  // Export Users to Excel
  console.log('\n[TEST GROUP 5] Excel User Details Export');
  const exportUsersRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users/export-excel',
    method: 'GET',
    headers: authHeaders
  });
  assert(exportUsersRes.statusCode === 200, 'Export users returns HTTP 200');
  assert(exportUsersRes.headers['content-type'].includes('spreadsheetml'), 'Content-Type is Excel spreadsheet');
  assert(exportUsersRes.raw.length > 1000, 'Excel file binary payload is non-empty');

  // 4. Sri Sairam Engineering College Starter Routes
  console.log('\n[TEST GROUP 6] Sri Sairam Engineering College Starter Routes (5 Routes)');
  const routesRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/routes',
    method: 'GET',
    headers: authHeaders
  });
  assert(routesRes.statusCode === 200, 'GET /api/admin/routes returns HTTP 200');
  const routesList = Array.isArray(routesRes.body) ? routesRes.body : (routesRes.body.routes || []);
  assert(Array.isArray(routesList), 'Routes array returned');
  assert(routesList.length >= 5, 'At least 5 initial routes present');

  // Check 5 starter routes
  const starterIds = ['route_1', 'route_2', 'route_3', 'route_4', 'route_5'];
  starterIds.forEach(id => {
    const r = routesList.find(route => route.id === id);
    assert(!!r, `Route ${id} exists in database`);
    if (r) {
      assert(r.verification_status === 'DEMO – PENDING TRANSPORT OFFICE VERIFICATION', `${id} is marked DEMO – PENDING TRANSPORT OFFICE VERIFICATION`);
      assert(r.destination.includes('Sri Sairam Engineering College'), `${id} destination is Sri Sairam Engineering College`);
      assert(Array.isArray(r.stops) && r.stops.length >= 4, `${id} contains ordered stops`);
    }
  });

  // Create New Route
  const createRouteRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/routes',
    method: 'POST',
    headers: authHeaders
  }, {
    route_number: `R-TEST-${Date.now().toString().slice(-4)}`,
    route_name: 'Guindy – Alandur – College',
    start_location: 'Guindy Metro Station',
    destination: 'Sri Sairam Engineering College',
    status: 'active'
  });
  assert(createRouteRes.statusCode === 201, 'New route created with HTTP 201');
  assert(createRouteRes.body.route && createRouteRes.body.route.id, 'New route ID returned');
  testRouteId = createRouteRes.body.route.id;

  // Add Stop to New Route
  const addStopRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/routes/${testRouteId}/stops`,
    method: 'POST',
    headers: authHeaders
  }, {
    stop_name: 'Guindy Race Course Junction',
    stop_sequence: 1,
    coordinates: [13.0067, 80.2206],
    pickup_time: '07:05 AM'
  });
  assert(addStopRes.statusCode === 201, 'Stop added with HTTP 201');
  assert(addStopRes.body.stop && (addStopRes.body.stop.name === 'Guindy Race Course Junction' || addStopRes.body.stop.stop_name === 'Guindy Race Course Junction'), 'Stop name verified');
  const stopId = addStopRes.body.stop.id;

  // Edit Stop
  const editStopRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/stops/${stopId}`,
    method: 'PUT',
    headers: authHeaders
  }, {
    pickup_time: '07:10 AM'
  });
  assert(editStopRes.statusCode === 200, 'Stop updated with HTTP 200');
  assert(editStopRes.body.stop.pickup_time === '07:10 AM', 'Stop pickup time updated');

  // 5. Bus & Student Assignments + Capacity Enforcement
  console.log('\n[TEST GROUP 7] Bus & Student Assignments & Capacity Limit Enforcement');

  const assignmentsRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/assignments',
    method: 'GET',
    headers: authHeaders
  });
  assert(assignmentsRes.statusCode === 200, 'GET /api/admin/assignments returns HTTP 200');
  assert(Array.isArray(assignmentsRes.body.buses), 'Buses list returned');

  // Assign Route to Bus
  const bus = assignmentsRes.body.buses[0];
  testBusId = bus.id;
  const assignBusRouteRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/assignments/bus-route',
    method: 'POST',
    headers: authHeaders
  }, {
    busId: testBusId,
    routeId: 'route_1'
  });
  assert(assignBusRouteRes.statusCode === 200, 'Bus assigned to route_1 successfully');

  // Assign Student to Bus & Route
  const assignStudentRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/assignments/student',
    method: 'POST',
    headers: authHeaders
  }, {
    userId: testStudentId,
    busId: testBusId,
    routeId: 'route_1',
    boarding_stop_id: 'stop_1_1'
  });
  assert(assignStudentRes.statusCode === 200, 'Student assigned to bus and route');

  // Test Bus Capacity Limit Enforcement (Module 8)
  const targetBus = assignmentsRes.body.buses[0];
  const originalCapacity = targetBus.capacity || 50;
  const currentAssigned = targetBus.assigned_students || 0;

  // Dynamically set bus capacity to its current assigned count (making it 100% full)
  const updateCapRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/buses/${targetBus.id}`,
    method: 'PUT',
    headers: authHeaders
  }, { capacity: currentAssigned });
  assert(updateCapRes.statusCode === 200, 'Bus capacity updated via API');

  // Create another student to test overflow
  const student2Res = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/users',
    method: 'POST',
    headers: authHeaders
  }, {
    name: 'Overflow Student Test',
    email: `overflow.${testSuffix}@sairam.edu.in`,
    role: 'student',
    department: 'CSE',
    year: '4th Year'
  });
  const student2Id = student2Res.body.user.id;

  // Attempt to assign a new student to this 100% full bus (MUST FAIL with HTTP 400)
  const overflowRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/assignments/student',
    method: 'POST',
    headers: authHeaders
  }, {
    userId: student2Id,
    busId: targetBus.id,
    routeId: targetBus.route_id || 'route_1'
  });
  assert(overflowRes.statusCode === 400, 'Over-capacity student assignment blocked with HTTP 400');
  assert(overflowRes.body.error && overflowRes.body.error.toLowerCase().includes('capacity'), 'Error message identifies bus capacity limit');

  // Restore original bus capacity
  await request({
    hostname: 'localhost',
    port: PORT,
    path: `/api/admin/buses/${targetBus.id}`,
    method: 'PUT',
    headers: authHeaders
  }, { capacity: originalCapacity });

  // 6. Admin Statistics & Dashboard Analytics
  console.log('\n[TEST GROUP 8] Admin Dashboard Real Statistics & Metrics');
  const statsRes = await request({
    hostname: 'localhost',
    port: PORT,
    path: '/api/admin/stats',
    method: 'GET',
    headers: authHeaders
  });
  assert(statsRes.statusCode === 200, 'GET /api/admin/stats returns HTTP 200');
  assert(statsRes.body.totalStudents >= 25, 'Total students accurately counted from DB');
  assert(statsRes.body.totalDrivers >= 5, 'Total drivers accurately counted from DB');
  assert(statsRes.body.totalParents >= 2, 'Total parents accurately counted from DB');
  assert(statsRes.body.totalBuses >= 5, 'Total buses accurately counted from DB');
  assert(statsRes.body.totalRoutes >= 5, 'Total routes accurately counted from DB');
  assert(typeof statsRes.body.byAcademicYear === 'object', 'Breakdown by academic year provided');
  assert(statsRes.body.byAcademicYear['1st Year'] !== undefined, '1st Year count present');
  assert(statsRes.body.byAcademicYear['2nd Year'] !== undefined, '2nd Year count present');
  assert(statsRes.body.byAcademicYear['3rd Year'] !== undefined, '3rd Year count present');
  assert(statsRes.body.byAcademicYear['4th Year'] !== undefined, '4th Year count present');

  console.log('\n======================================================');
  console.log(` UPGRADE TEST SUMMARY: ${passed}/${passed + failed} PASSED`);
  if (failed === 0) {
    console.log(' ALL ADMIN PORTAL & TRANSPORT UPGRADE TESTS PASSED!');
  } else {
    console.error(` ${failed} TESTS FAILED.`);
  }
  console.log('======================================================\n');

  // Clean up test entities
  if (testRouteId) {
    await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/routes/${testRouteId}`,
      method: 'DELETE',
      headers: authHeaders
    });
  }
  if (testStudentId) {
    await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/users/${testStudentId}`,
      method: 'DELETE',
      headers: authHeaders
    });
  }
  if (student2Id) {
    await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/users/${student2Id}`,
      method: 'DELETE',
      headers: authHeaders
    });
  }
  if (testDriverId) {
    await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/users/${testDriverId}`,
      method: 'DELETE',
      headers: authHeaders
    });
  }
  if (testParentId) {
    await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/users/${testParentId}`,
      method: 'DELETE',
      headers: authHeaders
    });
  }
  if (testAdminId) {
    await request({
      hostname: 'localhost',
      port: PORT,
      path: `/api/admin/users/${testAdminId}`,
      method: 'DELETE',
      headers: authHeaders
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
