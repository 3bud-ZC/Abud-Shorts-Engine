import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expectedResourceNames,
  findSemanticProof,
  missingNamespaceResources,
  parseEnvText,
  sanitizePublicEvidence,
  sha256File,
} from "./fresh-install-acceptance.mjs";

test("parseEnvText ignores comments and preserves values internally", () => {
  const env = parseEnvText("# comment\nA=one\nB=two=three\n");
  assert.equal(env.A, "one");
  assert.equal(env.B, "two=three");
});

test("findSemanticProof accepts only real OpenCLIP evidence", () => {
  assert.equal(
    findSemanticProof({ semanticRuntime: "perceptual_hash_only", visualSemanticScore: 90 }),
    null,
  );
  assert.deepEqual(
    findSemanticProof({
      nested: [{ semanticRuntime: "open_clip", visualSemanticScore: 67.2, semanticModelId: "openclip:test" }],
    }),
    { runtime: "open_clip", score: 67.2, modelId: "openclip:test" },
  );
});

test("sanitizePublicEvidence strips sensitive fields recursively", () => {
  assert.deepEqual(
    sanitizePublicEvidence({
      token: "secret",
      apiKey: "secret2",
      password: "secret3",
      status: "ok",
      nested: { licenseKey: "secret4", value: 3 },
    }),
    { status: "ok", nested: { value: 3 } },
  );
});

test("sha256File streams a file to the expected digest", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-acceptance-sha-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "payload.bin");
  // Bigger than a single default stream chunk (64 KiB) so the digest provably
  // aggregates multiple 'data' events, matching the multi-GB installer path.
  const payload = crypto.randomBytes(256 * 1024);
  fs.writeFileSync(file, payload);
  const expected = crypto.createHash("sha256").update(payload).digest("hex");

  assert.equal(await sha256File(file), expected);
  // Deterministic: hashing twice yields the same digest.
  assert.equal(await sha256File(file), expected);
});

test("sha256File rejects on unreadable files instead of producing a digest", async () => {
  const missing = path.join(os.tmpdir(), `ss-acceptance-missing-${process.pid}-${Date.now()}`);
  await assert.rejects(sha256File(missing));
});

test("expectedResourceNames derives an isolated Docker namespace", () => {
  assert.deepEqual(expectedResourceNames("short-studio-acceptance"), {
    containers: [
      "short-studio-acceptance-app",
      "short-studio-acceptance-render-worker",
      "short-studio-acceptance-postgres",
      "short-studio-acceptance-n8n",
    ],
    volumes: [
      "short-studio-acceptance-postgres-data",
      "short-studio-acceptance-n8n-data",
    ],
    network: "short-studio-acceptance-v2",
  });
});

test("missingNamespaceResources returns empty when the installed namespace is complete", () => {
  const expected = expectedResourceNames("short-studio-acceptance");
  assert.deepEqual(
    missingNamespaceResources(expected, {
      containers: [...expected.containers, "unrelated-container"],
      volumes: [...expected.volumes, "unrelated-volume"],
      networks: [expected.network, "unrelated-network"],
    }),
    [],
  );
});

test("missingNamespaceResources names every absent container, volume and network", () => {
  const expected = expectedResourceNames("short-studio-acceptance");
  assert.deepEqual(
    missingNamespaceResources(expected, {
      containers: ["short-studio-acceptance-app"],
      volumes: [],
      networks: [],
    }),
    [
      "short-studio-acceptance-render-worker",
      "short-studio-acceptance-postgres",
      "short-studio-acceptance-n8n",
      "short-studio-acceptance-postgres-data",
      "short-studio-acceptance-n8n-data",
      "short-studio-acceptance-v2",
    ],
  );
});
