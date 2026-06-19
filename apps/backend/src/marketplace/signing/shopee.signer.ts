import { createHmac } from "node:crypto";

/**
 * Shopee Open API v2 signing (HMAC-SHA256, hex). Two forms:
 *  - Public / token APIs:  base = partner_id + path + timestamp
 *  - Shop APIs:            base = partner_id + path + timestamp + access_token + shop_id
 * sign = hex( HMAC-SHA256(base, partnerKey) )
 */
export function signShopee(params: {
  partnerId: string | number;
  partnerKey: string;
  path: string;
  timestamp: number;
  accessToken?: string;
  shopId?: string | number;
}): string {
  const { partnerId, partnerKey, path, timestamp, accessToken, shopId } = params;
  let base = `${partnerId}${path}${timestamp}`;
  if (accessToken && shopId !== undefined) base += `${accessToken}${shopId}`;
  return createHmac("sha256", partnerKey).update(base, "utf8").digest("hex");
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
