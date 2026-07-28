# ADR 0005: Make Yoda Build project-native

## Status

Accepted on 2026-07-27.

## Context

Yoda Build started as an AI Lab single-file HTML generator. Later iterations wrapped that generator
in a normal Yoda task and created a dedicated project for each App, but the core artifact contract
still required the Agent to print HTML into its conversation. The main process parsed the transcript,
copied the HTML into both `apps.json` and `index.html`, and launched it through `iframe.srcDoc`.

That model prevented normal file editing, React component reuse, dependency management, native hot
module replacement, and reliable build verification. It also made the App registry and project
directory competing sources of truth.

## Decision

New Yoda Build Apps are project-native React applications:

- every App starts from a versioned React, Vite, TypeScript, Tailwind CSS, and shadcn-style scaffold;
- the selected Yoda Agent runs as a normal task in the dedicated App project and edits files directly;
- `.yoda/app.json` is the App manifest and declares display metadata, template version, readiness,
  and requested host capabilities;
- an App becomes launchable only after the Agent marks the manifest ready and produces a fresh
  `dist/index.html` through the project check command;
- the App registry stores launch metadata and project identity, not a second copy of project source;
- project Apps run from a Yoda-managed loopback Vite server, so file edits use normal HMR;
- the preview iframe keeps a distinct loopback origin and exposes only manifest-declared Yoda
  capabilities through the existing message bridge;
- “Improve App” creates another normal Agent task in the same project instead of invoking a
  one-shot CLI generator.

Existing single-file Apps remain launchable as `legacy-html`. Their first improvement copies the old
source to `legacy/index.html`, adds the React scaffold, and asks the Agent to migrate the behavior.

## Consequences

- Agent output is concise task reporting; source code lives in Git files.
- React components, packages, checks, diffs, terminals, and normal Yoda Agent observability become
  available to every App.
- Yoda Build is no longer restricted to runtimes whose transcripts have custom parsers.
- Starting a project App requires `pnpm` and installed dependencies. A failed preview reports the
  actual process error and links remain available to the App project and latest Build task.
- Loopback previews permit Vite module loading and HMR, so they use `allow-same-origin`; they remain
  isolated from the Yoda renderer because the origins differ and no host credentials are injected.
- The first version is a general web App builder. Additional runtime templates and broader AI
  capability routing can be added without returning to transcript-generated artifacts.
