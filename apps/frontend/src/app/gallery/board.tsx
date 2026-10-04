'use client';

/* Project gallery board (client island): rows of tiles, count line, create.
   Frame geometry in 1280×832 coordinates — backplate x110 y281 1060×424,
   rows of 5 items (196×128, 20px gaps), actions bar y740. Tile sub-line
   (path · edited) is the voted delta over Figma's name-only tile.
   List is a live harness scan (~/Documents/Projects, runnable dirs only).
   Click = supervisor spawns `pnpm dev` (single-active) → navigate to the
   workspace with the preview URL. */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import {
  fetchProjects,
  getSelectionServerSnapshot,
  getSelectionSnapshot,
  openProject,
  saveSelectedId,
  subscribeGallery,
  type Project,
} from "../lib/projects";
import { projectHref } from "../project-url";

function Tile({
  project,
  selected,
  opening,
  dimmed,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  opening: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={opening || dimmed}
      aria-pressed={selected}
      title={`${project.name} — ${project.path} · edited ${project.lastEdited}`}
      className={`group flex h-[128px] w-[196px] shrink-0 flex-col rounded-[12px] p-[10px] text-left transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        selected ? "ring-2 ring-white/70 bg-white/[0.07]" : "hover:bg-white/[0.05]"
      } ${dimmed && !opening ? "opacity-40" : ""} disabled:cursor-wait`}
    >
      <span
        aria-hidden
        className="flex h-[72px] w-[176px] items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.06] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]"
      >
        {opening && <Loader2 size={20} className="animate-spin text-white/70" aria-hidden />}
      </span>
      <span className="mt-[8px] block w-[176px] truncate text-[16px] font-normal leading-6 text-[#f5f7f7]">
        {opening ? `Starting ${project.name}…` : project.name}
      </span>
      <span className="block w-[176px] truncate text-[12px] font-normal leading-[14px] text-[#c5cad3]/70">
        {project.framework} · {project.lastEdited}
      </span>
    </button>
  );
}

export default function GalleryBoard() {
  const router = useRouter();
  const selectedId = useSyncExternalStore(subscribeGallery, getSelectionSnapshot, getSelectionServerSnapshot);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setProjects(await fetchProjects());
    } catch (err) {
      setProjects([]);
      setLoadError(err instanceof Error ? err.message : "Could not reach the harness. Start it on :5173, then retry.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const select = async (project: Project) => {
    if (openingId !== null) return;
    setOpeningId(project.id);
    setOpenError("");
    saveSelectedId(project.id);
    try {
      const active = await openProject(project.name);
      router.push(projectHref(project.name, active.previewUrl));
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : `Could not start "${project.name}".`);
      setOpeningId(null);
    }
  };

  const rows: Project[][] = [];
  const list = projects ?? [];
  for (let i = 0; i < list.length; i += 5) rows.push(list.slice(i, i + 5));
  const count = list.length;
  const countLabel =
    projects === null
      ? "Scanning your workspace…"
      : `${count} project${count === 1 ? "" : "s"} in your workspace`;

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
          {projects === null ? (
            <p className="flex h-full items-center justify-center gap-2 text-[15px] text-[#c5cad3]">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Scanning ~/Documents/Projects…
            </p>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <p className="max-w-[520px] text-[15px] leading-6 text-[#f5f7f7]">{loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-[12px] bg-white/[0.08] px-4 py-2 text-[15px] text-[#f5f7f7] transition hover:bg-white/[0.14]"
              >
                Retry scan
              </button>
            </div>
          ) : (
            rows.map((row, ri) => (
              <div key={ri} className="flex gap-[20px]" style={{ marginTop: ri === 0 ? 0 : 20 }}>
                {row.map((p) => (
                  <Tile
                    key={p.id}
                    project={p}
                    selected={p.id === selectedId}
                    opening={p.id === openingId}
                    dimmed={openingId !== null}
                    onSelect={() => void select(p)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </section>
      <div className="absolute left-[110px] top-[740px] flex h-[52px] w-[1060px] items-center justify-between">
        <p className="max-w-[760px] truncate text-[15px] font-normal leading-[22px] text-[#f5f7f7]">
          {openError ? openError : countLabel}
        </p>
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
