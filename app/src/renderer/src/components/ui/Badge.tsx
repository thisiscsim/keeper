import type { ReactNode } from "react";

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: "neutral" | "accent";
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const cls = ["ui-badge", `ui-badge--${variant}`, className].filter(Boolean).join(" ");
  return <span className={cls}>{children}</span>;
}
