import {describe,it,expect} from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { WalletProvider } from "@coinbase/agentkit";
import { blockchainIQActionProvider, PaidOnceSchema } from "../src/provider.js";
import { BRIEF_URL, BASE_NETWORK } from "../src/constants.js";
import { fake402, fakeFetch } from "./quote.test.js";

const SYNTHETIC_SIGNER=privateKeyToAccount(("0x"+"1".repeat(64)) as Hex);
const TX="0x"+"a".repeat(64);
const originalFakeWallet={getNetwork:()=>({protocolFamily:"evm",chainId:"8453"})} as unknown as WalletProvider;
const ethFakeWallet={getNetwork:()=>({protocolFamily:"evm",chainId:"1"})} as unknown as WalletProvider;
const solFakeWallet={getNetwork:()=>({protocolFamily:"svm",chainId:"8453"})} as unknown as WalletProvider;

function success200(receipt?: Record<string,unknown>):Response {
  const r=receipt??{success:true,network:BASE_NETWORK,
    transaction:TX,payer:SYNTHETIC_SIGNER.address};
  return new Response(JSON.stringify({data:{fictional:true,prices:[1,2,3]}}),{
    status:200,
    headers:{"PAYMENT-RESPONSE":Buffer.from(JSON.stringify(r)).toString("base64"),
      "content-type":"application/json"},
  });
}
describe("real @coinbase/agentkit ActionProvider registration",()=>{
  it("registers exactly two native SDK actions on Base",()=>{
    const p=blockchainIQActionProvider();
    const actions=p.getActions(originalFakeWallet);
    expect(p.name).toBe("blockchainiq-x402");
    expect(actions).toHaveLength(2);
    expect(actions.map(x=>x.name)).toEqual([
      "BlockchainIQActionProvider_market_brief_quote",
      "BlockchainIQActionProvider_market_brief_paid_once"
    ]);
    expect(actions.every(x=>typeof x.invoke==="function")).toBe(true);
  });
  it("declines all wrong network wallet providers",()=>{
    const p=blockchainIQActionProvider();
    expect(p.getActions(ethFakeWallet)).toHaveLength(0);
    expect(p.getActions(solFakeWallet)).toHaveLength(0);
  });
  it("runs actual AgentKit SDK action invoke without wallet signature or telemetry",async()=>{
    const p=blockchainIQActionProvider({fetchImpl:fakeFetch(fake402())});
    const actions=p.getActions(originalFakeWallet);
    const result=JSON.parse(await actions[0]!.invoke({}));
    expect(result.amountAtomic).toBe("10000");
    expect(result.spendableWalletDebited).toBe(false);
    expect(result.chain).toBe("eip155:8453");
  });
  it("rejects arbitrary non-parseable quote parameters",async()=>{
    const p=blockchainIQActionProvider({fetchImpl:fakeFetch(fake402())});
    expect(()=>p.getActions(originalFakeWallet)[0]!.invoke({rogue:true})).toThrow();
  });
  it("rejects paid call without a separately authorized signer",async()=>{
    const p=blockchainIQActionProvider({fetchImpl:fakeFetch(fake402())});
    await expect(p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    })).rejects.toThrow(/disabled/);
  });
  it("rejects wrong approval literal even when a test signer is supplied",async()=>{
    const p=blockchainIQActionProvider({
      fetchImpl:fakeFetch(fake402()),signer:SYNTHETIC_SIGNER,allowPaid:true
    });
    expect(()=>p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"agent_says_yes"
    })).toThrow();
  });
  it("the method itself requires a valid approval, not only the framework",async()=>{
    const p=blockchainIQActionProvider({
      fetchImpl:fakeFetch(fake402()),signer:SYNTHETIC_SIGNER,allowPaid:true
    });
    await expect(p.marketBriefPaidOnce({approval:"anything"} as never)).rejects.toThrow();
  });
  it("zod rejects unrecognized paid schema keys",()=>{
    expect(()=>PaidOnceSchema.parse({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE",unknown:"x"
    })).toThrow();
  });
  it("mock firstparty payment receipts can be parsed without a network or real transfer",async()=>{
    let count=0;
    const p=blockchainIQActionProvider({
      fetchImpl:fakeFetch(fake402()),
      signer:SYNTHETIC_SIGNER,allowPaid:true,
      testingPaidFetcher:async (input) => {
        count++;expect(input).toBe(BRIEF_URL);return success200();
      },
    });
    const res=JSON.parse(await p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    }));
    expect(res.transactionHash).toBe(TX);
    expect(res.hasOnchainConfirmation).toBe(false);
    expect(res.amountUSDC).toBe("0.010000");
    expect(count).toBe(1);
    await expect(p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    })).rejects.toThrow(/already consumed/);
    expect(count).toBe(1);
  });
  it("modified first-party 402 quote blocks any later paid request",async()=>{
    const wrong={
      x402Version:2,resource:{url:BRIEF_URL,mimeType:"application/json"},accepts:[
        {scheme:"exact",network:BASE_NETWORK,
        asset:"0x"+"f".repeat(40),amount:"10000",
        payTo:"0x"+"2".repeat(40),maxTimeoutSeconds:300}
      ]
    };
    let paidCalls=0;
    const p=blockchainIQActionProvider({
      fetchImpl:fakeFetch(fake402(wrong)),
      signer:SYNTHETIC_SIGNER,allowPaid:true,
      testingPaidFetcher:async()=>{paidCalls++;return success200();}
    });
    await expect(p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    })).rejects.toThrow();
    expect(paidCalls).toBe(0);
    await expect(p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    })).rejects.toThrow(/already consumed/);
  });
  it("missing header after paid request leaves outcome unverified; no retry",async()=>{
    let paidCalls=0;
    const p=blockchainIQActionProvider({
      fetchImpl:fakeFetch(fake402()),
      signer:SYNTHETIC_SIGNER,allowPaid:true,
      testingPaidFetcher:async()=>{paidCalls++;return new Response("{}",{status:200});}
    });
    await expect(p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    })).rejects.toThrow();
    await expect(p.getActions(originalFakeWallet)[1]!.invoke({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    })).rejects.toThrow(/already consumed/);
    expect(paidCalls).toBe(1);
  });
  it("wrong settlement chain or unknown tx does not pass",async()=>{
    for (const receipt of [
      {success:true,network:"eip155:1",transaction:TX,payer:SYNTHETIC_SIGNER.address},
      {success:true,network:BASE_NETWORK,payer:SYNTHETIC_SIGNER.address},
      {success:true,network:BASE_NETWORK,transaction:TX,payer:"0x"+"f".repeat(40)},
    ]) {
      const p=blockchainIQActionProvider({
        fetchImpl:fakeFetch(fake402()),
        signer:SYNTHETIC_SIGNER,allowPaid:true,
        testingPaidFetcher:async()=>success200(receipt)
      });
      await expect(p.getActions(originalFakeWallet)[1]!.invoke({
        approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
      })).rejects.toThrow();
    }
  });
});
