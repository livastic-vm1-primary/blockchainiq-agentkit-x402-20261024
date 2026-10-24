/** The only paid destination this integration accepts. Public, independently inspectable. */
export const ORIGIN = "https://www.blockchainiq.co";
export const CATALOG_URL = ORIGIN + "/api/x402/v1";
export const BRIEF_URL = CATALOG_URL + "/brief";
export const BASE_NETWORK = "eip155:8453";
export const CIRCLE_BASE_USDC = "0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913";
export const PINNED_BIQ_MERCHANT = "0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e";
export const PRICE_ATOMS = "10000"; // 6-decimal Circle USDC == 0.01 USDC
export const PRICE_USDC = "0.010000";
export const MAX_TIMEOUT_SECONDS = 300;
export const QUOTE_MAX_CHARS = 12_000;
