import type { CSSProperties, ReactNode } from "react";
import { useEscapeKey } from "./useEscapeKey";

/**
 * Dialog chrome per the Figma spec: radius-lg surface with a hairline outline +
 * soft drop shadow, bordered header, body, bordered footer with right-aligned
 * actions. Clicking the overlay or pressing Escape closes.
 */
export function Modal({
  title,
  footer,
  onClose,
  width,
  children,
}: {
  title: string;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}): JSX.Element {
  useEscapeKey(onClose);
  const style: CSSProperties | undefined = width ? { width } : undefined;
  return (
    <div className="ui-modal-overlay" onClick={onClose}>
      <div className="ui-modal" style={style} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ui-modal-header">{title}</div>
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
