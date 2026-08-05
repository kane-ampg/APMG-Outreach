// Server-only PDF shrinker for the sector attachment PDFs (Sector Playbooks tab).
//
// Why this exists: the outreach email is sent by an n8n Gmail node, and Gmail
// rejects a message once its BASE64-encoded MIME payload passes ~25 MB. Base64
// inflates raw bytes by ~1.33×, so the RAW PDF we store must stay under ~18 MB
// to attach reliably. The raw APMG portfolios are ~36–40 MB image scans; pure-JS
// PDF libraries (pdf-lib et al.) re-save the structure but do NOT downsample the
// embedded images, so they barely dent the size. Ghostscript's pdfwrite device
// downsamples images and is the reliable way to hit the target — so we shell out.
//
// REQUIRES the Ghostscript binary on the host (`gs` on Linux/macOS,
// `gswin64c`/`gswin32c` on Windows). Set GHOSTSCRIPT_BIN to override the path.
// When it's missing we degrade gracefully: the original bytes are stored and the
// caller is told compression was unavailable (so the UI can warn that the file
// may be too big for Gmail). Not available on Vercel serverless — deploy where
// `gs` is installed (Docker/VPS) for auto-compression to kick in.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Raw-byte ceiling that keeps a PDF under Gmail's ~25 MB encoded cap.
 *  18 MB × 1.33 ≈ 24 MB encoded, leaving headroom for the HTML body + MIME
 *  overhead. Kept in sync with the UI copy on the Sector Playbooks tab. */
export const GMAIL_SAFE_RAW_BYTES = 18 * 1000 * 1000;

/** Ghostscript quality presets, harshest last. /ebook ≈ 150 dpi (good on-screen
 *  quality), /screen ≈ 72 dpi (smallest). We escalate only if /ebook overshoots. */
const QUALITY_TIERS = ["/ebook", "/screen"] as const;

export type CompressStatus =
  | "compressed" // Ghostscript ran and produced a smaller file we stored
  | "unchanged" // already under the Gmail threshold, or compression gained nothing
  | "unavailable" // Ghostscript binary not found on the host
  | "failed"; // Ghostscript ran but errored / produced nothing usable

export interface PdfCompressOutcome {
  /** the bytes the caller should store (compressed when it helped, else original) */
  bytes: Uint8Array;
  /** byte length of `bytes` (the size that will actually be emailed) */
  size: number;
  /** original upload size, for "41.2 MB → 12.4 MB" messaging */
  originalSize: number;
  /** true when `size` is under the Gmail-safe raw threshold */
  underGmailLimit: boolean;
  status: CompressStatus;
  /** the Ghostscript preset used, when status === "compressed" (e.g. "/ebook") */
  quality?: string;
}

// Resolve the Ghostscript binary once per process. undefined = not yet probed,
// null = probed and none found. Cached so we don't spawn `--version` per upload.
let cachedBinary: string | null | undefined;

async function resolveGsBinary(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  const override = process.env.GHOSTSCRIPT_BIN?.trim();
  const candidates = override ? [override] : ["gs", "gswin64c", "gswin32c"];
  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (v: boolean) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      try {
        const p = spawn(bin, ["--version"], { stdio: "ignore" });
        p.on("error", () => done(false)); // ENOENT → binary not on PATH
        p.on("close", (code) => done(code === 0));
      } catch {
        done(false);
      }
    });
    if (ok) {
      cachedBinary = bin;
      return bin;
    }
  }
  cachedBinary = null;
  return null;
}

function runGhostscript(bin: string, inPath: string, outPath: string, quality: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const p = spawn(
        bin,
        [
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.4",
          `-dPDFSETTINGS=${quality}`,
          "-dDetectDuplicateImages=true",
          "-dNOPAUSE",
          "-dQUIET",
          "-dBATCH",
          `-sOutputFile=${outPath}`,
          inPath,
        ],
        { stdio: "ignore" },
      );
      p.on("error", () => done(false));
      p.on("close", (code) => done(code === 0));
    } catch {
      done(false);
    }
  });
}

/**
 * Compress a PDF to fit under Gmail's attachment cap, using Ghostscript.
 *
 * - Already under the threshold → returned untouched (status "unchanged").
 * - Ghostscript missing → original returned (status "unavailable").
 * - Otherwise tries /ebook, then /screen if still too big, and keeps the
 *   smallest result that beats the original. `underGmailLimit` reports whether
 *   even the best result cleared the threshold (it can be false for a giant
 *   scan that's still >18 MB at 72 dpi — the caller then warns the user).
 */
export async function compressPdfForGmail(input: ArrayBuffer): Promise<PdfCompressOutcome> {
  const original = new Uint8Array(input);
  const originalSize = original.byteLength;

  if (originalSize <= GMAIL_SAFE_RAW_BYTES) {
    return { bytes: original, size: originalSize, originalSize, underGmailLimit: true, status: "unchanged" };
  }

  const bin = await resolveGsBinary();
  if (!bin) {
    console.warn("[sector-playbooks] Ghostscript not found — storing PDF uncompressed. Set GHOSTSCRIPT_BIN or install `gs`.");
    return { bytes: original, size: originalSize, originalSize, underGmailLimit: false, status: "unavailable" };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "apmg-pdf-"));
    const inPath = join(dir, "in.pdf");
    await writeFile(inPath, original);

    let best: { bytes: Uint8Array; quality: string } | null = null;
    for (const quality of QUALITY_TIERS) {
      const outPath = join(dir, `out-${quality.replace(/\W/g, "")}.pdf`);
      const ok = await runGhostscript(bin, inPath, outPath, quality);
      if (!ok) continue;
      let out: Buffer;
      try {
        out = await readFile(outPath);
      } catch {
        continue;
      }
      if (out.byteLength === 0) continue;
      if (!best || out.byteLength < best.bytes.byteLength) best = { bytes: out, quality };
      if (out.byteLength <= GMAIL_SAFE_RAW_BYTES) break; // good enough — don't degrade further
    }

    if (!best) {
      return { bytes: original, size: originalSize, originalSize, underGmailLimit: false, status: "failed" };
    }
    // Never store something bigger than what came in (already-optimised PDFs).
    if (best.bytes.byteLength >= originalSize) {
      return { bytes: original, size: originalSize, originalSize, underGmailLimit: false, status: "unchanged" };
    }
    return {
      bytes: best.bytes,
      size: best.bytes.byteLength,
      originalSize,
      underGmailLimit: best.bytes.byteLength <= GMAIL_SAFE_RAW_BYTES,
      status: "compressed",
      quality: best.quality,
    };
  } catch (e) {
    console.error("[sector-playbooks] PDF compression failed:", e);
    return { bytes: original, size: originalSize, originalSize, underGmailLimit: false, status: "failed" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
