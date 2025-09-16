/* eslint-disable @typescript-eslint/no-unused-vars */
export const enrichDomainData = async (
  api: any,
  domainHash: string,
): Promise<{ consensusHash: string | null }> => {
  const consensusHash = null;
  // TODO: inspect domain header digests or consult consensus-side mapping
  return {
    consensusHash,
  };
};
