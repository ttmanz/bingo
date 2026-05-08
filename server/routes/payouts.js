import { Router } from 'express'
import { query, queryOne, run, insert } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/payouts — transaction history
router.get('/', requireAuth, (req, res) => {
  const { type, user_id, limit = 100 } = req.query
  const conditions = []
  const params = []
  if (type)    { conditions.push('t.type = ?');    params.push(type) }
  if (user_id) { conditions.push('t.user_id = ?'); params.push(user_id) }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  params.push(Number(limit))
  const rows = query(
    `SELECT t.*, u.name as user_name FROM transactions t
     JOIN users u ON u.id = t.user_id
     ${where} ORDER BY t.created_at DESC LIMIT ?`,
    params
  )
  res.json(rows)
})

// GET /api/payouts/summary — balance and totals
router.get('/summary', requireAuth, (req, res) => {
  const totals = query(
    `SELECT type, SUM(amount) as total, COUNT(*) as count FROM transactions GROUP BY type`
  )
  const userBalance = queryOne('SELECT SUM(balance) as total FROM users')
  const pendingPayouts = queryOne(
    "SELECT COUNT(*) as count, SUM(prize_amount) as total FROM tickets WHERE paid_out = 0 AND status != 'active'"
  )
  res.json({ totals, userBalance: userBalance?.total ?? 0, pendingPayouts })
})

// POST /api/payouts/deposit — add balance to user
router.post('/deposit', requireAuth, (req, res) => {
  const { user_id, amount, description } = req.body
  const user = queryOne('SELECT * FROM users WHERE id = ?', [user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  const newBalance = (user.balance ?? 0) + Number(amount)
  run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [user_id, 'deposit', amount, newBalance, description ?? 'Manual deposit']
  )
  res.json({ ok: true, balance: newBalance })
})

// POST /api/payouts/withdraw — deduct balance from user
router.post('/withdraw', requireAuth, (req, res) => {
  const { user_id, amount, description } = req.body
  const user = queryOne('SELECT * FROM users WHERE id = ?', [user_id])
  if (!user) return res.status(404).json({ error: 'User not found' })
  const newBalance = (user.balance ?? 0) - Number(amount)
  run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description) VALUES (?,?,?,?,?)',
    [user_id, 'withdrawal', -amount, newBalance, description ?? 'Manual withdrawal']
  )
  res.json({ ok: true, balance: newBalance })
})

// POST /api/payouts/prize — pay out a winning ticket
router.post('/prize', requireAuth, (req, res) => {
  const { ticket_id } = req.body
  const ticket = queryOne(
    'SELECT t.*, u.balance FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = ?',
    [ticket_id]
  )
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
  if (ticket.paid_out) return res.status(400).json({ error: 'Already paid out' })
  const newBalance = (ticket.balance ?? 0) + ticket.prize_amount
  run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, ticket.user_id])
  run('UPDATE tickets SET paid_out = 1 WHERE id = ?', [ticket_id])
  insert(
    'INSERT INTO transactions (user_id, type, amount, balance_after, description, draw_id) VALUES (?,?,?,?,?,?)',
    [ticket.user_id, 'prize_win', ticket.prize_amount, newBalance, `Prize for ticket #${ticket_id}`, ticket.draw_id]
  )
  res.json({ ok: true, balance: newBalance })
})

export default router
