/* ── State ────────────────────────────────────────────────────────────── */
const API = ''
let TOKEN     = localStorage.getItem('agentToken') || null
let agentInfo = null   // from /api/agent-portal/me
let downline  = null   // from /api/agent-portal/downline

/* ── Helpers ──────────────────────────────────────────────────────────── */
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

function show(el)  { el.classList.remove('hidden') }
function hide(el)  { el.classList.add('hidden') }
function showAlert(el, msg) { el.textContent = msg; show(el) }
function hideAlert(el) { hide(el) }

function fmtDate(str) {
  if (!str) return '–'
  const d = new Date(str)
  return d.toLocaleString()
}

const TYPE_META = {
  super_agent:  { label: 'Super Agent',  badgeClass: 'badge-super',  avatarClass: 'av-super',  icon: '👑' },
  master_agent: { label: 'Master Agent', badgeClass: 'badge-master', avatarClass: 'av-master', icon: '⭐' },
  agent:        { label: 'Agent',        badgeClass: 'badge-agent',  avatarClass: 'av-agent',  icon: '🤝' },
}

function agentMeta(type) {
  return TYPE_META[type] || { label: type, badgeClass: '', avatarClass: 'av-agent', icon: '👤' }
}

/* ── Screen helpers ───────────────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

/* ── Login ────────────────────────────────────────────────────────────── */
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault()
  const btn = document.getElementById('loginBtn')
  const errEl = document.getElementById('loginError')
  hideAlert(errEl)
  btn.disabled = true
  btn.textContent = 'Signing in…'
  try {
    const email    = document.getElementById('loginEmail').value.trim()
    const password = document.getElementById('loginPassword').value
    const data = await apiFetch('/api/agent-auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    TOKEN = data.token
    localStorage.setItem('agentToken', TOKEN)
    await loadDashboard()
  } catch (err) {
    showAlert(errEl, err.message)
    btn.disabled = false
    btn.textContent = 'Sign In'
  }
})

/* ── Logout ───────────────────────────────────────────────────────────── */
document.getElementById('logoutBtn').addEventListener('click', () => {
  TOKEN = null
  localStorage.removeItem('agentToken')
  agentInfo = null
  downline  = null
  showScreen('loginScreen')
})

/* ── Tab navigation ───────────────────────────────────────────────────── */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    const panel = document.getElementById('tab-' + btn.dataset.tab)
    if (panel) panel.classList.add('active')
    // lazy load tab data
    if (btn.dataset.tab === 'downline')    loadDownline()
    if (btn.dataset.tab === 'allocate')    loadAllocateTab()
    if (btn.dataset.tab === 'transactions') loadTransactions()
  })
})

/* ── Load dashboard ───────────────────────────────────────────────────── */
async function loadDashboard() {
  agentInfo = await apiFetch('/api/agent-portal/me')
  renderTopbar()
  renderOverview()
  configureCreateTab()
  showScreen('dashboard')
}

function renderTopbar() {
  const meta = agentMeta(agentInfo.agent_type)
  const badge = document.getElementById('agentTypeBadge')
  badge.textContent = meta.label
  badge.className   = `type-badge ${meta.badgeClass}`

  document.getElementById('agentName').textContent = agentInfo.name
  document.getElementById('myPoints').textContent  = (agentInfo.points ?? 0).toLocaleString()
}

function renderOverview() {
  const ai = agentInfo
  const meta = agentMeta(ai.agent_type)

  document.getElementById('statPoints').textContent    = (ai.points ?? 0).toLocaleString()
  document.getElementById('statSubCount').textContent  = ai.sub_agent_count ?? 0
  document.getElementById('statPlayerCount').textContent = ai.player_count ?? 0
  document.getElementById('statCommission').textContent  = ai.commission_rate ?? 0
  document.getElementById('statSubIcon').textContent   = meta.icon

  if (ai.agent_type === 'agent') {
    document.getElementById('statSubLabel').textContent = 'Sub-Agents'
  } else {
    document.getElementById('statSubLabel').textContent = 'Sub-Agents'
  }

  document.getElementById('profName').textContent   = ai.name
  document.getElementById('profEmail').textContent  = ai.email || '–'
  document.getElementById('profPhone').textContent  = ai.phone || '–'
  document.getElementById('profType').textContent   = meta.label
  document.getElementById('profStatus').textContent = ai.status || '–'
}

