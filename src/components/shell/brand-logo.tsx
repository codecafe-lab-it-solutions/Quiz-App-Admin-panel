import { cn } from "@/lib/utils";
import { APP_NAME, LOGO_PATH } from "@/lib/brand";

// The institute logo (public/images.png), used on the auth pages and the
// portal top bar. Plain <img>: it's a small static file served from /public.
export function BrandLogo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={LOGO_PATH} alt={`${APP_NAME} logo`} className={cn("object-contain", className)} />
  );
}
