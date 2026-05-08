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

export default router
