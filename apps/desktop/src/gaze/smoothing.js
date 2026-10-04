export function createEmaSmoother(alpha = 0.25, maxInputJump = 260) {
  let factor = Math.min(1, Math.max(0, alpha));
  let point = null;

  return {
    update(nextPoint) {
      if (!nextPoint || !Number.isFinite(nextPoint.x) || !Number.isFinite(nextPoint.y)) {
        return point ? { ...point } : null;
      }
      if (!point) {
        point = { x: nextPoint.x, y: nextPoint.y };
      } else {
        const dx = nextPoint.x - point.x;
        const dy = nextPoint.y - point.y;
        const distance = Math.hypot(dx, dy);
        const scale = distance > maxInputJump ? maxInputJump / distance : 1;
        const x = point.x + dx * scale;
        const y = point.y + dy * scale;
        point = { x: point.x + factor * (x - point.x), y: point.y + factor * (y - point.y) };
      }
      return { ...point };
    },
    reset() {
      point = null;
    },
    setAlpha(nextAlpha) {
      if (Number.isFinite(nextAlpha)) factor = Math.min(1, Math.max(0, nextAlpha));
    },
  };
}
