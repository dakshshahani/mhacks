// @mhacks/shell — Dev C public surface. Shell owns side effects; it never
// decides intent/target/route (those arrive inside EditRequest from Dev B).
// Each capability module re-exports itself here as it lands.
export * from "./tier1";
export * from "./git";
