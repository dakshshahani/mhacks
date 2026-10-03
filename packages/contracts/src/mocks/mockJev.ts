// packages/contracts/src/mocks/mockJev.ts — deterministic DecisionLayer stub.
// G2 runs on this. No I/O, no randomness, no shuffling: first component wins.

import type { Decision, DecisionInput, DecisionLayer } from "../decision";
import { POLICY } from "../decision";

export class MockJev implements DecisionLayer {
  decide(input: DecisionInput): Promise<Decision> {
    const transcript = input.transcript.trim();
    if (transcript.length === 0) {
      return Promise.resolve({
        actionable: 0,
        target: null,
        intent: "other",
        op: null,
        param: null,
        route: "no-llm",
        riskScore: 0,
        inCatalog: 0,
        confidence: 1,
      });
    }
    const max = Math.min(input.components.length, POLICY.MAX_CANDIDATES);
    const first = max > 0 ? input.components[0] : undefined;
    return Promise.resolve({
      actionable: 1,
      target: first ? first.id : null,
      intent: "style",
      op: "set-color",
      param: "brand",
      route: "no-llm",
      riskScore: 0.2,
      inCatalog: first ? 1 : 0,
      confidence: 0.9,
    });
  }
}

export const mockJev: DecisionLayer = new MockJev();
