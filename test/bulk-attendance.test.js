/**
 * CampusRide - Excel Bulk Attendance Management System Test Suite
 * Automated tests for Module 1 through Module 9:
 * - Excel template download
 * - Valid Excel parsing and validation preview
 * - Unknown Student IDs handling
 * - Duplicate Student IDs handling
 * - Missing and invalid values
 * - Empty / corrupted file rejection
 * - Already marked present collision detection
 * - Confirm and mark attendance
 * - Attendance reflection in Admin, Student, and Parent views
 * - Attendance source EXCEL_BULK_UPLOAD and upload ID tagging
 * - Reliable idempotent undo / rollback
 * - Selective rollback (multiple uploads, undo only one)
 * - Preservation of RFID, manual, and pre-existing attendance
 * - Role-based authorization security checks
 * - Formatted Excel report downloads
 * - Database persistence across reloads
 */

const http = require('http');
const ExcelJS = require('exceljs');

process.env.PORT = '3006';
process.env.NODE_ENV = 'test';
process.env.SIMULATION_ENABLED = 'false';

const { app, server } = require('../server');
const config = require('../config');
const db = require('../db');

const BASE_URL = `http://localhost:${process.env.PORT}`;

let adminToken = null;
let studentToken = null;
let parentToken = null;

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
    headers: { ...headers }
  };

  if (body) {
    if (body instanceof Buffer) {
      options.body = body;
    } else if (typeof body === 'object') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    } else {
      options.body = body;
    }
  }

  const res = await fetch(url, options);
  let json = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    json = await res.json();
  } else if (contentType.includes('spreadsheetml') || contentType.includes('octet-stream')) {
    json = Buffer.from(await res.arrayBuffer());
  } else {
    json = await res.text();
  }
  return { status: res.status, headers: res.headers, data: json };
}

// Helper to create an in-memory Excel buffer with rows
async function createTestExcelBuffer(rows, sheetName = 'Sheet1', headers = ['Student ID', 'Student Name', 'Department', 'Year']) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  rows.forEach(r => sheet.addRow(r));
  return await workbook.xlsx.writeBuffer();
}

