# Community Submission Checklist

## Preconditions

- Repository is public on GitHub.
- Root contains `README.md`, `LICENSE`, `manifest.json`, `versions.json`.
- `manifest.json` `id` is unique and does not include `obsidian`.
- The plugin enumerates vault Markdown files only for the user-invoked `Format tables in all files` command; routine auto-formatting does not scan the vault.

## Release Steps

1. Update version in `manifest.json`.
2. Update matching key in `versions.json`.
3. Run `npm run build`.
4. Commit and push all changes.
5. Create a GitHub Release with tag exactly equal to `manifest.json` version.
6. Ensure release assets contain at least `main.js` and `manifest.json`.
7. Include `styles.css` if used.
8. Keep `versions.json` in the repository root for compatibility mapping, but do not attach it as a release asset.

## Submit

1. Open [Obsidian Community Plugins](https://community.obsidian.md/plugins/new)
2. Sign in and link GitHub account.
3. Submit your repository URL.
4. Address review feedback with a new version and new release.
