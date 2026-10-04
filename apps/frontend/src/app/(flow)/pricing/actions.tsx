'use client';

/* Pricing plan actions (client island): bottom action row per tier column +
   the demo popup. Current plan is hardcoded until billing exists.
   Popup: custom glass (no library modal), backdrop/Esc/X dismiss, focus
   returns to the invoking button, no persistence, no network. */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { COLUMNS, COLUMN_WIDTH } from "./columns";

// TODO(billing): source from auth/entitlements when accounts exist.
const CURRENT_PLAN = "Free" as const;

const PILL =
  "flex h-[37px] w-[154px] items-center justify-center text-[16px] font-normal leading-[22px] outline-none transition focus-visible:ring-2 focus-visible:ring-white/70";

function DemoPopup({ message, onClose }: { message: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="presentation">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Demo notice"
        className="relative w-[400px] max-w-[calc(100vw-48px)] rounded-[24px] bg-[#1d1d1d]/90 p-[32px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute right-[16px] top-[16px] flex h-[32px] w-[32px] items-center justify-center rounded-full text-[#c5cad3] transition hover:text-[#f5f7f7]"
        >
          <X size={18} aria-hidden />
        </button>
        <p className="pr-[24px] text-[16px] font-normal leading-6 text-[#f5f7f7]">
          {message}
        </p>
        <div className="mt-[24px] flex justify-end">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="flex h-[37px] items-center justify-center rounded-[18px] bg-white/[0.12] px-[24px] text-[16px] font-normal leading-[22px] text-[#f5f7f7] outline-none transition hover:bg-white/[0.2] focus-visible:ring-2 focus-visible:ring-white/70"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PlanActions() {
  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  const openWith = useCallback(
    (message: string) => (e: React.MouseEvent<HTMLElement>) => {
      invokerRef.current = e.currentTarget;
      setPopupMessage(message);
    },
    [],
  );

  const close = useCallback(() => {
    setPopupMessage(null);
    invokerRef.current?.focus();
  }, []);

  return (
    <>
      <div className="absolute top-[698px] flex w-[661px]" style={{ left: COLUMNS[0] }}>
        <div className="flex shrink-0 justify-center" style={{ width: COLUMN_WIDTH }}>
          <button
            type="button"
            onClick={openWith("Enjoy building with Gaze for free.")}
            aria-haspopup="dialog"
            aria-label={`Your current plan: ${CURRENT_PLAN}`}
            title="Your current plan"
            className={`${PILL} rounded-[18px] bg-[#5D58E9] text-white transition hover:bg-[#6d63f0]`}
          >
            Your current plan
          </button>
        </div>
        <div className="flex shrink-0 justify-center" style={{ width: COLUMN_WIDTH, marginLeft: 44 }}>
          <button
            type="button"
            onClick={openWith("We'd like your money, but unfortunately, this is just a demo.")}
            aria-haspopup="dialog"
            className={`${PILL} rounded-[18px] bg-white/[0.08] text-[#f5f7f7] transition hover:bg-white/[0.16]`}
          >
            Upgrade now
          </button>
        </div>
        <div className="flex shrink-0 justify-center" style={{ width: COLUMN_WIDTH, marginLeft: 44 }}>
          <button
            type="button"
            onClick={openWith("We'd like your money, but unfortunately, this is just a demo.")}
            aria-haspopup="dialog"
            className={`${PILL} rounded-[18px] bg-white/[0.08] text-[#f5f7f7] transition hover:bg-white/[0.16]`}
          >
            Add your key
          </button>
        </div>
      </div>
      {popupMessage !== null ? <DemoPopup message={popupMessage} onClose={close} /> : null}
    </>
  );
}
