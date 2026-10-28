# Prism Security Policy

## Reporting a vulnerability

Please report security issues privately to **prismprotocol.support@gmail.com**.
Include a description, affected version/route, safe reproduction steps, and
impact. Do not include real user data, passwords, API tokens, or screenshots
containing private information. Do not publicly disclose an unpatched issue.

The project maintainer will acknowledge reports when able, assess impact,
coordinate a fix, and publish an advisory when appropriate. This is a
best-effort process, not a guaranteed response SLA or bug-bounty program.

## Deployment requirements

- Keep Supabase service-role and model-host credentials in server-only secret
  stores. Never expose them to client bundles, Android, or Git.
- Require HTTPS for production endpoints; rotate exposed credentials.
- Apply Supabase migrations and verify RLS and service-role boundaries.
- Limit connector scopes, operator-approved MCP server endpoints, task
  duration, request size, and per-user rate. Only deployment-configured
  connectors are available; the repository does not contain a ready-to-use
  150+ connector catalog.
- Do not execute model-produced shell, JavaScript, SQL, or arbitrary code.
- The Docker worker runs model inference and queue processing with a non-root
  account and reduced container privileges. It is not an arbitrary
  code-execution sandbox and must not run model-generated shell or code.
- The local PowerShell worker launcher stores no secret file, but secrets are
  present in that local process environment while the worker is running.
- Monitor vendor access logs and define retention before accepting real data.

## Current limitation

The worker and its container hardening have not been deployed or verified in a
production environment. Do not describe the service as a secure sandbox for
arbitrary code. A worker host, secrets, access controls, and a deployment
smoke test are still required.
