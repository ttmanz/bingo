import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// Hierarchy: super → master → agent → (users)
const HIERARCHY = ['super', 'master', 'agent']
const TYPE_LABELS = { super: 'Super Agent', master: 'Master Agent', agent: 'Agent' }

// GET /api/agents — all agents with hierarchy info
router.get('/', requireAuth, (req, res) => {
  const { agent_type } = req.query
  const where = agent_type ? 'WHERE a.agent_type = ?' : ''
  const params = agent_type ? [agent_type] : []
  const rows = query(
    `SELECT a.*, u.name, u.email, u.phone, u.points, u.status as user_status,
       (SELECT COUNT(*) FROM users uu WHERE uu.agent_id = u.id) as player_count,
       (SELECT COUNT(*) FROM agents ca WHERE ca.parent_agent_id = a.id) as child_agent_count,
       pu.name as parent_name, pa.agent_type as parent_type
     FROM agents a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN agents pa ON pa.id = a.parent_agent_id
     LEFT JOIN users pu ON pu.id = pa.user_id
     ${where}
     ORDER BY CASE a.agent_type WHEN 'super' THEN 1 WHEN 'master' THEN 2 ELSE 3 END, a.id`,
    params
  )
  res.json(rows)
})

// GET /api/agents/tree — full hierarchy tree
router.get('/tree', requireAuth, (req, res) => {
  const all = query(
    `SELECT a.*, u.name, u.phone,
       (SELECT COUNT(*) FROM users uu WHERE uu.agent_id = u.id) as player_count
     FROM agents a JOIN users u ON u.id = a.user_id
     ORDER BY CASE a.agent_type WHEN 'super' THEN 1 WHEN 'master' THEN 2 ELSE 3 END, a.id`
  )

  // Build tree: supers at root, masters under supers, agents under masters
  const byId = {}
  all.forEach(a => { byId[a.id] = { ...a, children: [] } })
  const roots = []
  all.forEach(a => {
    if (a.parent_agent_id && byId[a.parent_agent_id]) {
      byId[a.parent_agent_id].children.push(byId[a.id])
    } else {
      roots.push(byId[a.id])
    }
  })
  res.json(roots)
})

// GET /api/agents/by-type/:type — agents of a specific type (for parent selectors)
router.get('/by-type/:type', requireAuth, (req, res) => {
  const rows = query(
    `SELECT a.id, u.name, u.phone FROM agents a
     JOIN users u ON u.id = a.user_id
     WHERE a.agent_type = ? AND a.status = 'active' ORDER BY u.name`,
    [req.params.type]
  )
  res.json(rows)
})

// POST /api/agents — create agent (admin can specify any type)
router.post('/', requireAuth, async (req, res) => {
  const { agent_type, commission_rate, parent_agent_id,
          name, email, phone, password, points,
          user_id } = req.body

  if (!HIERARCHY.includes(agent_type)) {
    return res.status(400).json({ error: `Invalid agent_type. Must be one of: ${HIERARCHY.join(', ')}` })
  }

  // Validate parent
  if (parent_agent_id) {
    const parent = queryOne('SELECT agent_type FROM agents WHERE id = ?', [parent_agent_id])
    if (!parent) return res.status(400).json({ error: 'Parent agent not found' })
    const expectedParentIdx = HIERARCHY.indexOf(agent_type) - 1
    if (expectedParentIdx >= 0 && parent.agent_type !== HIERARCHY[expectedParentIdx]) {
      return res.status(400).json({
        error: `A ${TYPE_LABELS[agent_type]} must have a ${TYPE_LABELS[HIERARCHY[expectedParentIdx]]} as parent`
      })
    }
  }

  const roleMap = { super: 'super_agent', master: 'master_agent', agent: 'agent' }
  let resolvedUserId = user_id

  if (!resolvedUserId) {
    // Create a new user account for this agent
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' })
    }
    if (queryOne('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()])) {
      return res.status(400).json({ error: 'Email already in use' })
    }
    const hash = await bcrypt.hash(password, 10)
    resolvedUserId = insert(
      'INSERT INTO users (name, email, phone, role, points, password_hash) VALUES (?,?,?,?,?,?)',
      [name, email.toLowerCase().trim(), phone ?? null, roleMap[agent_type], points ?? 0, hash]
    )
  } else {
    const user = queryOne('SELECT * FROM users WHERE id = ?', [resolvedUserId])
    if (!user) return res.status(404).json({ error: 'User not found' })
    const existing = queryOne('SELECT id FROM agents WHERE user_id = ?', [resolvedUserId])
    if (existing) return res.status(400).json({ error: 'User is already an agent' })
    run('UPDATE users SET role = ? WHERE id = ?', [roleMap[agent_type], resolvedUserId])
  }

  const id = insert(
    'INSERT INTO agents (user_id, agent_type, commission_rate, parent_agent_id) VALUES (?,?,?,?)',
    [resolvedUserId, agent_type, commission_rate ?? 5.0, parent_agent_id ?? null]
  )
  res.json({ id, agent_type, user_id: resolvedUserId })
})

