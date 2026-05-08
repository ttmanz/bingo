const API  = ''
let TOKEN  = localStorage.getItem('userToken') || null
let draws  = []
let activeDraw = null  // draw currently open in modal
let qty    = 1

/* ── API helper ── */
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

function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

/* ── Header account link ── */
function updateAccountLink() {
  const link = document.getElementById('accountLink')
  if (TOKEN) {
    const name = getTokenName()
    link.textContent = `👤 ${name}`
  } else {
    link.textContent = 'My Account'
  }
}

function getTokenName() {
  try {
    return JSON.parse(atob(TOKEN.split('.')[1])).name || 'Account'
  } catch { return 'Account' }
}

/* ── Load & render draws ── */
async function loadDraws() {
  try {
    draws = await apiFetch('/api/special-draws')
    renderDraws()
  } catch (e) {
    document.getElementById('drawsGrid').innerHTML =
      `<div class="empty-state"><p>Could not load draws: ${esc(e.message)}</p></div>`
  }
}

function renderDraws() {
  const grid = document.getElementById('drawsGrid')
  if (!draws.length) {
    grid.innerHTML = '<div class="empty-state"><div class="spin">🎱</div><p>No special draws yet — check back soon!</p></div>'
    return
  }
  grid.innerHTML = draws.map(d => drawCard(d)).join('')

  // Start countdown timers
  draws.forEach(d => {
    if (d.status === 'scheduled') startCountdown(d)
  })
}

function drawCard(d) {
  const isOpen = d.status === 'scheduled'
  const isRunning = d.status === 'running'

  const dtStr = `${d.draw_date} ${d.draw_time}`
  const dt    = new Date(dtStr.replace(' ', 'T'))
  const dateLabel = dt.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' })
    + ' · ' + dt.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })

  return `
    <div class="draw-card status-${d.status}" id="card-${d.id}" onclick="openBuyModal(${d.id})">
      <div class="card-glow"></div>
      <div class="card-body">
        <div class="card-status-row">
          <span class="status-pill sp-${d.status}">${statusLabel(d.status)}</span>
          <span class="card-date">${dateLabel}</span>
        </div>
        <div class="card-title">${esc(d.title)}</div>
        ${d.description ? `<div class="card-desc">${esc(d.description)}</div>` : ''}
        <div class="card-prizes">
          <div class="prize-box">
            <div class="prize-label">Full House</div>
            <div class="prize-val">${Number(d.full_house_prize).toLocaleString()} pts</div>
          </div>
          <div class="prize-box">
            <div class="prize-label">Line Win</div>
            <div class="prize-val">${Number(d.line_prize).toLocaleString()} pts</div>
          </div>
        </div>
        ${isOpen ? `<div class="countdown" id="cd-${d.id}"></div>` : ''}
        ${isRunning ? `<div style="text-align:center;color:var(--gold);font-weight:700;margin-bottom:14px">🔴 LIVE NOW</div>` : ''}
      </div>
      <div class="card-footer">
        <button class="buy-btn" ${!isOpen ? 'disabled' : ''}>
          ${isOpen ? '🎟️ Buy Ticket' : isRunning ? '🔴 Draw in Progress' : '✅ Draw Completed'}
        </button>
        <div class="ticket-price-note">${Number(d.ticket_price).toLocaleString()} pts per ticket</div>
      </div>
    </div>`
}

function statusLabel(s) {
  return s === 'scheduled' ? '🟢 Open' : s === 'running' ? '🔴 Live' : '✅ Completed'
}

/* ── Countdown timers ── */
const countdownTimers = {}

