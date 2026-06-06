// ── Config ────────────────────────────────────────────────────────────────
const API = ''  // same origin
let TOKEN = localStorage.getItem('admin_token') || ''
let ADMIN_NAME = localStorage.getItem('admin_name') || ''

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

// ── API helper ────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) { logout(); return null }
  return res.json()
}
const GET    = p      => api('GET',    p)
const POST   = (p, b) => api('POST',   p, b)
const PUT    = (p, b) => api('PUT',    p, b)
const DELETE = p      => api('DELETE', p)

// ── Toast ─────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `show ${type}`
  clearTimeout(el._t)
  el._t = setTimeout(() => el.className = '', 2800)
}

// ── Routing ───────────────────────────────────────────────────────────────
const PANEL_TITLES = {
  today: '🗓 Today\'s Draws',
  draws: 'Daily Draws', tickets: 'Winning Tickets', jackpot: 'Jackpot',
  users: 'Users', agents: 'Agents', payouts: 'Payouts & Accounts',
  special: '✨ Special Draws',
}

function showPanel(name) {
  // Stop Today auto-refresh when navigating away
  if (name !== 'today') _stopTodayRefresh()
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById(`panel-${name}`)?.classList.add('active')
  document.querySelector(`[data-panel="${name}"]`)?.classList.add('active')
  document.getElementById('panel-title').textContent = PANEL_TITLES[name] ?? name
  loadPanel(name)
}

async function loadPanel(name) {
  if (name === 'today')   loadToday()
  if (name === 'draws')   loadDraws()
  if (name === 'tickets') loadTickets()
  if (name === 'jackpot') loadJackpot()
  if (name === 'users')   loadUsers()
  if (name === 'agents')  loadAgents()
  if (name === 'payouts') loadPayouts()
  if (name === 'special') loadSpecialDraws()
}

// ── Login / Logout ────────────────────────────────────────────────────────
document.getElementById('toggle-pass').addEventListener('click', () => {
  const input = document.getElementById('login-pass')
  const btn   = document.getElementById('toggle-pass')
  const showing = input.type === 'text'
  input.type = showing ? 'password' : 'text'
  btn.classList.toggle('visible', !showing)
})

document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('login-user').value.trim()
  const password = document.getElementById('login-pass').value.trim()
  const data = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(r => r.json())
  if (data.token) {
    TOKEN = data.token
    ADMIN_NAME = data.username
    localStorage.setItem('admin_token', TOKEN)
    localStorage.setItem('admin_name', ADMIN_NAME)
    showApp()
  } else {
    document.getElementById('login-error').textContent = data.error || 'Login failed'
  }
})

document.getElementById('login-pass').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('login-btn').click()
})

function logout() {
  TOKEN = ''; ADMIN_NAME = ''
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_name')
  document.getElementById('app').style.display = 'none'
  document.getElementById('login-screen').style.display = 'flex'
}

document.getElementById('logout-btn').addEventListener('click', logout)

// ── Profile dropdown ──────────────────────────────────────────────────────
const profileBtn      = document.getElementById('profileBtn')
const profileDropdown = document.getElementById('profileDropdown')
const profileDropName = document.getElementById('profileDropName')
const profileInitials = document.getElementById('profileInitials')

profileBtn.addEventListener('click', e => {
  e.stopPropagation()
  profileDropdown.classList.toggle('hidden')
})
document.addEventListener('click', () => profileDropdown.classList.add('hidden'))

document.getElementById('ddLogout').addEventListener('click', logout)

// Profile modal
const profileModal = document.getElementById('profileModal')
document.getElementById('ddProfile').addEventListener('click', () => {
  profileDropdown.classList.add('hidden')
  document.getElementById('pmName').textContent = ADMIN_NAME
  document.getElementById('pmAvatarBig').textContent = (ADMIN_NAME || 'A')[0].toUpperCase()
  document.getElementById('pmCurPass').value = ''
  document.getElementById('pmNewPass').value = ''
  const msg = document.getElementById('pmMsg')
  msg.className = 'pm-msg hidden'; msg.textContent = ''
  profileModal.classList.remove('hidden')
})
document.getElementById('profileModalClose').addEventListener('click', () => profileModal.classList.add('hidden'))
profileModal.addEventListener('click', e => { if (e.target === profileModal) profileModal.classList.add('hidden') })
document.getElementById('pmSaveBtn').addEventListener('click', async () => {
  const cur = document.getElementById('pmCurPass').value
  const nw  = document.getElementById('pmNewPass').value
  const msg = document.getElementById('pmMsg')
  if (!cur || !nw) { msg.className='pm-msg err'; msg.textContent='Fill in both fields.'; return }
  const res = await apiFetch('/api/auth/change-password', { method:'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) })
  if (res) { msg.className='pm-msg ok'; msg.textContent='Password updated.'; document.getElementById('pmCurPass').value=''; document.getElementById('pmNewPass').value='' }
  else { msg.className='pm-msg err'; msg.textContent='Incorrect current password.' }
})

// Settings modal
const settingsModal = document.getElementById('settingsModal')
document.getElementById('ddSettings').addEventListener('click', () => {
  profileDropdown.classList.add('hidden')
  const msg = document.getElementById('stMsg')
  msg.className = 'pm-msg hidden'; msg.textContent = ''
  settingsModal.classList.remove('hidden')
})
document.getElementById('settingsModalClose').addEventListener('click', () => settingsModal.classList.add('hidden'))
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden') })
document.getElementById('stSaveBtn').addEventListener('click', () => {
  const msg = document.getElementById('stMsg')
  msg.className = 'pm-msg ok'; msg.textContent = 'Settings saved.'
})

function showApp() {
  document.getElementById('login-screen').style.display = 'none'
  document.getElementById('app').style.display = 'flex'
  profileDropName.textContent = ADMIN_NAME
  profileInitials.textContent = (ADMIN_NAME || 'A')[0].toUpperCase()
  showPanel('draws')
}

// Sidebar navigation
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => showPanel(item.dataset.panel))
})

// ══════════════════════════════════════════════════════════════════════════
// DRAWS PANEL
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// TODAY PANEL  — draw name + tickets sold in pts, live row refreshes every 10s
// ══════════════════════════════════════════════════════════════════════════
let _todayTimer = null

function _stopTodayRefresh() {
  if (_todayTimer) { clearInterval(_todayTimer); _todayTimer = null }
}

async function loadToday() {
  await _renderToday()
  _stopTodayRefresh()
  _todayTimer = setInterval(_renderToday, 10_000)
}

async function _renderToday() {
  const draws = await GET('/api/schedule/today')
  if (!draws) return

  const tbody = document.getElementById('today-tbody')
  const updated = document.getElementById('today-last-updated')
  if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString()

  if (!draws.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">No draws today</td></tr>'
    return
  }

  tbody.innerHTML = draws.map((d, i) => {
    let statusBadge
    if      (d.status === 'completed') statusBadge = '<span class="badge badge-success">Completed</span>'
    else if (d.is_live)                statusBadge = '<span class="badge badge-danger">🔴 Live</span>'
    else if (d.status === 'running')   statusBadge = '<span class="badge badge-danger">🔴 Live</span>'
    else if (d.status === 'scheduled') statusBadge = '<span class="badge badge-warning">Pending</span>'
    else                               statusBadge = `<span class="badge badge-info">${d.status}</span>`

    const pts = Number(d.revenue_pts || 0).toLocaleString()
    const rowStyle = d.is_live ? 'background:rgba(239,68,68,.06);' : ''

    return `<tr style="${rowStyle}">
      <td>${i + 1}</td>
      <td><strong>${d.title || 'Draw'}</strong><span class="text-muted" style="font-size:.78rem;margin-left:6px">${d.draw_time || ''}</span></td>
      <td>${statusBadge}</td>
      <td style="text-align:right;font-weight:700">${pts} pts</td>
    </tr>`
  }).join('')
}

