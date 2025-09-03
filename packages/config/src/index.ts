import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  CONSENSUS_RPC_WS: z.string().url(),
  DATA_DIR: z.string().default("data"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  WRITE_BATCH_ROWS: z.coerce.number().int().positive().default(5000),
  WRITE_BATCH_MS: z.coerce.number().int().positive().default(60000),
});

export type AppConfig = z.infer<typeof envSchema>;

export const loadConfig = (): AppConfig => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
};
