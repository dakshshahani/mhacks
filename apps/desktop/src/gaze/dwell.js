export function createDwellTracker(thresholdMs = 500) {
  let threshold = thresholdMs;
  let currentId = null;
  let enteredAt = null;
  let lockedId = null;

  function update(id, now) {
    const changed = id !== currentId;
    if (changed) {
      currentId = id ?? null;
      enteredAt = id ? now : null;
      lockedId = null;
    }
    if (id && enteredAt !== null && now - enteredAt >= threshold) lockedId = id;
    return { changed, enteredAt, lockedId };
  }

  function click(id) {
    currentId = id ?? null;
    enteredAt = id ? 0 : null;
    lockedId = id ?? null;
    return lockedId;
  }

  function reset() {
    currentId = null;
    enteredAt = null;
    lockedId = null;
  }

  function setThreshold(nextThreshold) {
    if (Number.isFinite(nextThreshold)) threshold = Math.max(0, nextThreshold);
  }

  return { update, click, reset, setThreshold };
}
