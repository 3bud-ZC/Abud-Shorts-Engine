process.env.LOG_LEVEL = "debug";

import fs from "fs-extra";
import os from "os";
import path from "path";

const tmpDir = path.join(os.tmpdir(), `short-creator-test-${Date.now()}`);
fs.ensureDirSync(tmpDir);
process.env.DATA_DIR_PATH = tmpDir;

import { test, expect, vi, afterAll } from "vitest";

import { ShortCreator } from "./ShortCreator";
import { Kokoro } from "./libraries/Kokoro";
import { Remotion } from "./libraries/Remotion";
import { Whisper } from "./libraries/Whisper";
import { FFMpeg } from "./libraries/FFmpeg";
import { PexelsAPI } from "./libraries/Pexels";
import { Config } from "../config";
import { MusicManager } from "./music";

afterAll(() => {
  fs.removeSync(tmpDir);
});

// Mock fluent-ffmpeg
vi.mock("fluent-ffmpeg", () => {
  const mockOn = vi.fn().mockReturnThis();
  const mockSave = vi.fn().mockReturnThis();
  const mockPipe = vi.fn().mockReturnThis();

  const ffmpegMock = vi.fn(() => ({
    input: vi.fn().mockReturnThis(),
    audioCodec: vi.fn().mockReturnThis(),
    audioBitrate: vi.fn().mockReturnThis(),
    audioChannels: vi.fn().mockReturnThis(),
    audioFrequency: vi.fn().mockReturnThis(),
    toFormat: vi.fn().mockReturnThis(),
    on: mockOn,
    save: mockSave,
    pipe: mockPipe,
  }));

  ffmpegMock.setFfmpegPath = vi.fn();

  return { default: ffmpegMock };
});

// mock kokoro-js
vi.mock("kokoro-js", () => {
  return {
    KokoroTTS: {
      from_pretrained: vi.fn().mockResolvedValue({
        generate: vi.fn().mockResolvedValue({
          toWav: vi.fn().mockReturnValue(new ArrayBuffer(8)),
          audio: new ArrayBuffer(8),
          sampling_rate: 44100,
        }),
      }),
    },
  };
});

// mock remotion
vi.mock("@remotion/bundler", () => {
  return {
    bundle: vi.fn().mockResolvedValue("mocked-bundled-url"),
  };
});
vi.mock("@remotion/renderer", () => {
  return {
    renderMedia: vi.fn().mockResolvedValue(undefined),
    selectComposition: vi.fn().mockResolvedValue({
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 300,
    }),
    ensureBrowser: vi.fn().mockResolvedValue(undefined),
  };
});

// mock whisper
vi.mock("@remotion/install-whisper-cpp", () => {
  return {
    downloadWhisperModel: vi.fn().mockResolvedValue(undefined),
    installWhisperCpp: vi.fn().mockResolvedValue(undefined),
    transcribe: vi.fn().mockResolvedValue({
      transcription: [
        {
          text: "This is a mock transcription.",
          offsets: { from: 0, to: 2000 },
          tokens: [
            { text: "This", timestamp: { from: 0, to: 500 } },
            { text: " is", timestamp: { from: 500, to: 800 } },
            { text: " a", timestamp: { from: 800, to: 1000 } },
            { text: " mock", timestamp: { from: 1000, to: 1500 } },
            { text: " transcription.", timestamp: { from: 1500, to: 2000 } },
          ],
        },
      ],
    }),
  };
});

