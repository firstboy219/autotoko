import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { AdminSettingsService } from "../admin-settings/admin-settings.service.js";
import { callProvider } from "./ai-providers.js";
import {
  AI_FEATURES,
  AI_PROVIDERS,
  PROVIDER_API_KEY,
  PROVIDER_DEFAULT_MODEL,
  type AiFeature,
  type AiProvider,
  type CompleteParams,
  type ResolvedFeatureConfig,
} from "./ai.types.js";

/**
 * Resolves the per-feature provider/model (configured from the Admin CMS) and
 * dispatches a completion to the right vendor. Config keys in admin_settings:
 *   ai_feature_<feature>_provider   (anthropic|openai|gemini)
 *   ai_feature_<feature>_model      (free text, vendor model id)
 * Falls back to the global ai_provider/ai_model, then to a per-provider default.
 */
@Injectable()
export class AiProviderService {
  private readonly logger = new Logger(AiProviderService.name);

  constructor(private readonly settings: AdminSettingsService) {}

  private isProvider(v: string | null): v is AiProvider {
    return !!v && (AI_PROVIDERS as string[]).includes(v);
  }

  async resolveConfig(feature: AiFeature): Promise<ResolvedFeatureConfig> {
    const perFeature = await this.settings.get(`ai_feature_${feature}_provider`);
    const global = await this.settings.get("ai_provider");
    const provider: AiProvider = this.isProvider(perFeature)
      ? perFeature
      : this.isProvider(global)
        ? global
        : "anthropic";

    const model =
      (await this.settings.get(`ai_feature_${feature}_model`)) ||
      (provider === (global as AiProvider)
        ? await this.settings.get("ai_model")
        : null) ||
      PROVIDER_DEFAULT_MODEL[provider];

    return { feature, provider, model };
  }

  /** Run a completion for a feature, using its configured provider/model/key. */
  async complete(feature: AiFeature, params: CompleteParams): Promise<string> {
    const { provider, model } = await this.resolveConfig(feature);
    const apiKey = await this.settings.get(PROVIDER_API_KEY[provider]);
    if (!apiKey) {
      throw new BadGatewayException(
        `API key untuk provider "${provider}" belum diset di Admin CMS (${PROVIDER_API_KEY[provider]}).`,
      );
    }
    try {
      return await callProvider(provider, apiKey, model, params);
    } catch (e) {
      this.logger.error(
        `AI ${feature} via ${provider}/${model} failed: ${(e as Error).message}`,
      );
      throw new BadGatewayException(
        `AI gagal (${provider}/${model}): ${(e as Error).message}`,
      );
    }
  }

  /** CMS view: every feature's current config + whether its provider key is set. */
  async featureStatus() {
    const keyPresent: Partial<Record<AiProvider, boolean>> = {};
    for (const p of AI_PROVIDERS) {
      keyPresent[p] = Boolean(await this.settings.get(PROVIDER_API_KEY[p]));
    }
    const features = [];
    for (const def of AI_FEATURES) {
      const cfg = await this.resolveConfig(def.key);
      features.push({
        ...def,
        provider: cfg.provider,
        model: cfg.model,
        keyConfigured: keyPresent[cfg.provider] ?? false,
      });
    }
    return {
      providers: AI_PROVIDERS,
      providerKeyStatus: keyPresent,
      providerKeySetting: PROVIDER_API_KEY,
      defaultModels: PROVIDER_DEFAULT_MODEL,
      features,
    };
  }
}
