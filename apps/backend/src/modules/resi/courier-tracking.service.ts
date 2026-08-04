import { Injectable, Logger } from "@nestjs/common";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";
import {
  courierCode,
  decideFromStatus,
  type TrackingDecision,
} from "./courier-tracking.js";

const KEY_PROVIDER = "courier_tracking_provider";
const KEY_API_KEY = "courier_tracking_api_key";
const KEY_BLOCK_TRANSIT = "courier_tracking_block_transit";

/**
 * Hard ceiling on how long a packer waits for an external service.
 *
 * The scan flow is hands-free: barcode, beep, next parcel. A courier lookup on
 * that path buys accuracy with the packer's time, so it gets a short leash and
 * an unambiguous fallback — if the answer is not back in time, the parcel is
 * recorded. A warehouse that stops because someone else's API is slow is a
 * worse outcome than a cancelled parcel occasionally slipping through, and the
 * background pass catches those afterwards anyway.
 */
const TIMEOUT_MS = 2500;

export interface TrackingConfig {
  configured: boolean;
  provider: string;
  blockInTransit: boolean;
}

/**
 * Checks a waybill against the courier before it is accepted.
 *
 * Only BinderByte is implemented, because it is the one aggregator with a
 * documented public endpoint covering JNE, J&T, SiCepat, SPX and Anteraja
 * behind a single key. The courier's own APIs (JNE, J&T) are business
 * integrations that need a signed contract and per-merchant credentials, so
 * they are not something this can just call.
 *
 * The whole thing is inert until an API key is stored: with no key, scanning
 * behaves exactly as before rather than failing.
 */
@Injectable()
export class CourierTrackingService {
  private readonly logger = new Logger(CourierTrackingService.name);

  constructor(private readonly settings: AdminSettingsService) {}

  async getConfig(): Promise<TrackingConfig> {
    const [key, provider, blockTransit] = await Promise.all([
      this.settings.get(KEY_API_KEY),
      this.settings.get(KEY_PROVIDER),
      this.settings.get(KEY_BLOCK_TRANSIT),
    ]);
    return {
      configured: Boolean(key),
      provider: provider || "binderbyte",
      // Default on: the seller asked for in-transit parcels to be refused.
      blockInTransit: blockTransit !== "false",
    };
  }

  async saveConfig(input: {
    apiKey?: string;
    provider?: string;
    blockInTransit?: boolean;
    updatedBy?: string;
  }): Promise<TrackingConfig> {
    if (input.apiKey) {
      await this.settings.set(KEY_API_KEY, input.apiKey, "Courier tracking API key", input.updatedBy);
    }
    if (input.provider) {
      await this.settings.set(KEY_PROVIDER, input.provider, "Courier tracking provider", input.updatedBy);
    }
    if (input.blockInTransit !== undefined) {
      await this.settings.set(
        KEY_BLOCK_TRANSIT,
        String(input.blockInTransit),
        "Refuse parcels already in transit",
        input.updatedBy,
      );
    }
    return this.getConfig();
  }

  async clearConfig(): Promise<void> {
    await this.settings.set(KEY_API_KEY, "", "Courier tracking API key");
  }

  /**
   * Ask the courier about one waybill.
   *
   * Returns null when the check could not run at all — no key, unknown
   * courier, network failure, timeout. Null means "no opinion", and the caller
   * accepts the scan. Every failure mode here is deliberately the permissive
   * one: this is a safety net over the packing bench, not a gate on it.
   */
  async check(resi: string, detectedCourier: string | null): Promise<TrackingDecision | null> {
    const config = await this.getConfig();
    if (!config.configured) return null;

    const code = courierCode(detectedCourier);
    if (!code) {
      this.logger.debug(`No courier code for ${resi} (${detectedCourier ?? "unknown"}); skipped`);
      return null;
    }

    const apiKey = await this.settings.get(KEY_API_KEY);
    if (!apiKey) return null;

    const status = await this.fetchStatus(apiKey, code, resi);
    if (status === undefined) return null; // transport failure; no opinion

    return decideFromStatus(status, { blockInTransit: config.blockInTransit });
  }

  /**
   * @returns the courier's status string, `null` when the provider answered
   * but has no record of the waybill, or `undefined` when the call itself
   * failed and we learned nothing.
   */
  private async fetchStatus(
    apiKey: string,
    courier: string,
    awb: string,
  ): Promise<string | null | undefined> {
    const url =
      `https://api.binderbyte.com/v1/track?api_key=${encodeURIComponent(apiKey)}` +
      `&courier=${encodeURIComponent(courier)}&awb=${encodeURIComponent(awb)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = (await res.json()) as {
        status?: number;
        message?: string;
        data?: { summary?: { status?: string } };
      };

      // A 400 here is the provider saying "no such waybill", which is the
      // normal answer for a parcel still sitting on the bench.
      if (!res.ok || (body.status && body.status >= 400)) return null;
      return body.data?.summary?.status ?? null;
    } catch (e) {
      const aborted = (e as Error).name === "AbortError";
      this.logger.warn(
        `Courier lookup ${aborted ? "timed out" : "failed"} for ${awb} (${courier})` +
          (aborted ? "" : `: ${(e as Error).message}`),
      );
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Used by the admin page to prove a key works before relying on it. */
  async testKey(apiKey: string, courier: string, awb: string) {
    const status = await this.fetchStatus(apiKey, courier, awb);
    if (status === undefined) {
      return { ok: false, message: "Tidak bisa menghubungi penyedia (timeout atau jaringan)." };
    }
    return {
      ok: true,
      status,
      message: status
        ? `Penyedia menjawab: ${status}`
        : "Penyedia menjawab, tapi resi ini tidak ditemukan (wajar untuk resi baru).",
    };
  }
}
