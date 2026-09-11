# Historical market-data provenance

This project currently reads daily unadjusted OHLCV closes from the public
DoltHub repository [`post-no-preference/stocks`](https://www.dolthub.com/repositories/post-no-preference/stocks), branch `master`, through the DoltHub SQL API.

## Observed source terms

The repository page identifies `LICENSE.md` as **Creative Commons
Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**. The page states that
the repository contains the `ohlcv` table and that it is updated daily. The
license grants commercial reproduction and sharing, subject to attribution and
share-alike conditions for a database containing all or a substantial portion
of the licensed database. Adapted database material must retain compatible
share-alike terms and changes must be indicated. The license does not grant
trademark, privacy, or publicity rights and provides the data as-is.

The source page and terms were recorded on **2026-09-12**. The exact data
revision is not hard-coded: each API page records the `dolt_log` commit hash in
`sourceRevision`, and the reader fails closed if that revision changes during a
page read.

The machine-readable record is
[`config/market-data/dolthub-stocks.provenance.json`](../config/market-data/dolthub-stocks.provenance.json).
It is the source of truth for the repository boundary, observed license terms,
required storage metadata, display attribution, change notice/share-alike plan,
and launch gate. `services/market-data/provenance-compliance.ts` checks that
recorded obligations are present and keeps paid storage/display blocked while
the rights review is pending.

## Product handling decision

Until a rights review confirms that our planned paid storage and user-facing
display satisfy CC BY-SA 4.0 (including attribution, notices, and share-alike
obligations), this dataset is an ingestion candidate only. Brokerage activity
remains the source of dividend income, and DoltHub split/dividend tables do not
alter holdings automatically. Every stored close retains source and revision
metadata so attribution and correction work can be traced.

Required launch evidence:

1. Preserve the upstream license and attribution notice with every distributed
   database or materially adapted dataset.
2. Record whether our stored subset is an adapted database and publish the
   compatible license/notice if it is shared outside the service.
3. Recheck the repository license and terms before enabling paid production
   ingestion; a source revision alone is not licensing clearance.

The compliance evaluator is deliberately conservative: a local or development
run may verify that the required fields are recorded, but only an explicit
`approved` rights-review state can open the paid launch gate. This is an
engineering control, not a legal conclusion.
