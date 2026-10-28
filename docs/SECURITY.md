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
- Limit connector scopes, allowed server endpoints, task duration, request
  size, and per-user rate.
- Do not execute model-produced shell, JavaScript, SQL, or arbitrary code.
- Use a separate hardened worker/sandbox for untrusted code or long-running
  tasks; Vercel API functions are not a general-purpose sandbox.
- Monitor vendor access logs and define retention before accepting real data.

## Current limitation

This repository's model gateway does not itself provide a production
container-isolation boundary for arbitrary code. Do not expose code execution
or arbitrary connector endpoints as if sandboxed until a separately reviewed
worker is deployed and tested.
