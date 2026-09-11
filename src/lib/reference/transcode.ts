// Make a source video stream smoothly on a phone.
//
// The #1 cause of swipe-feed stalls is the moov atom sitting at the END of the
// MP4: the browser can't start playback until the whole file downloads. Moving
// it to the front ("faststart") lets playback begin immediately and stream
// progressively.
//
//   faststartRemux  — `-c copy`, ~1s, no re-encode: no quality loss, no size
//                     change, just moov-to-front. The default; cheap enough to
//                     run on every ingest and to backfill thousands.
//   downscale720p   — a full H.264 re-encode to 720p for the rare oversized
//                     outlier where bytes, not moov position, are the problem.
//                     Slow (tens of seconds); use sparingly.

import { execFile } from "child_process";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");
const execFileAsync = promisify(execFile);

async function run(input: Buffer, args: (inPath: string, outPath: string) => string[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "tt-vid-"));
  const inPath = join(dir, "in.mp4");
  const outPath = join(dir, "out.mp4");
  try {
    await writeFile(inPath, input);
    await execFileAsync(ffmpegPath, args(inPath, outPath), { maxBuffer: 1 << 26 });
    return await readFile(outPath);
  } catch {
    return input; // never fail an asset over an ffmpeg hiccup
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Move the moov atom to the front without re-encoding. Fast; the default. */
export function faststartRemux(input: Buffer): Promise<Buffer> {
  return run(input, (i, o) => ["-y", "-i", i, "-c", "copy", "-movflags", "+faststart", o]);
}

/** Full re-encode to 720p H.264/AAC + faststart, with a bitrate cap so output is
 *  predictably small (~a few MB) regardless of the source. Slow; for oversized
 *  outliers only. */
export function downscale720p(input: Buffer): Promise<Buffer> {
  return run(input, (i, o) => [
    "-y", "-i", i,
    "-vf", `scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
    // cap the bitrate so a long/high-motion source can't stay huge
    "-maxrate", "1500k", "-bufsize", "3000k",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    o,
  ]);
}
