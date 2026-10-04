'use client';

/* Upload source board (client island): two 336×288 cards on the 696
   backplate. Local project opens the directory picker and persists the
   folder NAME ONLY (no reads, no server) via the gallery store; its CTA
   becomes Continue → /gallery. Git repo is a deliberate dead-end per the
   locked import cut. */

import { useState } from "react";
import Link from "next/link";
import { Command, GitBranch } from "lucide-react";
import { saveCustomProject } from "../lib/projects";

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
  }
}

const CARD =
  "group flex h-[288px] w-[336px] shrink-0 flex-col rounded-[24px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] p-[28px] text-left shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70";

function CardShell({ children }: { children: React.ReactNode }) {
  return <div className={CARD}>{children}</div>;
}

function CardHead({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <>
      <span aria-hidden className="block text-[#f5f7f7]">
        {icon}
      </span>
      <span className="mt-[14px] block text-[16px] font-normal leading-6 text-[#f5f7f7]">{title}</span>
      <span className="mt-[4px] block text-[16px] font-normal leading-6 text-[#c5cad3]">{description}</span>
    </>
  );
}

export default function ImportBoard() {
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pickFolder = async () => {
    setNotice(null);
    if (typeof window === "undefined" || typeof window.showDirectoryPicker !== "function") {
      setNotice("Folder picking needs Chrome or Edge — type the project name instead.");
      return;
    }
    let handle: FileSystemDirectoryHandle | null = null;
    try {
      handle = await window.showDirectoryPicker({ mode: "read" });
    } catch (err) {
      // AbortError = user cancelled the dialog: silent by design.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setNotice("Couldn't open the picker. Type the project name instead.");
      return;
    }
    if (!handle) return;
    saveCustomProject({ name: handle.name, path: handle.name });
    setPickedName(handle.name);
  };

  return (
    <div className="absolute inset-0 flex gap-[24px]">
      <CardShell>
        <CardHead
          icon={<Command size={24} aria-hidden />}
          title="Local project"
          description="Upload a project folder or ZIP from your computer."
        />
        <span className="mt-auto block pt-[16px] text-[16px] font-normal leading-6 text-[#f5f7f7]">
          {pickedName ? (
            <Link href="/gallery" className="outline-none focus-visible:underline">
              <span aria-hidden className="text-[#4cbbc1]">✓ </span>
              {pickedName} — Continue <span aria-hidden>→</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={pickFolder}
              className="cursor-pointer outline-none focus-visible:underline"
            >
              Browse files <span aria-hidden>→</span>
            </button>
          )}
        </span>
        {notice ? (
          <span role="status" className="block pt-[8px] text-[14px] font-normal leading-5 text-[#c5cad3]">
            {notice}
          </span>
        ) : null}
      </CardShell>
      <CardShell>
        <CardHead
          icon={<GitBranch size={24} aria-hidden />}
          title="Git repo"
          description="Import your code directly from a Git repository."
        />
        <span className="mt-auto block pt-[16px] text-[16px] font-normal leading-6 text-[#c5cad3]">
          Connect repository <span aria-hidden>→</span>
        </span>
      </CardShell>
    </div>
  );
}
