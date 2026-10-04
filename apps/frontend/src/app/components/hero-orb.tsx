// Shared hero orb — the marbled globe from the landing page. Figma source
// is an animated code-component gradient; this approximates one frame with
// morphing metaballs. Extracted here so About renders literally the same orb.
export default function Orb() {
  return (
    <div className="animate-orb-breathe relative h-[315px] w-[315px] overflow-hidden rounded-full bg-[#a9abdd]">
      <div className="animate-orb-spin absolute -inset-8">
        <div className="animate-orb-a absolute left-[6%] top-[4%] h-[46%] w-[44%] rounded-full bg-[#2a28b8] blur-md" />
        <div className="animate-orb-b absolute bottom-[4%] right-[6%] h-[52%] w-[48%] rounded-full bg-[#2e2cc2] blur-md" />
        <div className="animate-orb-c absolute left-[26%] top-[24%] h-[44%] w-[44%] rounded-full bg-[#4a58bf] blur-md" />
        <div className="animate-orb-b absolute left-[4%] top-[44%] h-[32%] w-[30%] rounded-full bg-[#2323a8] blur-md" />
        <div className="animate-orb-a absolute right-[8%] top-[30%] h-[30%] w-[34%] rounded-full bg-[#57c6c0] blur-md" />
        <div className="animate-orb-c absolute bottom-[34%] left-[16%] h-[13%] w-[48%] rounded-full bg-[#f2f3fa] blur-lg" />
        <div
          className="animate-orb-a absolute bottom-[16%] right-[14%] h-[11%] w-[40%] rounded-full bg-[#eef0fa] blur-lg"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="animate-orb-a absolute left-[42%] top-[6%] h-[30%] w-[26%] rounded-full bg-[#7c7fd0] blur-md"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="animate-orb-b absolute bottom-[30%] right-[30%] h-[22%] w-[26%] rounded-full bg-[#8fd6d4] blur-md"
          style={{ animationDelay: "-11s" }}
        />
        <div
          className="animate-orb-c absolute left-[10%] top-[16%] h-[24%] w-[22%] rounded-full bg-[#57c6c0] blur-lg"
          style={{ animationDelay: "-4s" }}
        />
      </div>
      <div className="absolute inset-0 rounded-full shadow-[inset_-16px_-22px_55px_rgba(20,20,90,0.4),inset_12px_16px_45px_rgba(255,255,255,0.3)]" />
    </div>
  );
}
