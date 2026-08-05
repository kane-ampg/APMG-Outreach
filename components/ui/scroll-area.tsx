import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Lightweight stand-in for the shared <ScrollArea> referenced in
 * ui-standards.md §2.3 / §4. A plain overflow container is enough for this
 * surface; the styled-thin scrollbar comes from globals.css.
 */
export function ScrollArea({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("overflow-y-auto", className)} {...props}>
      {children}
    </div>
  );
}
