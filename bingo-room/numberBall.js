import { gsap } from 'gsap'

export function animateBallDrop(ballEl, color) {
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

export function animateChipAppear(chipEl) {
  gsap.from(chipEl, { opacity: 0, scale: 0, duration: 0.3, ease: 'back.out(1.7)' })
}