/* ── Create tab ───────────────────────────────────────────────────────── */
function configureCreateTab() {
  const isAgent = agentInfo.agent_type === 'agent'
  const label   = isAgent ? 'Create User' : 'Create Sub-Agent'
  document.getElementById('createTabLabel').textContent   = label
  document.getElementById('createFormTitle').textContent  = label

  // Agents create users (no commission needed)
  if (isAgent) {
    document.getElementById('commissionField').style.display = 'none'
  } else {
    document.getElementById('commissionField').style.display = ''
  }

  document.getElementById('createBalanceHint').textContent =
    (agentInfo.points ?? 0).toLocaleString()

  document.getElementById('createBtn').textContent = label
}

document.getElementById('createBtn').addEventListener('click', async () => {
  const errEl  = document.getElementById('createError')
  const succEl = document.getElementById('createSuccess')
  hideAlert(errEl); hideAlert(succEl)

  const name       = document.getElementById('createName').value.trim()
  const email      = document.getElementById('createEmail').value.trim()
  const phone      = document.getElementById('createPhone').value.trim()
  const password   = document.getElementById('createPassword').value
  const commission = parseFloat(document.getElementById('createCommission').value) || 5
  const points     = parseInt(document.getElementById('createPoints').value) || 0

  if (!name || !email || !password) {
    showAlert(errEl, 'Name, email and password are required')
    return
  }

  const btn = document.getElementById('createBtn')
  btn.disabled = true

  try {
    const isAgent  = agentInfo.agent_type === 'agent'
    const endpoint = isAgent ? '/api/agent-portal/create-user' : '/api/agent-portal/create-sub-agent'
    const body = isAgent
      ? { name, email, phone, password, points }
      : { name, email, phone, password, commission_rate: commission, points }

    await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) })
    showAlert(succEl, `${isAgent ? 'User' : 'Sub-agent'} created successfully!`)

    // Clear form
    ;['createName','createEmail','createPhone','createPassword'].forEach(id => {
      document.getElementById(id).value = ''
    })
    document.getElementById('createPoints').value = '0'

    // Refresh balance
    agentInfo = await apiFetch('/api/agent-portal/me')
    renderTopbar()
    document.getElementById('createBalanceHint').textContent =
      (agentInfo.points ?? 0).toLocaleString()
    downline = null // invalidate cache

  } catch (err) {
    showAlert(errEl, err.message)
  } finally {
    btn.disabled = false
  }
})

/* ── Downline tab ─────────────────────────────────────────────────────── */
document.getElementById('refreshDownline').addEventListener('click', () => {
  downline = null
  loadDownline()
})

