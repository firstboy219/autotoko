import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email (SendGrid in PRD; currently reuses the shared xtracker Gmail
 * SMTP via app password). Used for OTP login + notifications (PRD: notif keluar
 * via email, BUKAN WA). No-ops with a warning when SMTP is not configured.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>("SMTP_HOST");
    const user = config.get<string>("SMTP_USER");
    const pass = config.get<string>("SMTP_PASS");
    this.from = config.get<string>("MAIL_FROM", user ?? "AutoToko <no-reply@autotoko.id>");

    if (host && user && pass) {
      const port = Number(config.get<string>("SMTP_PORT", "587"));
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      this.logger.warn("SMTP not configured — email sending is disabled.");
    }
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Email to ${to} skipped (SMTP disabled): ${subject}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, to, subject, html, text });
  }
}
