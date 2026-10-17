/**
 * CategoryIcon — one custom line icon per tool category, tinted with the
 * category colour (brighter in dark mode via .tool-icon).
 */
import type { CSSProperties, ReactNode } from "react";
import { getCategoryById } from "@/lib/categories";
import { cn } from "@/lib/utils";

const GLYPH: Record<string, ReactNode> = {
  organize: (
    <>
      <rect x="3.5" y="4" width="7" height="8" rx="1.6" fill="currentColor" fillOpacity=".15" />
      <rect x="13.5" y="4" width="7" height="8" rx="1.6" />
      <rect x="3.5" y="14" width="7" height="6.5" rx="1.6" />
      <rect x="13.5" y="14" width="7" height="6.5" rx="1.6" fill="currentColor" fillOpacity=".15" />
    </>
  ),
  optimize: (
    <>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="m12 16 4-5" />
      <circle cx="12" cy="16" r="1.6" fill="currentColor" />
      <path d="M6.5 20.5h11" strokeOpacity=".5" />
    </>
  ),
  "convert-to": (
    <>
      <path d="M11 3.5h5.5l3.5 3.5v11.5a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-3" fill="currentColor" fillOpacity=".12" />
      <path d="M16.5 3.5V7h3.5" />
      <path d="M2.5 11.5h9m-3-3 3 3-3 3" />
    </>
  ),
  "convert-from": (
    <>
      <path d="M5 3.5h5.5L14 7v4M14 16v2.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2" fill="currentColor" fillOpacity=".12" />
      <path d="M10.5 3.5V7H14" />
      <path d="M9.5 13.5h12m-3-3 3 3-3 3" />
    </>
  ),
  edit: (
    <>
      <path d="m15.5 4 4.5 4.5L9 19.5 3.5 20.5l1-5.5L15.5 4Z" fill="currentColor" fillOpacity=".14" />
      <path d="m13 6.5 4.5 4.5M14 20.5h6.5" />
    </>
  ),
  security: (
    <>
      <path d="M12 2.8 19.5 6v5.3c0 4.6-3.1 8.3-7.5 9.9-4.4-1.6-7.5-5.3-7.5-9.9V6L12 2.8Z" fill="currentColor" fillOpacity=".14" />
      <rect x="8.8" y="10.8" width="6.4" height="5" rx="1.2" />
      <path d="M10.2 10.8V9.6a1.8 1.8 0 0 1 3.6 0v1.2" />
    </>
  ),
  intelligence: (
    <>
      <path d="M12 3.2c.6 4.2 2.3 6 6.6 6.7-4.3.8-6 2.5-6.6 6.8-.7-4.3-2.4-6-6.7-6.8 4.3-.7 6-2.5 6.7-6.7Z" fill="currentColor" fillOpacity=".16" />
      <path d="M18.8 15.5c.3 1.6.9 2.3 2.5 2.6-1.6.3-2.2 1-2.5 2.6-.3-1.6-1-2.3-2.6-2.6 1.6-.3 2.3-1 2.6-2.6ZM5 16.5l-1.8 1.8M5.5 4.5 4 3" />
    </>
  ),
};

export function CategoryIcon({
  id,
  size = 20,
  tile = false,
  className,
}: {
  id: string;
  size?: number;
  /** Wrap the glyph in a tinted rounded tile. */
  tile?: boolean;
  className?: string;
}) {
  const cat = getCategoryById(id);
  const vars = { "--ic": cat?.color ?? "#E8607A", "--ic-d": cat?.darkColor ?? "#FF8BA5" } as CSSProperties;
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(!tile && "tool-icon", !tile && className)}
      style={tile ? undefined : vars}
      aria-hidden
    >
      {GLYPH[id] ?? GLYPH.organize}
    </svg>
  );
  if (!tile) return svg;
  return (
    <span
      className={cn("tool-icon inline-flex items-center justify-center rounded-xl flex-shrink-0", className)}
      style={{ ...vars, width: size * 2, height: size * 2, background: "color-mix(in srgb, currentColor 12%, transparent)" }}
    >
      {svg}
    </span>
  );
}