test("test me", async () => {
  const kokoro = await Kokoro.init("fp16");
  vi.spyOn(kokoro, "generate").mockResolvedValue({
    audio: new ArrayBuffer(8),
    audioLength: 1,
  } as any);
  const ffmpeg = await FFMpeg.init();

  vi.spyOn(ffmpeg, "saveNormalizedAudio").mockResolvedValue("mocked-path.wav");
  vi.spyOn(ffmpeg, "saveToMp3").mockResolvedValue("mocked-path.mp3");
  vi.spyOn(ffmpeg, "saveNormalizedAudioWithSpeed").mockImplementation(async (_audio, outputPath) => {
    fs.writeFileSync(outputPath, "wav");
    return { duration: 1 };
  });
  vi.spyOn(ffmpeg, "masterVoiceAudioFile").mockImplementation(async (_inputPath, outputPath) => {
    fs.writeFileSync(outputPath, "mastered wav");
    return outputPath;
  });
  vi.spyOn(ffmpeg, "saveWavToMp3").mockImplementation(async (_wavPath, mp3Path) => {
    fs.writeFileSync(mp3Path, "mp3");
    return mp3Path;
  });
  vi.spyOn(ffmpeg, "getMediaDuration").mockResolvedValue(1);
  vi.spyOn(ffmpeg, "measureAudioLoudness").mockResolvedValue({
    integratedLufs: -16,
    truePeakDbtp: -1.5,
    loudnessRange: 8,
    clippingDetected: false,
    effectivelySilent: false,
  });
  vi.spyOn(ffmpeg, "generateThumbnail").mockImplementation(async (_videoPath, outputPath) => {
    fs.writeFileSync(outputPath, "thumb");
    return outputPath;
  });
  vi.spyOn(ffmpeg, "validateRenderedVideo").mockResolvedValue({
    valid: true,
    durationSeconds: 6,
    durationVariance: 0,
    durationVariancePercent: 0,
    hasVideoStream: true,
    hasAudioStream: true,
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    fileSizeBytes: 1000000,
    bitrateBps: 1000000,
    fps: 25,
    technicalScore: 100,
    issues: [],
  });
  vi.spyOn(ffmpeg, "getAudioStreamInfo").mockResolvedValue({
    codec: "aac",
    sampleRate: 48000,
    channels: 2,
    durationSeconds: 6,
    hasAudioStream: true,
  });

  const pexelsAPI = new PexelsAPI("mock-api-key");
  vi.spyOn(pexelsAPI, "findVideo").mockResolvedValue({
    id: "mock-video-id-1",
    url: "https://example.com/mock-video-1.mp4",
    width: 1080,
    height: 1920,
  });

  const config = new Config();
  const remotion = await Remotion.init(config);

  // control the render promise resolution
  let resolveRenderPromise: () => void;
  const renderPromiseMock: Promise<void> = new Promise((resolve) => {
    resolveRenderPromise = resolve;
  });
  vi.spyOn(remotion, "render").mockReturnValue(renderPromiseMock);

  const whisper = await Whisper.init(config);

  vi.spyOn(whisper, "CreateCaption").mockResolvedValue([
    { text: "This", startMs: 0, endMs: 500 },
    { text: " is", startMs: 500, endMs: 800 },
    { text: " a", startMs: 800, endMs: 1000 },
    { text: " mock", startMs: 1000, endMs: 1500 },
    { text: " transcription.", startMs: 1500, endMs: 2000 },
  ]);

  const musicManager = new MusicManager(config);

  const shortCreator = new ShortCreator(
    config,
    remotion,
    kokoro,
    whisper,
    ffmpeg,
    pexelsAPI,
    musicManager,
  );
  vi.spyOn(shortCreator as any, "downloadFile").mockImplementation(async (_url: string, destPath: string) => {
    fs.writeFileSync(destPath, "mock media");
  });

  const videoId = shortCreator.addToQueue(
    [
      {
        text: "test",
        searchTerms: ["test"],
      },
    ],
    {},
  );

  // list videos while the video is being processed
  let videos = shortCreator.listAllVideos();
  expect(videos.find((v) => v.id === videoId)?.status).toBe("processing");

  // create the video file on the file system and check the status again
  fs.writeFileSync(shortCreator.getVideoPath(videoId), "mock video content");
  videos = shortCreator.listAllVideos();
  expect(videos.find((v) => v.id === videoId)?.status).toBe("processing");

  // resolve the render promise to simulate the video being processed, and check the status again
  resolveRenderPromise();
  await new Promise((resolve) => setTimeout(resolve, 100)); // let the queue process the video
  videos = shortCreator.listAllVideos();
  expect(videos.find((v) => v.id === videoId)?.status).toBe("ready");

  // check the status of the video directly
  const status = shortCreator.status(videoId);
  expect(status).toBe("ready");
});
