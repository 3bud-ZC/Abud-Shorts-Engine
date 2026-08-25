import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  OffthreadVideo,
} from "remotion";
import { sanitizeBrandColor } from "../utils";

export interface ProductAdProps {
  productImageUrl?: string;
  productNobgUrl?: string;
  headline?: string;
  offerText?: string;
  priceText?: string;
  ctaText?: string;
  contactText?: string;
  backgroundType?: "gradient" | "solid" | "video" | "image";
  backgroundUrl?: string;
  placement?: "center" | "left" | "right";
  brandPrimaryColor?: string;
  brandAccentColor?: string;
  brandSecondaryColor?: string;
  fontFamily?: string;
  durationInFrames: number;
}

export const ProductAdComposition: React.FC<ProductAdProps> = ({
  productImageUrl,
  productNobgUrl,
  headline = "عرض حصري لفترة محدودة",
  offerText = "خصم 25%",
  priceText,
  ctaText = "اطلب الآن عبر واتساب",
  contactText,
  backgroundType = "gradient",
  backgroundUrl,
  placement = "center",
  brandPrimaryColor = "#24545a",
  brandAccentColor = "#d97706",
  brandSecondaryColor = "#11222c",
  fontFamily = "'Cairo', sans-serif",
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const primary = sanitizeBrandColor(brandPrimaryColor, "#24545a");
  const accent = sanitizeBrandColor(brandAccentColor, "#d97706");
  const secondary = sanitizeBrandColor(brandSecondaryColor, "#11222c");

  // Entrance spring animation for product image
  const productSpring = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.8, stiffness: 120 },
  });

  // Floating hover animation
  const floatY = Math.sin((frame / fps) * 3) * 15;
  const floatRotate = Math.sin((frame / fps) * 2) * 2;

  // Pulse effect for offer badge
  const badgePulse = 1.0 + Math.sin((frame / fps) * 5) * 0.05;

  const displayProductUrl = productNobgUrl || productImageUrl;

  const getPlacementStyle = (): React.CSSProperties => {
    if (placement === "left") {
      return { transform: `translate(-120px, ${floatY}px) rotate(${floatRotate}deg)` };
    }
    if (placement === "right") {
      return { transform: `translate(120px, ${floatY}px) rotate(${floatRotate}deg)` };
    }
    return { transform: `translate(0px, ${floatY}px) rotate(${floatRotate}deg)` };
  };

  return (
    <AbsoluteFill style={{ overflow: "hidden", fontFamily }}>
      {/* 1. Background Layer */}
      {backgroundType === "video" && backgroundUrl ? (
        <AbsoluteFill>
          <OffthreadVideo src={backgroundUrl} muted style={{ objectFit: "cover" }} />
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.85) 100%)`,
            }}
          />
        </AbsoluteFill>
      ) : backgroundType === "image" && backgroundUrl ? (
        <AbsoluteFill>
          <Img src={backgroundUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.8) 100%)`,
            }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 50% 40%, ${primary}dd 0%, ${secondary} 80%, #030712 100%)`,
          }}
        >
          {/* Subtle geometric light rings */}
          <div
            style={{
              position: "absolute",
              top: "30%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "700px",
              height: "700px",
              borderRadius: "50%",
              border: `2px dashed ${accent}44`,
              opacity: 0.6,
            }}
          />
        </AbsoluteFill>
      )}

      {/* 2. Top Headline / Banner */}
      {headline && (
        <div
          style={{
            position: "absolute",
            top: "8%",
            left: "5%",
            right: "5%",
            textAlign: "center",
            opacity: Math.min(1, frame / 15),
            transform: `translateY(${interpolate(frame, [0, 15], [-30, 0], { extrapolateRight: "clamp" })}px)`,
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: "inline-block",
              padding: "16px 36px",
              backgroundColor: "rgba(0, 0, 0, 0.65)",
              backdropFilter: "blur(12px)",
              border: `2px solid ${accent}`,
              borderRadius: "24px",
              color: "#ffffff",
              fontSize: "44px",
              fontWeight: 800,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              direction: "rtl",
            }}
          >
            {headline}
          </div>
        </div>
      )}

      {/* 3. Product Display with Depth Shadow & Floating Spring */}
      <div
        style={{
          position: "absolute",
          top: "40%",
          left: "50%",
          transform: `translate(-50%, -50%) scale(${productSpring})`,
          width: "720px",
          height: "720px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 5,
        }}
      >
        <div style={getPlacementStyle()}>
          {displayProductUrl ? (
            <Img
              src={displayProductUrl}
              style={{
                maxWidth: "680px",
                maxHeight: "680px",
                objectFit: "contain",
                filter: "drop-shadow(0 30px 45px rgba(0, 0, 0, 0.65)) drop-shadow(0 10px 15px rgba(0, 0, 0, 0.4))",
              }}
            />
          ) : (
            <div
              style={{
                width: "480px",
                height: "480px",
                borderRadius: "36px",
                backgroundColor: primary,
                border: `4px solid ${accent}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#ffffff",
                fontSize: "48px",
                fontWeight: 800,
                boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
              }}
            >
              PRODUCT
            </div>
          )}
        </div>

        {/* 4. Offer Badge Overlay */}
        {offerText && (
          <div
            style={{
              position: "absolute",
              top: "10%",
              right: "5%",
              transform: `scale(${badgePulse}) rotate(12deg)`,
              backgroundColor: accent,
              color: "#ffffff",
              padding: "18px 28px",
              borderRadius: "50px",
              fontSize: "42px",
              fontWeight: 900,
              boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
              direction: "rtl",
              zIndex: 12,
            }}
          >
            {offerText}
          </div>
        )}

        {/* 5. Price Tag */}
        {priceText && (
          <div
            style={{
              position: "absolute",
              bottom: "8%",
              left: "8%",
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              color: "#ffffff",
              padding: "14px 28px",
              borderRadius: "20px",
              border: `2px solid ${accent}`,
              fontSize: "36px",
              fontWeight: 800,
              boxShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
              direction: "rtl",
              zIndex: 12,
            }}
          >
            {priceText}
          </div>
        )}
      </div>

      {/* 6. Bottom CTA Card (Above Caption Safe Area) */}
      {ctaText && (
        <div
          style={{
            position: "absolute",
            bottom: "18%",
            left: "8%",
            right: "8%",
            textAlign: "center",
            zIndex: 15,
            opacity: Math.min(1, (frame - 15) / 15),
            transform: `translateY(${interpolate(frame, [15, 30], [20, 0], { extrapolateRight: "clamp" })}px)`,
          }}
        >
          <div
            style={{
              display: "inline-block",
              width: "100%",
              padding: "20px 32px",
              backgroundColor: accent,
              borderRadius: "28px",
              color: "#ffffff",
              fontSize: "42px",
              fontWeight: 900,
              boxShadow: "0 12px 35px rgba(0, 0, 0, 0.6)",
              direction: "rtl",
            }}
          >
            {ctaText}
          </div>
          {contactText && (
            <div
              style={{
                marginTop: "12px",
                color: "#e2e8f0",
                fontSize: "28px",
                fontWeight: 700,
                direction: "ltr",
              }}
            >
              {contactText}
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};
