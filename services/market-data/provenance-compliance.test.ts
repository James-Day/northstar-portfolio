import { describe, expect, it } from 'vitest';
import { dolthubStocksProvenanceManifest, evaluateDoltHubProvenanceCompliance } from '@/services/market-data/provenance-compliance';

describe('DoltHub provenance compliance', () => {
  it('records machine-readable source, license, revision, storage, and display obligations', () => {
    expect(dolthubStocksProvenanceManifest.datasetId).toBe('dolthub-post-no-preference-stocks');
    expect(dolthubStocksProvenanceManifest.license.spdxId).toBe('CC-BY-SA-4.0');
    expect(dolthubStocksProvenanceManifest.repository.revisionQuery).toContain('dolt_log');
    expect(dolthubStocksProvenanceManifest.storagePolicy.preserveSourceRevision).toBe(true);
    expect(dolthubStocksProvenanceManifest.displayPolicy.attributionText).toContain('CC BY-SA 4.0');
    expect(dolthubStocksProvenanceManifest.launchGate.paidStorageAndDisplay).toBe('blocked_pending_rights_review');
  });

  it('passes recorded obligation checks while keeping paid launch blocked', () => {
    const result = evaluateDoltHubProvenanceCompliance();
    expect(result.canUseForPaidStorageAndDisplay).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'license-recorded', status: 'pass' }),
      expect.objectContaining({ id: 'source-revision-preserved', status: 'pass' }),
      expect.objectContaining({ id: 'storage-license-notice-preserved', status: 'pass' }),
      expect.objectContaining({ id: 'display-attribution-and-notice', status: 'pass' }),
      expect.objectContaining({ id: 'rights-review', status: 'blocked' }),
    ]));
  });

  it('fails closed for a paid launch until rights review is explicitly approved', () => {
    expect(evaluateDoltHubProvenanceCompliance(dolthubStocksProvenanceManifest, { paidLaunch: true }).canUseForPaidStorageAndDisplay).toBe(false);
    const approved = structuredClone(dolthubStocksProvenanceManifest);
    approved.license.rightsReview = 'approved';
    expect(evaluateDoltHubProvenanceCompliance(approved, { paidLaunch: true }).canUseForPaidStorageAndDisplay).toBe(true);
  });

  it('fails closed when provenance links are not secure HTTPS URLs', () => {
    const malformed = structuredClone(dolthubStocksProvenanceManifest);
    malformed.repository.url = 'http://example.test';
    malformed.displayPolicy.licenseLink = 'javascript:alert(1)';
    const result = evaluateDoltHubProvenanceCompliance(malformed);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'license-recorded', status: 'pass' }),
      expect.objectContaining({ id: 'upstream-provenance-recorded', status: 'fail' }),
      expect.objectContaining({ id: 'display-attribution-and-notice', status: 'fail' }),
    ]));
  });
});