async function loadDownline() {
  if (downline) {
    renderDownline(downline)
    return
  }
  const container = document.getElementById('downlineList')
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>'
  try {
    downline = await apiFetch('/api/agent-portal/downline')
    renderDownline(downline)
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`
  }
}

function renderDownline(data) {
  const container = document.getElementById('downlineList')
  const title     = document.getElementById('downlineTitle')

  if (!data.items || data.items.length === 0) {
    title.textContent = data.type === 'agents' ? 'Sub-Agents' : 'Players'
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>No entries yet</p></div>'
    return
  }

  if (data.type === 'agents') {
    title.textContent = `Sub-Agents (${data.items.length})`
    container.innerHTML = data.items.map(a => {
      const meta = agentMeta(a.agent_type)
      return `
        <div class="downline-card">
          <div class="dl-avatar ${meta.avatarClass}">${meta.icon}</div>
          <div class="dl-info">
            <div class="dl-name">${esc(a.name)}</div>
            <div class="dl-meta">${esc(a.email || '–')} · ${meta.label}</div>
          </div>
          <div class="dl-stats">
            <div class="dl-points">💎 ${(a.points ?? 0).toLocaleString()} pts</div>
            <div class="dl-sub">${a.sub_agent_count ?? 0} sub-agents · ${a.player_count ?? 0} players</div>
          </div>
        </div>`
    }).join('')
  } else {
    title.textContent = `Players (${data.items.length})`
    container.innerHTML = data.items.map(u => `
      <div class="downline-card">
        <div class="dl-avatar av-player">👤</div>
        <div class="dl-info">
          <div class="dl-name">${esc(u.name)}</div>
          <div class="dl-meta">${esc(u.email || '–')} · Joined ${fmtDate(u.created_at)}</div>
        </div>
        <div class="dl-stats">
          <div class="dl-points">💎 ${(u.points ?? 0).toLocaleString()} pts</div>
          <div class="dl-sub">${u.status}</div>
        </div>
      </div>`
    ).join('')
  }
}

/* ── Allocate tab ─────────────────────────────────────────────────────── */
async function loadAllocateTab() {
  document.getElementById('allocBalance').textContent =
    (agentInfo?.points ?? 0).toLocaleString()

  const sel = document.getElementById('allocRecipient')
  sel.innerHTML = '<option value="">— loading recipients —</option>'
  try {
    const data = await apiFetch('/api/agent-portal/downline')
    sel.innerHTML = '<option value="">— select recipient —</option>'
    if (!data.items || data.items.length === 0) {
      sel.innerHTML = '<option value="">No recipients in your downline</option>'
      return
    }
    data.items.forEach(item => {
      const opt = document.createElement('option')
      opt.value = item.user_id ?? item.id
      opt.dataset.type = data.type === 'agents' ? 'agent' : 'user'
      const meta = data.type === 'agents' ? agentMeta(item.agent_type).label : 'Player'
      opt.textContent = `${item.name} (${meta}) — ${(item.points ?? 0).toLocaleString()} pts`
      sel.appendChild(opt)
    })
  } catch (err) {
    sel.innerHTML = `<option value="">Error: ${err.message}</option>`
  }
}

document.getElementById('allocBtn').addEventListener('click', async () => {
  const errEl  = document.getElementById('allocError')
  const succEl = document.getElementById('allocSuccess')
  hideAlert(errEl); hideAlert(succEl)

  const sel    = document.getElementById('allocRecipient')
  const selOpt = sel.options[sel.selectedIndex]
  const recipId   = parseInt(sel.value)
  const recipType = selOpt?.dataset?.type || 'user'
  const points = parseInt(document.getElementById('allocPoints').value) || 0

  if (!recipId) { showAlert(errEl, 'Please select a recipient'); return }
  if (points <= 0) { showAlert(errEl, 'Points must be greater than 0'); return }

  const btn = document.getElementById('allocBtn')
  btn.disabled = true
  try {
    const result = await apiFetch('/api/agent-portal/allocate-points', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: recipId, recipient_type: recipType, points }),
    })
    showAlert(succEl, `${points.toLocaleString()} points sent! Your balance: ${result.your_remaining_points.toLocaleString()} pts`)
    document.getElementById('allocPoints').value = '0'

    // Refresh me
    agentInfo = await apiFetch('/api/agent-portal/me')
    renderTopbar()
    document.getElementById('allocBalance').textContent =
      (agentInfo.points ?? 0).toLocaleString()
    downline = null
    await loadAllocateTab()
  } catch (err) {
    showAlert(errEl, err.message)
  } finally {
    btn.disabled = false
  }
})

/* ── Transactions tab ─────────────────────────────────────────────────── */
document.getElementById('refreshTxns').addEventListener('click', loadTransactions)

async function loadTransactions() {
  const container = document.getElementById('txnList')
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Loading…</p></div>'
  try {
    const txns = await apiFetch('/api/agent-portal/transactions')
    if (!txns.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No transactions yet</p></div>'
      return
    }
    container.innerHTML = txns.map(t => {
      const isPos = t.amount > 0
      return `
        <div class="txn-row">
          <div class="txn-icon">${isPos ? '📥' : '📤'}</div>
          <div class="txn-info">
            <div class="txn-desc">${esc(t.description || t.type)}</div>
            <div class="txn-date">${fmtDate(t.created_at)} · Balance after: ${t.balance_after}</div>
          </div>
          <div class="txn-amount ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}${t.amount} pts</div>
        </div>`
    }).join('')
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error: ${err.message}</p></div>`
  }
}

/* ── XSS escape ───────────────────────────────────────────────────────── */
function esc(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
}

/* ── Init ─────────────────────────────────────────────────────────────── */
if (TOKEN) {
  loadDashboard().catch(() => {
    TOKEN = null
    localStorage.removeItem('agentToken')
    showScreen('loginScreen')
  })
} else {
  showScreen('loginScreen')
}
