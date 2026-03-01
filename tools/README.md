# Tools

This directory is for maintainer and operator utilities.

These files are intentionally different from normal Tooty CMS runtime code:

- they are not part of the CMS request/runtime path
- they are not part of the public extension contract
- they are not required for a normal Tooty install
- they support repository operations, packaging, and local maintainer workflows

## `bundle-site.zsh`

`bundle-site.zsh` is a private deploy assembly utility.

Its purpose is to create a self-contained deployable site bundle from:
- the current `tooty-cms` working tree
- selected themes discovered through `THEMES_PATH`

This is useful when:
- core is maintained in one shared repo
- private themes live outside the public repo
- a Vercel deploy repo still needs all required files present at build time

What it is **not**:
- a CMS runtime feature
- a site bootstrap feature
- a public API/contract surface

It is an ops/packaging tool for advanced maintainers.

Example:

```bash
zsh ./tools/bundle-site.zsh --target ../tootyCMS-sites/sitename --theme my-special-theme
```

If you keep this tool, treat the output bundle as a deployment artifact or private deploy repo, not as a second source of truth for core.

## Browserslist DB Maintenance

When `next build` warns that the Browserslist data is old, use the dedicated maintenance command:

```bash
npm run maintenance:browserslist-db
```

This command checks the installed `caniuse-lite` publish date against the npm registry.

- If the installed data is older than 30 days, it runs:
  - `npx update-browserslist-db@latest`
- If it is 30 days old or newer, it exits without changing anything.

This is intentionally a maintainer command, not part of runtime or CI, so dependency metadata is not mutated implicitly during tests or builds.

## Private Site Repo Setup (Fresh Install)

This is the recommended operator setup when you want one shared Tooty core and separate private site repos for deploy assets.

Use this from the start when:
- `tooty-cms` is the only runnable application repo
- site-specific themes/assets must stay private
- Vercel deploys still need a self-contained site repo

### Goal

Start with:
- one shared core repo: `tooty-cms`
- one private site repo per branded site

The private site repo should contain only site-specific assets such as:
- `public/`
- `styles/`
- `docs/`
- private theme files
- deploy metadata

It should not contain a second copy of Tooty core.

Result:
- one source of truth for app logic
- one private asset/deploy repo per site
- no drift across multiple app forks

### Optional `deploy/.git` Layout

For some private site repos, it can be useful to keep Git metadata under `deploy/.git` while the parent directory remains the working tree.

That layout works like this:

- root `.git` is a text pointer file:
  - `gitdir: deploy/.git`
- `deploy/.git/config` sets:
  - `core.worktree = <parent repo path>`

This is a valid Git setup, but it is non-standard.

Use it only if you intentionally want:
- deploy metadata isolated under `deploy/`
- the parent directory to remain the working tree

### Fresh Install Workflow

1. Create and run the site from `tooty-cms`.
2. Create a separate private repo for the site.
3. Put only the site's private assets in that repo:
   - theme files
   - branded images
   - reference copy/docs
   - deploy-only metadata
4. Keep all app logic changes in `tooty-cms`.
5. Build or package deploy artifacts from shared core plus the private site repo.

Example private site repo shape:

```text
site-private-repo/
  .git
  deploy/
  docs/
  public/
  styles/
  themes/
    <private-theme-id>/
```

### Converting an Existing Legacy Site Repo

If a legacy site repo already contains an old app copy:

- keep only the site-specific asset folders
- remove:
  - `app/`
  - `components/`
  - `lib/`
  - `tests/`
  - `node_modules/`
  - old build/config files

After conversion, treat it the same as a fresh private site repo.

### Important Rule

If a change is needed in auth, routing, schema, admin behavior, or rendering contracts:

- change `tooty-cms`
- validate there
- then re-apply/package into the private site deploy flow

Do not let the reduced site repo become a second source of truth for application logic.
