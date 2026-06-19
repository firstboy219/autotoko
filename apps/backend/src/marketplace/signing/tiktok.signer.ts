import { createHmac } from "node:crypto";

/**
 * TikTok Shop request signing (HMAC-SHA256). Per the Open API guide:
 *   base = appSecret + path + concat(sortedKey+val, excluding sign & access_token)
 *          (+ json body if present) + appSecret
 *   sign = hex( HMAC-SHA256(base, appSecret) )
 * `timestamp` is a required common query param (Unix seconds).
 */
export function signTikTok(params: {
  appSecret: string;
  path: string;
  query: Record<string, string | number>;
  body?: string;
}): string {
  const { appSecret, path, query, body } = params;

  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();

  let base = appSecret + path;
  for (const k of keys) base += k + String(query[k]);
  if (body) base += body;
  base += appSecret;

  return createHmac("sha256", appSecret).update(base, "utf8").digest("hex");
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
