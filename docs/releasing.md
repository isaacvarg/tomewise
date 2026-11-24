# Releasing

A release publishes the `tomewise` package to npm and the container image to `ghcr.io/isaacvarg/tomewise`. Pushing a `v*` tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml): it checks that the tag matches the version in `cli/package.json`, runs the typecheck and tests, then publishes both.

## One-time setup

### npm account

1. Sign up at [npmjs.com/signup](https://www.npmjs.com/signup) and verify your email.
2. Turn on two-factor authentication: avatar → **Account** → **Two-Factor Authentication**. Use an authenticator app or a security key. npm requires 2FA to publish.

### First publish, by hand

npm only lets you set up trusted publishing for a package that already exists, so the first version goes up from your machine:

```sh
npm login
pnpm build
npm publish ./build/tomewise --access public
```

`npm login` opens the browser to sign in. `npm publish` asks for a 2FA code. Check the result at [npmjs.com/package/tomewise](https://www.npmjs.com/package/tomewise).

### Trusted publishing

After that, GitHub Actions publishes with OIDC: no npm token is stored in the repository.

1. On npmjs.com, open the `tomewise` package → **Settings** → **Trusted Publisher** → **GitHub Actions**.
2. Fill in organization or user `isaacvarg`, repository `tomewise`, workflow filename `release.yml`, environment `npm`. Under **Allowed actions**, check **Allow `npm publish`**: without it the connection only allows `npm stage publish`, and the workflow runs `npm publish`. Leave **Allow `npm dist-tag`** unchecked. These fields can't be changed once the connection is saved.
3. Save. On the same page, under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, so only the workflow and you (with 2FA) can publish.
4. On GitHub, create the `npm` environment: repository **Settings** → **Environments** → **New environment** → `npm`. Add yourself under **Required reviewers** if each npm publish should wait for your approval.

Trusted publishing also attaches a provenance statement, so the npm page links each version to the commit and workflow run that built it.

### Container image

Nothing to set up: the workflow pushes with the repository's `GITHUB_TOKEN`. After the first push, make the package public once: GitHub profile → **Packages** → `tomewise` → **Package settings** → **Change visibility** → **Public**. Also check that it is linked to the `tomewise` repository.

## Each release

1. Bump `version` in `cli/package.json` and commit, e.g. `chore: release 0.2.0`.
2. Tag and push:

   ```sh
   git tag v0.2.0
   git push origin main v0.2.0
   ```

3. Watch the **Release** run under the repository's **Actions** tab.

The first release (`v0.1.0`) was published by hand, so the workflow's npm job fails for that tag with "cannot publish over the previously published version". Its image job still pushes the image. Tag `v0.1.0` only after the manual publish, or start the workflow at `v0.1.1`.