let _scheduleData = []

async function loadDraws() {
  const data = await GET('/api/schedule')
  if (!data) return
  _scheduleData = data
  loadDrawInstances()
  const grid = document.getElementById('week-grid')
  grid.innerHTML = data.map(day => `
    <div class="day-block">
      <div class="day-header">
        <span class="day-name">${day.name}</span>
        <button class="btn btn-sm btn-primary" onclick="openDrawModal(${day.day})">＋ Add</button>
      </div>
      <div class="day-draws">
        ${day.draws.length === 0 ? '<div class="no-draws">No draws scheduled</div>' : `
          <div class="draw-row draw-row-header">
            <span>Time</span><span>#</span><span>Title</span>
            <span>Ball (s)</span><span>Ticket Pts</span><span>Full House Pts</span><span>Line Pts</span><span>Actions</span>
          </div>
          ${day.draws.map(d => `
            <div class="draw-row">
              <span>${d.draw_time}</span>
              <span>${d.draw_number}</span>
              <span>${d.title}</span>
              <span>${d.ball_interval}s</span>
              <span>${Math.round(d.ticket_price)} Pts</span>
              <span>${Math.round(d.full_house_prize)} Pts</span>
              <span>${Math.round(d.line_prize)} Pts</span>
              <span style="display:flex;gap:6px">
                <button class="btn btn-sm btn-ghost" onclick="openDrawModal(${day.day}, ${JSON.stringify(d).replace(/"/g,'&quot;')})">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteDraw(${d.id})">Del</button>
              </span>
            </div>
          `).join('')}
        `}
      </div>
    </div>
  `).join('')
}

// Draw modal
let _drawEditId = null
function openDrawModal(day, draw = null) {
  _drawEditId = draw?.id ?? null
  document.getElementById('draw-modal-title').textContent = draw ? 'Edit Draw' : 'Add Draw'
  document.getElementById('dm-day').value = draw?.day_of_week ?? day

  // Auto-increment: next draw number = max existing for this day + 1
  if (draw) {
    document.getElementById('dm-number').value = draw.draw_number
  } else {
    const dayDraws = _scheduleData.find(d => d.day === day)?.draws ?? []
    const maxNum   = dayDraws.reduce((m, d) => Math.max(m, d.draw_number ?? 0), 0)
    document.getElementById('dm-number').value = maxNum + 1
  }
  document.getElementById('dm-time').value         = draw?.draw_time ?? '19:00'
  document.getElementById('dm-interval').value     = draw?.ball_interval ?? 5
  document.getElementById('dm-title').value        = draw?.title ?? ''
  document.getElementById('dm-ticket-price').value = draw?.ticket_price ?? 1
  document.getElementById('dm-fh-prize').value     = draw?.full_house_prize ?? 100
  document.getElementById('dm-line-prize').value   = draw?.line_prize ?? 10
  document.getElementById('dm-announcer').value    = draw?.announcer ?? ''
  document.getElementById('draw-modal').classList.add('open')
}

document.getElementById('draw-modal-cancel').addEventListener('click', () => {
  document.getElementById('draw-modal').classList.remove('open')
})

document.getElementById('draw-modal-save').addEventListener('click', async () => {
  const body = {
    day_of_week:      Number(document.getElementById('dm-day').value),
    draw_number:      Number(document.getElementById('dm-number').value),
    draw_time:        document.getElementById('dm-time').value,
    ball_interval:    Number(document.getElementById('dm-interval').value),
    title:            document.getElementById('dm-title').value.trim(),
    ticket_price:     Number(document.getElementById('dm-ticket-price').value),
    full_house_prize: Number(document.getElementById('dm-fh-prize').value),
    line_prize:       Number(document.getElementById('dm-line-prize').value),
    announcer:        document.getElementById('dm-announcer').value || null,
  }
  if (!body.title) { toast('Title is required', 'error'); return }
  if (_drawEditId) {
    await PUT(`/api/schedule/${_drawEditId}`, body)
  } else {
    await POST('/api/schedule', body)
  }
  document.getElementById('draw-modal').classList.remove('open')
  toast(_drawEditId ? 'Draw updated' : 'Draw added')
  loadDraws()
})

document.getElementById('gen-today-btn').addEventListener('click', async () => {
  const btn = document.getElementById('gen-today-btn')
  const msg = document.getElementById('gen-today-msg')
  const days = parseInt(document.getElementById('gen-days-select').value) || 1
  btn.disabled = true
  btn.textContent = 'Generating…'
  const res = await POST('/api/schedule/generate-today', { days })
  btn.disabled = false
  btn.textContent = '⚡ Generate Draws'
  if (!res) return
  msg.style.display = 'block'
  if (res.created === 0) {
    msg.className = 'alert alert-info'
    msg.textContent = res.message || `All draws already exist${res.skipped?.length ? ` (${res.skipped.join(', ')})` : ''}`
  } else {
    msg.className = 'alert alert-success'
    msg.textContent = `✓ Created ${res.created} draw${res.created > 1 ? 's' : ''} across ${days} day${days > 1 ? 's' : ''}${res.skipped?.length ? ` (${res.skipped.length} skipped — already existed)` : ''}`
  }
  setTimeout(() => { msg.style.display = 'none' }, 5000)
  loadDrawInstances()
})

async function deleteDraw(id) {
  if (!confirm('Delete this draw?')) return
  await DELETE(`/api/schedule/${id}`)
  toast('Draw deleted')
  loadDraws()
}

document.getElementById('add-draw-btn').addEventListener('click', () => openDrawModal(0))

async function loadDrawInstances() {
  const rows = await GET('/api/schedule/draws?limit=200')
  const el = document.getElementById('draw-instances-list')
  if (!rows || !rows.length) {
    el.innerHTML = '<p style="color:var(--muted);padding:8px 0">No draw instances.</p>'
    return
  }
  const statusStyle = {
    scheduled: 'color:#10b981;font-weight:600',
    running:   'color:#f59e0b;font-weight:600',
    completed: 'color:var(--muted)',
    cancelled: 'color:#ef4444',
  }
  const rowBg = {
    scheduled: '',
    running:   'background:rgba(245,158,11,0.07)',
    completed: 'background:rgba(255,255,255,0.02)',
    cancelled: 'background:rgba(239,68,68,0.07)',
  }
  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="color:var(--muted);text-align:left;border-bottom:1px solid var(--border)">
        <th style="padding:8px 12px">Date</th>
        <th style="padding:8px 12px">Time</th>
        <th style="padding:8px 12px">Title</th>
        <th style="padding:8px 12px">Status</th>
        <th style="padding:8px 12px">Tickets</th>
        <th style="padding:8px 12px"></th>
      </tr></thead>
      <tbody>${rows.map(d => `
        <tr style="border-bottom:1px solid var(--border);${rowBg[d.status]??''}">
          <td style="padding:8px 12px;${d.status==='completed'?'color:var(--muted)':''}">${d.draw_date}</td>
          <td style="padding:8px 12px;${d.status==='completed'?'color:var(--muted)':''}">${d.draw_time}</td>
          <td style="padding:8px 12px;${d.status==='completed'?'color:var(--muted)':''}">${d.title}</td>
          <td style="padding:8px 12px;${statusStyle[d.status]??''}">${d.status}</td>
          <td style="padding:8px 12px">${d.ticket_count ?? 0}</td>
          <td style="padding:8px 12px">
            <button class="btn btn-sm btn-danger" onclick="deleteDrawInstance(${d.id})">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`
}

async function deleteDrawInstance(id) {
  if (!confirm('Delete this draw instance? This cannot be undone.')) return
  await DELETE(`/api/schedule/draws/${id}`)
  toast('Draw instance deleted')
  loadDrawInstances()
}

// ══════════════════════════════════════════════════════════════════════════
// TICKETS PANEL
// ══════════════════════════════════════════════════════════════════════════
let _ticketPeriod = 'today'

document.getElementById('ticket-period-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.period-tab')
  if (!btn) return
  document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  _ticketPeriod = btn.dataset.period
  loadTickets()
})

