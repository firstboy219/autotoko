/**
 * Marketplace abstraction — the architectural backbone of AutoToko.
 *
 * Every marketplace (TikTok Shop, Shopee, later Tokopedia/Lazada) implements
 * this single interface so the rest of the system stays marketplace-agnostic.
 * See PRD Bagian 19.5 (Marketplace Adapter Pattern).
 */

export type Marketplace = "tiktok" | "shopee" | "tokopedia" | "lazada";

export interface TokenData {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the access token expires. */
  accessTokenExpireAt: number;
  /** Unix seconds when the refresh token expires. */
  refreshTokenExpireAt: number;
  shopId: string;
  /** TikTok-only: required for several API calls. */
  shopCipher?: string;
}

export type OrderStatus =
  | "unpaid"
  | "awaiting_shipment"
  | "awaiting_collection"
  | "in_transit"
  | "delivered"
  | "completed"
  | "cancelled"
  | "returned";

export interface OrderFilters {
  status?: OrderStatus;
  /** Unix seconds. */
  createdFrom?: number;
  /** Unix seconds. */
  createdTo?: number;
  cursor?: string;
  pageSize?: number;
}

export interface OrderItem {
  sku: string;
  marketplaceItemId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  marketplaceOrderId: string;
  status: OrderStatus;
  buyerName?: string;
  items: OrderItem[];
  totalAmount: number;
  shippingCourier?: string;
  trackingNumber?: string;
  createdAt: number;
}

export interface ProductData {
  sku: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  images: string[];
  categoryId?: string;
  weightGram?: number;
}

export interface StockUpdate {
  marketplaceItemId: string;
  modelId?: string;
  stock: number;
}

export interface ShipData {
  method: "pickup" | "dropoff" | "non_integrated";
  trackingNumber?: string;
  channelId?: string;
}

export interface TrackingData {
  trackingNumber: string;
  courier: string;
}

export interface Settlement {
  marketplaceOrderId: string;
  escrowAmount: number;
  buyerTotalAmount: number;
  marketplaceFee: number;
}

export interface DateRange {
  /** Unix seconds. */
  from: number;
  /** Unix seconds. */
  to: number;
}

/**
 * One uniform contract for all marketplaces. Concrete adapters
 * (TikTokShopAdapter, ShopeeAdapter, ...) implement this; the rest of the
 * codebase depends only on this interface.
 */
export interface MarketplaceAdapter {
  readonly marketplace: Marketplace;

  // Auth
  getAuthUrl(userId: string): string;
  exchangeToken(code: string, shopId?: string): Promise<TokenData>;
  refreshToken(refreshToken: string, shopId?: string): Promise<TokenData>;

  // Orders
  getOrders(shopId: string, filters: OrderFilters): Promise<Order[]>;
  approveOrder(shopId: string, orderId: string): Promise<void>;
  cancelOrder(shopId: string, orderId: string, reason: string): Promise<void>;

  // Products
  getProducts(shopId: string): Promise<ProductData[]>;
  createProduct(shopId: string, product: ProductData): Promise<string>;
  updateProduct(shopId: string, productId: string, data: Partial<ProductData>): Promise<void>;
  updateStock(shopId: string, updates: StockUpdate[]): Promise<void>;

  // Fulfillment
  shipOrder(shopId: string, packageId: string, data: ShipData): Promise<TrackingData>;
  getTrackingNumber(shopId: string, orderId: string): Promise<string>;

  // Chat (AI-driven upstream)
  sendMessage(shopId: string, conversationId: string, message: string): Promise<void>;

  // Finance
  getSettlements(shopId: string, range: DateRange): Promise<Settlement[]>;
}
