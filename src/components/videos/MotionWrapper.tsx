import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type MotionPreset =
  | "none"
  | "slow_zoom"
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "slide"
  | "parallax"
  | "punch_in"
  | "handheld_subtle";

export interface MotionWrapperProps {
  preset?: MotionPreset | string;
  durationInFrames: number;
  children: React.ReactNode;
}

export const MotionWrapper: React.FC<MotionWrapperProps> = ({
  preset = "slow_zoom",
  durationInFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const safeDuration = Math.max(1, durationInFrames);

  let transform = "scale(1)";
  let opacity = 1;

  switch (preset) {
    case "slow_zoom": {
      const scale = interpolate(frame, [0, safeDuration], [1.0, 1.08], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      transform = `scale(${scale})`;
      break;
    }
    case "zoom_in": {
      const scale = interpolate(frame, [0, safeDuration], [1.0, 1.18], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      transform = `scale(${scale})`;
      break;
    }
    case "zoom_out": {
      const scale = interpolate(frame, [0, safeDuration], [1.18, 1.0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      transform = `scale(${scale})`;
      break;
    }
    case "pan_left": {
      const translateX = interpolate(frame, [0, safeDuration], [3, -3], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const scale = 1.06;
      transform = `scale(${scale}) translateX(${translateX}%)`;
      break;
    }
    case "pan_right": {
      const translateX = interpolate(frame, [0, safeDuration], [-3, 3], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const scale = 1.06;
      transform = `scale(${scale}) translateX(${translateX}%)`;
      break;
    }
    case "punch_in": {
      const scale = interpolate(frame, [0, 8, safeDuration], [1.2, 1.05, 1.08], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      transform = `scale(${scale})`;
      break;
    }
    case "handheld_subtle": {
      const offsetX = Math.sin(frame * 0.08) * 1.5;
      const offsetY = Math.cos(frame * 0.06) * 1.2;
      const scale = 1.04;
      transform = `scale(${scale}) translate(${offsetX}px, ${offsetY}px)`;
      break;
    }
    case "none":
    default:
      transform = "scale(1)";
      break;
  }

  return (
    <AbsoluteFill
      style={{
        transform,
        opacity,
        overflow: "hidden",
        width: "100%",
        height: "100%",
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
