import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { type BrandKit } from "../../types/shorts";
import { sanitizeBrandColor } from "../utils";

export interface AdvancedCtaOverlayProps {
  brandKit?: BrandKit;
  ctaText?: string;
  contactText?: string;
  fontFamily: string;
  durationInFrames: number;
  layout?: "minimal" | "centered" | "product" | "social" | "contact";
}

export const AdvancedCtaOverlay: React.FC<AdvancedCtaOverlayProps> = ({
  brandKit,
  ctaText,
  contactText,
  fontFamily,
  durationInFrames,
  layout = "centered",
}) => {
  const frame = useCurrentFrame();

  const brandPrimary = sanitizeBrandColor(brandKit?.primaryColor, "rgba(15, 23, 42, 0.95)");
  const brandAccent = sanitizeBrandColor(brandKit?.accentColor, "#38bdf8");

  const opacity = interpolate(frame, [0, 8], [0, 0.95], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(frame, [0, 10], [40, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const finalCta = ctaText || brandKit?.outroText || "اطلب الآن عبر واتساب";
  const finalContact = contactText || brandKit?.contactText || brandKit?.brandName || "ABUD Shorts";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brandPrimary,
        opacity,
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        padding: "40px",
        boxSizing: "border-box",
        direction: "rtl",
        transform: `translateY(${translateY}px)`,
        zIndex: 20,
      }}
    >
      {/* Brand Name Badge */}
      {brandKit?.brandName && (
        <div
          style={{
            fontFamily,
            color: brandAccent,
            fontSize: "4.5em",
            fontWeight: 900,
            marginBottom: "24px",
            textAlign: "center",
            textShadow: "0px 4px 16px rgba(0,0,0,0.6)",
          }}
        >
          {brandKit.brandName}
        </div>
      )}

      {/* Main CTA Offer */}
      <div
        style={{
          fontFamily,
          color: "#ffffff",
          fontSize: "3.6em",
          fontWeight: 800,
          marginBottom: "32px",
          textAlign: "center",
          maxWidth: "88%",
          lineHeight: 1.3,
          backgroundColor: "rgba(255, 255, 255, 0.1)",
          padding: "16px 36px",
          borderRadius: "20px",
          border: `2px solid ${brandAccent}`,
        }}
      >
        {finalCta}
      </div>

      {/* Contact Badge */}
      <div
        style={{
          fontFamily,
          fontSize: "2.8em",
          fontWeight: 700,
          textAlign: "center",
          backgroundColor: brandAccent,
          color: "#0f172a",
          padding: "12px 32px",
          borderRadius: "14px",
          boxShadow: "0px 8px 24px rgba(56, 189, 248, 0.4)",
        }}
      >
        {finalContact}
      </div>
    </AbsoluteFill>
  );
};
