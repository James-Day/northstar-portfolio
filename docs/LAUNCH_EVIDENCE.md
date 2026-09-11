# Launch evidence aggregator

`npm run launch:evidence -- path/to/launch-evidence.json` evaluates the final
13.08 launch gate from independently recorded evidence. It intentionally fails
closed when any baseline, hosted, recovery, licensing, configuration, or
revision field is missing. The checked-in example is a template and is not
launch evidence.

Populate the record only after the staging/production runbook is executed. Keep
provider secrets, access tokens, signed URLs, and credentials out of the JSON;
use ticket IDs or secret-free record references in the backup evidence links.
A ready result is necessary for a paid launch and does not replace legal or
operator approval.
