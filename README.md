# Bingo24-7 — Design System

Fully animated browser-based bingo game. Built for maximum visual impact with near-instant load times.

**Live:** `https://claspeter.github.io/bingodesign2/` (after enabling GitHub Pages — see Deploy section)

---

## Stack & Why

| Tool | Role | Why this over alternatives |
|------|------|---------------------------|
| **Vite** | Build tool / dev server | Instant HMR, tiny production bundles, zero config |
| **GSAP 3** | All animations | Industry gold standard — 60fps, hardware-accelerated, fine control |
| **canvas-confetti** | Win celebration particles | ~3KB, zero setup, looks great instantly |
| **lottie-web** | Imported design animations | Plug in JSON from Stitch / After Effects with no re-coding |

No framework (React/Vue/etc.) — this is intentional. Bingo doesn't need a component tree, and vanilla JS keeps the bundle under 200KB.

---

## Project Structure

```
bingodesign2/
├── index.html                    # App shell — single page
├── package.json
├── vite.config.js                # Sets base: '/bingodesign2/' for GitHub Pages
├── .github/
│   └── workflows/deploy.yml     # Auto-deploys on push to main
└── src/
    ├── main.js                   # Entry — wires all components + handles game state
    ├── style.css                 # All styles — CSS custom properties at top for theming
    ├── components/
    │   ├── BingoCard.js          # Card generation, rendering, marking, win detection
    │   └── NumberDraw.js         # Ball display + called-numbers history strip
    ├── animations/
    │   ├── cardReveal.js         # Card entrance + cell mark + win line highlight
    │   ├── numberBall.js         # Ball drop animation + called chip appear
    │   └── winSequence.js        # Full win overlay sequence with confetti
    └── utils/
        └── bingoLogic.js         # Pure functions: drawNumber, getColumn, COL_COLORS
```

---

## Design System

All visual tokens live at the top of `src/style.css` as CSS custom properties. **To retheme the entire game, only these need to change:**

```css
/* Column colors — used for balls, chips, header letters, glow effects */
--col-b: #4aa3ff;   /* B — blue  */
--col-i: #ff5e7d;   /* I — pink  */
--col-n: #4dffb4;   /* N — green */
--col-g: #ffe24d;   /* G — gold  */
--col-o: #c77dff;   /* O — purple */

/* Card & background */
--bg-deep: #080818;               /* Page background */
--bg-card: rgba(20,20,50,0.85);   /* Card glass surface */
--border-glow: rgba(120,80,255,0.4);

/* Marked cell */
--marked-bg: rgba(90,50,210,0.9);
--marked-glow: rgba(120,80,255,0.8);

/* Win line */
--gold: #f5c542;
--gold-glow: rgba(245,197,66,0.6);

/* Cell size — responsive, clamp controls min/max */
--cell-size: clamp(52px, 9vw, 78px);
```

The same `COL_COLORS` map exists in `src/utils/bingoLogic.js` as a JS object — keep both in sync when retheming.

---

## Animation Map

Every animation is isolated in its own exported function. Easy to swap, extend, or replace with Lottie.

| What animates | Function | File | GSAP technique |
|---------------|----------|------|----------------|
| BINGO title drops in | inline in `main.js` | `main.js` | `gsap.from()` with stagger |
| Card enters on load/reset | `animateCardIn()` | `cardReveal.js` | timeline, `rotateY`, `back.out` |
| Cell marks on click | `animateCellMark()` | `cardReveal.js` | `elastic.out` bounce |
| Win line pulses | `animateWinLine()` | `cardReveal.js` | staggered scale yoyo |
| Number ball drops | `animateBallDrop()` | `numberBall.js` | `bounce.out`, dynamic color |
| Called chip appears | `animateChipAppear()` | `numberBall.js` | `back.out` pop |
| Win overlay + confetti | `playWinSequence()` | `winSequence.js` | timeline + canvas-confetti |
| Overlay hides | `hideWinOverlay()` | `winSequence.js` | `gsap.to()` fade |

