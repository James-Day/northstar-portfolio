# Production market-data approval record

This record is intentionally incomplete until an operator reviews the exact
stored/displayed dataset and selects a commercial provider plan. The free
Marketstack key remains development-only, and no automatic upgrade is allowed.

Before inviting paying users, record all of the following in the deployment
ticket and attach the source evidence:

- Dataset subset, source revision, retrieval date, and DoltHub attribution.
- Confirmation that storage/display terms permit the intended paid use,
  including attribution, change notices, and share-alike treatment.
- Independent reviewer's name, date, decision, and evidence links.
- Provider name, commercial plan, monthly allowance, and account identifier.
- Confirmation that the production key is held server-side and the configured
  quota reserve is sufficient for the active-symbol refresh strategy.

Approval status: `pending_rights_review`

The launch gate must fail while the status is pending, even when the code and
provider configuration are otherwise ready.
