// packages/contracts/src/index.ts — single entry point; every other package
// imports ONLY from here, never sibling files directly.
export * from "./gaze";
export * from "./agent";
export * from "./decision";
export * from "./ipc";
export * from "./mocks/index";
