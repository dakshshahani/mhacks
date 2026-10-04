/* Ground truth: Figma Pricing Page "MacBook Air - 1" (1280×832).
   Page header x98 y132 (24px title + 14px sub). Table x84 y237 1129×514:
   prices 20px above tier names (Free $0 / Pro $20 / BYOK $8), names 24px,
   taglines 14px, 7 feature rows (14px labels + dividers, 18px values),
   footer 12px. Tier columns arched (stadium tops per the Union shapes).
   Plan actions (current-plan pill, Upgrade, Add-key, popup) are a client
   island; the table shell stays a server component. */
import { Check, X } from "lucide-react";
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";
import PlanActions from "./actions";

const TIERS = [
  { name: "Free", price: "$0/mo", tagline: "Try building by looking and talking." },
  { name: "Pro", price: "$20/mo", tagline: "For people who build every week." },
  { name: "BYOK", price: "$8/mo", tagline: "Use your own API key, with no credit limits." },
];

type Cell = { kind: "text"; text: string } | { kind: "check" } | { kind: "x" };
const text = (text: string): Cell => ({ kind: "text", text });
const check: Cell = { kind: "check" };
const x: Cell = { kind: "x" };

const ROWS: { label: string; values: [Cell, Cell, Cell] }[] = [
  { label: "Credits per month", values: [text("50"), text("1,000"), text("Unlimited")] },
  { label: "Number of projects", values: [text("1 active"), text("Unlimited"), text("Unlimited")] },
  { label: "Eye tracking", values: [check, check, check] },
  { label: "Voice commands", values: [check, check, check] },
  { label: "Version history", values: [text("For last 5 changes"), text("Full history"), text("Full history")] },
  { label: "Community support", values: [check, check, check] },
  { label: "Email support", values: [x, check, check] },
];

function ValueCell({ cell }: { cell: Cell }) {
  if (cell.kind === "check") {
    return <Check size={24} aria-label="Included" className="text-[#f5f7f7]" />;
  }
  if (cell.kind === "x") {
    return <X size={24} aria-label="Not included" className="text-[#c5cad3]" />;
  }
  return <span className="text-[18px] font-normal leading-[26px] text-[#f5f7f7]">{cell.text}</span>;
}

export default function PricingPage() {
  return (
    <main className="min-h-dvh bg-[#0a0a0a] text-white">
      <ScaleStage>
        {/* blueprint grid */}
        <div aria-hidden className="bg-blueprint-grid pointer-events-none absolute inset-0" />
        {/* header fade: 220px #0A0A0A@0.94 → transparent */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-gradient-to-b from-[#0a0a0a]/95 to-transparent"
        />
        <SiteHeader />

        {/* page header: x98 y132 */}
        <div className="absolute left-[98px] top-[132px] w-[435px]">
          <h1 className="text-[24px] font-normal leading-[35px] text-[#f5f7f7]">
            Simple pricing. Pay for what you build.
          </h1>
          <p className="mt-[8px] max-w-[364px] text-[14px] font-normal leading-5 text-[#c5cad3]">
            One credit is roughly one change to your design. Start free and upgrade when you need
            more.
          </p>
        </div>

        {/* table: x84 y237 1129×514 */}
        <section aria-label="Plans" className="absolute left-[84px] top-[237px] h-[514px] w-[1129px]">
          {/* tier column backplates with stadium tops (Union rect+ellipse) */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {[495, 733, 965].map((x) => (
              <div
                key={x}
                className="absolute top-[-57px] h-[571px] w-[191px] rounded-t-[95px] rounded-b-[24px] bg-gradient-to-b from-white/[0.09] via-[#1d1d1d]/60 to-[#1d1d1d]/90 shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)]"
                style={{ left: x - 84 }}
              />
            ))}
          </div>

          {/* tier headers: price / name / tagline */}
          <div className="absolute left-[411px] top-[-38px] flex w-[661px] justify-between">
            {TIERS.map((tier) => (
              <div key={tier.name} className="flex w-[191px] flex-col items-center text-center">
                <p className="text-[20px] font-normal leading-[29px] text-[#f5f7f7]">{tier.price}</p>
                <h2 className="mt-[20px] text-[24px] font-normal leading-[35px] text-[#f5f7f7]">{tier.name}</h2>
                <p className="mt-[8px] max-w-[149px] text-[14px] font-normal leading-5 text-[#c5cad3]">
                  {tier.tagline}
                </p>
              </div>
            ))}
          </div>

          {/* feature rows */}
          <div className="absolute left-[33px] top-[95px] w-[1029px]">
            {ROWS.map((row) => (
              <div
                key={row.label}
                className="flex h-[53px] items-center border-b border-white/10"
              >
                <p className="w-[325px] shrink-0 text-[14px] font-normal leading-5 text-[#f5f7f7]">
                  {row.label}
                </p>
                {row.values.map((cell, i) => (
                  <div key={i} className="flex w-[191px] shrink-0 items-center justify-center">
                    <ValueCell cell={cell} />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* footer note */}
          <p className="absolute left-[33px] top-[481px] text-[12px] font-normal leading-[17px] text-[#c5cad3]">
            Cancel any time. Your projects are always yours.
          </p>
        </section>

        <PlanActions />
      </ScaleStage>
    </main>
  );
}