async function loadTickets() {
  const status  = document.getElementById('ticket-filter').value
  const paidOut = document.getElementById('ticket-paid-filter').value
  let url = '/api/tickets/winning'
  const params = new URLSearchParams()
  if (status)  params.set('status',  status)
  if (paidOut !== '') params.set('paid_out', paidOut)
  if ([...params].length) url += '?' + params

  let data = await GET(url)
  if (!data) return

  // Period filter
  if (_ticketPeriod !== 'all') {
    const now   = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay())
    data = data.filter(t => {
      const d = new Date(t.draw_date || t.created_at)
      if (_ticketPeriod === 'today') return d >= today
      if (_ticketPeriod === 'week')  return d >= weekStart
      return true
    })
  }

  const tbody = document.getElementById('tickets-tbody')
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">No winning tickets found</td></tr>'; return }
  tbody.innerHTML = data.map(t => `
    <tr>
      <td>#${t.id}</td>
      <td>${t.draw_title}</td>
      <td>${t.draw_date}</td>
      <td>${t.user_name}<br><span class="text-muted">${t.user_phone || ''}</span></td>
      <td><span class="badge ${statusBadge(t.status)}">${t.status}</span></td>
      <td class="text-warning">${Math.round(t.prize_amount)} Pts</td>
      <td>${t.paid_out ? '<span class="badge badge-success">Paid</span>' : '<span class="badge badge-warning">Pending</span>'}</td>
      <td>${t.paid_out ? '' : `<button class="btn btn-sm btn-success" onclick="payTicket(${t.id})">Pay Out</button>`}</td>
    </tr>
  `).join('')
}

async function payTicket(id) {
  if (!confirm('Mark this ticket as paid out?')) return
  await PUT(`/api/tickets/${id}/payout`, {})
  toast('Ticket marked as paid out')
  loadTickets()
}

function statusBadge(s) {
  if (s === 'full_house') return 'badge-success'
  if (s === '2lines')     return 'badge-info'
  if (s === '1line')      return 'badge-purple'
  return 'badge-warning'
}

document.getElementById('ticket-filter').addEventListener('change', loadTickets)
document.getElementById('ticket-paid-filter').addEventListener('change', loadTickets)

// ══════════════════════════════════════════════════════════════════════════
// JACKPOT PANEL
// ══════════════════════════════════════════════════════════════════════════
async function loadJackpot() {
  const data = await GET('/api/jackpot')
  if (!data) return
  document.getElementById('jackpot-enabled').checked = !!data.enabled
  document.getElementById('jackpot-amount').value    = data.amount
  document.getElementById('jackpot-balls').value     = data.ball_count
  document.getElementById('jackpot-display').textContent = `${Math.round(data.amount)} Pts`
  document.getElementById('jackpot-status-label').textContent = data.enabled ? 'Jackpot Active' : 'Jackpot Disabled'
  document.getElementById('jackpot-status-label').style.color = data.enabled ? 'var(--success)' : 'var(--muted)'
}

document.getElementById('jackpot-enabled').addEventListener('change', function() {
  document.getElementById('jackpot-status-label').textContent = this.checked ? 'Jackpot Active' : 'Jackpot Disabled'
  document.getElementById('jackpot-status-label').style.color = this.checked ? 'var(--success)' : 'var(--muted)'
})

document.getElementById('jackpot-amount').addEventListener('input', function() {
  document.getElementById('jackpot-display').textContent = `${Math.round(this.value || 0)} Pts`
})

document.getElementById('save-jackpot-btn').addEventListener('click', async () => {
  await PUT('/api/jackpot', {
    enabled:    document.getElementById('jackpot-enabled').checked,
    amount:     Number(document.getElementById('jackpot-amount').value),
    ball_count: Number(document.getElementById('jackpot-balls').value),
  })
  toast('Jackpot settings saved')
})

