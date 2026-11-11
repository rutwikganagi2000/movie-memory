"use client";

import Image from "next/image";
import { useState } from "react";

function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source[0];
  return letters.toUpperCase();
}

/** Google photo when available; falls back to initials if missing or it fails to load. */
export function Avatar({
  image,
  name,
  email,
}: {
  image: string | null;
  name: string | null;
  email: string | null;
}) {
  const [failed, setFailed] = useState(false);

  if (image && !failed) {
    return (
      <Image
        src={image}
        alt={name ? `${name}'s profile photo` : "Profile photo"}
        width={64}
        height={64}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-16 w-16 rounded-full object-cover ring-2 ring-white"
      />
    );
  }

  return (
    <div
      aria-label="Profile initials"
      className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-xl font-semibold text-indigo-700"
    >
      {initials(name, email)}
    </div>
  );
}
