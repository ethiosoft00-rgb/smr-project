// ============================================================
// student.js
// Student dashboard logic:
//   - loadResults / loadRanks / loadCumulativeRank
//   - viewAnswers (shows answer sheet + per-question result)
//   - explainAnswer (AI explanation for each question)
//   - AI Tutor (askAIForStudent)
// ============================================================
var currentUser = null;
var currentProfile = null;
var myResults = [];
var myRanks = [];

async function init() {
  var userResult = await supabase.auth.getUser();
  if (!userResult.data.user) { window.location.href = 'login.html'; return; }
  currentUser = userResult.data.user;
  var profileResult = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
  if (!profileResult.data || profileResult.data.role !== 'student') { window.location.href = 'login.html'; return; }
  currentProfile = profileResult.data;
  document.getElementById('studentName').textContent = currentProfile.full_name;
  document.getElementById('infoName').textContent = currentProfile.full_name;
  document.getElementById('infoId').textContent = currentProfile.login_id;
  document.getElementById('infoGrade').textContent = currentProfile.grade_level || '-';
  document.getElementById('infoSection').textContent = currentProfile.section || '-';
  document.getElementById('infoField').textContent = currentProfile.field || '-';
  await loadResults();
  await loadRanks();
  await loadCumulativeRank();
}

async function getLiveTotal(examId) {
  var r = await supabase.from('answer_keys').select('marks').eq('exam_id', examId);
  var sum = 0;
  if (r.data) r.data.forEach(function (k) { sum += (k.marks || 0); });
  return sum;
}

// Fetches the student's graded submissions with exam info.
async function loadResults() {
  var result = await supabase
    .from('submissions')
    .select('*, exams(id, title, total_marks, courses(name))')
    .eq('student_id', currentUser.id)
    .eq('status', 'graded');
  if (result.error) {
    document.getElementById('resultsTable').innerHTML = '<tr><td colspan=\"5\" style=\"color:red;\">Error: ' + result.error.message + '</td></tr>';
    return;
  }
  myResults = result.data || [];
  var tbody = document.getElementById('resultsTable');
  tbody.innerHTML = '';
  if (myResults.length === 0) {
    tbody.innerHTML = '<tr><td colspan=\"5\" style=\"text-align:center;color:#888;\">No results yet.</td></tr>';
    return;
  }
  for (var i = 0; i < myResults.length; i++) {
    var r = myResults[i];
    var liveTotal = await getLiveTotal(r.exams.id);
    if (!liveTotal) liveTotal = r.exams.total_marks;
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td>' + r.exams.title + '</td>' +
      '<td>' + r.exams.courses.name + '</td>' +
      '<td>' + (r.total_score || 0) + '</td>' +
      '<td>' + liveTotal + '</td>' +
      '<td><button onclick=\"viewAnswers(\'' + r.id + '\')\">View</button></td>';
    tbody.appendChild(tr);
  }
}

