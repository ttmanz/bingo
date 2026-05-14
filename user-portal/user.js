const API   = ''
let TOKEN   = localStorage.getItem('userToken') || null
let profile = null

/* ── Helpers ── */
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...opts,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function showErr(el, msg)  { el.textContent = msg; el.classList.remove('hidden') }
function hideErr(el)       { el.classList.add('hidden') }

// ── Toast ──
const _toastEl = document.createElement('div')
_toastEl.id = 'toast'
document.body.appendChild(_toastEl)
let _toastTimer
function showToast(msg, icon = '✓') {
  _toastEl.innerHTML = `<span class="toast-icon">${icon}</span>${msg}`
  clearTimeout(_toastTimer)
  _toastEl.classList.add('show')
  _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), 4000)
}


// Parse a date-only string ("YYYY-MM-DD") as UTC midnight to avoid local-timezone date shift.
function parseDateUTC(str) {
  if (!str) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(str)
    ? new Date(str + 'T00:00:00Z')
    : new Date(str)
}

// Format a draw's date+time in the user's local timezone.
// tz = IANA timezone string from the draw record (e.g. "UTC", "America/Caracas").
function fmtDrawTime(dateStr, timeStr, tz = 'UTC') {
  if (!dateStr || !timeStr) return '–'
  try {
    // Combine into a full ISO string in the draw's declared timezone
    const iso = `${dateStr}T${timeStr}:00`
    const d   = new Date(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false,
      }).format(new Date(iso)).replace(/,/, '')
    )
    // Re-interpret as UTC so we can display in the user's local TZ
    // Simpler: just treat the stored strings as being in `tz` and convert
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12: false,
    }).formatToParts(new Date(`${dateStr}T${timeStr}:00Z`))
    // Build a UTC date from the stored strings, then re-display in local TZ
    const utcDate = new Date(`${dateStr}T${timeStr}:00Z`)
    return utcDate.toLocaleString(undefined, {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) + ' (your time)'
  } catch {
    return `${dateStr} ${timeStr} ${tz}`
  }
}

function fmtDate(str) {
  if (!str) return '–'
  return parseDateUTC(str).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
}

function fmtDateTime(str) {
  if (!str) return '–'
  // created_at fields from SQLite datetime('now') are UTC — parse as UTC
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)
    ? str.replace(' ', 'T') + 'Z'
    : str
  return new Date(iso).toLocaleString(undefined, {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit',
  })
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

/* ── Auth tab switcher ── */
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => switchAuthTab(btn.dataset.target))
})
document.getElementById('goRegister').addEventListener('click', e => {
  e.preventDefault(); switchAuthTab('formRegister')
})
document.getElementById('goLogin').addEventListener('click', e => {
  e.preventDefault(); switchAuthTab('formLogin')
})

function switchAuthTab(targetId) {
  document.querySelectorAll('.auth-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.target === targetId))
  document.querySelectorAll('.auth-form').forEach(f =>
    f.classList.toggle('active', f.id === targetId))
}

/* ── Login ── */
document.getElementById('formLogin').addEventListener('submit', async e => {
  e.preventDefault()
  const btn = e.target.querySelector('button[type=submit]')
  const err = document.getElementById('loginErr')
  hideErr(err); btn.disabled = true; btn.textContent = 'Signing in…'

  try {
    const data = await apiFetch('/api/user-auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email:    document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value,
      }),
    })
    TOKEN = data.token
    localStorage.setItem('userToken', TOKEN)
    window.location.href = "/user-portal?play=1"
  } catch (err2) {
    showErr(err, err2.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In'
  }
})

