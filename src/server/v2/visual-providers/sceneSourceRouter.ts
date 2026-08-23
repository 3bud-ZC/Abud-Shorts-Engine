import type { ProductionSpec, ProductionSceneSpec, VisualSource } from "../../../types/productionSpec";

export type SceneSourceDecision = {
  sceneIndex: number;
  source: VisualSource;
  providerId: string;
  reason: string;
  fallbackSource: VisualSource;
  persistedMetadata: Record<string, unknown>;
};

function hasUploadedMedia(scene: ProductionSceneSpec): boolean {
  return Boolean((scene as any).uploadedMediaId || (scene as any).uploadedMediaRef || scene.visualProvider === "uploaded_media");
}

function hasProductImage(spec: ProductionSpec, scene: ProductionSceneSpec): boolean {
  return Boolean((spec.metadata as any)?.productImageId || (scene as any).productImageId || spec.contentStyle === "product_showcase");
}

export class SceneSourceRouter {
  public routeScene(spec: ProductionSpec, scene: ProductionSceneSpec): SceneSourceDecision {
    const productionMode = spec.productionMode || "auto_hybrid";
    const visualMode = spec.visualMode || "auto";

    if (hasUploadedMedia(scene) || productionMode === "custom_media" || visualMode === "uploaded_media") {
      return this.decision(scene, "uploaded_media", "uploaded_media", "uploaded_media_selected");
    }
    if (hasProductImage(spec, scene) || productionMode === "product_ad" || visualMode === "product_ad") {
      return this.decision(scene, "product_composition", "rembg_product_pipeline", "product_ad_composition");
    }
    if (productionMode === "motion_graphics" || visualMode === "motion_graphics") {
      return this.decision(scene, "motion_graphics", "motion_canvas", "motion_graphics_mode");
    }
    if (productionMode === "animated_explainer" || visualMode === "animated_explainer") {
      return this.decision(scene, "motion_graphics", "motion_canvas", "animated_explainer_mode");
    }
    if (productionMode === "ai_generated" || visualMode === "ai") {
      return this.decision(scene, "ai_generated_video", scene.visualProvider || "comfyui_or_configured_cloud", "ai_video_explicit");
    }
    if (visualMode === "image_animation") {
      return this.decision(scene, "image_animation", "remotion_image_motion", "image_animation_mode");
    }
    if (visualMode === "hybrid" || productionMode === "auto_hybrid") {
      if (scene.purpose === "hook" && process.env.AI_GPU_PACK_ENABLED === "true") {
        return this.decision(scene, "ai_generated_video", "comfyui", "hybrid_hook_ai_when_gpu_pack_enabled");
      }
      if (scene.purpose === "cta" && spec.contentStyle === "product_showcase") {
        return this.decision(scene, "motion_graphics", "motion_canvas", "hybrid_cta_motion");
      }
    }
    return this.decision(scene, "stock", "pexels", visualMode === "stock" ? "stock_mode" : "stock_cinematic_fallback");
  }

  public routeSpec(spec: ProductionSpec): SceneSourceDecision[] {
    return spec.scenes.map((scene) => this.routeScene(spec, scene));
  }

  private decision(
    scene: ProductionSceneSpec,
    source: VisualSource,
    providerId: string,
    reason: string,
  ): SceneSourceDecision {
    return {
      sceneIndex: scene.sceneIndex,
      source,
      providerId,
      reason,
      fallbackSource: "stock",
      persistedMetadata: {
        sceneIndex: scene.sceneIndex,
        source,
        providerId,
        reason,
        selectedAt: new Date().toISOString(),
      },
    };
  }
}

export const sceneSourceRouter = new SceneSourceRouter();
