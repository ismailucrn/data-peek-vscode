# Security Policy

## Supported versions

Security fixes are applied to the latest published version of Data Peek.

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| Earlier | No |

## Reporting a vulnerability

Please report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/ismailucrn/data-peek-vscode/security/advisories/new). Do not include exploit details or sensitive datasets in a public issue.

Include the affected file format, extension version, reproduction steps, expected impact, and a minimal sanitized fixture when possible. Reports will be acknowledged within seven days. Fix timing depends on severity and reproducibility.

Data Peek treats local files as untrusted input, uses a restrictive webview Content Security Policy, and applies explicit preview and decompression limits. Reports that bypass these controls are especially valuable.