/* ── Register ── */
document.getElementById('formRegister').addEventListener('submit', async e => {
  e.preventDefault()
  const btn = e.target.querySelector('button[type=submit]')
  const err = document.getElementById('registerErr')
  hideErr(err); btn.disabled = true; btn.textContent = 'Creating account…'

  const password = document.getElementById('regPassword').value
  if (password.length < 6) {
    showErr(err, 'Password must be at least 6 characters')
    btn.disabled = false; btn.textContent = 'Create Account'
    return
  }

  try {
    const data = await apiFetch('/api/user-auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name:     document.getElementById('regName').value.trim(),
        email:    document.getElementById('regEmail').value.trim(),
        phone:    document.getElementById('regPhone').value.trim() || null,
        password,
      }),
    })
    TOKEN = data.token
    localStorage.setItem('userToken', TOKEN)
    await loadDashboard()
    switchToTodayTab()
    showToast('Account created — welcome to Bingo24-7! 🎉', '🎉')
  } catch (err2) {
    showErr(err, err2.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account'
  }
})

/* ── Logout ── */
document.getElementById('logoutBtn').addEventListener('click', () => {
  TOKEN = null; profile = null
  localStorage.removeItem('userToken')
  showScreen('loginScreen')
})

/* ── Tab nav ── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active')
    if (btn.dataset.tab === 'today')        loadTodayDraws()
    if (btn.dataset.tab === 'tickets')      loadTickets()
    if (btn.dataset.tab === 'live')         loadLiveTab()
    if (btn.dataset.tab === 'sell')         loadSellTab()
    if (btn.dataset.tab === 'transactions') loadTransactions()
  })
})

/* ── Load dashboard ── */
async function loadDashboard() {
  profile = await apiFetch('/api/user-portal/me')
  renderTopbar()
  renderOverview()
  showScreen('dashboard')
  loadOverviewDraws()
}

function renderTopbar() {
  document.getElementById('topName').textContent    = profile.name
  document.getElementById('topPoints').textContent  = Number(profile.points ?? 0).toLocaleString()

  const badge = document.getElementById('regTypeBadge')
  const isAgent = !!profile.agent_name
  badge.textContent  = isAgent ? 'Agent User' : 'Member'
  badge.className    = `reg-badge ${isAgent ? 'rb-agent' : 'rb-self'}`
}

async function loadOverviewDraws() {
  const listEl = document.getElementById('ovDrawsList')
  try {
    const { regular, special } = await apiFetch('/api/user-portal/available-draws')
    const all = [...regular, ...special]
    if (!all.length) {
      listEl.innerHTML = '<div style="color:var(--muted);font-size:13px">No draws scheduled today.</div>'
      return
    }
    listEl.innerHTML = all.map(d => {
      const dot = d.status === 'running' ? '🔴' : '🟡'
      const avail = d.available_tickets != null ? `${Number(d.available_tickets).toLocaleString()} tickets left` : 'tickets available'
      return `<div class="prow">
        <span>${dot} <strong>${esc(d.title)}</strong> &nbsp;<span style="color:var(--muted);font-size:12px">${avail}</span></span>
        <span style="font-size:13px;font-weight:600">${Number(d.ticket_price).toLocaleString()} pt${d.ticket_price == 1 ? '' : 's'}</span>
      </div>`
    }).join('')
  } catch {
    listEl.innerHTML = '<div style="color:var(--muted);font-size:13px">Could not load draws.</div>'
  }
}

document.getElementById('ovBuyBtn').addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelector('.tab-btn[data-tab="today"]').classList.add('active')
  document.getElementById('tab-today').classList.add('active')
  loadTodayDraws()
})

function renderOverview() {
  document.getElementById('ovPoints').textContent = Number(profile.points ?? 0).toLocaleString()
  document.getElementById('prName').textContent   = profile.name
  document.getElementById('prEmail').textContent  = profile.email || '–'
  document.getElementById('prPhone').textContent  = profile.phone || '–'
  document.getElementById('prSince').textContent  = fmtDate(profile.created_at)

  const isAgent = !!profile.agent_name
  document.getElementById('prType').textContent = isAgent ? 'Agent User' : 'Member (self-registered)'

  const agentRow = document.getElementById('agentRow')
  if (isAgent) {
    agentRow.style.display = 'flex'
    document.getElementById('prAgent').textContent = profile.agent_name
  } else {
    agentRow.style.display = 'none'
  }
}

/* ════════════════════════════════════════════
   BINGO CARD / TICKET RENDERING
   ════════════════════════════════════════════ */

