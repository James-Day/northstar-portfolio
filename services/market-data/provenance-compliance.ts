import manifest from '@/config/market-data/dolthub-stocks.provenance.json';

export type ProvenanceRightsReview = 'pending' | 'approved' | 'rejected';
export type ProvenanceManifest = typeof manifest;

export type ProvenanceComplianceCheck = {
  id: string;
  status: 'pass' | 'fail' | 'blocked';
  detail: string;
};

export type ProvenanceComplianceResult = {
  canUseForPaidStorageAndDisplay: boolean;
  checks: ProvenanceComplianceCheck[];
};

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value);
}

/**
 * Evaluates the source manifest at the product boundary. A passing manifest
 * check proves that obligations are recorded; it does not provide legal advice
 * or replace a rights review for the exact stored subset.
 */
export function evaluateDoltHubProvenanceCompliance(
  source: ProvenanceManifest = manifest,
  options: { paidLaunch?: boolean } = {},
): ProvenanceComplianceResult {
  const checks: ProvenanceComplianceCheck[] = [
    {
      id: 'license-recorded',
      status: source.license.spdxId && isHttpsUrl(source.license.url) ? 'pass' : 'fail',
      detail: 'License identifier and canonical license URL are recorded.',
    },
    {
      id: 'upstream-provenance-recorded',
      status: isHttpsUrl(source.repository.url) && source.repository.branch && source.repository.table ? 'pass' : 'fail',
      detail: 'Repository, branch, table, and retrieval boundary are recorded.',
    },
    {
      id: 'source-revision-preserved',
      status: source.storagePolicy.preserveSourceRevision && source.repository.revisionQuery ? 'pass' : 'fail',
      detail: 'Each stored price must retain the upstream revision used to read it.',
    },
    {
      id: 'storage-license-notice-preserved',
      status: source.storagePolicy.preserveSource && source.storagePolicy.preserveLicenseNotice ? 'pass' : 'fail',
      detail: 'Storage policy preserves source identity and the applicable license notice.',
    },
    {
      id: 'display-attribution-and-notice',
      status: source.displayPolicy.attributionRequired && Boolean(source.displayPolicy.attributionText) && isHttpsUrl(source.displayPolicy.sourceLink) && isHttpsUrl(source.displayPolicy.licenseLink) ? 'pass' : 'fail',
      detail: 'Display policy includes attribution text and links to the source and license.',
    },
    {
      id: 'change-and-share-alike-plan',
      status: source.license.obligations.indicateChanges && source.license.obligations.shareAlikeForAdaptedDatabase && source.displayPolicy.changeNoticeRequired && source.displayPolicy.shareAlikeNoticeRequired ? 'pass' : 'fail',
      detail: 'Change notice and compatible share-alike obligations are explicitly tracked.',
    },
    {
      id: 'rights-review',
      status: source.license.rightsReview === 'approved' ? 'pass' : 'blocked',
      detail: source.license.rightsReview === 'approved' ? 'Rights review is recorded as approved.' : 'Paid storage and user-facing display remain blocked until rights review is approved.',
    },
  ];

  const manifestChecksPass = checks.every((check) => check.status === 'pass' || (check.id === 'rights-review' && !options.paidLaunch));
  const canUseForPaidStorageAndDisplay = options.paidLaunch === true && manifestChecksPass && source.license.rightsReview === 'approved';
  return { canUseForPaidStorageAndDisplay, checks };
}

export { manifest as dolthubStocksProvenanceManifest };
