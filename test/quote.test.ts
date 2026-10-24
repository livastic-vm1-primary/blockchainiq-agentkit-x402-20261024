import { describe, expect, it } from "vitest";
import { assertAllowedOffer, assertAllowedQuote, readUnpaidQuote } from "../src/quote.js";
import { BRIEF_URL, CIRCLE_BASE_USDC, BASE_NETWORK, PINNED_BIQ_MERCHANT, PRICE_ATOMS } from "../src/constants.js";

export const GOOD_OFFER = {
  scheme: "exact",
  network: BASE_NETWORK,
  asset: CIRCLE_BASE_USDC,
  amount: PRICE_ATOMS,
  payTo: PINNED_BIQ_MERCHANT,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};
export const GOOD_QUOTE = {
  x402Version: 2, error: "Payment required", resource: {url:BRIEF_URL,mimeType:"application/json"},
  accepts: [GOOD_OFFER], extensions: {},
};
export function fake402(quote: unknown = GOOD_QUOTE): Response {
  return new Response(JSON.stringify({error:"Payment required"}), {
    status:402,
    headers:{"PAYMENT-REQUIRED":Buffer.from(JSON.stringify(quote),"utf8").toString("base64")},
  });
}
export function fakeFetch(reply: Response): typeof fetch {
  return (async () => reply) as typeof fetch;
}

describe("strict x402 unpaid price quote (official source format)", () => {
  it("recognizes exactly native Circle USDC on Base, 0.01 and pinned seller", () => {
    expect(() => assertAllowedQuote(GOOD_QUOTE)).not.toThrow();
    expect(() => assertAllowedOffer(GOOD_OFFER)).not.toThrow();
  });
  it.each([
    ["wrong chain", {network:"eip155:1"}],
    ["other asset", {asset:"0x2222222222222222222222222222222222222222"}],
    ["higher price", {amount:"50000"}],
    ["zero quote", {amount:"0"}],
    ["wrong payer", {payTo:"0x2222222222222222222222222222222222222222"}],
    ["unknown route", {scheme:"permit2"}],
    ["unbounded timeout", {maxTimeoutSeconds:3600}],
    ["approval flow", {extra:{assetTransferMethod:"permit2"}}],
  ])("refuses %s before any money can move", (_,patch) => {
    expect(() => assertAllowedOffer({...GOOD_OFFER,...patch})).toThrow();
  });
  it("rejects unknown x402 versions", () => {
    expect(() => assertAllowedQuote({...GOOD_QUOTE,x402Version:1})).toThrow();
  });
  it("rejects a swapped HTTP resource", () => {
    expect(() => assertAllowedQuote({...GOOD_QUOTE,resource:{url:"https://example.com"}})).toThrow();
  });
  it("rejects multiple payment options", () => {
    expect(() => assertAllowedQuote({...GOOD_QUOTE,accepts:[GOOD_OFFER,GOOD_OFFER]})).toThrow();
  });
  it("accepts single 402 quote and marks zero spent", async () => {
    const q=await readUnpaidQuote(fakeFetch(fake402()));
    expect(q.amountAtomic).toBe("10000");
    expect(q.spendableWalletDebited).toBe(false);
  });
  it.each([200,404,500])("rejects non-402 %i",async status=>{
    await expect(readUnpaidQuote(fakeFetch(new Response("no quote",{status})))).rejects.toThrow();
  });
  it("rejects no PAYMENT-REQUIRED header",async()=>{
    await expect(readUnpaidQuote(fakeFetch(new Response("{}",{status:402})))).rejects.toThrow();
  });
  it("rejects malformed header and never pays",async()=>{
    const bad=new Response("{}",{status:402,headers:{"PAYMENT-REQUIRED":"not base64!"}});
    await expect(readUnpaidQuote(fakeFetch(bad))).rejects.toThrow();
  });
});