// ══════════════════════════════════════════════════════════════════════════
// USERS PANEL
// ══════════════════════════════════════════════════════════════════════════
async function loadUsers() {
  const search = document.getElementById('user-search').value.trim()
  const params = new URLSearchParams({ limit: 200 })
  if (search) params.set('search', search)
  const data = await GET('/api/users?' + params)
  if (!data) return
  const tbody = document.getElementById('users-tbody')
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No users found</td></tr>'; return }
  tbody.innerHTML = data.map(u => `
    <tr>
      <td>#${u.id}</td>
      <td><strong>${u.name}</strong></td>
      <td>${u.email || '—'}<br><span class="text-muted">${u.phone || ''}</span></td>
      <td><span class="badge ${u.role === 'agent' ? 'badge-purple' : u.role === 'admin' ? 'badge-info' : 'badge-success'}">${u.role}</span></td>
      <td>💎 ${Number(u.points || 0).toLocaleString()}</td>
      <td>${u.ticket_count}</td>
      <td><span class="badge ${u.status === 'active' ? 'badge-success' : 'badge-danger'}">${u.status}</span></td>
      <td style="color:var(--muted);font-size:.78rem">${u.created_at?.slice(0,10) || ''}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-sm btn-ghost" onclick="openUserModal(${JSON.stringify(u).replace(/"/g,'&quot;')})">Edit</button>
        <button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-success'}" onclick="toggleUserStatus(${u.id},'${u.status === 'active' ? 'suspended' : 'active'}')">
          ${u.status === 'active' ? 'Suspend' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('')
}

let _userEditId = null
function openUserModal(user = null) {
  _userEditId = user?.id ?? null
  document.getElementById('user-modal-title').textContent = user ? 'Edit User' : 'Add User'
  document.getElementById('um-name').value    = user?.name    ?? ''
  document.getElementById('um-email').value   = user?.email   ?? ''
  document.getElementById('um-phone').value   = user?.phone   ?? ''
  document.getElementById('um-role').value    = user?.role    ?? 'player'
  document.getElementById('um-balance').value = user?.balance ?? 0
  document.getElementById('um-status').value  = user?.status  ?? 'active'
  document.getElementById('user-modal').classList.add('open')
}

document.getElementById('add-user-btn').addEventListener('click', () => openUserModal())
document.getElementById('user-modal-cancel').addEventListener('click', () => document.getElementById('user-modal').classList.remove('open'))

document.getElementById('user-modal-save').addEventListener('click', async () => {
  const body = {
    name:    document.getElementById('um-name').value.trim(),
    email:   document.getElementById('um-email').value.trim() || null,
    phone:   document.getElementById('um-phone').value.trim() || null,
    role:    document.getElementById('um-role').value,
    balance: Number(document.getElementById('um-balance').value),
    status:  document.getElementById('um-status').value,
  }
  if (!body.name) { toast('Name is required', 'error'); return }
  if (_userEditId) {
    await PUT(`/api/users/${_userEditId}`, body)
    toast('User updated')
  } else {
    await POST('/api/users', body)
    toast('User added')
  }
  document.getElementById('user-modal').classList.remove('open')
  loadUsers()
})

async function toggleUserStatus(id, newStatus) {
  await PUT(`/api/users/${id}/status`, { status: newStatus })
  toast(`User ${newStatus}`)
  loadUsers()
}

let _searchTimer = null
document.getElementById('user-search').addEventListener('input', () => {
  clearTimeout(_searchTimer)
  _searchTimer = setTimeout(loadUsers, 300)
})

// ══════════════════════════════════════════════════════════════════════════
// AGENTS PANEL
// ══════════════════════════════════════════════════════════════════════════
// ── Agent type labels / colors ────────────────────────────────────────────
const AGENT_TYPE_META = {
  super:  { label: 'Super Agent',  badge: 'badge-warning', icon: '👑', avatarClass: 'avatar-super',  parentType: null,     parentLabel: 'None (top level)' },
  master: { label: 'Master Agent', badge: 'badge-info',    icon: '⭐', avatarClass: 'avatar-master', parentType: 'super',  parentLabel: 'Super Agent' },
  agent:  { label: 'Agent',        badge: 'badge-purple',  icon: '🤝', avatarClass: 'avatar-agent',  parentType: 'master', parentLabel: 'Master Agent' },
}

async function loadAgents() {
  const view = document.getElementById('agent-view-toggle').value
  document.getElementById('agent-tree-view').style.display  = view === 'tree'  ? 'block' : 'none'
  document.getElementById('agent-table-view').style.display = view === 'table' ? 'block' : 'none'

  if (view === 'tree') {
    await renderAgentTree()
  } else {
    await renderAgentTable()
  }
}

async function renderAgentTree() {
  const tree = await GET('/api/agents/tree')
  if (!tree) return
  const el = document.getElementById('agent-tree')

  if (!tree.length) {
    el.innerHTML = `<div style="text-align:center;color:var(--muted);padding:48px">No agents yet. Click <strong>+ Add Agent</strong> to create your first Super Agent.</div>`
    return
  }

  function renderNode(node, depth = 0) {
    const meta = AGENT_TYPE_META[node.agent_type] || AGENT_TYPE_META.agent
    const dataAttr = `data-agent='${JSON.stringify(node).replace(/'/g, '&#39;')}'`
    return `
      <div class="agent-node">
        <div class="agent-node-header">
          <div class="agent-node-avatar ${meta.avatarClass}">${meta.icon}</div>
          <div class="agent-node-info">
            <div class="agent-node-name">${node.name} <span class="badge ${meta.badge}" style="margin-left:6px">${meta.label}</span></div>
            <div class="agent-node-meta">${node.phone || node.email || '—'} · Commission: ${Number(node.commission_rate).toFixed(1)}%</div>
          </div>
          <div class="agent-node-stats">
            ${node.children?.length ? `<span><strong>${node.children.length}</strong> sub-agents</span>` : ''}
            <span><strong>${node.player_count || 0}</strong> players</span>
          </div>
          <div class="agent-node-actions">
            <button class="btn btn-sm btn-ghost" onclick='openAgentEditModal(${JSON.stringify(node).replace(/"/g,"&quot;")})'>Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteAgent(${node.id})">Remove</button>
          </div>
        </div>
        ${node.children?.length ? `<div class="agent-children">${node.children.map(c => renderNode(c, depth + 1)).join('')}</div>` : ''}
      </div>
    `
  }

  // Group top-level nodes by type
  const sections = [
    { type: 'super',  label: 'Super Agents',  nodes: tree.filter(n => n.agent_type === 'super') },
    { type: 'master', label: 'Master Agents', nodes: tree.filter(n => n.agent_type === 'master') },
    { type: 'agent',  label: 'Agents',        nodes: tree.filter(n => n.agent_type === 'agent') },
  ].filter(s => s.nodes.length)

  el.innerHTML = sections.map(s => `
    <div class="agent-tree-section">
      <div class="agent-tree-section-title">${AGENT_TYPE_META[s.type].icon} ${s.label}</div>
      ${s.nodes.map(n => renderNode(n)).join('')}
    </div>
  `).join('')
}

async function renderAgentTable(filterType = '') {
  const url = filterType ? `/api/agents?agent_type=${filterType}` : '/api/agents'
  const data = await GET(url)
  if (!data) return
  const tbody = document.getElementById('agents-tbody')
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">No agents found</td></tr>'
    return
  }
  tbody.innerHTML = data.map(a => {
    const meta = AGENT_TYPE_META[a.agent_type] || AGENT_TYPE_META.agent
    return `
      <tr>
        <td>#${a.id}</td>
        <td><span class="badge ${meta.badge}">${meta.icon} ${meta.label}</span></td>
        <td><strong>${a.name}</strong></td>
        <td>${a.email || a.phone || '—'}</td>
        <td>${Number(a.commission_rate).toFixed(1)}%</td>
        <td>${a.child_agent_count || 0}</td>
        <td>${a.player_count || 0}</td>
        <td>💎 ${Number(a.points ?? 0).toLocaleString()}</td>
        <td>${a.parent_name ? `${a.parent_name} <span class="text-muted">(${a.parent_type})</span>` : '—'}</td>
        <td><span class="badge ${a.status === 'active' ? 'badge-success' : 'badge-danger'}">${a.status}</span></td>
        <td style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-sm btn-ghost" onclick='openAgentEditModal(${JSON.stringify(a).replace(/"/g,"&quot;")})'>Edit</button>
          <button class="btn btn-sm btn-secondary" onclick="openAllocModal(${a.id},'${a.name.replace(/'/g,"\\'")}',${a.points ?? 0})">+ Points</button>
          <button class="btn btn-sm btn-ghost" onclick="openFamilyModal(${a.id},'${a.name.replace(/'/g,"\\'")}')">👨‍👩‍👧 Family</button>
          <button class="btn btn-sm btn-danger" onclick="deleteAgent(${a.id})">Remove</button>
        </td>
      </tr>`
  }).join('')
}

// View toggle
document.getElementById('agent-view-toggle').addEventListener('change', loadAgents)

// Type filter buttons (table view)
document.querySelectorAll('.agent-type-filter').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.agent-type-filter').forEach(b => b.classList.remove('active'))
    this.classList.add('active')
    renderAgentTable(this.dataset.type)
  })
})

// ── Agent modal ───────────────────────────────────────────────────────────
// Type card selection
document.querySelectorAll('.agent-type-card').forEach(card => {
  card.addEventListener('click', async function() {
    document.querySelectorAll('.agent-type-card').forEach(c => c.classList.remove('selected'))
    this.classList.add('selected')
    const type = this.dataset.type
    document.getElementById('am-type').value = type
    await updateParentSelector(type)
  })
})

async function updateParentSelector(type) {
  const meta = AGENT_TYPE_META[type]
  const parentGroup = document.getElementById('am-parent-group')
  const parentSel   = document.getElementById('am-parent')
  const parentLabel = document.getElementById('am-parent-label')

  if (!meta.parentType) {
    // Super agents have no required parent
    parentLabel.textContent = 'Parent (optional bypass)'
    parentSel.innerHTML = '<option value="">None (Admin creates directly)</option>'
    const allAgents = await GET('/api/agents') || []
    allAgents.forEach(a => {
      parentSel.innerHTML += `<option value="${a.id}">${AGENT_TYPE_META[a.agent_type]?.icon} ${a.name}</option>`
    })
  } else {
    parentLabel.textContent = `${meta.parentLabel} (required)`
    const parents = await GET(`/api/agents/by-type/${meta.parentType}`) || []
    parentSel.innerHTML = `<option value="">— Select ${meta.parentLabel} —</option>` +
      parents.map(p => `<option value="${p.id}">${p.name} ${p.phone ? '· ' + p.phone : ''}</option>`).join('')
  }
}

