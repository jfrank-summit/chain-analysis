import { ApiPromise, WsProvider } from "@polkadot/api";
import "@polkadot/api-augment";

export type LoggerLike = {
  info: (objOrMsg: any, msg?: string) => void;
  warn: (objOrMsg: any, msg?: string) => void;
  error: (objOrMsg: any, msg?: string) => void;
};

export const connect = async (url: string, logger?: LoggerLike): Promise<ApiPromise> => {
  const log: LoggerLike =
    logger ?? ({ info: () => {}, warn: () => {}, error: () => {} } as LoggerLike);
  const provider = new WsProvider(url);
  const api = await ApiPromise.create({ provider });
  // Light-touch connection logs
  api.on("connected", () => log.info({ url }, "api connected"));
  api.on("disconnected", () => log.warn({ url }, "api disconnected"));
  api.on("error", (e) => log.error({ url, err: e }, "api error"));
  await api.isReady; // ensure ready before use
  return api;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const withRpcRetry = async <T>(
  api: ApiPromise,
  fn: () => Promise<T>,
  logger?: LoggerLike,
): Promise<T> => {
  const log: LoggerLike =
    logger ?? ({ info: () => {}, warn: () => {}, error: () => {} } as LoggerLike);
  let attempt = 0;
  // modest backoff caps quickly to avoid long stalls
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt += 1;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 4), 8000);
      log.warn({ attempt, delay, err: e }, "rpc retry");
      try {
        await api.isReady; // wait for reconnect if in progress
      } catch {
        // ignore, rely on backoff delay
      }
      await sleep(delay);
      // continue loop
    }
  }
};

export const getBlockTimestampMs = async (api: ApiPromise, hash: string): Promise<number> => {
  const now = await (api.query.timestamp.now as any).at(hash);
  return now.toNumber();
};

// Extract timestamp from block extrinsics if available to avoid a separate state query.
// Returns null if the timestamp extrinsic is not present.
export const getTimestampFromExtrinsics = (extrinsics: any[]): number | null => {
  const tsExtrinsic = extrinsics.find(
    (e: any) => e?.method?.section === "timestamp" && e?.method?.method === "set",
  );
  if (!tsExtrinsic) return null;
  const arg = tsExtrinsic.method?.args?.[0];
  if (arg == null) return null;

  const toNumber = (arg as any)?.toNumber as (() => number) | undefined;
  if (typeof toNumber === "function") return toNumber.call(arg);

  const toBigInt = (arg as any)?.toBigInt as (() => bigint) | undefined;
  if (typeof toBigInt === "function") return Number(toBigInt.call(arg));

  return typeof arg === "number" ? arg : null;
};
