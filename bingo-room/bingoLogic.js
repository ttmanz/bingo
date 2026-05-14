// 90-ball bingo — 9 groups of 10 (plus 1 extra for 80-90)
export const COL_COLORS = {
  1: '#ff0000',  // red     1–9
  2: '#1b5d16',  // green   10–19
  3: '#f9fc03',  // yellow  20–29
  4: '#0000ff',  // blue    30–39
  5: '#ff7e00',  // orange  40–49
  6: '#6efc1d',  // lime    50–59
  7: '#0ff9f1',  // cyan    60–69
  8: '#fd04e7',  // magenta 70–79
  9: '#4f2e03',  // brown   80–90
}

export function getColumn(number) {
  if (number <=  9) return 1
  if (number <= 19) return 2
  if (number <= 29) return 3
  if (number <= 39) return 4
  if (number <= 49) return 5
  if (number <= 59) return 6
  if (number <= 69) return 7
  if (number <= 79) return 8
  return 9
}

export function drawNumber(called) {
  const available = []
  for (let i = 1; i <= 90; i++) {
    if (!called.has(i)) available.push(i)
  }
  if (!available.length) return null
  return available[Math.floor(Math.random() * available.length)]
}
