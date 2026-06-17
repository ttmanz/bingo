// Load .env into process.env BEFORE any module reads a secret.
// Imported first in index.js so middleware secrets resolve at module-eval time.
// Uses Node's built-in loader (Node ≥20.12) — no external dependency.
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch {
  // No .env file present — secrets must then come from the real environment.
  // The auth middleware throws a clear error if a required secret is missing.
}
