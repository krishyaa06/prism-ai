# Prism Connector Plan

## Current implementation

Prism currently supports operator-approved Streamable HTTP MCP servers. The
operator configures server IDs, names, descriptions, and HTTPS endpoints in
`PRISM_MCP_CONNECTORS`. A user can save one bearer credential per configured
server. Credentials are encrypted in Supabase using
`PRISM_CONNECTOR_ENCRYPTION_KEY`.

This is a connector framework, not a preconfigured integration catalog. No
provider in the list below should be considered connected or tested until its
official MCP endpoint, authentication flow, minimum scopes, and actual tool
calls have been verified. OAuth authorization-code flows and automatic token
refresh are not currently implemented; many providers require them, so a
bearer-token field alone is not enough to support those services safely.

The current task context loads tools from at most 16 connected MCP servers,
with a per-server tool limit. Connector results are untrusted input. Users
must review any action that changes data or sends a message.

## Requested first-phase services

The first verified remote endpoint in the requested list is GitHub's official
remote MCP server at `https://api.githubcopilot.com/mcp/`. The project can
connect to it using a fine-grained GitHub personal access token entered in the
dashboard; the token is encrypted server-side. The token must never be pasted
into chat or committed to configuration. Review GitHub's current scopes and
grant only the repositories and permissions the user needs.

The other requested services are roadmap items, not configured connectors:

1. Google Drive
2. Google Calendar
3. Gmail
4. Notion
5. Slack
6. Discord
7. Dropbox
8. Microsoft OneDrive
9. Microsoft Outlook
10. Telegram

The maintainer selected 11 services for the initial roadmap. Each integration
must be implemented and tested individually; don't promise 150+ live
connectors until they exist and have passed authorization and tool-call tests.

The current deployment must also set `PRISM_CONNECTOR_ENCRYPTION_KEY` to a
private base64-encoded random 32-byte value before users can save connector
credentials. Generate a value locally with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Add it directly to the server's secret environment settings. Never commit it or
send it in chat.

To expose GitHub in the connector dashboard, set `PRISM_MCP_CONNECTORS` to a
JSON array containing the GitHub definition shown in `web/.env.example`. The
dashboard will then let the account owner authorize that server. This config
only registers the trusted endpoint; it does not authenticate a user or make
the connector operational until authorization and a safe tool-call test pass.

The GitHub endpoint comes from the official
[GitHub MCP Server documentation](https://github.com/github/github-mcp-server).

## Connector acceptance checklist

- Verify an official, maintained remote MCP endpoint or operate a reviewed
  server under the project owner's control.
- Document exactly which data is sent and what scopes are required.
- Use an explicit user authorization flow; do not ask users to paste provider
  passwords or broad account secrets into Prism.
- Enforce same-origin requests, HTTPS, redirect blocking, timeouts, response
  limits, and least privilege.
- Test listing tools, safe read-only use, denied/expired authorization, revoke,
  deletion, and provider error handling.
- Add the provider to the dashboard only after the above checks pass.
