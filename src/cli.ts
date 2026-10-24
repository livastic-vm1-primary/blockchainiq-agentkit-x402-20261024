import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { blockchainIQActionProvider } from "./provider.js";
import { CATALOG_URL } from "./constants.js";

async function main(args: string[]) {
  if (args.length !== 1) throw new Error("Use --catalog, --preview, or --paid-once.");
  if (args[0] === "--catalog") {
    const response = await fetch(CATALOG_URL,{redirect:"error"});
    if (response.status !== 200) throw new Error("Firstparty free catalog unavailable");
    const json = await response.json() as { data?: Array<{id:string,path:string,price:string}> };
    console.log(JSON.stringify({publicCatalog:true,
      resources:(json.data??[]).filter(x=>x.id==="brief" || x.id==="event-risk")
        .map(x=>({id:x.id,path:x.path,price:x.price})),spendUSDC:0},null,2));
    return;
  }
  if (args[0] === "--preview") {
    console.log(await blockchainIQActionProvider().marketBriefQuote({}));
    return;
  }
  if (args[0] === "--paid-once") {
    if (process.env.BLOCKCHAINIQ_ONE_CENT_APPROVED!=="YES" ||
        process.env.ONE_CALL_MAX_ATOMIC!=="10000")
      throw new Error("The separate exact one-cent payment approval is missing.");
    const raw=process.env.AGENT_PRIVATE_KEY;
    if (!raw || !/^0x[a-fA-F0-9]{64}$/.test(raw))
      throw new Error("Missing dedicated expendable wallet. Never use a treasury recovery phrase.");
    const dir=join(process.cwd(),".private");
    await mkdir(dir,{recursive:true,mode:0o700});
    // Durable exclusive lock before signing. UNKNOWN outcomes must not be replayed.
    await writeFile(join(dir,"paid-once.intent.json"),JSON.stringify({
      at:new Date().toISOString(),network:"eip155:8453",
      amountAtomic:"10000",oneAttempt:true,noAutoRetry:true,
    },null,2),{flag:"wx",mode:0o600});
    const signer=privateKeyToAccount(raw as Hex);
    const provider=blockchainIQActionProvider({signer,allowPaid:true});
    const result=await provider.marketBriefPaidOnce({
      approval:"I_ACKNOWLEDGE_THE_ONCE_ONLY_0.01_USDC_EXPENSE"
    });
    console.log(result);
    return;
  }
  throw new Error("Unknown option");
}
main(process.argv.slice(2)).catch(err=>{
  console.error("BLOCKED_OR_UNVERIFIED:",err instanceof Error?err.message.slice(0,240):"unknown");
  process.exitCode=1;
});
