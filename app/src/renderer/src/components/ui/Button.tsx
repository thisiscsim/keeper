import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  icon?: IconName;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const cls = ["ui-btn", `ui-btn--${variant}`, `ui-btn--${size}`, className].filter(Boolean).join(" ");
  return (
    <button className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 16} />}
      {children}
    </button>
  );
}
