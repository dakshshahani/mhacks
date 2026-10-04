'use client';

/* Account board (client island): profile card with avatar, name, and email.
   No auth backend — the profile persists to localStorage ("gaze:profile")
   so it survives reloads. The workspace shell already greets "Anna K.",
   so that is the default name; email starts blank. Avatar accepts an image
   upload (stored as a data URL) with an initial-letter fallback. */

import { useEffect, useState } from "react";
import { Camera } from "lucide-react";

const PROFILE_KEY = "gaze:profile";

interface Profile {
  name: string;
  email: string;
  avatar: string;
}

const DEFAULTS: Profile = { name: "Anna K.", email: "", avatar: "" };

function loadProfile(): Profile {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Profile>;
    return {
      name: typeof parsed.name === "string" && parsed.name ? parsed.name : DEFAULTS.name,
      email: typeof parsed.email === "string" ? parsed.email : "",
      avatar: typeof parsed.avatar === "string" ? parsed.avatar : "",
    };
  } catch {
    return DEFAULTS;
  }
}

export default function AccountBoard() {
  const [profile, setProfile] = useState<Profile>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate persisted profile on mount
    setProfile(loadProfile());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Storage full/blocked — profile still holds for this session.
    }
  }, [profile, ready]);

  const onAvatar = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setProfile((p) => ({ ...p, avatar: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const initial = (profile.name.trim()[0] ?? "A").toUpperCase();

  return (
    <section
      aria-label="Account information"
      className="absolute left-[440px] top-[330px] w-[400px] rounded-[24px] bg-gradient-to-b from-[#666666]/40 via-[#1d1d1d]/90 to-[#1d1d1d] p-[32px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),inset_0_0_22px_rgba(255,255,255,0.12)] backdrop-blur-[40px]"
    >
      <div className="flex items-center gap-[20px]">
        <label className="group relative block cursor-pointer" title="Upload a profile photo">
          {profile.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- local data-URL avatar, not an optimized asset
            <img
              src={profile.avatar}
              alt="Profile photo"
              className="h-[96px] w-[96px] rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-[96px] w-[96px] items-center justify-center rounded-full text-[40px] font-light italic text-white"
              style={{
                backgroundImage: "radial-gradient(circle at 50% 50%, #4a58bf, #4cbbc1)",
              }}
            >
              {initial}
            </span>
          )}
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <Camera size={22} className="text-white" />
          </span>
          <input
            type="file"
            accept="image/*"
            aria-label="Upload a profile photo"
            className="sr-only"
            onChange={(e) => {
              onAvatar(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <div className="min-w-0">
          <p className="truncate text-[24px] font-normal leading-8 text-[#f5f7f7]">
            {profile.name || "Your name"}
          </p>
          <p className="mt-[4px] truncate text-[15px] font-normal leading-6 text-[#c5cad3]">
            {profile.email || "Add your email below"}
          </p>
        </div>
      </div>

      <label className="mt-[24px] block text-[13px] font-normal leading-5 text-[#c5cad3]">
        Name
        <input
          value={profile.name}
          onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
          placeholder="Your name"
          autoComplete="name"
          className="mt-[6px] h-[44px] w-full rounded-[12px] bg-white/[0.06] px-[14px] text-[16px] font-normal leading-6 text-[#f5f7f7] outline-none placeholder:text-[#a5adba] focus-visible:ring-2 focus-visible:ring-white/70"
        />
      </label>
      <label className="mt-[16px] block text-[13px] font-normal leading-5 text-[#c5cad3]">
        Email
        <input
          value={profile.email}
          onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
          className="mt-[6px] h-[44px] w-full rounded-[12px] bg-white/[0.06] px-[14px] text-[16px] font-normal leading-6 text-[#f5f7f7] outline-none placeholder:text-[#a5adba] focus-visible:ring-2 focus-visible:ring-white/70"
        />
      </label>
    </section>
  );
}