function isPresetFormat(numbers) {
  return Array.isArray(numbers) && numbers.length > 0 && typeof numbers[0] === 'object' && 'row1' in numbers[0]
}

function renderCardGrid(card, calledSet, highlightRows = new Set(), highlightAll = false, tableClass = 'card-grid') {
  const rows = [card.row1, card.row2, card.row3]
  const rowsHtml = rows.map((row, ri) => {
    const cells = row.map(n => {
      if (n === null) return '<td class="blank"></td>'
      const isCalled = calledSet.has(n)
      const isWin    = highlightAll ? isCalled : (isCalled && highlightRows.has(ri))
      const cls = isWin
        ? (highlightAll ? 'bingo-win' : 'line-win')
        : isCalled ? 'called' : 'num'
      return `<td class="${cls}">${n}</td>`
    }).join('')
    return `<tr>${cells}</tr>`
  }).join('')
  return `<table class="${tableClass}">${rowsHtml}</table>`
}

function renderBingoTicket(cards, calledSet, opts = {}) {
  return cards.map((card, i) => {
    const grid = renderCardGrid(card, calledSet)
    const sep  = i < cards.length - 1 ? '<div class="card-sep">— — —</div>' : ''
    return `
      <div class="bingo-card">
        <div class="card-code-label">Card ${esc(card.code)}</div>
        ${grid}
      </div>${sep}`
  }).join('')
}

/* ── Win detection ── */
function checkLineWin(card, calledSet) {
  const rows = [card.row1, card.row2, card.row3]
  for (let i = 0; i < 3; i++) {
    const nums = rows[i].filter(n => n !== null)
    if (nums.length && nums.every(n => calledSet.has(n))) return i
  }
  return -1
}

function checkBingo(card, calledSet) {
  const nums = [...card.row1, ...card.row2, ...card.row3].filter(n => n !== null)
  return nums.every(n => calledSet.has(n))
}

/* ════════════════════════════════════════════
   WIN OVERLAY
   ════════════════════════════════════════════ */

let winShownFor = new Set() // track card codes already announced

function showWinOverlay(card, calledSet, type) {
  const key = card.code + ':' + type
  if (winShownFor.has(key)) return
  winShownFor.add(key)

  const badge = document.getElementById('winBadge')
  badge.textContent = type === 'bingo' ? 'BINGO!' : 'LINE!'
  badge.className   = 'win-badge ' + type

  document.getElementById('winCardId').textContent = 'Card ' + card.code

  const highlightRows = new Set()
  if (type === 'line') {
    const ri = checkLineWin(card, calledSet)
    if (ri >= 0) highlightRows.add(ri)
  }
  document.getElementById('winCardGrid').outerHTML =
    renderCardGrid(card, calledSet, highlightRows, type === 'bingo', 'win-card-grid')
      .replace('<table ', '<table id="winCardGrid" ')

  document.getElementById('winOverlay').classList.remove('hidden')
}

document.getElementById('winDismiss').addEventListener('click', () => {
  document.getElementById('winOverlay').classList.add('hidden')
})

/* ════════════════════════════════════════════
   MY TICKETS TAB
   ════════════════════════════════════════════ */

document.getElementById('refreshTickets').addEventListener('click', loadTickets)

let allTickets = []