function startCountdown(draw) {
  const el = document.getElementById(`cd-${draw.id}`)
  if (!el) return

  function tick() {
    const dtStr = `${draw.draw_date} ${draw.draw_time}`
    const target = new Date(dtStr.replace(' ', 'T')).getTime()
    const diff   = target - Date.now()

    if (diff <= 0) {
      el.innerHTML = '<span style="color:var(--gold);font-weight:700">Starting soon…</span>'
      clearInterval(countdownTimers[draw.id])
      return
    }

    const days  = Math.floor(diff / 86400000)
    const hours = Math.floor((diff % 86400000) / 3600000)
    const mins  = Math.floor((diff % 3600000) / 60000)
    const secs  = Math.floor((diff % 60000) / 1000)

    el.innerHTML = `
      ${days > 0 ? `<div class="cd-unit"><span class="cd-num">${pad(days)}</span><div class="cd-lbl">Days</div></div><div class="cd-sep">:</div>` : ''}
      <div class="cd-unit"><span class="cd-num">${pad(hours)}</span><div class="cd-lbl">Hrs</div></div>
      <div class="cd-sep">:</div>
      <div class="cd-unit"><span class="cd-num">${pad(mins)}</span><div class="cd-lbl">Min</div></div>
      <div class="cd-sep">:</div>
      <div class="cd-unit"><span class="cd-num">${pad(secs)}</span><div class="cd-lbl">Sec</div></div>`
  }

  tick()
  countdownTimers[draw.id] = setInterval(tick, 1000)
}

function pad(n) { return String(n).padStart(2, '0') }

/* ── Open buy modal ── */
async function openBuyModal(drawId) {
  activeDraw = draws.find(d => d.id === drawId)
  if (!activeDraw || activeDraw.status !== 'scheduled') return

  qty = 1

  // Populate header info
  document.getElementById('modalTitle').textContent = activeDraw.title
  const dt = new Date(`${activeDraw.draw_date}T${activeDraw.draw_time}`)
  document.getElementById('modalMeta').textContent =
    dt.toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' })
    + ' at ' + dt.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })

  document.getElementById('modalPrizes').innerHTML = `
    <div class="prize-box"><div class="prize-label">Full House</div><div class="prize-val">${Number(activeDraw.full_house_prize).toLocaleString()} pts</div></div>
    <div class="prize-box"><div class="prize-label">Line Win</div><div class="prize-val">${Number(activeDraw.line_prize).toLocaleString()} pts</div></div>`

  // Reset sections
  document.getElementById('buyAuthSection').classList.add('hidden')
  document.getElementById('buyTicketSection').classList.add('hidden')
  document.getElementById('buyErr').classList.add('hidden')
  document.getElementById('buySuccess').classList.add('hidden')
  document.getElementById('buySuccess').innerHTML = ''

  if (TOKEN) {
    await showBuySection()
  } else {
    document.getElementById('buyAuthSection').classList.remove('hidden')
  }

  document.getElementById('buyModal').classList.remove('hidden')
  updateQty()
}

async function showBuySection() {
  try {
    const me = await apiFetch('/api/user-portal/me')
    document.getElementById('modalBalance').textContent = `${Number(me.points ?? 0).toLocaleString()} pts`
    document.getElementById('buyAuthSection').classList.add('hidden')
    document.getElementById('buyTicketSection').classList.remove('hidden')
    updateAccountLink()
  } catch {
    TOKEN = null
    localStorage.removeItem('userToken')
    document.getElementById('buyAuthSection').classList.remove('hidden')
    document.getElementById('buyTicketSection').classList.add('hidden')
  }
}

/* ── Modal close ── */
document.getElementById('modalClose').addEventListener('click', closeModal)
document.getElementById('buyModal').addEventListener('click', e => {
  if (e.target === document.getElementById('buyModal')) closeModal()
})
function closeModal() {
  document.getElementById('buyModal').classList.add('hidden')
  activeDraw = null
}

/* ── Auth tabs inside modal ── */
document.querySelectorAll('.buy-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.buy-tab').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.buy-form').forEach(f => f.classList.remove('active'))
    btn.classList.add('active')
    document.getElementById(btn.dataset.form).classList.add('active')
  })
})

/* ── Login from modal ── */
document.getElementById('buyLoginForm').addEventListener('submit', async e => {
  e.preventDefault()
  const err = document.getElementById('buyLoginErr')
  const btn = e.target.querySelector('button[type=submit]')
  err.classList.add('hidden'); btn.disabled = true; btn.textContent = 'Signing in…'
  try {
    const data = await apiFetch('/api/user-auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email:    document.getElementById('buyEmail').value.trim(),
        password: document.getElementById('buyPassword').value,
      }),
    })
    TOKEN = data.token
    localStorage.setItem('userToken', TOKEN)
    await showBuySection()
  } catch (er) {
    err.textContent = er.message; err.classList.remove('hidden')
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In & Continue'
  }
})