// PUT /api/agents/:id — update agent settings
router.put('/:id', requireAuth, (req, res) => {
  const { commission_rate, parent_agent_id, status, agent_type } = req.body
  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [req.params.id])
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const newType = agent_type ?? agent.agent_type
  if (agent_type && agent_type !== agent.agent_type) {
    const roleMap = { super: 'super_agent', master: 'master_agent', agent: 'agent' }
    run('UPDATE users SET role = ? WHERE id = ?', [roleMap[newType], agent.user_id])
  }

  run(
    'UPDATE agents SET commission_rate=?, parent_agent_id=?, status=?, agent_type=? WHERE id=?',
    [commission_rate ?? agent.commission_rate, parent_agent_id ?? null, status ?? agent.status, newType, req.params.id]
  )
  res.json({ ok: true })
})

// DELETE /api/agents/:id — remove agent role (user account kept)
router.delete('/:id', requireAuth, (req, res) => {
  const agent = queryOne('SELECT user_id FROM agents WHERE id = ?', [req.params.id])
  if (agent) run("UPDATE users SET role = 'player' WHERE id = ?", [agent.user_id])
  run('DELETE FROM agents WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// POST /api/agents/:id/add-points — admin tops up an agent's points balance
router.post('/:id/add-points', requireAuth, (req, res) => {
  const agent = queryOne('SELECT user_id FROM agents WHERE id = ?', [req.params.id])
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  const { amount } = req.body
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be > 0' })
  const user = queryOne('SELECT points FROM users WHERE id = ?', [agent.user_id])
  const newPoints = (user?.points ?? 0) + amount
  run('UPDATE users SET points = ? WHERE id = ?', [newPoints, agent.user_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [agent.user_id, 'points_received', amount, newPoints, 'Points added by admin']
  )
  res.json({ ok: true, points: newPoints })
})

// GET /api/agents/:id/downline — all agents and users under this agent
router.get('/:id/downline', requireAuth, (req, res) => {
  const agent = queryOne('SELECT * FROM agents WHERE id = ?', [req.params.id])
  if (!agent) return res.status(404).json({ error: 'Not found' })

  // Collect all descendant agent IDs recursively
  function getDescendants(parentId) {
    const children = query('SELECT id FROM agents WHERE parent_agent_id = ?', [parentId])
    let ids = children.map(c => c.id)
    children.forEach(c => { ids = ids.concat(getDescendants(c.id)) })
    return ids
  }
  const descendantIds = [Number(req.params.id), ...getDescendants(Number(req.params.id))]

  const childAgents = query(
    `SELECT a.*, u.name, u.phone FROM agents a JOIN users u ON u.id = a.user_id
     WHERE a.parent_agent_id = ? ORDER BY a.agent_type, u.name`,
    [req.params.id]
  )

  const players = query(
    `SELECT u.* FROM users u
     JOIN users recruiter ON recruiter.id = u.agent_id
     JOIN agents a ON a.user_id = recruiter.id
     WHERE a.id = ? ORDER BY u.created_at DESC`,
    [req.params.id]
  )

  res.json({ agent, childAgents, players })
})

export default router
