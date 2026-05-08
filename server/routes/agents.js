import { Router } from 'express'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/agents
router.get('/', requireAuth, (req, res) => {
  const rows = query(
    `SELECT a.*, u.name, u.email, u.phone, u.status as user_status,
       (SELECT COUNT(*) FROM users uu WHERE uu.agent_id = u.id) as player_count,
       pa.id as parent_agent_id_ref,
       pu.name as parent_name
     FROM agents a
     JOIN users u ON u.id = a.user_id
     LEFT JOIN agents pa ON pa.id = a.parent_agent_id
     LEFT JOIN users pu ON pu.id = pa.user_id
     ORDER BY a.total_sales DESC`
  )
  res.json(rows)
})

// POST /api/agents — promote a user to agent
router.post('/', requireAuth, (req, res) => {
  const { user_id, commission_rate, parent_agent_id } = req.body
  const user = queryOne('SELECT * FROM users WHERE id = ?', [user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  const existing = queryOne('SELECT id FROM agents WHERE user_id = ?', [user_id])
  if (existing) return res.status(400).json({ error: 'Already an agent' })
  run("UPDATE users SET role = 'agent' WHERE id = ?", [user_id])
  const id = insert(
    'INSERT INTO agents (user_id, commission_rate, parent_agent_id) VALUES (?,?,?)',
    [user_id, commission_rate ?? 5.0, parent_agent_id ?? null]
  )
  res.json({ id })
})

// PUT /api/agents/:id
router.put('/:id', requireAuth, (req, res) => {
  const { commission_rate, parent_agent_id, status } = req.body
  run(
    'UPDATE agents SET commission_rate=?, parent_agent_id=?, status=? WHERE id=?',
    [commission_rate, parent_agent_id ?? null, status, req.params.id]
  )
  res.json({ ok: true })
})

// DELETE /api/agents/:id — demote agent (keep user account)
router.delete('/:id', requireAuth, (req, res) => {
  const agent = queryOne('SELECT user_id FROM agents WHERE id = ?', [req.params.id])
  if (agent) run("UPDATE users SET role = 'player' WHERE id = ?", [agent.user_id])
  run('DELETE FROM agents WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// GET /api/agents/:id/players — players recruited by agent
router.get('/:id/players', requireAuth, (req, res) => {
  const agent = queryOne('SELECT user_id FROM agents WHERE id = ?', [req.params.id])
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  const rows = query(
    'SELECT u.*, (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id) as ticket_count FROM users u WHERE u.agent_id = ? ORDER BY u.created_at DESC',
    [agent.user_id]
  )
  res.json(rows)
})

export default router