document.getElementById('add-agent-btn').addEventListener('click', async () => {
  document.getElementById('agent-edit-id').value = ''
  document.getElementById('agent-modal-title').textContent = 'Add Agent'
  document.getElementById('am-commission').value = 5
  document.getElementById('am-status').value = 'active'
  document.getElementById('am-user-row').style.display = 'none'
  document.getElementById('am-credentials-row').style.display = ''

  // Clear credential fields
  ;['am-name','am-email','am-phone','am-password'].forEach(id => {
    document.getElementById(id).value = ''
  })
  document.getElementById('am-points').value = 0

  // Default to 'agent' type
  document.querySelectorAll('.agent-type-card').forEach(c => c.classList.remove('selected'))
  document.querySelector('.agent-type-card[data-type="agent"]').classList.add('selected')
  document.getElementById('am-type').value = 'agent'

  await updateParentSelector('agent')
  document.getElementById('agent-modal').classList.add('open')
})

async function openAgentEditModal(agent) {
  document.getElementById('agent-edit-id').value = agent.id
  document.getElementById('agent-modal-title').textContent = 'Edit Agent'
  document.getElementById('am-commission').value = agent.commission_rate
  document.getElementById('am-status').value     = agent.status
  document.getElementById('am-user-row').style.display = 'none'
  document.getElementById('am-credentials-row').style.display = 'none'
  document.getElementById('am-user').innerHTML = `<option value="${agent.user_id}">${agent.name}</option>`

  // Highlight current type
  document.querySelectorAll('.agent-type-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.type === agent.agent_type)
  })
  document.getElementById('am-type').value = agent.agent_type

  await updateParentSelector(agent.agent_type)
  // Set current parent
  const parentSel = document.getElementById('am-parent')
  if (agent.parent_agent_id) {
    const opt = parentSel.querySelector(`option[value="${agent.parent_agent_id}"]`)
    if (opt) opt.selected = true
  }
  document.getElementById('agent-modal').classList.add('open')
}

document.getElementById('agent-modal-cancel').addEventListener('click', () =>
  document.getElementById('agent-modal').classList.remove('open'))

document.getElementById('agent-modal-save').addEventListener('click', async () => {
  const editId     = document.getElementById('agent-edit-id').value
  const agent_type = document.getElementById('am-type').value
  const parentVal  = document.getElementById('am-parent').value

  if (!agent_type) { toast('Select an agent type', 'error'); return }

  const body = {
    agent_type,
    commission_rate: Number(document.getElementById('am-commission').value),
    parent_agent_id: parentVal ? Number(parentVal) : null,
    status:          document.getElementById('am-status').value,
  }

  let res
  if (editId) {
    res = await PUT(`/api/agents/${editId}`, body)
  } else {
    const name     = document.getElementById('am-name').value.trim()
    const email    = document.getElementById('am-email').value.trim()
    const phone    = document.getElementById('am-phone').value.trim()
    const password = document.getElementById('am-password').value
    const points   = Number(document.getElementById('am-points').value) || 0
    if (!name)     { toast('Name is required', 'error'); return }
    if (!email)    { toast('Email is required', 'error'); return }
    if (!password) { toast('Password is required', 'error'); return }
    res = await POST('/api/agents', { ...body, name, email, phone: phone || null, password, points })
  }

  if (res?.error) { toast(res.error, 'error'); return }
  document.getElementById('agent-modal').classList.remove('open')
  toast(editId ? 'Agent updated' : `${AGENT_TYPE_META[agent_type]?.label} created`)
  loadAgents()
})

async function deleteAgent(id) {
  if (!confirm('Remove this agent? Their user account will remain as a player.')) return
  await DELETE(`/api/agents/${id}`)
  toast('Agent removed')
  loadAgents()
}

// ── Allocate Points modal ─────────────────────────────────────────────────
function openAllocModal(agentId, agentName, currentPoints) {
  document.getElementById('alloc-agent-user-id').value = agentId
  document.getElementById('alloc-agent-name').textContent =
    `${agentName} · Current balance: ${Number(currentPoints ?? 0).toLocaleString()} pts`
  document.getElementById('alloc-amount').value = 100
  document.getElementById('alloc-modal').classList.add('open')
}

document.getElementById('alloc-modal-cancel').addEventListener('click', () =>
  document.getElementById('alloc-modal').classList.remove('open'))

document.getElementById('alloc-modal-save').addEventListener('click', async () => {
  const agentId = Number(document.getElementById('alloc-agent-user-id').value)
  const amount  = Number(document.getElementById('alloc-amount').value)
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return }

  const btn = document.getElementById('alloc-modal-save')
  btn.disabled = true
  const res = await POST(`/api/agents/${agentId}/add-points`, { amount })
  btn.disabled = false

  if (res?.error) { toast(res.error, 'error'); return }
  document.getElementById('alloc-modal').classList.remove('open')
  toast(`${amount.toLocaleString()} points added`)
  loadAgents()
})

// ══════════════════════════════════════════════════════════════════════════
// PAYOUTS PANEL
// ══════════════════════════════════════════════════════════════════════════
let _txnPeriod = 'today'   // 'today' | 'all'

