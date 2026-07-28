# Yoda Extensions

## Product Boundary

Yoda Marketplace is a top-level product surface alongside Library. It is the
product-level extension catalog and is separate from `src/main/core/plugins/`,
which manages Claude Code plugins inside Library.

The extension contract is defined in `src/shared/extensions.ts`. Supported
extension kinds are:

- `background-service`
- `provider-adapter`
- `workflow`
- `ui`

The first shipped extension is `lovstudio.maas-gateway`, an optional
`background-service` extension. The built-in catalog is the initial catalog
source; future signed third-party catalog sources should feed the same manifest
and installation model rather than adding parallel lifecycle code.

## Ownership

- `src/main/core/extensions/catalog.ts` — catalog entries and manifests
- `src/main/core/extensions/extension-marketplace-service.ts` — install,
  enable, disable, uninstall, and Yoda-start lifecycle
- `src/main/core/extensions/extension-state-store.ts` — installation state
- `src/main/core/extensions/controller.ts` — typed Marketplace RPC
- `src/renderer/features/extensions/` — Marketplace UI
- `src/main/core/extensions/maas-gateway/` — Gateway utility process and proxy

Marketplace owns distribution and lifecycle. Core domains retain authority for
privileged product state:

- MaaS owns provider credentials in the encrypted application secret store.
- Codex MaaS owns reversible user-level `config.toml` changes.
- The extension receives only capabilities granted from its manifest.
- Disabling or uninstalling the MaaS Gateway restores active MaaS Client
  bindings before stopping the service.

## Background-Service Lifecycle

Enabled services with `service.autoStart` start during Yoda initialization and
stop during app shutdown. They are supervised by a domain runtime using
Electron `utilityProcess`; extensions do not run inside the renderer or main
process.

The current autostart capability is `autostart.yoda`: start with Yoda, not an
OS login item. Keep that distinction explicit in UI and manifests.

## MaaS Gateway Security Model

The Gateway binds to `127.0.0.1` on a random port and requires a random local
admission token. `/health` is the only unauthenticated route.

The upstream API key:

1. remains in Yoda's encrypted secret store at rest;
2. crosses only main-to-utility-process IPC when a provider is activated;
3. is held in Gateway memory;
4. replaces incoming client authentication immediately before the upstream
   request; and
5. never enters Codex `auth.json`, a shell file, or a process-global
   environment variable.

Codex's user-level provider config contains the loopback URL and local admission
token. Treat that token as local access control, not as the upstream secret.

## Adding A Background-Service Extension

1. Add a manifest and capability declaration to a catalog source.
2. Implement a `BackgroundServiceRuntime`.
3. Register the runtime by extension ID in `ExtensionMarketplaceService`.
4. Add typed RPC only for user-visible lifecycle operations.
5. Add capability, lifecycle, crash, and domain-integration tests.
6. Add the worker as an Electron Vite main-process entry when it runs in a
   utility process.

Never let an extension read the encrypted secret store or edit Client config
directly. Pass the minimum derived configuration from the owning core service.
