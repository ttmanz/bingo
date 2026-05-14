import { gsap } from 'gsap'
import confetti from 'canvas-confetti'

const COLORS = ['#f5c542', '#ff5e7d', '#4aa3ff', '#4dffb4', '#c77dff']

function burst(opts = {}) {
  confetti({ particleCount: 120, spread: 80, colors: COLORS, zIndex: 200, ...opts })
}

export function playWinSequence(overlayEl) {
  const tl = gsap.timeline()

  tl.to(overlayEl, { opacity: 1, duration: 0.35, ease: 'power2.out' })
    .call(() => {
      burst({ origin: { y: 0.5 } })
      setTimeout(() => burst({ angle: 60, spread: 55, origin: { x: 0, y: 0.6 } }), 180)
      setTimeout(() => burst({ angle: 120, spread: 55, origin: { x: 1, y: 0.6 } }), 320)
    })
    .from('.win-text', { scale: 3, opacity: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)' }, '-=0.15')
    .from('.play-again-btn', { opacity: 0, y: 30, duration: 0.4, ease: 'power2.out' }, '-=0.1')

  let count = 0
  const iv = setInterval(() => {
    if (++count > 4) return clearInterval(iv)
    burst({ particleCount: 50, spread: 120, origin: { x: Math.random(), y: Math.random() * 0.5 } })
  }, 700)

  return tl
}

export function hideWinOverlay(overlayEl) {
  return gsap.to(overlayEl, {
    opacity: 0,
    duration: 0.3,
    onComplete: () => overlayEl.classList.remove('active'),
  })
}