/* ── Register from modal ── */
document.getElementById('buyRegForm').addEventListener('submit', async e => {
  e.preventDefault()
  const err = document.getElementById('buyRegErr')
  const btn = e.target.querySelector('button[type=submit]')
  err.classList.add('hidden'); btn.disabled = true; btn.textContent = 'Creating account…'
  try {
    const data = await apiFetch('/api/user-auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name:     document.getElementById('buyRegName').value.trim(),
        email:    document.getElementById('buyRegEmail').value.trim(),
        password: document.getElementById('buyRegPassword').value,
      }),
    })
    TOKEN = data.token
    localStorage.setItem('userToken', TOKEN)
    await showBuySection()
  } catch (er) {
    err.textContent = er.message; err.classList.remove('hidden')
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account & Continue'
  }
})

/* ── Quantity control ── */
function updateQty() {
  document.getElementById('qtyVal').value = qty
  const cost = (activeDraw?.ticket_price ?? 0) * qty
  document.getElementById('totalCost').textContent = `${cost.toLocaleString()} pts`
}

document.getElementById('qtyMinus').addEventListener('click', () => {
  if (qty > 1) { qty--; updateQty() }
})
document.getElementById('qtyPlus').addEventListener('click', () => {
  qty++; updateQty()
})
document.getElementById('qtyVal').addEventListener('input', e => {
  const v = parseInt(e.target.value)
  if (v >= 1) { qty = v; updateQty() }
})

/* ── Confirm buy ── */
document.getElementById('confirmBuyBtn').addEventListener('click', async () => {
  const err  = document.getElementById('buyErr')
  const btn  = document.getElementById('confirmBuyBtn')
  const succ = document.getElementById('buySuccess')
  err.classList.add('hidden'); succ.classList.add('hidden')
  btn.disabled = true; btn.textContent = 'Purchasing…'

  try {
    const result = await apiFetch(`/api/special-draws/${activeDraw.id}/buy`, {
      method: 'POST',
      body: JSON.stringify({ quantity: qty }),
    })

    // Show tickets
    const ticketHTML = result.tickets.map((t, i) => `
      <div style="margin-bottom:${i < result.tickets.length-1 ? '10px' : '0'}">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Ticket #${t.id}</div>
        <div class="ticket-number-row">
          ${t.numbers.map(n => `<div class="tball">${n}</div>`).join('')}
        </div>
      </div>`).join('')

    succ.innerHTML = `
      <div class="success-box">
        <h4>🎉 ${result.tickets.length} ticket${result.tickets.length > 1 ? 's' : ''} purchased!</h4>
        ${ticketHTML}
        <div style="font-size:12px;color:var(--muted);margin-top:10px">
          Remaining balance: <strong style="color:#a78bfa">${result.remaining_points.toLocaleString()} pts</strong>
        </div>
      </div>`
    succ.classList.remove('hidden')

    // Update balance display
    document.getElementById('modalBalance').textContent = `${result.remaining_points.toLocaleString()} pts`
    btn.textContent = 'Buy More Tickets'

  } catch (er) {
    err.textContent = er.message; err.classList.remove('hidden')
    btn.textContent = 'Buy Tickets'
  } finally {
    btn.disabled = false
  }
})

/* ── Sign out in modal ── */
document.getElementById('signOutInModal').addEventListener('click', () => {
  TOKEN = null
  localStorage.removeItem('userToken')
  document.getElementById('buyTicketSection').classList.add('hidden')
  document.getElementById('buyAuthSection').classList.remove('hidden')
  updateAccountLink()
})

/* ── Init ── */
updateAccountLink()
loadDraws()

// Reload draws every 60s to pick up status changes
setInterval(loadDraws, 60000)

// Expose for onclick
window.openBuyModal = openBuyModal