// Helper to upload Excel file via multipart/form-data using native fetch & boundary
async function uploadExcelRequest(buffer, filename, fields = {}, token = null) {
  const boundary = `----WebKitFormBoundary${Math.random().toString(36).substr(2)}`;
  const chunks = [];

  // Add fields
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  // Add file
  if (buffer) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`));
    chunks.push(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const fullBody = Buffer.concat(chunks);

  const headers = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': fullBody.length
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return await request('POST', '/api/admin/bulk-attendance/preview', fullBody, headers);
}

async function runBulkAttendanceTests() {
  console.log('\n======================================================');
  console.log(' CAMPUSRIDE EXCEL BULK ATTENDANCE VERIFICATION SUITE');
  console.log('======================================================\n');

  try {
    // ----------------------------------------------------
    // 1. Authenticate tokens
    // ----------------------------------------------------
    console.log('[TEST GROUP 1] Administrator & User Authentication');
    const adminLogin = await request('POST', '/api/auth/login', {
      email: 'admin@saitrack.com',
      password: 'admin123'
    });
    assert(adminLogin.status === 200, 'Admin login succeeded');
    adminToken = adminLogin.data.token;

    const studentLogin = await request('POST', '/api/auth/login', {
      email: 'student@saitrack.com',
      password: 'student123'
    });
    assert(studentLogin.status === 200, 'Student login succeeded');
    studentToken = studentLogin.data.token;

    const parentLogin = await request('POST', '/api/auth/login', {
      email: 'parent@saitrack.com',
      password: 'parent123'
    });
    assert(parentLogin.status === 200, 'Parent login succeeded');
    parentToken = parentLogin.data.token;

    // ----------------------------------------------------
    // 2. Download Excel Template
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 2] Download Excel Template (Module 1)');
    const tplRes = await request('GET', '/api/admin/bulk-attendance/template', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(tplRes.status === 200, 'Template download responds with HTTP 200');
    assert(tplRes.headers.get('content-type').includes('spreadsheetml'), 'Template Content-Type is valid Excel sheet');

    // Parse returned buffer with ExcelJS
    const tplWb = new ExcelJS.Workbook();
    await tplWb.xlsx.load(tplRes.data);
    assert(tplWb.worksheets.length >= 2, 'Template contains Template sheet and Guidelines sheet');
    const tplSheet = tplWb.worksheets[0];
    const headerRow = tplSheet.getRow(1);
    assert(headerRow.getCell(1).value === 'Student ID' && headerRow.getCell(2).value === 'Student Name', 'Template columns contain Student ID and Student Name');

    // ----------------------------------------------------
    // 3. Validation and Preview: Valid Excel File
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 3] Valid Excel File Preview (Module 2)');
    const validRows = [
      ['ST001', 'Arun Kumar', 'CCE', '4'],
      ['ST002', 'Priya S', 'CSE', '3'],
      ['ST003', 'Karthik R', 'ECE', '2']
    ];
    const validBuffer = await createTestExcelBuffer(validRows);

    const testDate1 = '2026-11-15';
    const previewRes1 = await uploadExcelRequest(validBuffer, 'valid_attendance.xlsx', {
      attendance_date: testDate1,
      session: 'Morning'
    }, adminToken);

    assert(previewRes1.status === 200, 'Preview valid Excel file returns HTTP 200');
    assert(previewRes1.data.summary.total === 3, 'Total records count is 3');
    assert(previewRes1.data.summary.valid === 3, 'Valid records count is 3');
    assert(previewRes1.data.summary.invalid === 0, 'Invalid records count is 0');
    assert(previewRes1.data.summary.duplicates === 0, 'Duplicate records count is 0');
    assert(previewRes1.data.rows[0].validationStatus === 'Valid', 'First student status is Valid');

    // ----------------------------------------------------
    // 4. Validation: Unknown Student IDs
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 4] Unknown Student IDs Rejection (Module 2)');
    const unknownRows = [
      ['ST001', 'Arun Kumar', 'CCE', '4'],
      ['ST999', 'Ghost Student', 'CCE', '4'] // Unknown ID
    ];
    const unknownBuffer = await createTestExcelBuffer(unknownRows);

    const previewUnknown = await uploadExcelRequest(unknownBuffer, 'unknown_student.xlsx', {
      attendance_date: testDate1,
      session: 'Morning'
    }, adminToken);

    assert(previewUnknown.status === 200, 'Preview returns 200 with row-level validation statuses');
    assert(previewUnknown.data.summary.valid === 1, '1 valid record identified');
    assert(previewUnknown.data.summary.invalid === 1, '1 invalid record identified');
    const ghostRow = previewUnknown.data.rows.find(r => r.studentId === 'ST999');
    assert(ghostRow && ghostRow.validationStatus === 'Unknown Student ID', 'Unknown student marked with status "Unknown Student ID"');
    assert(ghostRow && ghostRow.isEligible === false, 'Unknown student is NOT eligible to be marked present');

    // ----------------------------------------------------
    // 5. Validation: Duplicate Student IDs in file
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 5] Duplicate Student IDs in Upload File (Module 2)');
    const dupRows = [
      ['ST001', 'Arun Kumar', 'CCE', '4'],
      ['ST001', 'Arun Kumar', 'CCE', '4'], // Duplicate ID
      ['ST002', 'Priya S', 'CSE', '3']
    ];
    const dupBuffer = await createTestExcelBuffer(dupRows);

    const previewDup = await uploadExcelRequest(dupBuffer, 'duplicate_students.xlsx', {
      attendance_date: testDate1,
      session: 'Morning'
    }, adminToken);

    assert(previewDup.status === 200, 'Preview duplicate test returns HTTP 200');
    assert(previewDup.data.summary.duplicates === 1, 'Duplicate student flagged (duplicates === 1)');
    assert(previewDup.data.summary.valid === 2, 'First occurrence and other student marked valid (valid === 2)');
    assert(previewDup.data.rows[1].validationStatus === 'Duplicate in File', 'Second occurrence marked as Duplicate in File');
    assert(previewDup.data.rows[1].isEligible === false, 'Duplicate occurrence is NOT eligible');

    // ----------------------------------------------------
    // 6. Validation: Empty and Corrupted Excel Files
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 6] Empty & Corrupted Files Rejection (Module 2)');
    const emptyBuffer = Buffer.alloc(0);
    const emptyRes = await uploadExcelRequest(emptyBuffer, 'empty.xlsx', {
      attendance_date: testDate1,
      session: 'Morning'
    }, adminToken);
    assert(emptyRes.status === 400, 'Empty file rejected with HTTP 400');

    const corruptBuffer = Buffer.from('NOT_A_VALID_EXCEL_ZIP_BINARY_DATA');
    const corruptRes = await uploadExcelRequest(corruptBuffer, 'corrupt.xlsx', {
      attendance_date: testDate1,
      session: 'Morning'
    }, adminToken);
    assert(corruptRes.status === 400, 'Corrupted Excel file rejected with HTTP 400');

    // ----------------------------------------------------
    // 7. Confirm and Mark Attendance (Module 3)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 7] Confirm and Mark Attendance (Module 3)');
    const eligibleRecords = previewRes1.data.rows.filter(r => r.isEligible);

    const confirmRes = await request('POST', '/api/admin/bulk-attendance/confirm', {
      attendance_date: testDate1,
      session: 'Morning',
      filename: 'valid_attendance.xlsx',
      file_size: validBuffer.length,
      eligible_records: eligibleRecords,
      preview_summary: previewRes1.data.summary,
      all_rows: previewRes1.data.rows
    }, { 'Authorization': `Bearer ${adminToken}` });

    assert(confirmRes.status === 200, 'Confirm bulk attendance succeeds with HTTP 200');
    assert(confirmRes.data.marked_present === 3, '3 students marked present in database');
    assert(confirmRes.data.upload_id && confirmRes.data.upload_id.startsWith('upl_'), 'Unique attendance_upload_id generated');
    const uploadId1 = confirmRes.data.upload_id;

    // Verify in Admin Attendance Register
    const adminAttRes = await request('GET', '/api/admin/attendance', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(adminAttRes.status === 200, 'GET /api/admin/attendance succeeds with HTTP 200');
    const student1Record = adminAttRes.data.attendance.find(a => a.student_id === 'usr_student_1' && a.date === testDate1);
    assert(student1Record && student1Record.status === 1, 'Student 1 attendance record exists with status: PRESENT (1)');
    assert(student1Record.source === 'EXCEL_BULK_UPLOAD', 'Attendance source is stamped as EXCEL_BULK_UPLOAD');
    assert(student1Record.attendance_upload_id === uploadId1, 'Attendance record is stamped with correct upload ID');

    // Verify in Student Dashboard
    const studentDash = await request('GET', '/api/student/dashboard', null, {
      'Authorization': `Bearer ${studentToken}`
    });
    assert(studentDash.status === 200, 'Student dashboard responds with HTTP 200');
    const studentHasAtt = studentDash.data.attendance.some(a => a.date === testDate1 && a.status === 1);
    assert(studentHasAtt === true, 'Bulk attendance appears automatically in Student Dashboard');

    // Verify in Parent Dashboard
    const parentDash = await request('GET', '/api/parent/children', null, {
      'Authorization': `Bearer ${parentToken}`
    });
    assert(parentDash.status === 200, 'Parent dashboard responds with HTTP 200');
    const childObj = parentDash.data.children.find(c => c.user_id === 'usr_student_1');
    const parentHasChildAtt = childObj && childObj.attendance.some(a => a.date === testDate1 && a.status === 1);
    assert(parentHasChildAtt === true, 'Bulk attendance appears automatically in Authorized Parent View');

    // ----------------------------------------------------
    // 8. Prevent Duplicate Attendance (Already Marked Present)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 8] Already Marked Present Collision Check (Module 2 & 3)');
    // Uploading the same file again on the same date and session
    const previewAgain = await uploadExcelRequest(validBuffer, 'valid_attendance.xlsx', {
      attendance_date: testDate1,
      session: 'Morning'
    }, adminToken);

    assert(previewAgain.status === 200, 'Preview returns 200');
    assert(previewAgain.data.summary.alreadyPresent === 3, 'All 3 students flagged as "Already Marked Present"');
    assert(previewAgain.data.summary.valid === 0, '0 eligible records (prevents duplicate attendance)');
    assert(previewAgain.data.rows[0].validationStatus === 'Already Marked Present', 'Validation status: Already Marked Present');

    // ----------------------------------------------------
    // 9. Attendance Upload History (Module 4)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 9] Attendance Upload History (Module 4)');
    const histRes = await request('GET', '/api/admin/bulk-attendance/history', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(histRes.status === 200, 'GET /api/admin/bulk-attendance/history responds with HTTP 200');
    const historyUpload = histRes.data.uploads.find(u => u.id === uploadId1);
    assert(historyUpload !== undefined, 'Upload 1 is recorded in upload history');
    assert(historyUpload.marked_present === 3, 'Recorded upload marked 3 students');
    assert(historyUpload.status === 'COMPLETED', 'Upload status is COMPLETED');

    const detailsRes = await request('GET', `/api/admin/bulk-attendance/history/${uploadId1}`, null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert(detailsRes.status === 200, 'GET /api/admin/bulk-attendance/history/:id returns details');
    assert(detailsRes.data.upload.details.all_rows.length === 3, 'Student-level details preserved in history');

    // ----------------------------------------------------
    // 10. Undo / Rollback Upload (Module 5)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 10] Undo / Rollback Upload (Module 5)');
    const rollbackRes = await request('POST', '/api/admin/bulk-attendance/rollback', {
      upload_id: uploadId1
    }, { 'Authorization': `Bearer ${adminToken}` });

    assert(rollbackRes.status === 200, 'Rollback returns HTTP 200');
    assert(rollbackRes.data.reversed_count === 3, 'Reversed exactly 3 attendance records');
    assert(rollbackRes.data.upload.status === 'UNDONE', 'Upload record marked as status UNDONE');

    // Verify records removed from database
    const checkAttAfterRollback = db.getAttendance().filter(a => a.attendance_upload_id === uploadId1);
    assert(checkAttAfterRollback.length === 0, 'All attendance records from upload 1 removed from database');

    // Verify student dashboard updated
    const studentDashAfterRollback = await request('GET', '/api/student/dashboard', null, {
      'Authorization': `Bearer ${studentToken}`
    });
    const stillHasAtt = studentDashAfterRollback.data.attendance.some(a => a.date === testDate1);
    assert(stillHasAtt === false, 'Student dashboard updated: reversed attendance no longer present');

    // Idempotency: Attempting to rollback again must fail gracefully
    const repeatedRollback = await request('POST', '/api/admin/bulk-attendance/rollback', {
      upload_id: uploadId1
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert(repeatedRollback.status === 400, 'Repeated rollback rejected with HTTP 400 (Idempotent protection)');
    assert(repeatedRollback.data.error.includes('already been undone'), 'Clear error indicates upload was already undone');

    // ----------------------------------------------------
    // 11. Selective Rollback: Multiple Uploads, Undo Only One
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 11] Selective Rollback: Multiple Uploads (Module 5)');
    // Upload A for Date A
    const dateA = '2026-11-20';
    const uploadABuffer = await createTestExcelBuffer([
      ['ST001', 'Arun Kumar', 'CCE', '4'],
      ['ST002', 'Priya S', 'CSE', '3']
    ]);
    const prevA = await uploadExcelRequest(uploadABuffer, 'upload_A.xlsx', { attendance_date: dateA, session: 'Morning' }, adminToken);
    const confA = await request('POST', '/api/admin/bulk-attendance/confirm', {
      attendance_date: dateA,
      session: 'Morning',
      filename: 'upload_A.xlsx',
      eligible_records: prevA.data.rows.filter(r => r.isEligible),
      all_rows: prevA.data.rows
    }, { 'Authorization': `Bearer ${adminToken}` });
    const idA = confA.data.upload_id;

    // Upload B for Date B
    const dateB = '2026-11-21';
    const uploadBBuffer = await createTestExcelBuffer([
      ['ST003', 'Karthik R', 'ECE', '2'],
      ['ST004', 'Rahul Kumar', 'MECH', '1']
    ]);
    const prevB = await uploadExcelRequest(uploadBBuffer, 'upload_B.xlsx', { attendance_date: dateB, session: 'Morning' }, adminToken);
    const confB = await request('POST', '/api/admin/bulk-attendance/confirm', {
      attendance_date: dateB,
      session: 'Morning',
      filename: 'upload_B.xlsx',
      eligible_records: prevB.data.rows.filter(r => r.isEligible),
      all_rows: prevB.data.rows
    }, { 'Authorization': `Bearer ${adminToken}` });
    const idB = confB.data.upload_id;

    // Undo ONLY Upload A
    const rbA = await request('POST', '/api/admin/bulk-attendance/rollback', { upload_id: idA }, { 'Authorization': `Bearer ${adminToken}` });
    assert(rbA.status === 200, 'Rollback of Upload A succeeded');

    // Verify Upload A records are gone, but Upload B records are 100% INTACT
    const attA = db.getAttendance().filter(a => a.attendance_upload_id === idA);
    const attB = db.getAttendance().filter(a => a.attendance_upload_id === idB);
    assert(attA.length === 0, 'Upload A records are reversed');
    assert(attB.length === 2, 'Upload B records remain completely INTACT and unaffected');

    // Clean up Upload B
    await request('POST', '/api/admin/bulk-attendance/rollback', { upload_id: idB }, { 'Authorization': `Bearer ${adminToken}` });

    // ----------------------------------------------------
    // 12. RFID & Manual Attendance Preservation
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 12] RFID & Manual Attendance Preservation (Module 3 & 5)');
    const testDatePreserve = '2026-11-25';

    // 1. Create RFID scan attendance
    const rfidScan = await request('POST', '/api/rfid/scan', {
      rfid_tag: 'RFID_SEC_001',
      bus_id: 'bus_1',
      reader_id: 'Bus_Gate_Reader_Test',
      timestamp: `${testDatePreserve}T08:15:00Z`
    }, { 'X-Reader-Key': config.RFID_READER_API_KEY });
    assert(rfidScan.status === 200, 'RFID scan recorded');
    const rfidRecord = db.getAttendance().find(a => a.student_id === 'usr_student_1' && a.date === testDatePreserve);
    assert(rfidRecord && rfidRecord.source === 'RFID', 'RFID record has source: RFID');

    // 2. Create Manual roll-call attendance for Student 2
    const manualAtt = await request('POST', '/api/admin/attendance/mark', {
      records: [{ student_id: 'usr_student_2', date: testDatePreserve, status: 1 }]
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert(manualAtt.status === 200, 'Manual attendance marked');

    // 3. Upload bulk attendance for Student 3 & Student 4
    const bulkPreserveBuffer = await createTestExcelBuffer([
      ['ST003', 'Karthik R', 'ECE', '2'],
      ['ST004', 'Rahul Kumar', 'MECH', '1']
    ]);
    const prevPreserve = await uploadExcelRequest(bulkPreserveBuffer, 'bulk_preserve.xlsx', {
      attendance_date: testDatePreserve,
      session: 'Afternoon'
    }, adminToken);
    const confPreserve = await request('POST', '/api/admin/bulk-attendance/confirm', {
      attendance_date: testDatePreserve,
      session: 'Afternoon',
      filename: 'bulk_preserve.xlsx',
      eligible_records: prevPreserve.data.rows.filter(r => r.isEligible),
      all_rows: prevPreserve.data.rows
    }, { 'Authorization': `Bearer ${adminToken}` });
    const preserveUploadId = confPreserve.data.upload_id;

    // 4. Rollback the bulk upload
    const rbPreserve = await request('POST', '/api/admin/bulk-attendance/rollback', {
      upload_id: preserveUploadId
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert(rbPreserve.status === 200, 'Bulk upload rolled back');

    // 5. Verify RFID record and Manual record are UNTOUCHED
    const rfidAfterRollback = db.getAttendance().find(a => a.student_id === 'usr_student_1' && a.date === testDatePreserve);
    assert(rfidAfterRollback !== undefined && rfidAfterRollback.source === 'RFID', 'RFID attendance record is UNTOUCHED and preserved');

    const manualAfterRollback = db.getAttendance().find(a => a.student_id === 'usr_student_2' && a.date === testDatePreserve);
    assert(manualAfterRollback !== undefined && manualAfterRollback.source === 'MANUAL', 'Manual roll-call record is UNTOUCHED and preserved');

    // ----------------------------------------------------
    // 13. Security & Role-Based Access Control (Module 7)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 13] Security & RBAC Enforcement (Module 7)');
    // Student attempting to upload
    const studentUpload = await uploadExcelRequest(validBuffer, 'hack.xlsx', { attendance_date: '2026-11-28', session: 'Morning' }, studentToken);
    assert(studentUpload.status === 403, 'Student blocked from upload preview with HTTP 403 Forbidden');

    // Parent attempting to rollback
    const parentRollback = await request('POST', '/api/admin/bulk-attendance/rollback', { upload_id: 'some_id' }, { 'Authorization': `Bearer ${parentToken}` });
    assert(parentRollback.status === 403, 'Parent blocked from rollback with HTTP 403 Forbidden');

    // Unauthenticated request
    const unauthUpload = await uploadExcelRequest(validBuffer, 'unauth.xlsx', { attendance_date: '2026-11-28', session: 'Morning' }, null);
    assert(unauthUpload.status === 401, 'Unauthenticated request rejected with HTTP 401 Unauthorized');

    // ----------------------------------------------------
    // 14. Excel Report Downloads (Module 6)
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 14] Excel Report Downloads (Module 6)');
    // Filtered attendance report
    const repAtt = await request('GET', '/api/admin/bulk-attendance/reports/attendance-excel?session=Morning', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(repAtt.status === 200 && repAtt.headers.get('content-type').includes('spreadsheetml'), 'Filtered attendance Excel report downloaded');

    // Specific upload report
    const repUp = await request('GET', `/api/admin/bulk-attendance/reports/upload/${uploadId1}/excel`, null, { 'Authorization': `Bearer ${adminToken}` });
    assert(repUp.status === 200 && repUp.headers.get('content-type').includes('spreadsheetml'), 'Upload inspection Excel report downloaded');

    // Upload history and audit report
    const repHist = await request('GET', '/api/admin/bulk-attendance/reports/history-excel', null, { 'Authorization': `Bearer ${adminToken}` });
    assert(repHist.status === 200 && repHist.headers.get('content-type').includes('spreadsheetml'), 'Upload history & audit Excel report downloaded');

    // ----------------------------------------------------
    // 15. Server Restart & Persistence
    // ----------------------------------------------------
    console.log('\n[TEST GROUP 15] Data Persistence Across Server Reload');
    // Force atomic save and re-init MockDB
    db.save();
    db.init();
    const persistedUpload = db.getAttendanceUploadById(uploadId1);
    assert(persistedUpload && persistedUpload.status === 'UNDONE', 'Upload history persists across database reload');
    const persistedAudit = db.getAttendanceAuditLog().length;
    assert(persistedAudit > 0, 'Audit trail persisted and never deleted');

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n======================================================');
    console.log(` BULK ATTENDANCE TEST SUMMARY: ${passedTests}/${totalTests} PASSED`);
    if (failedTests > 0) {
      console.log(` ⚠️ ${failedTests} TESTS FAILED`);
    } else {
      console.log(' All Excel bulk attendance tests passed successfully!');
    }
    console.log('======================================================\n');

  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    server.close();
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

setTimeout(runBulkAttendanceTests, 500);
