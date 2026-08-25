import React from "react";
import { useCurrentFrame } from "remotion";
import { type CaptionPage, type BrandKit } from "../../types/shorts";
import { sanitizeBrandColor } from "../utils";
import { captionLayoutForStyle, containsArabic, type ArabicCaptionStyle } from "../arabicCaptionEngine";

export interface AdvancedCaptionsProps {
  page: CaptionPage;
  startFrame: number;
  fps: number;
  isPortrait: boolean;
  captionPosition: "top" | "center" | "bottom";
  captionPreset?: string;
  brandKit?: BrandKit;
  fontFamily: string;
}

export const AdvancedCaptions: React.FC<AdvancedCaptionsProps> = ({
  page,
  startFrame,
  fps,
  isPortrait,
  captionPosition,
  captionPreset = "bold",
  brandKit,
  fontFamily,
}) => {
  const frame = useCurrentFrame();

  const brandPrimary = sanitizeBrandColor(brandKit?.primaryColor, "#0f172a");
  const brandAccent = sanitizeBrandColor(brandKit?.accentColor, "#38bdf8");

  const pageText = page.lines.flatMap((line) => line.texts.map((text) => text.text)).join(" ");
  const isArabic = containsArabic(pageText);
  const arabicLayout = captionLayoutForStyle(captionPreset as ArabicCaptionStyle, isPortrait);
  const baseFontSize = isArabic ? `${arabicLayout.fontSizePx}px` : isPortrait ? "5.4em" : "7.2em";

  let containerStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    width: "100%",
    paddingLeft: isArabic ? `${arabicLayout.sideMarginPx}px` : isPortrait ? "40px" : "80px",
    paddingRight: isArabic ? `${arabicLayout.sideMarginPx}px` : isPortrait ? "40px" : "80px",
    boxSizing: "border-box",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    direction: isArabic ? "rtl" : "ltr",
    unicodeBidi: isArabic ? "isolate" : "normal",
  };

  if (captionPosition === "top") {
    containerStyle.top = isPortrait ? 180 : 100;
  } else if (captionPosition === "bottom") {
    containerStyle.bottom = isArabic ? arabicLayout.bottomSafeZonePx : isPortrait ? 220 : 120;
  } else {
    containerStyle.top = "50%";
    containerStyle.transform = "translateY(-50%)";
  }

  return (
    <div style={containerStyle}>
      {page.lines.map((line, k) => (
        <p
          key={`caption-line-${k}`}
          style={{
            margin: "0 0 12px 0",
            fontFamily,
            fontSize: baseFontSize,
            lineHeight: isArabic ? 1.18 : 1.25,
            textAlign: "center",
            display: "inline-block",
            maxWidth: "92%",
            direction: isArabic ? "rtl" : "ltr",
            unicodeBidi: isArabic ? "isolate" : "normal",
          }}
        >
          {line.texts.map((text, l) => {
            const active =
              frame >= startFrame + (text.startMs / 1000) * fps &&
              frame <= startFrame + (text.endMs / 1000) * fps;

            let wordStyle: React.CSSProperties = {
              display: "inline-block",
              transition: "transform 0.1s ease",
              margin: "0 4px",
            };

            switch (captionPreset) {
              case "cinematic":
                wordStyle = {
                  ...wordStyle,
                  color: "#f8fafc",
                  fontWeight: active ? 900 : 800,
                  backgroundColor: active ? "rgba(15,23,42,0.72)" : "rgba(15,23,42,0.45)",
                  padding: "5px 14px",
                  borderRadius: "6px",
                  WebkitTextStroke: "1.2px rgba(0,0,0,0.85)",
                  textShadow: "0px 5px 14px rgba(0,0,0,0.85)",
                  transform: active ? "scale(1.06)" : "scale(1.0)",
                };
                break;

              case "viral_bold":
              case "viral":
                wordStyle = {
                  ...wordStyle,
                  color: active ? "#facc15" : "#ffffff", // Vibrant Yellow
                  fontWeight: 900,
                  WebkitTextStroke: "2.5px #000000",
                  textShadow: active
                    ? "0px 0px 18px rgba(250,204,21,0.9), 0px 4px 8px #000000"
                    : "0px 3px 8px #000000",
                  transform: active ? "scale(1.15)" : "scale(1.0)",
                };
                break;

              case "product_ad":
                wordStyle = {
                  ...wordStyle,
                  color: active ? brandAccent : "#ffffff",
                  fontWeight: 900,
                  backgroundColor: active ? brandPrimary : "rgba(2,6,23,0.7)",
                  padding: "6px 16px",
                  borderRadius: "6px",
                  border: `2px solid ${brandAccent}`,
                  WebkitTextStroke: "1.2px #000000",
                  textShadow: "0px 4px 10px rgba(0,0,0,0.75)",
                  transform: active ? "scale(1.08)" : "scale(1.0)",
                };
                break;

              case "educational":
                wordStyle = {
                  ...wordStyle,
                  color: active ? "#0f172a" : "#ffffff",
                  fontWeight: 800,
                  backgroundColor: active ? "#e2e8f0" : "rgba(15,23,42,0.72)",
                  padding: "5px 14px",
                  borderRadius: "5px",
                  WebkitTextStroke: active ? "0" : "1px #000000",
                  textShadow: active ? "none" : "0px 2px 8px rgba(0,0,0,0.8)",
                };
                break;

              case "clean":
                wordStyle = {
                  ...wordStyle,
                  color: "#ffffff",
                  fontWeight: 700,
                  backgroundColor: active ? "rgba(15, 23, 42, 0.85)" : "rgba(0,0,0,0.5)",
                  padding: "4px 12px",
                  borderRadius: "8px",
                  border: active ? "1.5px solid rgba(56,189,248,0.8)" : "none",
                  WebkitTextStroke: "1px #000000",
                };
                break;

              case "minimal":
                wordStyle = {
                  ...wordStyle,
                  color: active ? "#ffffff" : "rgba(255,255,255,0.75)",
                  fontWeight: 600,
                  fontSize: "0.9em",
                  WebkitTextStroke: "1px rgba(0,0,0,0.8)",
                  textShadow: "0px 2px 6px rgba(0,0,0,0.8)",
                };
                break;

              case "brand":
                wordStyle = {
                  ...wordStyle,
                  color: active ? brandAccent : "#ffffff",
                  fontWeight: 800,
                  backgroundColor: active ? brandPrimary : "rgba(0,0,0,0.55)",
                  padding: "4px 14px",
                  borderRadius: "10px",
                  WebkitTextStroke: "1.5px #000000",
                  transform: active ? "scale(1.08)" : "scale(1.0)",
                };
                break;

              case "bold":
              default:
                wordStyle = {
                  ...wordStyle,
                  color: active ? "#38bdf8" : "#ffffff", // Cyan pop
                  fontWeight: 900,
                  WebkitTextStroke: "2px #000000",
                  textShadow: active
                    ? "0px 0px 14px rgba(56,189,248,0.8), 0px 4px 10px #000000"
                    : "0px 3px 8px #000000",
                  transform: active ? "scale(1.12)" : "scale(1.0)",
                };
                break;
            }

            return (
              <span key={`caption-text-${l}`} style={wordStyle}>
                {text.text}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
};
