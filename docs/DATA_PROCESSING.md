# Prism Data Processing Addendum — Draft

India-focused template draft only; it is not legal advice and is not an
executed agreement. Confirm the legal operator, party roles, subprocessors,
retention, and statutory requirements with qualified Indian counsel before
offering Prism to customers or processing their personal data.

## Parties and roles

The customer determines the purposes and means of processing data submitted
through their account. The PRISM PROTOCOL operator's legal identity and role
must be completed in this document. The operator may act as a processor or
independent data fiduciary/controller depending on the specific processing and
applicable law. Supabase, Vercel, and the customer-selected model host may act
as subprocessors or independent providers. Verify the actual roles and
subprocessor list before launch.

## Processing scope

Processing may include account identifiers, task prompts, images of device
screens, Accessibility text, connector outputs, optional memory, and support
requests. Processing is limited to authentication, inference, user-requested
workflow execution, security, and support.

## Instructions and confidentiality

The operator will configure the gateway to process cloud task data only after
the user's task-level cloud confirmation. Authorized personnel should have
access only when needed for security, support, or legal compliance and must
protect credentials and data.

## Security and incidents

The operator will maintain reasonable safeguards appropriate to the
deployment, including HTTPS, server-side secrets, token hashing, access
controls, rate limiting, and least-privilege connector scopes. Incident
response, customer notices, and statutory timelines must be finalized with
counsel and the selected hosting vendors.

## Retention, deletion, and transfers

The application queue expires jobs after up to 30 minutes, clears prompts and
screenshots at terminal completion, and retains job metadata for up to seven
days before cleanup. This does not guarantee deletion from provider logs,
backups, or the model host. Memories persist until user deletion or account
deletion. Backup deletion, subprocessors, data locations, international
transfers, and data-principal request handling must be verified from production
settings and documented. Account deletion must be tested end-to-end before
public launch.
