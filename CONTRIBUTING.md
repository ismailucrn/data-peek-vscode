# Contributing to Data Peek

Data Peek is a read-only VS Code data previewer. Changes must preserve its bounded-memory and untrusted-input protections.

## Local setup

Prerequisites:

- Node.js 20
- pnpm 11.9.0
- VS Code 1.100 or newer

Install and verify the project:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run package
```

Use `pnpm run watch`, press `F5` in VS Code, and open a supported data file with **Open with Data Peek** for manual testing.

## Change guidelines

- Work on a feature branch and keep commits focused.
- Add tests for reader, profiling, normalization, and safety-limit changes.
- Treat file content and webview messages as untrusted input.
- Render data with safe text DOM APIs and preserve the restrictive Content Security Policy.
- Do not write to or silently transform the source dataset.
- Run `pnpm run package` before opening a pull request.

Pull requests should describe the user impact, relevant safety considerations, and the checks performed.

