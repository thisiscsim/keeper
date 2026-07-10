import type { FC } from "react";
import { Composition } from "remotion";
import { durationFrames, EdlSchema } from "@reel/edl";
import { SocialVideo } from "./SocialVideo";

/**
 * Remotion root used by the export bundler (M3). The live preview uses the
 * Player directly with per-project input props; this default exists so the
 * composition is registerable and renderable headlessly.
 */
const defaultEdl = EdlSchema.parse({
  format: { width: 1080, height: 1920, fps: 30 },
  theme: {},
  assets: [],
  tracks: [
    {
      id: "txt",
      type: "text",
      clips: [
        { id: "t1", start: 0.2, end: 2.5, text: "Keeper", style: "title", anim: { name: "soft-blur-in" } },
      ],
    },
  ],
});

export const RemotionRoot: FC = () => {
  return (
    <Composition
      id="SocialVideo"
      component={SocialVideo}
      defaultProps={{ edl: defaultEdl }}
      durationInFrames={durationFrames(defaultEdl)}
      fps={defaultEdl.format.fps}
      width={defaultEdl.format.width}
      height={defaultEdl.format.height}
      calculateMetadata={({ props }) => ({
        durationInFrames: durationFrames(props.edl),
        fps: props.edl.format.fps,
        width: props.edl.format.width,
        height: props.edl.format.height,
      })}
    />
  );
};
