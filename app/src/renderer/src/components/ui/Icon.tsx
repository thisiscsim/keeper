import type { CSSProperties } from "react";
import apertureLogomark from "../../assets/icons/aperture-logomark.svg?raw";
import arrowLeft from "../../assets/icons/arrow-left.svg?raw";
import arrowOutOfBox from "../../assets/icons/arrow-out-of-box.svg?raw";
import arrowRotate from "../../assets/icons/arrow-rotate.svg?raw";
import chevronTop from "../../assets/icons/chevron-top.svg?raw";
import circleQuestionmark from "../../assets/icons/circle-questionmark.svg?raw";
import clapboardSparkle from "../../assets/icons/clapboard-sparkle.svg?raw";
import clapboardWide from "../../assets/icons/clapboard-wide.svg?raw";
import ellipsis from "../../assets/icons/ellipsis.svg?raw";
import finder from "../../assets/icons/finder.svg?raw";
import folder from "../../assets/icons/folder.svg?raw";
import folderAlt from "../../assets/icons/folder-alt.svg?raw";
import formRectangle from "../../assets/icons/form-rectangle.svg?raw";
import formSquare from "../../assets/icons/form-square.svg?raw";
import github from "../../assets/icons/github.svg?raw";
import horizontalAlignBottom from "../../assets/icons/horizontal-align-bottom.svg?raw";
import horizontalAlignCenter from "../../assets/icons/horizontal-align-center.svg?raw";
import horizontalAlignTop from "../../assets/icons/horizontal-align-top.svg?raw";
import layoutAlignLeft from "../../assets/icons/layout-align-left.svg?raw";
import linear from "../../assets/icons/linear.svg?raw";
import magicWand from "../../assets/icons/magic-wand.svg?raw";
import multiMedia from "../../assets/icons/multi-media.svg?raw";
import playCircle from "../../assets/icons/play-circle.svg?raw";
import prompt from "../../assets/icons/prompt.svg?raw";
import record from "../../assets/icons/record.svg?raw";
import settingsGear from "../../assets/icons/settings-gear.svg?raw";
import shareOs from "../../assets/icons/share-os.svg?raw";
import skip from "../../assets/icons/skip.svg?raw";
import squareArrowDown from "../../assets/icons/square-arrow-down.svg?raw";
import stepBack from "../../assets/icons/step-back.svg?raw";
import stepForwards from "../../assets/icons/step-forwards.svg?raw";
import textMotion from "../../assets/icons/text-motion.svg?raw";
import trashCan from "../../assets/icons/trash-can.svg?raw";
import verticalAlignCenter from "../../assets/icons/vertical-align-center.svg?raw";
import verticalAlignLeft from "../../assets/icons/vertical-align-left.svg?raw";
import verticalAlignRight from "../../assets/icons/vertical-align-right.svg?raw";
import voiceHigh from "../../assets/icons/voice-high.svg?raw";
import volumeFull from "../../assets/icons/volume-full.svg?raw";

/**
 * Custom icon set harvested from the Figma design system. SVGs are normalized
 * to `currentColor`, so icons tint via CSS `color` on the wrapper.
 */
const ICONS = {
  "aperture-logomark": apertureLogomark,
  "arrow-left": arrowLeft,
  "arrow-out-of-box": arrowOutOfBox,
  "arrow-rotate": arrowRotate,
  "chevron-top": chevronTop,
  "circle-questionmark": circleQuestionmark,
  "clapboard-sparkle": clapboardSparkle,
  "clapboard-wide": clapboardWide,
  ellipsis,
  finder,
  folder,
  "folder-alt": folderAlt,
  "form-rectangle": formRectangle,
  "form-square": formSquare,
  github,
  "horizontal-align-bottom": horizontalAlignBottom,
  "horizontal-align-center": horizontalAlignCenter,
  "horizontal-align-top": horizontalAlignTop,
  "layout-align-left": layoutAlignLeft,
  linear,
  "magic-wand": magicWand,
  "multi-media": multiMedia,
  "play-circle": playCircle,
  prompt,
  record,
  "settings-gear": settingsGear,
  "share-os": shareOs,
  skip,
  "square-arrow-down": squareArrowDown,
  "step-back": stepBack,
  "step-forwards": stepForwards,
  "text-motion": textMotion,
  "trash-can": trashCan,
  "vertical-align-center": verticalAlignCenter,
  "vertical-align-left": verticalAlignLeft,
  "vertical-align-right": verticalAlignRight,
  "voice-high": voiceHigh,
  "volume-full": volumeFull,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span
      aria-hidden
      className={className ? `icon ${className}` : "icon"}
      style={{ width: size, height: size, ...style }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
