/* eslint-disable @typescript-eslint/no-unused-vars */

export const enrichConsensusData = async (
  api: any,
  hash: string,
): Promise<{ containsSegmentHeaders: boolean; bundleCount: number }> =>
  // TODO: inspect events/extrinsics at block 'hash' to determine presence and count
  ({ containsSegmentHeaders: false, bundleCount: 0 });