// Reload transaction table with current period + type filters
async function refreshTxnTable() {
  const type = document.getElementById('txn-type-filter').value
  const params = []
  if (type)                  params.push(`type=${encodeURIComponent(type)}`)
  if (_txnPeriod === 'today') params.push('date=today')
  const txns = await GET('/api/payouts' + (params.length ? '?' + params.join('&') : ''))
  const tbody = document.getElementById('txn-tbody')
  if (!txns || !txns.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No transactions${_txnPeriod === 'today' ? ' today' : ' yet'}</td></tr>`
    return
  }
  tbody.innerHTML = txns.map(t => `
    <tr>
      <td>#${t.id}</td>
      <td>${t.user_name}</td>
      <td><span class="badge ${txnBadge(t.type)}">${t.type}</span></td>
      <td class="${t.amount >= 0 ? 'text-success' : 'text-danger'}">${Math.round(Math.abs(t.amount))} Pts</td>
      <td>${Math.round(t.balance_after)} Pts</td>
      <td class="text-muted">${t.description || '—'}</td>
      <td class="text-muted" style="font-size:.78rem">${t.created_at?.slice(0,16).replace('T',' ') || ''}</td>
    </tr>
  `).join('')
}

// Load today's snapshot stats
async function loadTodaySummary() {
  const data = await GET('/api/payouts/summary-today')
  const el = document.getElementById('today-summary')
  if (!data || !el) return
  el.style.display = ''
  document.getElementById('today-stats').innerHTML = `
    <div class="card">
      <div class="card-title">Draws Run</div>
      <div class="card-value">${data.draws}</div>
    </div>
    <div class="card">
      <div class="card-title">Tickets Sold</div>
      <div class="card-value">${data.ticketsSold.count}</div>
      <div class="card-sub text-muted" style="font-size:.82rem;margin-top:2px">${Math.round(data.ticketsSold.total || 0)} pts revenue</div>
    </div>
    <div class="card">
      <div class="card-title">Prizes Paid</div>
      <div class="card-value text-warning">${data.prizes.count}</div>
      <div class="card-sub text-muted" style="font-size:.82rem;margin-top:2px">${Math.round(data.prizes.total || 0)} pts</div>
    </div>
    <div class="card">
      <div class="card-title">Deposits In</div>
      <div class="card-value text-success">${data.deposits.count}</div>
      <div class="card-sub text-muted" style="font-size:.82rem;margin-top:2px">${Math.round(data.deposits.total || 0)} pts</div>
    </div>
    <div class="card">
      <div class="card-title">Withdrawals</div>
      <div class="card-value text-danger">${data.withdrawals.count}</div>
      <div class="card-sub text-muted" style="font-size:.82rem;margin-top:2px">${Math.round(data.withdrawals.total || 0)} pts</div>
    </div>
  `
}

async function loadPayouts() {
  const [summary, txns] = await Promise.all([
    GET('/api/payouts/summary'),
    GET('/api/payouts?date=today&limit=200'),
  ])
  if (!summary || !txns) return

  // Stats — Players row
  const statsEl = document.getElementById('payout-stats')
  statsEl.innerHTML = `
    <div class="card"><div class="card-title">Total User Balances</div><div class="card-value">${Number(summary.userBalance || 0).toLocaleString()} pts</div></div>
    <div class="card"><div class="card-title">Pending Payouts</div><div class="card-value text-warning">${summary.pendingPayouts?.count || 0}</div></div>
    <div class="card"><div class="card-title">Pending Prize Value</div><div class="card-value text-danger">${Number(summary.pendingPayouts?.total || 0).toLocaleString()} pts</div></div>
    <div class="card"><div class="card-title">Total Deposits</div><div class="card-value text-success">${Number(summary.playerDeposits || 0).toLocaleString()} pts</div></div>
    <div class="card"><div class="card-title">Total Prizes Paid</div><div class="card-value">${Number(summary.playerPrizes || 0).toLocaleString()} pts</div></div>
  `

  // Stats — Agents row
  const agentStatsEl = document.getElementById('payout-stats-agents')
  agentStatsEl.innerHTML = `
    <div class="card"><div class="card-title">Total Agent Balances</div><div class="card-value">${Number(summary.agentBalance || 0).toLocaleString()} pts</div></div>
    <div class="card"><div class="card-title">Pending Payouts</div><div class="card-value text-warning">${summary.agentPendingPayouts?.count || 0}</div></div>
    <div class="card"><div class="card-title">Pending Prize Value</div><div class="card-value text-danger">${Number(summary.agentPendingPayouts?.total || 0).toLocaleString()} pts</div></div>
    <div class="card"><div class="card-title">Total Deposits</div><div class="card-value text-success">${Number(summary.agentDeposits || 0).toLocaleString()} pts</div></div>
    <div class="card"><div class="card-title">Total Prizes Paid</div><div class="card-value">${Number(summary.agentPrizes || 0).toLocaleString()} pts</div></div>
  `

  // Transactions — use shared renderer (defaults to today on first load)
  await refreshTxnTable()
  await loadTodaySummary()
}

function txnBadge(type) {
  if (type === 'deposit')          return 'badge-success'
  if (type === 'prize' || type === 'prize_win') return 'badge-warning'
  if (type === 'withdrawal')       return 'badge-danger'
  if (type === 'commission')       return 'badge-purple'
  if (type === 'ticket_purchase')  return 'badge-info'
  return 'badge-info'
}

// ── Period tabs (Today / All Time) ───────────────────────────────────────
document.getElementById('txn-period-tabs').addEventListener('click', async (e) => {
  const tab = e.target.closest('.period-tab')
  if (!tab) return
  document.querySelectorAll('#txn-period-tabs .period-tab').forEach(t => t.classList.remove('active'))
  tab.classList.add('active')
  _txnPeriod = tab.dataset.period
  await refreshTxnTable()
  if (_txnPeriod === 'today') {
    await loadTodaySummary()
  } else {
    document.getElementById('today-summary').style.display = 'none'
  }
})

// ── Type filter ───────────────────────────────────────────────────────────
document.getElementById('txn-type-filter').addEventListener('change', async function() {
  await refreshTxnTable()
})


// ══════════════════════════════════════════════════════════════════════════
// SYSTEM TICKETS (password-locked)
// ══════════════════════════════════════════════════════════════════════════

const SYS_PASS = 'Tadj55'

function openSysLock() {
  document.getElementById('sys-lock-password').value = ''
  document.getElementById('sys-lock-error').classList.add('hidden')
  document.getElementById('sys-lock-modal').classList.add('open')
  setTimeout(() => document.getElementById('sys-lock-password').focus(), 120)
}

document.getElementById('sys-lock-form').addEventListener('submit', e => {
  e.preventDefault()
  const val = document.getElementById('sys-lock-password').value
  if (val !== SYS_PASS) {
    const err = document.getElementById('sys-lock-error')
    err.textContent = 'Incorrect password'
    err.classList.remove('hidden')
    document.getElementById('sys-lock-password').value = ''
    return
  }
  document.getElementById('sys-lock-modal').classList.remove('open')
  openSysTickets()
})

async function openSysTickets() {
  document.getElementById('sys-tickets-modal').classList.add('open')
  sysShowTab('allocate')
  await Promise.all([loadSysDrawSelector(), loadSysTickets()])
}

function sysShowTab(tab) {
  const isAllocate = tab === 'allocate'
  document.getElementById('sys-panel-allocate').style.display = isAllocate ? '' : 'none'
  document.getElementById('sys-panel-givewin').style.display  = isAllocate ? 'none' : ''
  document.getElementById('sys-tab-allocate').style.borderBottomColor = isAllocate ? 'var(--primary)' : 'transparent'
  document.getElementById('sys-tab-allocate').style.color = isAllocate ? 'var(--text)' : 'var(--muted)'
  document.getElementById('sys-tab-givewin').style.borderBottomColor  = isAllocate ? 'transparent' : 'var(--primary)'
  document.getElementById('sys-tab-givewin').style.color  = isAllocate ? 'var(--muted)' : 'var(--text)'
}

// Typing exactly "00" activates the Give Win tab; anything else stays on Allocate
document.getElementById('sys-ticket-count').addEventListener('input', function () {
  if (this.value === '00') {
    sysShowTab('givewin')
  } else {
    sysShowTab('allocate')
  }
})

async function loadSysDrawSelector() {
  const draws = await GET('/api/system-tickets/draws')
  if (!draws) return
  const statusLabel = s => s === 'running' ? ' ● LIVE' : ''
  const options = draws.length
    ? draws.map(d => `<option value="${d.id}" data-label="${d.title} (${d.draw_date})">${d.title} — ${d.draw_time}${statusLabel(d.status)}</option>`).join('')
    : '<option value="">— no active draws today —</option>'
  document.getElementById('sys-draw-select').innerHTML = options
  document.getElementById('gw-draw-select').innerHTML  = options
}

async function loadSysTickets() {
  const data = await GET('/api/system-tickets')
  if (!data) return

  // Summary
  const s = data.summary || {}
  document.getElementById('sys-summary').innerHTML = `
    <div class="card"><div class="card-title">Total Entries</div><div class="card-value">${s.total_entries ?? 0}</div></div>
    <div class="card"><div class="card-title">Total Tickets</div><div class="card-value">${Number(s.total_tickets ?? 0).toLocaleString()}</div></div>
    <div class="card"><div class="card-title">Total Wins</div><div class="card-value text-success">${Number(s.total_wins ?? 0).toLocaleString()} pts</div></div>
  `

  // Table
  const tbody = document.getElementById('sys-tickets-tbody')
  if (!data.entries.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No entries yet — use the form above to add tickets to a draw</td></tr>'
    return
  }
  tbody.innerHTML = data.entries.map(e => `
    <tr id="sys-row-${e.id}">
      <td>#${e.id}</td>
      <td><strong>${e.draw_label}</strong>${e.draw_date ? `<br><span style="font-size:11px;color:var(--muted)">${e.draw_date} ${e.draw_time ?? ''}</span>` : ''}</td>
      <td>
        <input type="number" value="${e.ticket_count}" min="1"
          style="width:80px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;font-size:13px"
          onchange="updateSysTicket(${e.id},{ticket_count:+this.value})" />
      </td>
      <td>
        <input type="number" value="${e.win_amount}" min="0"
          style="width:100px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;font-size:13px"
          onchange="updateSysTicket(${e.id},{win_amount:+this.value})" />
      </td>
      <td style="max-width:180px">
        ${e.win_amount > 0 ? `
          <input type="text" value="${e.winning_ticket_ids ?? ''}" placeholder="e.g. 45, 102"
            style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;font-size:12px"
            onchange="updateSysTicket(${e.id},{winning_ticket_ids:this.value})" />
        ` : '<span style="color:var(--muted);font-size:12px">—</span>'}
      </td>
      <td style="max-width:160px">
        <input type="text" value="${e.notes ?? ''}" placeholder="—"
          style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 8px;font-size:12px"
          onchange="updateSysTicket(${e.id},{notes:this.value})" />
      </td>
      <td style="font-size:11px;color:var(--muted)">${(e.created_at || '').slice(0,16).replace('T',' ')}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteSysTicket(${e.id})">Delete</button>
      </td>
    </tr>`).join('')
}

document.getElementById('sys-add-btn').addEventListener('click', async () => {
  const errEl       = document.getElementById('sys-add-error')
  errEl.classList.add('hidden')
  const sel         = document.getElementById('sys-draw-select')
  const drawId      = sel.value ? Number(sel.value) : null
  const drawLabel   = sel.options[sel.selectedIndex]?.dataset?.label || sel.options[sel.selectedIndex]?.text || 'Unknown Draw'
  const ticketCount = Number(document.getElementById('sys-ticket-count').value) || 0
  const winAmount      = Number(document.getElementById('sys-win-amount').value)   || 0
  const winningIds     = document.getElementById('sys-winning-ids').value.trim()
  const notes          = document.getElementById('sys-notes').value.trim()

  if (ticketCount < 1) { errEl.textContent = 'Enter at least 1 ticket'; errEl.classList.remove('hidden'); return }

  const btn = document.getElementById('sys-add-btn')
  btn.disabled = true
  const res = await POST('/api/system-tickets', { draw_id: drawId, draw_label: drawLabel, ticket_count: ticketCount, win_amount: winAmount, winning_ticket_ids: winningIds || null, notes: notes || null })
  btn.disabled = false

  if (res?.error) { errEl.textContent = res.error; errEl.classList.remove('hidden'); return }

  document.getElementById('sys-ticket-count').value = 0
  document.getElementById('sys-win-amount').value   = 0
  document.getElementById('sys-winning-ids').value  = ''
  document.getElementById('sys-notes').value        = ''
  toast(`${ticketCount} system tickets added to draw`)
  loadSysTickets()
})

document.getElementById('gw-submit-btn').addEventListener('click', async () => {
  const errEl  = document.getElementById('sys-givewin-error')
  const okEl   = document.getElementById('sys-givewin-success')
  errEl.classList.add('hidden')
  okEl.classList.add('hidden')

  const drawId   = document.getElementById('gw-draw-select').value
  const cardCode = document.getElementById('gw-card-code').value.trim()

  if (!drawId)   { errEl.textContent = 'Select a draw first'; errEl.classList.remove('hidden'); return }
  if (!cardCode) { errEl.textContent = 'Enter a card code';   errEl.classList.remove('hidden'); return }

  const btn = document.getElementById('gw-submit-btn')
  btn.disabled = true
  btn.textContent = 'Awarding…'

  const res = await POST('/api/system-tickets/give-win', {
    draw_id:   Number(drawId),
    card_code: cardCode,
    win_type:  'bingo',
  })

  btn.disabled = false
  btn.textContent = '🏆 Award Win'

  if (res?.error) {
    errEl.textContent = res.error
    errEl.classList.remove('hidden')
    return
  }

  document.getElementById('gw-card-code').value = ''
  okEl.textContent = `✅ Full House awarded to ticket #${res.ticket_id} (card ${res.card_code}). Win ceremony fired to all players.`
  okEl.classList.remove('hidden')
  toast(`Full House win awarded — card ${res.card_code}`)
})

