type Prefetched = {
  header?: any;
};

export const enrichDomainData = async (
  api: any,
  domainHash: string,
  prefetched?: Prefetched,
): Promise<{ consensusHash: string | null }> => {
  const header = prefetched?.header ?? (await api.rpc.chain.getHeader(domainHash));
  // Scan digest logs for PreRuntime with engine id RGTR (0x52475452)
  const logs: any[] = header.digest?.logs ?? [];
  for (const item of logs) {
    if (item?.isPreRuntime) {
      const [engineId, data] = item.asPreRuntime;
      if (engineId?.toHex && engineId.toHex() === "0x52475452") {
        const h = api.registry.createType("Hash", data);
        return { consensusHash: h.toHex() };
      }
    }
  }
  return { consensusHash: null };
};
