'use client';

/* Project gallery board (client island): HiFi card grid, search, pagination.
   Frame geometry in 1280×832 coordinates — grid x56 y328 w1184, cards
   273×191 (32px gaps, 24px row gap), footer y770 (count + pagination pill),
   search bar x56 y246 240×38. First card is the create entry → /new.
   Runnable-only flat scan (top-level dirs with package.json + dev script).
   Live scan via /api/projects. */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Search } from "lucide-react";
import Link from "next/link";
import {
  fetchProjects,
  getSelectionServerSnapshot,
  getSelectionSnapshot,
  openProject,
  saveSelectedId,
  subscribeGallery,
  tooltipFresh,
  type Project,
} from "../lib/projects";
import { projectHref } from "../project-url";

const PAGE_SIZE = 8;

function CreateCard() {
  return (
    <Link
      href="/new"
      className="group flex h-[191px] w-[273px] shrink-0 flex-col rounded-[16px] bg-[#1d1d1d] p-[1px] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <span className="flex h-[137px] w-[271px] items-center justify-center rounded-t-[15px] border border-white/10 bg-white/[0.06]">
        <Plus size={28} aria-hidden className="text-[#c5cad3] transition group-hover:text-[#f5f7f7]" />
      </span>
      <span className="flex h-[52px] items-center px-[12px] text-[16px] font-normal leading-6 text-[#f5f7f7]">
        Create new project
      </span>
    </Link>
  );
}

