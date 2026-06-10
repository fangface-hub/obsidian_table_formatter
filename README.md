# obsidian_table_formatter

An Obsidian plugin for formatting Markdown tables on save.

## Features

- Formats Markdown tables whenever a Markdown file is saved.
- Suppresses auto-format while editing in Live Preview mode.
- Lets you format manually with the ribbon button (table icon) or the command palette.
- Supports configurable table cell padding:
  - Fixed number of spaces (`0` or more)
  - Blank (auto mode: single-space minimal formatting)
- Supports configurable number of `-` characters in the delimiter row.

## Settings

Open: `Settings -> Community plugins -> Table Formatter`

- `Padding spaces`
  - Blank: `| cell |` style (single-space padding)
  - Integer (`>= 0`): exactly that many spaces around each cell
- `Table border dash count`
  - Blank: auto (based on content width, minimum `3`)
  - Integer (`>= 1`): fixed number of `-` in delimiter cells (no `:`)

## Development

```bash
npm install
npm run dev
```

Run lint:

```bash
npm run lint
```

Auto-fix lint issues:

```bash
npm run lint:fix
```

Build production bundle:

```bash
npm run build
```

Note: `npm run build` runs lint first via `esbuild.config.mjs`.

## Community Plugin Release

Use one of the following version bump scripts depending on the scope of changes:

- `npm run version:patch`
  - For backward-compatible fixes only (`x.y.z` -> `x.y.(z+1)`)
- `npm run version:minor`
  - For backward-compatible feature additions (`x.y.z` -> `x.(y+1).0`)
- `npm run version:major`
  - For breaking changes (`x.y.z` -> `(x+1).0.0`)

Each script updates `package.json`, `package-lock.json`, `manifest.json`, and `versions.json` together.

1. Commit and push to GitHub.
1. Create a GitHub Release with tag exactly matching `manifest.json` version.
1. Attach release assets: `main.js`, `manifest.json`, `styles.css` (optional), `versions.json` (recommended).
1. Submit the repository URL from [Obsidian Community Plugins](https://community.obsidian.md/plugins/new).

Notes:

- `manifest.json` in the default branch must be up to date before submission.
- Plugin `id` must be unique and must not contain `obsidian`.
