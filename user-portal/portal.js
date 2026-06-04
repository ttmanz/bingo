'use strict';

// ── Instant draw-active redirect (runs before any auth check) ─────────────
// Connect to the game socket immediately. If a draw is live the server sends
// 'state' with phase='drawing' within milliseconds — redirect straight away.
// Also catches draws that start while the user is on this page ('game-reset').
// We write the drawId into sessionStorage first so the bingo room treats this
// user as a returning watcher (allows spectating even without a ticket).
function _goToBingoRoom(drawId) {
  if (drawId) sessionStorage.setItem('bingo_watching_draw', String(drawId));
  window.location.href = '/bingo-room';
}
try {
  const _earlySocket = io();
  _earlySocket.on('state', ({ phase, drawId }) => {
    if (phase === 'drawing') _goToBingoRoom(drawId);
  });
  _earlySocket.on('game-reset', ({ drawId }) => {
    _goToBingoRoom(drawId);
  });
} catch(e) {}
// ─────────────────────────────────────────────────────────────────────────────

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

async function apiFetch(path, opts = {}, timeoutMs = 12000) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API + path, { ...opts, headers, signal: controller.signal });
    // Keep the abort timer active through the body read — if the server crashes
    // mid-response the body will never complete; we need the timeout to fire then too.
    const data = await res.json().catch(() => ({}));
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Request timed out — please try again');
    throw err;
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg, ms) {
  const el = $('reg-success');
  $('reg-success-msg').textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), ms || 3500);
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
  try { await loadDraws(); } catch(e) { console.error('loadDraws failed:', e); }
  loadMyTickets();
  connectDrawSocket();
}

function connectDrawSocket() {
  try {
    const socket = io();
    // 'state' fires immediately on connect — phase='drawing' means a draw is live right now
    socket.on('state', ({ phase }) => {
      if (phase === 'drawing') window.location.href = '/bingo-room';
    });
    // 'game-reset' fires when a new draw starts while we're waiting on the portal
    socket.on('game-reset', () => {
      window.location.href = '/bingo-room';
    });
  } catch(e) {
    console.warn('Portal socket failed, falling back to poll', e);
    startDrawPoller();
  }
}

