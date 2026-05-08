import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, queryOne, run, insert } from '../db.js'
import { requireAgentAuth } from '../middleware/agentAuth.js'

const router = Router()

// What each type can create
const CAN_CREATE = {
  super_agent:  { type: 'master_agent', role: 'master_agent', agent_type: 'master' },
  master_agent: { type: 'agent',        role: 'agent',        agent_type: 'agent'  },
  agent:        null, // agents create users, not sub-agents
}

// ── GET /api/agent-portal/me ──────────────────────────────────────────────
router.get('/me', requireAgentAuth, (req, res) => {
  const user = queryOne(
    `SELECT u.id, u.name, u.email, u.phone, u.points, u.status,
       a.id as agent_id, a.agent_type, a.commission_rate, a.parent_agent_id,
       (SELECT COUNT(*) FROM agents ca WHERE ca.parent_agent_id = a.id) as sub_agent_count,
       (SELECT COUNT(*) FROM users uu WHERE uu.agent_id = u.id) as player_count
     FROM users u JOIN agents a ON a.user_id = u.id WHERE u.id = ?`,
    [req.agent.user_id]
  )
  if (!user) return res.status(404).json({ error: 'Agent not found' })
  res.json(user)
})

// ── GET /api/agent-portal/downline ────────────────────────────────────────
router.get('/downline', requireAgentAuth, (req, res) => {
  const { agent_type, agent_id } = req.agent

  if (agent_type === 'agent') {
    // Agents see their recruited users
    const agentRow = queryOne('SELECT user_id FROM agents WHERE id = ?', [agent_id])
    const users = query(
      `SELECT id, name, email, phone, points, status, created_at FROM users
       WHERE agent_id = ? ORDER BY created_at DESC`,
      [agentRow?.user_id ?? 0]
    )
    return res.json({ type: 'users', items: users })
  }

  // Super/master see their sub-agents
  const subAgents = query(
    `SELECT a.id, a.agent_type, a.commission_rate, a.status,
       u.id as user_id, u.name, u.email, u.phone, u.points,
       (SELECT COUNT(*) FROM agents ca WHERE ca.parent_agent_id = a.id) as sub_agent_count,
       (SELECT COUNT(*) FROM users uu WHERE uu.agent_id = u.id) as player_count
     FROM agents a JOIN users u ON u.id = a.user_id
     WHERE a.parent_agent_id = ? ORDER BY u.name`,
    [agent_id]
  )
  return res.json({ type: 'agents', items: subAgents })
})

// ── POST /api/agent-portal/create-sub-agent ───────────────────────────────
router.post('/create-sub-agent', requireAgentAuth, async (req, res) => {
  const { agent_type, agent_id, user_id: creatorUserId } = req.agent
  const canCreate = CAN_CREATE[agent_type]
  if (!canCreate) return res.status(403).json({ error: 'Agents cannot create sub-agents. Use create-user instead.' })

  const { name, email, phone, password, commission_rate = 5, points = 0 } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' })

  // Check agent has enough points to allocate
  const creator = queryOne('SELECT points FROM users WHERE id = ?', [creatorUserId])
  if (points > 0 && (creator?.points ?? 0) < points) {
    return res.status(400).json({ error: `You only have ${creator?.points ?? 0} points available` })
  }

  // Check email not taken
  if (queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()])) {
    return res.status(400).json({ error: 'Email already in use' })
  }

  const hash = await bcrypt.hash(password, 10)

  // Create user account
  const newUserId = insert(
    'INSERT INTO users (name, email, phone, role, points, password_hash, agent_id) VALUES (?,?,?,?,?,?,?)',
    [name, email.toLowerCase().trim(), phone ?? null, canCreate.role, points, hash, creatorUserId]
  )

  // Create agent record
  const newAgentId = insert(
    'INSERT INTO agents (user_id, agent_type, commission_rate, parent_agent_id) VALUES (?,?,?,?)',
    [newUserId, canCreate.agent_type, commission_rate, agent_id]
  )

  // Deduct points from creator
  if (points > 0) {
    run('UPDATE users SET points = points - ? WHERE id = ?', [points, creatorUserId])
    insert(
      'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
      [creatorUserId, 'points_allocated', -points,
       (creator.points - points),
       `Allocated to ${name} (${canCreate.type})`]
    )
    insert(
      'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
      [newUserId, 'points_received', points, points, `Received from agent #${agent_id}`]
    )
  }

  res.json({ ok: true, user_id: newUserId, agent_id: newAgentId })
})

