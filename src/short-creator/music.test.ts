import { describe, it, expect } from "vitest";
import { calculateVolume } from "../components/utils";
import { MusicVolumeEnum, MusicMoodEnum } from "../types/shorts";
import { MusicManager } from "./music";
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
