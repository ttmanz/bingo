'use strict';

const API = '';
let token = localStorage.getItem('bp_token') || '';
let currentUser = null;
let countdownTimer = null;
let nextDraw = null;

// ── Helpers ───────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showModal(id) {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    if (m.id !== 'ios-install') m.classList.add('hidden');
  });
  $(id).classList.remove('hidden');
}

function hideModal(id) { $(id).classList.add('hidden'); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const target = $(id);
  target.classList.remove('hidden');
  target.classList.add('active');
}

function showErr(elId, msg) {
  const el = $(elId);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideErr(elId) { $(elId).classList.add('hidden'); }

function pad(n) { return String(n).padStart(2, '0'); }

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg) {
  const el = $('reg-success');
  $('reg-success-msg').textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Home screen ───────────────────────────────────────────────────────────

$('btnNewCustomer').addEventListener('click', () => {
  clearRegForm();
  showModal('screen-register');
});

$('btnLogin').addEventListener('click', () => {
  clearLoginForm();
  showModal('screen-login');
});

$('btnPlay').addEventListener('click', () => {
  clearLoginForm();
  showModal('screen-login');
});

// ── Register ──────────────────────────────────────────────────────────────

function clearRegForm() {
  ['regName','regEmail','regPhone','regPassword'].forEach(id => $(id).value = '');
  $('regTcCheck').checked = false;
  hideErr('regErr');
}

$('closeRegister').addEventListener('click', () => hideModal('screen-register'));

$('btnRegSubmit').addEventListener('click', async () => {
  hideErr('regErr');
  const name     = $('regName').value.trim();
  const email    = $('regEmail').value.trim();
  const phone    = $('regPhone').value.trim();
  const password = $('regPassword').value;

  if (!name || !email || !password) {
    showErr('regErr', 'Please fill in Name, Email and Password.');
    return;
  }
  if (password.length < 6) {
    showErr('regErr', 'Password must be at least 6 characters.');
    return;
  }
  if (!$('regTcCheck').checked) {
    showErr('regErr', 'Please accept the Terms & Conditions to continue.');
    return;
  }

  const btn = $('btnRegSubmit');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  const { ok, data } = await apiFetch('/api/user-auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, phone, password })
  });

  btn.disabled = false;
  btn.textContent = 'Create Account';

  if (!ok) {
    showErr('regErr', data.message || data.error || 'Registration failed.');
    return;
  }

  // Auto-login after registration
  const login = await apiFetch('/api/user-auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  token = data.token;
  localStorage.setItem('bp_token', token);
  hideModal('screen-register');
  showToast('🎉 Account created — welcome!');
  await enterGame();
});

// ── Login ─────────────────────────────────────────────────────────────────

function clearLoginForm() {
  ['loginEmail','loginPassword'].forEach(id => $(id).value = '');
  hideErr('loginErr');
}

$('closeLogin').addEventListener('click', () => hideModal('screen-login'));

$('switchToRegister').addEventListener('click', e => {
  e.preventDefault();
  hideModal('screen-login');
  clearRegForm();
  showModal('screen-register');
});

$('btnLoginSubmit').addEventListener('click', async () => {
  hideErr('loginErr');
  const email    = $('loginEmail').value.trim();
  const password = $('loginPassword').value;

  if (!email || !password) {
    showErr('loginErr', 'Please enter your email and password.');
    return;
  }

  const btn = $('btnLoginSubmit');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const { ok, data } = await apiFetch('/api/user-auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  btn.disabled = false;
  btn.textContent = 'Sign In';

  if (!ok) {
    showErr('loginErr', data.message || data.error || 'Invalid credentials.');
    return;
  }

  token = data.token;
  localStorage.setItem('bp_token', token);
  hideModal('screen-login');
  await enterGame();
});

// ── Game screen ───────────────────────────────────────────────────────────

async function enterGame() {
  const { ok, data } = await apiFetch('/api/user-portal/me');
  if (!ok) {
    token = '';
    localStorage.removeItem('bp_token');
    showScreen('screen-home');
    return;
  }
  currentUser = data.user || data;
  renderTopBar();
  showScreen('screen-game');
  closeSection();
  await loadDraws();
}

function renderTopBar() {
  $('topPoints').textContent = currentUser.points ?? 0;
  $('pmName').textContent  = currentUser.name  || '';
  $('pmEmail').textContent = currentUser.email || '';
}

// ── Profile menu ──────────────────────────────────────────────────────────

$('profileBtn').addEventListener('click', e => {
  e.stopPropagation();
  $('profileMenu').classList.toggle('hidden');
});

document.addEventListener('click', () => $('profileMenu').classList.add('hidden'));

$('btnSignOut').addEventListener('click', () => {
  token = '';
  currentUser = null;
  localStorage.removeItem('bp_token');
  stopCountdown();
  $('profileMenu').classList.add('hidden');
  showScreen('screen-home');
});

// ── Section navigation ────────────────────────────────────────────────────

window.openSection = function(name) {
  document.getElementById('game-main').style.display = 'none';
  document.querySelectorAll('.section-panel').forEach(p => {
    p.classList.remove('active', 'hidden');
  });
  const panel = document.getElementById('section-' + name);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.closeSection = function() {
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('game-main').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ── Draws data ────────────────────────────────────────────────────────────

let allDraws = [];
let specialDraws = [];

function drawScheduledTime(d) {
  // API returns draw_date ("2026-05-15") and draw_time ("18:00:00") separately
  if (d.draw_date && d.draw_time) return new Date(d.draw_date + 'T' + d.draw_time + 'Z');
  if (d.scheduled_time) return new Date(d.scheduled_time);
  return null;
}

async function loadDraws() {
  const { ok, data } = await apiFetch('/api/user-portal/available-draws');
  if (!ok) { allDraws = []; specialDraws = []; }
  else {
    allDraws    = Array.isArray(data) ? data : (data.regular || []);
    specialDraws = data.special || [];
  }

  // find next scheduled regular draw
  const scheduled = allDraws
    .filter(d => d.status === 'scheduled')
    .sort((a, b) => drawScheduledTime(a) - drawScheduledTime(b));

  nextDraw = scheduled[0] || null;
  renderCountdown();
  renderSpecialDraws();
  renderBuyList();
}

// ── Countdown ─────────────────────────────────────────────────────────────

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

function renderCountdown() {
  stopCountdown();

  if (!nextDraw) {
    $('nextDrawTitle').textContent = 'No upcoming draws';
    $('nextDrawTime').textContent  = '';
    $('nextDrawSub').textContent   = '';
    ['cd-h','cd-m','cd-s'].forEach(id => $(id).textContent = '--');
    return;
  }

  const st = drawScheduledTime(nextDraw);
  $('nextDrawTitle').textContent = nextDraw.title || nextDraw.name || 'Next Draw';
  $('nextDrawTime').textContent  = st ? st.toLocaleString() : '';
  $('nextDrawSub').textContent   = nextDraw.full_house_prize
    ? '🏆 Full house: ' + nextDraw.full_house_prize + ' pts'
    : '';

  function tick() {
    const diff = (st ? st : drawScheduledTime(nextDraw)) - Date.now();
    if (diff <= 0) {
      ['cd-h','cd-m','cd-s'].forEach(id => $(id).textContent = '00');
      stopCountdown();
      loadDraws();
      return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    $('cd-h').textContent = pad(h);
    $('cd-m').textContent = pad(m);
    $('cd-s').textContent = pad(s);
  }

  tick();
  countdownTimer = setInterval(tick, 1000);
}

$('btnBuyFromCountdown').addEventListener('click', () => openSection('buy'));

// ── Special Draws ─────────────────────────────────────────────────────────

function renderSpecialDraws() {
  const specials = specialDraws;
  const container = $('specialList');

  if (!specials.length) {
    container.innerHTML = '<div class="no-draws-banner">No draws available right now</div>';
    return;
  }

  container.innerHTML = specials.map(d => drawCard(d, true)).join('');
  container.querySelectorAll('.btn-buy-draw').forEach(btn => {
    btn.addEventListener('click', () => openBuyModal(+btn.dataset.id));
  });
}

// ── Buy Tickets tab ───────────────────────────────────────────────────────

function renderBuyList() {
  const buyable = allDraws.filter(d => d.status === 'scheduled');
  const container = $('buyList');

  if (!buyable.length) {
    container.innerHTML = '<div class="empty-state">No draws available for purchase.</div>';
    return;
  }

  container.innerHTML = buyable.map(d => drawCard(d, true)).join('');
  container.querySelectorAll('.btn-buy-draw').forEach(btn => {
    btn.addEventListener('click', () => openBuyModal(+btn.dataset.id));
  });
}

function drawCard(d, showBuy) {
  const st    = drawScheduledTime(d);
  const time  = st ? st.toLocaleString() : '';
  const prize = d.full_house_prize ? '🏆 ' + d.full_house_prize + ' pts' : '';
  const line  = d.line_prize       ? '🎯 Line: ' + d.line_prize + ' pts'  : '';
  const cost  = d.ticket_price ?? d.price ?? 1;
  const statusCls = 'badge-' + (d.status || 'scheduled');

  return `<div class="draw-card">
    <div class="dc-header">
      <span class="dc-name">${d.title || d.name || 'Draw'}</span>
      <span class="badge ${statusCls}">${d.status || 'scheduled'}</span>
    </div>
    ${time ? `<div class="dc-time">🕐 ${time}</div>` : ''}
    <div class="dc-prizes">${[prize, line].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
    <div class="dc-footer">
      <span class="dc-cost">🎟 ${cost} pt${cost !== 1 ? 's' : ''} / ticket</span>
      ${showBuy ? `<button class="btn btn-primary btn-sm btn-buy-draw" data-id="${d.id}">Buy</button>` : ''}
    </div>
  </div>`;
}

// ── Buy confirm modal ─────────────────────────────────────────────────────

let activeBuyDrawId = null;
let activeBuyPrice  = 1;
let buyQty = 1;
let numpadInput = '';

function openBuyModal(drawId) {
  const draw = [...allDraws, ...specialDraws].find(d => d.id === drawId);
  if (!draw) return;

  activeBuyDrawId = drawId;
  activeBuyPrice  = draw.ticket_price ?? draw.price ?? 1;
  buyQty = 1;
  numpadInput = '';

  const balance = currentUser.points ?? 0;

  if (balance < activeBuyPrice) {
    $('modalPoints').textContent = balance + ' pts';
    showModal('modal-points');
    return;
  }

  $('buyModalTitle').textContent = 'Buy Ticket — ' + (draw.name || 'Draw');
  hideErr('buyErr');
  $('buyOk').classList.add('hidden');
  $('buyNumpad').classList.add('hidden');
  updateBuyModal(balance);
  showModal('modal-buy');
}

function updateBuyModal(balance) {
  const bal = balance ?? currentUser.points ?? 0;
  $('qtyVal').textContent  = numpadInput || buyQty;
  $('buyCost').textContent = (numpadInput ? (parseInt(numpadInput) || 0) : buyQty) * activeBuyPrice;
  $('buyBal').textContent  = bal;
}

// ── Numpad toggle ──
$('qtyDisplay').addEventListener('click', () => {
  const pad = $('buyNumpad');
  pad.classList.toggle('hidden');
  if (!pad.classList.contains('hidden')) {
    numpadInput = String(buyQty);
    updateBuyModal();
  }
});

// ── Numpad button handler ──
$('buyNumpad').addEventListener('click', e => {
  const btn = e.target.closest('.np-btn');
  if (!btn) return;
  const n = btn.dataset.n;
  const max = Math.floor((currentUser.points ?? 0) / activeBuyPrice);

  if (n === 'back') {
    numpadInput = numpadInput.slice(0, -1);
  } else if (n === 'ok') {
    const val = parseInt(numpadInput) || 1;
    buyQty = Math.min(Math.max(val, 1), Math.max(max, 1));
    numpadInput = '';
    $('buyNumpad').classList.add('hidden');
  } else {
    const next = numpadInput + n;
    if (parseInt(next) <= 999) numpadInput = next.replace(/^0+/, '') || '0';
  }
  updateBuyModal();
});

$('closeBuy').addEventListener('click', () => {
  numpadInput = '';
  $('buyNumpad').classList.add('hidden');
  hideModal('modal-buy');
});

$('btnBuyConfirm').addEventListener('click', async () => {
  // Finalise any in-progress numpad entry
  if (numpadInput) {
    const max = Math.floor((currentUser.points ?? 0) / activeBuyPrice);
    buyQty = Math.min(Math.max(parseInt(numpadInput) || 1, 1), Math.max(max, 1));
    numpadInput = '';
    $('buyNumpad').classList.add('hidden');
    updateBuyModal();
  }

  hideErr('buyErr');
  $('buyOk').classList.add('hidden');

  const balance = currentUser.points ?? 0;
  const cost    = buyQty * activeBuyPrice;

  if (cost > balance) {
    $('modalPoints').textContent = balance + ' pts';
    hideModal('modal-buy');
    showModal('modal-points');
    return;
  }

  const btn = $('btnBuyConfirm');
  btn.disabled = true;
  btn.textContent = 'Purchasing…';

  const { ok, data } = await apiFetch(`/api/user-portal/buy/${activeBuyDrawId}`, {
    method: 'POST',
    body: JSON.stringify({ quantity: buyQty })
  });

  btn.disabled = false;
  btn.textContent = 'Confirm Purchase';

  if (!ok) {
    if (data.code === 'INSUFFICIENT_POINTS' || (data.message || '').toLowerCase().includes('point')) {
      hideModal('modal-buy');
      $('modalPoints').textContent = (currentUser.points ?? 0) + ' pts';
      showModal('modal-points');
      return;
    }
    showErr('buyErr', data.message || data.error || 'Purchase failed.');
    return;
  }

  // Update local balance
  if (data.remaining_points !== undefined) currentUser.points = data.remaining_points;
  else if (data.points !== undefined)      currentUser.points = data.points;
  else                                     currentUser.points = balance - cost;

  renderTopBar();
  const purchased = buyQty;
  buyQty = 1;
  numpadInput = '';

  // Close modal and return to main game page after brief success flash
  hideModal('modal-buy');
  closeSection();
  // Brief toast notification
  const toast = document.createElement('div');
  toast.className = 'buy-toast';
  toast.textContent = `✅ ${purchased} ticket${purchased > 1 ? 's' : ''} purchased!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
});

// ── Get Points modal ──────────────────────────────────────────────────────

$('closePoints').addEventListener('click',   () => hideModal('modal-points'));
$('closePointsOk').addEventListener('click', () => hideModal('modal-points'));


// ── Auto-login on load ────────────────────────────────────────────────────

(async () => {
  if (token) {
    const { ok } = await apiFetch('/api/user-portal/me');
    if (ok) { await enterGame(); return; }
    token = '';
    localStorage.removeItem('bp_token');
  }
  showScreen('screen-home');
})();

// ── Install banner ────────────────────────────────────────────────────────

(function () {
  // Don't show if already installed (standalone) or dismissed within 7 days
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const dismissed = localStorage.getItem('ib_dismissed');
  if (isStandalone || (dismissed && Date.now() - +dismissed < 7 * 86400000)) return;

  const banner  = $('install-banner');
  const iosModal = $('ios-install');

  function dismissBanner() {
    banner.classList.add('hidden');
    localStorage.setItem('ib_dismissed', Date.now());
  }

  $('ibClose').addEventListener('click', dismissBanner);
  $('closeIos').addEventListener('click',   () => iosModal.classList.add('hidden'));
  $('closeIosOk').addEventListener('click', () => iosModal.classList.add('hidden'));

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInSafari = /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent);

  if (isIos && isInSafari) {
    // iOS Safari — show banner, tapping Add opens instruction modal
    setTimeout(() => banner.classList.remove('hidden'), 3000);
    $('ibInstall').addEventListener('click', () => {
      banner.classList.add('hidden');
      iosModal.classList.remove('hidden');
    });
    return;
  }

  // Android / desktop Chrome — use beforeinstallprompt
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(() => banner.classList.remove('hidden'), 3000);
  });

  $('ibInstall').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    dismissBanner();
  });

  window.addEventListener('appinstalled', dismissBanner);
})();