// ── POST /api/agent-portal/create-user ───────────────────────────────────
router.post('/create-user', requireAgentAuth, async (req, res) => {
  const { agent_type, user_id: creatorUserId } = req.agent
  if (agent_type !== 'agent') {
    return res.status(403).json({ error: 'Only agents can create users. Super/master agents create sub-agents.' })
  }

  const { name, email, phone, password, points = 0 } = req.body
  if (!name) return res.status(400).json({ error: 'Name is required' })

  const creator = queryOne('SELECT points FROM users WHERE id = ?', [creatorUserId])
  if (points > 0 && (creator?.points ?? 0) < points) {
    return res.status(400).json({ error: `You only have ${creator?.points ?? 0} points available` })
  }

  if (email && queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()])) {
    return res.status(400).json({ error: 'Email already in use' })
  }

  const hash = password ? await bcrypt.hash(password, 10) : null

  const newUserId = insert(
    'INSERT INTO users (name, email, phone, role, points, password_hash, agent_id) VALUES (?,?,?,?,?,?,?)',
    [name, email ? email.toLowerCase().trim() : null, phone ?? null, 'player', points, hash, creatorUserId]
  )

  if (points > 0) {
    run('UPDATE users SET points = points - ? WHERE id = ?', [points, creatorUserId])
    insert(
      'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
      [creatorUserId, 'points_allocated', -points, (creator.points - points), `Allocated to player ${name}`]
    )
    insert(
      'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
      [newUserId, 'points_received', points, points, 'Initial points from agent']
    )
  }

  res.json({ ok: true, user_id: newUserId })
})

// ── POST /api/agent-portal/allocate-points ────────────────────────────────
router.post('/allocate-points', requireAgentAuth, async (req, res) => {
  const { user_id: senderUserId, agent_id, agent_type } = req.agent
  const { recipient_id, recipient_type, points } = req.body
  // recipient_type: 'agent' (user_id of a sub-agent's user) or 'user'

  if (!points || points <= 0) return res.status(400).json({ error: 'Points must be greater than 0' })

  const sender = queryOne('SELECT points FROM users WHERE id = ?', [senderUserId])
  if ((sender?.points ?? 0) < points) {
    return res.status(400).json({ error: `Insufficient points. You have ${sender?.points ?? 0}` })
  }

  // Verify recipient is in this agent's downline
  let validRecipient = false
  if (recipient_type === 'agent') {
    const sub = queryOne('SELECT a.id FROM agents a WHERE a.user_id = ? AND a.parent_agent_id = ?', [recipient_id, agent_id])
    validRecipient = !!sub
  } else {
    const player = queryOne('SELECT id FROM users WHERE id = ? AND agent_id = ?', [recipient_id, senderUserId])
    validRecipient = !!player
  }
  if (!validRecipient) return res.status(403).json({ error: 'Recipient is not in your downline' })

  const recipient = queryOne('SELECT points FROM users WHERE id = ?', [recipient_id])
  run('UPDATE users SET points = points - ? WHERE id = ?', [points, senderUserId])
  run('UPDATE users SET points = points + ? WHERE id = ?', [points, recipient_id])

  insert('INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [senderUserId, 'points_allocated', -points, (sender.points - points), `Points sent to user #${recipient_id}`])
  insert('INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [recipient_id, 'points_received', points, (recipient.points + points), `Points received from agent`])

  res.json({ ok: true, your_remaining_points: sender.points - points })
})

// ── GET /api/agent-portal/transactions ───────────────────────────────────
router.get('/transactions', requireAgentAuth, (req, res) => {
  const txns = query(
    "SELECT * FROM transactions WHERE user_id = ? AND type IN ('points_allocated','points_received') ORDER BY created_at DESC LIMIT 50",
    [req.agent.user_id]
  )
  res.json(txns)
})

export default router
