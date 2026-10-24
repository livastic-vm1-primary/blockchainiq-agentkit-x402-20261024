import {
  BASE_NETWORK, BRIEF_URL, CIRCLE_BASE_USDC, MAX_TIMEOUT_SECONDS,
  PINNED_BIQ_MERCHANT, PRICE_ATOMS, QUOTE_MAX_CHARS,
} from "./constants.js";

export interface Offer {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}
export interface Quote {
  x402Version: number;
  resource: { url: string; mimeType?: string };
  accepts: Offer[];
}

export function assertAllowedOffer(raw: unknown): asserts raw is Offer {
  if (raw === null || typeof raw !== "object") throw new Error("Missing x402 payment offer");
  const x = raw as Record<string, unknown>;
  if (x.scheme !== "exact" || x.network !== BASE_NETWORK) {
    throw new Error("Wrong scheme/network. Only exact x402 v2 on Base mainnet allowed.");
  }
  if (typeof x.asset !== "string" || x.asset.toLowerCase() !== CIRCLE_BASE_USDC.toLowerCase()) {
    throw new Error("Noncanonical token: only native Circle Base USDC allowed.");
  }
  if (x.amount !== PRICE_ATOMS) {
    throw new Error("Payment must be exactly 10000 USDC atomic units (0.01 USDC).");
  }
  if (typeof x.payTo !== "string" || x.payTo.toLowerCase() !== PINNED_BIQ_MERCHANT.toLowerCase()) {
    throw new Error("Unrecognized merchant receive address; abort before signing.");
  }
  if (typeof x.maxTimeoutSeconds !== "number" || x.maxTimeoutSeconds <= 0 ||
      x.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error("Timeout exceeds pinned known payment quote.");
  }
  // Reject Permit2/approval or other authorization method extensions outright.
  const extra = x.extra;
  if (extra !== undefined) {
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("Invalid offer extras");
    const method = (extra as Record<string, unknown>).assetTransferMethod;
    if (method !== undefined && method !== "eip3009") {
      throw new Error("Non-EIP3009 asset transfer method forbidden: no token approvals.");
    }
  }
}

export function assertAllowedQuote(raw: unknown): asserts raw is Quote {
  if (!raw || typeof raw !== "object") throw new Error("Invalid quoted body");
  const q = raw as Record<string, unknown>;
  if (q.x402Version !== 2) throw new Error("Only x402 protocol v2 allowed");
  const resource = q.resource as Record<string, unknown> | undefined;
  if (!resource || resource.url !== BRIEF_URL || (resource.mimeType !== undefined &&
    resource.mimeType !== "application/json")) {
    throw new Error("Unexpected resource URL or media type");
  }
  if (!Array.isArray(q.accepts) || q.accepts.length !== 1) {
    throw new Error("Exactly one pre-approved payment method is required");
  }
  assertAllowedOffer(q.accepts[0]);
}

export interface QuoteInfo {
  readonly resource: typeof BRIEF_URL;
  readonly chain: typeof BASE_NETWORK;
  readonly token: typeof CIRCLE_BASE_USDC;
  readonly payTo: typeof PINNED_BIQ_MERCHANT;
  readonly amountAtomic: typeof PRICE_ATOMS;
  readonly spendableWalletDebited: false;
  readonly note: "Unpaid 402 quote only; no payment performed.";
}

/** Unpaid 402 preflight. Any redirect, quote change, or 200 without a 402 is a hard stop. */
export async function readUnpaidQuote(fetchImpl: typeof fetch = fetch): Promise<QuoteInfo> {
  const res = await fetchImpl(BRIEF_URL, { method: "GET", headers: { Accept: "application/json" },
    redirect: "error", cache: "no-store" });
  if (res.status !== 402 || res.redirected || (res.url && res.url !== BRIEF_URL)) {
    throw new Error("Expected an exact first-party HTTP 402; refusing other responses.");
  }
  const h = res.headers.get("payment-required");
  if (!h || h.length > QUOTE_MAX_CHARS || !/^[A-Za-z0-9+/=_-]+$/.test(h)) {
    throw new Error("Missing/malformed PAYMENT-REQUIRED header");
  }
  const json = Buffer.from(h, "base64").toString("utf8");
  if (json.length > QUOTE_MAX_CHARS) throw new Error("Oversized quote");
  let data: unknown;
  try { data = JSON.parse(json); } catch { throw new Error("Invalid quote JSON"); }
  assertAllowedQuote(data);
  return {
    resource: BRIEF_URL, chain: BASE_NETWORK,
    token: CIRCLE_BASE_USDC, payTo: PINNED_BIQ_MERCHANT,
    amountAtomic: PRICE_ATOMS, spendableWalletDebited: false,
    note: "Unpaid 402 quote only; no payment performed.",
  };
}
