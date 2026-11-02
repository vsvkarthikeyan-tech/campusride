const ExcelJS = require('exceljs');

/**
 * Excel Service for CampusRide Bulk Attendance Management
 * Handles template generation, parsing, comprehensive validations,
 * and report generation using ExcelJS.
 */

// Helper to extract clean string value from an Excel cell
function getCellValue(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  if (typeof cell.value === 'object') {
    // Handle rich text or formula objects
    if (cell.value.text) return String(cell.value.text).trim();
    if (cell.value.result !== undefined) return String(cell.value.result).trim();
    return String(cell.text || '').trim();
  }
  return String(cell.value).trim();
}

/**
 * Generates downloadable Excel template with sample data and styling
 */
async function generateTemplate(sampleStudents = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CampusRide Transport Management System';
  workbook.lastModifiedBy = 'Admin';
  workbook.created = new Date();
  workbook.modified = new Date();

  // ----------------------------------------------------
  // Sheet 1: Attendance Upload Template
  // ----------------------------------------------------
  const sheet = workbook.addWorksheet('Attendance Upload Template', {
    views: [{ showGridLines: true }]
  });

  sheet.columns = [
    { header: 'Student ID', key: 'student_id', width: 18 },
    { header: 'Student Name', key: 'student_name', width: 28 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Year', key: 'year', width: 14 }
  ];

  // Style Header Row
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' } // Slate Navy
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF475569' } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      bottom: { style: 'medium', color: { argb: 'FF6366F1' } },
      right: { style: 'thin', color: { argb: 'FF475569' } }
    };
  });

  // Populate sample rows with complete demo roster
  const defaultSamples = [
    { student_id: 'DEMO-ST001', student_name: 'Arun Kumar', department: 'CCE', year: 4 },
    { student_id: 'DEMO-ST002', student_name: 'Priya S', department: 'CSE', year: 3 },
    { student_id: 'DEMO-ST003', student_name: 'Karthik R', department: 'ECE', year: 2 },
    { student_id: 'DEMO-ST004', student_name: 'Divya M', department: 'IT', year: 4 },
    { student_id: 'DEMO-ST005', student_name: 'Rahul S', department: 'EEE', year: 3 },
    { student_id: 'DEMO-ST006', student_name: 'Nisha P', department: 'CCE', year: 2 },
    { student_id: 'DEMO-ST007', student_name: 'Vignesh K', department: 'CSE', year: 1 },
    { student_id: 'DEMO-ST008', student_name: 'Meena R', department: 'AIDS', year: 3 },
    { student_id: 'DEMO-ST009', student_name: 'Sanjay V', department: 'ECE', year: 4 },
    { student_id: 'DEMO-ST010', student_name: 'Harini T', department: 'IT', year: 2 }
  ];

  const rowsToInsert = (sampleStudents && sampleStudents.length > 0) ? sampleStudents : defaultSamples;

  rowsToInsert.forEach((item, idx) => {
    const row = sheet.addRow(item);
    row.height = 24;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 10 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: (colNumber === 1 || colNumber === 4) ? 'center' : 'left'
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      if (idx % 2 === 1) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
    });
  });

  // ----------------------------------------------------
  // Sheet 2: Instructions & Guidelines
  // ----------------------------------------------------
  const guideSheet = workbook.addWorksheet('Instructions & Guidelines', {
    views: [{ showGridLines: true }]
  });

  guideSheet.columns = [
    { header: 'Rule / Column', key: 'rule', width: 25 },
    { header: 'Description and Validation Guidelines', key: 'desc', width: 65 }
  ];

  const guideHeader = guideSheet.getRow(1);
  guideHeader.height = 28;
  guideHeader.eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const instructions = [
    { rule: 'Supported Formats', desc: 'Microsoft Excel (.xlsx and .xls formats supported).' },
    { rule: 'Unique Matching Key', desc: 'Student ID is the unique matching key used to identify enrolled students in CampusRide.' },
    { rule: 'Student ID', desc: 'Required. Must match an active Student ID or Roll Number in the system (e.g., ST001, ST002).' },
    { rule: 'Student Name', desc: 'Required. Must be consistent with the registered student name in the institutional database.' },
    { rule: 'Department', desc: 'Required. Consistent departmental code (e.g., CCE, CSE, ECE, MECH, IT).' },
    { rule: 'Year', desc: 'Required. Academic year of study represented as 1, 2, 3, or 4.' },
    { rule: 'Duplicate Prevention', desc: 'Duplicate Student IDs within the same uploaded file will be flagged and rejected.' },
    { rule: 'Session Collision', desc: 'Students already marked present for the chosen date and session will not be duplicated.' },
    { rule: 'Safe Rollback', desc: 'Every upload is tagged with a unique Upload ID. Administrators can undo/rollback uploads at any time.' }
  ];

  instructions.forEach((ins, idx) => {
    const r = guideSheet.addRow(ins);
    r.height = 26;
    r.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: colNumber === 1 };
      cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Validates and parses an uploaded Excel file buffer.
 * Performs checks:
 * 1. Empty or corrupted Excel files
 * 2. Required columns existence
 * 3. Existing Student IDs in the database
 * 4. Student name and department consistency
 * 5. Duplicate Student IDs within the uploaded file
 * 6. Already existing attendance for the selected date and session
 * 7. Missing and invalid values
 */
async function parseAndValidateExcel(buffer, { attendanceDate, session, db }) {
  if (!buffer || buffer.length === 0) {
    throw new Error('The uploaded file is empty (0 bytes). Please upload a valid Excel file.');
  }

  const workbook = new ExcelJS.Workbook();
  let loaded = false;
  try {
    await workbook.xlsx.load(buffer);
    loaded = true;
  } catch (err) {
    // Fallback: If buffer is plaintext CSV/TSV or tab-separated data
    try {
      const text = buffer.toString('utf8');
      if (text && (text.includes('\t') || text.includes(','))) {
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length > 0) {
          const sheet = workbook.addWorksheet('Attendance');
          for (const line of lines) {
            const sep = line.includes('\t') ? '\t' : ',';
            const parts = line.split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''));
            sheet.addRow(parts);
          }
          loaded = true;
        }
      }
    } catch (_) {}

    if (!loaded) {
      throw new Error(`Corrupted or unreadable Excel file: ${err.message}`);
    }
  }

  if (!workbook.worksheets || workbook.worksheets.length === 0) {
    throw new Error('Excel workbook contains no readable worksheets.');
  }

  const sheet = workbook.worksheets[0];
  if (sheet.rowCount < 1) {
    throw new Error('Excel file has no data rows. Please ensure rows follow the header row.');
  }

  // Identify Header Row and Column Indexes (case-insensitive)
  let headerRowIndex = 1;
  let colStudentId = -1;
  let colStudentName = -1;
  let colDepartment = -1;
  let colYear = -1;

  // Scan first 5 rows to locate header row
  for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
    const row = sheet.getRow(r);
    row.eachCell((cell, colNumber) => {
      const val = getCellValue(cell).toLowerCase().replace(/[\s_\-]/g, '');
      if (val === 'studentid' || val === 'id' || val === 'studentno' || val === 'rollno') {
        colStudentId = colNumber;
      } else if (val === 'studentname' || val === 'name' || val === 'fullname') {
        colStudentName = colNumber;
      } else if (val === 'department' || val === 'dept' || val === 'branch') {
        colDepartment = colNumber;
      } else if (val === 'year' || val === 'yr' || val === 'classyear') {
        colYear = colNumber;
      }
    });

    if (colStudentId !== -1 && colStudentName !== -1) {
      headerRowIndex = r;
      break;
    }
  }

  // Headerless roster detection: If file starts directly with student records (e.g. DEMO-ST001, Arun Kumar, CCE, 4)
  if (colStudentId === -1 || colStudentName === -1) {
    const row1 = sheet.getRow(1);
    const c1 = getCellValue(row1.getCell(1));
    const c2 = getCellValue(row1.getCell(2));
    const c3 = getCellValue(row1.getCell(3));
    const c4 = getCellValue(row1.getCell(4));

    const isIdLike = /^(DEMO-)?ST\d+|\bST\d+|\d{3,}/i.test(c1) || (db.findStudentByStudentId && db.findStudentByStudentId(c1));
    if (isIdLike && c2) {
      headerRowIndex = 0; // Data starts on row 1
      colStudentId = 1;
      colStudentName = 2;
      colDepartment = 3;
      colYear = 4;
    }
  }

  const missingColumns = [];
  if (colStudentId === -1) missingColumns.push('Student ID');
  if (colStudentName === -1) missingColumns.push('Student Name');
  if (colDepartment === -1) missingColumns.push('Department');
  if (colYear === -1) missingColumns.push('Year');

  if (missingColumns.length > 0) {
    throw new Error(`Invalid Excel columns. Missing required headers: [${missingColumns.join(', ')}]. Expected columns: [Student ID, Student Name, Department, Year]`);
  }

  const rows = [];
  const seenStudentIds = new Set();
  let duplicateCount = 0;
  let invalidCount = 0;
  let alreadyPresentCount = 0;
  let validCount = 0;

  const existingAttendance = db.getAttendance ? db.getAttendance() : (db.data.attendance || []);

  for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);

    const studentIdRaw = getCellValue(row.getCell(colStudentId));
    const studentNameRaw = getCellValue(row.getCell(colStudentName));
    const departmentRaw = getCellValue(row.getCell(colDepartment));
    const yearRaw = getCellValue(row.getCell(colYear));

    // Skip entirely empty rows
    if (!studentIdRaw && !studentNameRaw && !departmentRaw && !yearRaw) {
      continue;
    }

    const studentId = studentIdRaw.trim();
    const studentName = studentNameRaw.trim();
    const department = departmentRaw.trim().toUpperCase();
    const yearNum = parseInt(yearRaw.trim(), 10);

    const record = {
      rowNumber: r,
      studentId: studentId || '(Empty ID)',
      studentName: studentName || '(Empty Name)',
      department: department || '(Empty Dept)',
      year: isNaN(yearNum) ? yearRaw : yearNum,
      validationStatus: 'Valid',
      attendanceStatus: 'Eligible to Mark Present',
      isEligible: false,
      failureReason: null,
      dbStudent: null
    };

    // 1. Check Missing and Invalid Values
    if (!studentId) {
      record.validationStatus = 'Invalid';
      record.attendanceStatus = 'Skipped (Missing ID)';
      record.failureReason = 'Student ID field is empty';
      invalidCount++;
      rows.push(record);
      continue;
    }

    if (!studentName) {
      record.validationStatus = 'Invalid';
      record.attendanceStatus = 'Skipped (Missing Name)';
      record.failureReason = 'Student Name field is empty';
      invalidCount++;
      rows.push(record);
      continue;
    }

    if (!department) {
      record.validationStatus = 'Invalid';
      record.attendanceStatus = 'Skipped (Missing Dept)';
      record.failureReason = 'Department field is empty';
      invalidCount++;
      rows.push(record);
      continue;
    }

    // Reject school-level classes (9th, 10th, 11th, 12th) per Module 2
    const yearRawTrimmed = yearRaw.trim();
    if (/^(9|10|11|12)(th)?(\s*(grade|std|standard))?/i.test(yearRawTrimmed)) {
      record.validationStatus = 'Invalid Academic Year';
      record.attendanceStatus = 'Skipped (School Grade Rejected)';
      record.failureReason = `School class '${yearRaw}' is rejected. CampusRide is an engineering college portal. Please use 1st, 2nd, 3rd, or 4th Year.`;
      invalidCount++;
      rows.push(record);
      continue;
    }

    // Parse Year (Accepts 1, 2, 3, 4, or '1st Year', '2nd Year', '3rd Year', '4th Year')
    let parsedYear = NaN;
    if (/^[1-4]$/.test(yearRawTrimmed)) {
      parsedYear = parseInt(yearRawTrimmed, 10);
    } else if (/^1(st)?(\s*year)?$/i.test(yearRawTrimmed)) {
      parsedYear = 1;
    } else if (/^2(nd)?(\s*year)?$/i.test(yearRawTrimmed)) {
      parsedYear = 2;
    } else if (/^3(rd)?(\s*year)?$/i.test(yearRawTrimmed)) {
      parsedYear = 3;
    } else if (/^4(th)?(\s*year)?$/i.test(yearRawTrimmed)) {
      parsedYear = 4;
    }

    if (isNaN(parsedYear) || parsedYear < 1 || parsedYear > 4) {
      record.validationStatus = 'Invalid Academic Year';
      record.attendanceStatus = 'Skipped (Invalid Year)';
      record.failureReason = `Academic year '${yearRaw}' is invalid. Expected engineering academic year: 1st, 2nd, 3rd, or 4th Year (or 1-4)`;
      invalidCount++;
      rows.push(record);
      continue;
    }

    record.year = parsedYear;

    // 2. Duplicate Student IDs within the uploaded file
    const normalizedId = studentId.toUpperCase();
    if (seenStudentIds.has(normalizedId)) {
      record.validationStatus = 'Duplicate in File';
      record.attendanceStatus = 'Skipped (Duplicate in File)';
      record.failureReason = `Duplicate Student ID '${studentId}' found multiple times in this Excel file`;
      duplicateCount++;
      rows.push(record);
      continue;
    }
    seenStudentIds.add(normalizedId);

    // 3. Existing Student IDs in the database (with nameHint to resolve disambiguations)
    const dbStudent = db.findStudentByStudentId ? db.findStudentByStudentId(studentId, studentName) : null;
    if (!dbStudent) {
      record.validationStatus = 'Unknown Student ID';
      record.attendanceStatus = 'Skipped (Not Found in DB)';
      record.failureReason = `Student ID '${studentId}' does not exist in enrolled student registry`;
      invalidCount++;
      rows.push(record);
      continue;
    }

    record.dbStudent = {
      userId: dbStudent.user_id,
      name: dbStudent.name,
      department: dbStudent.department,
      year: dbStudent.year
    };

    // 4. Student Name & Department Consistency (resilient to whitespace, initials, casing)
    const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const dbNameClean = norm(dbStudent.name);
    const uploadedNameClean = norm(studentName);

    if (dbNameClean && uploadedNameClean && dbNameClean !== uploadedNameClean) {
      const isFuzzyMatch = dbNameClean.includes(uploadedNameClean) || uploadedNameClean.includes(dbNameClean);
      if (!isFuzzyMatch) {
        record.validationStatus = 'Name Inconsistency';
        record.attendanceStatus = 'Skipped (Name Inconsistency)';
        record.failureReason = `Student name mismatch: Excel has '${studentName}', database record is '${dbStudent.name}'`;
        invalidCount++;
        rows.push(record);
        continue;
      }
    }

    if (dbStudent.department) {
      const dbDeptClean = dbStudent.department.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const uploadedDeptClean = department.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (dbDeptClean && uploadedDeptClean && uploadedDeptClean !== dbDeptClean) {
        record.validationStatus = 'Department Inconsistency';
        record.attendanceStatus = 'Skipped (Dept Inconsistency)';
        record.failureReason = `Department mismatch: Excel has '${department}', database record is '${dbStudent.department}'`;
        invalidCount++;
        rows.push(record);
        continue;
      }
    }

    // 5. Already existing attendance for selected date and session
    const targetUserId = dbStudent.user_id;
    const existingForDate = existingAttendance.filter(a => a.student_id === targetUserId && a.date === attendanceDate);

    let isAlreadyPresent = false;
    let collisionSource = '';

    for (const att of existingForDate) {
      if (att.status === 1) { // 1 = Present
        const attSession = att.session || 'Full Day';
        if (session === 'Full Day' || attSession === 'Full Day' || attSession.toLowerCase() === session.toLowerCase()) {
          isAlreadyPresent = true;
          collisionSource = att.source || (att.marked_by && att.marked_by.includes('RFID') ? 'RFID' : 'MANUAL');
          break;
        }
      }
    }

    if (isAlreadyPresent) {
      record.validationStatus = 'Already Marked Present';
      record.attendanceStatus = `Skipped (Already Present via ${collisionSource})`;
      record.failureReason = `Student is already marked Present for ${attendanceDate} (${session}) via ${collisionSource}`;
      alreadyPresentCount++;
      rows.push(record);
      continue;
    }

    // All validation passed
    record.validationStatus = 'Valid';
    record.attendanceStatus = 'Eligible to Mark Present';
    record.isEligible = true;
    validCount++;
    rows.push(record);
  }

  if (rows.length === 0) {
    throw new Error('No valid student data rows found in Excel sheet.');
  }

  return {
    summary: {
      total: rows.length,
      valid: validCount,
      invalid: invalidCount,
      duplicates: duplicateCount,
      alreadyPresent: alreadyPresentCount
    },
    rows
  };
}

