// Lightweight bridge so route handlers can trigger a game reschedule
// without creating circular imports with server/index.js
let _reschedule = null
export function setRescheduleCallback(fn) { _reschedule = fn }
export function triggerReschedule()       { _reschedule?.() }
