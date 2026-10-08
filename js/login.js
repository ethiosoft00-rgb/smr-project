// ============================================================
// login.js
// Handles login, registration redirect, and password reset
// requests. Resolves the user's ID to their synthetic email
// via the get_login_options RPC, then authenticates with
// Supabase Auth. Auto-redirects by role.
// ============================================================
var msg = document.getElementById('msg');

function showError(text) { msg.className = 'msg err'; msg.textContent = text; }
function showOk(text) { msg.className = 'msg ok'; msg.textContent = text; }
function hideMsg() { msg.className = 'msg'; msg.textContent = ''; }

async function doLogin() {
  hideMsg();
  var id = document.getElementById('loginId').value.trim();
  var pw = document.getElementById('password').value;

  if (!id || !pw) { showError('Please fill in ID and password.'); return; }

  var loginBtn = document.querySelector('button.primary');
  if (loginBtn) setButtonLoading(loginBtn, 'Logging in...');

  // Look up ALL accounts with this ID (could be teacher AND student with same ID)
  var opts = await supabase.rpc('get_login_options', { p_login_id: id });
  if (opts.error) { if (loginBtn) clearButtonLoading(loginBtn); showError('Lookup failed: ' + opts.error.message); return; }
  if (!opts.data || opts.data.length === 0) {
    if (loginBtn) clearButtonLoading(loginBtn);
    showError('No account found with ID: ' + id);
    return;
  }

  // Try each matching account's email with the password
  var loggedIn = false;
  var lastError = '';
  var matchedRole = null;

  for (var i = 0; i < opts.data.length; i++) {
    var attempt = await supabase.auth.signInWithPassword({
      email: opts.data[i].email,
      password: pw
    });
    if (!attempt.error && attempt.data && attempt.data.user) {
      loggedIn = true;
      matchedRole = opts.data[i].role;
      break;
    } else {
      lastError = attempt.error ? attempt.error.message : 'unknown';
    }
  }

  if (!loggedIn) {
    if (loginBtn) clearButtonLoading(loginBtn);
    showError('Login failed: wrong password.');
    return;
  }

  showOk('Login successful! Loading...');

  setTimeout(function () {
    if (matchedRole === 'admin') { window.location.href = 'admin.html'; }
    else if (matchedRole === 'teacher') { window.location.href = 'teacher.html'; }
    else { window.location.href = 'student.html'; }
  }, 800);
}

function showForgot() {
  hideMsg();
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('forgotView').style.display = 'block';
}

function showLogin() {
  hideMsg();
  document.getElementById('forgotView').style.display = 'none';
  document.getElementById('loginView').style.display = 'block';
}

async function doForgot() {
  hideMsg();
  var id = document.getElementById('forgotId').value.trim();
  var email = document.getElementById('forgotEmail').value.trim();
  if (!id || !email) { showError('Please fill in both fields.'); return; }

  var opts = await supabase.rpc('get_login_options', { p_login_id: id });
  if (opts.error || !opts.data || opts.data.length === 0) {
    showError('No account found with ID: ' + id);
    return;
  }

  // Use the first matching account
  var profileResult = await supabase.from('profiles').select('id').eq('login_id', id).limit(1).single();
  if (!profileResult.data) { showError('Profile not found.'); return; }

  var insertResult = await supabase.from('password_reset_requests').insert({
    user_id: profileResult.data.id, email: email, status: 'pending'
  });
  if (insertResult.error) { showError('Could not send request: ' + insertResult.error.message); return; }

  showOk('Request sent to admin.');
}



