# CLAUDE.md

Guide for Claude Code in this repository: ioBroker adapter `solectrus-influxdb`. It writes ioBroker states to InfluxDB 2.x for [SOLECTRUS](https://github.com/solectrus/solectrus) and has an optional formula engine (Data-SOLECTRUS).

The maintainer writes in German. Answer in German.

## General instructions

- Minimize all code changes. Do not beautify code and do not perform optimizations unless technically required or explicitly requested.
- Do not use any commit remark (like `closes`, `fixes`, `resolves`, …) that causes issues to be closed automatically. Simply use `refers to #<issue>`. This applies to commit messages and PR descriptions.
- Always add a changelog entry to `README.md` below the header `### **WORK IN PROGRESS**` (see [Changelog](#changelog-work-in-progress)). Add the header if it does not exist yet. The entry describes the change in a short, user-oriented form, without technical details.
- Always check whether a PR is already merged before adding changes to an existing PR. If it is merged, create a new PR (new branch from the current `main`).

## Changelog (Work in Progress)

In `README.md`, section `## Changelog`, the newest block is:

```markdown
### **WORK IN PROGRESS**
* (patricknitsch) Short user-oriented description (refers to #123)
```

- Format: `* (patricknitsch) <text>`. Add new lines at the top of the block.
- Keep the commented placeholder `<!-- ### **WORK IN PROGRESS** -->` above it; the release script needs it.
- Do not touch `io-package.json` → `common.news`; `npm run release` creates it from the changelog.

## Checks before every push

Run from the repository root:

| Command | What it checks |
|---|---|
| `npm run test:js` | unit tests (`lib/**/*.test.js`, `main.test.js`, mocha + chai) |
| `npm run test:package` | `package.json` / `io-package.json` and the i18n files are valid |
| `npm test` | both of the above |
| `npm run lint` | ESLint + Prettier (tabs, see `prettier.config.mjs`) |
| `npm run check` | TypeScript check of the JS code (`checkJs`); errors in `*.test.js` (missing mocha types) are known, others are not allowed |
| `npm run test:integration` | starts the adapter in a test js-controller (slow, CI runs it) |

Admin UI (`src-admin/`, TypeScript + React): `cd src-admin && npx tsc --noEmit`. Its `npm run lint` is broken (no `eslint.config.mjs` there), so do not rely on it.

CI (`.github/workflows/test-and-release.yml`) runs check-and-lint and the adapter tests on Node 22/24/26 under Linux, macOS and Windows.

New behaviour needs a unit test next to the module (`lib/<module>.test.js`).

## Admin UI build

The custom components of the Sensors, Data Values and Backup tabs are built from `src-admin/` into `admin/custom/` (committed). After a change in `src-admin/src/**`:

```bash
cd src-admin && npm ci && npx tsc && npx vite build && cd ..
rm -rf admin/custom && npx tsx tasks.ts --3-copy && rm -rf src-admin/build
```

- Use `npm ci`, not `npm install`: `npm install` rewrites `src-admin/package-lock.json` and changes the build.
- Commit the whole `admin/custom/` (file names contain hashes, old ones are deleted).
- Requires ioBroker.admin ≥ 8 (GUI API generation 2).
- Changes only in `admin/i18n/*.json` need no rebuild; Admin loads the translations at runtime.

## Translations

- Admin texts: `admin/i18n/<lang>.json` for all 11 languages: `en de ru pt nl fr it es pl uk zh-cn`. Add every new key to all 11 files.
- The key is the English text or a camelCase id (e.g. `writeOnChangeLabel`). Append new keys at the end of the file, 4-space indent.
- Check that a key does not already exist before adding it; never change the text of an existing key in passing.
- `npm run translate` (translate-adapter) can fill missing languages.
- Adapter log messages and notifications: `lib/notificationMessages.js`.

## Documentation

- User documentation: `docs/de/README.md` and `docs/en/README.md`. Always change both.
- `README.md` holds the overview and the changelog.

## Sensors

- Default sensors are listed in `io-package.json` → `native.sensors`, in the order and folders of the HELIOS sensor overview (`SensorRegistry::GROUPS` in [solectrus/helios](https://github.com/solectrus/helios)).
- The folder of a default sensor comes from `SENSOR_GROUPS` in `lib/objectManager.js` and, identically, in `src-admin/src/SolectrusSensorsEditor.tsx`. Change both.
- A new default sensor only needs its entry in `io-package.json` (with `enabled: false` and its `group`). `addMissingDefaultSensors` adds it, disabled, to existing instances on start. Do not change `BASELINE_DEFAULT_SENSOR_NAMES`.
- Sensor names and `measurement:field` follow the `INFLUX_SENSOR_*` variables of SOLECTRUS (`.env.example` in solectrus/solectrus). Cars: `CAR_<ROLE>_<n>`, n = 1–5; car 1 → measurement `car`, cars 2–5 → `car_2` … `car_5`.
- Option `writeOnChange`: the value is written when the source state changes, with its `lc` as timestamp, instead of in the collect interval.

## Code map

| Path | Purpose |
|---|---|
| `main.js` | adapter class, start, state changes |
| `lib/sensorManager.js` | sensor states, source subscriptions, JSON sensors |
| `lib/collectFlush.js` | collect loop, buffer, write to InfluxDB |
| `lib/objectManager.js` | object tree, default sensors, folders, migrations |
| `lib/bufferManager.js` | persistent write buffer |
| `lib/data-solectrus/` | formula engine (tick runner, evaluator, state machine) |
| `lib/backupManager.js` | backups of the instance config |
| `src-admin/src/` | admin UI components (TSX) |
| `io-package.json` | adapter metadata, default config, default sensors |

## Git and PRs

- Branch from the current `main`. Never commit to `main` directly. Work on a feature branch (`feat/…`, `fix/…`, `chore/…`).
- When the work is done and all checks pass, push the branch and **open the PR automatically**, without asking first.
- PR title: short and fitting, **at most two words**, e.g. `Robust Login`, `Consumption Tracker`, `Blue Fix`.
- PR description: summary and test plan; use `Refers to #<issue>`, never a closing keyword.
- One topic per PR. Describe in the PR what changed, why, and how it was tested, including whether it was tested against the live API.
- Keep commit messages descriptive, in English, imperative mood.
- Push only after the checks above are green.
