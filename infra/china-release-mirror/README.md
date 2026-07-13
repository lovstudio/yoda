# Yoda China Release Mirror

Yoda production releases can mirror GitHub Release assets to a China CDN so
users who cannot reliably reach GitHub can download installers and use the
auto-updater from the mirror.

## Current Mirror

- Public base URL: `https://cdn.cs-magic.cn/yoda`
- Object storage: Qiniu bucket `lovpen`
- S3-compatible endpoint: `https://s3-cn-east-1.qiniucs.com/lovpen`
- Region: `cn-east-1`

The release workflow uploads:

```text
yoda/
  v1-stable.yml
  v1-stable-mac.yml
  v1-stable-linux.yml
  v<version>/
    <installer files>
    <blockmap files>
    <update manifests>
  latest/
    <installer files>
    <blockmap files>
```

The root update manifests point to versioned `v<version>/...` URLs so
differential updater blockmap resolution remains stable.

Qiniu endpoints are uploaded through the official Node.js SDK resumable upload
API. The S3-compatible path is kept as a fallback for non-Qiniu mirrors, but it
is not used for the current CDN because large single PUT requests from GitHub
Actions can exceed Node's response header timeout.

## GitHub Environment

Configure these in the `release` environment for `lovstudio/yoda`.

Variables:

```text
YODA_CN_MIRROR_ENDPOINT=https://s3-cn-east-1.qiniucs.com/lovpen
YODA_CN_MIRROR_PUBLIC_BASE_URL=https://cdn.cs-magic.cn/yoda
YODA_CN_MIRROR_REGION=cn-east-1
YODA_CN_MIRROR_KEY_PREFIX=yoda
```

Secrets:

```text
YODA_CN_MIRROR_ACCESS_KEY_ID
YODA_CN_MIRROR_SECRET_ACCESS_KEY
```

The same public base URL is embedded into production builds as
`VITE_CN_UPDATE_FEED_BASE_URL`, enabling the in-app "China mirror" update
source.

## Local Probe

After a release, verify the mirror without using local proxy settings:

```bash
curl --noproxy '*' -I https://cdn.cs-magic.cn/yoda/v1-stable-mac.yml
curl --noproxy '*' -I https://cdn.cs-magic.cn/yoda/latest/yoda-arm64.dmg
```
