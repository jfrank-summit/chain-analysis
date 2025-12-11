export type OfflineOperatorEvent = {
  operatorId: number;
  domainId: number;
  submittedBundles: number;
  expectedBundles: number;
  minRequiredBundles: number;
};

export type EpochCompletedEvent = {
  domainId: number;
  epochIndex: number;
};

export const extractOfflineOperatorEvents = (events: any[]): OfflineOperatorEvent[] =>
  events
    .filter(({ event }: any) => event.section === "domains" && event.method === "OperatorOffline")
    .map(({ event }: any) => {
      const [operatorId, domainId, submittedBundles, expectations] = event.data;
      return {
        operatorId: operatorId.toNumber(),
        domainId: domainId.toNumber(),
        submittedBundles: submittedBundles.toNumber(),
        expectedBundles: expectations.expectedBundles.toNumber(),
        minRequiredBundles: expectations.minRequiredBundles.toNumber(),
      };
    });

export const extractEpochCompletedEvents = (events: any[]): EpochCompletedEvent[] =>
  events
    .filter(
      ({ event }: any) => event.section === "domains" && event.method === "DomainEpochCompleted",
    )
    .map(({ event }: any) => {
      const [domainId, epochIndex] = event.data;
      return {
        domainId: domainId.toNumber(),
        epochIndex: epochIndex.toNumber(),
      };
    });

export const isEpochTransitionBlock = (events: any[]): boolean =>
  events.some(
    ({ event }: any) => event.section === "domains" && event.method === "DomainEpochCompleted",
  );
