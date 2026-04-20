import Image from "next/image";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
}

/**
 * Portix brand logo.
 *
 * Intrinsic PNG dimensions: 1066 × 345 px (aspect ratio ≈ 3.09 : 1).
 * Display size is controlled entirely via `className` — the `width` and
 * `height` props below are the intrinsic pixel hints Next.js needs for
 * layout shift prevention, NOT the rendered size on screen.
 *
 * Usage:
 *   <Logo className="h-10 w-auto" />   — nav bar
 *   <Logo className="h-20 w-auto" />   — login hero
 */
export function Logo({ className }: LogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="Portix Logo"
      width={1066}
      height={345}
      className={cn("h-10 w-auto object-contain shrink-0", className)}
      priority
    />
  );
}
