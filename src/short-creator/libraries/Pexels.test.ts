process.env.LOG_LEVEL = "debug";

import nock from "nock";
import { PexelsAPI } from "./Pexels";
import { test, assert, expect, describe, beforeEach } from "vitest";
import fs from "fs-extra";
import path from "path";

const loadMockResponse = () =>
  JSON.parse(
    fs.readFileSync(path.resolve("__mocks__/pexels-response.json"), "utf-8"),
  );

describe("PexelsAPI", () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  test("primary term succeeds", async () => {
    nock("https://api.pexels.com")
      .get(/videos\/search/)
      .reply(200, loadMockResponse());
    const pexels = new PexelsAPI("asdf");
    const video = await pexels.findVideo(["dog"], 2.4);
    assert.isObject(video, "Video should be an object");
  });

  test("moves to fallback term when first term times out", async () => {
    nock("https://api.pexels.com")
      .get((uri) => uri.includes("dog"))
      .delay(200)
      .times(2)
      .reply(200, {});

    nock("https://api.pexels.com")
      .get((uri) => uri.includes("cat"))
      .reply(200, loadMockResponse());

    const pexels = new PexelsAPI("asdf");
    const video = await pexels.findVideo(["dog", "cat"], 2.4, {
      timeout: 50,
    });
    expect(video.id).toBeDefined();
  });

  test("falls back when primary term has no results", async () => {
    nock("https://api.pexels.com")
      .get((uri) => uri.includes("egypt%20market"))
      .reply(200, { videos: [] });

    nock("https://api.pexels.com")
      .get((uri) => uri.includes("clothing"))
      .reply(200, loadMockResponse());

    const pexels = new PexelsAPI("asdf");
    const video = await pexels.findVideo(["egypt market"], 2.4, {
      fallbackSearchTerms: ["clothing"],
    });
    expect(video.id).toBeDefined();
  });

  test("dedupes overlapping primary and fallback terms", async () => {
    const scope = nock("https://api.pexels.com")
      .get((uri) => uri.includes("dog"))
      .reply(200, loadMockResponse());

    const pexels = new PexelsAPI("asdf");
    const video = await pexels.findVideo(["dog"], 2.4, {
      fallbackSearchTerms: ["dog", "clothing"],
    });
    expect(video.id).toBeDefined();
    expect(scope.isDone()).toBe(true);
  });

  test("summary error reports attempted terms after exhaustion", async () => {
    nock("https://api.pexels.com")
      .get(/videos\/search/)
      .reply(200, { videos: [] });

    const pexels = new PexelsAPI("asdf");
    await expect(
      pexels.findVideo(["dog"], 2.4, {
        fallbackSearchTerms: ["clothing"],
      }),
    ).rejects.toThrow(/attempted: dog, clothing/);
  });
});