async function loadTickets() {
  const el = document.getElementById('ticketList')
  el.innerHTML = '<div class="empty-state"><div class="ei">⏳</div><p>Loading…</p></div>'

  try {
    allTickets = await apiFetch('/api/user-portal/tickets')

    document.getElementById('ovTickets').textContent = allTickets.length
    const wins = allTickets.filter(t => t.prize_amount > 0).length
    document.getElementById('ovWins').textContent = wins

    if (!allTickets.length) {
      el.innerHTML = '<div class="empty-state"><div class="ei">🎟️</div><p>No tickets yet</p></div>'
      return
    }

    el.innerHTML = allTickets.map(t => {
      const numbers = JSON.parse(t.numbers || '[]')
      const statusColor = t.status === 'active' ? 'var(--accent)' :
                          t.prize_amount > 0 ? 'var(--success)' : 'var(--muted)'

      if (isPresetFormat(numbers)) {
        // 6-card bingo ticket grid (no live marking in static view)
        const emptySet  = new Set()
        const cardsHtml = renderBingoTicket(numbers, emptySet)
        return `
          <div class="bingo-ticket-wrap">
            <div class="bingo-ticket-meta">
              <span><strong>${esc(t.draw_title)}</strong> &nbsp;·&nbsp; ${fmtDrawTime(t.draw_date, t.draw_time, t.timezone ?? 'UTC')}</span>
              <span style="color:${statusColor}">${esc(t.draw_status ?? t.status)}</span>
            </div>
            ${cardsHtml}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
              ${t.prize_amount > 0
                ? `<span class="ticket-prize">🏆 Won ${Number(t.prize_amount).toLocaleString()} pts</span>`
                : `<span style="font-size:12px;color:var(--muted)">Paid: ${Number(t.purchase_price).toLocaleString()} pts</span>`}
              <button class="btn-watch" data-tid="${t.id}">▶ Watch Live</button>
            </div>
          </div>`
      }

      // Legacy flat-number format
      const balls = numbers.map(n => `<div class="ball">${n}</div>`).join('')
      return `
        <div class="ticket-card">
          <div class="ticket-header">
            <span class="ticket-draw">${esc(t.draw_title)}</span>
            <span class="ticket-date">${fmtDate(t.draw_date)} ${esc(t.draw_time ?? '')}</span>
          </div>
          <div class="ticket-numbers">${balls}</div>
          <div class="ticket-footer">
            <span style="color:${statusColor}">${esc(t.draw_status ?? t.status)}</span>
            ${t.prize_amount > 0
              ? `<span class="ticket-prize">🏆 Won ${Number(t.prize_amount).toLocaleString()} pts</span>`
              : `<span>Paid: ${Number(t.purchase_price).toLocaleString()} pts</span>`}
          </div>
        </div>`
    }).join('')

    // Wire "Watch Live" buttons
    el.querySelectorAll('.btn-watch').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid  = Number(btn.dataset.tid)
        const tkData = allTickets.find(t => t.id === tid)
        if (tkData) watchTicket(tkData)
      })
    })

  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>Error: ${esc(err.message)}</p></div>`
  }
}

/* ════════════════════════════════════════════
   LIVE DRAW TAB
   ════════════════════════════════════════════ */

let socket       = null
let liveCards    = null   // array of 6 card objects being watched
let calledSet    = new Set()
let lineWinDone  = false
let bingoWinDone = false

function setLiveStatus(text, state = 'off') {
  const el = document.getElementById('liveStatus')
  const dot = state === 'on'  ? 'on'  :
              state === 'off' ? 'off' : ''
  el.innerHTML = `<div class="live-dot ${dot}"></div>${esc(text)}`
}

function initSocket() {
  if (socket) return
  socket = io({ transports: ['websocket', 'polling'] })

  socket.on('connect', () => setLiveStatus('Live draw connected', 'on'))
  socket.on('disconnect', () => setLiveStatus('Disconnected — reconnecting…', 'off'))

  socket.on('state', ({ called, gameOver }) => {
    calledSet = new Set(called)
    if (gameOver) setLiveStatus('Draw has ended', 'off')
    refreshLiveGrid()
  })

  socket.on('number-drawn', ({ number, called }) => {
    calledSet = new Set(called)
    refreshLiveGrid()
    checkAllWins()
  })

  socket.on('game-reset', () => {
    calledSet     = new Set()
    lineWinDone   = false
    bingoWinDone  = false
    winShownFor   = new Set()
    refreshLiveGrid()
    setLiveStatus('New draw started', 'on')
  })

  socket.on('game-over', () => setLiveStatus('Draw complete', 'off'))
}

function refreshLiveGrid() {
  if (!liveCards) return
  const grid = document.getElementById('liveTicketGrid')
  if (!grid) return
  grid.innerHTML = renderBingoTicket(liveCards, calledSet)
}

function checkAllWins() {
  if (!liveCards) return
  for (const card of liveCards) {
    if (!bingoWinDone && checkBingo(card, calledSet)) {
      bingoWinDone = true
      lineWinDone  = true
      showWinOverlay(card, calledSet, 'bingo')
      return
    }
    if (!lineWinDone && checkLineWin(card, calledSet) >= 0) {
      lineWinDone = true
      showWinOverlay(card, calledSet, 'line')
      return
    }
  }
}

function watchTicket(ticketData) {
  const numbers = JSON.parse(ticketData.numbers || '[]')
  if (!isPresetFormat(numbers)) return

  liveCards    = numbers
  lineWinDone  = false
  bingoWinDone = false
  winShownFor  = new Set()

  // Switch to Live tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelector('.tab-btn[data-tab="live"]').classList.add('active')
  document.getElementById('tab-live').classList.add('active')

  // Show ticket view
  document.getElementById('liveTicketPicker').classList.add('hidden')
  document.getElementById('liveTicketView').classList.remove('hidden')
  document.getElementById('liveTicketLabel').textContent =
    `${ticketData.draw_title} — ${fmtDrawTime(ticketData.draw_date, ticketData.draw_time, ticketData.timezone ?? 'UTC')}`

  refreshLiveGrid()
  initSocket()
}

function loadLiveTab() {
  initSocket()

  if (liveCards) {
    document.getElementById('liveTicketPicker').classList.add('hidden')
    document.getElementById('liveTicketView').classList.remove('hidden')
    refreshLiveGrid()
    return
  }

  // Show picker if user has preset tickets
  const presetTickets = allTickets.filter(t => {
    const n = JSON.parse(t.numbers || '[]')
    return isPresetFormat(n)
  })

  const picker = document.getElementById('liveTicketPicker')
  const list   = document.getElementById('livePickerList')

  if (!presetTickets.length) {
    setLiveStatus('Connected — no tickets to display', 'on')
    picker.classList.add('hidden')
    document.getElementById('liveTicketView').classList.add('hidden')
    return
  }

  list.innerHTML = presetTickets.map(t => `
    <div class="picker-item">
      <span><strong>${esc(t.draw_title)}</strong> &nbsp;·&nbsp; ${fmtDate(t.draw_date)}</span>
      <button class="btn-watch" data-tid="${t.id}">Watch</button>
    </div>`).join('')

  list.querySelectorAll('.btn-watch').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = Number(btn.dataset.tid)
      const tk  = allTickets.find(t => t.id === tid)
      if (tk) watchTicket(tk)
    })
  })

  picker.classList.remove('hidden')
  document.getElementById('liveTicketView').classList.add('hidden')
}

document.getElementById('liveChangeTkt').addEventListener('click', () => {
  liveCards = null
  document.getElementById('liveTicketView').classList.add('hidden')
  loadLiveTab()
})

/* ════════════════════════════════════════════
   TODAY'S DRAWS TAB
   ════════════════════════════════════════════ */

document.getElementById('refreshToday').addEventListener('click', loadTodayDraws)

async function loadTodayDraws() {
  const el = document.getElementById('todayList')
  el.innerHTML = '<div class="empty-state"><div class="ei">⏳</div><p>Loading…</p></div>'

  try {
    const { regular, special } = await apiFetch('/api/user-portal/available-draws')

    if (!regular.length && !special.length) {
      el.innerHTML = '<div class="empty-state"><div class="ei">📅</div><p>No draws scheduled today</p></div>'
      return
    }

    const renderDraw = d => {
      const badgeCls = d.status === 'running'   ? 'badge-running'
                     : d.status === 'scheduled' ? 'badge-scheduled'
                     : 'badge-completed'
      const badgeLabel = d.status === 'running'   ? '● Live'
                       : d.status === 'scheduled' ? '⏳ Upcoming'
                       : '✓ Completed'
      const time  = fmtDrawTime(d.draw_date, d.draw_time, d.timezone ?? 'UTC')
      const price = Number(d.ticket_price ?? 1).toLocaleString()
      const avail = d.available_tickets != null ? d.available_tickets : null
      const canBuy = d.status === 'scheduled' && (avail === null || avail > 0)
      const availLabel = avail != null
        ? `${Number(avail).toLocaleString()} / ${Number(d.total_tickets).toLocaleString()} tickets left`
        : ''
      return `
        <div class="draw-card" data-draw-id="${d.id}">
          <div class="draw-card-info">
            <div class="draw-card-title">${esc(d.title)}</div>
            <div class="draw-card-meta">${esc(time)}${d.description ? ' — ' + esc(d.description) : ''}</div>
            ${availLabel ? `<div class="draw-card-avail">${esc(availLabel)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="draw-card-badge ${badgeCls}">${badgeLabel}</span>
            <span class="draw-card-price">${price} pt${price === '1' ? '' : 's'} / ticket</span>
            ${canBuy
              ? `<button class="btn btn-primary btn-sm buy-draw-btn" data-draw-id="${d.id}" data-price="${d.ticket_price}">Buy Ticket</button>`
              : avail === 0 ? `<span class="draw-card-sold">Sold Out</span>` : ''}
          </div>
        </div>
        <div class="buy-inline-form hidden" id="buy-form-${d.id}">
          <div id="buy-err-${d.id}" class="alert alert-error hidden"></div>
          <div id="buy-ok-${d.id}"  class="alert alert-success hidden"></div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <label style="font-size:13px;color:var(--muted)">Qty:</label>
            <input type="number" class="buy-qty-input" id="buy-qty-${d.id}"
              value="1" min="1" max="10" step="1" style="width:60px" />
            <span class="buy-total-label" id="buy-total-${d.id}">
              Cost: <strong>${price}</strong> pts
            </span>
            <button class="btn btn-primary btn-sm" id="buy-confirm-${d.id}">Confirm</button>
            <button class="btn btn-ghost btn-sm" id="buy-cancel-${d.id}">Cancel</button>
          </div>
        </div>`
    }

    let html = ''

    if (regular.length) {
      html += '<div class="draw-section-label">Today\'s Scheduled Draws</div>'
      html += regular.map(renderDraw).join('')
    }

    if (special.length) {
      html += '<div class="draw-section-label">Special Draws</div>'
      html += special.map(renderDraw).join('')
    }

    el.innerHTML = html

    // Wire buy buttons
    el.querySelectorAll('.buy-draw-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.drawId
        el.querySelectorAll('.buy-inline-form').forEach(f => f.classList.add('hidden'))
        document.getElementById(`buy-form-${id}`)?.classList.remove('hidden')
      })
    })

    el.querySelectorAll('.buy-qty-input').forEach(input => {
      input.addEventListener('input', () => {
        const id    = input.id.replace('buy-qty-', '')
        const price = Number(el.querySelector(`.buy-draw-btn[data-draw-id="${id}"]`)?.dataset.price ?? 1)
        const qty   = Math.max(1, Math.min(10, parseInt(input.value) || 1))
        const lbl   = document.getElementById(`buy-total-${id}`)
        if (lbl) lbl.innerHTML = `Cost: <strong>${(price * qty).toLocaleString()}</strong> pts`
      })
    })

    el.querySelectorAll('[id^="buy-cancel-"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.id.replace('buy-cancel-', '')
        document.getElementById(`buy-form-${id}`)?.classList.add('hidden')
      })
    })

    el.querySelectorAll('[id^="buy-confirm-"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.id.replace('buy-confirm-', '')
        const qty = parseInt(document.getElementById(`buy-qty-${id}`)?.value) || 1
        const errEl = document.getElementById(`buy-err-${id}`)
        const okEl  = document.getElementById(`buy-ok-${id}`)
        errEl.classList.add('hidden'); okEl.classList.add('hidden')
        btn.disabled = true; btn.textContent = 'Buying…'

        try {
          const result = await apiFetch(`/api/user-portal/buy/${id}`, {
            method: 'POST',
            body: JSON.stringify({ quantity: qty }),
          })
          okEl.textContent = `${qty} ticket${qty > 1 ? 's' : ''} purchased! Balance: ${Number(result.remaining_points).toLocaleString()} pts`
          okEl.classList.remove('hidden')

          // Refresh profile balance in topbar
          profile = await apiFetch('/api/user-portal/me')
          renderTopbar()

          // Re-load draws to update availability count
          setTimeout(loadTodayDraws, 1500)
        } catch (err) {
          errEl.textContent = err.message
          errEl.classList.remove('hidden')
          btn.disabled = false; btn.textContent = 'Confirm'
        }
      })
    })

  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>Error: ${esc(err.message)}</p></div>`
  }
}

/* ── Sell Points ── */
function loadSellTab() {
  const bal = Number(profile?.points ?? 0)
  document.getElementById('sellBal').textContent = bal.toLocaleString()
  document.getElementById('sellAmt').value = '0'

  const infoEl = document.getElementById('sellAgentInfo')
  const btn    = document.getElementById('sellBtn')
  if (profile?.agent_name) {
    infoEl.textContent = `Your agent is ${profile.agent_name}. Sell points back and they will be returned to your agent's balance.`
    btn.disabled = false
  } else {
    infoEl.textContent = 'Your account is not linked to an agent — points cannot be sold back.'
    btn.disabled = true
  }
}

