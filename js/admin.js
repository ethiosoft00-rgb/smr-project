// ============================================================
// admin.js
// Admin dashboard logic:
//   - loadAll / renderStudents / renderTeachers / renderRequests
//   - adminResetPassword, adminToggleBan
//   - cumulative rankings + bulk reports (CSV / PDF)
//   - student / teacher detail panels
//   - self-service login ID and password change
// ============================================================
var currentUser = null;
var allStudents = [];
var allTeachers = [];
var cumulativeRanksCache = [];

async function init() {
  var userResult = await supabase.auth.getUser();
  if (!userResult.data.user) { window.location.href = 'login.html'; return; }
  currentUser = userResult.data.user;

  var profileResult = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  if (!profileResult.data || profileResult.data.role !== 'admin') {
    window.location.href = 'login.html';
    return;
  }
  var nameEl = document.getElementById('adminName');
  if (nameEl) nameEl.textContent = profileResult.data.full_name;
  await loadAll();
}

// Fetches all students, teachers, password requests, and refreshes the UI.
async function loadAll() {
  try {
    var studentsResult = await supabase.from('profiles').select('*').eq('role', 'student').order('full_name');
    allStudents = studentsResult.data || [];

    var teachersResult = await supabase.from('profiles').select('*').eq('role', 'teacher').order('full_name');
    allTeachers = teachersResult.data || [];

    var requestsResult = await supabase.from('password_reset_requests').select('*').order('requested_at', { ascending: false });
    var requests = requestsResult.data || [];

    var cs = document.getElementById('countStudents');
    var ct = document.getElementById('countTeachers');
    var cr = document.getElementById('countRequests');
    if (cs) cs.textContent = allStudents.length;
    if (ct) ct.textContent = allTeachers.length;
    if (cr) cr.textContent = requests.filter(function (r) { return r.status === 'pending'; }).length;

    renderStudents();
    renderTeachers();
    renderRequests(requests);
  } catch (e) {
    console.error('loadAll error:', e);
  }
}

// Switches between the admin dashboard's tab views and hides stale detail panels.
function showTab(name) {
  var tabs = ['overview', 'students', 'teachers', 'requests', 'rank', 'reports', 'account', 'ai'];
  tabs.forEach(function (t) {
    var viewEl = document.getElementById('view-' + t);
    var tabEl = document.getElementById('tab-' + t);
    if (viewEl) viewEl.style.display = (t === name) ? 'block' : 'none';
    if (tabEl) tabEl.className = (t === name) ? 'active' : '';
  });

  // Hide all detail panels when switching tabs
  var studentDetail = document.getElementById('studentDetailCard');
  if (studentDetail) studentDetail.style.display = 'none';
  var teacherDetail = document.getElementById('teacherDetailCard');
  if (teacherDetail) teacherDetail.style.display = 'none';
  currentDetailStudentId = null;
  currentDetailTeacherId = null;

  if (name === 'students') { renderStudents(); }
  if (name === 'teachers') { renderTeachers(); }
  if (name === 'rank') { loadCumulativeRankForTeacher(); }
  if (name === 'reports') { initBulkReportFilters(); }
  if (name === 'account') { loadMyAccountInfo(); }
}

async function addTeacher() {
  var msgEl = document.getElementById('tMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var fullName = document.getElementById('tFullName').value.trim();
  var loginId  = document.getElementById('tLoginId').value.trim();
  var phone    = document.getElementById('tPhone').value.trim();
  var subject  = document.getElementById('tSubject').value.trim();

  if (!fullName || !loginId) { msgEl.className = 'msg err'; msgEl.textContent = 'Full Name and Login ID required.'; return; }

  var result = await supabase.rpc('admin_preregister_user', {
    p_role: 'teacher',
    p_full_name: fullName,
    p_login_id: loginId,
    p_phone: phone || null,
    p_school_type: null, p_grade_level: null, p_section: null, p_field: null
  });

  if (result.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + result.error.message; return; }

  if (subject) {
    await supabase.from('teacher_subjects').insert({ teacher_id: result.data, subject_name: subject });
  }

  msgEl.className = 'msg ok';
  msgEl.textContent = 'Teacher registered: ' + fullName + '. They can now register at register.html.';

  document.getElementById('tFullName').value = '';
  document.getElementById('tLoginId').value = '';
  document.getElementById('tPhone').value = '';
  document.getElementById('tSubject').value = '';
  await loadAll();
}

function renderStudents() {
  var tbody = document.getElementById('studentsTable');
  if (!tbody) return;

  var searchEl = document.getElementById('studentSearch');
  var term = searchEl ? (searchEl.value || '').toLowerCase() : '';

  var list = allStudents.filter(function (s) {
    if (!term) return true;
    return (s.full_name || '').toLowerCase().indexOf(term) !== -1 ||
           (s.login_id || '').toLowerCase().indexOf(term) !== -1 ||
           (s.grade_level || '').toLowerCase().indexOf(term) !== -1 ||
           (s.field || '').toLowerCase().indexOf(term) !== -1;
  });

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;">No students.</td></tr>';
    return;
  }

  list.forEach(function (s) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><span style="background:#00b894;color:white;padding:2px 8px;border-radius:10px;font-size:11px;">STUDENT</span> ' + s.full_name + '</td>' +
      '<td>' + s.login_id + '</td>' +
      '<td>' + (s.grade_level || '-') + '</td>' +
      '<td>' + (s.section || '-') + '</td>' +
      '<td>' + (s.field || '-') + '</td>' +
      '<td>' + (s.is_banned ? 'Banned' : 'Active') + '</td>' +
      '<td>' + (s.email ? 'Yes' : 'No') + '</td>' +
      '<td>' +
        '<button onclick="showStudentDetailAdmin(\'' + s.id + '\')" style="background:#1a73e8;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">View</button> ' +
        '<button onclick="printStudentFullReport(\'' + s.id + '\')" style="background:#6c5ce7;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">🖨️ Print</button> ' +
        '<button onclick="downloadStudentReportPDF(\'' + s.id + '\')" style="background:#e67e22;color:white;border:none;padding:5px 10px;border-radius:4px;cursor:pointer;font-size:11px;">📥 PDF</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

function renderTeachers() {
  var tbody = document.getElementById('teachersTable');
  if (!tbody) return;

  var searchEl = document.getElementById('teacherSearch');
  var term = searchEl ? (searchEl.value || '').toLowerCase() : '';

  var list = allTeachers.filter(function (t) {
    if (!term) return true;
    return (t.full_name || '').toLowerCase().indexOf(term) !== -1 ||
           (t.login_id || '').toLowerCase().indexOf(term) !== -1;
  });

  tbody.innerHTML = '';
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#888;">No teachers.</td></tr>';
    return;
  }

  list.forEach(function (t) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><span style="background:#6c5ce7;color:white;padding:2px 8px;border-radius:10px;font-size:11px;">TEACHER</span> ' + t.full_name + '</td>' +
      '<td>' + t.login_id + '</td>' +
      '<td>' + (t.phone || '-') + '</td>' +
      '<td>' + (t.is_banned ? 'Banned' : 'Active') + '</td>' +
      '<td>' + (t.email ? 'Yes' : 'No') + '</td>' +
      '<td><button onclick="showTeacherDetailAdmin(\'' + t.id + '\')" style="background:#6c5ce7;color:white;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;">View</button></td>';
    tbody.appendChild(tr);
  });
}

function renderRequests(requests) {
  var tbody = document.getElementById('requestsTable');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!requests || requests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">No requests.</td></tr>';
    return;
  }

  requests.forEach(function (r) {
    var statusColor = r.status === 'pending' ? '#e67e22' : '#00b894';
    var actionHtml = '';
    if (r.status === 'pending') {
      actionHtml =
        '<button onclick="adminResetPassword(\'' + r.user_id + '\')" style="background:#e67e22;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;margin-right:6px;">Reset Password</button>' +
        '<button onclick="showResetRequestEmail(\'' + r.email + '\')" style="background:#1a73e8;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;">Send Email</button>';
    } else {
      actionHtml = '<span style="color:#00b894;font-weight:bold;">Resolved</span>';
    }

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + (r.user_id || '').slice(0, 8) + '...</td>' +
      '<td>' + r.email + '</td>' +
      '<td>' + new Date(r.requested_at).toLocaleString() + '</td>' +
      '<td style="color:' + statusColor + ';font-weight:bold;">' + r.status + '</td>' +
      '<td>' + actionHtml + '</td>';
    tbody.appendChild(tr);
  });
}

