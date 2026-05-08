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
  draws: 'Daily Draws', tickets: 'Winning Tickets', jackpot: 'Jackpot',
  users: 'Users', agents: 'Agents', payouts: 'Payouts & Accounts',
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
  document.getElementById(`panel-${name}`)?.classList.add('active')
  document.querySelector(`[data-panel="${name}"]`)?.classList.add('active')
  document.getElementById('panel-title').textContent = PANEL_TITLES[name]
  loadPanel(name)
}

async function loadPanel(name) {
  if (name === 'draws')   loadDraws()
  if (name === 'tickets') loadTickets()
  if (name === 'jackpot') loadJackpot()
  if (name === 'users')   loadUsers()
  if (name === 'agents')  loadAgents()
  if (name === 'payouts') loadPayouts()
}

// ── Login / Logout ────────────────────────────────────────────────────────
document.getElementById('login-btn').addEventListener('click', async () => {
  const username = document.getElementById('login-user').value.trim()
  const password = document.getElementById('login-pass').value
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

function showApp() {
  document.getElementById('login-screen').style.display = 'none'
  document.getElementById('app').style.display = 'flex'
  document.getElementById('admin-name').textContent = ADMIN_NAME
  showPanel('draws')
}

// Sidebar navigation
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => showPanel(item.dataset.panel))
})

