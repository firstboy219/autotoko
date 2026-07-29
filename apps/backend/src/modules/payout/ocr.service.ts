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
  /**
   * Every plausible account number found, best-guess first (`account` is
   * simply this list's head). A receipt often contains several digit runs
   * that could each be an account — surfaced so the operator can pick the
   * right one instead of silently getting whichever the heuristic ranked
   * top. Deduped and capped; empty when nothing matched.
   */
  accountCandidates: string[];
  /** Raw OCR text/metadata, kept as an audit trail (Bagian 4, ocr_raw_result). */
  raw: unknown;
}

/** Max candidates surfaced to the UI — beyond a handful it stops being a
 *  choice and becomes noise. */
const MAX_ACCOUNT_CANDIDATES = 5;

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

// Labels Indonesian bank/marketplace transfer receipts use for the
// destination account — "Rekening (Tujuan)", "No. Rekening", "Penerima".
// Real TikTok/Shopee payout screenshots often never say "rekening" at all —
// e.g. Seabank via TikTok renders the destination as
// `Transfer ke  Transfer bank(********8214)`. Matching only the Indonesian
// banking vocabulary missed those entirely and the whole-text fallback then
// grabbed a transaction id instead, so "transfer ke" / "bank" are anchors too.
const ACCOUNT_LABEL_RE =
  /\b(no\.?\s*rekening|rekening|rek\.?|tujuan|penerima|transfer\s+ke|bank|account|destination)\b/i;
const MASKED_RE = /\*{3,}\s?\d{3,8}/;
const BARE_RE = /\b\d[\d\s-]{6,24}\d\b/;

function extractAccountFromSegment(segment: string): string | null {
  const masked = segment.match(MASKED_RE);
  if (masked) return masked[0].replace(/\s/g, "");
  const bare = segment.match(BARE_RE);
  if (bare) {
    const digits = bare[0].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 20) return digits;
  }
  return null;
}

/**
 * Finds plausible bank account numbers. A transfer receipt is full of digit
 * runs that are NOT the account number — order id, reference number, phone,
 * date/time — so pattern-matching alone (even masked-first) kept grabbing
 * the wrong one. The reliable signal is PROXIMITY to a label the receipt
 * uses for the destination account ("Rekening", "No. Rekening", "Tujuan",
 * "Penerima"): scan line-by-line for one of those labels, then look for a
 * digit pattern on that SAME line or the next one (label and value are
 * often on separate lines in these layouts) — masked (e.g. "********8214")
 * still wins over a bare run when both are present on the same line/label.
 *
 * Label-anchored hits are returned first. A whole-text scan (same
 * masked-first, bare-second heuristic as before) is kept as a fallback for
 * receipts that don't carry a recognized label at all, so those still get a
 * best-effort answer instead of nothing.
 */
function findAccountCandidates(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const anchored: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!ACCOUNT_LABEL_RE.test(lines[i]!)) continue;
    const candidate =
      extractAccountFromSegment(lines[i]!) ??
      (lines[i + 1] ? extractAccountFromSegment(lines[i + 1]!) : null);
    if (candidate) anchored.push(candidate);
  }

  const masked: string[] = [];
  let m: RegExpExecArray | null;
  const maskedGlobal = /\*{3,}\s?\d{3,8}/g;
  while ((m = maskedGlobal.exec(text))) masked.push(m[0].replace(/\s/g, ""));

  const bare: string[] = [];
  const bareGlobal = /\b\d[\d\s-]{6,24}\d\b/g;
  while ((m = bareGlobal.exec(text))) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 20) bare.push(digits);
  }

  // The same number legitimately turns up in more than one pass (a labelled
  // masked account is also found by the whole-text masked scan), so dedupe
  // while preserving the confidence ordering.
  return [...new Set([...anchored, ...masked, ...bare])];
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
    const empty: OcrExtractResult = {
      amount: null,
      account: null,
      accountCandidates: [],
      raw: null,
    };
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
      // an exception. execFile's rejection carries the child's stderr, which
      // is where ocr-worker-script.js logs the real cause before exiting.
      const stderr = (err as { stderr?: string }).stderr;
      this.logger.warn(
        `OCR worker failed for ${imageUrl}: ${(err as Error).message}${stderr ? ` | stderr: ${stderr.trim()}` : ""}`,
      );
      return empty;
    } finally {
      await unlink(tempPath).catch(() => {});
    }

    const amounts = findAmountCandidates(text);
    const accounts = findAccountCandidates(text);
    return {
      amount: amounts[0] ?? null,
      account: accounts[0] ?? null,
      accountCandidates: accounts.slice(0, MAX_ACCOUNT_CANDIDATES),
      // The raw trail keeps the UNTRUNCATED lists — it is the audit record,
      // not the picker.
      raw: { text, amountCandidates: amounts, accountCandidates: accounts },
    };
  }
}
