import { Router } from 'express'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/users
router.get('/', requireAuth, (req, res) => {
  const { search, status, limit = 100 } = req.query
  const conditions = []
  const params = []
  if (status) { conditions.push('u.status = ?'); params.push(status) }
  if (search) {
    conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  params.push(Number(limit))
  const rows = query(
    `SELECT u.*, a.id as agent_ref_id,
       (SELECT COUNT(*) FROM tickets t WHERE t.user_id = u.id) as ticket_count
     FROM users u
     LEFT JOIN agents a ON a.user_id = u.id
     ${where} ORDER BY u.created_at DESC LIMIT ?`,
    params
  )
  res.json(rows)
})

// POST /api/users
router.post('/', requireAuth, (req, res) => {
  const { name, email, phone, role, agent_id } = req.body
  const id = insert(
    'INSERT INTO users (name, email, phone, role, agent_id) VALUES (?,?,?,?,?)',
    [name, email ?? null, phone ?? null, role ?? 'player', agent_id ?? null]
  )
  res.json({ id })
})

// PUT /api/users/:id
router.put('/:id', requireAuth, (req, res) => {
  const { name, email, phone, role, status, balance, agent_id } = req.body
  run(
    'UPDATE users SET name=?, email=?, phone=?, role=?, status=?, points=?, agent_id=? WHERE id=?',
    [name, email, phone, role, status, balance, agent_id ?? null, req.params.id]
  )
  res.json({ ok: true })
})

// PUT /api/users/:id/status
router.put('/:id/status', requireAuth, (req, res) => {
  const { status } = req.body
  run('UPDATE users SET status = ? WHERE id = ?', [status, req.params.id])
  res.json({ ok: true })
})

// DELETE /api/users/:id
router.delete('/:id', requireAuth, (req, res) => {
  run('DELETE FROM users WHERE id = ?', [req.params.id])
  res.json({ ok: true })
})

// GET /api/users/:id/transactions
router.get('/:id/transactions', requireAuth, (req, res) => {
  const rows = query(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.params.id]
  )
  res.json(rows)
})

export default router
