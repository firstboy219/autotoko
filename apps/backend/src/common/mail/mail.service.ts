import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";
import { eq, inArray } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { adminSettings } from "../../database/schema/index.js";
import { CryptoService } from "../crypto/crypto.service.js";

export const SMTP_KEYS = {
  host: "smtp_host",
  port: "smtp_port",
  user: "smtp_user",
  pass: "smtp_pass",
  from: "smtp_from",
} as const;

export interface SmtpConfig {
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  from: string | null;
  /** Where the settings came from, so the Admin CMS can say so. */
  source: "db" | "env" | "none";
}

/**
 * Outbound email for OTP login + notifications.
 *
 * Configuration is resolved per-send from admin_settings (AES-encrypted at
 * rest) and falls back to the SMTP_* environment variables. Reading it at send
 * time rather than at construction is what lets the Admin CMS fix a broken
 * mailbox without a redeploy — the previous version snapshotted env in the
 * constructor, so rotating a Gmail app password meant editing .env and
 * restarting the process.
 *
 * Talks to the settings table directly instead of through AdminSettingsService
 * to avoid a module cycle: AuthModule → MailModule, and AdminSettingsModule
 * already depends on AuthModule. DatabaseModule and CryptoModule are both
 * @Global, so no imports are needed either way.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  /** Signature of the config the cached transporter was built from. */
  private signature = "";
  private lastResolved: SmtpConfig | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Reflects the most recent resolve. Only used for a dev-log branch, so a
   * stale value between sends is harmless — send() always resolves fresh.
   */
  get enabled(): boolean {
    return this.lastResolved != null && this.lastResolved.source !== "none";
  }

  /** Current settings for the Admin CMS. The password is never returned. */
  async describe(): Promise<Omit<SmtpConfig, "pass"> & { hasPassword: boolean }> {
    const c = await this.resolveConfig();
    return {
      host: c.host,
      port: c.port,
      user: c.user,
      from: c.from,
      source: c.source,
      hasPassword: Boolean(c.pass),
    };
  }

  async resolveConfig(): Promise<SmtpConfig> {
    let rows: { key: string; value: string | null }[] = [];
    try {
      rows = await this.db
        .select({ key: adminSettings.key, value: adminSettings.value })
        .from(adminSettings)
        .where(inArray(adminSettings.key, Object.values(SMTP_KEYS) as unknown as string[]));
    } catch (e) {
      this.logger.warn(`Could not read SMTP settings from DB: ${(e as Error).message}`);
    }

    const db = new Map<string, string>();
    for (const r of rows) {
      if (!r.value) continue;
      try {
        db.set(r.key, this.crypto.decrypt(r.value));
      } catch {
        // A value encrypted under a different ENCRYPTION_KEY is unusable —
        // ignore it and fall through to env rather than crashing every send.
        this.logger.warn(`Could not decrypt setting ${r.key}; ignoring it.`);
      }
    }

    const envHost = this.config.get<string>("SMTP_HOST") ?? null;
    const host = db.get(SMTP_KEYS.host) ?? envHost;
    const user = db.get(SMTP_KEYS.user) ?? this.config.get<string>("SMTP_USER") ?? null;
    const pass = db.get(SMTP_KEYS.pass) ?? this.config.get<string>("SMTP_PASS") ?? null;
    const port = Number(
      db.get(SMTP_KEYS.port) ?? this.config.get<string>("SMTP_PORT", "587"),
    );
    const from =
      db.get(SMTP_KEYS.from) ??
      this.config.get<string>("MAIL_FROM") ??
      user ??
      "AutoToko <no-reply@autotoko.id>";

    const source: SmtpConfig["source"] = db.size > 0 ? "db" : host && user && pass ? "env" : "none";
    const resolved: SmtpConfig = {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      user,
      pass,
      from,
      source: host && user && pass ? source : "none",
    };
    this.lastResolved = resolved;
    return resolved;
  }

  /** Builds (or reuses) a transporter for the current settings. */
  private async getTransporter(): Promise<{ t: Transporter; from: string } | null> {
    const c = await this.resolveConfig();
    if (!c.host || !c.user || !c.pass) return null;

    const sig = `${c.host}|${c.port}|${c.user}|${c.pass}`;
    if (!this.transporter || sig !== this.signature) {
      this.transporter = nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465,
        auth: { user: c.user, pass: c.pass },
      });
      this.signature = sig;
    }
    return { t: this.transporter, from: c.from ?? c.user };
  }

  async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    const tr = await this.getTransporter();
    if (!tr) {
      this.logger.warn(`Email to ${to} skipped (SMTP not configured): ${subject}`);
      return;
    }
    await tr.t.sendMail({ from: tr.from, to, subject, html, text });
  }

  /**
   * Verifies credentials and optionally sends a probe message. Returns a
   * result object rather than throwing so the Admin CMS can show the exact
   * SMTP rejection (e.g. Gmail's 535-5.7.8 BadCredentials) instead of a 500.
   */
  async testConnection(to?: string): Promise<{ ok: boolean; message: string }> {
    const tr = await this.getTransporter();
    if (!tr) {
      return { ok: false, message: "SMTP belum dikonfigurasi — isi host, user, dan password dulu." };
    }
    try {
      await tr.t.verify();
    } catch (e) {
      return { ok: false, message: `Autentikasi gagal: ${(e as Error).message.split("\n")[0]}` };
    }
    if (!to) return { ok: true, message: "Kredensial valid." };
    try {
      await tr.t.sendMail({
        from: tr.from,
        to,
        subject: "Tes SMTP AutoToko",
        text: "Konfigurasi SMTP AutoToko berhasil. Email ini dikirim dari halaman Admin.",
        html: "<p>Konfigurasi SMTP AutoToko berhasil.</p><p>Email ini dikirim dari halaman Admin.</p>",
      });
      return { ok: true, message: `Email tes terkirim ke ${to}.` };
    } catch (e) {
      return { ok: false, message: `Gagal mengirim: ${(e as Error).message.split("\n")[0]}` };
    }
  }

  /** Persists settings; a blank password keeps whatever is already stored. */
  async saveConfig(
    input: { host: string; port: number; user: string; from?: string; pass?: string },
    updatedBy?: string,
  ): Promise<void> {
    const put = async (key: string, value: string, description: string) => {
      const encrypted = this.crypto.encrypt(value);
      await this.db
        .insert(adminSettings)
        .values({ key, value: encrypted, description, updatedBy })
        .onConflictDoUpdate({
          target: adminSettings.key,
          set: { value: encrypted, description, updatedBy, updatedAt: new Date() },
        });
    };

    await put(SMTP_KEYS.host, input.host, "SMTP server host");
    await put(SMTP_KEYS.port, String(input.port), "SMTP port (587 STARTTLS / 465 SSL)");
    await put(SMTP_KEYS.user, input.user, "SMTP username / email account");
    await put(SMTP_KEYS.from, input.from || input.user, "Alamat pengirim (From)");
    if (input.pass) {
      await put(SMTP_KEYS.pass, input.pass, "SMTP password / Gmail app password");
    }

    // Force a rebuild on the next send so new credentials take effect at once.
    this.transporter = null;
    this.signature = "";
  }

  /** Removes the DB override, reverting to whatever the environment provides. */
  async clearConfig(): Promise<void> {
    await this.db
      .delete(adminSettings)
      .where(inArray(adminSettings.key, Object.values(SMTP_KEYS) as unknown as string[]));
    this.transporter = null;
    this.signature = "";
  }
}
