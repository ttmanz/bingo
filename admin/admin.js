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
        <td>${a.phone || '—'}</td>
        <td>${Number(a.commission_rate).toFixed(1)}%</td>
        <td>${a.child_agent_count || 0}</td>
        <td>${a.player_count || 0}</td>
        <td>${a.parent_name ? `${a.parent_name} <span class="text-muted">(${a.parent_type})</span>` : '—'}</td>
        <td><span class="badge ${a.status === 'active' ? 'badge-success' : 'badge-danger'}">${a.status}</span></td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-sm btn-ghost" onclick='openAgentEditModal(${JSON.stringify(a).replace(/"/g,"&quot;")})'>Edit</button>
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
  document.getElementById('am-user-row').style.display = 'flex'

  // Default to 'agent' type
  document.querySelectorAll('.agent-type-card').forEach(c => c.classList.remove('selected'))
  document.querySelector('.agent-type-card[data-type="agent"]').classList.add('selected')
  document.getElementById('am-type').value = 'agent'

  // Load users (non-agents only)
  const users = await GET('/api/users?limit=500') || []
  const agentUserIds = new Set((await GET('/api/agents') || []).map(a => a.user_id))
  const eligible = users.filter(u => !agentUserIds.has(u.id))
  document.getElementById('am-user').innerHTML = eligible.length
    ? eligible.map(u => `<option value="${u.id}">${u.name} · ${u.phone || u.email || '#'+u.id}</option>`).join('')
    : '<option value="">No eligible users — add a user first</option>'

  await updateParentSelector('agent')
  document.getElementById('agent-modal').classList.add('open')
})

async function openAgentEditModal(agent) {
  document.getElementById('agent-edit-id').value = agent.id
  document.getElementById('agent-modal-title').textContent = 'Edit Agent'
  document.getElementById('am-commission').value = agent.commission_rate
  document.getElementById('am-status').value     = agent.status
  document.getElementById('am-user-row').style.display = 'none'
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
    const userId = Number(document.getElementById('am-user').value)
    if (!userId) { toast('Select a user', 'error'); return }
    res = await POST('/api/agents', { ...body, user_id: userId })
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
