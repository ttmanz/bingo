// Shared 90-ball bingo card generator
// One card = 3 rows × 9 columns, 5 numbers per row (15 total)
// Column ranges: col0=1-9, col1=10-19, ..., col8=80-90

const COL_RANGES = [
  [1,9],[10,19],[20,29],[30,39],[40,49],[50,59],[60,69],[70,79],[80,90]
]

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function generateCard() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const grid    = Array.from({ length: 3 }, () => Array(9).fill(null))
    const colUsed = Array.from({ length: 9 }, () => [])
    let ok = true

    for (let r = 0; r < 3; r++) {
      const cols = shuffleArr([0,1,2,3,4,5,6,7,8]).slice(0, 5).sort((a,b) => a-b)
      for (const col of cols) {
        const [lo, hi] = COL_RANGES[col]
        const pool = []
        for (let n = lo; n <= hi; n++) if (!colUsed[col].includes(n)) pool.push(n)
        if (!pool.length) { ok = false; break }
        const n = pool[Math.floor(Math.random() * pool.length)]
        colUsed[col].push(n)
        grid[r][col] = n
      }
      if (!ok) break
    }

    if (!ok) continue

    // Sort numbers within each column ascending top→bottom
    for (let col = 0; col < 9; col++) {
      const rows = [0,1,2].filter(r => grid[r][col] !== null)
      if (rows.length > 1) {
        const nums = rows.map(r => grid[r][col]).sort((a,b) => a-b)
        rows.forEach((r, i) => { grid[r][col] = nums[i] })
      }
    }

    return { row1: grid[0], row2: grid[1], row3: grid[2] }
  }
  return null  // should never happen
}

// Generate N tickets, each with 6 cards.
// Returns array of cardData arrays ready to JSON.stringify into tickets.numbers
export function generateTicketCards(ticketCount, codePrefix = 'H') {
  const tickets = []
  for (let t = 0; t < ticketCount; t++) {
    const cards = []
    for (let pos = 1; pos <= 6; pos++) {
      const card = generateCard()
      if (!card) continue
      // Code: prefix + sequential (e.g. H000001)
      const seqNum = (tickets.length * 6 + pos)
      const code = codePrefix + String(seqNum).padStart(6, '0')
      cards.push({ code, position: pos, row1: card.row1, row2: card.row2, row3: card.row3 })
    }
    tickets.push(cards)
  }
  return tickets
}