document.getElementById('sellBtn').addEventListener('click', async () => {
  const errEl  = document.getElementById('sellErr')
  const succEl = document.getElementById('sellSucc')
  errEl.classList.add('hidden'); succEl.classList.add('hidden')

  const points = parseInt(document.getElementById('sellAmt').value) || 0
  if (points <= 0) { errEl.textContent = 'Enter a valid amount'; errEl.classList.remove('hidden'); return }

  const btn = document.getElementById('sellBtn')
  btn.disabled = true
  try {
    const result = await apiFetch('/api/user-portal/sell-points', {
      method: 'POST',
      body: JSON.stringify({ points }),
    })
    succEl.textContent =
      `${points.toLocaleString()} points sold back to ${result.agent_name}. ` +
      `Your balance: ${result.remaining_points.toLocaleString()} pts`
    succEl.classList.remove('hidden')
    document.getElementById('sellAmt').value = '0'

    // Refresh profile to update balance everywhere
    profile = await apiFetch('/api/user-portal/me')
    renderTopbar()
    document.getElementById('sellBal').textContent =
      Number(profile.points ?? 0).toLocaleString()
  } catch (err) {
    errEl.textContent = err.message
    errEl.classList.remove('hidden')
  } finally {
    btn.disabled = false
  }
})