async function updateSysTicket(id, fields) {
  const res = await PUT(`/api/system-tickets/${id}`, fields)
  if (res?.error) { toast(res.error, 'error'); return }
  // Reload summary only
  const data = await GET('/api/system-tickets')
  if (!data) return
  const s = data.summary || {}
  document.getElementById('sys-summary').innerHTML = `
    <div class="card"><div class="card-title">Total Entries</div><div class="card-value">${s.total_entries ?? 0}</div></div>
    <div class="card"><div class="card-title">Total Tickets</div><div class="card-value">${Number(s.total_tickets ?? 0).toLocaleString()}</div></div>
    <div class="card"><div class="card-title">Total Wins</div><div class="card-value text-success">${Number(s.total_wins ?? 0).toLocaleString()} pts</div></div>
  `
}

async function deleteSysTicket(id) {
  if (!confirm('Delete this system ticket entry?')) return
  await DELETE(`/api/system-tickets/${id}`)
  toast('Entry deleted')
  loadSysTickets()
}

// ══════════════════════════════════════════════════════════════════════════
// AGENT FAMILY MODAL
// ══════════════════════════════════════════════════════════════════════════

document.getElementById('family-modal-close').addEventListener('click', () =>
  document.getElementById('family-modal').classList.remove('open'))

async function openFamilyModal(agentId, agentName) {
  document.getElementById('family-modal-title').textContent = `👨‍👩‍👧 ${agentName} — Family Activity`
  document.getElementById('family-summary-stats').innerHTML = '<p style="color:var(--muted)">Loading…</p>'
  document.getElementById('family-txn-list').innerHTML = ''
  document.getElementById('family-modal').classList.add('open')

  const data = await GET(`/api/agents/${agentId}/family-transactions`)
  if (!data) return

  const s = data.summary
  document.getElementById('family-summary-stats').innerHTML = `
    <div class="card"><div class="card-title">Family Size</div><div class="card-value">${s.family_size ?? 0}</div></div>
    <div class="card"><div class="card-title">Points Sent Down</div><div class="card-value text-success">${Number(s.points_sent ?? 0).toLocaleString()}</div></div>
    <div class="card"><div class="card-title">Points Sold Back</div><div class="card-value text-warning">${Number(s.points_sold_back ?? 0).toLocaleString()}</div></div>
    <div class="card"><div class="card-title">Ticket Spend</div><div class="card-value">${Number(s.ticket_spend ?? 0).toLocaleString()}</div></div>
    <div class="card"><div class="card-title">Win Payouts</div><div class="card-value text-success">${Number(s.wins ?? 0).toLocaleString()}</div></div>
  `

  const txnList = document.getElementById('family-txn-list')
  if (!data.transactions.length) {
    txnList.innerHTML = '<p style="color:var(--muted);padding:16px 0">No transactions yet in this family.</p>'
    return
  }

  const TYPE_ICONS = {
    points_allocated: '📤', points_received: '📥', points_sold: '↩️',
    points_bought: '↪️', ticket_purchase: '🎟️', prize: '🏆',
    deposit: '💵', withdraw: '💸',
  }
  txnList.innerHTML = data.transactions.map(t => {
    const isPos = t.amount > 0
    const icon  = TYPE_ICONS[t.type] || (isPos ? '📥' : '📤')
    const color = isPos ? 'var(--success)' : 'var(--danger)'
    return `
      <div style="display:flex;align-items:center;gap:10px;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px">
        <span style="font-size:18px;flex-shrink:0">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${t.user_name} <span style="color:var(--muted);font-weight:400">(${t.user_role})</span></div>
          <div style="font-size:11px;color:var(--muted)">${t.description || t.type} · ${(t.created_at || '').slice(0,16).replace('T',' ')}</div>
        </div>
        <div style="font-weight:700;font-size:14px;color:${color};flex-shrink:0">${isPos ? '+' : ''}${Number(t.amount).toLocaleString()} pts</div>
      </div>`
  }).join('')
}

// ══════════════════════════════════════════════════════════════════════════
// SPECIAL DRAWS PANEL
// ══════════════════════════════════════════════════════════════════════════

