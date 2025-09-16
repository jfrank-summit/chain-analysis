import "dotenv/config";
import { createLogger } from "@chain-analysis/config";

import { runBackfill } from "./ingest/backfill.js";
import { startStreaming } from "./ingest/stream.js";

const parseArgs = (argv: string[]) => {
  const args = argv.slice(3);
  const flags: Record<string, string | boolean> = {};
  for (const a of args) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      flags[k] = v === undefined ? true : v;
    }
  }
  return flags;
};

const main = async () => {
  const logger = createLogger();
  const cmd = process.argv[2];
  const flags = parseArgs(process.argv);

  if (cmd === "stream") {
    const chains =
      typeof flags.chains === "string" ? flags.chains.split(",") : ["consensus", "auto-evm"]; // default both
    await startStreaming({ chains: chains as ("consensus" | "auto-evm")[] });
  } else if (cmd === "backfill") {
    const chain = (flags.chain as string) ?? "consensus";
    const start = flags.start ? Number(flags.start) : undefined;
    const end = flags.end ? Number(flags.end) : undefined;
    const K = flags.K ? Number(flags.K) : undefined;
    await runBackfill({ chain: chain as "consensus" | "auto-evm", start, end, K });
  } else {
    logger.error(
      "Usage: ingest <stream|backfill> [--chains=consensus,auto-evm] [--chain=...] [--start=...] [--end=...] [--K=...]",
    );
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
