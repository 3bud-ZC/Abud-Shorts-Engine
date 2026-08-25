import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import {
  VoiceEnum,
  type kokoroModelPrecision,
  type Voices,
} from "../../types/shorts";
import { KOKORO_MODEL, logger } from "../../config";

export class Kokoro {
  private loading?: Promise<KokoroTTS>;

  constructor(
    private tts?: KokoroTTS,
    private dtype?: kokoroModelPrecision,
  ) {}

  async generate(
    text: string,
    voice: Voices,
  ): Promise<{
    audio: ArrayBuffer;
    audioLength: number;
  }> {
    const tts = await this.getTts();
    const splitter = new TextSplitterStream();
    const stream = tts.stream(splitter, {
      voice,
    });
    splitter.push(text);
    splitter.close();

    const output = [];
    for await (const audio of stream) {
      output.push(audio);
    }

    const audioBuffers: ArrayBuffer[] = [];
    let audioLength = 0;
    for (const audio of output) {
      audioBuffers.push(audio.audio.toWav());
      audioLength += audio.audio.audio.length / audio.audio.sampling_rate;
    }

    const mergedAudioBuffer = Kokoro.concatWavBuffers(audioBuffers);
    logger.debug({ text, voice, audioLength }, "Audio generated with Kokoro");

    return {
      audio: mergedAudioBuffer,
      audioLength: audioLength,
    };
  }

  static concatWavBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
    const header = Buffer.from(buffers[0].slice(0, 44));
    let totalDataLength = 0;

    const dataParts = buffers.map((buf) => {
      const b = Buffer.from(buf);
      const data = b.slice(44);
      totalDataLength += data.length;
      return data;
    });

    header.writeUInt32LE(36 + totalDataLength, 4);
    header.writeUInt32LE(totalDataLength, 40);

    return Buffer.concat([header, ...dataParts]);
  }

  static async init(dtype: kokoroModelPrecision): Promise<Kokoro> {
    const tts = await KokoroTTS.from_pretrained(KOKORO_MODEL, {
      dtype,
      device: "cpu", // only "cpu" is supported in node
    });

    return new Kokoro(tts);
  }

  /**
   * Production Docker containers must bind their HTTP health endpoint before a
   * heavyweight local TTS model finishes loading. English local voice renders
   * still use Kokoro, but the model is loaded on first use instead of blocking
   * the whole app and render worker from becoming healthy.
   */
  static lazy(dtype: kokoroModelPrecision): Kokoro {
    return new Kokoro(undefined, dtype);
  }

  private async getTts(): Promise<KokoroTTS> {
    if (this.tts) return this.tts;
    if (!this.loading) {
      this.loading = KokoroTTS.from_pretrained(KOKORO_MODEL, {
        dtype: this.dtype || "fp32",
        device: "cpu",
      });
    }
    this.tts = await this.loading;
    return this.tts;
  }

  listAvailableVoices(): Voices[] {
    const voices = Object.values(VoiceEnum) as Voices[];
    return voices;
  }
}
