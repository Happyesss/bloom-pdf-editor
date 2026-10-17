import Image from "next/image";
import { cn } from "@/lib/utils";

/** The BloomPDF app icon (public/logo.png). */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={cn("object-contain select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The full BloomPDF logo (public/BloomPDF.png). The artwork has generous
 * transparent margins and a soft glow, so it's scaled up from its left edge
 * exactly as the original header and footer did.
 */
export function Logo({ variant = "nav", className }: { variant?: "nav" | "footer"; className?: string }) {
  return (
    <Image
      src="/BloomPDF.png"
      alt="BloomPDF"
      width={variant === "nav" ? 320 : 400}
      height={variant === "nav" ? 90 : 100}
      priority={variant === "nav"}
      className={cn(
        "w-auto object-contain scale-150 origin-left select-none",
        variant === "nav" ? "h-16 sm:h-20" : "h-28 sm:h-36",
        className
      )}
    />
  );
}