function TileCard({
  project,
  selected,
  opening,
  busy,
  onSelect,
}: {
  project: Project;
  selected: boolean;
  opening: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const tipId = `project-tip-${project.id}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy}
      aria-pressed={selected}
      aria-describedby={tipId}
      title={`${project.name} — ${tooltipFresh(project).replace(/^Last updated: /, "edited ")}`}
      className={`group relative flex h-[191px] w-[273px] shrink-0 flex-col rounded-[16px] bg-[#1d1d1d] text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/70 ${
        selected ? "ring-2 ring-white/70" : ""
      } disabled:cursor-wait`}
    >
      <span className="relative block h-[137px] w-[273px] overflow-hidden rounded-t-[16px]">
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(70% 90% at 30% 15%, rgba(76,187,193,0.22), transparent 70%), radial-gradient(60% 85% at 75% 85%, rgba(74,88,191,0.25), transparent 70%), #262b33",
          }}
        />
        <span
          aria-hidden
          className="absolute inset-0"
          style={{ background: "linear-gradient(to bottom, transparent 55%, #1d1d1d 100%)" }}
        />
        {opening && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={22} className="animate-spin text-white/70" aria-hidden />
          </span>
        )}
        {/* HiFi profile tooltip: overlays against the top edge, width hugs text. */}
        <span
          role="tooltip"
          id={tipId}
          className="pointer-events-none absolute left-[12px] top-[12px] hidden h-[32px] max-w-[249px] items-center whitespace-nowrap rounded-[6px] bg-[#131519] px-[12px] font-[family-name:var(--font-inter)] text-[12px] font-normal leading-4 text-[#f5f6f7] group-hover:flex group-focus-visible:flex"
        >
          {tooltipFresh(project)}
        </span>
      </span>
      <span className="flex h-[54px] items-center gap-[6px] px-[12px]">
        <ArrowLeft
          size={14}
          aria-hidden
          className="shrink-0 text-[#c5cad3] opacity-0 transition group-hover:text-[#f5f7f7] group-hover:opacity-100 group-focus-visible:text-[#f5f7f7] group-focus-visible:opacity-100"
        />
        <span className="block truncate text-[16px] font-normal leading-6 text-[#f5f7f7]">
          {opening ? `Starting ${project.name}…` : project.name}
        </span>
      </span>
    </button>
  );
}

function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex h-[38px] w-[240px] items-center rounded-[10px] bg-[#282d35]">
      <span className="flex h-[38px] w-[52px] shrink-0 items-center justify-center" aria-hidden>
        <Search size={18} className="text-[#c5cad3]" />
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search…"
        aria-label="Search projects"
        className="h-full w-[188px] bg-transparent pr-[12px] text-[16px] font-normal leading-6 text-[#f5f7f7] outline-none placeholder:text-[#a5adba]"
      />
    </label>
  );
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const numbers = Array.from({ length: pages }, (_, i) => i + 1);
  return (
    <nav aria-label="Project pages" className="flex h-[32px] items-center gap-[4px] rounded-[16px] bg-white/[0.06] px-[6px]">
      {numbers.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPage(n)}
          aria-current={n === page ? "page" : undefined}
          aria-label={`Page ${n}`}
          className={`flex h-[24px] w-[54px] items-center justify-center rounded-[12px] text-[15px] font-normal leading-5 transition ${
            n === page ? "bg-white/[0.14] text-[#f5f7f7]" : "text-[#c5cad3] hover:text-[#f5f7f7]"
          }`}
        >
          {n}
        </button>
      ))}
    </nav>
  );
}

export default function GalleryBoard() {
  const router = useRouter();
  const selectedId = useSyncExternalStore(subscribeGallery, getSelectionSnapshot, getSelectionServerSnapshot);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async (cancel?: { cancelled: boolean }) => {
    setLoadError("");
    try {
      const next = await fetchProjects();
      if (cancel?.cancelled) return;
      setProjects(next);
    } catch (err) {
      if (cancel?.cancelled) return;
      setProjects([]);
      setLoadError(err instanceof Error ? err.message : "Could not reach the harness. Start it on :5173, then retry.");
    }
  }, []);

  // Initial scan on mount. State lands only from the async continuation
  // (never synchronously in setup) with cancellation on unmount.
  useEffect(() => {
    const cancel = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial scan must run on mount
    void load(cancel);
    return () => {
      cancel.cancelled = true;
    };
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects ?? [];
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
  }, [projects, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  // First tile is always the create entry (HiFi); project tiles paginate.
  const tiles = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const busy = openingId !== null;
  const renderTile = (p: Project) => (
    <TileCard
      key={p.id}
      project={p}
      selected={p.id === selectedId}
      opening={p.id === openingId}
      busy={busy}
      onSelect={() => void select(p)}
    />
  );
  const count = filtered.length;
  const countLabel =
    projects === null
      ? "Scanning your workspace…"
      : `${count} project${count === 1 ? "" : "s"} in your workspace`;

  return (
    <>
      <div className="absolute left-[56px] top-[246px]">
        <SearchBar value={query} onChange={(v) => { setQuery(v); setPage(1); }} />
      </div>
      <section aria-label="Project gallery" className="absolute left-[56px] top-[328px] h-[406px] w-[1184px]">
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
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              {projects.length === 0 ? (
                <>
                  <p className="max-w-[560px] text-[16px] leading-6 text-[#f5f7f7]">
                    No runnable projects found in ~/Documents/Projects.
                  </p>
                  <p className="max-w-[560px] text-[14px] leading-5 text-[#c5cad3]">
                    To open a folder here it needs a package.json with a dev script.
                  </p>
                </>
              ) : (
                <p className="text-[15px] leading-6 text-[#c5cad3]">
                  No projects match “{query.trim()}”.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex gap-[32px]">
                <CreateCard />
                {tiles.slice(0, 3).map(renderTile)}
              </div>
              {tiles.length > 3 && (
                <div className="flex gap-[32px]" style={{ marginTop: 24 }}>
                  {tiles.slice(3).map(renderTile)}
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <div className="absolute left-[60px] top-[770px] flex h-[32px] w-[1184px] items-center justify-between">
        <p className="max-w-[760px] truncate text-[15px] font-normal leading-[22px] text-[#f5f7f7]">
          {openError ? openError : countLabel}
        </p>
        <Pagination page={safePage} pages={pages} onPage={setPage} />
      </div>
    </>
  );
}
