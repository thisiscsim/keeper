import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  size?: number;
  label: string;
}

export function IconButton({ icon, size = 16, label, className, ...rest }: IconButtonProps): JSX.Element {
  const cls = ["ui-icon-btn", className].filter(Boolean).join(" ");
  return (
    <button className={cls} title={label} aria-label={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}
