import { describe, it, expect } from "vitest";
import { calculateVolume } from "../components/utils";
import { MusicVolumeEnum, MusicMoodEnum } from "../types/shorts";
import { MusicManager, pickQuietestSafeMusicStart } from "./music";
import { Config } from "../config";

describe("Music Management & Audio Volume Calculation", () => {
  const config = new Config();
  const musicManager = new MusicManager(config);

  it("calculates balanced music attenuation prioritizing narration voice", () => {
    expect(calculateVolume(MusicVolumeEnum.muted)).toEqual([0, true]);
    expect(calculateVolume(MusicVolumeEnum.low)).toEqual([0.15, false]);
    expect(calculateVolume(MusicVolumeEnum.medium)).toEqual([0.25, false]);
    expect(calculateVolume(MusicVolumeEnum.high)).toEqual([0.35, false]);
  });

  it("lists available music tracks with mood tags", () => {
    const list = musicManager.musicList();
    expect(list.length).toBeGreaterThan(10);
    expect(list.some((m) => m.mood === MusicMoodEnum.excited)).toBe(true);
    expect(list.some((m) => m.mood === MusicMoodEnum.chill)).toBe(true);
    expect(list.some((m) => m.mood === MusicMoodEnum.happy)).toBe(true);
  });
});

describe("V2.4 Pass 4: pickQuietestSafeMusicStart avoids near-silent passages of the music bed", () => {
  it("steers away from a catalog start whose window contains a deep energy dip, matching the incident's own beatMap shape", () => {
    // Loosely modeled on the incident's real energyEnvelope (0.1s samples):
    // a loud opening, then a run of near-zero dips around t=8-16s.
    const envelope: number[] = [];
    for (let t = 0; t < 20; t += 0.1) envelope.push(0.8);
    for (let t = 8; t < 16; t += 0.1) envelope[Math.round(t * 10)] = 0.01; // deep dip
    for (let t = 16; t < 60; t += 0.1) envelope.push(0.8);

    // Catalog window is wide enough to search past the dip.
    const best = pickQuietestSafeMusicStart(envelope, 0, 55, 6.7);
    // The 6.7s window starting at `best` should not overlap the [8,16) dip.
    const bestEndsBefore8 = best + 6.7 <= 8;
    const bestStartsAfter16 = best >= 16;
    expect(bestEndsBefore8 || bestStartsAfter16).toBe(true);
  });

  it("falls back to the catalog start when no envelope is available", () => {
    expect(pickQuietestSafeMusicStart(undefined, 3, 90, 20)).toBe(3);
    expect(pickQuietestSafeMusicStart([], 3, 90, 20)).toBe(3);
  });

  it("falls back to the catalog start when the track is too short to search", () => {
    const shortEnvelope = Array.from({ length: 50 }, () => 0.5); // 5s of samples
    expect(pickQuietestSafeMusicStart(shortEnvelope, 0, 90, 20)).toBe(0);
  });
});
