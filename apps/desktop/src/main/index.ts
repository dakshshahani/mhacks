// Electron entry. Dev and packaged both run the esbuild bundle
// (dist-electron/main.mjs); this source only survives for tsc. app.ts holds
// the real main. No resolve hook here: the bundler resolves extensionless
// workspace imports at build time (and the hook file doesn't ship).
await import("./app");

export {};