// Prompts for a new password and calls the admin_reset_user_password RPC.
async function adminResetPassword(userId) {
  var newPw = prompt('Enter a NEW password (min 6 characters):');
  if (!newPw) return;
  if (newPw.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }

  var confirmed = confirm('Set new password to: "' + newPw + '"?');
  if (!confirmed) return;

  var result = await supabase.rpc('admin_reset_user_password', {
    p_user_id: userId,
    p_new_password: newPw
  });

  if (result.error) { alert('Error: ' + result.error.message); return; }
  alert('Password reset! New password: ' + newPw + '\n\nSend it to the user via Telegram @TE21HUSH.');
  await loadAll();
}

function showResetRequestEmail(email) {
  alert('Send the password to: ' + email + '\n\nOr use Telegram: @TE21HUSH');
}

// Flips the is_banned flag on a user's profile.
async function toggleBan(userId, isBanned) {
  var result = await supabase.from('profiles').update({ is_banned: !isBanned }).eq('id', userId);
  if (result.error) { alert('Error: ' + result.error.message); return; }
  await loadAll();
}

async function showStudentRanking(studentId) {
  var r = await supabase.from('student_rankings').select('*').eq('student_id', studentId);
  if (!r.data || r.data.length === 0) { toast('No rankings yet.', 'info'); return; }
  var msg = 'Rankings:\n\n';
  r.data.forEach(function (row) {
    msg += row.exam_title + ':\n';
    msg += '  Score: ' + row.total_score + ' / ' + row.total_possible + ' (' + (row.score_percent || 0) + '%)\n';
    msg += '  Same Class: ' + row.rank_same_grade_field_school + '\n';
    msg += '  Same Grade+Field: ' + row.rank_same_grade_field + '\n';
    msg += '  Same Grade: ' + row.rank_same_grade + '\n';
    msg += '  Whole System: ' + row.rank_overall + '\n\n';
  });
  alert(msg);
}

// Fetches whole-system cumulative rankings for the RANK tab.
async function loadCumulativeRankForTeacher() {
  var container = document.getElementById('rankFullTable');
  if (!container) return;
  container.innerHTML = 'Loading...';

  var r = await supabase.from('cumulative_rankings').select('*').order('cumulative_rank');
  if (r.error || !r.data) {
    container.innerHTML = '<p style="color:red;">Error: ' + (r.error ? r.error.message : 'no data') + '</p>';
    return;
  }
  cumulativeRanksCache = r.data;
  renderCumulativeRankTable();
}

