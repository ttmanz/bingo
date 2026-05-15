'use strict';

const API = '';
let token = localStorage.getItem('bp_token') || '';
let currentUser = null;
let countdownTimer = null;
let nextDraw = null;

// ── Helpers ───────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function showModal(id) {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

function hideModal(id) { $(id).classList.add('hidden'); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
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

  hideModal('screen-register');
  showToast('🎉 Account created — welcome to Bingo24-7!');
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
  activateTab('next-draw');
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

// ── Tabs ──────────────────────────────────────────────────────────────────

document.querySelectorAll('.gtab').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.dataset.tab));
});

function activateTab(name) {
  document.querySelectorAll('.gtab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + name);
    p.classList.toggle('hidden', p.id !== 'tab-' + name);
  });
}

// ── Draws data ────────────────────────────────────────────────────────────

let allDraws = [];

async function loadDraws() {
  const { ok, data } = await apiFetch('/api/user-portal/available-draws');
  allDraws = ok ? (Array.isArray(data) ? data : data.draws || []) : [];

  // find next scheduled draw
  const scheduled = allDraws
    .filter(d => d.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time));

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

  $('nextDrawTitle').textContent = nextDraw.name || 'Next Draw';
  $('nextDrawTime').textContent  = new Date(nextDraw.scheduled_time).toLocaleString();
  $('nextDrawSub').textContent   = nextDraw.full_house_prize
    ? '🏆 Full house: ' + nextDraw.full_house_prize + ' pts'
    : '';

  function tick() {
    const diff = new Date(nextDraw.scheduled_time) - Date.now();
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

$('btnBuyFromCountdown').addEventListener('click', () => {
  if (!nextDraw) return;
  activateTab('buy');
});

// ── Special Draws ─────────────────────────────────────────────────────────

function renderSpecialDraws() {
  const specials = allDraws.filter(d => d.is_special || d.special);
  const container = $('specialList');

  if (!specials.length) {
    container.innerHTML = '<div class="empty-state">No special draws available right now.</div>';
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
  const time  = d.scheduled_time ? new Date(d.scheduled_time).toLocaleString() : '';
  const prize = d.full_house_prize ? '🏆 ' + d.full_house_prize + ' pts' : '';
  const line  = d.line_prize       ? '🎯 Line: ' + d.line_prize + ' pts'  : '';
  const cost  = d.ticket_price ?? d.price ?? 1;
  const statusCls = 'badge-' + (d.status || 'scheduled');

  return `<div class="draw-card">
    <div class="dc-header">
      <span class="dc-name">${d.name || 'Draw'}</span>
      <span class="dc-badge ${statusCls}">${d.status || 'scheduled'}</span>
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

function openBuyModal(drawId) {
  const draw = allDraws.find(d => d.id === drawId);
  if (!draw) return;

  activeBuyDrawId = drawId;
  activeBuyPrice  = draw.ticket_price ?? draw.price ?? 1;
  buyQty = 1;

  const balance = currentUser.points ?? 0;

  if (balance < activeBuyPrice) {
    $('modalPoints').textContent = balance + ' pts';
    showModal('modal-points');
    return;
  }

  $('buyModalTitle').textContent = 'Buy Ticket — ' + (draw.name || 'Draw');
  hideErr('buyErr');
  $('buyOk').classList.add('hidden');
  updateBuyModal(balance);
  showModal('modal-buy');
}

function updateBuyModal(balance) {
  const bal = balance ?? currentUser.points ?? 0;
  $('qtyVal').textContent  = buyQty;
  $('buyCost').textContent = buyQty * activeBuyPrice;
  $('buyBal').textContent  = bal;
}

$('qtyDown').addEventListener('click', () => {
  if (buyQty > 1) { buyQty--; updateBuyModal(); }
});

$('qtyUp').addEventListener('click', () => {
  const max = Math.floor((currentUser.points ?? 0) / activeBuyPrice);
  if (buyQty < Math.max(max, 1)) { buyQty++; updateBuyModal(); }
});

$('closeBuy').addEventListener('click', () => hideModal('modal-buy'));

$('btnBuyConfirm').addEventListener('click', async () => {
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

  // update local balance
  if (data.remaining_points !== undefined) currentUser.points = data.remaining_points;
  else if (data.points !== undefined)      currentUser.points = data.points;
  else                                     currentUser.points = balance - cost;

  renderTopBar();
  updateBuyModal();

  const okEl = $('buyOk');
  okEl.textContent = `✅ ${buyQty} ticket${buyQty > 1 ? 's' : ''} purchased!`;
  okEl.classList.remove('hidden');
  buyQty = 1;
  updateBuyModal();
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
