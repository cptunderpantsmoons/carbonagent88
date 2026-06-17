# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue
in Carbon Agent, please follow responsible disclosure practices.

### How to Report

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Email security concerns to: **security@corporatecarbon.example**
3. Include a detailed description of the vulnerability, steps to reproduce,
   and potential impact.
4. If applicable, provide a proof-of-concept.

### Response Timeline

- **Acknowledgement**: Within 48 hours of receiving the report.
- **Initial Assessment**: Within 5 business days.
- **Fix Release**: Critical vulnerabilities will be patched in the next
  release cycle (typically within 1-2 weeks).
- **Disclosure**: After a fix is released, we will publish a security advisory
  on GitHub Advisories and credit the reporter (unless they prefer to remain
  anonymous).

### Scope

The following are in scope:
- Electron main process security (IPC, context isolation, sandboxing)
- Credential storage and encryption (AES-256-GCM, safeStorage)
- SQL injection or other database vulnerabilities
- Authentication and authorization bypass (RBAC, multi-tenancy)
- Browser orchestration security (Playwright, SSRF, prompt injection)
- Supply chain vulnerabilities in dependencies

The following are **out of scope**:
- Vulnerabilities in third-party dependencies not bundled in Carbon Agent
- Issues that require physical access to an unlocked machine
- Self-XSS or issues requiring the user to paste malicious content into their
  own workspace

## Security Measures

Carbon Agent implements the following security measures:

- **Context Isolation**: Renderer process is sandboxed with `contextIsolation: true`
- **No Node Integration**: `nodeIntegration: false` in all renderer windows
- **CSP**: Content Security Policy enforces `default-src 'self'`
- **Credential Encryption**: API keys encrypted at rest with AES-256-GCM
- **OS Keychain**: `safeStorage` used on macOS, Windows, and Linux (libsecret)
- **Strict Peer Dependencies**: Enforced via pnpm configuration
- **Dependency Auditing**: `pnpm audit` runs in CI on every push
- **Code Signing**: All release artifacts are code-signed (platform-dependent)
- **Notarization**: macOS builds are notarized with Apple (when credentials available)
- **Update Signature Verification**: Windows builds verify update code signatures
- **Tightened Entitlements**: macOS entitlements limited to minimum required

## Hardening Checklist

- [x] Context isolation enabled
- [x] Node integration disabled
- [x] CSP enforced
- [x] Credentials encrypted at rest
- [x] Strict peer dependencies
- [x] CI security audit (pnpm audit)
- [x] Dependabot for dependency updates
- [x] CODEOWNERS for review enforcement
- [x] Code signing configuration
- [x] macOS notarization script
- [x] Update signature verification (Windows)
- [x] Tightened macOS entitlements
- [x] SQLite backup strategy for data resilience
- [x] User consent for auto-updates