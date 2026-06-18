export * from "./marketplace";

/** Plan tiers (PRD Bagian 4). */
export type PlanType = "freemium" | "starter" | "pro";

/** Standard API envelope returned by the AutoToko backend. */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/** Branding config served to the frontend (PRD Bagian 18). */
export interface BrandingConfig {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  tagline: string;
}
