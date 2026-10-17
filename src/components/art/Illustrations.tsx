
import { cn } from "@/lib/utils";

/** Two stacked pages with an arrow lifting out — used in every upload zone. */
export function UploadDoodle({ className, active = false }: { className?: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 200 150" fill="none" className={cn("overflow-visible", className)} aria-hidden>
      <g strokeLinecap="round" strokeLinejoin="round">
        {/* soft blob */}
        <path d="M38 96c-10-30 14-62 52-66 34-4 70 10 74 42 4 30-22 54-58 56-34 2-60-6-68-32Z" fill="currentColor" opacity=".07" />
        {/* back page */}
        <g className={cn("transition-transform duration-500", active ? "-translate-x-2 -rotate-6" : "")} style={{ transformOrigin: "80px 110px" }}>
          <rect x="58" y="40" width="52" height="68" rx="6" transform="rotate(-10 84 74)" className="fill-card" stroke="currentColor" strokeWidth="2.2" opacity=".55" />
        </g>
        {/* front page */}
        <g className={cn("transition-transform duration-500", active ? "-translate-y-2" : "")}>
          <path d="M86 34h34l16 16v58a6 6 0 0 1-6 6H86a6 6 0 0 1-6-6V40a6 6 0 0 1 6-6Z" className="fill-card" stroke="currentColor" strokeWidth="2.4" />
          <path d="M120 34v12a4 4 0 0 0 4 4h12" stroke="currentColor" strokeWidth="2.4" />
          <path d="M92 66h28M92 76h34M92 86h20" stroke="currentColor" strokeWidth="2.2" opacity=".35" />
        </g>
        {/* arrow */}
        <g className={cn("transition-transform duration-500", active ? "-translate-y-3" : "group-hover:-translate-y-1.5")}>
          <circle cx="146" cy="104" r="17" fill="currentColor" />
          <path d="M146 112V97m-6 6 6-6 6 6" stroke="white" strokeWidth="2.6" />
        </g>
        {/* doodle sparkles */}
        <path d="M50 44v10M45 49h10" stroke="currentColor" strokeWidth="2" opacity=".7" />
        <path d="M160 46c2 4 4 6 8 8-4 2-6 4-8 8-2-4-4-6-8-8 4-2 6-4 8-8Z" fill="currentColor" opacity=".55" />
        <path d="M40 120c8-6 16 4 24-2s14 2 20-2" stroke="currentColor" strokeWidth="2" opacity=".45" />
        <circle cx="172" cy="84" r="2.5" fill="currentColor" opacity=".5" />
        <circle cx="34" cy="78" r="2" fill="currentColor" opacity=".4" />
      </g>
    </svg>
  );
}

/** A padlock on a page; the shackle swings open when `open`. */
export function LockDoodle({ className, open = false }: { className?: string; open?: boolean }) {
  return (
    <svg viewBox="0 0 160 160" fill="none" className={className} aria-hidden>
      <g strokeLinecap="round" strokeLinejoin="round">
        <circle cx="80" cy="84" r="62" fill="currentColor" opacity=".07" />
        <path d="M46 30h50l18 18v80a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6V36a6 6 0 0 1 6-6Z" className="fill-card" stroke="currentColor" strokeWidth="2.2" opacity=".5" />
        <path d="M52 52h34M52 62h44M52 72h26" stroke="currentColor" strokeWidth="2" opacity=".25" />
        <path
          d={open ? "M70 92V74a16 16 0 0 1 31-6" : "M70 92V76a16 16 0 0 1 32 0v16"}
          stroke="currentColor"
          strokeWidth="5"
          className="transition-all duration-500"
        />
        <rect x="60" y="90" width="52" height="40" rx="9" fill="currentColor" />
        <circle cx="86" cy="106" r="5" fill="white" />
        <path d="M86 110v8" stroke="white" strokeWidth="4" />
        <path d="M124 40l6-6M128 52h8M118 30v-8" stroke="currentColor" strokeWidth="2.2" opacity={open ? 0.8 : 0.3} />
      </g>
    </svg>
  );
}

