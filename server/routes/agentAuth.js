import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { queryOne } from '../db.js'
import { AGENT_JWT_SECRET } from '../middleware/agentAuth.js'

const router = Router()

const TYPE_LABELS = { super_agent: 'Super Agent', master_agent: 'Master Agent', agent: 'Agent' }

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

  const user = queryOne(
    "SELECT u.*, a.id as agent_id, a.agent_type, a.commission_rate, a.parent_agent_id FROM users u JOIN agents a ON a.user_id = u.id WHERE u.email = ? AND u.status = 'active'",
    [email.toLowerCase().trim()]
  )

  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  if (!user.password_hash) return res.status(401).json({ error: 'No password set — ask your admin to set a password for your account' })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign(
    { user_id: user.id, agent_id: user.agent_id, agent_type: user.agent_type, name: user.name },
    AGENT_JWT_SECRET,
    { expiresIn: '12h' }
  )

  res.json({
    token,
    name:        user.name,
    email:       user.email,
    agent_type:  user.agent_type,
    type_label:  TYPE_LABELS[user.agent_type] ?? user.agent_type,
    points:      user.points ?? 0,
    agent_id:    user.agent_id,
  })
})

export default router
