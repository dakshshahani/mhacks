export function createTargetStabilizer(requiredWins = 2) {
  const winsNeeded = Math.max(1, requiredWins);
  let stableId = null;
  let pendingId = null;
  let pendingWins = 0;

  function resetPending() {
    pendingId = null;
    pendingWins = 0;
  }

  function update(proposedId) {
    if (!stableId) {
      stableId = proposedId ?? null;
      resetPending();
      return { id: stableId, changed: Boolean(stableId) };
    }
    if (proposedId === stableId) {
      resetPending();
      return { id: stableId, changed: false };
    }
    if (!proposedId) {
      return { id: stableId, changed: false };
    }
    if (pendingId === proposedId) pendingWins += 1;
    else {
      pendingId = proposedId;
      pendingWins = 1;
    }
    if (pendingWins < winsNeeded) return { id: stableId, changed: false };
    stableId = proposedId;
    resetPending();
    return { id: stableId, changed: true };
  }

  function click(id) {
    stableId = id ?? null;
    resetPending();
    return stableId;
  }

  function reset() {
    stableId = null;
    resetPending();
  }

  return { update, click, reset, getStableId: () => stableId };
}
