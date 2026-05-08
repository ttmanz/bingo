import { Router } from 'express'
import { queryOne, run } from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAuth, (req, res) => {
  const jackpot = queryOne('SELECT * FROM jackpot WHERE id = 1')
  res.json(jackpot)
})

router.put('/', requireAuth, (req, res) => {
  const { enabled, amount, ball_count } = req.body
  run(
    'UPDATE jackpot SET enabled = ?, amount = ?, ball_count = ? WHERE id = 1',
    [enabled ? 1 : 0, amount, ball_count]
  )
  res.json({ ok: true })
})

export default router
