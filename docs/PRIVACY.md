# Prism Privacy Notice — Draft for Review

**Status:** Draft, not legal advice. This notice must be checked against the
actual production deployment, vendors, retention settings, and applicable law
before public launch. Last updated: 27 October 2026.

## Who operates Prism

Prism Protocol is currently an unregistered, individually maintained project;
it is not a company or registered legal entity. Contact for this project:
**prismprotocol.support@gmail.com**. Do not use this draft as proof of
incorporation, regulatory approval, or a registered business address.

## Data Prism may process

Depending on the features a person chooses to use, Prism may process:

- Account email, authentication/session data, and account role through Supabase
  Auth.
- A one-time-shown Android API token. The server stores its SHA-256 hash,
  display prefix, creation time, last use, expiry, and revocation state.
- Task prompts, generated plans/actions, screenshots, and bounded Android
  Accessibility text when the person selects Prism Cloud and confirms a task.
- Android contact, calendar, notification, and selected text-file data only
  when the person uses the corresponding device feature and grants applicable
  Android permission or document access.
- Optional persistent memories only after the person checks the memory opt-in
  for a task. Memories can contain the task text and completion summary.
- Basic request/rate-limit metadata needed to authenticate and protect the API.
  Vercel, Supabase, and the selected model host may retain their own operational
  logs under their separately configured policies.

## Where data goes

- **Local AI mode:** model inference and task context stay on the Android
  device. Local memories stay in the app's private storage.
- **Prism Cloud mode:** after an explicit per-task confirmation, the app sends
  task prompts, screenshots, visible UI text, and relevant tool output to the
  Prism Vercel gateway and the operator-configured model endpoint.
- Supabase processes accounts, token hashes, rate limits, and opted-in cloud
  memories. Vercel processes the web application and gateway requests.
- The operator chooses and configures the model-serving host. That host may
  receive personal or sensitive content contained in a prompt, screen,
  notification, contact, calendar, or selected file.
- Browser navigation, calendar synchronization, notification replies, and
  Android system apps can separately disclose data to their own providers.

The precise hosting regions, subprocessors, international transfers, and
vendor retention periods depend on the production accounts and settings and
must be published before launch. The project does not claim that cloud mode is
private from the operator-selected model host.

## Purposes and controls

Data is used to authenticate accounts, route a confirmed task to the selected
model, carry out Android-approved actions, provide optional memory, and protect
the gateway against abuse. The person can:

- Use local mode instead of sending a task to the cloud.
- Cancel a cloud task before confirming transmission.
- Decline optional memory, review/delete cloud memories in the dashboard, or
  clear local memories by clearing the app's data.
- Revoke an API token in the dashboard.
- Delete an account by contacting the project email; account deletion must also
  remove that account's profile, tokens, rate-limit data, and memories.

The production account-deletion flow and vendor backup deletion timelines must
be verified before public launch.

## Security and retention

Android API tokens are encrypted at rest using Android Keystore. Cloud token
values are shown once and only hashes are stored by the application database.
These controls reduce risk but do not protect a compromised device, deployment,
database, or model host. Task screenshots are sent only in cloud mode after
confirmation, but cloud inference providers and infrastructure may process
them transiently.

Account data is retained while an account is active. API tokens are retained
until revoked or account deletion. Memories are retained until the person
deletes them or deletes their account. Request data/log retention must be set
and verified with each deployment vendor before launch.

## Children and sensitive data

Prism can see and act on a device screen. It is not designed for unsupervised
use by children. Do not enter passwords, payment-card details, health records,
private messages, or other sensitive information unless you understand and
accept the selected local/cloud processing path. Legal age, parental consent,
and children's privacy requirements differ by jurisdiction; public signup must
be configured only after legal review.

## Changes and contact

This draft will need updating when the model host, connectors, or retention
settings change. Privacy questions or deletion requests:
**prismprotocol.support@gmail.com**.
