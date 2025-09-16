type Prefetched = {
  events?: any[];
};

export const enrichConsensusData = async (
  api: any,
  hash: string,
  prefetched?: Prefetched,
): Promise<{ containsSegmentHeaders: boolean; bundleCount: number }> => {
  const fromEvents = (events: any[]) => {
    const containsSegmentHeaders = events.some(
      ({ event }: any) => event.section === "subspace" && event.method === "SegmentHeaderStored",
    );
    const bundleCount = events.filter(
      ({ event }: any) => event.section === "domains" && event.method === "BundleStored",
    ).length;
    return { containsSegmentHeaders, bundleCount };
  };

  if (prefetched?.events && prefetched.events.length > 0) {
    return fromEvents(prefetched.events);
  }

  const at = await api.at(hash);
  const events = await at.query.system.events();
  return fromEvents(events);
};
