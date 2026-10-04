'use client';

/* Project gallery board (client island): rows of tiles, count line, create.
   Frame geometry in 1280×832 coordinates — backplate x110 y281 1060×424,
   rows of 5 items (196×128, 20px gaps), actions bar y740. Tile sub-line
   (path · edited) is the voted delta over Figma's name-only tile. */

import { useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import {
  getProjectsServerSnapshot,
  getProjectsSnapshot,
  getSelectionServerSnapshot,
  getSelectionSnapshot,
  saveSelectedId,
  type Project,
  subscribeGallery,
} from "../lib/projects";

function Tile({ project, selected, onSelect }: { project: Project; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={`${project.name} — ${project.path} · edited ${project.lastEdited}`}
      className={`group flex h-[128px] w-[196px] shrink-0 flex-col rounded-[12px] p-[10px] text-left transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        selected ? "ring-2 ring-white/70 bg-white/[0.07]" : "hover:bg-white/[0.05]"
      }`}
    >
      <span
        aria-hidden
        className="block h-[72px] w-[176px] rounded-[8px] border border-white/10 bg-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]"
      />
      <span className="mt-[8px] block w-[176px] truncate text-[16px] font-normal leading-6 text-[#f5f7f7]">
        {project.name}
      </span>
      <span className="block w-[176px] truncate text-[12px] font-normal leading-[14px] text-[#c5cad3]/70">
        {project.path} · {project.lastEdited}
      </span>
    </button>
  );
}

export default function GalleryBoard() {
  const projects = useSyncExternalStore(subscribeGallery, getProjectsSnapshot, getProjectsServerSnapshot);
  const selectedId = useSyncExternalStore(subscribeGallery, getSelectionSnapshot, getSelectionServerSnapshot);

  const select = (id: string) => saveSelectedId(id);

  const rows: Project[][] = [];
  for (let i = 0; i < projects.length; i += 5) rows.push(projects.slice(i, i + 5));
  const count = projects.length;
  const countLabel = `${count} project${count === 1 ? "" : "s"} in your workspace`;

  return (
    <>
      <section aria-label="Project gallery" className="absolute left-[110px] top-[281px] h-[424px] w-[1060px]">
        <div className="absolute inset-0 rounded-[28px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{
              background:
                "radial-gradient(60% 90% at 30% 20%, rgba(76,187,193,0.14), transparent 70%), radial-gradient(50% 80% at 75% 80%, rgba(74,88,191,0.16), transparent 70%)",
            }}
          />
        </div>
        <div className="absolute inset-0 overflow-y-auto">
          {rows.map((row, ri) => (
            <div key={ri} className="flex gap-[20px]" style={{ marginTop: ri === 0 ? 0 : 20 }}>
              {row.map((p) => (
                <Tile key={p.id} project={p} selected={p.id === selectedId} onSelect={() => select(p.id)} />
              ))}
            </div>
          ))}
        </div>
      </section>
      <div className="absolute left-[110px] top-[740px] flex h-[52px] w-[1060px] items-center justify-between">
        <p className="text-[15px] font-normal leading-[22px] text-[#f5f7f7]">{countLabel}</p>
        <a
          href="/new"
          className="flex h-[52px] w-[164px] items-center justify-center gap-2 rounded-[12px] text-[18px] font-normal leading-7 text-[#f5f7f7] transition-opacity hover:opacity-75"
        >
          <Plus size={20} aria-hidden />
          Create new
        </a>
      </div>
    </>
  );
}
