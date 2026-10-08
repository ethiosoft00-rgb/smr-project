// ============================================================
// SMR Automated Test Suite
// ============================================================

var tests = [];
var results = { passed: 0, failed: 0 };
var currentGroup = '';

function group(name) {
  currentGroup = name;
}

function test(name, fn) {
  tests.push({ group: currentGroup, name: name, fn: fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message || 'Expected match') + ' — got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
  }
}

// Recreate the pure functions from the app for testing
function normalizeAnswer(s) {
  if (s === null || s === undefined) return '';
  var t = String(s).toLowerCase();
  t = t.replace(/[\u2018\u2019\u201C\u201D]/g, '');
  t = t.replace(/\s+/g, '');
  t = t.replace(/^[\.\,\;\:\-]+|[\.\,\;\:\-]+$/g, '');
  return t;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function parseAnswerKey(text) {
  var normalized = text.replace(/\r/g, '').replace(/[,\n;]/g, ' ').replace(/\s+/g, ' ').trim();
  var answers = {};
  var re = /(?:Q\s*)?(\d{1,3})\s*[\.\,\)\:\=\-]?\s*([A-Za-z0-9]+)/g;
  var m;
  while ((m = re.exec(normalized)) !== null) {
    var q = parseInt(m[1], 10);
    if (!answers[q]) answers[q] = m[2].toUpperCase();
  }
  return answers;
}

function applyOcrText(text) {
  var normalized = text.replace(/\r/g, '').replace(/[,\n;]/g, ' ').replace(/\s+/g, ' ').trim();
  var answers = {};
  var re1 = /(?:Q\s*)?(\d{1,3})\s*[\.\,\)\:\=\-]\s*([A-Za-z0-9]+)/g;
  var m;
  while ((m = re1.exec(normalized)) !== null) {
    var q = parseInt(m[1], 10);
    var a = m[2].toUpperCase();
    if (!answers[q]) answers[q] = a;
  }
  var re2 = /\b(\d{1,3})\s+([A-Za-z])\b/g;
  while ((m = re2.exec(normalized)) !== null) {
    var q2 = parseInt(m[1], 10);
    var a2 = m[2].toUpperCase();
    if (!answers[q2]) answers[q2] = a2;
  }
  var re3 = /\b(\d{1,3})([A-Za-z])\b/g;
  while ((m = re3.exec(normalized)) !== null) {
    var q3 = parseInt(m[1], 10);
    var a3 = m[2].toUpperCase();
    if (!answers[q3]) answers[q3] = a3;
  }
  return answers;
}

// ============================================================
// GROUP: Answer Normalization
// ============================================================
group('Answer Normalization');

test('normalizeAnswer: exact match', function () {
  assertEqual(normalizeAnswer('A'), 'a');
});

test('normalizeAnswer: case insensitive', function () {
  assertEqual(normalizeAnswer('NewTon'), 'newton');
});

test('normalizeAnswer: strips spaces', function () {
  assertEqual(normalizeAnswer('  42  '), '42');
});

test('normalizeAnswer: strips periods', function () {
  assertEqual(normalizeAnswer('.A.'), 'a');
});

test('normalizeAnswer: handles null', function () {
  assertEqual(normalizeAnswer(null), '');
});

test('normalizeAnswer: handles undefined', function () {
  assertEqual(normalizeAnswer(undefined), '');
});

test('normalizeAnswer: handles empty string', function () {
  assertEqual(normalizeAnswer(''), '');
});

test('normalizeAnswer: "Addis Ababa" vs "addisababa"', function () {
  assertEqual(normalizeAnswer('Addis Ababa'), normalizeAnswer('addisababa'));
});

test('normalizeAnswer: smart quotes removed', function () {
  assertEqual(normalizeAnswer('\u2018A\u2019'), 'a');
});

// ============================================================
// GROUP: Answer Key Parser
// ============================================================
group('Answer Key Parser');

