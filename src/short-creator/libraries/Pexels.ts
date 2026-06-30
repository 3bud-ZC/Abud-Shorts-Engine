/* eslint-disable @remotion/deterministic-randomness */
import { getOrientationConfig } from "../../components/utils";
import { logger } from "../../logger";
import { OrientationEnum, type Video } from "../../types/shorts";

const jokerTerms: string[] = ["nature", "globe", "space", "ocean"];
const durationBufferSeconds = 3;
const defaultTimeoutMs = 5000;
const perTermTimeoutRetries = 1;
const maxSearchAttempts = 8;

type FindVideoOptions = {
  excludeIds?: string[];
  orientation?: OrientationEnum;
  timeout?: number;
  retryCounter?: number;
  fallbackSearchTerms?: string[];
};

function sanitizeTerms(terms: string[] = []): string[] {
  return Array.from(
    new Set(
      (terms || [])
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  );
}

export class PexelsAPI {
  constructor(private API_KEY: string) { }

  private async _findVideo(
    searchTerm: string,
    minDurationSeconds: number,
    excludeIds: string[],
    orientation: OrientationEnum,
    timeout: number,
  ): Promise<Video> {
    if (!this.API_KEY) {
      throw new Error("API key not set");
    }
    logger.debug(
      { searchTerm, minDurationSeconds, orientation },
      "Searching for video in Pexels API",
    );
    const headers = new Headers();
    headers.append("Authorization", this.API_KEY);
    const response = await fetch(
      `https://api.pexels.com/videos/search?orientation=${orientation}&size=medium&per_page=80&query=${encodeURIComponent(searchTerm)}`,
      {
        method: "GET",
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      },
    )
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error(
              "Invalid Pexels API key - please make sure you get a valid key from https://www.pexels.com/api and set it in the environment variable PEXELS_API_KEY",
            );
          }
          throw new Error(`Pexels API error: ${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .catch((error: unknown) => {
        logger.error(error, "Error fetching videos from Pexels API");
        throw error;
      });
    const videos = response.videos as {
      id: string;
      duration: number;
      video_files: {
        fps: number;
        quality: string;
        width: number;
        height: number;
        id: string;
        link: string;
      }[];
    }[];

    const { width: requiredVideoWidth, height: requiredVideoHeight } =
      getOrientationConfig(orientation);

    const resultCount = videos?.length ?? 0;
    logger.debug({ searchTerm, resultCount }, "Pexels API responded");

    if (!videos || resultCount === 0) {
      logger.error(
        { searchTerm, orientation },
        "No videos found in Pexels API",
      );
      throw new Error("No videos found");
    }

    // find all the videos that fits the criteria, then select one randomly
    const filteredVideos = videos
      .map((video) => {
        if (excludeIds.includes(video.id)) {
          return;
        }
        if (!video.video_files.length) {
          return;
        }

        // calculate the real duration of the video by converting the FPS to 25
        const fps = video.video_files[0].fps;
        const duration =
          fps < 25 ? video.duration * (fps / 25) : video.duration;

        if (duration >= minDurationSeconds + durationBufferSeconds) {
          for (const file of video.video_files) {
            if (
              file.quality === "hd" &&
              file.width === requiredVideoWidth &&
              file.height === requiredVideoHeight
            ) {
              return {
                id: video.id,
                url: file.link,
                width: file.width,
                height: file.height,
              };
            }
          }
        }
      })
      .filter(Boolean);
    if (!filteredVideos.length) {
      logger.error({ searchTerm }, "No acceptable videos found in Pexels API");
      throw new Error("No acceptable videos found");
    }

    const video = filteredVideos[
      Math.floor(Math.random() * filteredVideos.length)
    ] as Video;

    logger.debug(
      { searchTerm, video: video, minDurationSeconds, orientation },
      "Found video from Pexels API",
    );

    return video;
  }

  async findVideo(
    searchTerms: string[],
    minDurationSeconds: number,
    optionsOrExcludeIds?: FindVideoOptions | string[],
    legacyOrientation: OrientationEnum = OrientationEnum.portrait,
    legacyTimeout: number = defaultTimeoutMs,
    legacyRetryCounter = 0,
  ): Promise<Video> {
    const normalizedOptions: FindVideoOptions = Array.isArray(optionsOrExcludeIds)
      ? {
        excludeIds: optionsOrExcludeIds,
        orientation: legacyOrientation,
        timeout: legacyTimeout,
        retryCounter: legacyRetryCounter,
      }
      : optionsOrExcludeIds || {};

    const {
      excludeIds = [],
      orientation = OrientationEnum.portrait,
      timeout = defaultTimeoutMs,
      retryCounter = 0,
      fallbackSearchTerms = [],
    } = normalizedOptions;

    const primaryTerms = sanitizeTerms(searchTerms);
    const templateFallbackTerms = sanitizeTerms(fallbackSearchTerms);
    const globalFallbackTerms = sanitizeTerms(jokerTerms);

    const attempts: string[] = [];
    const addTerms = (terms: string[]) => {
      for (const term of terms) {
        if (attempts.includes(term)) {
          continue;
        }
        attempts.push(term);
        if (attempts.length >= maxSearchAttempts) {
          return;
        }
      }
    };

    addTerms(primaryTerms);
    addTerms(templateFallbackTerms);
    if (templateFallbackTerms.length === 0) {
      addTerms(globalFallbackTerms);
    }

    const summary = {
      attemptedTerms: [] as string[],
      timeoutCount: 0,
      noResultCount: 0,
      rejectedCount: 0,
    };

    const isTimeoutError = (error: unknown) =>
      error instanceof Error &&
      error.name === "TimeoutError";

    const isNoResultError = (error: unknown) =>
      error instanceof Error && error.message === "No videos found";

    const isRejectedError = (error: unknown) =>
      error instanceof Error &&
      error.message === "No acceptable videos found";

    for (const searchTerm of attempts) {
      summary.attemptedTerms.push(searchTerm);

      for (let attempt = 0; attempt <= perTermTimeoutRetries; attempt++) {
        try {
          const video = await this._findVideo(
            searchTerm,
            minDurationSeconds,
            excludeIds,
            orientation,
            timeout,
          );
          logger.debug(
            { searchTerm },
            "Pexels search term succeeded",
          );
          return video;
        } catch (error: unknown) {
          if (isTimeoutError(error)) {
            summary.timeoutCount += 1;
            const retryRemaining = attempt < perTermTimeoutRetries;
            logger.warn(
              { searchTerm, attempt, perTermTimeoutRetries },
              retryRemaining
                ? "Timeout error on term; retrying"
                : "Timeout error on term; moving to next term",
            );
            if (retryRemaining) {
              continue;
            }
            break;
          }

          if (isNoResultError(error)) {
            summary.noResultCount += 1;
          } else if (isRejectedError(error)) {
            summary.rejectedCount += 1;
          }

          logger.warn(
            { searchTerm },
            "Error finding acceptable video for term; continuing",
          );
          break;
        }
      }
    }

    logger.error({ summary }, "Pexels search exhausted all terms");
    const failureMessage =
      `Pexels search exhausted ${summary.attemptedTerms.length} terms (timeouts=${summary.timeoutCount}, ` +
      `noResults=${summary.noResultCount}, rejected=${summary.rejectedCount}); attempted: ${summary.attemptedTerms.join(", ")}`;
    throw new Error(failureMessage);
  }
}
