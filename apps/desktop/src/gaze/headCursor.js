export const DEFAULT_HEAD_TRACKING = Object.freeze({
  deadzone: 0,
  verticalGain: 3,
  horizontalGain: 2.5,
  invertX: true,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function validAnchor(anchor) {
  return Boolean(anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y));
}

function normalizeOptions(options = {}) {
  return {
    deadzone: clamp(Number.isFinite(options.deadzone) ? options.deadzone : DEFAULT_HEAD_TRACKING.deadzone, 0, 0.25),
    verticalGain: clamp(Number.isFinite(options.verticalGain) ? options.verticalGain : DEFAULT_HEAD_TRACKING.verticalGain, 0.25, 12),
    horizontalGain: clamp(Number.isFinite(options.horizontalGain) ? options.horizontalGain : DEFAULT_HEAD_TRACKING.horizontalGain, 0.5, 8),
    invertX: options.invertX ?? DEFAULT_HEAD_TRACKING.invertX,
  };
}

function removeDeadzone(value, deadzone) {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  return Math.sign(value) * ((magnitude - deadzone) / (1 - deadzone));
}

function viewportCenter(viewport) {
  const defaultWidth = typeof window !== "undefined" ? window.innerWidth : 1;
  const defaultHeight = typeof window !== "undefined" ? window.innerHeight : 1;
  const width = Math.max(1, finite(viewport?.width, defaultWidth));
  const height = Math.max(1, finite(viewport?.height, defaultHeight));
  return { x: width / 2, y: height / 2 };
}

/** Convert a normalized nose/face anchor into a smoothed host-window point. */
export function createHeadCursor(options = {}) {
  const config = normalizeOptions(options);
  let neutralAnchor = null;
  let currentAnchor = null;
  let smoothedPoint = null;
  let smoothing = 0.25;

  function setSmoothing(nextSmoothing) {
    if (Number.isFinite(nextSmoothing)) smoothing = clamp(nextSmoothing, 0.05, 0.8);
  }

  function map(anchor, viewport) {
    if (!validAnchor(anchor)) return null;
    const center = viewportCenter(viewport);
    const width = center.x * 2;
    const height = center.y * 2;
    if (!neutralAnchor) {
      neutralAnchor = { x: anchor.x, y: anchor.y };
      currentAnchor = anchor;
      smoothedPoint = center;
      return { rawPoint: center, point: center, anchor, neutralAnchor, calibrated: true };
    }

    const deltaX = removeDeadzone(anchor.x - neutralAnchor.x, config.deadzone);
    const deltaY = removeDeadzone(anchor.y - neutralAnchor.y, config.deadzone);
    const rawPoint = {
      x: clamp(center.x + (config.invertX ? -deltaX : deltaX) * config.horizontalGain * width, 0, width),
      y: clamp(center.y + deltaY * config.verticalGain * height, 0, height),
    };
    smoothedPoint = smoothedPoint
      ? {
          x: smoothedPoint.x + (rawPoint.x - smoothedPoint.x) * smoothing,
          y: smoothedPoint.y + (rawPoint.y - smoothedPoint.y) * smoothing,
        }
      : rawPoint;
    currentAnchor = anchor;
    return { rawPoint, point: smoothedPoint, anchor, neutralAnchor, calibrated: true };
  }

  function recenter(anchor, viewport) {
    if (!validAnchor(anchor)) return null;
    const center = viewportCenter(viewport);
    neutralAnchor = { x: anchor.x, y: anchor.y };
    currentAnchor = anchor;
    smoothedPoint = center;
    return { rawPoint: center, point: center, anchor, neutralAnchor, calibrated: true };
  }

  function reset() {
    neutralAnchor = null;
    currentAnchor = null;
    smoothedPoint = null;
  }

  return {
    map,
    recenter,
    reset,
    setSmoothing,
    getNeutralAnchor: () => neutralAnchor,
    getCurrentAnchor: () => currentAnchor,
  };
}
