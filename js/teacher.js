// ============================================================
// teacher.js
// Teacher dashboard logic:
//   - register students, create courses / exams
//   - import answer keys (single or bulk)
//   - AI-assisted grading (runAIOCR / runAllAIOCR)
//   - per-question mark editing, confirm & lock
//   - rankings, bulk reports, AI assistant
// ============================================================
var currentUser = null;
var currentProfile = null;
var allStudents = [];
var allCourses = [];
var allExams = [];
var currentGradingExam = null;
var currentGradingStudent = null;
var currentGradingKeys = [];
var lastUploadedImageUrl = '';
var currentParsedAnswers = {};
var studentScores = {};
var filePreviews = { questionPaper: [], answerKey: [], studentSheets: [] };

function normalizeAnswer(s) {
  if (s === null || s === undefined) return '';
  var t = String(s).toLowerCase();
  t = t.replace(/[\u2018\u2019\u201C\u201D]/g, '');
  t = t.replace(/\s+/g, '');
  t = t.replace(/^[\.\,\;\:\-]+|[\.\,\;\:\-]+$/g, '');
  return t;
}

function escapeQuote(s) {
  return String(s).replace(/'/g, '').replace(/\"/g, '').replace(/\\/g, '');
}

async function init() {
  var userResult = await supabase.auth.getUser();
  if (!userResult.data.user) { window.location.href = 'login.html'; return; }
  currentUser = userResult.data.user;
  var profileResult = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  if (!profileResult.data || profileResult.data.role !== 'teacher') { window.location.href = 'login.html'; return; }
  currentProfile = profileResult.data;
  document.getElementById('teacherName').textContent = currentProfile.full_name;
  await loadAll();
}

// Loads students, courses, exams; refreshes UI tables and dropdowns.
async function loadAll() {
  var studentsResult = await supabase.from('profiles').select('*').eq('role', 'student').order('full_name');
  if (studentsResult.error) { console.error('Student query error:', studentsResult.error); }
  allStudents = studentsResult.data || [];
  console.log('Loaded students:', allStudents.length);

  var coursesResult = await supabase.from('courses').select('*').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  allCourses = coursesResult.data || [];

  var examsResult = await supabase.from('exams').select('*, courses(name)').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  allExams = examsResult.data || [];

  document.getElementById('countStudents').textContent = allStudents.length;
  document.getElementById('countCourses').textContent = allCourses.length;
  document.getElementById('countExams').textContent = allExams.length;

  await loadStudentScores();
  renderStudents();
  renderCourses();
  renderExams();
  populateCourseDropdown();
  populateExamDropdowns();
}

async function loadStudentScores() {
  studentScores = {};
  var subs = await supabase.from('submissions').select('student_id, total_score, total_possible, status').eq('status', 'graded');
  if (!subs.data) return;
  subs.data.forEach(function (s) {
    if (!studentScores[s.student_id]) studentScores[s.student_id] = { total: 0, max: 0, count: 0 };
    studentScores[s.student_id].total += (s.total_score || 0);
    studentScores[s.student_id].max += (s.total_possible || 0);
    studentScores[s.student_id].count += 1;
  });
}

async function refreshExams() {
  var examsResult = await supabase.from('exams').select('*, courses(name)').eq('teacher_id', currentUser.id).order('created_at', { ascending: false });
  allExams = examsResult.data || [];
  populateExamDropdowns();
}

function showTab(name) {
  var tabs = ['overview', 'students', 'rank', 'courses', 'exams', 'answers', 'grading', 'ai'];
  tabs.forEach(function (t) {
    document.getElementById('view-' + t).style.display = (t === name) ? 'block' : 'none';
    document.getElementById('tab-' + t).className = (t === name) ? 'active' : '';
  });
  if (name === 'answers') { refreshExams().then(loadAnswerKeyView); }
  if (name === 'rank') { loadCumulativeRankForTeacher(); }
  if (name === 'reports') { initBulkReportFilters(); }
  if (name === 'grading') { refreshExams().then(loadStudentsForGrading); }
  if (name === 'students') { renderStudents(); }
  if (name === 'rank') { loadCumulativeRankForTeacher(); }
  if (name === 'rank') { loadCumulativeRankForTeacher(); }
}

function renderStudents() {
  var searchEl = document.getElementById('studentSearch');
  var term = searchEl ? (searchEl.value || '').toLowerCase().trim() : '';
  var tbody = document.getElementById('studentsTable');
  if (!tbody) return;

  var msgEl = document.getElementById('studentsLoadMsg');
  if (msgEl) msgEl.textContent = '';

  var list = allStudents.filter(function (s) {
    if (!term) return true;
    var sc = studentScores[s.id];
    var scoreStr = sc ? (sc.total + '/' + sc.max) : '';
    return (s.full_name || '').toLowerCase().indexOf(term) !== -1 ||
           (s.login_id || '').toLowerCase().indexOf(term) !== -1 ||
           scoreStr.indexOf(term) !== -1;
  });

  tbody.innerHTML = '';

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan=\"8\" style=\"text-align:center;color:#888;\">' +
      (allStudents.length === 0 ? 'No students yet. Register one above.' : 'No students match: ' + term) +
      '</td></tr>';
    return;
  }

  list.forEach(function (s) {
    var sc = studentScores[s.id];
    var scoreStr = sc ? (sc.total + ' / ' + sc.max + ' (' + sc.count + ' exams)') : '-';
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (s.full_name || '-') + '</td>' +
      '<td>' + (s.login_id || '-') + '</td>' +
      '<td>' + (s.grade_level || '-') + '</td>' +
      '<td>' + (s.section || '-') + '</td>' +
      '<td>' + (s.field || '-') + '</td>' +
      '<td><b>' + scoreStr + '</b></td>' +
      '<td>' + (s.email ? 'Yes' : 'No') + '</td>' +
      '<td>' +
        '<button onclick=\"showStudentDetail(\'' + s.id + '\')\" style="background:#1a73e8;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">View</button> ' +
        '<button onclick=\"printStudentFullReport(\'' + s.id + '\')\" style="background:#6c5ce7;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">ðŸ–¨ï¸ Print</button> ' +
        '<button onclick=\"downloadTeacherStudentPDF(\'' + s.id + '\')\" style="background:#e67e22;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">ðŸ“¥ PDF</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

async function showStudentDetail(studentId) {
  var card = document.getElementById('studentDetailCard');
  card.style.display = 'block';

  var student = allStudents.filter(function (s) { return s.id === studentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  document.getElementById('sdTitle').textContent = 'Student: ' + student.full_name;
  document.getElementById('sdInfo').innerHTML =
    '<div class=\"stat\">ID: <b>' + student.login_id + '</b></div>' +
    '<div class=\"stat\">Grade: <b>' + (student.grade_level || '-') + '</b></div>' +
    '<div class=\"stat\">Section: <b>' + (student.section || '-') + '</b></div>' +
    '<div class=\"stat\">Field: <b>' + (student.field || '-') + '</b></div>';

  document.getElementById('sdResults').innerHTML = 'Loading...';

  var subsRes = await supabase
    .from('submissions')
    .select('*, exams(id, title, total_marks, courses(name))')
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: false });

  var subs = subsRes.data || [];

  var grandTotal = 0, grandMax = 0;
  subs.forEach(function (s) {
    grandTotal += (s.total_score || 0);
    grandMax += (s.total_possible || 0);
  });

  document.getElementById('sdInfo').innerHTML +=
    '<div class=\"stat\" style=\"background:#1a73e8;color:white;\">Grand Total: <b style=\"color:white;\">' + grandTotal + ' / ' + grandMax + '</b></div>';

  var rankRes = await supabase.from('student_rankings').select('*').eq('student_id', studentId).order('exam_title');
  var rankHtml = '';
  if (rankRes.data && rankRes.data.length > 0) {
    rankHtml = '<table style=\"margin-top:8px;\"><thead><tr>' +
      '<th>Exam</th><th>Grade</th><th>Field</th><th>Score</th><th>%</th>' +
      '<th>Class Avg</th><th>Avg %</th><th>Rank</th><th>Position</th>' +
      '</tr></thead><tbody>';
    rankRes.data.forEach(function (r) {
      var pos = parseFloat(r.position_percentile);
      var posText = isNaN(pos) ? '-' : (pos <= 25 ? 'Top ' + pos + '%' : 'Position ' + pos + '%');
      var scoreColor = '#1a73e8';
      if ((r.score_percent || 0) >= 80) scoreColor = '#00b894';
      else if ((r.score_percent || 0) < 50) scoreColor = '#e74c3c';

      rankHtml += '<tr>' +
        '<td><b>' + (r.exam_title || '-') + '</b></td>' +
        '<td>' + (r.grade_level || '-') + '</td>' +
        '<td>' + (r.field || '-') + '</td>' +
        '<td>' + (r.total_score || 0) + ' / ' + (r.total_possible || 0) + '</td>' +
        '<td style=\"color:' + scoreColor + ';font-weight:bold;\">' + (r.score_percent || 0) + '%</td>' +
        '<td>' + (r.avg_score || 0) + ' / ' + (r.avg_possible || 0) + '</td>' +
        '<td>' + (r.avg_percent || 0) + '%</td>' +
        '<td><b style=\"color:#1a73e8;\">' + (r.rank_overall || '-') + ' / ' + (r.total_submissions || '-') + '</b></td>' +
        '<td><b>' + posText + '</b></td>' +
        '</tr>';
    });
    rankHtml += '</tbody></table>';
  } else {
    rankHtml = '<p style=\"color:#888;font-size:13px;\">No rankings yet.</p>';
  }
  document.getElementById('sdRank').innerHTML = '<h4 style=\"margin-top:16px;\">Ranking & Performance</h4>' + rankHtml;

  if (subs.length === 0) {
    document.getElementById('sdResults').innerHTML = '<p style=\"color:#888;\">No graded exams yet.</p>';
    return;
  }

  var html = '';
  for (var i = 0; i < subs.length; i++) {
    var s = subs[i];
    var examTotal = s.total_possible || s.exams.total_marks;
    html += '<div style=\"background:#f7f9fc;padding:10px;border-radius:6px;margin-bottom:12px;\">';
    html += '<p style=\"margin:0 0 8px 0;font-weight:bold;\">' + s.exams.title + ' (' + (s.exams.courses ? s.exams.courses.name : '-') + ') â€” Score: ' + (s.total_score || 0) + ' / ' + examTotal + '</p>';

    var answersRes = await supabase.from('submission_answers').select('*').eq('submission_id', s.id).order('question_number');
    var answers = answersRes.data || [];
    var keysRes = await supabase.from('answer_keys').select('*').eq('exam_id', s.exam_id).order('question_number');
    var keys = keysRes.data || [];

    if (answers.length === 0) {
      html += '<p style=\"font-size:13px;color:#888;\">No detailed answers.</p>';
    } else {
      html += '<table><thead><tr><th>Q#</th><th>Question</th><th>Student</th><th>Correct</th><th>Result</th><th>Marks</th></tr></thead><tbody>';
      answers.forEach(function (a) {
        var keyRow = keys.filter(function (k) { return k.question_number === a.question_number; })[0];
        var cls = a.is_correct ? 'correct' : 'incorrect';
        var icon = a.is_correct ? '\u2713' : '\u2717';
        html += '<tr><td>' + a.question_number + '</td>' +
          '<td>' + (keyRow && keyRow.question_text ? keyRow.question_text : '-') + '</td>' +
          '<td>' + (a.student_answer || '-') + '</td>' +
          '<td>' + (keyRow ? keyRow.correct_answer : '-') + '</td>' +
          '<td class=\"' + cls + '\">' + icon + '</td>' +
          '<td>' + (a.awarded_marks || 0) + ' / ' + (keyRow ? keyRow.marks : '?') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
  }
  document.getElementById('sdResults').innerHTML = html;
}

// Registers a student via the teacher_preregister_student RPC.
async function addStudent() {
  var msgEl = document.getElementById('sMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  var fullName = document.getElementById('sFullName').value.trim();
  var loginId  = document.getElementById('sLoginId').value.trim();
  var phone    = document.getElementById('sPhone').value.trim();
  var grade    = document.getElementById('sGrade').value.trim();
  var section  = document.getElementById('sSection').value.trim();
  var field    = document.getElementById('sField').value.trim();
  if (!fullName || !loginId) { msgEl.className = 'msg err'; msgEl.textContent = 'Name and ID required.'; return; }
  var result = await supabase.rpc('teacher_preregister_student', {
    p_full_name: fullName, p_login_id: loginId,
    p_phone: phone || null, p_grade_level: grade || null,
    p_section: section || null, p_field: field || null
  });
  if (result.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + result.error.message; return; }
  msgEl.className = 'msg ok'; msgEl.textContent = 'Student registered: ' + fullName;
  ['sFullName','sLoginId','sPhone','sGrade','sSection','sField'].forEach(function (id) { document.getElementById(id).value = ''; });
  await loadAll();
}

// Creates a course for the logged-in teacher.
async function addCourse() {
  var msgEl = document.getElementById('cMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  var name = document.getElementById('cName').value.trim();
  var code = document.getElementById('cCode').value.trim();
  var grade = document.getElementById('cGrade').value.trim();
  if (!name) { msgEl.className = 'msg err'; msgEl.textContent = 'Course Name required.'; return; }
  var result = await supabase.from('courses').insert({ teacher_id: currentUser.id, name: name, code: code || null, grade_level: grade || null });
  if (result.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + result.error.message; return; }
  msgEl.className = 'msg ok'; msgEl.textContent = 'Course created: ' + name;
  document.getElementById('cName').value = ''; document.getElementById('cCode').value = ''; document.getElementById('cGrade').value = '';
  await loadAll();
}

// Creates an exam under the currently selected course.
async function addExam() {
  var msgEl = document.getElementById('eMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  var courseId = document.getElementById('eCourse').value;
  var title = document.getElementById('eTitle').value.trim();
  var marks = parseInt(document.getElementById('eMarks').value, 10);
  if (!courseId || !title || !marks) { msgEl.className = 'msg err'; msgEl.textContent = 'All fields required.'; return; }
  var result = await supabase.from('exams').insert({ course_id: courseId, teacher_id: currentUser.id, title: title, total_marks: marks });
  if (result.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + result.error.message; return; }
  msgEl.className = 'msg ok'; msgEl.textContent = 'Exam created: ' + title;
  document.getElementById('eTitle').value = ''; document.getElementById('eMarks').value = '';
  await loadAll();
}

// Parses pasted answers and imports the whole answer key at once.
async function addBulkAnswerKey() {
  var msgEl = document.getElementById('akBulkMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  var examId = document.getElementById('akExam').value;
  var bulkText = document.getElementById('akBulk').value.trim();
  var bulkQuestionsEl = document.getElementById('akBulkQuestions');
  var bulkQuestions = bulkQuestionsEl ? bulkQuestionsEl.value.trim() : '';
  var defaultMarks = parseInt(document.getElementById('akBulkMarks').value, 10) || 1;
  if (!examId) { msgEl.className = 'msg err'; msgEl.textContent = 'Select an exam.'; return; }
  if (!bulkText) { msgEl.className = 'msg err'; msgEl.textContent = 'Paste answers first.'; return; }
  if (!bulkQuestions) { msgEl.className = 'msg err'; msgEl.textContent = 'Please enter questions too.'; return; }

  var normalized = bulkText.replace(/\r/g, '').replace(/[,\n;]/g, ' ').replace(/\s+/g, ' ').trim();
  var answers = {};
  var re = /(?:Q\s*)?(\d{1,3})\s*[\.\,\)\:\=\-]?\s*([A-Za-z0-9]+)/g, m;
  while ((m = re.exec(normalized)) !== null) {
    var q = parseInt(m[1], 10);
    if (!answers[q]) answers[q] = m[2];
  }
  var keys = Object.keys(answers);
  if (keys.length === 0) { msgEl.className = 'msg err'; msgEl.textContent = 'No answers found.'; return; }

  var questions = {};
  var qFlat = bulkQuestions.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  var qRe = /(\d{1,3})\s*[\.\)\:\=\-]\s*(.*?)(?=\s+\d{1,3}\s*[\.\)\:\=\-]|$)/g, qm;
  while ((qm = qRe.exec(qFlat)) !== null) {
    var qn = parseInt(qm[1], 10);
    var qt = qm[2].trim();
    if (qt) questions[qn] = qt;
  }

  await supabase.from('answer_keys').delete().eq('exam_id', examId);

  var insertedCount = 0, failedCount = 0, lastError = '', totalMarks = 0;
  for (var i = 0; i < keys.length; i++) {
    var qNum = parseInt(keys[i], 10);
    var result = await supabase.from('answer_keys').insert({
      exam_id: examId, question_number: qNum,
      question_text: questions[qNum] || null,
      correct_answer: answers[keys[i]],
      marks: defaultMarks, is_workout: false
    });
    if (result.error) { failedCount++; lastError = result.error.message; }
    else { insertedCount++; totalMarks += defaultMarks; }
  }

  if (insertedCount > 0) await supabase.from('exams').update({ total_marks: totalMarks }).eq('id', examId);

  msgEl.className = 'msg ok';
  msgEl.textContent = 'Imported ' + insertedCount + ' question(s) totaling ' + totalMarks + ' marks.' + (failedCount > 0 ? ' Failed: ' + failedCount : '');
  document.getElementById('akBulk').value = '';
  if (bulkQuestionsEl) bulkQuestionsEl.value = '';
  document.getElementById('akViewExam').value = examId;
  await loadAnswerKeyView();
  await loadAll();
}

async function clearAnswerKey() {
  var examId = document.getElementById('akViewExam').value;
  if (!examId) { toast('Select an exam.', 'info'); return; }
  if (!confirm('Delete all answer keys for this exam?')) return;
  await supabase.from('answer_keys').delete().eq('exam_id', examId);
  await loadAnswerKeyView();
}

async function loadAnswerKeyView() {
  var examId = document.getElementById('akViewExam').value;
  var tbody = document.getElementById('akTable');
  tbody.innerHTML = '';
  if (!examId) return;
  var result = await supabase.from('answer_keys').select('*').eq('exam_id', examId).order('question_number');
  var rows = result.data || [];
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center;color:#888;\">No questions yet.</td></tr>';
    return;
  }
  rows.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + r.question_number + '</td>' +
      '<td>' + (r.question_text || '-') + '</td>' +
      '<td>' + r.correct_answer + '</td>' +
      '<td><input type=\"number\" id=\"akm_' + r.id + '\" value=\"' + r.marks + '\" style=\"width:70px;padding:4px;\" /></td>' +
      '<td>' + (r.is_workout ? 'Workout' : 'Auto') + '</td>' +
      '<td><button onclick=\"saveQuestionMarks(\'' + r.id + '\')\">Save</button></td>';
    tbody.appendChild(tr);
  });
}

async function saveQuestionMarks(keyId) {
  var val = parseInt(document.getElementById('akm_' + keyId).value, 10);
  if (!val || val <= 0) { toast('Invalid marks.', 'error'); return; }
  await supabase.from('answer_keys').update({ marks: val }).eq('id', keyId);
  var examId = document.getElementById('akViewExam').value;
  var r = await supabase.from('answer_keys').select('marks').eq('exam_id', examId);
  var sum = 0;
  if (r.data) r.data.forEach(function (k) { sum += (k.marks || 0); });
  await supabase.from('exams').update({ total_marks: sum }).eq('id', examId);
  alert('Marks saved. Exam total is now ' + sum + '.');
  await loadAnswerKeyView();
  await loadAll();
}

async function loadStudentsForGrading() {
  var sel = document.getElementById('grStudent');
  sel.innerHTML = '<option value=\"\">-- Select a student --</option>';
  allStudents.forEach(function (s) {
    var opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.full_name + ' (' + s.login_id + ')';
    sel.appendChild(opt);
  });
}

// Builds the per-question input form for a chosen exam and student.
async function startGrading() {
  var examId = document.getElementById('grExam').value;
  var studentId = document.getElementById('grStudent').value;
  var msgEl = document.getElementById('grMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  if (!examId || !studentId) { msgEl.className = 'msg err'; msgEl.textContent = 'Select exam and student.'; return; }
  var keys = await supabase.from('answer_keys').select('*').eq('exam_id', examId).order('question_number');
  if (!keys.data || keys.data.length === 0) { msgEl.className = 'msg err'; msgEl.textContent = 'No answer key.'; return; }
  currentGradingExam = examId; currentGradingStudent = studentId;
  currentGradingKeys = keys.data;
  lastUploadedImageUrl = ''; currentParsedAnswers = {};
  filePreviews.studentSheets = [];
  renderFileList('studentSheets');
  var container = document.getElementById('gradingQuestions');
  container.innerHTML = '';
  keys.data.forEach(function (k) {
    var div = document.createElement('div');
    div.style.marginBottom = '12px';
    div.innerHTML =
      '<label style=\"display:block;font-weight:bold;margin-bottom:4px;\">Q' + k.question_number + ': ' + (k.question_text || '') + ' (' + k.marks + ' marks)</label>' +
      '<input type=\"text\" id=\"ga_' + k.question_number + '\" placeholder=\"Student answer\" style=\"width:100%;padding:8px;\" />';
    container.appendChild(div);
  });
  document.getElementById('gradingForm').style.display = 'block';
  document.getElementById('ocrCard').style.display = 'block';
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadAnswerSheet(file, studentId) {
  var timestamp = Date.now();
  var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  var path = studentId + '/' + timestamp + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  var uploadResult = await supabase.storage.from('answer-sheets').upload(path, file, { cacheControl: '3600', upsert: true });
  if (uploadResult.error) throw new Error('Upload failed: ' + uploadResult.error.message);
  var urlResult = supabase.storage.from('answer-sheets').getPublicUrl(path);
  return urlResult.data.publicUrl;
}

// Runs Tesseract OCR in the browser for printed answer sheets.
async function runLocalOCR() {
  var fileInput = document.getElementById('ocrFile');
  var msgEl = document.getElementById('ocrMsg');
  var progEl = document.getElementById('ocrProgress');
  msgEl.className = 'msg'; msgEl.textContent = ''; progEl.textContent = '';
  if (!fileInput.files || fileInput.files.length === 0) { msgEl.className = 'msg err'; msgEl.textContent = 'Choose an image.'; return; }
  var file = fileInput.files[0];
  try { lastUploadedImageUrl = await uploadAnswerSheet(file, currentGradingStudent); }
  catch (upErr) { msgEl.className = 'msg err'; msgEl.textContent = upErr.message; }
  progEl.textContent = 'Loading OCR...';
  try {
    var result = await Tesseract.recognize(file, 'eng', {
      logger: function (m) { progEl.textContent = m.status === 'recognizing text' ? 'Reading: ' + Math.round(m.progress * 100) + '%' : m.status + '...'; }
    });
    progEl.textContent = 'Done.';
    document.getElementById('ocrText').textContent = result.data.text || '';
    document.getElementById('ocrPreview').style.display = 'block';
    applyOcrToInputs(result.data.text || '');
  } catch (e) { msgEl.className = 'msg err'; msgEl.textContent = 'OCR failed: ' + e.message; progEl.textContent = ''; }
}

function applyOcrToInputs(text) {
  var normalized = text.replace(/\r/g, '').replace(/[,\n;]/g, ' ').replace(/\s+/g, ' ').trim();
  var answers = {};
  var re1 = /(?:Q\s*)?(\d{1,3})\s*[\.\,\)\:\=\-]\s*([A-Za-z0-9]+)/g, m;
  while ((m = re1.exec(normalized)) !== null) { var q = parseInt(m[1], 10); var a = m[2].toUpperCase(); if (!answers[q]) answers[q] = a; }
  var re2 = /\b(\d{1,3})\s+([A-Za-z])\b/g;
  while ((m = re2.exec(normalized)) !== null) { var q2 = parseInt(m[1], 10); var a2 = m[2].toUpperCase(); if (!answers[q2]) answers[q2] = a2; }
  var re3 = /\b(\d{1,3})([A-Za-z])\b/g;
  while ((m = re3.exec(normalized)) !== null) { var q3 = parseInt(m[1], 10); var a3 = m[2].toUpperCase(); if (!answers[q3]) answers[q3] = a3; }
  currentParsedAnswers = answers;
  var filled = 0;
  currentGradingKeys.forEach(function (k) {
    var input = document.getElementById('ga_' + k.question_number);
    if (input && answers[k.question_number]) { input.value = answers[k.question_number]; input.style.background = '#fff8dc'; filled++; }
  });
  var msgEl = document.getElementById('ocrMsg');
  if (filled > 0) { msgEl.className = 'msg ok'; msgEl.textContent = 'Filled ' + filled + ' answer(s).'; }
  else { msgEl.className = 'msg err'; msgEl.textContent = 'No answers detected.'; }
}

// Compares answers with the key, saves the submission, and shows the result table.
async function submitGrading() {
  var msgEl = document.getElementById('grResultMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  var keys = await supabase.from('answer_keys').select('*').eq('exam_id', currentGradingExam).order('question_number');
  if (!keys.data) { msgEl.className = 'msg err'; msgEl.textContent = 'No answer key.'; return; }
  var totalScore = 0, totalPossible = 0, breakdown = [];
  var submissionResult = await supabase.from('submissions').insert({
    exam_id: currentGradingExam, student_id: currentGradingStudent, status: 'pending',
    storage_path: lastUploadedImageUrl || null
  }).select().single();
  if (submissionResult.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + submissionResult.error.message; return; }
  var submissionId = submissionResult.data.id;
  for (var i = 0; i < keys.data.length; i++) {
    var k = keys.data[i];
    var input = document.getElementById('ga_' + k.question_number);
    var domAnswer = input ? input.value.trim() : '';
    var memAnswer = currentParsedAnswers[k.question_number] || '';
    var studentAns = domAnswer || memAnswer;
    totalPossible += k.marks;
    var isCorrect = false, awarded = 0, declaration = '';
    if (k.is_workout) { isCorrect = true; awarded = k.marks; declaration = 'Workout.'; }
    else {
      var nStudent = normalizeAnswer(studentAns);
      var nCorrect = normalizeAnswer(k.correct_answer);
      if (nStudent === nCorrect && nStudent !== '') { isCorrect = true; awarded = k.marks; declaration = 'Correct.'; }
      else { isCorrect = false; awarded = 0; declaration = 'Incorrect. Correct: ' + k.correct_answer; }
    }
    totalScore += awarded;
    breakdown.push({ q: k.question_number, question: k.question_text || '', student: studentAns || '(blank)', correct: k.correct_answer, isCorrect: isCorrect, awarded: awarded, maxMarks: k.marks });
    await supabase.from('submission_answers').insert({
      submission_id: submissionId, question_number: k.question_number,
      student_answer: studentAns || '(blank)', is_correct: isCorrect,
      awarded_marks: awarded, declaration: declaration
    });
  }
  await supabase.from('submissions').update({
    total_score: totalScore, total_possible: totalPossible, status: 'graded', graded_at: new Date().toISOString()
  }).eq('id', submissionId);
  msgEl.className = 'msg ok';
  msgEl.textContent = 'Results saved. Score: ' + totalScore + ' / ' + totalPossible;
  var form = document.getElementById('gradingForm');
  var ocr = document.getElementById('ocrCard');
  var resultHtml = '<h3>Grading Result \u2014 ' + totalScore + ' / ' + totalPossible + '</h3>';
  resultHtml += '<table><thead><tr><th>Q#</th><th>Question</th><th>Student Answer</th><th>Correct</th><th>Result</th><th>Marks</th><th>Explain</th></tr></thead><tbody>';
  breakdown.forEach(function (b) {
    var cls = b.isCorrect ? 'correct' : 'incorrect';
    var icon = b.isCorrect ? '\u2713 Correct' : '\u2717 Wrong';
    resultHtml += '<tr>' +
      '<td>' + b.q + '</td>' +
      '<td>' + (b.question || '-') + '</td>' +
      '<td>' + b.student + '</td>' +
      '<td>' + b.correct + '</td>' +
      '<td class=\"' + cls + '\">' + icon + '</td>' +
      '<td>' + b.awarded + ' / ' + b.maxMarks + '</td>' +
      '<td><button onclick=\"explainTeacherAnswer(' + b.q + ', \'' + escapeQuote(b.question) + '\', \'' + escapeQuote(b.student) + '\', \'' + escapeQuote(b.correct) + '\', ' + (b.isCorrect ? 'true' : 'false') + ')\">Describe</button></td>' +
      '</tr>';
  });
  resultHtml += '</tbody></table>';
  resultHtml += '<div id=\"teacherExplainOutput\"></div>';
  resultHtml += '<div style=\"text-align:center;margin-top:20px;\"><button class=\"primary\" onclick=\"location.reload()\">Grade Another Student</button></div>';
  if (form) { form.innerHTML = resultHtml; form.style.display = 'block'; }
  if (ocr) { ocr.style.display = 'none'; }
}

// Calls Groq to generate a factual explanation for a single answer.
async function explainTeacherAnswer(qNum, questionText, studentAns, correctAns, isCorrect) {
  var out = document.getElementById('teacherExplainOutput');
  out.innerHTML = '<p style="color:#666;margin-top:12px;">AI is thinking...</p>';

  var prompt = 'You are a school teacher. Give a REAL, FACTUAL, SPECIFIC explanation. NO placeholders.\n\n';
  if (questionText && questionText.length > 2) prompt += 'QUESTION: ' + questionText + '\n';
  prompt += 'CORRECT ANSWER: ' + correctAns + '\n';
  prompt += 'STUDENT ANSWER: ' + studentAns + '\n\n';
  prompt += 'Write 4-5 sentences:\n1. State the correct answer.\n2. Give 1-2 REAL facts.\n3. ' + (isCorrect ? 'Confirm the student.' : 'Explain why ' + studentAns + ' is wrong.') + '\nReal facts only.';

  try {
    var text = await callGroqChat(prompt, 600, 0);
    out.innerHTML = '<div style="background:#eef6ff;padding:12px;border-radius:6px;margin-top:12px;font-size:14px;"><b>Q' + qNum + ':</b> ' + text + '</div>';
  } catch (e) {
    out.innerHTML = '<p style="color:red;margin-top:12px;">Error: ' + e.message + '</p>';
  }
}
function populateCourseDropdown() {
  var sel = document.getElementById('eCourse');
  sel.innerHTML = '<option value=\"\">-- Select a course --</option>';
  allCourses.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name + (c.code ? ' (' + c.code + ')' : '');
    sel.appendChild(opt);
  });
}

function populateExamDropdowns() {
  var ids = ['akExam', 'akSingleExam', 'akViewExam', 'grExam', 'editExamSelect'];
  var base = '<option value=\"\">-- Select an exam --</option>';
  ids.forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = base;
    allExams.forEach(function (e) {
      var opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.title + ' \u2014 ' + (e.courses ? e.courses.name : '');
      el.appendChild(opt);
    });
  });
}

function renderCourses() {
  var tbody = document.getElementById('coursesTable');
  tbody.innerHTML = '';
  allCourses.forEach(function (c) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + c.name + '</td><td>' + (c.code || '-') + '</td><td>' + (c.grade_level || '-') + '</td>';
    tbody.appendChild(tr);
  });
}

function renderExams() {
  var tbody = document.getElementById('examsTable');
  tbody.innerHTML = '';
  allExams.forEach(function (e) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + e.title + '</td>' +
      '<td>' + (e.courses ? e.courses.name : '-') + '</td>' +
      '<td>' + e.total_marks + '</td>' +
      '<td>' + (e.is_confirmed ? 'Confirmed' : 'Open') + '</td>' +
      '<td>' +
        '<button onclick="printExamResults(\'' + e.id + '\')" style="background:#6c5ce7;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">ðŸ–¨ï¸ Print</button> ' +
        '<button onclick="openDownloadModal(\'' + e.id + '\')" style="background:#28a745;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">ðŸ“¥ Download</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

async function updateExamTotal() {
  var examId = document.getElementById('editExamSelect').value;
  var newTotal = parseInt(document.getElementById('editTotalMarks').value, 10);
  var msgEl = document.getElementById('editExamMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  if (!examId || !newTotal) { msgEl.className = 'msg err'; msgEl.textContent = 'Select exam and enter total.'; return; }
  var r = await supabase.from('exams').update({ total_marks: newTotal }).eq('id', examId);
  if (r.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + r.error.message; return; }
  msgEl.className = 'msg ok'; msgEl.textContent = 'Total updated to ' + newTotal + '.';
  document.getElementById('editTotalMarks').value = '';
  await loadAll();
}

// ====== MULTI-FILE HANDLING ======

function addFilesToPreview(kind) {
  var inputId = kind === 'questionPaper' ? 'questionPaperFile' : kind === 'answerKey' ? 'answerKeyFile' : 'ocrFile';
  var input = document.getElementById(inputId);
  if (!input.files || input.files.length === 0) { toast('Choose file(s) first.', 'info'); return; }
  for (var i = 0; i < input.files.length; i++) {
    filePreviews[kind].push({ file: input.files[i], name: input.files[i].name, size: Math.round(input.files[i].size / 1024) + ' KB' });
  }
  input.value = '';
  renderFileList(kind);
}

function renderFileList(kind) {
  var containerId = kind === 'questionPaper' ? 'qpFileList' : kind === 'answerKey' ? 'akFileList' : 'stFileList';
  var el = document.getElementById(containerId);
  if (!el) return;
  if (filePreviews[kind].length === 0) { el.innerHTML = ''; return; }
  var html = '<table style=\"font-size:13px;\"><thead><tr><th>File</th><th>Size</th><th>Remove</th></tr></thead><tbody>';
  filePreviews[kind].forEach(function (f, idx) {
    html += '<tr><td>' + f.name + '</td><td>' + f.size + '</td>' +
      '<td><button onclick=\"removeFile(\'' + kind + '\', ' + idx + ')\" style=\"background:#e74c3c;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;\">Delete</button></td></tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function removeFile(kind, idx) {
  filePreviews[kind].splice(idx, 1);
  renderFileList(kind);
}

async function readAllQuestionPapers() {
  var msgEl = document.getElementById('qpMsg');
  var progEl = document.getElementById('qpProgress');
  msgEl.className = 'msg'; msgEl.textContent = ''; progEl.textContent = '';
  if (filePreviews.questionPaper.length === 0) { msgEl.className = 'msg err'; msgEl.textContent = 'Add files first.'; return; }
  var allQuestions = '';
  for (var i = 0; i < filePreviews.questionPaper.length; i++) {
    progEl.textContent = 'Reading question paper ' + (i + 1) + ' of ' + filePreviews.questionPaper.length + '...';
    try {
      var base64 = await fileToBase64(filePreviews.questionPaper[i].file);
      var prompt = 'Extract every numbered question from this page. Return ONLY like: 1.Question text 2.Question text.';
      var text = await callGroqVision(prompt, base64, 800);
      allQuestions += ' ' + text.replace(/\r/g, '').replace(/\n+/g, ' ').trim();
    } catch (e) { console.error('Page ' + (i + 1), e); }
  }
  document.getElementById('akBulkQuestions').value = allQuestions.trim();
  progEl.textContent = 'Done.';
  msgEl.className = 'msg ok'; msgEl.textContent = 'Questions extracted from ' + filePreviews.questionPaper.length + ' page(s).';
}

async function readAllAnswerKeys() {
  var msgEl = document.getElementById('akImgMsg');
  var progEl = document.getElementById('akImgProgress');
  msgEl.className = 'msg'; msgEl.textContent = ''; progEl.textContent = '';
  if (filePreviews.answerKey.length === 0) { msgEl.className = 'msg err'; msgEl.textContent = 'Add files first.'; return; }
  var allAnswers = '';
  for (var i = 0; i < filePreviews.answerKey.length; i++) {
    progEl.textContent = 'Reading answer key ' + (i + 1) + ' of ' + filePreviews.answerKey.length + '...';
    try {
      var base64 = await fileToBase64(filePreviews.answerKey[i].file);
      var prompt = 'Extract question numbers and correct answers. Return ONLY: 1.A 2.B 3.C.';
      var text = await callGroqVision(prompt, base64, 800);
      allAnswers += ' ' + text.replace(/\r/g, '').replace(/\n+/g, ' ').trim();
    } catch (e) { console.error('Answer page ' + (i + 1), e); }
  }
  document.getElementById('akBulk').value = allAnswers.trim();
  progEl.textContent = 'Done.';
  msgEl.className = 'msg ok'; msgEl.textContent = 'Answers extracted from ' + filePreviews.answerKey.length + ' page(s).';
}

// Sends multiple answer sheet pages to Groq Vision and merges the answers.
async function runAllAIOCR() {
  var msgEl = document.getElementById('ocrMsg');
  var progEl = document.getElementById('ocrProgress');
  msgEl.className = 'msg'; msgEl.textContent = ''; progEl.textContent = '';

  var aiBtn = document.querySelector('button[onclick="runAllAIOCR()"]');
  if (aiBtn) setButtonLoading(aiBtn, 'AI Reading...');

  if (filePreviews.studentSheets.length === 0) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'Add at least one answer sheet file first.';
    return;
  }

  var allAnswers = {};
  var errors = [];

  for (var i = 0; i < filePreviews.studentSheets.length; i++) {
    progEl.textContent = 'Reading sheet ' + (i + 1) + ' of ' + filePreviews.studentSheets.length + '...';

    try {
      var file = filePreviews.studentSheets[i].file;
      var url = await uploadAnswerSheet(file, currentGradingStudent);
      if (i === 0) lastUploadedImageUrl = url;

      var base64 = await fileToBase64(file);
      var prompt = 'You are an OCR assistant reading a student answer sheet. Extract every question number and its answer. Return ONLY in this format, one per line: 1=A 2=B 3=C. If the sheet uses "1. A" or "1) A" or "Q1: A" that is fine. No other text.';

      var text = await callGroqVision(prompt, base64, 800);
      console.log('Sheet ' + (i + 1) + ' raw response:', JSON.stringify(text));

      if (!text || !text.trim()) {
        errors.push('Sheet ' + (i + 1) + ': AI returned empty.');
        continue;
      }

      // Parse answers flexibly
      var normalized = text.replace(/\r/g, '').replace(/[,\n;]/g, ' ').replace(/\s+/g, ' ').trim();
      var re = /(?:Q\s*)?(\d{1,3})\s*[\.\,\)\:\=\-]?\s*([A-Za-z0-9]+)/g;
      var m;
      var foundOnThisPage = 0;
      while ((m = re.exec(normalized)) !== null) {
        var q = parseInt(m[1], 10);
        var a = m[2].toUpperCase();
        if (q > 0 && q < 500 && a.length <= 20) {
          if (!allAnswers[q]) { allAnswers[q] = a; foundOnThisPage++; }
        }
      }

      if (foundOnThisPage === 0) {
        errors.push('Sheet ' + (i + 1) + ': no answers parsed from "' + text.substring(0, 60) + '..."');
      }
    } catch (e) {
      console.error('Sheet ' + (i + 1) + ' error:', e);
      errors.push('Sheet ' + (i + 1) + ': ' + e.message);
    }
  }

  currentParsedAnswers = allAnswers;
  var filled = 0;
  currentGradingKeys.forEach(function (k) {
    var input = document.getElementById('ga_' + k.question_number);
    if (input && allAnswers[k.question_number]) {
      input.value = allAnswers[k.question_number];
      input.style.background = '#fff8dc';
      filled++;
    }
  });

  document.getElementById('ocrText').textContent = JSON.stringify(allAnswers, null, 2);
  document.getElementById('ocrPreview').style.display = 'block';
  progEl.textContent = 'Done. Filled ' + filled + ' answer(s).';
  if (aiBtn) clearButtonLoading(aiBtn);

  if (filled > 0) {
    msgEl.className = 'msg ok';
    msgEl.textContent = 'Filled ' + filled + ' answer(s) from ' + filePreviews.studentSheets.length + ' page(s).';
  } else {
    msgEl.className = 'msg err';
    msgEl.textContent = 'Could not detect any answers. ' + (errors.length > 0 ? 'Details: ' + errors.join(' | ') : '');
  }
}


// ====== AI ASSISTANT ======

function showSuggestedQuestions() {
  var suggestions = [
    'How many students do I have?',
    'What is the average score of my students?',
    'Which student has the highest score?',
    'List my exams and their total marks.',
    'How many questions are in the maths exam?',
    'How can I improve my teaching?'
  ];
  var html = '<div style=\"margin-top:12px;\"><p style=\"font-size:12px;color:#666;margin-bottom:6px;\">Suggested questions:</p>';
  suggestions.forEach(function (s) {
    html += '<button class=\"link\" onclick=\"useAiSuggestion(\'' + escapeQuote(s) + '\')\" style=\"margin-right:8px;margin-bottom:6px;\">' + s + '</button>';
  });
  html += '</div>';
  document.getElementById('aiSuggestions').innerHTML = html;
}

function useAiSuggestion(text) {
  document.getElementById('aiQuestion').value = text;
  askAI();
}

async function askAI() {
  var q = document.getElementById('aiQuestion').value.trim();
  var out = document.getElementById('aiAnswer');
  if (!q) { out.textContent = 'Type a question first.'; return; }

  var userResult = await supabase.auth.getUser();
  if (!userResult.data.user) { out.textContent = 'You are not logged in.'; return; }

  var profileResult = await supabase.from('profiles').select('*').eq('id', userResult.data.user.id).single();
  if (!profileResult.data) { out.textContent = 'Could not load your profile.'; return; }

  var imageBase64 = null;
  var fileInput = document.getElementById('aiTeacherFile');
  if (fileInput && fileInput.files && fileInput.files[0]) {
    out.textContent = 'Reading your image...';
    try { imageBase64 = await fileToBase64(fileInput.files[0]); } catch (e) { imageBase64 = null; }
  }

  out.textContent = 'Thinking...';
  try {
    var examsResult = await supabase.from('exams').select('*, courses(name)').eq('teacher_id', userResult.data.user.id);
    var studentsResult = await supabase.from('profiles').select('id, full_name, login_id, grade_level, section, field').eq('role', 'student').limit(50);
    var answer = await askAIForTeacher(q, profileResult.data, examsResult.data || [], studentsResult.data || [], imageBase64);
    out.textContent = answer;
    if (typeof clearAiTeacherImage === 'function') clearAiTeacherImage();
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}
init();



var cumulativeRanksCache = [];

async function loadCumulativeRankForTeacher() {
  var container = document.getElementById('rankFullTable');
  if (!container) return;
  container.innerHTML = 'Loading...';

  var r = await supabase.from('cumulative_rankings').select('*').order('cumulative_rank');
  if (r.error || !r.data) {
    container.innerHTML = '<p style=\"color:red;\">Error: ' + (r.error ? r.error.message : 'no data') + '</p>';
    return;
  }
  cumulativeRanksCache = r.data;
  renderCumulativeRankTable();
}

function renderCumulativeRankTable() {
  var container = document.getElementById('rankFullTable');
  if (!container) return;

  var term = (document.getElementById('rankSearch').value || '').toLowerCase().trim();
  var list = cumulativeRanksCache.filter(function (x) {
    if (!term) return true;
    return (x.full_name || '').toLowerCase().indexOf(term) !== -1 ||
           (x.login_id || '').toLowerCase().indexOf(term) !== -1 ||
           (x.grade_level || '').toLowerCase().indexOf(term) !== -1 ||
           (x.field || '').toLowerCase().indexOf(term) !== -1;
  });

  if (list.length === 0) {
    container.innerHTML = '<p style=\"color:#888;\">No matches.</p>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th>' +
    '<th>Total Score</th><th>Percent</th><th>Avg %</th><th>Exams</th>' +
    '</tr></thead><tbody>';

  list.forEach(function (s) {
    var color = s.cumulative_percent >= 80 ? '#00b894' : s.cumulative_percent >= 50 ? '#1a73e8' : '#e74c3c';
    var medal = s.cumulative_rank === 1 ? 'ðŸ¥‡' : s.cumulative_rank === 2 ? 'ðŸ¥ˆ' : s.cumulative_rank === 3 ? 'ðŸ¥‰' : '';
    html += '<tr>' +
      '<td><b>' + medal + ' #' + s.cumulative_rank + '</b></td>' +
      '<td>' + s.full_name + '</td>' +
      '<td>' + s.login_id + '</td>' +
      '<td>' + (s.grade_level || '-') + '</td>' +
      '<td>' + (s.field || '-') + '</td>' +
      '<td>' + s.cumulative_score + ' / ' + s.cumulative_possible + '</td>' +
      '<td style=\"color:' + color + ';font-weight:bold;\">' + s.cumulative_percent + '%</td>' +
      '<td>' + s.avg_percent + '%</td>' +
      '<td>' + s.exams_taken + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

var cumulativeRanksCache = [];

async function loadCumulativeRankForTeacher() {
  var container = document.getElementById('rankFullTable');
  if (!container) return;
  container.innerHTML = 'Loading...';

  var r = await supabase.from('cumulative_rankings').select('*').order('cumulative_rank');
  if (r.error || !r.data) {
    container.innerHTML = '<p style=\"color:red;\">Error: ' + (r.error ? r.error.message : 'no data') + '</p>';
    return;
  }
  cumulativeRanksCache = r.data;
  renderCumulativeRankTable();
}

function renderCumulativeRankTable() {
  var container = document.getElementById('rankFullTable');
  if (!container) return;

  var term = (document.getElementById('rankSearch').value || '').toLowerCase().trim();
  var list = cumulativeRanksCache.filter(function (x) {
    if (!term) return true;
    return (x.full_name || '').toLowerCase().indexOf(term) !== -1 ||
           (x.login_id || '').toLowerCase().indexOf(term) !== -1 ||
           (x.grade_level || '').toLowerCase().indexOf(term) !== -1 ||
           (x.field || '').toLowerCase().indexOf(term) !== -1;
  });

  if (list.length === 0) {
    container.innerHTML = '<p style=\"color:#888;\">No matches.</p>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th>' +
    '<th>Total Score</th><th>Percent</th><th>Avg %</th><th>Exams</th>' +
    '</tr></thead><tbody>';

  list.forEach(function (s) {
    var color = s.cumulative_percent >= 80 ? '#00b894' : s.cumulative_percent >= 50 ? '#1a73e8' : '#e74c3c';
    var medal = s.cumulative_rank === 1 ? 'ðŸ¥‡' : s.cumulative_rank === 2 ? 'ðŸ¥ˆ' : s.cumulative_rank === 3 ? 'ðŸ¥‰' : '';
    html += '<tr>' +
      '<td><b>' + medal + ' #' + s.cumulative_rank + '</b></td>' +
      '<td>' + s.full_name + '</td>' +
      '<td>' + s.login_id + '</td>' +
      '<td>' + (s.grade_level || '-') + '</td>' +
      '<td>' + (s.field || '-') + '</td>' +
      '<td>' + s.cumulative_score + ' / ' + s.cumulative_possible + '</td>' +
      '<td style=\"color:' + color + ';font-weight:bold;\">' + s.cumulative_percent + '%</td>' +
      '<td>' + s.avg_percent + '%</td>' +
      '<td>' + s.exams_taken + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ====== CSV EXPORT ======

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadCSV(filename, rows) {
  var csv = rows.map(function (row) {
    return row.map(csvEscape).join(',');
  }).join('\n');

  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportRankingsCSV() {
  if (!cumulativeRanksCache || cumulativeRanksCache.length === 0) {
    toast('No data to export.', 'info');
    return;
  }

  var rows = [];
  rows.push([
    'Rank', 'Name', 'Login ID', 'Grade', 'Field', 'Section',
    'Total Score', 'Total Possible', 'Percent', 'Avg %', 'Exams Taken'
  ]);

  cumulativeRanksCache.forEach(function (s) {
    rows.push([
      s.cumulative_rank, s.full_name, s.login_id,
      s.grade_level || '', s.field || '', s.section || '',
      s.cumulative_score, s.cumulative_possible,
      s.cumulative_percent + '%', s.avg_percent + '%', s.exams_taken
    ]);
  });

  var date = new Date().toISOString().slice(0, 10);
  downloadCSV('SMR_Rankings_' + date + '.csv', rows);
}

// ====== PRINT STUDENT REPORT ======

async function printStudentFullReport(studentId) {
  var student = allStudents.filter(function (s) { return s.id === studentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  var includeRank = confirm(
    'Include rank in the report?\n\n' +
    'â€¢ Click OK â†’ include rank information\n' +
    'â€¢ Click Cancel â†’ no rank (score only)'
  );

  var subs = await supabase.from('submissions')
    .select('*, exams(id, title, total_marks, courses(name))')
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: false });
  var submissions = subs.data || [];

  var rank = null;
  if (includeRank) {
    var rankRes = await supabase.from('cumulative_rankings').select('*').eq('student_id', studentId).single();
    rank = rankRes.data;
  }

  var html = '<!DOCTYPE html><html><head><title>Student Report</title>';
  html += '<style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; color: #222; max-width: 900px; margin: 0 auto; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 10px; margin-bottom: 4px; }';
  html += '.subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }';
  html += 'h2 { color: #1a3d6d; font-size: 16px; margin-top: 24px; border-left: 4px solid #1a73e8; padding-left: 10px; }';
  html += '.info { margin: 16px 0; padding: 14px; background: #f7f9fc; border-radius: 8px; border-left: 4px solid #1a3d6d; }';
  html += '.info div { margin: 6px 0; font-size: 14px; }';
  html += '.info b { color: #1a3d6d; display: inline-block; min-width: 110px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 10px; }';
  html += 'th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 12px; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += 'tr:nth-child(even) td { background: #f9fbfd; }';
  html += '.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; color: white; }';
  html += '.confirmed { background: #00b894; }';
  html += '.pending { background: #e67e22; }';
  html += '.rankbox { background: linear-gradient(135deg,#1a73e8,#6c5ce7); color: white; padding: 16px; border-radius: 8px; text-align: center; margin: 16px 0; }';
  html += '.rankbox .big { font-size: 28px; font-weight: bold; }';
  html += '.footer { margin-top: 40px; padding-top: 14px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '.footer b { color: #1a3d6d; }';
  html += '</style></head><body>';

  html += '<h1>ðŸ›ï¸ Student Mark Recognition</h1>';
  html += '<p class="subtitle">Official Academic Report â€” Generated ' + new Date().toLocaleString() + '</p>';

  html += '<div class="info">';
  html += '<div><b>Name:</b> ' + student.full_name + '</div>';
  html += '<div><b>Student ID:</b> ' + student.login_id + '</div>';
  html += '<div><b>Grade:</b> ' + (student.grade_level || '-') + '</div>';
  html += '<div><b>Section:</b> ' + (student.section || '-') + '</div>';
  html += '<div><b>Field:</b> ' + (student.field || '-') + '</div>';
  html += '</div>';

  if (includeRank && rank) {
    var medal = rank.cumulative_rank === 1 ? 'ðŸ¥‡' : rank.cumulative_rank === 2 ? 'ðŸ¥ˆ' : rank.cumulative_rank === 3 ? 'ðŸ¥‰' : '';
    html += '<div class="rankbox">';
    html += '<div style="font-size:14px;margin-bottom:6px;">' + medal + ' CUMULATIVE RANK</div>';
    html += '<div class="big">#' + rank.cumulative_rank + ' of ' + rank.total_students + '</div>';
    html += '<div style="margin-top:8px;font-size:13px;">Total Score: ' + rank.cumulative_score + ' / ' + rank.cumulative_possible + ' (' + rank.cumulative_percent + '%)</div>';
    html += '<div style="font-size:12px;margin-top:4px;">Average per Exam: ' + rank.avg_percent + '%</div>';
    html += '</div>';
  }

  if (submissions.length === 0) {
    html += '<h2>ðŸ“Š Exam Results</h2><p style="color:#888;">No exams graded yet.</p>';
  } else {
    html += '<h2>ðŸ“Š Exam Results (' + submissions.length + ' exams)</h2>';
    html += '<table><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>Total</th><th>%</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    var grandTotal = 0, grandPossible = 0;
    submissions.forEach(function (s) {
      grandTotal += (s.total_score || 0);
      grandPossible += (s.total_possible || 0);
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      var badge = s.is_confirmed ? '<span class="badge confirmed">âœ“ Confirmed</span>' : '<span class="badge pending">Pending</span>';
      html += '<tr>' +
        '<td>' + s.exams.title + '</td>' +
        '<td>' + (s.exams.courses ? s.exams.courses.name : '-') + '</td>' +
        '<td>' + (s.total_score || 0) + '</td>' +
        '<td>' + (s.total_possible || 0) + '</td>' +
        '<td><b>' + pct + '%</b></td>' +
        '<td>' + badge + '</td>' +
        '<td>' + (s.graded_at ? new Date(s.graded_at).toLocaleDateString() : '-') + '</td>' +
        '</tr>';
    });
    var grandPct = grandPossible > 0 ? Math.round((grandTotal / grandPossible) * 100) : 0;
    html += '<tr style="background:#1a3d6d;color:white;font-weight:bold;">' +
      '<td colspan="2">TOTAL</td>' +
      '<td>' + grandTotal + '</td>' +
      '<td>' + grandPossible + '</td>' +
      '<td>' + grandPct + '%</td>' +
      '<td colspan="2"></td>' +
      '</tr>';
    html += '</tbody></table>';
  }

  html += '<div class="footer">';
  html += '<p><b>Student Mark Recognition (SMR)</b> â€” AI-Powered Exam Grading</p>';
  html += '<p>Customer Service: <b>@TE21HUSH</b> (Telegram)</p>';
  html += '</div>';
  html += '</body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.print(); }, 600);
}

async function printExamResults(examId) {
  var exam = allExams.filter(function (e) { return e.id === examId; })[0];
  if (!exam) { toast('Exam not found.', 'error'); return; }

  var includeRank = confirm('Include ranking in this report?\n\nOK = with rank\nCancel = without rank');

  var subs = await supabase.from('submissions')
    .select('*, profiles:student_id(full_name, login_id, grade_level, field)')
    .eq('exam_id', examId)
    .eq('status', 'graded')
    .order('total_score', { ascending: false });

  var list = subs.data || [];
  if (list.length === 0) { toast('No graded submissions for this exam.', 'info'); return; }

  var html = '<!DOCTYPE html><html><head><title>' + exam.title + ' - Results</title><style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; color: #222; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 8px; }';
  html += '.subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 12px; }';
  html += 'th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 12px; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += 'tr:nth-child(even) td { background: #f9fbfd; }';
  html += '.footer { margin-top: 30px; padding-top: 14px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';

  html += '<h1>ðŸ“‹ ' + exam.title + ' â€” Results</h1>';
  html += '<p class="subtitle">Course: ' + (exam.courses ? exam.courses.name : '-') + ' â€” Total Marks: ' + exam.total_marks + ' â€” ' + list.length + ' students â€” Generated ' + new Date().toLocaleString() + '</p>';

  html += '<table><thead><tr><th>Rank</th><th>Name</th><th>Student ID</th><th>Grade</th><th>Score</th><th>%</th></tr></thead><tbody>';
  list.forEach(function (s, idx) {
    var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
    var student = s.profiles || {};
    html += '<tr>' +
      '<td>' + (includeRank ? '#' + (idx + 1) : '-') + '</td>' +
      '<td>' + (student.full_name || '-') + '</td>' +
      '<td>' + (student.login_id || '-') + '</td>' +
      '<td>' + (student.grade_level || '-') + '</td>' +
      '<td>' + (s.total_score || 0) + ' / ' + (s.total_possible || 0) + '</td>' +
      '<td><b>' + pct + '%</b></td>' +
      '</tr>';
  });
  html += '</tbody></table>';

  html += '<div class="footer"><p><b>Student Mark Recognition (SMR)</b> â€” Customer Service: @TE21HUSH</p></div>';
  html += '</body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.print(); }, 600);
}

// ====== BULK REPORTS (Teacher) ======

var currentBulkStudents = [];

function initBulkReportFilters() {
  var grades = [], fields = [], sections = [];
  allStudents.forEach(function (s) {
    if (s.grade_level && grades.indexOf(s.grade_level) === -1) grades.push(s.grade_level);
    if (s.field && fields.indexOf(s.field) === -1) fields.push(s.field);
    if (s.section && sections.indexOf(s.section) === -1) sections.push(s.section);
  });
  grades.sort(); fields.sort(); sections.sort();

  var gradeEl = document.getElementById('brGrade');
  var fieldEl = document.getElementById('brField');
  var sectionEl = document.getElementById('brSection');
  var examEl = document.getElementById('brExam');

  if (gradeEl && gradeEl.options.length <= 1) {
    grades.forEach(function (g) { var o = document.createElement('option'); o.value = g; o.textContent = g; gradeEl.appendChild(o); });
  }
  if (fieldEl && fieldEl.options.length <= 1) {
    fields.forEach(function (f) { var o = document.createElement('option'); o.value = f; o.textContent = f; fieldEl.appendChild(o); });
  }
  if (sectionEl && sectionEl.options.length <= 1) {
    sections.forEach(function (s) { var o = document.createElement('option'); o.value = s; o.textContent = s; sectionEl.appendChild(o); });
  }
  if (examEl && examEl.options.length <= 1) {
    allExams.forEach(function (e) { var o = document.createElement('option'); o.value = e.id; o.textContent = e.title + ' â€” ' + (e.courses ? e.courses.name : ''); examEl.appendChild(o); });
  }
}

async function getFilteredStudents() {
  var grade = document.getElementById('brGrade').value;
  var field = document.getElementById('brField').value;
  var section = document.getElementById('brSection').value;
  return allStudents.filter(function (s) {
    if (grade && s.grade_level !== grade) return false;
    if (field && s.field !== field) return false;
    if (section && s.section !== section) return false;
    return true;
  });
}

async function buildStudentData(students, examId) {
  var result = [];
  for (var i = 0; i < students.length; i++) {
    var s = students[i];
    var row = { student: s, totalScore: 0, totalPossible: 0, examsCount: 0, percent: 0 };
    var query = supabase.from('submissions').select('total_score, total_possible').eq('student_id', s.id).eq('status', 'graded');
    if (examId) query = query.eq('exam_id', examId);
    var subRes = await query;
    var subs = subRes.data || [];
    subs.forEach(function (sub) {
      row.totalScore += (sub.total_score || 0);
      row.totalPossible += (sub.total_possible || 0);
      row.examsCount++;
    });
    row.percent = row.totalPossible > 0 ? Math.round((row.totalScore / row.totalPossible) * 100) : 0;
    result.push(row);
  }
  result.sort(function (a, b) { return b.totalScore - a.totalScore; });
  return result;
}

async function previewBulkReport() {
  var msgEl = document.getElementById('brMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';
  var students = await getFilteredStudents();
  if (students.length === 0) {
    msgEl.className = 'msg err'; msgEl.textContent = 'No students match.';
    document.getElementById('brPreview').innerHTML = '';
    return;
  }
  var examId = document.getElementById('brExam').value;
  var data = await buildStudentData(students, examId);
  currentBulkStudents = data;

  var html = '<p style="font-weight:bold;">' + data.length + ' students matched</p>';
  html += '<table><thead><tr><th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th><th>Section</th><th>Exams</th><th>Score</th><th>%</th></tr></thead><tbody>';
  data.forEach(function (r, idx) {
    var color = r.percent >= 80 ? '#00b894' : r.percent >= 50 ? '#1a73e8' : '#e74c3c';
    html += '<tr><td>#' + (idx + 1) + '</td><td>' + r.student.full_name + '</td><td>' + r.student.login_id + '</td>' +
      '<td>' + (r.student.grade_level || '-') + '</td><td>' + (r.student.field || '-') + '</td>' +
      '<td>' + (r.student.section || '-') + '</td><td>' + r.examsCount + '</td>' +
      '<td>' + r.totalScore + ' / ' + r.totalPossible + '</td>' +
      '<td style="color:' + color + ';font-weight:bold;">' + r.percent + '%</td></tr>';
  });
  html += '</tbody></table>';
  document.getElementById('brPreview').innerHTML = html;
  msgEl.className = 'msg ok'; msgEl.textContent = data.length + ' students loaded.';
}

async function printBulkReport() {
  if (currentBulkStudents.length === 0) { await previewBulkReport(); }
  if (currentBulkStudents.length === 0) return;

  var grade = document.getElementById('brGrade').value || 'All';
  var field = document.getElementById('brField').value || 'All';
  var section = document.getElementById('brSection').value || 'All';
  var examId = document.getElementById('brExam').value;
  var examName = 'All Exams';
  if (examId) {
    var e = allExams.filter(function (x) { return x.id === examId; })[0];
    if (e) examName = e.title;
  }

  var html = '<!DOCTYPE html><html><head><title>Group Report</title><style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 8px; }';
  html += '.meta { background:#f7f9fc;padding:12px;border-radius:6px;margin:12px 0;font-size:13px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 12px; }';
  html += 'th, td { padding: 8px; border-bottom: 1px solid #ddd; font-size: 12px; text-align:left; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += '.footer { margin-top: 30px; padding-top: 12px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';
  html += '<h1>ðŸ“Š Group Report â€” ' + examName + '</h1>';
  html += '<div class="meta"><b>Grade:</b> ' + grade + ' | <b>Field:</b> ' + field + ' | <b>Section:</b> ' + section + '<br>';
  html += '<b>Total Students:</b> ' + currentBulkStudents.length + ' | <b>Generated:</b> ' + new Date().toLocaleString() + '</div>';
  html += '<table><thead><tr><th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th><th>Exams</th><th>Score</th><th>%</th></tr></thead><tbody>';
  currentBulkStudents.forEach(function (r, idx) {
    html += '<tr><td>#' + (idx + 1) + '</td><td>' + r.student.full_name + '</td><td>' + r.student.login_id + '</td>' +
      '<td>' + (r.student.grade_level || '-') + '</td><td>' + (r.student.field || '-') + '</td>' +
      '<td>' + r.examsCount + '</td><td>' + r.totalScore + ' / ' + r.totalPossible + '</td>' +
      '<td><b>' + r.percent + '%</b></td></tr>';
  });
  html += '</tbody></table>';
  html += '<div class="footer">SMR â€” @TE21HUSH</div></body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.print(); }, 500);
}

function downloadBulkReportCSV() {
  if (currentBulkStudents.length === 0) { toast('Preview first.', 'info'); return; }
  var rows = [['Rank', 'Name', 'ID', 'Grade', 'Field', 'Section', 'Exams', 'Total Score', 'Possible', 'Percent']];
  currentBulkStudents.forEach(function (r, idx) {
    rows.push([idx + 1, r.student.full_name, r.student.login_id, r.student.grade_level || '', r.student.field || '', r.student.section || '', r.examsCount, r.totalScore, r.totalPossible, r.percent + '%']);
  });
  var csv = rows.map(function (r) { return r.map(function (v) { var s = String(v == null ? '' : v); return s.indexOf(',') !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\n');
  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url; link.download = 'SMR_Group_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click(); URL.revokeObjectURL(url);
}

async function printEachStudentInGroup() {
  if (currentBulkStudents.length === 0) { await previewBulkReport(); }
  if (currentBulkStudents.length === 0) return;
  if (!confirm('Print ' + currentBulkStudents.length + ' individual reports?')) return;
  for (var i = 0; i < currentBulkStudents.length; i++) {
    await printStudentFullReport(currentBulkStudents[i].student.id);
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
  }
}

function openPDFWindow(htmlContent, suggestedFilename) {
  var w = window.open('', '_blank');
  var banner =
    '<div style="position:fixed;top:0;left:0;right:0;background:#1a73e8;color:white;padding:12px;text-align:center;font-family:Arial;font-size:14px;z-index:9999;" id="__pdfBanner">' +
      'ðŸ“„ To save as PDF: Click <b>Print</b> below and choose <b>"Save as PDF"</b> as the destination. ' +
      '<button onclick="document.getElementById(\'__pdfBanner\').style.display=\'none\'; window.print();" style="margin-left:12px;background:white;color:#1a73e8;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">ðŸ–¨ï¸ Print / Save PDF</button>' +
      '<button onclick="document.getElementById(\'__pdfBanner\').style.display=\'none\';" style="margin-left:8px;background:transparent;color:white;border:1px solid white;padding:6px 14px;border-radius:4px;cursor:pointer;">Dismiss</button>' +
    '</div><div style="height:60px;"></div>';
  w.document.write(htmlContent.replace('<body>', '<body>' + banner));
  w.document.title = suggestedFilename || 'SMR_Report';
  w.document.close();
  setTimeout(function () { try { w.print(); } catch (e) {} }, 600);
}

async function downloadBulkReportPDF() {
  if (currentBulkStudents.length === 0) { await previewBulkReport(); }
  if (currentBulkStudents.length === 0) return;

  var grade = document.getElementById('brGrade').value || 'All';
  var field = document.getElementById('brField').value || 'All';
  var section = document.getElementById('brSection').value || 'All';
  var examId = document.getElementById('brExam').value;
  var examName = 'All Exams';
  if (examId) {
    var e = allExams.filter(function (x) { return x.id === examId; })[0];
    if (e) examName = e.title;
  }

  var html = '<!DOCTYPE html><html><head><title>Group Report</title><style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 8px; }';
  html += '.meta { background:#f7f9fc;padding:12px;border-radius:6px;margin:12px 0;font-size:13px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 12px; }';
  html += 'th, td { padding: 8px; border-bottom: 1px solid #ddd; font-size: 12px; text-align:left; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += '.footer { margin-top: 30px; padding-top: 12px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';
  html += '<h1>ðŸ“Š Group Report â€” ' + examName + '</h1>';
  html += '<div class="meta"><b>Grade:</b> ' + grade + ' | <b>Field:</b> ' + field + ' | <b>Section:</b> ' + section + '<br>';
  html += '<b>Total Students:</b> ' + currentBulkStudents.length + ' | <b>Generated:</b> ' + new Date().toLocaleString() + '</div>';
  html += '<table><thead><tr><th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th><th>Exams</th><th>Score</th><th>%</th></tr></thead><tbody>';
  currentBulkStudents.forEach(function (r, idx) {
    html += '<tr><td>#' + (idx + 1) + '</td><td>' + r.student.full_name + '</td><td>' + r.student.login_id + '</td>' +
      '<td>' + (r.student.grade_level || '-') + '</td><td>' + (r.student.field || '-') + '</td>' +
      '<td>' + r.examsCount + '</td><td>' + r.totalScore + ' / ' + r.totalPossible + '</td>' +
      '<td><b>' + r.percent + '%</b></td></tr>';
  });
  html += '</tbody></table>';
  html += '<div class="footer">SMR â€” @TE21HUSH</div></body></html>';

  openPDFWindow(html, 'SMR_Group_Report.pdf');
}

async function downloadTeacherStudentPDF(studentId) {
  var student = allStudents.filter(function (s) { return s.id === studentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  var includeRank = confirm('Include rank in the PDF?\n\nOK = with rank\nCancel = without rank');

  var subs = await supabase.from('submissions')
    .select('*, exams(id, title, total_marks, courses(name))')
    .eq('student_id', studentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: false });
  var submissions = subs.data || [];

  var rank = null;
  if (includeRank) {
    var rankRes = await supabase.from('cumulative_rankings').select('*').eq('student_id', studentId).single();
    rank = rankRes.data;
  }

  var html = '<!DOCTYPE html><html><head><title>Student Report</title><style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; max-width: 900px; margin: 0 auto; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 10px; }';
  html += '.subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }';
  html += 'h2 { color: #1a3d6d; font-size: 16px; margin-top: 24px; border-left: 4px solid #1a73e8; padding-left: 10px; }';
  html += '.info { margin: 16px 0; padding: 14px; background: #f7f9fc; border-radius: 8px; border-left: 4px solid #1a3d6d; }';
  html += '.info div { margin: 6px 0; font-size: 14px; }';
  html += '.info b { color: #1a3d6d; display: inline-block; min-width: 110px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 10px; }';
  html += 'th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 12px; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += 'tr:nth-child(even) td { background: #f9fbfd; }';
  html += '.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; color: white; }';
  html += '.confirmed { background: #00b894; }';
  html += '.pending { background: #e67e22; }';
  html += '.rankbox { background: linear-gradient(135deg,#1a73e8,#6c5ce7); color: white; padding: 16px; border-radius: 8px; text-align: center; margin: 16px 0; }';
  html += '.rankbox .big { font-size: 28px; font-weight: bold; }';
  html += '.footer { margin-top: 40px; padding-top: 14px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';
  html += '<h1>ðŸ›ï¸ Student Mark Recognition</h1>';
  html += '<p class="subtitle">Official Academic Report â€” Generated ' + new Date().toLocaleString() + '</p>';
  html += '<div class="info">';
  html += '<div><b>Name:</b> ' + student.full_name + '</div>';
  html += '<div><b>Student ID:</b> ' + student.login_id + '</div>';
  html += '<div><b>Grade:</b> ' + (student.grade_level || '-') + '</div>';
  html += '<div><b>Section:</b> ' + (student.section || '-') + '</div>';
  html += '<div><b>Field:</b> ' + (student.field || '-') + '</div>';
  html += '</div>';

  if (includeRank && rank) {
    var medal = rank.cumulative_rank === 1 ? 'ðŸ¥‡' : rank.cumulative_rank === 2 ? 'ðŸ¥ˆ' : rank.cumulative_rank === 3 ? 'ðŸ¥‰' : '';
    html += '<div class="rankbox"><div>' + medal + ' CUMULATIVE RANK</div>';
    html += '<div class="big">#' + rank.cumulative_rank + ' of ' + rank.total_students + '</div>';
    html += '<div>Total: ' + rank.cumulative_score + ' / ' + rank.cumulative_possible + ' (' + rank.cumulative_percent + '%)</div></div>';
  }

  if (submissions.length === 0) {
    html += '<h2>ðŸ“Š Exam Results</h2><p style="color:#888;">No exams graded yet.</p>';
  } else {
    html += '<h2>ðŸ“Š Exam Results</h2>';
    html += '<table><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>Total</th><th>%</th><th>Status</th></tr></thead><tbody>';
    var gt = 0, gp = 0;
    submissions.forEach(function (s) {
      gt += (s.total_score || 0); gp += (s.total_possible || 0);
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      var badge = s.is_confirmed ? '<span class="badge confirmed">âœ“ Confirmed</span>' : '<span class="badge pending">Pending</span>';
      html += '<tr><td>' + s.exams.title + '</td><td>' + (s.exams.courses ? s.exams.courses.name : '-') + '</td>' +
        '<td>' + s.total_score + '</td><td>' + s.total_possible + '</td><td><b>' + pct + '%</b></td><td>' + badge + '</td></tr>';
    });
    var grandPct = gp > 0 ? Math.round((gt / gp) * 100) : 0;
    html += '<tr style="background:#1a3d6d;color:white;font-weight:bold;"><td colspan="2">TOTAL</td><td>' + gt + '</td><td>' + gp + '</td><td>' + grandPct + '%</td><td></td></tr>';
    html += '</tbody></table>';
  }

  html += '<div class="footer"><p><b>SMR</b> â€” @TE21HUSH (Telegram)</p></div>';
  html += '</body></html>';

  openPDFWindow(html, 'SMR_' + student.full_name.replace(/[^A-Za-z0-9]/g, '_') + '.pdf');
}

// ====== DOWNLOAD EXAM RESULTS WITH COLUMN CHOOSER ======

var currentDownloadExamId = null;

function openDownloadModal(examId) {
  currentDownloadExamId = examId;
  var exam = allExams.filter(function (e) { return e.id === examId; })[0];
  if (!exam) { toast('Exam not found.', 'error'); return; }
  document.getElementById('dlExamName').textContent = exam.title + ' â€” ' + (exam.courses ? exam.courses.name : '');
  document.getElementById('downloadModal').style.display = 'flex';
}

function closeDownloadModal() {
  document.getElementById('downloadModal').style.display = 'none';
  currentDownloadExamId = null;
}

async function fetchExamResultsForDownload(examId) {
  var subs = await supabase.from('submissions')
    .select('*, profiles:student_id(full_name, login_id, grade_level, field, section)')
    .eq('exam_id', examId)
    .eq('status', 'graded')
    .order('total_score', { ascending: false });
  return subs.data || [];
}

async function executeDownload() {
  if (!currentDownloadExamId) return;

  var cols = {
    name: document.getElementById('dlName').checked,
    id: document.getElementById('dlId').checked,
    grade: document.getElementById('dlGrade').checked,
    field: document.getElementById('dlField').checked,
    section: document.getElementById('dlSection').checked,
    score: document.getElementById('dlScore').checked,
    percent: document.getElementById('dlPercent').checked,
    rank: document.getElementById('dlRank').checked,
    status: document.getElementById('dlStatus').checked
  };

  var format = document.querySelector('input[name="dlFormat"]:checked').value;

  var list = await fetchExamResultsForDownload(currentDownloadExamId);
  if (list.length === 0) { toast('No results for this exam.', 'info'); return; }

  var exam = allExams.filter(function (e) { return e.id === currentDownloadExamId; })[0];

  closeDownloadModal();

  if (format === 'csv') {
    downloadExamCSV(exam, list, cols);
  } else {
    downloadExamPDF(exam, list, cols);
  }
}

function downloadExamCSV(exam, list, cols) {
  var header = [];
  if (cols.rank) header.push('Rank');
  if (cols.name) header.push('Name');
  if (cols.id) header.push('Student ID');
  if (cols.grade) header.push('Grade');
  if (cols.field) header.push('Field');
  if (cols.section) header.push('Section');
  if (cols.score) { header.push('Score'); header.push('Total'); }
  if (cols.percent) header.push('Percent');
  if (cols.status) header.push('Status');

  var rows = [header];

  list.forEach(function (s, idx) {
    var row = [];
    var student = s.profiles || {};
    if (cols.rank) row.push(idx + 1);
    if (cols.name) row.push(student.full_name || '');
    if (cols.id) row.push(student.login_id || '');
    if (cols.grade) row.push(student.grade_level || '');
    if (cols.field) row.push(student.field || '');
    if (cols.section) row.push(student.section || '');
    if (cols.score) { row.push(s.total_score || 0); row.push(s.total_possible || 0); }
    if (cols.percent) {
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      row.push(pct + '%');
    }
    if (cols.status) row.push(s.is_confirmed ? 'Confirmed' : 'Pending');
    rows.push(row);
  });

  var csv = rows.map(function (r) {
    return r.map(function (v) {
      var s = String(v == null ? '' : v);
      return s.indexOf(',') !== -1 || s.indexOf('"') !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\n');

  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'SMR_' + exam.title.replace(/[^A-Za-z0-9]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function downloadExamPDF(exam, list, cols) {
  var html = '<!DOCTYPE html><html><head><title>' + exam.title + ' - Results</title><style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 8px; }';
  html += '.meta { color: #666; font-size: 13px; margin-bottom: 20px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 12px; }';
  html += 'th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 12px; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += 'tr:nth-child(even) td { background: #f9fbfd; }';
  html += '.footer { margin-top: 40px; padding-top: 14px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';
  html += '<h1>ðŸ“‹ ' + exam.title + '</h1>';
  html += '<p class="meta">Course: ' + (exam.courses ? exam.courses.name : '-') + ' â€” Total Marks: ' + exam.total_marks + ' â€” ' + list.length + ' students â€” ' + new Date().toLocaleString() + '</p>';

  html += '<table><thead><tr>';
  if (cols.rank) html += '<th>Rank</th>';
  if (cols.name) html += '<th>Name</th>';
  if (cols.id) html += '<th>ID</th>';
  if (cols.grade) html += '<th>Grade</th>';
  if (cols.field) html += '<th>Field</th>';
  if (cols.section) html += '<th>Section</th>';
  if (cols.score) html += '<th>Score</th><th>Total</th>';
  if (cols.percent) html += '<th>%</th>';
  if (cols.status) html += '<th>Status</th>';
  html += '</tr></thead><tbody>';

  list.forEach(function (s, idx) {
    var student = s.profiles || {};
    html += '<tr>';
    if (cols.rank) html += '<td>#' + (idx + 1) + '</td>';
    if (cols.name) html += '<td>' + (student.full_name || '-') + '</td>';
    if (cols.id) html += '<td>' + (student.login_id || '-') + '</td>';
    if (cols.grade) html += '<td>' + (student.grade_level || '-') + '</td>';
    if (cols.field) html += '<td>' + (student.field || '-') + '</td>';
    if (cols.section) html += '<td>' + (student.section || '-') + '</td>';
    if (cols.score) html += '<td>' + (s.total_score || 0) + '</td><td>' + (s.total_possible || 0) + '</td>';
    if (cols.percent) {
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      html += '<td><b>' + pct + '%</b></td>';
    }
    if (cols.status) html += '<td>' + (s.is_confirmed ? 'âœ“ Confirmed' : 'Pending') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div class="footer"><p><b>SMR</b> â€” @TE21HUSH (Telegram)</p></div>';
  html += '</body></html>';

  openPDFWindow(html, 'SMR_' + exam.title.replace(/[^A-Za-z0-9]/g, '_') + '.pdf');
}









// ====== AI CONNECTION TEST ======
async function testAIProxy() {
  var result = document.getElementById('aiTestResult');
  result.style.display = 'block';
  result.style.background = '#e3f2fd';
  result.style.color = '#1565c0';
  result.textContent = 'Testing AI connection...';

  try {
    var response = await fetch(AI_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: {
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: 'Say "AI is working" in 3 words' }],
          max_tokens: 50
        }
      })
    });

    var text = await response.text();

    if (response.status === 200) {
      result.style.background = '#e8f5e9';
      result.style.color = '#1b5e20';
      result.innerHTML = '✅ <b>AI connection works!</b><br>Response: ' + text.substring(0, 200);
    } else if (response.status === 500 && text.indexOf('not configured') !== -1) {
      result.style.background = '#ffebee';
      result.style.color = '#b71c1c';
      result.innerHTML = '❌ <b>Secret missing.</b><br>Add <code>GROQ_API_KEY</code> in Supabase → Edge Functions → Secrets, then redeploy.';
    } else if (response.status === 401 || text.indexOf('Invalid API Key') !== -1 || text.indexOf('invalid_api_key') !== -1) {
      result.style.background = '#ffebee';
      result.style.color = '#b71c1c';
      result.innerHTML = '❌ <b>API key is invalid.</b><br>Replace GROQ_API_KEY in Supabase Secrets with a new key, then redeploy.';
    } else {
      result.style.background = '#fff3cd';
      result.style.color = '#856404';
      result.innerHTML = '⚠️ HTTP ' + response.status + '<br>' + text.substring(0, 300);
    }
  } catch (err) {
    result.style.background = '#ffebee';
    result.style.color = '#b71c1c';
    result.innerHTML = '❌ <b>Connection failed.</b><br>' + err.message;
  }
}
















// ============================================================
// CAMERA (works with any file input)
// ============================================================

var cameraStream = null;
var cameraTargetInputId = 'ocrFile';

async function openCameraFor(targetInputId) {
  cameraTargetInputId = targetInputId || 'ocrFile';
  var modal = document.getElementById('cameraModal');
  var video = document.getElementById('cameraVideo');
  modal.style.display = 'flex';
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = cameraStream;
  } catch (err) {
    alert('Camera error: ' + err.message);
    closeCamera();
  }
}

// Backwards-compatible alias
async function openCamera() {
  return openCameraFor('ocrFile');
}

function capturePhoto() {
  var video = document.getElementById('cameraVideo');
  var canvas = document.getElementById('cameraCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob(function (blob) {
    var file = new File([blob], 'camera_' + Date.now() + '.jpg', { type: 'image/jpeg' });
    var dt = new DataTransfer();
    dt.items.add(file);

    var target = document.getElementById(cameraTargetInputId);
    if (target) {
      // Handle single-file input
      target.files = dt.files;
      // If the input is for multi-file preview, also add to the preview
      if (cameraTargetInputId === 'ocrFile' && typeof filePreviews !== 'undefined') {
        filePreviews.studentSheets.push({ file: file, name: file.name, size: Math.round(file.size / 1024) + ' KB' });
        if (typeof renderFileList === 'function') renderFileList('studentSheets');
      }
      if (cameraTargetInputId === 'questionPaperFile' && typeof filePreviews !== 'undefined') {
        filePreviews.questionPaper.push({ file: file, name: file.name, size: Math.round(file.size / 1024) + ' KB' });
        if (typeof renderFileList === 'function') renderFileList('questionPaper');
      }
      if (cameraTargetInputId === 'answerKeyFile' && typeof filePreviews !== 'undefined') {
        filePreviews.answerKey.push({ file: file, name: file.name, size: Math.round(file.size / 1024) + ' KB' });
        if (typeof renderFileList === 'function') renderFileList('answerKey');
      }
    }
    closeCamera();
  }, 'image/jpeg', 0.85);
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function (t) { t.stop(); });
    cameraStream = null;
  }
  var modal = document.getElementById('cameraModal');
  if (modal) modal.style.display = 'none';
}

