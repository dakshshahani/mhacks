// packages/contracts/src/mocks/mockAgent.ts — deterministic CodeAgent stub.
// G1/G2 run on this. Returns truthful-shaped mock results; no I/O.

import type { CodeAgent, EditRequest, EditResult } from "../agent";

export class MockAgent implements CodeAgent {
  submitEdit(req: EditRequest): Promise<EditResult> {
    const filePath = req.target.filePath;
    return Promise.resolve({
      id: req.id,
      status: "applied",
      filesChanged: filePath ? [filePath] : [],
      commitSha: "mock-sha-001",
      durationMs: 42,
      hotReloaded: true,
    });
  }
}

export const mockAgent: CodeAgent = new MockAgent();
