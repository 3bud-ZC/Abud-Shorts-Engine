/**
 * Live semantic-gate qualification — runs INSIDE the render-worker container
 * against the real provider vault + real OpenCLIP runtime.
 *
 * Case 1 "automatic bank savings": candidate pool deliberately includes a
 * `coffee beans` query (the previously-observed wrong-winner). Coffee must not
 * win: either a banking clip wins with semanticRuntime=open_clip evidence, or
 * the scene is rejected to the purposeful-motion fallback.
 *
 * Case 2 "API cache hit": a generic laptop/programmer shot must not
 * automatically win over a genuinely explanatory candidate.
 */
const {
  AutoVisualRouter,
  StockVisualRejection,
} = require("/app/dist/server/v2/visual-providers/router.js");
const {
  StockProviderRegistry,
} = require("/app/dist/server/v2/stock-providers/stockProviderRegistry.js");
const {
  ProviderCircuitBreaker,
} = require("/app/dist/server/v2/providers/providerServicePolicy.js");

const stubPexels = {
  id: "pexels-legacy-stub",
  isConfigured: () => false,
  fetchOrGenerateScene: async () => {
    throw new Error("legacy path disabled in test");
  },
};

function summarize(res) {
  const m = res.metadata || {};
  return {
    provider: res.provider,
    source: res.source,
    searchTerm: m.searchTerm,
    selectedScore: m.selectedScore,
    semanticScore: m.semanticScore,
    visualSemanticScore: m.visualSemanticScore,
    semanticRuntime: m.semanticRuntime,
    semanticAvailable: m.semanticAvailable,
    qualityScore: m.qualityScore,
    candidateCount: m.candidateCount,
    top: (m.candidates || []).slice(0, 6).map((c) => ({
      assetId: c.assetId,
      provider: c.provider,
      query: c.queryUsed,
      lexical: c.semanticScore,
      openclip: c.visualSemanticScore,
      runtime: c.semanticRuntime,
      quality: c.qualityScore,
      decision: c.decisionScore,
    })),
    rejectedForGrounding: m.candidatesRejectedForGrounding,
  };
}

async function run() {
  const registry = new StockProviderRegistry();
  const router = new AutoVisualRouter(
    stubPexels,
    [],
    registry,
    new ProviderCircuitBreaker(),
  );
  const options = {
    tempDirPath: "/app/data/temp/semgate-live",
    targetDurationSeconds: 5,
    orientation: "portrait",
    excludeIds: [],
    genericStockTerms: [],
    onPerf: (e) => console.log("PERF", JSON.stringify(e)),
  };
  const spec = { visualMode: "stock", quality: "standard", metadata: {} };

  const cases = [
    {
      name: "automatic bank savings (coffee trap)",
      scene: {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: 5,
        narration: "أنت فعلا تتعب من إيداع المال وتخطيط النفقات؟",
        onScreenText: "إيداع الأموال",
        visualPrompt: "Person depositing money into a bank counter",
        visualIntent: "Person depositing money into a bank counter",
        visualSource: "stock",
        stockSearchTerms: [
          "person depositing money",
          "bank counter",
          "money in bank",
          "coffee beans",
        ],
      },
    },
    {
      name: "API cache hit (generic laptop trap)",
      scene: {
        sceneIndex: 0,
        purpose: "solution",
        durationSeconds: 5,
        narration: "API caching speeds up repeat requests by storing responses",
        onScreenText: "API Cache",
        visualPrompt: "API cache hit server infrastructure data flow diagram",
        visualIntent: "API cache hit server infrastructure data flow diagram",
        visualSource: "stock",
        stockSearchTerms: [
          "API cache server",
          "server infrastructure data",
          "programmer laptop coding",
        ],
      },
    },
  ];

  for (const { name, scene } of cases) {
    try {
      const res = await router.resolveSceneVisual(scene, spec, options);
      console.log(`\n=== ${name} => WINNER ===`);
      console.log(JSON.stringify(summarize(res), null, 1));
    } catch (error) {
      console.log(`\n=== ${name} => REJECTED (${error.name}) ===`);
      console.log(
        JSON.stringify(error instanceof StockVisualRejection ? error.details : String(error), null, 1),
      );
    }
  }
  process.exit(0);
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
