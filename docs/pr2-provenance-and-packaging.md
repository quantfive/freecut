# PR2 provenance and reproducible packaging

This fork baseline is the mechanical deliverable for [CodePress issue #5319](https://github.com/quantfive/codepress/issues/5319), PR 2. It records the selected FreeCut source and makes a clean install, build, and package check repeatable. It does not add editor behavior, embed commands, CodePress integration, or the PR 3 adapter.

## Source of record

The selected upstream is [`walterlow/freecut`](https://github.com/walterlow/freecut), the repository named by issue #5319. The requested [`FreeCutEditor/freecut`](https://github.com/FreeCutEditor/freecut) path was not resolvable when the fork was created. The fork is [`quantfive/freecut`](https://github.com/quantfive/freecut).

The exact source revision is:

```text
4d62e8082c5eb387a96275bcbd323d28f6e41a62
```

`provenance/freecut-baseline.json` records the commit, Git tree, deterministic `git archive` checksum, fork URL, and the retained MIT license checksum. The source archive checksum is computed over:

```bash
SOURCE_DATE_EPOCH=0 git archive --format=tar \
  --prefix=freecut-4d62e8082c5eb387a96275bcbd323d28f6e41a62/ \
  4d62e8082c5eb387a96275bcbd323d28f6e41a62 | shasum -a 256
```

The existing `LICENSE`, `src/infrastructure/audio/THIRD_PARTY_LICENSE`, and Anime4K `NOTICE.md` are retained and copied into the package artifact's notices directory. The existing bundled Anime4K weights remain unchanged; their upstream attribution is preserved in that notice.

## Inventories

- `provenance/dependency-inventory.json` records every direct runtime and development dependency exactly as declared by `package.json`, plus the lockfile version and checksum. The lockfile is the install source of truth; this PR does not upgrade dependencies.
- `provenance/asset-inventory.json` records tracked public assets, source preview assets, and the bundled Anime4K model/notice directory by file count, byte count, and a canonical SHA-256 inventory hash.
- `provenance/freecut-baseline.json` lists the optional model identifiers and network services that are deliberately not package inputs.

The optional model code remains in the upstream source, but its weights/caches are not downloaded by the package command. The baseline also excludes the loopback headless `/v1` service, remote font/Lottie services, model/CDN endpoints, Remotion, and all CodePress backend/UI/command-contract work. These exclusions are documentation and packaging boundaries only; they do not change runtime behavior.

## Clean reproducible package

Use Node.js 22.14.0 and npm 11.8.0, matching the CI workflow:

```bash
npm install --global npm@11.8.0
npm ci --ignore-scripts
npm run verify:provenance
npm run package:reproducible
```

`package:reproducible` removes the ignored `dist/` output, runs the production build, verifies provenance/inventory checks, and writes `artifacts/freecut-<source-revision>.tar.gz`. The archive has sorted paths, normalized metadata, zero timestamps, and uid/gid 0. It contains the built `dist/`, package manifests, provenance manifests, the MIT license, and retained notices.

Run the command twice and compare the resulting archive with `cmp` to verify byte-for-byte reproducibility. CI performs that comparison on every pull request and push to `main` or `codepress-main`.
