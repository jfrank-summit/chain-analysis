import { ApiPromise, WsProvider } from "@polkadot/api";
import "@polkadot/api-augment";

export const connect = async (url: string): Promise<ApiPromise> => {
  const provider = new WsProvider(url);
  const api = await ApiPromise.create({ provider });
  return api;
};

export const getBlockTimestampMs = async (api: ApiPromise, hash: string): Promise<number> => {
  const at = await api.at(hash);
  const now = await at.query.timestamp.now();
  return now.toNumber();
};
