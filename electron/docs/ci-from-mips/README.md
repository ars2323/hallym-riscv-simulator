# CI of the MIPS edition (reference)

These are the Electron edition's workflows of the Hallym MIPS Simulator at tag
`v2.7.1` (`ars2323/hallym-mips-simulator@09a3066974602dcbeb78287428b342e401104a6a`),
copied unchanged.  They are **not active here** (GitHub runs only
`.github/workflows/`): they build the N-API addon, the NSIS installer and the
release, none of which the RISC-V edition has yet.

They are kept for their structure, which took two weeks to get right and is to
be reused as the RISC-V edition grows into it:

- `electron.yml` -- Windows build, unit and e2e tests against the *installed* app,
  the installer's pages, the upgrade job over the latest release; a tag run that
  builds nothing and publishes the installer its commit's run checked.
- `mutants.yml` -- the weekly full mutant pass, sharded, results as an artifact.
- `release-check.yml` -- the post-release check: download from the public address,
  hash, install on a clean runner, every e2e, every link, Latest.

The RISC-V edition's active workflow is `.github/workflows/electron.yml`
(Linux: type check, unit tests with the real engine, every e2e test).
