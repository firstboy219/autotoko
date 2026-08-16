import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB decoded
const NAME_RE = /^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/;

/**
 * Image storage on our own server (replaces the earlier R2 plan). Files are
 * written to UPLOAD_DIR (persisted outside the deploy dir) and served back
 * through a Nest route, so no external object store or extra npm deps.
 */
@Injectable()
export class UploadsService {
  private readonly dir: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.dir = config.get<string>("UPLOAD_DIR") ?? join(process.cwd(), "uploads");
  }

  private async ensureDir() {
    if (!existsSync(this.dir)) await fs.mkdir(this.dir, { recursive: true });
  }

  /** Persist a base64-encoded image, returning the public URL path. */
  async saveImage(base64: string, extRaw: string): Promise<{ url: string; name: string }> {
    const ext = extRaw.toLowerCase().replace(/^\./, "");
    if (!EXT_MIME[ext]) {
      throw new BadRequestException("Only jpg, png, or webp images are allowed");
    }
    // Accept a data: URL or a bare base64 string.
    const cleaned = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
    let buf: Buffer;
    try {
      buf = Buffer.from(cleaned, "base64");
    } catch {
      throw new BadRequestException("Invalid base64 image data");
    }
    if (!buf.length) throw new BadRequestException("Empty image");
    if (buf.length > MAX_BYTES) throw new BadRequestException("Image exceeds 8 MB");

    await this.ensureDir();
    const name = `${randomUUID()}.${ext === "jpeg" ? "jpg" : ext}`;
    await fs.writeFile(join(this.dir, name), buf);
    // Served via GET /api/uploads/:name (global prefix "api"), reachable through
    // the existing /api/ nginx proxy on the web domain.
    return { url: `/api/uploads/${name}`, name };
  }

  /**
   * Fingerprint of a stored image's contents, by its public url.
   *
   * Null when the url is not one of ours or the file has gone — a missing
   * file must not block a payout being recorded, it just cannot be checked
   * for having been used before.
   */
  async hashOfUrl(url: string): Promise<string | null> {
    const name = url.split("/").pop() ?? "";
    if (!NAME_RE.test(name)) return null;
    try {
      const buf = await fs.readFile(join(this.dir, name));
      return createHash("sha256").update(buf).digest("hex");
    } catch {
      return null;
    }
  }

  /** Read an image for serving. Guards against path traversal. */
  async readImage(name: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!NAME_RE.test(name)) throw new NotFoundException("Not found");
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const path = join(this.dir, name);
    if (!existsSync(path)) throw new NotFoundException("Not found");
    return { buffer: await fs.readFile(path), contentType: EXT_MIME[ext] ?? "application/octet-stream" };
  }

  /**
   * Read an image by its stored URL path (e.g. "/api/uploads/<uuid>.jpg"),
   * for server-side consumers like OCR that never go over HTTP for a file we
   * already have on local disk. Returns null for anything not one of ours
   * (e.g. an external URL) rather than throwing — callers treat that as
   * "nothing to read".
   */
  async readByUrl(url: string): Promise<Buffer | null> {
    const marker = "/api/uploads/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const name = url.slice(idx + marker.length);
    if (!NAME_RE.test(name)) return null;
    const path = join(this.dir, name);
    if (!existsSync(path)) return null;
    return fs.readFile(path);
  }
}
