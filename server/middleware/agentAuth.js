import jwt from 'jsonwebtoken'

export const AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || 'themis-agent-portal-2026'

export function requireAgentAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'No token' })
  try {
    req.agent = jwt.verify(token, AGENT_JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
