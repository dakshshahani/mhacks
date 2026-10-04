/* Ground truth: Figma Pricing Page "MacBook Air - 1" (1280×832).
   Page header x98 y132 (24px title + 14px sub). Table x84 y237 1129×514:
   solid #131519 r32 base (labels→Pro) + shared glass overlay + tier
   overlays with elliptical caps (191×105, translucent, no drop shadows).
   Columns EVEN at 495/730/965 per review (Figma's 47/41 gutters
   deliberately evened); all text centered in-column. Prices 20px above
   tier names (Free $0 / Pro $20 / BYOK $8), 7 feature rows, footer 12px.
   Plan actions are a client island; the table shell stays server. */
import { Check, X } from "lucide-react";
import ScaleStage from "../stage";
import SiteHeader from "../components/site-header";
import PlanActions from "./actions";
import { COLUMNS, COLUMN_WIDTH } from "./columns";

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
          {/* solid base: labels→Pro, #131519 r32 */}
          <div aria-hidden className="absolute left-0 top-0 h-[514px] w-[881px] rounded-[32px] bg-[#131519]" />
          {/* shared glass overlay across all three tier columns.
              Sharp corners per Figma (no radius): its straight left edge is
              the separator between the labels area and Free. No tier
              containers — the Unions read as nothing discrete, so none are
              drawn; content + glass carry the column structure. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-[378px] top-0 h-[514px] w-[714px] rounded-br-[32px] rounded-tr-[32px] bg-[#1d1d1d]/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),inset_0_0_22px_rgba(255,255,255,0.08)] backdrop-blur-[40px]"
          />

          {/* table header: "Pricing" + sub at x117 y253 */}
          <div className="absolute left-[33px] top-[16px] w-[408px]">
            <h2 className="text-[24px] font-normal leading-[35px] text-[#f5f7f7]">Pricing</h2>
            <p className="mt-[6px] text-[14px] font-normal leading-5 text-[#c5cad3]">
              Choose the plan that fits your workflow.
            </p>
          </div>

          {/* tier headers: price / name / tagline, centered per column */}
          <div className="absolute left-[411px] top-[-38px] flex w-[661px]">
            {COLUMNS.map((x, i) => {
              const tier = TIERS[i];
              if (!tier) return null;
              return (
                <div
                  key={tier.name}
                  className="flex shrink-0 flex-col items-center text-center"
                  style={{ width: COLUMN_WIDTH, marginLeft: i === 0 ? 0 : 44 }}
                >
                  <p className="text-[20px] font-normal leading-[29px] text-[#f5f7f7]">{tier.price}</p>
                  <h2 className="mt-[20px] text-[24px] font-normal leading-[35px] text-[#f5f7f7]">{tier.name}</h2>
                  <p className="mt-[8px] max-w-[149px] text-[14px] font-normal leading-5 text-[#c5cad3]">
                    {tier.tagline}
                  </p>
                </div>
              );
            })}
          </div>

          {/* feature rows: dividers run labels-only in Figma (x117 w325),
              so the border lives on the label cell, not the row */}
          <div className="absolute left-[33px] top-[95px] w-[1039px]">
            {ROWS.map((row) => (
              <div
                key={row.label}
                className="flex h-[53px] items-center"
              >
                <p className="w-[325px] shrink-0 border-b border-white/10 pb-[8px] text-[14px] font-normal leading-5 text-[#f5f7f7]">
                  {row.label}
                </p>
                {row.values.map((cell, i) => (
                  <div
                    key={i}
                    className="flex w-[191px] shrink-0 items-center justify-center"
                    style={{ marginLeft: i === 0 ? 53 : 44 }}
                  >
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
