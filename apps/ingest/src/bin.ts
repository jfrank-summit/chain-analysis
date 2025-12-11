import "dotenv/config";
import { createLogger } from "@chain-analysis/config";

import { runOfflineBackfill } from "./ingest/backfill-offline.js";
import { runBackfill } from "./ingest/backfill.js";

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

  if (cmd === "backfill") {
    const chain = (flags.chain as string) ?? "consensus";
    const start = flags.start ? Number(flags.start) : undefined;
    const end = flags.end ? Number(flags.end) : undefined;
    const K = flags.K ? Number(flags.K) : undefined;
    await runBackfill({ chain: chain as "consensus" | "auto-evm", start, end, K });
  } else if (cmd === "backfill-offline") {
    const start = flags.start ? Number(flags.start) : undefined;
    const end = flags.end ? Number(flags.end) : undefined;
    await runOfflineBackfill({ start, end });
  } else {
    logger.error(
      "Usage: ingest backfill [--chain=...] [--start=...] [--end=...] [--K=...]\n" +
        "       ingest backfill-offline [--start=...] [--end=...]",
    );
    process.exit(1);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