// ══════════════════════════════════════════════════════════════════════════
// DRAWS PANEL
// ══════════════════════════════════════════════════════════════════════════
async function loadDraws() {
  const data = await GET('/api/schedule')
  if (!data) return
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
            <span>Ball (s)</span><span>Ticket £</span><span>Full House £</span><span>Line £</span><span>Actions</span>
          </div>
          ${day.draws.map(d => `
            <div class="draw-row">
              <span>${d.draw_time}</span>
              <span>${d.draw_number}</span>
              <span>${d.title}</span>
              <span>${d.ball_interval}s</span>
              <span>£${Number(d.ticket_price).toFixed(2)}</span>
              <span>£${Number(d.full_house_prize).toFixed(2)}</span>
              <span>£${Number(d.line_prize).toFixed(2)}</span>
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
  document.getElementById('dm-day').value          = draw?.day_of_week ?? day
  document.getElementById('dm-number').value       = draw?.draw_number ?? 1
  document.getElementById('dm-time').value         = draw?.draw_time ?? '19:00'
  document.getElementById('dm-interval').value     = draw?.ball_interval ?? 5
  document.getElementById('dm-title').value        = draw?.title ?? ''
  document.getElementById('dm-ticket-price').value = draw?.ticket_price ?? 1
  document.getElementById('dm-fh-prize').value     = draw?.full_house_prize ?? 100
  document.getElementById('dm-line-prize').value   = draw?.line_prize ?? 10
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

async function deleteDraw(id) {
  if (!confirm('Delete this draw?')) return
  await DELETE(`/api/schedule/${id}`)
  toast('Draw deleted')
  loadDraws()
}

document.getElementById('add-draw-btn').addEventListener('click', () => openDrawModal(0))

// ══════════════════════════════════════════════════════════════════════════
// TICKETS PANEL
// ══════════════════════════════════════════════════════════════════════════
async function loadTickets() {
  const status  = document.getElementById('ticket-filter').value
  const paidOut = document.getElementById('ticket-paid-filter').value
  let url = '/api/tickets/winning'
  const params = new URLSearchParams()
  if (status)  params.set('status',  status)
  if (paidOut !== '') params.set('paid_out', paidOut)
  if ([...params].length) url += '?' + params

  const data = await GET(url)
  if (!data) return
  const tbody = document.getElementById('tickets-tbody')
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">No winning tickets found</td></tr>'; return }
  tbody.innerHTML = data.map(t => `
    <tr>
      <td>#${t.id}</td>
      <td>${t.draw_title}</td>
      <td>${t.draw_date}</td>
      <td>${t.user_name}<br><span class="text-muted">${t.user_phone || ''}</span></td>
      <td><span class="badge ${statusBadge(t.status)}">${t.status}</span></td>
      <td class="text-warning">£${Number(t.prize_amount).toFixed(2)}</td>
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
  document.getElementById('jackpot-display').textContent = `£${Number(data.amount).toFixed(2)}`
  document.getElementById('jackpot-status-label').textContent = data.enabled ? 'Jackpot Active' : 'Jackpot Disabled'
  document.getElementById('jackpot-status-label').style.color = data.enabled ? 'var(--success)' : 'var(--muted)'
}

document.getElementById('jackpot-enabled').addEventListener('change', function() {
  document.getElementById('jackpot-status-label').textContent = this.checked ? 'Jackpot Active' : 'Jackpot Disabled'
  document.getElementById('jackpot-status-label').style.color = this.checked ? 'var(--success)' : 'var(--muted)'
})

document.getElementById('jackpot-amount').addEventListener('input', function() {
  document.getElementById('jackpot-display').textContent = `£${Number(this.value || 0).toFixed(2)}`
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
      <td>£${Number(u.balance || 0).toFixed(2)}</td>
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
async function loadAgents() {
  const data = await GET('/api/agents')
  if (!data) return
  const tbody = document.getElementById('agents-tbody')
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">No agents found</td></tr>'; return }
  tbody.innerHTML = data.map(a => `
    <tr>
      <td>#${a.id}</td>
      <td><strong>${a.name}</strong></td>
      <td>${a.phone || '—'}</td>
      <td>${Number(a.commission_rate).toFixed(1)}%</td>
      <td>${a.player_count}</td>
      <td>£${Number(a.total_sales || 0).toFixed(2)}</td>
      <td>£${Number(a.total_commission || 0).toFixed(2)}</td>
      <td>${a.parent_name || '—'}</td>
      <td><span class="badge ${a.status === 'active' ? 'badge-success' : 'badge-danger'}">${a.status}</span></td>
      <td style="display:flex;gap:4px">
        <button class="btn btn-sm btn-ghost" onclick="openAgentEditModal(${JSON.stringify(a).replace(/"/g,'&quot;')})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteAgent(${a.id})">Remove</button>
      </td>
    </tr>
  `).join('')
}

document.getElementById('add-agent-btn').addEventListener('click', async () => {
  const [users, agents] = await Promise.all([GET('/api/users?role=player&limit=200'), GET('/api/agents')])
  const userSel  = document.getElementById('am-user')
  const parentSel = document.getElementById('am-parent')
  userSel.innerHTML  = (users || []).map(u => `<option value="${u.id}">${u.name} (${u.phone || u.email || '#'+u.id})</option>`).join('')
  parentSel.innerHTML = '<option value="">None</option>' + (agents || []).map(a => `<option value="${a.id}">${a.name}</option>`).join('')
  document.getElementById('am-commission').value = 5
  document.getElementById('am-status').value = 'active'
  document.getElementById('agent-modal-title').textContent = 'Add Agent'
  document.getElementById('agent-edit-id').value = ''
  document.getElementById('agent-modal').classList.add('open')
})

async function openAgentEditModal(agent) {
  const agents = await GET('/api/agents')
  const parentSel = document.getElementById('am-parent')
  parentSel.innerHTML = '<option value="">None</option>' + (agents || []).filter(a => a.id !== agent.id).map(a => `<option value="${a.id}" ${a.id === agent.parent_agent_id ? 'selected' : ''}>${a.name}</option>`).join('')
  document.getElementById('am-commission').value = agent.commission_rate
  document.getElementById('am-status').value     = agent.status
  document.getElementById('agent-edit-id').value = agent.id
  document.getElementById('am-user').innerHTML   = `<option value="${agent.user_id}">${agent.name}</option>`
  document.getElementById('agent-modal-title').textContent = 'Edit Agent'
  document.getElementById('agent-modal').classList.add('open')
}

document.getElementById('agent-modal-cancel').addEventListener('click', () => document.getElementById('agent-modal').classList.remove('open'))

document.getElementById('agent-modal-save').addEventListener('click', async () => {
  const editId = document.getElementById('agent-edit-id').value
  if (editId) {
    await PUT(`/api/agents/${editId}`, {
      commission_rate:  Number(document.getElementById('am-commission').value),
      parent_agent_id:  document.getElementById('am-parent').value || null,
      status:           document.getElementById('am-status').value,
    })
    toast('Agent updated')
  } else {
    await POST('/api/agents', {
      user_id:         Number(document.getElementById('am-user').value),
      commission_rate: Number(document.getElementById('am-commission').value),
      parent_agent_id: document.getElementById('am-parent').value || null,
    })
    toast('Agent added')
  }
  document.getElementById('agent-modal').classList.remove('open')
  loadAgents()
})

async function deleteAgent(id) {
  if (!confirm('Remove this agent? Their user account will remain.')) return
  await DELETE(`/api/agents/${id}`)
  toast('Agent removed')
  loadAgents()
}

// ══════════════════════════════════════════════════════════════════════════
// PAYOUTS PANEL
// ══════════════════════════════════════════════════════════════════════════
async function loadPayouts() {
  const [summary, txns] = await Promise.all([
    GET('/api/payouts/summary'),
    GET('/api/payouts?limit=100'),
  ])
  if (!summary || !txns) return

  // Stats
  const statsEl = document.getElementById('payout-stats')
  const totalsMap = {}
  ;(summary.totals || []).forEach(t => totalsMap[t.type] = t)
  statsEl.innerHTML = `
    <div class="card"><div class="card-title">Total User Balances</div><div class="card-value">£${Number(summary.userBalance || 0).toFixed(2)}</div></div>
    <div class="card"><div class="card-title">Pending Payouts</div><div class="card-value text-warning">${summary.pendingPayouts?.count || 0}</div></div>
    <div class="card"><div class="card-title">Pending Prize Value</div><div class="card-value text-danger">£${Number(summary.pendingPayouts?.total || 0).toFixed(2)}</div></div>
    <div class="card"><div class="card-title">Total Deposits</div><div class="card-value text-success">£${Number(totalsMap.deposit?.total || 0).toFixed(2)}</div></div>
    <div class="card"><div class="card-title">Total Prizes Paid</div><div class="card-value">£${Number(totalsMap.prize_win?.total || 0).toFixed(2)}</div></div>
  `

  // Transactions
  const tbody = document.getElementById('txn-tbody')
  if (!txns.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No transactions yet</td></tr>'; return }
  tbody.innerHTML = txns.map(t => `
    <tr>
      <td>#${t.id}</td>
      <td>${t.user_name}</td>
      <td><span class="badge ${txnBadge(t.type)}">${t.type}</span></td>
      <td class="${t.amount >= 0 ? 'text-success' : 'text-danger'}">£${Math.abs(t.amount).toFixed(2)}</td>
      <td>£${Number(t.balance_after).toFixed(2)}</td>
      <td class="text-muted">${t.description || '—'}</td>
      <td class="text-muted" style="font-size:.78rem">${t.created_at?.slice(0,16).replace('T',' ') || ''}</td>
    </tr>
  `).join('')
}

function txnBadge(type) {
  if (type === 'deposit')          return 'badge-success'
  if (type === 'prize_win')        return 'badge-warning'
  if (type === 'withdrawal')       return 'badge-danger'
  if (type === 'commission')       return 'badge-purple'
  if (type === 'ticket_purchase')  return 'badge-info'
  return 'badge-info'
}

document.getElementById('txn-type-filter').addEventListener('change', async function() {
  const params = this.value ? `?type=${this.value}` : ''
  const txns = await GET('/api/payouts' + params)
  if (!txns) return
  const tbody = document.getElementById('txn-tbody')
  if (!txns.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No transactions</td></tr>'; return }
  tbody.innerHTML = txns.map(t => `
    <tr>
      <td>#${t.id}</td><td>${t.user_name}</td>
      <td><span class="badge ${txnBadge(t.type)}">${t.type}</span></td>
      <td class="${t.amount >= 0 ? 'text-success' : 'text-danger'}">£${Math.abs(t.amount).toFixed(2)}</td>
      <td>£${Number(t.balance_after).toFixed(2)}</td>
      <td class="text-muted">${t.description || '—'}</td>
      <td class="text-muted" style="font-size:.78rem">${t.created_at?.slice(0,16).replace('T',' ') || ''}</td>
    </tr>
  `).join('')
})

// Payout modal (deposit / withdraw)
async function openPayoutModal(type) {
  const users = await GET('/api/users?limit=500')
  document.getElementById('pm-user').innerHTML = (users || []).map(u => `<option value="${u.id}">${u.name} — £${Number(u.balance||0).toFixed(2)}</option>`).join('')
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
