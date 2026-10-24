import "reflect-metadata";
import { ActionProvider } from "@coinbase/agentkit";
import type { Network, WalletProvider } from "@coinbase/agentkit";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { BASE_NETWORK, BRIEF_URL, CIRCLE_BASE_USDC, PRICE_ATOMS, PRICE_USDC } from "./constants.js";
import { assertAllowedOffer, readUnpaidQuote } from "./quote.js";

type PaidFetcher = (input: string, init?: RequestInit) => Promise<Response>;
export const PreviewSchema = z.object({}).strict();
export const PaidOnceSchema = z.object({
  approval: z.literal("I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"),
}).strict();
export interface AgentKitIQOptions {
  signer?: PrivateKeyAccount;
  allowPaid?: boolean;
  fetchImpl?: typeof fetch;
  testingPaidFetcher?: PaidFetcher;
}
function boundedX402Fetch(signer: PrivateKeyAccount, fetchImpl: typeof fetch): PaidFetcher {
  const client = x402Client.fromConfig({
    schemes: [{ network: BASE_NETWORK, client: new ExactEvmScheme(signer) }],
    spendControls: {
      maxAmountPerPayment: 0.01,
      allowedAssets: [{ network: BASE_NETWORK, asset: CIRCLE_BASE_USDC, maxAmountPerPayment: PRICE_ATOMS }],
    },
    policies: [(version, requirements) => {
      if (version !== 2) return [];
      return requirements.filter(o => {
        try { assertAllowedOffer(o); return true; } catch { return false; }
      });
    }],
  });
  return wrapFetchWithPayment(fetchImpl, client);
}
export interface ReceiptRecord {
  status: "SETTLEMENT_HEADER_RETURNED_NOT_INDEPENDENTLY_FINALIZED";
  transactionHash: string;
  network: typeof BASE_NETWORK;
  payer: string;
  amountUSDC: typeof PRICE_USDC;
  resource: typeof BRIEF_URL;
  content: unknown;
  hasOnchainConfirmation: false;
}
async function inspectPaidResponse(res: Response, expectedPayer: string): Promise<ReceiptRecord> {
  if (res.status !== 200 || res.redirected || (res.url && res.url !== BRIEF_URL))
    throw new Error("No confirmed firstparty paid HTTP 200; do not retry.");
  const receiptB64 = res.headers.get("payment-response");
  if (!receiptB64 || receiptB64.length > 12_000)
    throw new Error("No bounded PAYMENT-RESPONSE header; outcome UNKNOWN, do not retry.");
  let obj: unknown;
  try { obj = decodePaymentResponseHeader(receiptB64); }
  catch { throw new Error("Malformed x402 settlement metadata; do not retry."); }
  if (!obj || typeof obj !== "object") throw new Error("Invalid settlement receipt.");
  const p = obj as Record<string, unknown>;
  const tx = p.transaction ?? p.transactionHash ?? p.txHash;
  const payer = typeof p.payer === "string" ? p.payer : expectedPayer;
  if (p.network !== BASE_NETWORK || typeof tx !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(tx) ||
      payer.toLowerCase() !== expectedPayer.toLowerCase())
    throw new Error("Wrong or incomplete Base receipt; do not retry.");
  const body = await res.text();
  if (body.length > 300_000) throw new Error("Oversized paid JSON response.");
  let content: unknown;
  try { content = JSON.parse(body); }
  catch { throw new Error("Paid JSON response malformed."); }
  return {
    status:"SETTLEMENT_HEADER_RETURNED_NOT_INDEPENDENTLY_FINALIZED",
    transactionHash:tx, network:BASE_NETWORK, payer, amountUSDC:PRICE_USDC,
    resource:BRIEF_URL, content, hasOnchainConfirmation:false
  };
}
/**
 * Coinbase AgentKit ActionProvider with two SDK-native registered actions.
 * Does not enable AgentKit walletTransfer or arbitrary default wallet actions.
 * Paid path stays disabled without a separate low-balance, owner-authorized EVM
 * signer; the user's original MetaMask private key is never requested/read.
 */
export class BlockchainIQActionProvider extends ActionProvider<WalletProvider> {
  private readonly opts: AgentKitIQOptions;
  private consumed = false;
  constructor(options: AgentKitIQOptions = {}) {
    super("blockchainiq-x402", []);
    this.opts = options;
  }
  supportsNetwork = (network: Network) =>
    network.protocolFamily === "evm" && String(network.chainId) === "8453";

  /**
   * Public Coinbase AgentKit ActionProvider.getActions contract.
   * Avoids the optional CreateAction decorator's unawaited telemetry POST that
   * can crash clean-room runs on analytics HTTP400; no SDK files are modified.
   * Zod validation remains explicit on BOTH action entrypoints.
   */
  override getActions(walletProvider: WalletProvider) {
    if (!this.supportsNetwork(walletProvider.getNetwork())) return [];
    return [
      {
        name: "BlockchainIQActionProvider_market_brief_quote",
        description: "FREE Blockchain IQ Base USDC one-cent x402 quote. No wallet signature.",
        schema: PreviewSchema,
        invoke: (args: unknown) => this.marketBriefQuote(PreviewSchema.parse(args))
      },
      {
        name: "BlockchainIQActionProvider_market_brief_paid_once",
        description: "Explicit one-cent paid Blockchain IQ market brief; disabled unless separately approved.",
        schema: PaidOnceSchema,
        invoke: (args: unknown) => this.marketBriefPaidOnce(PaidOnceSchema.parse(args))
      }
    ];
  }

  async marketBriefQuote(_input: z.infer<typeof PreviewSchema>): Promise<string> {
    PreviewSchema.parse(_input);
    return JSON.stringify(await readUnpaidQuote(this.opts.fetchImpl ?? fetch));
  }
  async marketBriefPaidOnce(_input: z.infer<typeof PaidOnceSchema>): Promise<string> {
    PaidOnceSchema.parse(_input);
    const { signer, allowPaid } = this.opts;
    if (!allowPaid || !signer) throw new Error("Paid action disabled: no deliberate owner opt-in and dedicated signer.");
    if (this.consumed) throw new Error("Paid action already consumed; do not repeat.");
    this.consumed = true;
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    await readUnpaidQuote(fetchImpl);
    const payFetch = this.opts.testingPaidFetcher ?? boundedX402Fetch(signer, fetchImpl);
    const response = await payFetch(BRIEF_URL, {
      method:"GET", headers:{Accept:"application/json"}, redirect:"error", cache:"no-store"
    });
    return JSON.stringify(await inspectPaidResponse(response,signer.address));
  }
}
export const blockchainIQActionProvider = (opts: AgentKitIQOptions = {}) =>
  new BlockchainIQActionProvider(opts);