/** A document card with a format badge and a little "→ PDF" doodle. */
export function ConvertDoodle({ className, from, to = "PDF", working = false }: { className?: string; from: string; to?: string; working?: boolean }) {
  return (
    <svg viewBox="0 0 240 160" fill="none" className={className} aria-hidden>
      <g strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="120" cy="140" rx="92" ry="9" fill="currentColor" opacity=".07" />
        {/* source */}
        <g transform="rotate(-6 60 80)">
          <path d="M30 26h44l16 16v76a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6Z" className="fill-card" stroke="currentColor" strokeWidth="2.2" opacity=".6" />
          <path d="M74 26v12a4 4 0 0 0 4 4h12" stroke="currentColor" strokeWidth="2.2" opacity=".6" />
          <rect x="34" y="88" width="44" height="18" rx="5" fill="currentColor" opacity=".18" />
          <text x="56" y="101" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" fontFamily="ui-sans-serif, system-ui">{from}</text>
          <path d="M36 56h36M36 66h42M36 76h28" stroke="currentColor" strokeWidth="2" opacity=".25" />
        </g>
        {/* arrow */}
        <path d="M100 82c10-14 26-14 36 0" stroke="currentColor" strokeWidth="2.4" strokeDasharray="4 6" className={working ? "animate-[dash_1s_linear_infinite]" : ""} />
        <path d="M131 74l6 8-9 3" stroke="currentColor" strokeWidth="2.4" />
        {/* target */}
        <g transform="rotate(5 186 80)">
          <path d="M160 26h44l16 16v76a6 6 0 0 1-6 6h-54a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6Z" fill="currentColor" opacity=".12" stroke="currentColor" strokeWidth="2.4" />
          <path d="M204 26v12a4 4 0 0 0 4 4h12" stroke="currentColor" strokeWidth="2.4" />
          <rect x="164" y="88" width="44" height="18" rx="5" fill="currentColor" />
          <text x="186" y="101" textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="ui-sans-serif, system-ui">{to}</text>
          <path d="M166 56h36M166 66h42M166 76h28" stroke="currentColor" strokeWidth="2" opacity=".35" />
        </g>
        <path d="M118 30v8M114 34h8" stroke="currentColor" strokeWidth="2" opacity=".6" />
        <circle cx="226" cy="22" r="3" fill="currentColor" opacity=".4" />
        <path d="M10 60c6-4 10 2 14-2" stroke="currentColor" strokeWidth="2" opacity=".35" />
      </g>
    </svg>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const LINE = "stroke-foreground/25";

function Petals({ cx, cy, s = 1, id }: { cx: number; cy: number; s?: number; id: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${s})`}>
      <defs>
        <linearGradient id={`${id}-p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB3C4" />
          <stop offset="1" stopColor="#E8607A" />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFD0DB" />
          <stop offset="1" stopColor="#F07C93" />
        </linearGradient>
      </defs>
      <path d="M-46 8C-48-18-30-34-8-30c-4 16-4 32 4 44-18 6-36 2-42-6Z" fill={`url(#${id}-s)`} stroke="#fff" strokeWidth="2.5" />
      <path d="M46 8C48-18 30-34 8-30c4 16 4 32-4 44 18 6 36 2 42-6Z" fill={`url(#${id}-s)`} stroke="#fff" strokeWidth="2.5" />
      <path d="M0-52C20-34 26-14 22 4 18 20 8 28 0 30c-8-2-18-10-22-26-4-18 2-38 22-56Z" fill={`url(#${id}-p)`} stroke="#fff" strokeWidth="2.5" />
      <path d="M0-30v44" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <path d="M-34 30c20 10 48 10 68 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
    </g>
  );
}

const spark = (x: number, y: number, r: number) =>
  `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;

// ─── Hero ────────────────────────────────────────────────────────────────────

/** A PDF page blooming into a lotus, surrounded by doodles. */
export function HeroIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 480" fill="none" className={cn("text-primary", className)} role="img" aria-label="A PDF document blooming into a flower">
      <defs>
        <filter id="hero-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#B83A57" floodOpacity=".16" />
        </filter>
      </defs>
      <path d="M78 260C60 150 150 60 270 58s232 64 236 176c4 104-92 196-226 196C150 430 92 360 78 260Z" fill="currentColor" opacity=".07" />
      <ellipse cx="282" cy="262" rx="236" ry="168" stroke="currentColor" strokeWidth="2" strokeDasharray="1.5 11" strokeLinecap="round" opacity=".45" />

      {/* back page */}
      <g transform="rotate(9 360 250)">
        <rect x="282" y="132" width="180" height="236" rx="14" className="fill-card stroke-foreground/10" strokeWidth="2" filter="url(#hero-shadow)" />
        <path d="M306 168h96M306 186h128M306 204h110M306 222h120" className={LINE} strokeWidth="6" strokeLinecap="round" />
        <rect x="306" y="248" width="132" height="70" rx="8" fill="currentColor" opacity=".1" />
        <path d="M316 306l26-26 18 16 14-12 24 22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
      </g>

      {/* front page */}
      <g transform="rotate(-5 230 270)">
        <rect x="128" y="126" width="210" height="282" rx="16" className="fill-card stroke-foreground/10" strokeWidth="2" filter="url(#hero-shadow)" />
        <rect x="154" y="160" width="104" height="14" rx="7" fill="currentColor" />
        <path d="M154 194h150M154 212h132M154 230h146M154 248h96" className={LINE} strokeWidth="6" strokeLinecap="round" />
        {/* mini chart */}
        <g>
          <rect x="154" y="276" width="18" height="44" rx="4" fill="#60A5FA" opacity=".85" />
          <rect x="180" y="258" width="18" height="62" rx="4" fill="#2DD4BF" opacity=".85" />
          <rect x="206" y="288" width="18" height="32" rx="4" fill="#A78BFA" opacity=".85" />
          <rect x="232" y="266" width="18" height="54" rx="4" fill="currentColor" opacity=".85" />
          <path d="M150 326h110" className="stroke-foreground/20" strokeWidth="2" strokeLinecap="round" />
        </g>
        {/* signature */}
        <path d="M158 372c10-16 18-18 20-4s10 10 18-4 14-6 18 4c4 8 14 4 24-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M262 380h50" className="stroke-foreground/20" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
        {/* paperclip */}
        <path d="M168 112v-22a10 10 0 0 1 20 0v40a6 6 0 0 1-12 0V98" className="stroke-foreground/45" strokeWidth="4" strokeLinecap="round" />
      </g>

      {/* the bloom */}
      <Petals cx={318} cy={118} s={1.05} id="hero" />
      <path d={spark(388, 54, 12)} fill="currentColor" />
      <path d={spark(238, 44, 8)} fill="currentColor" opacity=".55" />
      <path d={spark(420, 112, 6)} fill="currentColor" opacity=".4" />

      {/* paper plane + trail */}
      <path d="M44 186c26-58 70-82 118-76" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 8" strokeLinecap="round" opacity=".55" />
      <g transform="translate(150 96) rotate(-18)">
        <path d="M0 14 40 0 30 34 20 22 0 14Z" className="fill-card" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M20 22 40 0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </g>

      {/* scissors doodle */}
      <g transform="translate(62 382) rotate(-20)" className="stroke-foreground/50" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="8" cy="8" r="7" />
        <circle cx="8" cy="34" r="7" />
        <path d="M14 12 46 34M14 30 46 8" />
      </g>
      {/* squiggle + dots */}
      <path d="M430 410c12-10 22 6 34-4s20 4 32-6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <circle cx="486" cy="190" r="5" fill="currentColor" opacity=".35" />
      <circle cx="504" cy="212" r="3" fill="currentColor" opacity=".25" />
      <circle cx="58" cy="300" r="4" fill="currentColor" opacity=".3" />
    </svg>
  );
}

// ─── How it works ────────────────────────────────────────────────────────────

export function StepDrop({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" fill="none" className={cn("text-primary", className)} aria-hidden>
      <ellipse cx="80" cy="104" rx="56" ry="8" fill="currentColor" opacity=".08" />
      <path d="M30 78h100l-10 22H40L30 78Z" className="fill-card stroke-foreground/30" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M58 78c0 8 6 12 22 12s22-4 22-12" className="stroke-foreground/30" strokeWidth="2.5" />
      <g className="animate-float">
        <path d="M62 14h28l12 12v40a5 5 0 0 1-5 5H62a5 5 0 0 1-5-5V19a5 5 0 0 1 5-5Z" className="fill-card" stroke="currentColor" strokeWidth="2.5" />
        <path d="M90 14v10a2 2 0 0 0 2 2h10M66 40h26M66 48h20M66 56h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".5" />
      </g>
      <path d="M120 22v18m-6-6 6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={spark(36, 30, 7)} fill="currentColor" opacity=".6" />
    </svg>
  );
}

export function StepTweak({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" fill="none" className={cn("text-primary", className)} aria-hidden>
      <rect x="28" y="16" width="104" height="88" rx="14" className="fill-card stroke-foreground/20" strokeWidth="2.5" />
      {[38, 60, 82].map((y, i) => (
        <g key={y}>
          <path d={`M44 ${y}h72`} className="stroke-foreground/20" strokeWidth="4" strokeLinecap="round" />
          <path d={`M44 ${y}h${[40, 22, 56][i]}`} stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <circle cx={44 + [40, 22, 56][i]} cy={y} r="7" className="fill-card" stroke="currentColor" strokeWidth="3" />
        </g>
      ))}
      <path d={spark(136, 18, 8)} fill="currentColor" />
      <path d="M14 84c6-6 10 2 16-2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

export function StepDownload({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" fill="none" className={cn("text-primary", className)} aria-hidden>
      <ellipse cx="80" cy="106" rx="50" ry="7" fill="currentColor" opacity=".08" />
      <path d="M56 12h34l14 14v62a6 6 0 0 1-6 6H56a6 6 0 0 1-6-6V18a6 6 0 0 1 6-6Z" className="fill-card" stroke="currentColor" strokeWidth="2.5" />
      <path d="M90 12v12a2 2 0 0 0 2 2h12M60 40h30M60 48h36M60 56h22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".45" />
      <circle cx="104" cy="82" r="18" fill="currentColor" />
      <path d="m95 82 6 6 12-12" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* confetti */}
      <path d="M30 30l6 4M126 26l6-4M24 64h8M134 54l7 2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <circle cx="40" cy="92" r="3" fill="#60A5FA" />
      <circle cx="132" cy="96" r="3" fill="#2DD4BF" />
      <path d={spark(30, 46, 6)} fill="#FBBF24" />
    </svg>
  );
}

// ─── Privacy band ────────────────────────────────────────────────────────────

export function PrivacyIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 250" fill="none" className={cn("text-primary", className)} role="img" aria-label="Your laptop keeps the files; the cloud is crossed out">
      <path d="M40 150c-6-60 40-110 112-112s132 36 128 100c-4 60-56 96-128 96S46 206 40 150Z" fill="currentColor" opacity=".08" />
      {/* cloud crossed out */}
      <g transform="translate(206 26)">
        <path d="M18 46h52a16 16 0 0 0 2-32 24 24 0 0 0-46-4A18 18 0 0 0 18 46Z" className="fill-card stroke-foreground/30" strokeWidth="2.5" />
        <path d="M8 4l72 52" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </g>
      {/* laptop */}
      <rect x="62" y="74" width="170" height="112" rx="10" className="fill-card stroke-foreground/40" strokeWidth="3" />
      <rect x="74" y="86" width="146" height="88" rx="4" fill="currentColor" opacity=".08" />
      <path d="M44 186h206l-12 18H56l-12-18Z" className="fill-card stroke-foreground/40" strokeWidth="3" strokeLinejoin="round" />
      {/* pdf on screen */}
      <path d="M112 96h40l12 12v54a4 4 0 0 1-4 4h-48a4 4 0 0 1-4-4V100a4 4 0 0 1 4-4Z" className="fill-card" stroke="currentColor" strokeWidth="2.5" />
      <rect x="116" y="146" width="28" height="12" rx="3" fill="currentColor" />
      <path d="M118 116h30M118 126h36M118 136h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".4" />
      {/* shield */}
      <g transform="translate(176 120)">
        <path d="M30 0 58 12v20c0 18-12 32-28 38C14 64 2 50 2 32V12L30 0Z" fill="currentColor" stroke="#fff" strokeWidth="3" />
        <path d="m18 34 8 8 16-17" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M24 92c8-8 14 4 22-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".5" />
      <path d={spark(286, 150, 9)} fill="currentColor" opacity=".7" />
      <circle cx="40" cy="214" r="4" fill="currentColor" opacity=".3" />
    </svg>
  );
}

// ─── 404 ─────────────────────────────────────────────────────────────────────

export function LostPageIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 240" fill="none" className={cn("text-primary", className)} role="img" aria-label="A lost page and a paper plane looping around">
      <ellipse cx="160" cy="214" rx="104" ry="10" fill="currentColor" opacity=".08" />
      <path d="M30 110c20-70 90-40 70 0s-60 10-30-40 120-60 150-20" stroke="currentColor" strokeWidth="2.5" strokeDasharray="4 8" strokeLinecap="round" opacity=".5" />
      <g transform="translate(212 40) rotate(12)">
        <path d="M0 14 40 0 30 34 20 22 0 14Z" className="fill-card" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M20 22 40 0" stroke="currentColor" strokeWidth="2.5" />
      </g>
      <g transform="rotate(-8 150 140)">
        <path d="M110 70h56l22 22v100a8 8 0 0 1-8 8h-70a8 8 0 0 1-8-8V78a8 8 0 0 1 8-8Z" className="fill-card stroke-foreground/30" strokeWidth="3" />
        <path d="M166 70v16a6 6 0 0 0 6 6h16" className="stroke-foreground/30" strokeWidth="3" />
        <text x="148" y="160" textAnchor="middle" fontSize="54" fontWeight="800" fill="currentColor" fontFamily="var(--font-hand), cursive">?</text>
      </g>
      <g transform="translate(206 128)">
        <circle cx="22" cy="22" r="20" className="fill-card" stroke="currentColor" strokeWidth="4" />
        <path d="M37 37l20 20" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </g>
      <path d={spark(78, 170, 9)} fill="currentColor" opacity=".6" />
      <path d={spark(270, 200, 6)} fill="currentColor" opacity=".4" />
    </svg>
  );
}

// ─── Page heroes ─────────────────────────────────────────────────────────────

export function EnvelopeIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 200" fill="none" className={cn("text-primary", className)} aria-hidden>
      <path d="M30 110c-4-50 40-86 100-86s104 30 100 82-48 80-104 80S34 160 30 110Z" fill="currentColor" opacity=".08" />
      <g transform="rotate(-6 130 110)">
        <rect x="56" y="62" width="148" height="100" rx="10" className="fill-card stroke-foreground/35" strokeWidth="3" />
        <path d="M58 66l72 52 72-52" className="stroke-foreground/35" strokeWidth="3" strokeLinejoin="round" />
        <path d="M130 108c-6-8-20-4-16 6 3 8 16 14 16 14s13-6 16-14c4-10-10-14-16-6Z" fill="currentColor" />
      </g>
      <path d="M20 70h22M14 86h18M24 102h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <g transform="translate(198 18) rotate(10)">
        <path d="M0 12 34 0 26 28 17 18 0 12Z" className="fill-card" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      </g>
      <path d={spark(222, 160, 8)} fill="currentColor" opacity=".6" />
    </svg>
  );
}

export function NotebookIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 200" fill="none" className={cn("text-primary", className)} aria-hidden>
      <path d="M26 112c-4-54 42-90 104-90s108 34 104 86-50 82-108 82S30 164 26 112Z" fill="currentColor" opacity=".08" />
      <path d="M40 58c30-8 60-6 90 8v108c-30-14-60-16-90-8V58Z" className="fill-card stroke-foreground/35" strokeWidth="3" strokeLinejoin="round" />
      <path d="M220 58c-30-8-60-6-90 8v108c30-14 60-16 90-8V58Z" className="fill-card stroke-foreground/35" strokeWidth="3" strokeLinejoin="round" />
      <path d="M54 84c20-4 40-2 60 6M54 100c20-4 40-2 60 6M54 116c14-3 28-2 42 3" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <path d="M146 92c20-8 40-10 60-6M146 108c20-8 40-10 60-6" className="stroke-foreground/25" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 140c8-10 14-10 16-2s8 6 14-2" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <g transform="translate(196 24) rotate(35)">
        <rect x="0" y="0" width="12" height="70" rx="3" fill="currentColor" />
        <path d="M0 70 6 84 12 70Z" className="fill-card" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </g>
      <path d={spark(40, 30, 9)} fill="currentColor" opacity=".6" />
    </svg>
  );
}

export function GardenIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 220" fill="none" className={cn("text-primary", className)} aria-hidden>
      <path d="M30 130c-4-60 50-104 120-104s124 40 120 98-58 90-122 90S34 186 30 130Z" fill="currentColor" opacity=".08" />
      <path d="M30 196c40-10 200-10 240 0" className="stroke-foreground/30" strokeWidth="3" strokeLinecap="round" />
      {/* seedling */}
      <path d="M72 196v-30" className="stroke-emerald-500" strokeWidth="3" strokeLinecap="round" />
      <path d="M72 176c-12 0-18-8-18-16 10 0 18 6 18 16ZM72 170c10 0 16-8 16-14-10 0-16 6-16 14Z" className="fill-emerald-400/60 stroke-emerald-500" strokeWidth="2" />
      {/* bud */}
      <path d="M150 196v-56" className="stroke-emerald-500" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 112c10 8 14 18 10 26-3 6-7 8-10 8s-7-2-10-8c-4-8 0-18 10-26Z" fill="currentColor" opacity=".55" stroke="#fff" strokeWidth="2" />
      <path d="M150 168c-12-2-18-10-18-16 10 0 18 8 18 16Z" className="fill-emerald-400/60 stroke-emerald-500" strokeWidth="2" />
      {/* bloom */}
      <path d="M228 196v-60" className="stroke-emerald-500" strokeWidth="3" strokeLinecap="round" />
      <Petals cx={228} cy={118} s={0.62} id="garden" />
      <path d={spark(270, 60, 9)} fill="currentColor" />
      <path d={spark(108, 70, 6)} fill="currentColor" opacity=".5" />
      <path d="M92 110c6-6 12 2 18-2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}

export function ScrollIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 200" fill="none" className={cn("text-primary", className)} aria-hidden>
      <path d="M30 108c-4-52 42-86 102-86s104 32 100 84-48 80-104 80S34 160 30 108Z" fill="currentColor" opacity=".08" />
      <path d="M70 40h104a12 12 0 0 1 12 12v116H82a12 12 0 0 1-12-12V40Z" className="fill-card stroke-foreground/35" strokeWidth="3" />
      <path d="M58 40a12 12 0 0 1 24 0v8H58v-8Z" className="fill-card stroke-foreground/35" strokeWidth="3" />
      <path d="M92 70h70M92 86h78M92 102h60M92 118h70" className="stroke-foreground/25" strokeWidth="4" strokeLinecap="round" />
      <g transform="translate(150 112)">
        <path d="M26 0 50 10v18c0 16-10 28-24 33C12 56 2 44 2 28V10L26 0Z" fill="currentColor" stroke="#fff" strokeWidth="3" />
        <path d="m15 30 7 7 14-15" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d={spark(214, 44, 9)} fill="currentColor" opacity=".6" />
      <path d="M30 150c8-8 14 4 22-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".5" />
    </svg>
  );
}
