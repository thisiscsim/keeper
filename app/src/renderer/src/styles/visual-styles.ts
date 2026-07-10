import presets from "./visual-styles.json";

export interface VisualStyle {
  id: string;
  name: string;
  inspiration: string;
  /** [text, background, accent] — matches edl.theme.palette ordering. */
  palette: [string, string, string];
  fontFamily: string;
  captionStyle: "karaoke" | "block" | "word" | "none";
  /** animate-text spec id (see motion/animations.ts) used for generated titles. */
  anim: string;
  /** clip transition preset: fade | slide | wipe. */
  transition: string;
  /** 0 = calm/cinematic, 1 = frenetic/high-energy. */
  energy: number;
  avoid: string[];
}

export const VISUAL_STYLES = presets as VisualStyle[];

export function getVisualStyle(id: string | undefined): VisualStyle | undefined {
  return id ? VISUAL_STYLES.find((s) => s.id === id) : undefined;
}
