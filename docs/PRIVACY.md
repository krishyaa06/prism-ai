# Prism Privacy Notice — Draft for Review

**Status:** India-focused draft for review; not legal advice and not ready as a
final public privacy notice. Verify the operator's legal identity, actual
vendors, hosting regions, retention settings, grievance contact, and
applicable Indian requirements with qualified counsel before launch. Last
updated: 28 October 2026.

## Who operates Prism

The project brand supplied by the maintainer is **PRISM PROTOCOL**. The
maintainer supplied **prismprotocol.support@gmail.com** as a contact address.
The legal operator's full name, entity type, registration status, and service
address have not been independently verified and must be completed before
public launch. This draft does not claim that PRISM PROTOCOL is incorporated
or registered.

## Data Prism may process

Depending on the features a person chooses to use, Prism may process:

- Account email, authentication/session data, and account role through Supabase
  Auth.
- A one-time-shown Android API token. The server stores its SHA-256 hash,
  display prefix, creation time, last use, expiry, and revocation state.
- Task prompts, generated plans/actions, screenshots, and bounded Android
  Accessibility text when the person selects Prism Cloud and confirms a task.
  Async queue payloads are processed by the Prism worker; the configured
  model provider receives the prompt and screenshot for inference.
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

The async queue is configured to expire jobs after up to 30 minutes. Prompt
and screenshot fields are cleared when a job reaches a terminal state; job
status metadata may remain for up to seven days before the worker's cleanup
pass. This is an application-level target, not a guarantee of immediate
deletion from provider logs, backups, or the model provider. Memories are
retained until the person deletes them or their account. Account data remains
while an account is active. Vendor-specific log and backup retention must be
checked in the actual deployment settings before launch.

## Children and sensitive data

Prism can see and act on a device screen. It is not designed for unsupervised
use by children. Do not enter passwords, payment-card details, health records,
private messages, or other sensitive information unless you understand and
accept the selected local/cloud processing path. Legal age, parental consent,
and children's privacy requirements differ by jurisdiction; public signup must
be configured only after legal review.

## Changes and contact

This draft will need updating when the model host, connectors, or retention
settings change. The India-specific legal basis, grievance process, and
applicable user-rights workflow remain to be confirmed with counsel. Privacy
questions or deletion requests:
**prismprotocol.support@gmail.com**.
