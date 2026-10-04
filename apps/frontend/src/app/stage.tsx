'use client';

import { useEffect, useState, type ReactNode } from 'react';

const STAGE_W = 1280;
const STAGE_H = 832;

/** Fit-inside scaling stage: the 1280×832 Figma frame scales uniformly to
 *  fit the viewport (never crops, never blows up past the fit), centered
 *  with letterboxing — exactly how Figma presents the frame. */
export default function ScaleStage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () =>
      setScale(
        Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H),
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return (
    <div
      className="relative grid h-dvh w-full place-items-center overflow-hidden bg-[#0a0a0a]"
    >
      <div
        className="relative shrink-0 overflow-hidden"
        style={{
          width: STAGE_W * scale,
          height: STAGE_H * scale,
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: STAGE_W,
            height: STAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
