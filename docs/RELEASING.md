# Releasing RaGo Lens

The APK is built by GitHub Actions (`.github/workflows/release.yml`) when you push a tag that starts with `v`.
Nothing about signing is stored in the repo: the keystore lives only in GitHub Secrets.

## 1. Create a signing keystore (once)

```bash
keytool -genkeypair -v \
  -keystore rago-lens-release.keystore \
  -alias ragolens \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep `rago-lens-release.keystore` and its passwords somewhere safe (a password manager). If you lose it you cannot
ship updates that install over the old APK. Never commit it (`*.keystore` is git-ignored).

## 2. Add the four repository secrets

Encode the keystore as a single line of base64:

```bash
# Linux
base64 -w 0 rago-lens-release.keystore > keystore.b64
# macOS
base64 -i rago-lens-release.keystore | tr -d '\n' > keystore.b64
```

In GitHub: **Settings -> Secrets and variables -> Actions -> New repository secret**

| Secret              | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| `KEYSTORE_BASE64`   | contents of `keystore.b64`                             |
| `KEYSTORE_PASSWORD` | the keystore password you typed in `keytool`           |
| `KEY_ALIAS`         | `ragolens` (or whatever you passed to `-alias`)        |
| `KEY_PASSWORD`      | the key password (same as the keystore one if you let `keytool` reuse it) |

Delete `keystore.b64` afterwards.

## 3. Cut a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow: fetch + SHA-256-verify the model, `npm ci`, lint, typecheck, test, `expo prebuild --platform android`,
`./gradlew assembleRelease`, `zipalign` + `apksigner sign` with your keystore, `apksigner verify`, then attaches
`rago-lens-vX.Y.Z.apk` to a GitHub Release. Download it on the phone and install it (allow "install unknown apps").

Bump `version` in `app/app.json` (and `android.versionCode`) before tagging so Android accepts the update.
