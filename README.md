# Blockchain IQ x402 Action Provider for Coinbase AgentKit

Original, zero-custody-by-default crypto market brief integration written for **Coinbase AgentKit TypeScript 0.10.4** and the **Blockchain IQ four-framework USDC development bounty** of October 23, 2026.

Public sponsor announcement: https://www.blockchainiq.co/blog/x402-build-bounties

The sponsor describes a fixed 525-USDC bounty pool. The first accepted integration receives 150 USDC; the next three accepted integrations receive 125 USDC each. The relevant requested deliverable here is an **AgentKit action provider**, distinct from the author's separate LangChain integration. One original creator may win at most two total framework slots, after a successful real paid-call test, review and acceptance.

**Current status: working SDK implementation, 48 tests pass, NO mainnet paid call made, no bounty claim submitted, no award promised or earned.** Published source does not reserve a bounty slot. The sponsor alone decides whether it passes.

## Contents and actions

- Real ActionProvider subclass from the official @coinbase/agentkit SDK.
- Two SDK-native entries returned by getActions on Base EVM chain 8453 only:
  - BlockchainIQActionProvider_market_brief_quote (FREE): validates an unpaid x402 v2 HTTP 402 and returns quoted Base USDC amount and recipient. No signer required.
  - BlockchainIQActionProvider_market_brief_paid_once (DISABLED BY DEFAULT): requires explicit separate operator authorization, an intentional dedicated expendable wallet and exact approval literal, then uses official @x402/fetch + @x402/evm EIP-3009 flow to request a single paid market brief. All fields are checked before signing and again by the x402 payment policy.
- Strict origin and asset allowlist. Only HTTPS https://www.blockchainiq.co/api/x402/v1/brief; canonical Circle Base USDC asset 0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913, network eip155:8453, exact 10000 atomic units (0.010000 USDC), actual first-party quoted seller 0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e, exact scheme on protocol v2. Any changed recipient/token/chain/price/URI/timeout or Permit2 approval request fails closed.
- One paid attempt per instance. The opt-in CLI additionally creates an exclusive disk intent BEFORE signing, so an unknown outcome does not accidentally cause a second payment.
- No default AgentKit wallet spending actions. Only these two actions exposed when Coinbase AgentKit supplies an EVM Base wallet provider.
- HTTP200 paid responses must return a PAYMENT-RESPONSE header including a valid Base transaction identifier; such a self-declared header is NOT independent finality. A third-party on-chain receipt check is still required before any real claim.

**Important SDK detail:** @coinbase/agentkit 0.10.4's CreateAction decorator sends an unawaited analytics HTTP request when actions are invoked. In this VM a synthetic invocation caused an analytics HTTP400 and unhandled rejection. This provider implements the official public ActionProvider.getActions interface directly with Zod validation instead of the decorator. This is a normal ActionProvider extension and changes no upstream SDK files. AgentKit initialization elsewhere may still have its own analytics; the two custom actions do not initiate optional decorator telemetry.

## Reproduce for free

Node 22 or later. No CDP or GitHub credentials, funded wallet or secret API key is needed for an unpaid quote inspection.

~~~sh
npm install --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npm run test
node dist/cli.js --catalog
node dist/cli.js --preview
~~~

Live preview makes a FREE GET request to the official Blockchain IQ market-brief endpoint and expects HTTP402 with a machine-readable PAYMENT-REQUIRED header. It explicitly does not send a signed x402 payment.

Minimal programmatic integration (with a wallet provider supplied by your own Coinbase AgentKit host, not created by this package):

~~~js
import { blockchainIQActionProvider } from "./dist/index.js";

const provider = blockchainIQActionProvider();
const actions = provider.getActions(existingBaseWalletProvider);
const freeQuote = actions.find(a => a.name.endsWith("_market_brief_quote"));
console.log(await freeQuote.invoke({}));
~~~

The host must provide an existing Base network wallet provider; getActions returns an empty list for all other networks. There is no default wallet initialization, CDP secret or trading action here.

## The optional real 0.01-USDC paid smoke call (NOT EXECUTED)

An operator must separately approve a **single** real purchase and control an expendable wallet with only the small intentional test budget. Never use the primary MetaMask private key, paste a recovery phrase into chat, publish secrets, pay an unknown recipient, or spend account funds to generate a fake sponsor receipt.

The CLI refuses paid mode by default. To opt in later, the operator must set BLOCKCHAINIQ_ONE_CENT_APPROVED=YES and ONE_CALL_MAX_ATOMIC=10000 and securely supply AGENT_PRIVATE_KEY as a separately controlled disposable key in the local process environment. Then run:

~~~sh
node dist/cli.js --paid-once
~~~

It creates an exclusive .private/paid-once.intent.json BEFORE any signing and only attempts one payment. Do not remove the intent file to retry if the outcome is ambiguous. Signature and private key are not printed by authored code. The project never manages the original owner's MetaMask, swaps assets, bridges, uses gas, grants ERC20 approvals or buys API calls by itself.

For a Coinbase AgentKit host, construct the provider with signer: a dedicated Base-compatible PrivateKeyAccount and allowPaid: true. The paid action also requires the literal string I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE in the approval field. Even this literal should only be passed after the human owner authorizes that exact expense.

## Independent verification and limits

Reproducible offline Vitest tests cover genuine AgentKit action registration and getActions.invoke dispatch, network gating, Zod validation, refusal of unapproved spend, quote URI/scheme/network/asset/payee/price/timeout checks, rejection of token approvals, mock settlement extraction, bad paid receipts and no-repeat behavior. These are **synthetic tests** and did not create mainnet transfers.

October 24, 2026 checks:
- Official public API catalogue: HTTP200.
- Unpaid x402 market-brief quote: genuine first-party HTTP402 for exactly 0.010000 Base USDC to pinned merchant.
- Public preview via built CLI: successful.
- Strict TypeScript check: PASS.
- Compile: PASS.
- 48/48 deterministic tests: PASS.
- External paid HTTP200 with genuinely finalized settlement: NOT RUN, UNKNOWN.
- Claimed sponsor prize or actual new USDC to author: 0.

To legitimately enter, the real developer must make a genuinely authorized paid 0.01 USDC call THROUGH THIS AgentKit integration, independently verify the finalized USDC transfer, and email partnerships@blockchainiq.co with this repo URL, the framework designation Coinbase AgentKit, the actual unique paid tx hash, public developer credit and eligible original Base receive address. The sponsor will match the paid wallet against its records and run the repo with their own disposable wallet. No second paid call should be made merely to farm a bounty.

This is non-trading market data client software, not investment guidance, a custody service, certified financial accounting, or assurance of any bounty payout. Pseudonymous author attribution does not substitute for legal identity verification.

Authored by PaperPilot Tools, one real beneficial owner using AI-assisted development. Original code licensed MIT. Coinbase AgentKit and third-party x402 libraries retain their own licenses.