function renderCumulativeRankTable() {
  var container = document.getElementById('rankFullTable');
  if (!container) return;

  var searchEl = document.getElementById('rankSearch');
  var term = searchEl ? (searchEl.value || '').toLowerCase().trim() : '';

  var list = cumulativeRanksCache.filter(function (x) {
    if (!term) return true;
    return (x.full_name || '').toLowerCase().indexOf(term) !== -1 ||
           (x.login_id || '').toLowerCase().indexOf(term) !== -1 ||
           (x.grade_level || '').toLowerCase().indexOf(term) !== -1 ||
           (x.field || '').toLowerCase().indexOf(term) !== -1;
  });

  if (list.length === 0) {
    container.innerHTML = '<p style="color:#888;">No matches.</p>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th>' +
    '<th>Total Score</th><th>Percent</th><th>Avg %</th><th>Exams</th>' +
    '</tr></thead><tbody>';

  list.forEach(function (s) {
    var color = s.cumulative_percent >= 80 ? '#00b894' : s.cumulative_percent >= 50 ? '#1a73e8' : '#e74c3c';
    var medal = s.cumulative_rank === 1 ? '🥇' : s.cumulative_rank === 2 ? '🥈' : s.cumulative_rank === 3 ? '🥉' : '';
    html += '<tr>' +
      '<td><b>' + medal + ' #' + s.cumulative_rank + '</b></td>' +
      '<td>' + s.full_name + '</td>' +
      '<td>' + s.login_id + '</td>' +
      '<td>' + (s.grade_level || '-') + '</td>' +
      '<td>' + (s.field || '-') + '</td>' +
      '<td>' + s.cumulative_score + ' / ' + s.cumulative_possible + '</td>' +
      '<td style="color:' + color + ';font-weight:bold;">' + s.cumulative_percent + '%</td>' +
      '<td>' + s.avg_percent + '%</td>' +
      '<td>' + s.exams_taken + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function askAI() {
  var q = document.getElementById('aiQuestion').value.trim();
  var out = document.getElementById('aiAnswer');
  if (!q) { out.textContent = 'Type a question first.'; return; }

  var imageBase64 = null;
  var fileInput = document.getElementById('aiAdminFile');
  if (fileInput && fileInput.files && fileInput.files[0]) {
    out.textContent = 'Reading your image...';
    try { imageBase64 = await fileToBase64(fileInput.files[0]); } catch (e) { imageBase64 = null; }
  }

  out.textContent = 'Thinking...';
  try {
    var profilesResult = await supabase.from('profiles').select('id, role, full_name, login_id').limit(100);
    var subsResult = await supabase.from('submissions').select('id, student_id, exam_id, total_score, status').limit(100);
    var answer = await askAIForAdmin(q, profilesResult.data || [], subsResult.data || [], imageBase64);
    out.textContent = answer;
    if (typeof clearAiAdminImage === 'function') clearAiAdminImage();
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}
init();

var currentDetailStudentId = null;

// Opens the student detail panel with academic info, security, and notes.
async function showStudentDetailAdmin(studentId) {
  currentDetailStudentId = studentId;
  var card = document.getElementById('studentDetailCard');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth' });

  var student = allStudents.filter(function (s) { return s.id === studentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  // Header
  document.getElementById('sdHeader').innerHTML =
    '<h3 style="margin:0 0 8px 0;">' + student.full_name + ' <span style="color:#666;font-size:14px;">(' + student.login_id + ')</span></h3>';

  // Academic info
  document.getElementById('sdAcademic').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">' +
      '<div class="stat">Grade: <b>' + (student.grade_level || '-') + '</b></div>' +
      '<div class="stat">Section: <b>' + (student.section || '-') + '</b></div>' +
      '<div class="stat">Field: <b>' + (student.field || '-') + '</b></div>' +
      '<div class="stat">Phone: <b>' + (student.phone || '-') + '</b></div>' +
      '<div class="stat">Email: <b>' + (student.email || 'Not registered') + '</b></div>' +
      '<div class="stat">Status: <b style="color:' + (student.is_banned ? '#c0392b' : '#00b894') + ';">' + (student.is_banned ? 'BANNED' : 'ACTIVE') + '</b></div>' +
    '</div>';

  // Password section
  var pwHtml = '';
  if (student.visible_password) {
    pwHtml += '<p style="margin:4px 0;">Current admin-set password: <code style="background:#fff3cd;padding:4px 10px;border-radius:4px;font-size:14px;font-weight:bold;">' + student.visible_password + '</code></p>';
    pwHtml += '<p style="font-size:12px;color:#666;margin:4px 0;">⚠️ This password was set by admin. It will not update if the student changes their own password.</p>';
  } else {
    pwHtml += '<p style="margin:4px 0;color:#666;">No visible password. The student set their own password (encrypted and not readable).</p>';
    pwHtml += '<p style="font-size:12px;color:#666;margin:4px 0;">If the student forgot the password, use Reset Password below.</p>';
  }
  document.getElementById('sdPassword').innerHTML = pwHtml;

  // Ban button label
  var banBtn = document.getElementById('sdBanBtn');
  if (student.is_banned) {
    banBtn.textContent = 'Restore Access';
    banBtn.style.background = '#00b894';
  } else {
    banBtn.textContent = 'Ban Student';
    banBtn.style.background = '#c0392b';
  }

  // Notes
  document.getElementById('sdNotes').value = student.admin_notes || '';
  document.getElementById('sdNotesMsg').textContent = '';

  // Academic results
  await loadStudentResults(studentId);
}

async function loadStudentResults(studentId) {
  var container = document.getElementById('sdResults');
  container.innerHTML = 'Loading...';

  var subs = await supabase.from('submissions').select('*, exams(title, total_marks, courses(name))')
    .eq('student_id', studentId).eq('status', 'graded').order('graded_at', { ascending: false });

  if (!subs.data || subs.data.length === 0) {
    container.innerHTML = '<p style="color:#888;">No exams taken yet.</p>';
    return;
  }

  var totalScore = 0, totalPossible = 0;
  var html = '<table style="margin-top:8px;"><thead><tr>' +
    '<th>Exam</th><th>Course</th><th>Score</th><th>%</th><th>Status</th><th>Action</th>' +
    '</tr></thead><tbody>';

  subs.data.forEach(function (s) {
    totalScore += (s.total_score || 0);
    totalPossible += (s.total_possible || 0);
    var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
    var statusBadge = s.is_confirmed
      ? '<span style="color:#00b894;font-weight:bold;">✓ Confirmed</span>'
      : '<span style="color:#e67e22;font-weight:bold;">Pending</span>';
    html += '<tr>' +
      '<td>' + s.exams.title + '</td>' +
      '<td>' + (s.exams.courses ? s.exams.courses.name : '-') + '</td>' +
      '<td>' + (s.total_score || 0) + ' / ' + (s.total_possible || 0) + '</td>' +
      '<td>' + pct + '%</td>' +
      '<td>' + statusBadge + '</td>' +
      '<td><button onclick="openMarkAdjuster(\'' + s.id + '\', \'' + s.exam_id + '\', \'' + s.exams.title.replace(/'/g, '') + '\')" style="background:#6c5ce7;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;">Adjust Marks</button></td>' +
      '</tr>';
  });

  var totalPct = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;
  html += '<tr style="background:#f7f9fc;font-weight:bold;"><td colspan="2">TOTAL</td><td>' + totalScore + ' / ' + totalPossible + '</td><td>' + totalPct + '%</td><td></td></tr>';
  html += '</tbody></table>';

  var rankRes = await supabase.from('cumulative_rankings').select('*').eq('student_id', studentId).single();
  if (rankRes.data) {
    html += '<div style="margin-top:10px;padding:10px;background:#1a73e8;color:white;border-radius:6px;">' +
      '<b>System Rank: #' + rankRes.data.cumulative_rank + ' of ' + rankRes.data.total_students + '</b>' +
      ' &nbsp; • &nbsp; Average per exam: ' + rankRes.data.avg_percent + '%' +
      '</div>';
  }

  container.innerHTML = html;
}

async function adminResetPasswordForDetail() {
  if (!currentDetailStudentId) return;
  await adminResetPassword(currentDetailStudentId);
  // Refresh the visible password
  var r = await supabase.from('profiles').select('visible_password').eq('id', currentDetailStudentId).single();
  if (r.data && r.data.visible_password) {
    document.getElementById('sdPassword').innerHTML =
      '<p style="margin:4px 0;">Current admin-set password: <code style="background:#fff3cd;padding:4px 10px;border-radius:4px;font-size:14px;font-weight:bold;">' + r.data.visible_password + '</code></p>' +
      '<p style="font-size:12px;color:#666;margin:4px 0;">Send this to the user via Telegram @TE21HUSH.</p>';
  }
  await loadAll();
}

async function adminToggleBanDetail() {
  if (!currentDetailStudentId) return;
  var student = allStudents.filter(function (s) { return s.id === currentDetailStudentId; })[0];
  if (!student) return;
  var newBan = !student.is_banned;
  var action = newBan ? 'Ban this student?' : 'Restore this student?';
  if (!confirm(action)) return;
  var r = await supabase.from('profiles').update({ is_banned: newBan }).eq('id', currentDetailStudentId);
  if (r.error) { alert('Error: ' + r.error.message); return; }
  await loadAll();
  // Reload the detail
  showStudentDetailAdmin(currentDetailStudentId);
}

async function saveAdminNotes() {
  if (!currentDetailStudentId) return;
  var notes = document.getElementById('sdNotes').value.trim();
  var msgEl = document.getElementById('sdNotesMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var r = await supabase.rpc('admin_update_notes', {
    p_user_id: currentDetailStudentId,
    p_notes: notes
  });

  if (r.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + r.error.message; return; }
  msgEl.className = 'msg ok'; msgEl.textContent = 'Notes saved.';
  await loadAll();
}

function closeStudentDetail() {
  document.getElementById('studentDetailCard').style.display = 'none';
  currentDetailStudentId = null;
}

var currentDetailTeacherId = null;

// Opens the teacher detail panel with subjects, exams, and security controls.
async function showTeacherDetailAdmin(teacherId) {
  currentDetailTeacherId = teacherId;
  var card = document.getElementById('teacherDetailCard');
  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth' });

  var teacher = allTeachers.filter(function (t) { return t.id === teacherId; })[0];
  if (!teacher) { toast('Teacher not found.', 'error'); return; }

  document.getElementById('tdHeader').innerHTML =
    '<h3 style="margin:0 0 8px 0;">' +
      '<span style="background:#6c5ce7;color:white;padding:3px 10px;border-radius:10px;font-size:12px;margin-right:8px;">TEACHER</span>' +
      teacher.full_name + ' <span style="color:#666;font-size:14px;">(' + teacher.login_id + ')</span>' +
    '</h3>';

  document.getElementById('tdInfo').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;">' +
      '<div class="stat">Role: <b style="color:#6c5ce7;">TEACHER</b></div>' +
      '<div class="stat">Phone: <b>' + (teacher.phone || '-') + '</b></div>' +
      '<div class="stat">Email: <b>' + (teacher.email || 'Not registered') + '</b></div>' +
      '<div class="stat">Status: <b style="color:' + (teacher.is_banned ? '#c0392b' : '#00b894') + ';">' + (teacher.is_banned ? 'BANNED' : 'ACTIVE') + '</b></div>' +
    '</div>';

  var pwHtml = '';
  if (teacher.visible_password) {
    pwHtml = '<p style="margin:4px 0;">Admin-set password: <code style="background:#fff3cd;padding:4px 10px;border-radius:4px;font-size:14px;font-weight:bold;">' + teacher.visible_password + '</code></p>';
  } else {
    pwHtml = '<p style="margin:4px 0;color:#666;">Teacher set their own password (encrypted, not readable).</p>';
  }
  document.getElementById('tdPassword').innerHTML = pwHtml;

  var banBtn = document.getElementById('tdBanBtn');
  if (teacher.is_banned) {
    banBtn.textContent = 'Restore Access';
    banBtn.style.background = '#00b894';
  } else {
    banBtn.textContent = 'Ban Teacher';
    banBtn.style.background = '#c0392b';
  }

  document.getElementById('tdNotes').value = teacher.admin_notes || '';
  document.getElementById('tdNotesMsg').textContent = '';

  // Load subjects
  var subjRes = await supabase.from('teacher_subjects').select('*').eq('teacher_id', teacherId);
  if (subjRes.data && subjRes.data.length > 0) {
    var sHtml = '<ul style="margin:6px 0;padding-left:20px;">';
    subjRes.data.forEach(function (s) { sHtml += '<li>' + s.subject_name + '</li>'; });
    sHtml += '</ul>';
    document.getElementById('tdSubjects').innerHTML = sHtml;
  } else {
    document.getElementById('tdSubjects').innerHTML = '<p style="color:#888;font-size:13px;">No subjects assigned.</p>';
  }

  // Load exams created
  var examRes = await supabase.from('exams').select('*, courses(name)').eq('teacher_id', teacherId).order('created_at', { ascending: false });
  if (examRes.data && examRes.data.length > 0) {
    var eHtml = '<table style="margin-top:6px;"><thead><tr><th>Exam</th><th>Course</th><th>Total Marks</th><th>Status</th></tr></thead><tbody>';
    examRes.data.forEach(function (e) {
      eHtml += '<tr>' +
        '<td>' + e.title + '</td>' +
        '<td>' + (e.courses ? e.courses.name : '-') + '</td>' +
        '<td>' + e.total_marks + '</td>' +
        '<td>' + (e.is_confirmed ? 'Confirmed' : 'Open') + '</td>' +
        '</tr>';
    });
    eHtml += '</tbody></table>';
    document.getElementById('tdExams').innerHTML = eHtml;
  } else {
    document.getElementById('tdExams').innerHTML = '<p style="color:#888;font-size:13px;">No exams created.</p>';
  }
}

async function adminResetPasswordForTeacher() {
  if (!currentDetailTeacherId) return;
  await adminResetPassword(currentDetailTeacherId);
  var r = await supabase.from('profiles').select('visible_password').eq('id', currentDetailTeacherId).single();
  if (r.data && r.data.visible_password) {
    document.getElementById('tdPassword').innerHTML =
      '<p style="margin:4px 0;">Admin-set password: <code style="background:#fff3cd;padding:4px 10px;border-radius:4px;font-size:14px;font-weight:bold;">' + r.data.visible_password + '</code></p>';
  }
  await loadAll();
}

async function adminToggleBanTeacher() {
  if (!currentDetailTeacherId) return;
  var teacher = allTeachers.filter(function (t) { return t.id === currentDetailTeacherId; })[0];
  if (!teacher) return;
  var newBan = !teacher.is_banned;
  if (!confirm(newBan ? 'Ban this teacher?' : 'Restore this teacher?')) return;
  var r = await supabase.from('profiles').update({ is_banned: newBan }).eq('id', currentDetailTeacherId);
  if (r.error) { alert('Error: ' + r.error.message); return; }
  await loadAll();
  showTeacherDetailAdmin(currentDetailTeacherId);
}

async function saveTeacherNotes() {
  if (!currentDetailTeacherId) return;
  var notes = document.getElementById('tdNotes').value.trim();
  var msgEl = document.getElementById('tdNotesMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var r = await supabase.rpc('admin_update_notes', {
    p_user_id: currentDetailTeacherId,
    p_notes: notes
  });

  if (r.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + r.error.message; return; }
  msgEl.className = 'msg ok'; msgEl.textContent = 'Notes saved.';
  await loadAll();
}

function closeTeacherDetail() {
  document.getElementById('teacherDetailCard').style.display = 'none';
  currentDetailTeacherId = null;
}


// ====== MARK ADJUSTER ======
var currentAdjustingSubmissionId = null;
var currentAdjustingAnswers = [];

async function openMarkAdjuster(submissionId, examId, examTitle) {
  currentAdjustingSubmissionId = submissionId;

  var modal = document.getElementById('markAdjusterModal');
  if (!modal) {
    // Create the modal if it doesn't exist
    modal = document.createElement('div');
    modal.id = 'markAdjusterModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML =
      '<div style="background:white;border-radius:12px;max-width:900px;width:100%;max-height:90vh;overflow:auto;padding:24px;">' +
        '<h3 style="margin-top:0;">Adjust Marks: <span id="maExamTitle"></span></h3>' +
        '<p style="color:#666;font-size:13px;">Edit awarded marks for each question. Total recalculates automatically.</p>' +
        '<div id="maTable">Loading...</div>' +
        '<div style="margin-top:16px;text-align:right;">' +
          '<button onclick="saveMarkAdjustments()" style="background:#00b894;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;margin-right:8px;">Save Changes</button>' +
          '<button onclick="closeMarkAdjuster()" style="background:#e74c3c;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;">Close</button>' +
        '</div>' +
        '<div id="maMsg" class="msg"></div>' +
      '</div>';
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';
  document.getElementById('maExamTitle').textContent = examTitle;
  document.getElementById('maTable').innerHTML = 'Loading...';
  document.getElementById('maMsg').textContent = '';

  var ansRes = await supabase.from('submission_answers').select('*').eq('submission_id', submissionId).order('question_number');
  var keyRes = await supabase.from('answer_keys').select('*').eq('exam_id', examId).order('question_number');

  var answers = ansRes.data || [];
  var keys = keyRes.data || [];
  currentAdjustingAnswers = [];

  if (answers.length === 0) {
    document.getElementById('maTable').innerHTML = '<p style="color:#888;">No answers recorded.</p>';
    return;
  }

  var html = '<table><thead><tr>' +
    '<th>Q#</th><th>Question</th><th>Student Answer</th><th>Correct</th><th>Max</th><th>Awarded</th><th>Result</th>' +
    '</tr></thead><tbody>';

  answers.forEach(function (a) {
    var key = keys.filter(function (k) { return k.question_number === a.question_number; })[0];
    var maxMarks = key ? key.marks : 1;
    var questionText = key && key.question_text ? key.question_text : '-';
    var correctAns = key ? key.correct_answer : '-';
    var awarded = a.awarded_marks != null ? a.awarded_marks : 0;
    var icon = a.is_correct ? '<span style="color:#00b894;font-weight:bold;">\u2713</span>' : '<span style="color:#c0392b;font-weight:bold;">\u2717</span>';

    currentAdjustingAnswers.push({
      question_number: a.question_number,
      max: maxMarks
    });

    html += '<tr>' +
      '<td>' + a.question_number + '</td>' +
      '<td>' + questionText + '</td>' +
      '<td>' + (a.student_answer || '-') + '</td>' +
      '<td>' + correctAns + '</td>' +
      '<td>' + maxMarks + '</td>' +
      '<td><input type="number" id="ma_awarded_' + a.question_number + '" value="' + awarded + '" min="0" max="' + maxMarks + '" style="width:70px;padding:4px;border:1px solid #ccc;border-radius:4px;" /></td>' +
      '<td>' + icon + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('maTable').innerHTML = html;
}

async function saveMarkAdjustments() {
  if (!currentAdjustingSubmissionId) return;
  var msgEl = document.getElementById('maMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var adjustments = [];
  for (var i = 0; i < currentAdjustingAnswers.length; i++) {
    var q = currentAdjustingAnswers[i];
    var input = document.getElementById('ma_awarded_' + q.question_number);
    if (input) {
      var val = parseInt(input.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      if (val > q.max) val = q.max;
      adjustments.push({ question_number: q.question_number, awarded_marks: val });
    }
  }

  var r = await supabase.rpc('admin_adjust_marks', {
    p_submission_id: currentAdjustingSubmissionId,
    p_adjustments: adjustments
  });

  if (r.error) { msgEl.className = 'msg err'; msgEl.textContent = 'Error: ' + r.error.message; return; }

  msgEl.className = 'msg ok'; msgEl.textContent = 'Marks updated successfully.';

  // Reload the student detail if it's open
  if (currentDetailStudentId) {
    setTimeout(function () { loadStudentResults(currentDetailStudentId); }, 600);
  }
}

function closeMarkAdjuster() {
  document.getElementById('markAdjusterModal').style.display = 'none';
  currentAdjustingSubmissionId = null;
  currentAdjustingAnswers = [];
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
    'Total Score', 'Total Possible', 'Percent', 'Avg %',
    'Exams Taken'
  ]);

  cumulativeRanksCache.forEach(function (s) {
    rows.push([
      s.cumulative_rank,
      s.full_name,
      s.login_id,
      s.grade_level || '',
      s.field || '',
      s.section || '',
      s.cumulative_score,
      s.cumulative_possible,
      s.cumulative_percent + '%',
      s.avg_percent + '%',
      s.exams_taken
    ]);
  });

  var date = new Date().toISOString().slice(0, 10);
  downloadCSV('SMR_All_Rankings_' + date + '.csv', rows);
}

async function exportStudentResultsCSV() {
  if (!currentDetailStudentId) { toast('Open a student first.', 'info'); return; }

  var student = allStudents.filter(function (s) { return s.id === currentDetailStudentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  // Fetch all submissions for this student
  var subs = await supabase.from('submissions')
    .select('*, exams(title, total_marks, courses(name))')
    .eq('student_id', currentDetailStudentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: false });

  if (!subs.data || subs.data.length === 0) { toast('No results to export.', 'info'); return; }

  var rows = [];

  // Header info
  rows.push(['Student Report']);
  rows.push(['Name', student.full_name]);
  rows.push(['ID', student.login_id]);
  rows.push(['Grade', student.grade_level || '']);
  rows.push(['Field', student.field || '']);
  rows.push(['Section', student.section || '']);
  rows.push(['Generated', new Date().toLocaleString()]);
  rows.push([]);

  // Summary
  rows.push(['Exam Summary']);
  rows.push(['Exam', 'Course', 'Score', 'Total', '%', 'Status', 'Graded At']);

  var grandTotal = 0;
  var grandPossible = 0;

  subs.data.forEach(function (s) {
    grandTotal += (s.total_score || 0);
    grandPossible += (s.total_possible || 0);
    var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
    rows.push([
      s.exams.title,
      s.exams.courses ? s.exams.courses.name : '',
      s.total_score || 0,
      s.total_possible || 0,
      pct + '%',
      s.is_confirmed ? 'Confirmed' : 'Pending',
      s.graded_at ? new Date(s.graded_at).toLocaleDateString() : ''
    ]);
  });

  var grandPct = grandPossible > 0 ? Math.round((grandTotal / grandPossible) * 100) : 0;
  rows.push(['GRAND TOTAL', '', grandTotal, grandPossible, grandPct + '%', '', '']);
  rows.push([]);

  // Per-question details for each exam
  for (var i = 0; i < subs.data.length; i++) {
    var s = subs.data[i];
    rows.push(['Exam: ' + s.exams.title + ' (' + (s.exams.courses ? s.exams.courses.name : '') + ')']);
    rows.push(['Q#', 'Question', 'Student Answer', 'Correct Answer', 'Result', 'Awarded', 'Max']);

    var ansRes = await supabase.from('submission_answers').select('*')
      .eq('submission_id', s.id).order('question_number');
    var keyRes = await supabase.from('answer_keys').select('*')
      .eq('exam_id', s.exam_id).order('question_number');

    var answers = ansRes.data || [];
    var keys = keyRes.data || [];

    answers.forEach(function (a) {
      var key = keys.filter(function (k) { return k.question_number === a.question_number; })[0];
      rows.push([
        a.question_number,
        key && key.question_text ? key.question_text : '',
        a.student_answer || '',
        key ? key.correct_answer : '',
        a.is_correct ? 'Correct' : 'Wrong',
        a.awarded_marks != null ? a.awarded_marks : 0,
        key ? key.marks : ''
      ]);
    });
    rows.push([]);
  }

  var safeName = student.full_name.replace(/[^a-zA-Z0-9]/g, '_');
  var date = new Date().toISOString().slice(0, 10);
  downloadCSV('SMR_' + safeName + '_' + date + '.csv', rows);
}

async function printStudentDetail() {
  if (!currentDetailStudentId) { toast('Open a student first.', 'info'); return; }
  var student = allStudents.filter(function (s) { return s.id === currentDetailStudentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  // Fetch rankings
  var rankRes = await supabase.from('cumulative_rankings').select('*').eq('student_id', currentDetailStudentId).single();
  var rank = rankRes.data;

  // Fetch results
  var subs = await supabase.from('submissions')
    .select('*, exams(title, total_marks, courses(name))')
    .eq('student_id', currentDetailStudentId)
    .eq('status', 'graded')
    .order('graded_at', { ascending: false });
  var submissions = subs.data || [];

  // Build printable HTML
  var html = '<!DOCTYPE html><html><head><title>Student Report - ' + student.full_name + '</title>';
  html += '<style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; color: #222; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 2px solid #1a3d6d; padding-bottom: 8px; }';
  html += 'h2 { color: #1a3d6d; font-size: 16px; margin-top: 20px; }';
  html += '.info { margin: 16px 0; padding: 12px; background: #f7f9fc; border-radius: 6px; }';
  html += '.info div { margin: 4px 0; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 8px; }';
  html += 'th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 12px; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += '.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; color: white; }';
  html += '.confirmed { background: #00b894; }';
  html += '.pending { background: #e67e22; }';
  html += '.rankbox { background: #1a73e8; color: white; padding: 12px; border-radius: 6px; text-align: center; margin: 12px 0; }';
  html += '.footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';

  html += '<h1>🏛️ SMR — Student Academic Report</h1>';
  html += '<div class="info">';
  html += '<div><b>Name:</b> ' + student.full_name + '</div>';
  html += '<div><b>ID:</b> ' + student.login_id + '</div>';
  html += '<div><b>Grade:</b> ' + (student.grade_level || '-') + ' &nbsp; | &nbsp; <b>Section:</b> ' + (student.section || '-') + ' &nbsp; | &nbsp; <b>Field:</b> ' + (student.field || '-') + '</div>';
  html += '<div><b>Status:</b> ' + (student.is_banned ? 'BANNED' : 'ACTIVE') + '</div>';
  html += '<div><b>Report Generated:</b> ' + new Date().toLocaleString() + '</div>';
  html += '</div>';

  if (rank) {
    html += '<div class="rankbox">';
    html += '<b>CUMULATIVE RANK: #' + rank.cumulative_rank + ' of ' + rank.total_students + '</b><br>';
    html += 'Total Score: ' + rank.cumulative_score + ' / ' + rank.cumulative_possible + ' (' + rank.cumulative_percent + '%) &nbsp; | &nbsp; Avg per Exam: ' + rank.avg_percent + '%';
    html += '</div>';
  }

  html += '<h2>📊 Exam Results</h2>';
  if (submissions.length === 0) {
    html += '<p>No exams taken yet.</p>';
  } else {
    html += '<table><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>%</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    submissions.forEach(function (s) {
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      var badge = s.is_confirmed ? '<span class="badge confirmed">Confirmed</span>' : '<span class="badge pending">Pending</span>';
      html += '<tr>' +
        '<td>' + s.exams.title + '</td>' +
        '<td>' + (s.exams.courses ? s.exams.courses.name : '-') + '</td>' +
        '<td>' + s.total_score + ' / ' + s.total_possible + '</td>' +
        '<td>' + pct + '%</td>' +
        '<td>' + badge + '</td>' +
        '<td>' + (s.graded_at ? new Date(s.graded_at).toLocaleDateString() : '-') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="footer">Generated by SMR — Customer Service: @TE21HUSH (Telegram)</div>';
  html += '</body></html>';

  var printWindow = window.open('', '_blank');
  printWindow.document.write(html);
  printWindow.document.close();
  setTimeout(function () { printWindow.print(); }, 500);
}


// ====== PRINT STUDENT FULL REPORT ======

async function printStudentFullReport(studentId) {
  var student = allStudents.filter(function (s) { return s.id === studentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  // Ask whether to include rank
  var includeRank = confirm(
    'Include rank in the report?\n\n' +
    '• Click OK → include rank information\n' +
    '• Click Cancel → no rank (score only)'
  );

  // Fetch all data
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

  // Build HTML
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
  html += '@media print { body { padding: 15px; } h1 { font-size: 22px; } }';
  html += '</style></head><body>';

  html += '<h1>🏛️ Student Mark Recognition</h1>';
  html += '<p class="subtitle">Official Academic Report — Generated ' + new Date().toLocaleString() + '</p>';

  html += '<div class="info">';
  html += '<div><b>Name:</b> ' + student.full_name + '</div>';
  html += '<div><b>Student ID:</b> ' + student.login_id + '</div>';
  html += '<div><b>Grade:</b> ' + (student.grade_level || '-') + '</div>';
  html += '<div><b>Section:</b> ' + (student.section || '-') + '</div>';
  html += '<div><b>Field:</b> ' + (student.field || '-') + '</div>';
  html += '<div><b>Status:</b> ' + (student.is_banned ? 'Inactive' : 'Active') + '</div>';
  html += '</div>';

  if (includeRank && rank) {
    var medal = rank.cumulative_rank === 1 ? '🥇' : rank.cumulative_rank === 2 ? '🥈' : rank.cumulative_rank === 3 ? '🥉' : '';
    html += '<div class="rankbox">';
    html += '<div style="font-size:14px;margin-bottom:6px;">' + medal + ' CUMULATIVE RANK</div>';
    html += '<div class="big">#' + rank.cumulative_rank + ' of ' + rank.total_students + '</div>';
    html += '<div style="margin-top:8px;font-size:13px;">Total Score: ' + rank.cumulative_score + ' / ' + rank.cumulative_possible + ' (' + rank.cumulative_percent + '%)</div>';
    html += '<div style="font-size:12px;margin-top:4px;">Average per Exam: ' + rank.avg_percent + '%</div>';
    html += '</div>';
  }

  if (submissions.length === 0) {
    html += '<h2>📊 Exam Results</h2>';
    html += '<p style="color:#888;">No exams graded yet.</p>';
  } else {
    html += '<h2>📊 Exam Results (' + submissions.length + ' exams)</h2>';
    html += '<table><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>Total</th><th>%</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    var grandTotal = 0, grandPossible = 0;
    submissions.forEach(function (s) {
      grandTotal += (s.total_score || 0);
      grandPossible += (s.total_possible || 0);
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      var badge = s.is_confirmed ? '<span class="badge confirmed">✓ Confirmed</span>' : '<span class="badge pending">Pending</span>';
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
  html += '<p><b>Student Mark Recognition (SMR)</b> — AI-Powered Exam Grading</p>';
  html += '<p>Customer Service: <b>@TE21HUSH</b> (Telegram)</p>';
  html += '<p style="font-size:10px;">This document is electronically generated. Verify with the school administration.</p>';
  html += '</div>';

  html += '</body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.print(); }, 600);
}

// ====== PRINT STUDENT FULL REPORT ======

async function printStudentFullReport(studentId) {
  var student = allStudents.filter(function (s) { return s.id === studentId; })[0];
  if (!student) { toast('Student not found.', 'error'); return; }

  // Ask whether to include rank
  var includeRank = confirm(
    'Include rank in the report?\n\n' +
    '• Click OK → include rank information\n' +
    '• Click Cancel → no rank (score only)'
  );

  // Fetch all data
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

  // Build HTML
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
  html += '@media print { body { padding: 15px; } h1 { font-size: 22px; } }';
  html += '</style></head><body>';

  html += '<h1>🏛️ Student Mark Recognition</h1>';
  html += '<p class="subtitle">Official Academic Report — Generated ' + new Date().toLocaleString() + '</p>';

  html += '<div class="info">';
  html += '<div><b>Name:</b> ' + student.full_name + '</div>';
  html += '<div><b>Student ID:</b> ' + student.login_id + '</div>';
  html += '<div><b>Grade:</b> ' + (student.grade_level || '-') + '</div>';
  html += '<div><b>Section:</b> ' + (student.section || '-') + '</div>';
  html += '<div><b>Field:</b> ' + (student.field || '-') + '</div>';
  html += '<div><b>Status:</b> ' + (student.is_banned ? 'Inactive' : 'Active') + '</div>';
  html += '</div>';

  if (includeRank && rank) {
    var medal = rank.cumulative_rank === 1 ? '🥇' : rank.cumulative_rank === 2 ? '🥈' : rank.cumulative_rank === 3 ? '🥉' : '';
    html += '<div class="rankbox">';
    html += '<div style="font-size:14px;margin-bottom:6px;">' + medal + ' CUMULATIVE RANK</div>';
    html += '<div class="big">#' + rank.cumulative_rank + ' of ' + rank.total_students + '</div>';
    html += '<div style="margin-top:8px;font-size:13px;">Total Score: ' + rank.cumulative_score + ' / ' + rank.cumulative_possible + ' (' + rank.cumulative_percent + '%)</div>';
    html += '<div style="font-size:12px;margin-top:4px;">Average per Exam: ' + rank.avg_percent + '%</div>';
    html += '</div>';
  }

  if (submissions.length === 0) {
    html += '<h2>📊 Exam Results</h2>';
    html += '<p style="color:#888;">No exams graded yet.</p>';
  } else {
    html += '<h2>📊 Exam Results (' + submissions.length + ' exams)</h2>';
    html += '<table><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>Total</th><th>%</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    var grandTotal = 0, grandPossible = 0;
    submissions.forEach(function (s) {
      grandTotal += (s.total_score || 0);
      grandPossible += (s.total_possible || 0);
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      var badge = s.is_confirmed ? '<span class="badge confirmed">✓ Confirmed</span>' : '<span class="badge pending">Pending</span>';
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
  html += '<p><b>Student Mark Recognition (SMR)</b> — AI-Powered Exam Grading</p>';
  html += '<p>Customer Service: <b>@TE21HUSH</b> (Telegram)</p>';
  html += '<p style="font-size:10px;">This document is electronically generated. Verify with the school administration.</p>';
  html += '</div>';

  html += '</body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.print(); }, 600);
}

// ====== BULK REPORTS ======

var currentBulkStudents = [];

function initBulkReportFilters() {
  // Populate grade dropdown
  var grades = [];
  var fields = [];
  var sections = [];
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
    grades.forEach(function (g) {
      var o = document.createElement('option'); o.value = g; o.textContent = g; gradeEl.appendChild(o);
    });
  }
  if (fieldEl && fieldEl.options.length <= 1) {
    fields.forEach(function (f) {
      var o = document.createElement('option'); o.value = f; o.textContent = f; fieldEl.appendChild(o);
    });
  }
  if (sectionEl && sectionEl.options.length <= 1) {
    sections.forEach(function (s) {
      var o = document.createElement('option'); o.value = s; o.textContent = s; sectionEl.appendChild(o);
    });
  }
  if (examEl && examEl.options.length <= 1) {
    allExams.forEach(function (e) {
      var o = document.createElement('option'); o.value = e.id; o.textContent = e.title + ' — ' + (e.courses ? e.courses.name : ''); examEl.appendChild(o);
    });
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
    var row = {
      student: s,
      totalScore: 0,
      totalPossible: 0,
      examsCount: 0,
      percent: 0
    };

    var query = supabase.from('submissions')
      .select('total_score, total_possible')
      .eq('student_id', s.id)
      .eq('status', 'graded');

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

// Filters students by grade/field/section and previews the group report.
async function previewBulkReport() {
  var msgEl = document.getElementById('brMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var students = await getFilteredStudents();
  if (students.length === 0) {
    msgEl.className = 'msg err'; msgEl.textContent = 'No students match these filters.';
    document.getElementById('brPreview').innerHTML = '';
    return;
  }

  var examId = document.getElementById('brExam').value;
  var data = await buildStudentData(students, examId);
  currentBulkStudents = data;

  var html = '<p style="font-weight:bold;">' + data.length + ' students matched</p>';
  html += '<table><thead><tr><th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th><th>Section</th><th>Exams</th><th>Total Score</th><th>%</th></tr></thead><tbody>';
  data.forEach(function (r, idx) {
    var color = r.percent >= 80 ? '#00b894' : r.percent >= 50 ? '#1a73e8' : '#e74c3c';
    html += '<tr>' +
      '<td>#' + (idx + 1) + '</td>' +
      '<td>' + r.student.full_name + '</td>' +
      '<td>' + r.student.login_id + '</td>' +
      '<td>' + (r.student.grade_level || '-') + '</td>' +
      '<td>' + (r.student.field || '-') + '</td>' +
      '<td>' + (r.student.section || '-') + '</td>' +
      '<td>' + r.examsCount + '</td>' +
      '<td>' + r.totalScore + ' / ' + r.totalPossible + '</td>' +
      '<td style="color:' + color + ';font-weight:bold;">' + r.percent + '%</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('brPreview').innerHTML = html;

  msgEl.className = 'msg ok'; msgEl.textContent = data.length + ' students loaded.';
}

// Opens a printable group report in a new window.
async function printBulkReport() {
  if (currentBulkStudents.length === 0) { await previewBulkReport(); }
  if (currentBulkStudents.length === 0) return;

  var grade = document.getElementById('brGrade').value || 'All Grades';
  var field = document.getElementById('brField').value || 'All Fields';
  var section = document.getElementById('brSection').value || 'All Sections';
  var examId = document.getElementById('brExam').value;
  var examName = 'All Exams (Cumulative)';
  if (examId) {
    var e = allExams.filter(function (x) { return x.id === examId; })[0];
    if (e) examName = e.title;
  }

  var html = '<!DOCTYPE html><html><head><title>Bulk Report</title><style>';
  html += 'body { font-family: Arial, sans-serif; padding: 30px; }';
  html += 'h1 { color: #1a3d6d; border-bottom: 3px solid #1a3d6d; padding-bottom: 8px; }';
  html += '.meta { background:#f7f9fc;padding:12px;border-radius:6px;margin:12px 0;font-size:13px; }';
  html += 'table { width: 100%; border-collapse: collapse; margin-top: 12px; }';
  html += 'th, td { padding: 8px; border-bottom: 1px solid #ddd; font-size: 12px; text-align:left; }';
  html += 'th { background: #1a3d6d; color: white; }';
  html += 'tr:nth-child(even) td { background: #f9fbfd; }';
  html += '.footer { margin-top: 30px; padding-top: 12px; border-top: 2px solid #1a3d6d; font-size: 11px; color: #666; text-align: center; }';
  html += '</style></head><body>';

  html += '<h1>📊 Group Report — ' + examName + '</h1>';
  html += '<div class="meta">';
  html += '<b>Grade:</b> ' + grade + ' &nbsp; | &nbsp; <b>Field:</b> ' + field + ' &nbsp; | &nbsp; <b>Section:</b> ' + section;
  html += '<br><b>Total Students:</b> ' + currentBulkStudents.length;
  html += '<br><b>Generated:</b> ' + new Date().toLocaleString();
  html += '</div>';

  html += '<table><thead><tr><th>Rank</th><th>Name</th><th>ID</th><th>Grade</th><th>Field</th><th>Exams</th><th>Score</th><th>%</th></tr></thead><tbody>';
  currentBulkStudents.forEach(function (r, idx) {
    html += '<tr>' +
      '<td>#' + (idx + 1) + '</td>' +
      '<td>' + r.student.full_name + '</td>' +
      '<td>' + r.student.login_id + '</td>' +
      '<td>' + (r.student.grade_level || '-') + '</td>' +
      '<td>' + (r.student.field || '-') + '</td>' +
      '<td>' + r.examsCount + '</td>' +
      '<td>' + r.totalScore + ' / ' + r.totalPossible + '</td>' +
      '<td><b>' + r.percent + '%</b></td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  html += '<div class="footer">Student Mark Recognition (SMR) — @TE21HUSH</div>';
  html += '</body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(function () { w.print(); }, 500);
}

// Downloads the current group report as a UTF-8 CSV file.
function downloadBulkReportCSV() {
  if (currentBulkStudents.length === 0) { toast('Preview first.', 'info'); return; }

  var rows = [['Rank', 'Name', 'ID', 'Grade', 'Field', 'Section', 'Exams Taken', 'Total Score', 'Possible', 'Percent']];
  currentBulkStudents.forEach(function (r, idx) {
    rows.push([
      idx + 1,
      r.student.full_name,
      r.student.login_id,
      r.student.grade_level || '',
      r.student.field || '',
      r.student.section || '',
      r.examsCount,
      r.totalScore,
      r.totalPossible,
      r.percent + '%'
    ]);
  });

  var csv = rows.map(function (r) {
    return r.map(function (v) {
      var s = String(v == null ? '' : v);
      return s.indexOf(',') !== -1 ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\n');

  var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'SMR_Group_Report_' + new Date().toISOString().slice(0, 10) + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function printEachStudentInGroup() {
  if (currentBulkStudents.length === 0) { await previewBulkReport(); }
  if (currentBulkStudents.length === 0) return;

  if (!confirm('Print ' + currentBulkStudents.length + ' individual reports? (One print dialog per student)')) return;

  for (var i = 0; i < currentBulkStudents.length; i++) {
    await printStudentFullReport(currentBulkStudents[i].student.id);
    // Small delay between windows to avoid popup blocker
    await new Promise(function (resolve) { setTimeout(resolve, 400); });
  }
}

// ====== DOWNLOAD AS PDF HELPER ======
// Opens a print window with a Save-as-PDF hint, auto-triggers the print dialog.

function openPDFWindow(htmlContent, suggestedFilename) {
  var w = window.open('', '_blank');
  var banner =
    '<div style="position:fixed;top:0;left:0;right:0;background:#1a73e8;color:white;padding:12px;text-align:center;font-family:Arial;font-size:14px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.2);" id="__pdfBanner">' +
      '📄 To save as PDF: Click <b>Print</b> below and choose <b>"Save as PDF"</b> as the destination. ' +
      '<button onclick="document.getElementById(\'__pdfBanner\').style.display=\'none\'; window.print();" style="margin-left:12px;background:white;color:#1a73e8;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">🖨️ Print / Save PDF</button>' +
      '<button onclick="document.getElementById(\'__pdfBanner\').style.display=\'none\';" style="margin-left:8px;background:transparent;color:white;border:1px solid white;padding:6px 14px;border-radius:4px;cursor:pointer;">Dismiss</button>' +
    '</div>' +
    '<div style="height:60px;"></div>';

  w.document.write(htmlContent.replace('<body>', '<body>' + banner));
  w.document.title = suggestedFilename || 'SMR_Report';
  w.document.close();

  // Auto-trigger print dialog
  setTimeout(function () {
    try { w.print(); } catch (e) { console.log('Auto-print blocked:', e); }
  }, 600);
}

// ====== DOWNLOAD AS PDF WRAPPERS ======

async function downloadStudentReportPDF(studentId) {
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

  var html = buildStudentReportHTML(student, submissions, rank, includeRank);
  openPDFWindow(html, 'SMR_' + student.full_name.replace(/[^A-Za-z0-9]/g, '_') + '.pdf');
}

function buildStudentReportHTML(student, submissions, rank, includeRank) {
  var html = '<!DOCTYPE html><html><head><title>Student Report</title><style>';
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
  html += '@media print { body { padding: 15px; } }';
  html += '</style></head><body>';

  html += '<h1>🏛️ Student Mark Recognition</h1>';
  html += '<p class="subtitle">Official Academic Report — Generated ' + new Date().toLocaleString() + '</p>';
  html += '<div class="info">';
  html += '<div><b>Name:</b> ' + student.full_name + '</div>';
  html += '<div><b>Student ID:</b> ' + student.login_id + '</div>';
  html += '<div><b>Grade:</b> ' + (student.grade_level || '-') + '</div>';
  html += '<div><b>Section:</b> ' + (student.section || '-') + '</div>';
  html += '<div><b>Field:</b> ' + (student.field || '-') + '</div>';
  html += '</div>';

  if (includeRank && rank) {
    var medal = rank.cumulative_rank === 1 ? '🥇' : rank.cumulative_rank === 2 ? '🥈' : rank.cumulative_rank === 3 ? '🥉' : '';
    html += '<div class="rankbox">';
    html += '<div style="font-size:14px;margin-bottom:6px;">' + medal + ' CUMULATIVE RANK</div>';
    html += '<div class="big">#' + rank.cumulative_rank + ' of ' + rank.total_students + '</div>';
    html += '<div style="margin-top:8px;font-size:13px;">Total Score: ' + rank.cumulative_score + ' / ' + rank.cumulative_possible + ' (' + rank.cumulative_percent + '%)</div>';
    html += '</div>';
  }

  if (submissions.length === 0) {
    html += '<h2>📊 Exam Results</h2><p style="color:#888;">No exams graded yet.</p>';
  } else {
    html += '<h2>📊 Exam Results (' + submissions.length + ' exams)</h2>';
    html += '<table><thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>Total</th><th>%</th><th>Status</th><th>Date</th></tr></thead><tbody>';
    var grandTotal = 0, grandPossible = 0;
    submissions.forEach(function (s) {
      grandTotal += (s.total_score || 0);
      grandPossible += (s.total_possible || 0);
      var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0;
      var badge = s.is_confirmed ? '<span class="badge confirmed">✓ Confirmed</span>' : '<span class="badge pending">Pending</span>';
      html += '<tr><td>' + s.exams.title + '</td><td>' + (s.exams.courses ? s.exams.courses.name : '-') + '</td>' +
        '<td>' + (s.total_score || 0) + '</td><td>' + (s.total_possible || 0) + '</td>' +
        '<td><b>' + pct + '%</b></td><td>' + badge + '</td>' +
        '<td>' + (s.graded_at ? new Date(s.graded_at).toLocaleDateString() : '-') + '</td></tr>';
    });
    var grandPct = grandPossible > 0 ? Math.round((grandTotal / grandPossible) * 100) : 0;
    html += '<tr style="background:#1a3d6d;color:white;font-weight:bold;"><td colspan="2">TOTAL</td><td>' + grandTotal + '</td><td>' + grandPossible + '</td><td>' + grandPct + '%</td><td colspan="2"></td></tr>';
    html += '</tbody></table>';
  }

  html += '<div class="footer"><p><b>Student Mark Recognition (SMR)</b> — @TE21HUSH (Telegram)</p></div>';
  html += '</body></html>';
  return html;
}


// Opens the group report in the browser's Save-as-PDF flow.
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
  html += '<h1>📊 Group Report — ' + examName + '</h1>';
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
  html += '<div class="footer">SMR — @TE21HUSH</div></body></html>';

  openPDFWindow(html, 'SMR_Group_Report.pdf');
}

// ====== DOWNLOAD EXAM RESULTS (Admin) ======

var currentDownloadExamId = null;

function openDownloadModal(examId) {
  currentDownloadExamId = examId;
  var exam = allExams ? allExams.filter(function (e) { return e.id === examId; })[0] : null;
  if (!exam) { toast('Exam not found.', 'error'); return; }
  document.getElementById('dlExamName').textContent = exam.title + ' — ' + (exam.courses ? exam.courses.name : '');
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

  if (format === 'csv') { downloadExamCSV(exam, list, cols); }
  else { downloadExamPDF(exam, list, cols); }
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
    if (cols.percent) { var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0; row.push(pct + '%'); }
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
  html += '<h1>📋 ' + exam.title + '</h1>';
  html += '<p class="meta">Course: ' + (exam.courses ? exam.courses.name : '-') + ' — Total: ' + exam.total_marks + ' — ' + list.length + ' students — ' + new Date().toLocaleString() + '</p>';
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
    if (cols.percent) { var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0; html += '<td><b>' + pct + '%</b></td>'; }
    if (cols.status) html += '<td>' + (s.is_confirmed ? '✓ Confirmed' : 'Pending') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div class="footer"><p><b>SMR</b> — @TE21HUSH (Telegram)</p></div>';
  html += '</body></html>';
  openPDFWindow(html, 'SMR_' + exam.title.replace(/[^A-Za-z0-9]/g, '_') + '.pdf');
}

// ====== DOWNLOAD EXAM RESULTS (Admin) ======

var currentDownloadExamId = null;

function openDownloadModal(examId) {
  currentDownloadExamId = examId;
  var exam = allExams ? allExams.filter(function (e) { return e.id === examId; })[0] : null;
  if (!exam) { toast('Exam not found.', 'error'); return; }
  document.getElementById('dlExamName').textContent = exam.title + ' — ' + (exam.courses ? exam.courses.name : '');
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

  if (format === 'csv') { downloadExamCSV(exam, list, cols); }
  else { downloadExamPDF(exam, list, cols); }
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
    if (cols.percent) { var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0; row.push(pct + '%'); }
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
  html += '<h1>📋 ' + exam.title + '</h1>';
  html += '<p class="meta">Course: ' + (exam.courses ? exam.courses.name : '-') + ' — Total: ' + exam.total_marks + ' — ' + list.length + ' students — ' + new Date().toLocaleString() + '</p>';
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
    if (cols.percent) { var pct = s.total_possible > 0 ? Math.round((s.total_score / s.total_possible) * 100) : 0; html += '<td><b>' + pct + '%</b></td>'; }
    if (cols.status) html += '<td>' + (s.is_confirmed ? '✓ Confirmed' : 'Pending') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div class="footer"><p><b>SMR</b> — @TE21HUSH (Telegram)</p></div>';
  html += '</body></html>';
  openPDFWindow(html, 'SMR_' + exam.title.replace(/[^A-Za-z0-9]/g, '_') + '.pdf');
}



// ====== MY ACCOUNT ======

async function loadMyAccountInfo() {
  var userResult = await supabase.auth.getUser();
  if (!userResult.data.user) return;

  var p = await supabase.from('profiles').select('*').eq('id', userResult.data.user.id).single();
  if (!p.data) return;

  var accEl = document.getElementById('myAccountInfo');
  if (accEl) {
    accEl.innerHTML = '<b>Current Login ID:</b> <code style="background:#fff3cd;padding:4px 10px;border-radius:4px;font-weight:bold;">' + p.data.login_id + '</code>';
  }

  var pwEl = document.getElementById('myPasswordInfo');
  if (pwEl) {
    if (p.data.visible_password) {
      pwEl.innerHTML = '<b>Current password:</b> <code style="background:#fff3cd;padding:4px 10px;border-radius:4px;font-weight:bold;">' + p.data.visible_password + '</code>';
    } else {
      pwEl.innerHTML = '<b>Password:</b> encrypted (not readable). Click the button below to change it.';
    }
  }

  var detEl = document.getElementById('accountDetailInfo');
  if (detEl) {
    detEl.innerHTML =
      '<div class="stat">Full Name: <b>' + p.data.full_name + '</b></div>' +
      '<div class="stat">Role: <b>' + p.data.role.toUpperCase() + '</b></div>' +
      '<div class="stat">Email: <b>' + (p.data.email || '-') + '</b></div>' +
      '<div class="stat">Login ID: <b>' + p.data.login_id + '</b></div>';
  }
}

function startChangeOwnLoginId() {
  var msgEl = document.getElementById('acMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var code = prompt('Enter the secret code to change your login ID:');
  if (!code) return;

  var newId = prompt('Enter your NEW login ID (min 3 characters):');
  if (!newId) return;

  if (newId.trim().length < 3) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'New login ID must be at least 3 characters.';
    return;
  }

  if (!confirm('Change your login ID to "' + newId.trim() + '"?\n\nYou will use this next time you log in.')) return;

  executeChangeOwnLoginId(newId.trim(), code);
}

async function executeChangeOwnLoginId(newId, secretCode) {
  var msgEl = document.getElementById('acMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var r = await supabase.rpc('admin_change_own_login_id', {
    p_new_login_id: newId,
    p_secret_code: secretCode
  });

  if (r.error) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'Error: ' + r.error.message;
    return;
  }

  msgEl.className = 'msg ok';
  msgEl.textContent = 'Login ID changed to "' + newId + '". Use it next time you log in.';
  await loadMyAccountInfo();
}

function startChangeOwnPassword() {
  var msgEl = document.getElementById('pwMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var code = prompt('Enter the secret code to change your password:');
  if (!code) return;

  var newPw = prompt('Enter your NEW password (min 6 characters):');
  if (!newPw) return;
  if (newPw.length < 6) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'Password must be at least 6 characters.';
    return;
  }

  var confirmPw = prompt('Confirm your new password:');
  if (confirmPw !== newPw) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'Passwords do not match.';
    return;
  }

  if (!confirm('Change your password now?')) return;

  executeChangeOwnPassword(newPw, code);
}

async function executeChangeOwnPassword(newPw, secretCode) {
  var msgEl = document.getElementById('pwMsg');
  msgEl.className = 'msg'; msgEl.textContent = '';

  var r = await supabase.rpc('admin_change_own_password', {
    p_new_password: newPw,
    p_secret_code: secretCode
  });

  if (r.error) {
    msgEl.className = 'msg err';
    msgEl.textContent = 'Error: ' + r.error.message;
    return;
  }

  msgEl.className = 'msg ok';
  msgEl.textContent = 'Password changed successfully. Use the new password next time you log in.';
  await loadMyAccountInfo();
}














