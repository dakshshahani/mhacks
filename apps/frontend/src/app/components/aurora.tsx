// Aurora backdrop — Figma "gaze / Method chooser" background Vector 1
// (340:4263; same asset on the Upload chooser, 340:3858): 902×692 at
// x167 y133 with a 100px layer blur. Teal/mint crown up top, periwinkle
// body across the cards, deep-violet base, soft white glows at both edges.
// The Figma source is an animated code-component gradient; this approximates
// it with five blurred elliptical lobes, each on three nested loops that
// stay on separate elements so they never fight over `transform`:
//   outer — drift (slow translate, 26–42s)
//   middle — spin (slow rotate, 70–120s, alternating direction; visible
//     because every lobe is elliptical)
//   inner — breathe (scale + opacity pulse, 9–15s, desynced per lobe)
// Static when the user prefers reduced motion (see globals.css).
export default function AuroraBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-[167px] top-[133px] h-[692px] w-[902px]"
    >
      {/* crown: mint/teal, hottest at the top-center */}
      <div className="animate-aurora-a absolute left-[211px] top-0 h-[320px] w-[480px]">
        <div className="animate-aurora-spin h-full w-full" style={{ animationDuration: "90s" }}>
          <div
            className="animate-aurora-breathe h-full w-full rounded-full blur-[50px]"
            style={{
              animationDuration: "9s",
              background:
                "radial-gradient(closest-side, rgb(225 255 250 / 0.95), rgb(168 240 232 / 0.75) 45%, transparent 72%)",
            }}
          />
        </div>
      </div>
      {/* body: periwinkle wash across the cards */}
      <div className="animate-aurora-b absolute left-[71px] top-[120px] h-[440px] w-[760px]">
        <div
          className="animate-aurora-spin-rev h-full w-full"
          style={{ animationDuration: "120s" }}
        >
          <div
            className="animate-aurora-breathe h-full w-full rounded-full blur-[70px]"
            style={{
              animationDuration: "14s",
              animationDelay: "-6s",
              background:
                "radial-gradient(closest-side, rgb(120 124 220 / 0.8), transparent 72%)",
            }}
          />
        </div>
      </div>
      {/* base: deep violet pooling under the cards */}
      <div className="animate-aurora-c absolute left-[141px] top-[292px] h-[400px] w-[620px]">
        <div className="animate-aurora-spin h-full w-full" style={{ animationDuration: "100s" }}>
          <div
            className="animate-aurora-breathe h-full w-full rounded-full blur-[70px]"
            style={{
              animationDuration: "12s",
              animationDelay: "-4s",
              background:
                "radial-gradient(closest-side, rgb(66 56 220 / 0.85), transparent 72%)",
            }}
          />
        </div>
      </div>
      {/* side glows: soft white at card mid-height */}
      <div className="animate-aurora-b absolute left-0 top-[200px] h-[360px] w-[280px]" style={{ animationDelay: "-12s" }}>
        <div
          className="animate-aurora-spin-rev h-full w-full"
          style={{ animationDuration: "70s" }}
        >
          <div
            className="animate-aurora-breathe h-full w-full rounded-full blur-[50px]"
            style={{
              animationDuration: "11s",
              animationDelay: "-2s",
              background:
                "radial-gradient(closest-side, rgb(255 255 255 / 0.5), transparent 70%)",
            }}
          />
        </div>
      </div>
      <div className="animate-aurora-a absolute right-0 top-[200px] h-[360px] w-[280px]" style={{ animationDelay: "-9s" }}>
        <div className="animate-aurora-spin h-full w-full" style={{ animationDuration: "80s" }}>
          <div
            className="animate-aurora-breathe h-full w-full rounded-full blur-[50px]"
            style={{
              animationDuration: "15s",
              animationDelay: "-8s",
              background:
                "radial-gradient(closest-side, rgb(255 255 255 / 0.45), transparent 70%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