/* ── Transactions ── */
document.getElementById('refreshTxns').addEventListener('click', loadTransactions)

async function loadTransactions() {
  const el = document.getElementById('txnList')
  el.innerHTML = '<div class="empty-state"><div class="ei">⏳</div><p>Loading…</p></div>'

  try {
    const txns = await apiFetch('/api/user-portal/transactions')
    if (!txns.length) {
      el.innerHTML = '<div class="empty-state"><div class="ei">📋</div><p>No transactions yet</p></div>'
      return
    }
    const ICONS = { deposit:'💵', withdraw:'💸', prize:'🏆', points_received:'📥', points_allocated:'📤', ticket_purchase:'🎟️' }
    el.innerHTML = txns.map(t => {
      const isPos = t.amount > 0
      const icon  = ICONS[t.type] || (isPos ? '📥' : '📤')
      return `
        <div class="txn-row">
          <div class="txn-icon">${icon}</div>
          <div class="txn-info">
            <div class="txn-desc">${esc(t.description || t.type)}</div>
            <div class="txn-date">${fmtDateTime(t.created_at)}</div>
          </div>
          <div class="txn-amt ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${Number(t.amount).toLocaleString()} pts</div>
        </div>`
    }).join('')
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><p>Error: ${esc(err.message)}</p></div>`
  }
}

/* ── Init ── */
function switchToTodayTab() {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
  document.querySelector('.tab-btn[data-tab="today"]').classList.add('active')
  document.getElementById('tab-today').classList.add('active')
  loadTodayDraws()
}

if (TOKEN) {
  loadDashboard()
    .then(() => { if (new URLSearchParams(location.search).get('play')) switchToTodayTab() })
    .catch(() => {
      TOKEN = null
      localStorage.removeItem('userToken')
      showScreen('loginScreen')
    })
} else {
  showScreen('loginScreen')
}
