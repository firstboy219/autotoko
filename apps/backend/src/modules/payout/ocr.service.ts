import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { UploadsService } from "../uploads/uploads.service.js";

const execFileAsync = promisify(execFile);

export interface OcrExtractResult {
  /** Extracted nominal amount, if confidently found. */
  amount: number | null;
  /** Extracted bank account number, if confidently found. */
  account: string | null;
  /** Raw OCR text/metadata, kept as an audit trail (Bagian 4, ocr_raw_result). */
  raw: unknown;
}

/**
 * Finds Indonesian-formatted currency amounts in OCR text, e.g. "Rp1.234.567"
 * or "50.000,00". Thousands separator is a dot; decimals (rare for whole
 * rupiah figures) use a comma. Returns candidates sorted by confidence
 * (Rp-prefixed first, then by value descending) — the caller takes the best.
 */
function findAmountCandidates(text: string): number[] {
  const re = /(Rp\.?\s*)?(\d{1,3}(?:\.\d{3})+)(?:,(\d{2}))?/g;
  const withRp: number[] = [];
  const bare: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const whole = m[2]!.replace(/\./g, "");
    const cents = m[3] ? Number(m[3]) / 100 : 0;
    const value = Number(whole) + cents;
    if (!Number.isFinite(value) || value <= 0) continue;
    (m[1] ? withRp : bare).push(value);
  }
  withRp.sort((a, b) => b - a);
  bare.sort((a, b) => b - a);
  return [...withRp, ...bare];
}

/**
 * Finds plausible bank account numbers: runs of 8-20 digits, allowing spaces
 * or dashes within the run (common in screenshots), stripped to digits only.
 */
function findAccountCandidates(text: string): string[] {
  const re = /\b\d[\d\s-]{6,24}\d\b/g;
  const candidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 20) candidates.push(digits);
  }
  return candidates;
}

// ocr-worker-script.js sits next to this compiled file in dist/modules/payout/
// (backend compiles to CommonJS, so __dirname is available and reliable here).
const WORKER_SCRIPT = join(__dirname, "ocr-worker-script.js");

/**
 * OCR extraction for payout proof screenshots (FLOW_PENCAIRAN_V2_FINAL.md
 * Bagian 6). Two call sites: Titik 1 (pencairan proof — auto-fill the input
 * form) and Titik 2 (transfer proof — cross-validate against an expected
 * amount/account). OCR is NEVER the sole source of truth — a failed or absent
 * read simply falls through to manual entry / manual override, it never blocks.
 *
 * The actual tesseract.js call runs in a SEPARATE CHILD PROCESS
 * (ocr-worker-script.js), not in-process. Smoke-testing this integration found
 * that tesseract.js's Node worker can crash the whole process on a malformed
 * image — the internal error bypasses the recognize() promise's rejection
 * entirely (try/catch around it does not catch it). Isolating it as a child
 * process means that failure mode only ends the short-lived child; this
 * service always returns a safe "no result" instead of ever propagating a crash.
 *
 * Accuracy against real bank/marketplace screenshots (Seabank, TikTok Shop,
 * Shopee, ...) has NOT been tuned against real samples yet — that requires
 * representative screenshots from Putra per the requirement doc's own note.
 * The parsing heuristics above are isolated pure functions specifically so
 * that tuning later doesn't require touching the OCR engine call.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly uploads: UploadsService) {}

  async extractProofFields(imageUrl: string): Promise<OcrExtractResult> {
    const empty: OcrExtractResult = { amount: null, account: null, raw: null };
    const buffer = await this.uploads.readByUrl(imageUrl);
    if (!buffer) {
      this.logger.warn(`OCR: could not read local file for ${imageUrl}`);
      return empty;
    }

    const tempPath = join(tmpdir(), `ocr-${randomUUID()}`);
    let text = "";
    try {
      await writeFile(tempPath, buffer);
      const { stdout } = await execFileAsync("node", [WORKER_SCRIPT, tempPath], {
        timeout: 25_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      text = (JSON.parse(stdout) as { text: string }).text;
    } catch (err) {
      // Covers: worker crash (any exit code), timeout, malformed JSON. Always
      // degrade to "no result" — never let an OCR failure reach the caller as
      // an exception.
      this.logger.warn(`OCR worker failed for ${imageUrl}: ${(err as Error).message}`);
      return empty;
    } finally {
      await unlink(tempPath).catch(() => {});
    }

    const amounts = findAmountCandidates(text);
    const accounts = findAccountCandidates(text);
    return {
      amount: amounts[0] ?? null,
      account: accounts[0] ?? null,
      raw: { text, amountCandidates: amounts, accountCandidates: accounts },
    };
  }
}