/**
 * Generates an Excel Attendance Report with filters
 */
async function generateAttendanceReportExcel({ attendanceRecords, filters = {} }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Attendance Report', { views: [{ showGridLines: true }] });

  // Title Block
  sheet.mergeCells('A1:J1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = 'CAMPUSRIDE TRANSPORTATION & SAFETY ATTENDANCE REPORT';
  titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 32;

  // Filter Info
  sheet.mergeCells('A2:J2');
  const filterCell = sheet.getCell('A2');
  filterCell.value = `Filters Applied: Date: ${filters.date || 'All Dates'} | Dept: ${filters.department || 'All Departments'} | Year: ${filters.year || 'All Years'} | Session: ${filters.session || 'All Sessions'} | Generated: ${new Date().toLocaleString()}`;
  filterCell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: 'FF64748B' } };
  filterCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  filterCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(2).height = 20;

  // Header Row
  sheet.columns = [
    { header: '#', key: 'seq', width: 6 },
    { header: 'Student ID', key: 'student_id', width: 15 },
    { header: 'Student Name', key: 'name', width: 25 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Year', key: 'year', width: 10 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Session', key: 'session', width: 15 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Source', key: 'source', width: 22 },
    { header: 'Marked By / Audit', key: 'marked_by', width: 25 }
  ];

  const headerRow = sheet.getRow(3);
  headerRow.height = 28;
  headerRow.eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF1E1B4B' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });

  attendanceRecords.forEach((att, idx) => {
    const row = sheet.addRow({
      seq: idx + 1,
      student_id: att.student_code || att.student_id,
      name: att.student_name || 'N/A',
      department: att.department || 'General',
      year: att.year || '-',
      date: att.date,
      session: att.session || 'Full Day',
      status: att.status === 1 ? 'PRESENT' : 'ABSENT',
      source: att.source || 'MANUAL',
      marked_by: att.marked_by || 'System Admin'
    });

    row.height = 22;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = {
        vertical: 'middle',
        horizontal: (colNumber === 1 || colNumber === 2 || colNumber === 5 || colNumber === 6 || colNumber === 8) ? 'center' : 'left'
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      // Status pill coloring
      if (colNumber === 8) {
        if (cell.value === 'PRESENT') {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF065F46' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generates an Excel report for a specific upload ID
 */
async function generateUploadReportExcel(uploadRecord) {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Upload Metadata Summary
  const sumSheet = workbook.addWorksheet('Upload Summary');
  sumSheet.columns = [
    { header: 'Property', key: 'prop', width: 25 },
    { header: 'Value', key: 'val', width: 50 }
  ];

  sumSheet.getRow(1).height = 28;
  sumSheet.getRow(1).eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const metadata = [
    { prop: 'Upload ID', val: uploadRecord.id },
    { prop: 'Original Excel Filename', val: uploadRecord.filename },
    { prop: 'Admin User', val: `${uploadRecord.admin_name} (${uploadRecord.admin_id})` },
    { prop: 'Upload Timestamp', val: new Date(uploadRecord.upload_timestamp).toLocaleString() },
    { prop: 'Attendance Date', val: uploadRecord.attendance_date },
    { prop: 'Session', val: uploadRecord.session },
    { prop: 'Total Records Processed', val: uploadRecord.total_records },
    { prop: 'Students Marked Present', val: uploadRecord.marked_present },
    { prop: 'Failed / Skipped Records', val: uploadRecord.failed_records },
    { prop: 'Upload Status', val: uploadRecord.status },
    { prop: 'Rollback Status', val: uploadRecord.rollback_info ? `Undone at ${uploadRecord.rollback_info.timestamp} by ${uploadRecord.rollback_info.admin_name} (${uploadRecord.rollback_info.reversed_count} reversed)` : 'Active (Not Undone)' }
  ];

  metadata.forEach((m, idx) => {
    const r = sumSheet.addRow(m);
    r.height = 24;
    r.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 10, bold: colNumber === 1 };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  });

  // Sheet 2: Processed Records Breakdown
  const recSheet = workbook.addWorksheet('Processed Students Breakdown');
  recSheet.columns = [
    { header: '#', key: 'seq', width: 6 },
    { header: 'Student ID', key: 'student_id', width: 16 },
    { header: 'Student Name', key: 'name', width: 26 },
    { header: 'Department', key: 'department', width: 16 },
    { header: 'Year', key: 'year', width: 10 },
    { header: 'Validation Status', key: 'v_status', width: 24 },
    { header: 'Result / Attendance Status', key: 'a_status', width: 32 },
    { header: 'Failure / Skip Reason', key: 'reason', width: 45 }
  ];

  recSheet.getRow(1).height = 28;
  recSheet.getRow(1).eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const allRecords = uploadRecord.details && uploadRecord.details.all_rows ? uploadRecord.details.all_rows : [];

  allRecords.forEach((row, idx) => {
    const r = recSheet.addRow({
      seq: idx + 1,
      student_id: row.studentId,
      name: row.studentName,
      department: row.department,
      year: row.year,
      v_status: row.validationStatus,
      a_status: row.attendanceStatus,
      reason: row.failureReason || 'None (Successfully validated)'
    });
    r.height = 22;
    r.eachCell((cell, colNumber) => {
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: (colNumber === 1 || colNumber === 2 || colNumber === 5) ? 'center' : 'left' };
      if (colNumber === 6) {
        if (cell.value === 'Valid') {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF065F46' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF991B1B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generates an Excel report of the entire Upload History and Audit Trail
 */
async function generateUploadHistoryReportExcel(uploads = [], auditLogs = []) {
  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Uploads
  const sheet1 = workbook.addWorksheet('Bulk Upload History');
  sheet1.columns = [
    { header: 'Upload ID', key: 'id', width: 22 },
    { header: 'Filename', key: 'filename', width: 28 },
    { header: 'Admin', key: 'admin', width: 22 },
    { header: 'Uploaded At', key: 'uploaded_at', width: 22 },
    { header: 'Attendance Date', key: 'date', width: 16 },
    { header: 'Session', key: 'session', width: 14 },
    { header: 'Processed', key: 'total', width: 12 },
    { header: 'Marked Present', key: 'marked', width: 15 },
    { header: 'Failed', key: 'failed', width: 12 },
    { header: 'Status', key: 'status', width: 15 }
  ];

  sheet1.getRow(1).height = 28;
  sheet1.getRow(1).eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  uploads.forEach(u => {
    const r = sheet1.addRow({
      id: u.id,
      filename: u.filename,
      admin: `${u.admin_name || ''} (${u.admin_id})`,
      uploaded_at: new Date(u.upload_timestamp).toLocaleString(),
      date: u.attendance_date,
      session: u.session,
      total: u.total_records,
      marked: u.marked_present,
      failed: u.failed_records,
      status: u.status
    });
    r.height = 22;
  });

  // Sheet 2: Audit Logs
  const sheet2 = workbook.addWorksheet('Audit Trail Log');
  sheet2.columns = [
    { header: 'Audit ID', key: 'id', width: 22 },
    { header: 'Event', key: 'event', width: 20 },
    { header: 'Upload ID', key: 'upload_id', width: 22 },
    { header: 'Admin', key: 'admin', width: 22 },
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: 'Details', key: 'details', width: 45 }
  ];

  sheet2.getRow(1).height = 28;
  sheet2.getRow(1).eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  auditLogs.forEach(a => {
    sheet2.addRow({
      id: a.id,
      event: a.event,
      upload_id: a.attendance_upload_id || '-',
      admin: `${a.admin_name || ''} (${a.admin_id})`,
      timestamp: new Date(a.timestamp).toLocaleString(),
      details: JSON.stringify(a.details || {})
    });
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generates formatted Excel export of all system accounts (Module 1)
 */
async function generateUserExportExcel(users = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CampusRide Transport Management System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Institutional User Directory', {
    views: [{ showGridLines: true }]
  });

  sheet.columns = [
    { header: 'User ID', key: 'id', width: 22 },
    { header: 'Full Name', key: 'name', width: 26 },
    { header: 'Email / Username', key: 'email', width: 28 },
    { header: 'Phone Number', key: 'phone', width: 18 },
    { header: 'Role', key: 'role', width: 15 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Department', key: 'department', width: 18 },
    { header: 'Academic Year', key: 'year', width: 18 },
    { header: 'Assigned Route', key: 'route', width: 32 },
    { header: 'Assigned Bus', key: 'bus', width: 20 },
    { header: 'Boarding Stop', key: 'stop', width: 26 },
    { header: 'Must Change Password', key: 'must_change_password', width: 22 },
    { header: 'Created Date', key: 'created_at', width: 22 },
    { header: 'Last Login', key: 'last_login_at', width: 22 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell(cell => {
    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF475569' } },
      left: { style: 'thin', color: { argb: 'FF475569' } },
      bottom: { style: 'medium', color: { argb: 'FF6366F1' } },
      right: { style: 'thin', color: { argb: 'FF475569' } }
    };
  });

  users.forEach((u, idx) => {
    const row = sheet.addRow({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone || 'N/A',
      role: (u.role || '').toUpperCase(),
      status: (u.status || 'active').toUpperCase(),
      department: u.department || 'N/A',
      year: u.academic_year_display || u.class_grade || (u.year === 1 ? '1st Year' : u.year === 2 ? '2nd Year' : u.year === 3 ? '3rd Year' : u.year === 4 ? '4th Year' : 'N/A'),
      route: u.routeName || u.route_id || 'Unassigned',
      bus: u.busNumber || u.bus_id || 'Unassigned',
      stop: u.stopName || u.boarding_stop_id || 'Unassigned',
      must_change_password: u.must_change_password ? 'YES' : 'NO',
      created_at: u.created_at ? new Date(u.created_at).toLocaleString() : 'N/A',
      last_login_at: u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never Logged In'
    });
    row.height = 24;
    row.eachCell((cell, col) => {
      cell.font = { name: 'Segoe UI', size: 9 };
      cell.alignment = { vertical: 'middle', horizontal: (col === 1 || col === 5 || col === 6 || col === 8) ? 'center' : 'left' };
      if (idx % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      if (col === 6) { // Status column
        if (cell.value === 'ACTIVE') {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
        } else {
          cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
        }
      }
    });
  });

  return await workbook.xlsx.writeBuffer();
}

module.exports = {
  generateTemplate,
  parseAndValidateExcel,
  generateAttendanceReportExcel,
  generateUploadReportExcel,
  generateUploadHistoryReportExcel,
  generateUserExportExcel
};
