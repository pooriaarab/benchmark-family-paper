# check-reason-classes failure modes

Every way this check fails, written before the code.
`node scripts/exp/check-reason-classes.mjs` is the check itself; each
row says which guard catches it.

- `reason-classes.json` missing or unreadable: the `readFileSync` or
  `JSON.parse` throw aborts the run with a nonzero exit and the parse
  error on stderr; no output rows are trusted.
- `classMeanings` drift: a class is renamed, dropped, or a fifth one
  added. The check fails unless the key set is exactly format-gate,
  contract-violation, wrong-answer, abort.
- Rule shape drift: a rule that is not an object, or lacks a string
  `class` or `pattern`, fails the shape guard naming the package and
  the index.
- Uncompilable regex: `new RegExp` throws on a bad pattern; the check
  catches it and fails naming the package and pattern.
- Undeclared class: a rule whose `class` is not a `classMeanings` key
  (typo, new class added in the table but not declared) fails the
  class guard.
- Package coverage drift: `packages` must cover every package name in
  `versions.json` exactly once, with no extras and no empty rule
  lists. A pinned package added without a class table, or a table
  kept for a removed package, fails the coverage guard.
- Paths moved: the script resolves the repo root from its own path,
  so it only breaks if the JSON files move without the constants
  being updated; in that case the read throws as in the first row.
