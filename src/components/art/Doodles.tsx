/**
 * Doodles.tsx — hand-drawn line doodles used as decoration across BloomPDF.
 * All use currentColor so they pick up text colour, and accept className/size.
 * Paths are deliberately a little irregular to feel sketched rather than CAD.
 */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function D({ size = 24, children, viewBox = "0 0 24 24", strokeWidth = 1.8, ...rest }: P & { viewBox?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Sparkle = (p: P) => (
  <D {...p}>
    <path d="M12 2.8c.6 4.6 2.2 6.5 6.9 7.3-4.6.9-6.3 2.7-6.9 7.4-.7-4.7-2.4-6.6-7-7.4 4.6-.8 6.3-2.7 7-7.3Z" fill="currentColor" fillOpacity=".15" />
    <path d="M19.5 16.5c.2 1.4.7 2 2.1 2.2-1.4.3-1.9.8-2.1 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z" />
  </D>
);

export const Squiggle = (p: P) => (
  <D viewBox="0 0 120 16" {...p} size={undefined} width={p.width ?? 120} height={p.height ?? 16}>
    <path d="M2 9c8-7 14 6 22 0s14-7 22 0 14 6 22 0 14-7 22 0 14 5 26-1" />
  </D>
);

export const Underline = (p: P) => (
  <svg viewBox="0 0 300 20" fill="none" preserveAspectRatio="none" aria-hidden {...p}>
    <path d="M4 13C70 5 160 3 296 9" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    <path d="M30 17c60-5 140-7 230-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".55" />
  </svg>
);

export const CurlyArrow = (p: P) => (
  <D viewBox="0 0 64 48" {...p} size={undefined} width={p.width ?? 64} height={p.height ?? 48}>
    <path d="M4 8c10 2 18 8 18 16 0 6-6 8-8 4s4-10 12-10c10 0 18 10 26 22" />
    <path d="M45 36l7 4 1-8" />
  </D>
);

export const Lotus = (p: P) => (
  <D {...p}>
    <path d="M12 4.5c2.6 2.4 3.6 5 3.6 7.4 0 2.6-1.5 4.6-3.6 5.6-2.1-1-3.6-3-3.6-5.6 0-2.4 1-5 3.6-7.4Z" fill="currentColor" fillOpacity=".15" />
    <path d="M4 9.6c3-.2 5.8 1.2 7 3.8.9 1.9.8 3.5.4 4.2-2.3.3-4.7-.6-6.1-2.6C4.2 13.5 3.7 11.5 4 9.6ZM20 9.6c.3 1.9-.2 3.9-1.3 5.4-1.4 2-3.8 2.9-6.1 2.6-.4-.7-.5-2.3.4-4.2 1.2-2.6 4-4 7-3.8Z" />
    <path d="M5.5 20c2.2 1 4.3 1.4 6.5 1.4s4.3-.4 6.5-1.4" />
  </D>
);

export const PaperPlane = (p: P) => (
  <D {...p}>
    <path d="M21.5 3.2 2.8 10.4c-.7.3-.7 1.2 0 1.5l5.7 2.2 2.3 6.2c.3.7 1.2.8 1.6.2l2.9-4 4.6 3.1c.6.4 1.4 0 1.5-.7L22.6 4.3c.1-.8-.5-1.3-1.1-1.1Z" fill="currentColor" fillOpacity=".12" />
    <path d="m8.5 14.1 9-7.4-6.7 8.4" />
  </D>
);

export const Pages = (p: P) => (
  <D {...p}>
    <path d="M8 3.5h7.5l4 4V18a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 18V5A1.5 1.5 0 0 1 8 3.5Z" fill="currentColor" fillOpacity=".1" />
    <path d="M15.5 3.5v3a1 1 0 0 0 1 1h3M4 7v12.5A1.5 1.5 0 0 0 5.5 21H15M9.5 11.5h6M9.5 14.5h4" />
  </D>
);

export const Scissors = (p: P) => (
  <D {...p}>
    <circle cx="6" cy="6.5" r="2.8" />
    <circle cx="6" cy="17.5" r="2.8" />
    <path d="M8.3 8.2 20 17.8M8.3 15.8 20 6.2" />
  </D>
);

export const Paperclip = (p: P) => (
  <D {...p}>
    <path d="m20.2 11.4-7.8 8a5 5 0 0 1-7.1-7l8.4-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.3 8.5a1.7 1.7 0 0 1-2.4-2.4L15.4 7" />
  </D>
);

export const Stamp = (p: P) => (
  <D {...p}>
    <path d="M9 3.5h6c.5 2.7-.2 4.8-1.8 6.5V13H17a2 2 0 0 1 2 2v2H5v-2a2 2 0 0 1 2-2h3.8v-3C9.2 8.3 8.5 6.2 9 3.5Z" fill="currentColor" fillOpacity=".12" />
    <path d="M4.5 20.5h15" />
  </D>
);

export const Magnifier = (p: P) => (
  <D {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" fill="currentColor" fillOpacity=".1" />
    <path d="m15.5 15.5 5 5M8 8.4c.6-.9 1.6-1.4 2.6-1.4" />
  </D>
);

export const Lock = (p: P) => (
  <D {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="3" fill="currentColor" fillOpacity=".12" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
  </D>
);

export const Shield = (p: P) => (
  <D {...p}>
    <path d="M12 2.8 19.5 6v5.2c0 4.6-3.1 8.4-7.5 10-4.4-1.6-7.5-5.4-7.5-10V6L12 2.8Z" fill="currentColor" fillOpacity=".12" />
    <path d="m8.8 12.2 2.3 2.3 4.4-4.6" />
  </D>
);

export const CloudOff = (p: P) => (
  <D {...p}>
    <path d="M7 18.5h10.2a3.8 3.8 0 0 0 .6-7.6A6 6 0 0 0 6.5 9.6 4.5 4.5 0 0 0 7 18.5Z" fill="currentColor" fillOpacity=".1" />
    <path d="M3 3l18 18" />
  </D>
);

export const Lightning = (p: P) => (
  <D {...p}>
    <path d="M13.5 2.5 5 13.5h6l-1 8 8.5-11h-6l1-8Z" fill="currentColor" fillOpacity=".14" />
  </D>
);

export const Heart = (p: P) => (
  <D {...p}>
    <path d="M12 20s-7.5-4.4-8.6-9.6C2.6 6.6 6.6 4 9.5 6.3L12 8.4l2.5-2.1c2.9-2.3 6.9.3 6.1 4.1C19.5 15.6 12 20 12 20Z" fill="currentColor" fillOpacity=".15" />
  </D>
);

export const Star = (p: P) => (
  <D {...p}>
    <path d="m12 3.2 2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8L12 3.2Z" fill="currentColor" fillOpacity=".14" />
  </D>
);

export const Leaf = (p: P) => (
  <D {...p}>
    <path d="M5 19C4 11 9 5 19.5 4.5 20 15 14 20 5 19Z" fill="currentColor" fillOpacity=".12" />
    <path d="M5 19c3-4.5 6.5-8 11-11" />
  </D>
);

export const Pencil = (p: P) => (
  <D {...p}>
    <path d="m15.5 4.5 4 4L9 19l-5 1 1-5L15.5 4.5Z" fill="currentColor" fillOpacity=".12" />
    <path d="m13.5 6.5 4 4" />
  </D>
);

export const Swirl = (p: P) => (
  <D {...p}>
    <path d="M12 12c0-1.4 1.6-1.9 2.4-.9 1.2 1.4-.2 3.6-2.2 3.6-2.6 0-4-2.8-2.8-5.2 1.6-3.2 6.2-3.4 8.2-.4 2.4 3.6-.2 8.6-4.8 8.9" />
  </D>
);

export const DottedPath = (p: P) => (
  <svg viewBox="0 0 400 60" fill="none" preserveAspectRatio="none" aria-hidden {...p}>
    <path d="M4 40C70 0 130 64 200 30s140-30 196 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="2 9" />
  </svg>
);

export const Circle = (p: P) => (
  <svg viewBox="0 0 200 80" fill="none" preserveAspectRatio="none" aria-hidden {...p}>
    <path d="M150 12C110 2 34 6 12 30c-20 22 30 44 96 42 60-2 92-22 82-42-6-12-30-20-60-22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const Dots = (p: P) => (
  <svg viewBox="0 0 60 60" aria-hidden {...p}>
    {Array.from({ length: 16 }).map((_, i) => (
      <circle key={i} cx={6 + (i % 4) * 16} cy={6 + Math.floor(i / 4) * 16} r="2" fill="currentColor" />
    ))}
  </svg>
);

export const Flourish = (p: P) => (
  <D viewBox="0 0 48 48" {...p}>
    <path d="M4 44c0-16 6-28 18-34M4 44c12-2 22-8 28-18M22 10c4-2 8-2 12 0M32 26c2-4 2-8 0-12" />
    <circle cx="38" cy="8" r="2" fill="currentColor" />
  </D>
);
