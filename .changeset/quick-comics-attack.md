---
"yoda": patch
---

fix(db): apply squashed-tail migrations when the applied count exceeds the bundled journal

When upgrading from a release whose migration journal was longer (the journal is
squashed/renumbered between releases), the count-based skip in
`runBundledMigrations` skipped every bundled migration, leaving the schema stale
and the app unable to start (e.g. "no such column: sort_order"). Fall back to
content hashes in that case and run only migrations whose SQL was never applied.