// Opens the detailed answer view with the sheet image and per-question result.
async function viewAnswers(submissionId) {
  var detail = document.getElementById('answerDetail');
  var content = document.getElementById('answerContent');
  detail.style.display = 'block';
  content.innerHTML = 'Loading...';
  try {
    var submissionResult = await supabase.from('submissions').select('*').eq('id', submissionId).single();
    var submission = submissionResult.data;
    var liveTotal = await getLiveTotal(submission.exam_id);
    if (!liveTotal) liveTotal = '?';
    var storagePath = submission.storage_path;

    var answersResult = await supabase.from('submission_answers').select('*').eq('submission_id', submissionId).order('question_number');
    var keysResult = await supabase.from('answer_keys').select('*').eq('exam_id', submission.exam_id).order('question_number');
    var answers = answersResult.data || [];
    var keys = keysResult.data || [];

    var html = '';
    html += '<p style=\"font-weight:bold;font-size:16px;\">Score: ' + (submission.total_score || 0) + ' / ' + liveTotal + '</p>';

    if (storagePath && storagePath.indexOf('http') === 0) {
      html += '<div style=\"margin-bottom:16px;\"><p style=\"font-weight:bold;\">Your Answer Sheet:</p>';
      html += '<img src=\"' + storagePath + '\" style=\"max-width:100%;border:1px solid #ccc;border-radius:6px;\" /></div>';
    }

    if (answers.length === 0) {
      html += '<p style=\"color:#888;\">No detailed answers.</p>';
      content.innerHTML = html;
      return;
    }

    html += '<table><thead><tr><th>Q#</th><th>Question</th><th>Your Answer</th><th>Correct</th><th>Result</th><th>Marks</th><th>Explain</th></tr></thead><tbody>';
    answers.forEach(function (a) {
      var keyRow = keys.filter(function (k) { return k.question_number === a.question_number; })[0];
      var correctAns = keyRow ? keyRow.correct_answer : '-';
      var questionText = (keyRow && keyRow.question_text) ? keyRow.question_text : '';
      var cls = a.is_correct ? 'correct' : 'incorrect';
      var icon = a.is_correct ? '\u2713 Correct' : '\u2717 Wrong';
      html += '<tr>' +
        '<td>' + a.question_number + '</td>' +
        '<td>' + (questionText || '-') + '</td>' +
        '<td>' + (a.student_answer || '-') + '</td>' +
        '<td>' + correctAns + '</td>' +
        '<td class=\"' + cls + '\">' + icon + '</td>' +
        '<td>' + (a.awarded_marks != null ? a.awarded_marks : 0) + '</td>' +
        '<td><button onclick=\"explainAnswer(\'' + escapeQuote(questionText) + '\', \'' + escapeQuote(a.student_answer || '') + '\', \'' + escapeQuote(correctAns) + '\', ' + (a.is_correct ? 'true' : 'false') + ', ' + a.question_number + ')\">Describe</button></td>' +
        '</tr>';
    });
    html += '</tbody></table><div id=\"explainOutput\"></div>';
    html += '</div>'; // close printableResult
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = '<p style=\"color:red;\">Error: ' + err.message + '</p>';
  }
}

