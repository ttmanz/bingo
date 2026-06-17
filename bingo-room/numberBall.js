import { gsap } from 'gsap'

export function animateBallDrop(ballEl, color) {
  // Clear any stale inline background (e.g. set by CallCard.restore) so the
  // CSS radial-gradient definition shows through — only tint via glow/border.
  ballEl.style.background = ''
  gsap.set(ballEl, {
    color,
    borderColor: color,
    boxShadow: `0 0 40px ${color}, 0 0 80px ${color}40, inset 0 -4px 20px rgba(0,0,0,0.4)`,
  })
  gsap.fromTo(
    ballEl,
    { y: -160, opacity: 0, scale: 0.4 },
    { y: 0, opacity: 1, scale: 1, duration: 0.65, ease: 'bounce.out' }
  )
}
