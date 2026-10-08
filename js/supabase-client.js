// Supabase client shared by all pages
var SUPABASE_URL = 'https://zqxpffqyiendlwxfumcf.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_nlcXcnnRd6qdWYtSUL8_Gg_qLOhdVgC';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function logout() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error('Logout error:', e);
  }
  window.location.href = 'login.html';
}

// ====== AUTO-LOGOUT AFTER 30 MINUTES IDLE ======
var IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
var idleTimer = null;
var warningTimer = null;

function startIdleTimer() {
  resetIdleTimer();

  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function (evt) {
    document.addEventListener(evt, resetIdleTimer, true);
  });
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (warningTimer) clearTimeout(warningTimer);

  // Warn 1 minute before logout
  warningTimer = setTimeout(function () {
    if (confirm('You have been idle for 29 minutes. Click OK to stay logged in, or Cancel to log out now.')) {
      resetIdleTimer();
    } else {
      forceLogout();
    }
  }, IDLE_LIMIT_MS - 60000);

  idleTimer = setTimeout(function () {
    forceLogout();
  }, IDLE_LIMIT_MS);
}

async function forceLogout() {
  try { await supabase.auth.signOut(); } catch (e) {}
  alert('Session expired due to inactivity. Please log in again.');
  window.location.href = 'login.html';
}

// Start the timer only if user is logged in and not on login/register page
(function () {
  var page = window.location.pathname.split('/').pop();
  if (page !== 'login.html' && page !== 'register.html' && page !== '') {
    startIdleTimer();
  }
})();


// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function toast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  var icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️'
  };

  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML =
    '<span class="icon">' + (icons[type] || '') + '</span>' +
    '<span class="msg"></span>' +
    '<button class="close" aria-label="close">×</button>';

  el.querySelector('.msg').textContent = message;
  el.querySelector('.close').addEventListener('click', function () {
    dismissToast(el);
  });

  container.appendChild(el);

  // Auto-dismiss after 4 seconds
  setTimeout(function () { dismissToast(el); }, 4000);
}

function dismissToast(el) {
  if (!el || el.classList.contains('toast-out')) return;
  el.classList.add('toast-out');
  setTimeout(function () { el.remove(); }, 300);
}

// ============================================================
// LOADING HELPERS
// ============================================================

// Adds a spinner to a button while an async task is running
function setButtonLoading(btn, text) {
  if (!btn) return;
  if (typeof btn === 'string') btn = document.getElementById(btn);
  if (!btn) return;
  btn.classList.add('loading');
  btn.disabled = true;
  btn.dataset.originalText = btn.textContent;
  if (text) btn.textContent = text;
}

function clearButtonLoading(btn) {
  if (!btn) return;
  if (typeof btn === 'string') btn = document.getElementById(btn);
  if (!btn) return;
  btn.classList.remove('loading');
  btn.disabled = false;
  if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
    delete btn.dataset.originalText;
  }
}

// Full-page loading overlay
function showPageLoader(text) {
  var el = document.getElementById('pageLoader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pageLoader';
    el.className = 'page-loader';
    el.innerHTML = '<div class="big-spinner"></div><div class="text"></div>';
    document.body.appendChild(el);
  }
  el.querySelector('.text').textContent = text || 'Loading...';
  el.classList.add('active');
}

function hidePageLoader() {
  var el = document.getElementById('pageLoader');
  if (el) el.classList.remove('active');
}

// FILE -> BASE64 (for AI image uploads)
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
