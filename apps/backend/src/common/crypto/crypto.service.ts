import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * AES-256-GCM encryption for data at rest: marketplace tokens (PRD Bagian 5.5)
 * and admin credentials (PRD Bagian 7). Output format (base64 parts joined by
 * ":"): v1:<iv>:<authTag>:<ciphertext>.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;
  private readonly logger = new Logger(CryptoService.name);
  private static readonly VERSION = "v1";

  constructor(config: ConfigService) {
    const secret = config.get<string>("ENCRYPTION_KEY");
    const isProd = config.get<string>("NODE_ENV") === "production";
    const weak = !secret || secret.length < 32;
    if (weak) {
      // In production a missing/weak key would silently fall back to a hardcoded
      // dev key, making every encrypted secret trivially decryptable. Fail hard.
      if (isProd) {
        throw new Error(
          "ENCRYPTION_KEY is missing or too weak (need >= 32 chars) — refusing to start in production.",
        );
      }
      this.logger.warn(
        "ENCRYPTION_KEY is missing or weak — using an insecure dev key. Set a strong 32-byte key in production.",
      );
    }
    // Normalize any provided secret to a fixed 32-byte key via SHA-256.
    this.key = createHash("sha256")
      .update(secret ?? "autotoko-dev-insecure-key")
      .digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      CryptoService.VERSION,
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    // dataB64 may legitimately be "" (empty plaintext round-trips to empty
    // ciphertext) — only iv/tag are always present, so don't reject empty data.
    if (version !== CryptoService.VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
      throw new Error("Invalid ciphertext format");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
