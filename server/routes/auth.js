import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { queryOne } from '../db.js'
import { JWT_SECRET } from '../middleware/auth.js'

const router = Router()

router.post('/login', async (req, res) => {
  const { username, password } = req.body
  const admin = queryOne('SELECT * FROM admins WHERE username = ?', [username])
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' })
  const valid = await bcrypt.compare(password, admin.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '12h' })
  res.json({ token, username: admin.username })
})

router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.replace('Bearer ', '')
  let payload
  try { payload = jwt.verify(token, JWT_SECRET) } catch { return res.status(401).json({ error: 'Unauthorised' }) }
  const admin = queryOne('SELECT * FROM admins WHERE id = ?', [payload.id])
  if (!admin) return res.status(401).json({ error: 'Unauthorised' })
  const valid = await bcrypt.compare(currentPassword, admin.password_hash)
  if (!valid) return res.status(401).json({ error: 'Wrong current password' })
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' })
  const hash = await bcrypt.hash(newPassword, 10)
  const { run } = await import('../db.js')
  run('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, admin.id])
  res.json({ ok: true })
})

export default router
