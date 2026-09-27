# Vendored copy of IIF's congress-ptr parser (open decision #17 → pinned vendored copy)

Copied 2026-09-27 from the sibling project, read-only source:

```
../Investing Intelligence Foundation/plugins/congress-ptr/mcp/house_client.py    sha256 6ad9b6ed…
../Investing Intelligence Foundation/plugins/congress-ptr/mcp/senate_client.py   sha256 52382c2a…
../Investing Intelligence Foundation/plugins/congress-ptr/mcp/normalize.py       sha256 3495a79f…
../Investing Intelligence Foundation/plugins/congress-ptr/tests/*                (28 offline tests, all passing here)
```

Source file mtimes at copy time: house_client 2026-06-27, senate_client 2026-06-28, normalize
2026-06-27. Full hashes: run `sha256sum ingest/py/vendor/congress_ptr/*.py`.

Rules:

- **Never edit these files here.** Fixes go into IIF first; re-vendor by copying the three
  modules again and updating this note (date, hashes). `congress_ptr_job.py` adapts around
  them (UA env var, sys.path) rather than patching them.
- `senate_client.py` is vendored for its **pure parser only** (`parse_ptr_html`). Its I/O
  layer impersonates Chrome's TLS fingerprint to pass Senate eFD's Akamai bot check, which
  this project's scraping policy forbids (`ingest/src/lib/http.ts`, WORKING-METHODS), and
  GitHub-hosted runners are datacenter IPs that eFD rejects regardless. The job therefore
  runs the **House** path only until Peter decides the Senate route (docs/04 #21).
- `house_client._ua()` reads `CONGRESS_PTR_USER_AGENT`; the job sets it to the project's
  descriptive contact UA so every request to the House Clerk identifies spotthemoney.com.
- Tests: `cd ingest/py/vendor/congress_ptr && python3 -m pytest tests` (or the plain runner in
  `ingest/py/README.md` when pytest is not installed).