function escapeQuote(s) {
  return String(s).replace(/'/g, '').replace(/\"/g, '').replace(/\\/g, '');
}

// Calls Groq to explain why an answer was right or wrong.
async function explainAnswer(questionText, studentAns, correctAns, isCorrect, qNum) {
  var out = document.getElementById('explainOutput');
  out.innerHTML = '<p style="color:#666;">AI is thinking...</p>';

  var prompt = 'You are a school tutor. Give a REAL, FACTUAL explanation with SPECIFIC FACTS.\n\n';
  if (questionText && questionText.length > 2) prompt += 'QUESTION: ' + questionText + '\n';
  prompt += 'CORRECT ANSWER: ' + correctAns + '\n';
  prompt += 'STUDENT ANSWER: ' + studentAns + '\n\n';
  prompt += 'Write 4-5 sentences:\n1. State the correct answer.\n2. Give 1-2 REAL facts.\n3. ' + (isCorrect ? 'Confirm the student is right.' : 'Explain why the student answer is wrong.') + '\nUse real facts only.';

  try {
    var text = await callGroqChat(prompt, 600, 0);
    out.innerHTML = '<div style="background:#eef6ff;padding:12px;border-radius:6px;margin-top:12px;font-size:14px;"><b>Q' + qNum + ':</b> ' + text + '</div>';
  } catch (e) {
    out.innerHTML = '<p style="color:red;">Error: ' + e.message + '</p>';
  }
}
// Loads per-exam ranks across 5 dimensions.
async function loadRanks() {
  var result = await supabase.from('student_rankings').select('*').eq('student_id', currentUser.id).order('exam_title');
  myRanks = result.data || [];
  var tbody = document.getElementById('rankTable');
  tbody.innerHTML = '';
  if (myRanks.length === 0) {
    tbody.innerHTML = '<tr><td colspan=\"9\" style=\"text-align:center;color:#888;\">No rankings yet.</td></tr>';
    return;
  }
  myRanks.forEach(function (r) {
    var scoreColor = '#1a73e8';
    var percent = r.score_percent || 0;
    if (percent >= 80) scoreColor = '#00b894';
    else if (percent < 50) scoreColor = '#e74c3c';

    var posText = '';
    var pos = parseFloat(r.position_percentile);
    if (!isNaN(pos)) {
      if (pos <= 10) posText = 'Top ' + pos + '%';
      else if (pos <= 25) posText = 'Top ' + pos + '%';
      else if (pos <= 50) posText = 'Top half (' + pos + '%)';
      else posText = 'Bottom ' + (100 - pos).toFixed(0) + '%';
    } else posText = '-';

    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><b>' + (r.exam_title || '-') + '</b></td>' +
      '<td>' + (r.total_score || 0) + ' / ' + (r.total_possible || 0) + '</td>' +
      '<td style=\"color:' + scoreColor + ';font-weight:bold;\">' + percent + '%</td>' +
      '<td>' + (r.avg_score || 0) + ' / ' + (r.avg_possible || 0) + '</td>' +
      '<td>' + (r.avg_percent || 0) + '%</td>' +
      '<td><b style=\"color:#1a73e8;\">' + (r.rank_overall || '-') + ' of ' + (r.total_submissions || '-') + '</b></td>' +
      '<td><b>' + posText + '</b></td>' +
      '<td>' + (r.rank_same_grade || '-') + '</td>' +
      '<td>' + (r.rank_same_grade_field || '-') + '</td>';
    tbody.appendChild(tr);
  });
}

function showTab(name) {
  var tabs = ['overview', 'results', 'rank', 'ai'];
  tabs.forEach(function (t) {
    document.getElementById('view-' + t).style.display = (t === name) ? 'block' : 'none';
    document.getElementById('tab-' + t).className = (t === name) ? 'active' : '';
  });
}

// Sends the student's question to the AI tutor with their own data as context.
async function askAI() {
  var q = document.getElementById('aiQuestion').value.trim();
  var out = document.getElementById('aiAnswer');
  if (!q) { out.textContent = 'Type a question.'; return; }
  if (!currentProfile) { out.textContent = 'Loading...'; return; }
  out.textContent = 'Thinking...';
  try { out.textContent = await askAIForStudent(q, currentProfile, myResults, myRanks); }
  catch (e) { out.textContent = 'Error: ' + e.message; }
}

init();


// Loads the cumulative whole-system rank and the anonymized above-me list.
async function loadCumulativeRank() {
  var summaryEl = document.getElementById('cumulativeSummary');
  var tableEl = document.getElementById('cumulativeTable');
  if (!summaryEl || !tableEl) return;

  summaryEl.innerHTML = 'Loading...';
  tableEl.innerHTML = '';

  var r = await supabase.from('cumulative_rankings').select('*').order('cumulative_rank');
  if (r.error || !r.data) {
    summaryEl.innerHTML = '<p style=\"color:red;\">Error: ' + (r.error ? r.error.message : 'no data') + '</p>';
    return;
  }

  var all = r.data;
  var me = all.filter(function (x) { return x.student_id === currentUser.id; })[0];

  if (!me) {
    summaryEl.innerHTML = '<p style=\"color:#888;\">No exam results yet. Ranking appears after you take an exam.</p>';
    return;
  }

  var myRank = me.cumulative_rank;
  var total = me.total_students;
  var pos = total > 1 ? ((myRank - 1) / (total - 1) * 100) : 0;
  var posText = myRank === 1 ? 'TOP OF THE SYSTEM' : (pos <= 10 ? 'Top 10%' : pos <= 25 ? 'Top 25%' : pos <= 50 ? 'Top half' : 'Bottom ' + Math.round(100 - pos) + '%');

  var color = me.cumulative_percent >= 80 ? '#00b894' : me.cumulative_percent >= 50 ? '#1a73e8' : '#e74c3c';

  summaryEl.innerHTML =
    '<div style=\"display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;\">' +
      '<div style=\"background:#f7f9fc;padding:14px 20px;border-radius:8px;\"><div style=\"font-size:12px;color:#666;\">Total Cumulative Mark</div><div style=\"font-size:22px;font-weight:bold;\">' + me.cumulative_score + ' / ' + me.cumulative_possible + '</div></div>' +
      '<div style=\"background:#f7f9fc;padding:14px 20px;border-radius:8px;\"><div style=\"font-size:12px;color:#666;\">Overall %</div><div style=\"font-size:22px;font-weight:bold;color:' + color + ';\">' + me.cumulative_percent + '%</div></div>' +
      '<div style=\"background:#f7f9fc;padding:14px 20px;border-radius:8px;\"><div style=\"font-size:12px;color:#666;\">Average per Exam</div><div style=\"font-size:22px;font-weight:bold;\">' + me.avg_percent + '%</div></div>' +
      '<div style=\"background:#1a73e8;color:white;padding:14px 20px;border-radius:8px;\"><div style=\"font-size:12px;\">Your Rank</div><div style=\"font-size:22px;font-weight:bold;color:white;\">#' + myRank + ' of ' + total + '</div></div>' +
      '<div style=\"background:#fff4e6;padding:14px 20px;border-radius:8px;\"><div style=\"font-size:12px;color:#666;\">Position</div><div style=\"font-size:22px;font-weight:bold;color:#e67e22;\">' + posText + '</div></div>' +
      '<div style=\"background:#f7f9fc;padding:14px 20px;border-radius:8px;\"><div style=\"font-size:12px;color:#666;\">Exams Taken</div><div style=\"font-size:22px;font-weight:bold;\">' + me.exams_taken + '</div></div>' +
    '</div>';

  // Table: students with marks greater than mine (anonymized)
  var above = all.filter(function (x) { return x.cumulative_score > me.cumulative_score; });

  if (above.length === 0) {
    tableEl.innerHTML = '<p style=\"color:#00b894;font-weight:bold;font-size:15px;\">🏆 You are ranked #1 — no one is above you!</p>';
    return;
  }

  var html = '<h4 style=\"margin-top:12px;\">Students ranked above you (' + above.length + ')</h4>';
  html += '<p style=\"font-size:12px;color:#888;\">Names and IDs are hidden for privacy.</p>';
  html += '<table><thead><tr><th>Position</th><th>Score</th><th>Percent</th><th>Difference</th></tr></thead><tbody>';

  above.forEach(function (s, i) {
    var diff = s.cumulative_score - me.cumulative_score;
    html += '<tr>' +
      '<td>#' + s.cumulative_rank + '</td>' +
      '<td>' + s.cumulative_score + ' / ' + s.cumulative_possible + '</td>' +
      '<td>' + s.cumulative_percent + '%</td>' +
      '<td style=\"color:#e74c3c;\">+ ' + diff + ' marks ahead</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  tableEl.innerHTML = html;
}

function printResult() {
  var content = document.getElementById('printableResult');
  if (!content) { toast('Nothing to print.', 'info'); return; }

  var studentName = (currentProfile && currentProfile.full_name) ? currentProfile.full_name : '';
  var studentId = (currentProfile && currentProfile.login_id) ? currentProfile.login_id : '';
  var grade = (currentProfile && currentProfile.grade_level) ? currentProfile.grade_level : '';
  var field = (currentProfile && currentProfile.field) ? currentProfile.field : '';

  var printWindow = window.open('', '_blank');
  printWindow.document.write(
    '<!DOCTYPE html><html><head><title>SMR Result</title>' +
    '<style>' +
    'body { font-family: Arial, sans-serif; padding: 30px; color: #222; }' +
    'h1 { color: #1a3d6d; border-bottom: 2px solid #1a3d6d; padding-bottom: 8px; }' +
    'h2 { color: #1a3d6d; font-size: 18px; }' +
    '.info { margin: 16px 0; padding: 12px; background: #f7f9fc; border-radius: 6px; }' +
    '.info div { margin: 4px 0; }' +
    'table { width: 100%; border-collapse: collapse; margin-top: 12px; }' +
    'th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; font-size: 13px; }' +
    'th { background: #1a3d6d; color: white; }' +
    '.correct { color: #00b894; font-weight: bold; }' +
    '.incorrect { color: #c0392b; font-weight: bold; }' +
    'button { display: none; }' +
    'img { max-width: 100%; max-height: 400px; border: 1px solid #ccc; border-radius: 6px; margin: 10px 0; }' +
    '.footer { margin-top: 30px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 11px; color: #666; text-align: center; }' +
    '</style></head><body>' +
    '<h1>🏛️ Student Mark Recognition — Official Result</h1>' +
    '<div class="info">' +
    '<div><b>Student Name:</b> ' + studentName + '</div>' +
    '<div><b>Student ID:</b> ' + studentId + '</div>' +
    '<div><b>Grade:</b> ' + grade + ' &nbsp; | &nbsp; <b>Field:</b> ' + field + '</div>' +
    '<div><b>Date Printed:</b> ' + new Date().toLocaleString() + '</div>' +
    '</div>' +
    content.innerHTML +
    '<div class="footer">Generated by SMR — Customer Service: @TE21HUSH (Telegram)</div>' +
    '</body></html>'
  );
  printWindow.document.close();
  setTimeout(function () { printWindow.print(); }, 500);
}











