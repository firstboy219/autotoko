import { Injectable } from "@nestjs/common";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";

export interface Branding {
  name: string;
  logoUrl: string | null;
  primary: string; // hex, highlight color
  primaryDark: string; // hex
  navy: string; // hex, dark surface
}

const DEFAULTS: Branding = {
  name: "AutoToko",
  logoUrl: null,
  primary: "#A3E00B",
  primaryDark: "#84B800",
  navy: "#0B1B2E",
};

/**
 * Public branding/white-label config (PRD 3.3 / 7 — "branding dinamis dari Admin
 * CMS: nama, logo, warna"). Stored in admin_settings (brand_*). Read by the web &
 * admin apps at load to theme the UI live.
 */
@Injectable()
export class BrandingService {
  constructor(private readonly settings: AdminSettingsService) {}

  async get(): Promise<Branding> {
    const [name, logoUrl, primary, primaryDark, navy] = await Promise.all([
      this.settings.get("brand_name"),
      this.settings.get("brand_logo_url"),
      this.settings.get("brand_primary"),
      this.settings.get("brand_primary_dark"),
      this.settings.get("brand_navy"),
    ]);
    return {
      name: name || DEFAULTS.name,
      logoUrl: logoUrl || null,
      primary: primary || DEFAULTS.primary,
      primaryDark: primaryDark || DEFAULTS.primaryDark,
      navy: navy || DEFAULTS.navy,
    };
  }
}