async function loadSpecialDraws() {
  const list = document.getElementById('special-draws-list')
  list.innerHTML = '<p style="color:var(--muted);padding:20px">Loading…</p>'
  const draws = await GET('/api/special-draws')
  if (!draws) return

  if (!draws.length) {
    list.innerHTML = '<p style="color:var(--muted);padding:20px">No special draws yet. Click "+ New Special Draw" to create one.</p>'
    return
  }

  list.innerHTML = draws.map(d => {
    const statusColor = d.status === 'scheduled' ? 'badge-success'
                      : d.status === 'running'   ? 'badge-warning'
                      : 'badge-info'
    return `
      <div class="card" style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-weight:700;font-size:15px;margin-bottom:4px">${d.title}</div>
            ${d.description ? `<div style="font-size:12px;color:var(--muted)">${d.description}</div>` : ''}
          </div>
          <span class="badge ${statusColor}" style="flex-shrink:0">${d.status}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">
          <div style="color:var(--muted)">📅 ${d.draw_date} ${d.draw_time}</div>
          <div style="color:var(--muted)">🎟️ ${d.ticket_price} pts/ticket</div>
          <div style="color:var(--warning)">🏆 Full house: ${Number(d.full_house_prize).toLocaleString()} pts</div>
          <div style="color:var(--accent)">➡️ Line: ${Number(d.line_prize).toLocaleString()} pts</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="btn btn-ghost btn-sm" onclick="openSpecialEditModal(${JSON.stringify(d).replace(/"/g,'&quot;')})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteSpecialDraw(${d.id})">Delete</button>
        </div>
      </div>`
  }).join('')
}

// ── Open modal for new draw ───────────────────────────────────────────────
document.getElementById('add-special-btn').addEventListener('click', () => {
  document.getElementById('special-edit-id').value = ''
  document.getElementById('special-modal-title').textContent = 'New Special Draw'
  document.getElementById('sp-title').value         = ''
  document.getElementById('sp-desc').value          = ''
  document.getElementById('sp-date').value          = new Date().toISOString().slice(0,10)
  document.getElementById('sp-time').value          = '20:00'
  document.getElementById('sp-ticket-price').value  = 10
  document.getElementById('sp-ball-interval').value = 5
  document.getElementById('sp-fh-prize').value      = 5000
  document.getElementById('sp-line-prize').value    = 500
  document.getElementById('sp-status').value        = 'scheduled'
  document.getElementById('sp-announcer').value     = ''
  document.getElementById('special-modal').classList.add('open')
})

// ── Open modal for editing ────────────────────────────────────────────────
function openSpecialEditModal(d) {
  document.getElementById('special-edit-id').value       = d.id
  document.getElementById('special-modal-title').textContent = 'Edit Special Draw'
  document.getElementById('sp-title').value              = d.title
  document.getElementById('sp-desc').value               = d.description || ''
  document.getElementById('sp-date').value               = d.draw_date
  document.getElementById('sp-time').value               = d.draw_time
  document.getElementById('sp-ticket-price').value       = d.ticket_price
  document.getElementById('sp-ball-interval').value      = d.ball_interval
  document.getElementById('sp-fh-prize').value           = d.full_house_prize
  document.getElementById('sp-line-prize').value         = d.line_prize
  document.getElementById('sp-status').value             = d.status
  document.getElementById('sp-announcer').value          = d.announcer ?? ''
  document.getElementById('special-modal').classList.add('open')
}

document.getElementById('special-modal-cancel').addEventListener('click', () =>
  document.getElementById('special-modal').classList.remove('open'))

// ── Save ──────────────────────────────────────────────────────────────────
document.getElementById('special-modal-save').addEventListener('click', async () => {
  const editId = document.getElementById('special-edit-id').value
  const title  = document.getElementById('sp-title').value.trim()
  if (!title) { toast('Title is required', 'error'); return }

  const body = {
    title,
    description:      document.getElementById('sp-desc').value.trim() || null,
    draw_date:        document.getElementById('sp-date').value,
    draw_time:        document.getElementById('sp-time').value,
    ticket_price:     Number(document.getElementById('sp-ticket-price').value),
    ball_interval:    Number(document.getElementById('sp-ball-interval').value),
    full_house_prize: Number(document.getElementById('sp-fh-prize').value),
    line_prize:       Number(document.getElementById('sp-line-prize').value),
    status:           document.getElementById('sp-status').value,
    announcer:        document.getElementById('sp-announcer').value || null,
  }

  const res = editId
    ? await PUT(`/api/special-draws/${editId}`, body)
    : await POST('/api/special-draws', body)

  if (res?.error) { toast(res.error, 'error'); return }
  document.getElementById('special-modal').classList.remove('open')
  toast(editId ? 'Draw updated' : 'Special draw created!')
  loadSpecialDraws()
})

// ── Delete ────────────────────────────────────────────────────────────────
async function deleteSpecialDraw(id) {
  if (!confirm('Delete this special draw? This cannot be undone.')) return
  await DELETE(`/api/special-draws/${id}`)
  toast('Draw deleted')
  loadSpecialDraws()
}

// Payout modal (deposit / withdraw)
async function openPayoutModal(type) {
  const users = await GET('/api/users?limit=500')
  document.getElementById('pm-user').innerHTML = (users || []).map(u => `<option value="${u.id}">${u.name} — ${Math.round(u.balance||0)} Pts</option>`).join('')
  document.getElementById('payout-type').value = type
  document.getElementById('payout-modal-title').textContent = type === 'deposit' ? 'Deposit Funds' : 'Withdraw Funds'
  document.getElementById('pm-amount').value = ''
  document.getElementById('pm-desc').value = ''
  document.getElementById('payout-modal').classList.add('open')
}

document.getElementById('deposit-btn').addEventListener('click',  () => openPayoutModal('deposit'))
document.getElementById('withdraw-btn').addEventListener('click', () => openPayoutModal('withdraw'))
document.getElementById('payout-modal-cancel').addEventListener('click', () => document.getElementById('payout-modal').classList.remove('open'))

document.getElementById('payout-modal-save').addEventListener('click', async () => {
  const type    = document.getElementById('payout-type').value
  const user_id = Number(document.getElementById('pm-user').value)
  const amount  = Number(document.getElementById('pm-amount').value)
  const description = document.getElementById('pm-desc').value.trim()
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return }
  const endpoint = type === 'deposit' ? '/api/payouts/deposit' : '/api/payouts/withdraw'
  const res = await POST(endpoint, { user_id, amount, description })
  if (res?.ok) {
    document.getElementById('payout-modal').classList.remove('open')
    toast(`${type === 'deposit' ? 'Deposit' : 'Withdrawal'} successful`)
    loadPayouts()
  } else {
    toast(res?.error || 'Failed', 'error')
  }
})

// Prize payout modal
document.getElementById('pay-prize-btn').addEventListener('click', () => {
  document.getElementById('prize-ticket-id').value = ''
  document.getElementById('prize-modal').classList.add('open')
})
document.getElementById('prize-modal-cancel').addEventListener('click', () => document.getElementById('prize-modal').classList.remove('open'))
document.getElementById('prize-modal-save').addEventListener('click', async () => {
  const ticket_id = Number(document.getElementById('prize-ticket-id').value)
  if (!ticket_id) { toast('Enter a ticket ID', 'error'); return }
  const res = await POST('/api/payouts/prize', { ticket_id })
  if (res?.ok) {
    document.getElementById('prize-modal').classList.remove('open')
    toast('Prize paid out successfully')
    loadPayouts()
  } else {
    toast(res?.error || 'Failed', 'error')
  }
})

// ── Boot ──────────────────────────────────────────────────────────────────
if (TOKEN) {
  showApp()
} else {
  document.getElementById('login-screen').style.display = 'flex'
}