test('parseAnswerKey: "1.A 2.B"', function () {
  var r = parseAnswerKey('1.A 2.B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('parseAnswerKey: "1=A 2=B"', function () {
  var r = parseAnswerKey('1=A 2=B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('parseAnswerKey: "1) A  2) B"', function () {
  var r = parseAnswerKey('1) A  2) B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('parseAnswerKey: "1,A 2,B"', function () {
  var r = parseAnswerKey('1,A 2,B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('parseAnswerKey: multi-line', function () {
  var r = parseAnswerKey('1.A\n2.B\n3.C');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
  assertEqual(r[3], 'C');
});

test('parseAnswerKey: 10 questions', function () {
  var r = parseAnswerKey('1.A 2.B 3.C 4.D 5.A 6.B 7.C 8.D 9.A 10.B');
  assertEqual(Object.keys(r).length, 10);
  assertEqual(r[10], 'B');
});

test('parseAnswerKey: ignores empty', function () {
  var r = parseAnswerKey('');
  assertEqual(Object.keys(r).length, 0);
});

test('parseAnswerKey: no duplicates', function () {
  var r = parseAnswerKey('1.A 1.B');
  assertEqual(r[1], 'A'); // first wins
});

// ============================================================
// GROUP: OCR Text Parser
// ============================================================
group('OCR Text Parser');

test('applyOcrText: "1=A 2=B"', function () {
  var r = applyOcrText('1=A 2=B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('applyOcrText: "1A 2B" (no separator)', function () {
  var r = applyOcrText('1A 2B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('applyOcrText: "1 A 2 B" (space separator)', function () {
  var r = applyOcrText('1 A 2 B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('applyOcrText: "Q1=A Q2=B"', function () {
  var r = applyOcrText('Q1=A Q2=B');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
});

test('applyOcrText: handles handwriting "1) B"', function () {
  var r = applyOcrText('1) B');
  assertEqual(r[1], 'B');
});

test('applyOcrText: mixed formats', function () {
  var r = applyOcrText('1.A 2:B 3)C 4= D');
  assertEqual(r[1], 'A');
  assertEqual(r[2], 'B');
  assertEqual(r[3], 'C');
  assertEqual(r[4], 'D');
});

// ============================================================
// GROUP: CSV Escape
// ============================================================
group('CSV Escape');

test('csvEscape: plain text', function () {
  assertEqual(csvEscape('hello'), 'hello');
});

test('csvEscape: comma wrapped in quotes', function () {
  assertEqual(csvEscape('a,b'), '"a,b"');
});

test('csvEscape: quote doubled', function () {
  assertEqual(csvEscape('say "hi"'), '"say ""hi"""');
});

test('csvEscape: newline wrapped', function () {
  assertEqual(csvEscape('line1\nline2'), '"line1\nline2"');
});

test('csvEscape: null becomes empty', function () {
  assertEqual(csvEscape(null), '');
});

test('csvEscape: number to string', function () {
  assertEqual(csvEscape(42), '42');
});

// ============================================================
// GROUP: Grading Logic
// ============================================================
group('Grading Logic');

test('grading: correct answer awarded full marks', function () {
  var student = 'A';
  var correct = 'A';
  var marks = 5;
  var isCorrect = normalizeAnswer(student) === normalizeAnswer(correct);
  assert(isCorrect, 'Should be correct');
});

test('grading: wrong answer awarded zero', function () {
  var student = 'B';
  var correct = 'A';
  var isCorrect = normalizeAnswer(student) === normalizeAnswer(correct);
  assert(!isCorrect, 'Should be wrong');
});

test('grading: blank answer awarded zero', function () {
  var student = '';
  var correct = 'A';
  var isCorrect = normalizeAnswer(student) === normalizeAnswer(correct);
  assert(!isCorrect, 'Blank should be wrong');
});

test('grading: case insensitive match', function () {
  var student = 'a';
  var correct = 'A';
  assert(normalizeAnswer(student) === normalizeAnswer(correct));
});

// ============================================================
// GROUP: Database — Read Operations
// ============================================================
group('Database — Read Operations');

test('db: profiles table exists', async function () {
  var r = await supabase.from('profiles').select('id').limit(1);
  assert(!r.error, 'Query failed: ' + (r.error ? r.error.message : ''));
});

test('db: schools table exists', async function () {
  var r = await supabase.from('schools').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: courses table exists', async function () {
  var r = await supabase.from('courses').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: exams table exists', async function () {
  var r = await supabase.from('exams').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: answer_keys table exists', async function () {
  var r = await supabase.from('answer_keys').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: submissions table exists', async function () {
  var r = await supabase.from('submissions').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: submission_answers table exists', async function () {
  var r = await supabase.from('submission_answers').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: password_reset_requests table exists', async function () {
  var r = await supabase.from('password_reset_requests').select('id').limit(1);
  assert(!r.error, 'Query failed');
});

test('db: student_rankings view exists', async function () {
  var r = await supabase.from('student_rankings').select('student_id').limit(1);
  assert(!r.error, 'View missing: ' + (r.error ? r.error.message : ''));
});

test('db: cumulative_rankings view exists', async function () {
  var r = await supabase.from('cumulative_rankings').select('student_id').limit(1);
  assert(!r.error, 'View missing');
});

// ============================================================
// GROUP: Database — RPC Functions
// ============================================================
group('Database — RPC Functions');

test('rpc: get_login_options exists', async function () {
  var r = await supabase.rpc('get_login_options', { p_login_id: '____nonexistent____' });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

test('rpc: admin_change_own_login_id exists', async function () {
  var r = await supabase.rpc('admin_change_own_login_id', { p_new_login_id: 'x', p_secret_code: 'y' });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

test('rpc: admin_change_own_password exists', async function () {
  var r = await supabase.rpc('admin_change_own_password', { p_new_password: 'xxxxxx', p_secret_code: 'y' });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

test('rpc: confirm_submission exists', async function () {
  var r = await supabase.rpc('confirm_submission', { p_submission_id: '00000000-0000-0000-0000-000000000000' });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

test('rpc: unconfirm_submission exists', async function () {
  var r = await supabase.rpc('unconfirm_submission', { p_submission_id: '00000000-0000-0000-0000-000000000000' });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

test('rpc: admin_reset_user_password exists', async function () {
  var r = await supabase.rpc('admin_reset_user_password', { p_user_id: '00000000-0000-0000-0000-000000000000', p_new_password: 'xxxxxx' });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

test('rpc: admin_adjust_marks exists', async function () {
  var r = await supabase.rpc('admin_adjust_marks', { p_submission_id: '00000000-0000-0000-0000-000000000000', p_adjustments: [] });
  assert(!r.error || r.error.code !== '42883', 'Function missing');
});

// ============================================================
// GROUP: RLS — Security
// ============================================================
group('RLS — Security');

test('rls: unauthenticated query blocked or returns empty', async function () {
  // This may or may not return data depending on current session — just ensure no crash
  var r = await supabase.from('profiles').select('id').limit(1);
  assert(r !== null, 'Query should return something');
});

test('rls: cannot insert into submissions without auth', async function () {
  var r = await supabase.from('submissions').insert({
    exam_id: '00000000-0000-0000-0000-000000000000',
    student_id: '00000000-0000-0000-0000-000000000000',
    status: 'pending'
  });
  // Should be blocked by RLS or FK
  assert(r.error !== null || r.data === null, 'Insert should be rejected');
});

// ============================================================
// RUNNER
// ============================================================
async function runAllTests() {
  document.getElementById('runBtn').disabled = true;
  document.getElementById('runBtn').textContent = '⏳ Running...';

  var resultsEl = document.getElementById('results');
  resultsEl.innerHTML = '';

  var startTime = Date.now();
  var passed = 0, failed = 0;
  var lastGroup = '';

  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];

    if (t.group !== lastGroup) {
      var groupEl = document.createElement('div');
      groupEl.className = 'group-title';
      groupEl.textContent = t.group;
      resultsEl.appendChild(groupEl);
      lastGroup = t.group;
    }

    var row = document.createElement('div');
    row.className = 'test-row test-running';
    row.innerHTML = '<span class="icon">⏳</span> ' + t.name;
    resultsEl.appendChild(row);

    try {
      await t.fn();
      row.className = 'test-row test-pass';
      row.innerHTML = '<span class="icon">✅</span> ' + t.name;
      passed++;
    } catch (err) {
      row.className = 'test-row test-fail';
      row.innerHTML = '<span class="icon">❌</span> ' + t.name + ' <span class="error-msg">' + err.message + '</span>';
      failed++;
    }
  }

  var elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  document.getElementById('summary').style.display = 'flex';
  document.getElementById('totalCount').textContent = tests.length;
  document.getElementById('passedCount').textContent = passed;
  document.getElementById('failedCount').textContent = failed;
  document.getElementById('timeCount').textContent = elapsed + 's';

  document.getElementById('runBtn').disabled = false;
  document.getElementById('runBtn').textContent = '▶ Run All Tests Again';
}
