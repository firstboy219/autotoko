import { BadRequestException, Injectable } from "@nestjs/common";
import type { Marketplace, MarketplaceAuthPort, ProductData } from "@autotoko/shared";
import { TikTokAdapter } from "./adapters/tiktok.adapter.js";
import { ShopeeAdapter } from "./adapters/shopee.adapter.js";

// PRD Bagian 19.5 — adapter factory; the rest of the app depends only on the port.
@Injectable()
export class MarketplaceService {
  constructor(
    private readonly tiktok: TikTokAdapter,
    private readonly shopee: ShopeeAdapter,
  ) {}

  getAuthAdapter(marketplace: Marketplace): MarketplaceAuthPort {
    switch (marketplace) {
      case "tiktok":
        return this.tiktok;
      case "shopee":
        return this.shopee;
      default:
        throw new BadRequestException(`Unsupported marketplace: ${marketplace}`);
    }
  }

  /** Read-only catalog pull for the audit sync. Only TikTok is wired for now. */
  async listProducts(
    marketplace: Marketplace,
    accessToken: string,
    shopCipher: string,
  ): Promise<ProductData[]> {
    switch (marketplace) {
      case "tiktok":
        return this.tiktok.listProducts(accessToken, shopCipher);
      default:
        throw new BadRequestException(
          `Product sync not implemented for marketplace: ${marketplace}`,
        );
    }
  }
}
