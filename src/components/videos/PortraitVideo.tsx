import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  Audio,
  OffthreadVideo,
} from "remotion";
import { z } from "zod";
import {
  calculateVolume,
  createCaptionPages,
  sanitizeBrandColor,
  shortVideoSchema,
} from "../utils";
import { MotionWrapper } from "./MotionWrapper";
import { AdvancedCaptions } from "./AdvancedCaptions";
import { AdvancedCtaOverlay } from "./AdvancedCtaOverlay";
import { ProductAdComposition } from "./ProductAdComposition";

const fontFamily = "'Cairo', 'Barlow Condensed', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const PortraitVideo: React.FC<z.infer<typeof shortVideoSchema>> = ({
  scenes,
  music,
  config,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const brandKit = config.brandKit;
  const brandPrimaryColor = sanitizeBrandColor(
    brandKit?.primaryColor,
    "rgba(0,0,0,0.6)",
  );
  const brandAccentColor = sanitizeBrandColor(brandKit?.accentColor, "white");

  const captionPosition = config.captionPosition ?? "bottom";
  const [musicVolume, musicMuted] = calculateVolume(config.musicVolume);
  const duckingProfile = config.musicDuckingProfile || "balanced";
  const duckingFloor = duckingProfile === "subtle" ? 0.68 : duckingProfile === "strong" ? 0.34 : 0.48;

  const totalDurationFrames = Math.floor((config.durationMs / 1000) * fps);
  const outroDurationFrames = Math.min(60, Math.floor(totalDurationFrames * 0.15));
  const outroStartFrame = totalDurationFrames - outroDurationFrames;
  const sceneStartMs = scenes.map((_scene, i) =>
    scenes.slice(0, i).reduce((acc, curr) => acc + curr.audio.duration * 1000, 0),
  );

  const speechDuckingAtFrame = (globalFrame: number) => {
    const ms = (globalFrame / fps) * 1000;
    const recoveryMs = 420;
    let strongest = 1;
    scenes.forEach((scene, i) => {
      (scene.speechWindowsMs || []).forEach((window) => {
        const start = sceneStartMs[i] + window.startMs - 90;
        const end = sceneStartMs[i] + window.endMs;
        if (ms >= start && ms <= end) {
          strongest = Math.min(strongest, duckingFloor);
        } else if (ms > end && ms <= end + recoveryMs) {
          const recover = duckingFloor + (1 - duckingFloor) * ((ms - end) / recoveryMs);
          strongest = Math.min(strongest, recover);
        }
      });
    });
    return strongest;
  };

  const musicVolumeFn = (f: number) => {
    if (musicMuted) return 0;
    const fadeInFrames = 15;
    const fadeOutFrames = 25;
    let factor = 1.0;
    if (f < fadeInFrames) {
      factor = f / fadeInFrames;
    } else if (f > totalDurationFrames - fadeOutFrames) {
      factor = Math.max(0, (totalDurationFrames - f) / fadeOutFrames);
    }
    return musicVolume * factor * speechDuckingAtFrame(f);
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#020617" }}>
      <Audio
        loop
        src={music.url}
        startFrom={music.start * fps}
        endAt={music.end * fps}
        volume={(f) => musicVolumeFn(f)}
        muted={musicMuted}
      />

      {scenes.map((scene, i) => {
        const { captions, audio, video, motion = "slow_zoom", segments } = scene;
        const pages = createCaptionPages({
          captions,
          lineMaxLength: 20,
          lineCount: 2,
          maxDistanceMs: 1000,
          captionPreset: config.captionPreset || brandKit?.captionStyle || "viral_bold",
          isPortrait: true,
        });

        // Calculate the start and individual duration of the scene
        const startFrame = Math.round(
          scenes.slice(0, i).reduce((acc, curr) => {
            return acc + curr.audio.duration;
          }, 0) * fps,
        );
        let sceneDurationFrames = Math.max(1, Math.round(scene.audio.duration * fps));
        if (config.paddingBack && i === scenes.length - 1) {
          sceneDurationFrames += Math.round((config.paddingBack / 1000) * fps);
        }

        return (
          <Sequence
            from={startFrame}
            durationInFrames={sceneDurationFrames}
            key={`scene-${i}`}
          >
            {/* Visual media layer (with product composition and multi-segment support) */}
            {(scene as any).productNobgUrl || (scene as any).productImageUrl || (scene as any).visualSource === "product_composition" ? (
              <ProductAdComposition
                productImageUrl={(scene as any).productImageUrl}
                productNobgUrl={(scene as any).productNobgUrl}
                headline={(scene as any).productHeadline || config.brandKit?.outroText}
                offerText={(scene as any).productOffer || "عرض خاص"}
                priceText={(scene as any).productPrice}
                ctaText={(scene as any).productCta || config.brandKit?.outroText || "اطلب الآن"}
                contactText={(scene as any).productContact || config.brandKit?.contactText}
                backgroundType={(scene as any).backgroundType || "gradient"}
                backgroundUrl={(scene as any).backgroundUrl || video}
                placement={(scene as any).productPlacement || "center"}
                brandPrimaryColor={brandKit?.primaryColor}
                brandAccentColor={brandKit?.accentColor}
                fontFamily={fontFamily}
                durationInFrames={sceneDurationFrames}
              />
            ) : segments && segments.length > 0 ? (
              segments.map((seg, sIdx) => {
                const segStartFrame = Math.round(
                  segments.slice(0, sIdx).reduce((sum, s) => sum + s.duration, 0) * fps,
                );
                const segDurationFrames = Math.max(1, Math.round(seg.duration * fps));

                return (
                  <Sequence
                    from={segStartFrame}
                    durationInFrames={segDurationFrames}
                    key={`scene-${i}-seg-${sIdx}`}
                  >
                    <MotionWrapper
                      preset={seg.motion || motion}
                      durationInFrames={segDurationFrames}
                    >
                      <OffthreadVideo src={seg.video} muted />
                    </MotionWrapper>
                  </Sequence>
                );
              })
            ) : (
              <MotionWrapper
                preset={motion}
                durationInFrames={sceneDurationFrames}
              >
                <OffthreadVideo src={video} muted />
              </MotionWrapper>
            )}

            {/* Voice Audio track */}
            <Audio src={audio.url} />

            {/* Advanced Captions layer */}
            {pages.map((page, j) => {
              const pageStartFrame = Math.round((page.startMs / 1000) * fps);
              const pageDurationFrames = Math.max(
                1,
                Math.round(((page.endMs - page.startMs) / 1000) * fps),
              );

              return (
                <Sequence
                  key={`scene-${i}-page-${j}`}
                  from={pageStartFrame}
                  durationInFrames={pageDurationFrames}
                >
                  <AdvancedCaptions
                    page={page}
                    startFrame={pageStartFrame}
                    fps={fps}
                    isPortrait={true}
                    captionPosition={captionPosition}
                    captionPreset={config.captionPreset || brandKit?.captionStyle || "bold"}
                    brandKit={brandKit}
                    fontFamily={fontFamily}
                  />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}

      {/* Watermark overlay */}
      {brandKit?.watermarkText && (
        <AbsoluteFill
          style={{
            justifyContent: "flex-start",
            alignItems: "flex-end",
            pointerEvents: "none",
            zIndex: 15,
          }}
        >
          <div
            style={{
              margin: "40px",
              padding: "12px 24px",
              backgroundColor: brandPrimaryColor,
              color: brandAccentColor,
              fontFamily,
              fontSize: "2.4em",
              fontWeight: 800,
              borderRadius: "12px",
              opacity: 0.85,
              maxWidth: "55%",
              overflow: "hidden",
              boxShadow: "0px 4px 12px rgba(0,0,0,0.5)",
            }}
          >
            {brandKit.watermarkText}
          </div>
        </AbsoluteFill>
      )}

      {/* Branded outro overlay */}
      {brandKit?.includeOutro && (
        <Sequence
          from={outroStartFrame}
          durationInFrames={outroDurationFrames}
        >
          <AdvancedCtaOverlay
            brandKit={brandKit}
            ctaText={brandKit.outroText}
            contactText={brandKit.contactText}
            fontFamily={fontFamily}
            durationInFrames={outroDurationFrames}
            layout={(config.ctaLayout as any) || "centered"}
          />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