let _drawPollTimer = null;
function startDrawPoller() {
  if (_drawPollTimer) return;
  _drawPollTimer = setInterval(async () => {
    try {
      const { ok, data } = await apiFetch('/api/user-portal/available-draws');
      if (!ok) return;
      const regular = Array.isArray(data) ? data : (data.regular || []);
      const special = data.special || [];
      if ([...regular, ...special].some(d => d.status === 'running')) {
        clearInterval(_drawPollTimer);
        window.location.href = '/bingo-room';
      }
    } catch {}
  }, 15000);
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
  const gamMain = document.getElementById('game-main');
  if (gamMain) gamMain.style.display = 'none';
  document.querySelectorAll('.section-panel').forEach(p => {
    p.classList.remove('active', 'hidden');
  });
  const panel = document.getElementById('section-' + name);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
  else { console.warn('openSection: no panel found for', name); }
  if (name === 'schedule') { try { loadSchedule(); } catch(e) { console.error('loadSchedule threw:', e); } }
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.closeSection = function() {
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('game-main').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ── My Tickets ────────────────────────────────────────────────────────────
// Shows draw name + ticket count per draw — no card grids (kept lightweight).
// Full card grids are visible in the Bingo Room itself.

async function loadMyTickets() {
  const panel = document.getElementById('myTicketsPanel');
  if (!panel) return;
  panel.innerHTML = '<div class="loading-state">Loading…</div>';

  try {
    const { ok, data } = await apiFetch('/api/user-portal/tickets');
    let rows = (ok && Array.isArray(data)) ? data : [];

    // Group by draw — count tickets per draw (each server row = 1 ticket).
    // Server orders active draws first so they're never cut off by the LIMIT.
    const groups = {};
    rows.forEach(t => {
      const key = String(t.draw_id);
      if (!groups[key]) {
        groups[key] = {
          draw_title:   t.draw_title  || 'Bingo Draw',
          draw_date:    t.draw_date,
          draw_time:    t.draw_time,
          draw_status:  t.draw_status,
          ticket_count: 0,
        };
      }
      groups[key].ticket_count++;
    });

    // Only show active draws — filter out completed/voided ones.
    // Future special draws (status='scheduled', even weeks away) are kept.
    const allKeys  = Object.keys(groups);
    const keys     = allKeys.filter(k => {
      const s = groups[k].draw_status;
      return s === 'running' || s === 'scheduled';
    });

    if (!keys.length) {
      const who = currentUser?.name ? ` for <strong>${currentUser.name}</strong>` : '';
      // Distinguish "all past draws finished" vs "never bought any"
      const hadTickets = allKeys.length > 0;
      panel.innerHTML = hadTickets
        ? `<div class="my-tickets-empty">
             <div class="mte-icon">🎟️</div>
             <p>No upcoming tickets${who}.</p>
             <p style="font-size:13px;color:var(--muted);margin-bottom:20px">All your past draws have finished. Buy tickets for the next draw to play!</p>
             <button class="btn btn-outline" onclick="openSection('buy')">Buy Tickets →</button>
           </div>`
        : `<div class="my-tickets-empty">
             <div class="mte-icon">🎟️</div>
             <p>No tickets found${who}.</p>
             <p style="font-size:13px;color:var(--muted);margin-bottom:20px">If you bought tickets on another device, they may appear here after a refresh.</p>
             <button class="btn btn-primary" onclick="loadMyTickets()">↻ Refresh</button>
             <button class="btn btn-outline" style="margin-top:10px" onclick="openSection('buy')">Buy Tickets →</button>
           </div>`;
      return;
    }

    panel.innerHTML = keys.map(key => {
      const g = groups[key];
      const statusBadge = g.draw_status === 'running'
        ? `<span class="mt-badge mt-badge-live">🔴 Live</span>`
        : `<span class="mt-badge mt-badge-soon">⏰ Upcoming</span>`;

      return `
        <div class="mt-row">
          <div class="mt-row-left">
            <span class="mt-row-title">${g.draw_title}</span>
            ${statusBadge}
          </div>
          <span class="mt-row-count">${g.ticket_count} 🎟️</span>
        </div>`;
    }).join('');

  } catch (err) {
    panel.innerHTML = `
      <div class="loading-state" style="color:#f87171">
        ${err.message || 'Could not load tickets'}
        <br>
        <button class="btn btn-primary" style="margin-top:12px" onclick="loadMyTickets()">↻ Retry</button>
      </div>`;
    console.error('loadMyTickets error', err);
  }
}
window.loadMyTickets = loadMyTickets;  // expose for inline onclick="loadMyTickets()"

// ── Game Schedule ─────────────────────────────────────────────────────────

async function loadSchedule() {
  const panel = document.getElementById('schedulePanel');
  if (!panel) return;
  panel.innerHTML = '<div class="loading-state">Loading…</div>';

  try {
    const { ok, data } = await apiFetch('/api/user-portal/available-draws');
    if (!ok) throw new Error('fetch failed');

    const regular = Array.isArray(data.regular) ? data.regular : [];
    const special = Array.isArray(data.special)  ? data.special  : [];
    const all = [...regular, ...special];

    // Filter to draws whose scheduled time falls within today (local calendar day)
    const todayStr = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD" in local tz
    const toMs = d => {
      if (d.scheduled_utc) return new Date(d.scheduled_utc).getTime();
      if (d.draw_date && d.draw_time) return new Date(d.draw_date + 'T' + d.draw_time).getTime();
      return null;
    };

    const todayDraws = all
      .filter(d => {
        const ms = toMs(d);
        if (!ms) return false;
        const localDay = new Date(ms).toLocaleDateString('en-CA');
        return localDay === todayStr;
      })
      .sort((a, b) => (toMs(a) || 0) - (toMs(b) || 0));

    if (!todayDraws.length) {
      panel.innerHTML = `
        <div class="sched-empty">
          <div class="sched-empty-icon">📅</div>
          <p>No more draws scheduled for today.</p>
          <p class="sched-empty-sub">Check back tomorrow!</p>
        </div>`;
      return;
    }

    const now = Date.now();

    panel.innerHTML = `
      <div class="sched-date">${new Date().toLocaleDateString([], { weekday:'long', day:'numeric', month:'long' })}</div>
      <div class="sched-list">
        ${todayDraws.map(d => {
          const ms = toMs(d);
          const isLive = d.status === 'running';
          const isPast = !isLive && ms && ms < now;
          const timeStr = ms
            ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '—';
          const linePrize = d.line_prize > 0 ? d.line_prize : null;
          const fullPrize = d.full_house_prize > 0 ? d.full_house_prize : null;
          const badgeHtml = isLive
            ? `<span class="sched-badge sched-live">🔴 Live</span>`
            : isPast
            ? `<span class="sched-badge sched-done">✓ Done</span>`
            : `<span class="sched-badge sched-soon">⏰ ${timeStr}</span>`;
          const typeTag = d.draw_type === 'special'
            ? `<span class="sched-type">Special</span>` : '';
          const prizeLine = (linePrize || fullPrize)
            ? `<div class="sched-prizes">
                ${linePrize  ? `<span class="sched-prize">Line <strong>${linePrize} pts</strong></span>` : ''}
                ${fullPrize  ? `<span class="sched-prize">Full House <strong>${fullPrize} pts</strong></span>` : ''}
               </div>` : '';
          return `
            <div class="sched-row${isLive ? ' sched-row-live' : isPast ? ' sched-row-done' : ''}">
              <div class="sched-time">${timeStr}</div>
              <div class="sched-info">
                <div class="sched-name">${d.title || 'Draw'}${typeTag}</div>
                ${prizeLine}
              </div>
              <div class="sched-badge-wrap">${badgeHtml}</div>
            </div>`;
        }).join('')}
      </div>`;
  } catch (err) {
    panel.innerHTML = '<div class="loading-state">Could not load schedule. Please try again.</div>';
    console.error('loadSchedule error', err);
  }
}

// ── Draws data ────────────────────────────────────────────────────────────

let allDraws = [];
let specialDraws = [];

function drawScheduledTime(d) {
  // API returns draw_date ("2026-05-15") and draw_time ("18:00:00") separately
  if (d.scheduled_utc) return new Date(d.scheduled_utc);
  if (d.draw_date && d.draw_time) return new Date(d.draw_date + 'T' + d.draw_time + '+03:00');
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

  // If any draw (regular or special) is live, go straight to the bingo room
  const allCombined = [...allDraws, ...specialDraws];
  if (allCombined.some(d => d.status === 'running')) {
    window.location.href = '/bingo-room';
    return;
  }

  // find next scheduled regular draw that hasn't started yet
  const now = Date.now();
  const scheduled = allDraws
    .filter(d => d.status === 'scheduled' && drawScheduledTime(d) > now)
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
      window.location.href = '/bingo-room';
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

let activeBuyDrawId    = null;
let activeBuyDrawTitle = '';
let activeBuyPrice     = 1;
let buyQty = 1;

function openBuyModal(drawId) {
  const draw = [...allDraws, ...specialDraws].find(d => d.id === drawId);
  if (!draw) return;

  activeBuyDrawId    = drawId;
  activeBuyDrawTitle = draw.name || draw.title || 'Draw';
  activeBuyPrice     = draw.ticket_price ?? draw.price ?? 1;
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
  const options = [1,2,3,4,5,6,7,8,9,10,15,20,30,40,50,100];
  if (!options.includes(buyQty)) buyQty = 1;
  const pad = $('qtyKeypad');
  pad.innerHTML = '';
  options.forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'qty-key' + (n === buyQty ? ' active' : '');
    btn.textContent = n;
    btn.addEventListener('click', () => {
      buyQty = n;
      pad.querySelectorAll('.qty-key').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('buyCost').textContent = buyQty * activeBuyPrice;
    });
    pad.appendChild(btn);
  });
  $('buyCost').textContent = buyQty * activeBuyPrice;
  $('buyBal').textContent  = bal;
}

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

  // update local balance + close modal + navigate home
  try {
    if (data.remaining_points !== undefined) currentUser.points = data.remaining_points;
    else if (data.points !== undefined)      currentUser.points = data.points;
    else                                     currentUser.points = balance - cost;

    try { renderTopBar(); } catch(e) { console.warn('renderTopBar failed', e); }

    const purchased = buyQty;
    buyQty = 1;

    // close buy modal
    $('modal-buy').classList.add('hidden');

    // Store cards in localStorage so bingo room tab can read them.
    // Structure: { [drawId]: { cards, drawTitle } } — one key per draw
    // so buying tickets for multiple draws never overwrites each other.
    try {
      const boughtDraw = [...allDraws, ...specialDraws].find(d => d.id === activeBuyDrawId);
      if (data.tickets && data.tickets.length) {
        const store = JSON.parse(localStorage.getItem('bingoRoomTickets') || '{}');
        const drawKey = String(activeBuyDrawId);
        const existingCards = Array.isArray(store[drawKey]?.cards) ? store[drawKey].cards : [];
        const newCards = data.tickets.flatMap(t => t.cards || []);
        store[drawKey] = {
          cards:     [...existingCards, ...newCards],
          drawTitle: (boughtDraw && (boughtDraw.title || boughtDraw.name)) || store[drawKey]?.drawTitle || 'Bingo Draw'
        };
        localStorage.setItem('bingoRoomTickets', JSON.stringify(store));
        // Keep legacy key in sync for backward compat with old room.js
        localStorage.setItem('bingoRoomTicket', JSON.stringify({
          cards:     store[drawKey].cards,
          draw_id:   activeBuyDrawId,
          drawTitle: store[drawKey].drawTitle
        }));
      }
    } catch (e) { console.warn('localStorage write failed', e); }

    // return to main game screen and refresh tickets panel
    document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('game-main').style.display = '';
    loadMyTickets();   // refresh so newly-bought draw appears immediately

    // success toast
    const plural = purchased > 1 ? 's' : '';
    const toastEl = document.getElementById('reg-success');
    const toastMsg = document.getElementById('reg-success-msg');
    if (toastEl && toastMsg) {
      toastMsg.textContent = purchased + ' ticket' + plural + ' bought! Tap Bingo Room to play.';
      toastEl.classList.remove('hidden');
      toastEl.style.display = 'flex';
      toastEl.style.opacity = '1';
      toastEl.style.zIndex  = '9999';
      setTimeout(() => {
        toastEl.classList.add('hidden');
        toastEl.style.display = '';
        toastEl.style.opacity = '';
        toastEl.style.zIndex  = '';
      }, 6000);
    }
  } catch (err) {
    console.error('Buy success block threw:', err);
    // hard fallback — still close modal and go home
    document.getElementById('modal-buy').classList.add('hidden');
    document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('game-main').style.display = '';
  }
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