---

## Adding Lottie Animations (from Stitch or After Effects)

1. Export animation as **Lottie JSON** from your tool
   - Stitch: Export → Web → Lottie JSON
   - After Effects: Bodymovin plugin → Export
2. Drop the `.json` file in `public/lottie/`
3. Use it anywhere:

```js
import lottie from 'lottie-web'

const anim = lottie.loadAnimation({
  container: document.getElementById('my-lottie'),
  renderer: 'svg',      // 'svg' | 'canvas' | 'html'
  loop: false,
  autoplay: true,
  path: '/lottie/my-animation.json',
})

// Control programmatically
anim.play()
anim.pause()
anim.stop()
anim.goToAndPlay(30, true)   // frame 30
```

**Best candidates for Lottie replacement:**
- Ball draw effect (`animateBallDrop` → Lottie ball spin-in)
- Win celebration overlay (replace canvas-confetti with a Lottie burst)
- Idle background particle system (ambient loop)
- Cell mark effect (stamp / checkmark animation)

---

## Game Logic

All pure functions in `src/utils/bingoLogic.js`:

- **`drawNumber(called: Set)`** — picks random uncalled number from 1-75
- **`getColumn(number)`** — returns `'B'|'I'|'N'|'G'|'O'` for any number
- **`COL_COLORS`** — object mapping column letter to hex color

Card generation (`BingoCard.generateCard()`):
- Returns `numbers[col][row]` — a 5×5 grid stored column-first
- B col: random 5 from 1–15, I: 16–30, N: 31–45 (center = FREE), G: 46–60, O: 61–75

Win detection (`BingoCard.checkWin()`):
- Checks all 5 rows, 5 columns, 2 diagonals
- FREE space is pre-marked and counts toward wins
- Returns `'BINGO'` on win, `null` otherwise

---

## Commands

```bash
npm install       # Install all deps
npm run dev       # Dev server → http://localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview the production build locally
```

---

## Deploy to GitHub Pages

### Auto-deploy (already configured)
Push to `main` → GitHub Actions builds → deploys automatically.

### One-time setup (do this once)
1. Go to **repo Settings → Pages**
2. Source: **GitHub Actions**
3. Save

Live URL will be: `https://claspeter.github.io/bingodesign2/`

---

## What to Build Next

The foundation is complete. Prioritized by visual impact:

- [ ] **Lottie win celebration** — replace canvas-confetti with a custom Stitch export for the win overlay
- [ ] **Sound effects** — ball drop SFX + win fanfare using Web Audio API or Howler.js
- [ ] **Caller mode** — full-screen number display for projecting on a TV/wall
- [ ] **Ball history board** — 75-slot grid showing called (lit) vs uncalled (dim) numbers
- [ ] **Multiple cards** — 2–4 cards on screen simultaneously, all auto-marked
- [ ] **Themes** — swap CSS variable sets: Christmas, Halloween, Retro, Minimal
- [ ] **Custom card** — player enters their own numbers
- [ ] **Auto-draw mode** — timed draws with configurable interval (3s, 5s, 10s)
- [ ] **Mobile PWA** — manifest.json + service worker for installable app

---

## Context for Claude (continuing this project)

**Owner:** Michael — runs multiple businesses, photography, bands. Wants zero friction, high quality.

**Design goal:** "Most amazing bingo system that looks great and loads perfectly."

**Key decisions already made:**
- Vanilla JS over React — no framework needed, faster bundle
- GSAP over CSS-only — needed programmatic control for dynamic ball colors
- canvas-confetti over Lottie for win particles — instant load, no JSON needed
- lottie-web installed but not yet wired — placeholder for Stitch exports
- Numbers auto-mark on the card when drawn (single-player + caller in one)
- GitHub Actions deploy is configured — just needs Pages enabled in repo settings

**To continue:** clone the repo, `npm install`, `npm run dev`. The structure is modular — each animation is a standalone function, easy to swap.
