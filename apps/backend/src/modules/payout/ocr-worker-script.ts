/**
 * Standalone OCR worker, run as a CHILD PROCESS by OcrService — never
 * imported/called in-process. tesseract.js's Node worker has a known failure
 * mode on malformed images: it emits an internal error that bypasses the
 * recognize() promise's rejection and crashes the process outright (confirmed
 * via smoke test — try/catch around recognize() does NOT catch it). Isolating
 * the call in its own process means that crash only ends this short-lived
 * child, never the main backend.
 *
 * Usage: node ocr-worker-script.js <image-file-path>
 * Prints {"text": "..."} to stdout and exits 0 on success.
 * Prints nothing useful and exits 1 on ANY failure (including a hard crash).
 */
import { createWorker } from "tesseract.js";
import { readFileSync } from "node:fs";

// Narrow, deliberate use of a process-wide handler: this process exists for
// exactly one OCR attempt and nothing else, so converting an otherwise-fatal
// internal tesseract.js error into a clean non-zero exit is exactly the
// isolation this script is for.
process.on("uncaughtException", () => process.exit(1));
process.on("unhandledRejection", () => process.exit(1));

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    process.exit(1);
    return;
  }
  const buffer = readFileSync(imagePath);
  const worker = await createWorker("ind+eng");
  try {
    const { data } = await worker.recognize(buffer);
    process.stdout.write(JSON.stringify({ text: data.text ?? "" }));
    process.exit(0);
  } finally {
    await worker.terminate();
  }
}

void main().catch(() => process.exit(1));
