# Prism Phone Agent

An Android phone agent with on-device `llama.cpp` vision inference and optional
Prism Cloud inference through a separately deployed web gateway and worker.
MediaProjection provides screenshots; Android Accessibility dispatches
approved phone actions.

> **Current state:** supervised software, not unrestricted or production-ready
> phone control. The agent proposes a plan for approval, runs a bounded action
> loop, and must obey Android permissions and system restrictions. Cloud model
> service operation requires separately configured Supabase, model, and worker
> deployments.

## Requirements

- Android Studio with Android SDK 34 and NDK/CMake support
- JDK 17
- Android 10+ device (ARM64 recommended)

The app targets SDK 34 and uses a MediaProjection foreground service. It is
not yet ready for Play Store distribution; validate Android builds, device
behavior, permissions, and current Play policy before publishing.

## Build and run

1. Open this folder in Android Studio and allow Gradle sync.
2. Connect an Android 10+ device and run the `app` configuration.
3. In the app, enable its Accessibility Service in Android settings.
4. Grant screen-capture permission when prompted.
5. Select the local model or configured Prism Cloud, enter a task, inspect and
   approve the proposed plan, then supervise the phone actions.

You can stop a running action from the app. Accessibility and screen-capture
permissions are powerful: the service can read visible UI text and dispatch
gestures. Disable the service in Android settings when you are done testing.

## Local model status

`LlamaBridge.kt` and `native-lib.cpp` provide the JNI inference bridge to the
pinned `llama.cpp` native build. Import a compatible GGUF model and its matching
multimodal projector in the app. `models/setup_model.sh` can download the
documented model pair on Bash-compatible systems. Native builds require the
Android NDK, CMake, and network access to fetch the pinned source.

## Async cloud inference lifecycle

The cloud API stores each model inference request in the Supabase `agent_jobs`
queue. A separate Docker worker claims jobs with row locks, renews a per-claim
lease, and stores the result for the authenticated Android client to poll.
Repeated submissions can use the `Idempotency-Key` UUID header to avoid
creating duplicate jobs.

The worker retries network failures, timeouts, HTTP 408/429, and HTTP 5xx
responses with bounded exponential delay, up to five attempts. Invalid model
configuration and other non-transient HTTP errors fail without retry. Queue
admission is limited to eight active jobs per API token. Queue
jobs expire after 30 minutes; completed, failed, and canceled job rows are
deleted after seven days by the worker's maintenance pass. Prompt and
screenshot data are cleared on terminal completion, failure, cancellation, or
expiry.

Queued jobs can be canceled immediately. Running jobs accept a cancellation
request and the worker aborts its model request at the next lease heartbeat
(10 seconds by default). The Android app also requests cancellation when the
user stops a task or the five-minute inference poll times out.

An Android task interrupted by process/activity loss is **not continued while
the phone is disconnected**. On a later app launch, Prism offers to discard or
resume it. Resume cancels the previous inference where possible, captures the
current screen, generates a fresh plan, and requires approval again; it never
replays a pending phone action. Accessibility and screen-capture permissions
must still be available.

To enable the queue, apply migrations
`web/supabase/migrations/202610270001_prism_auth_tokens.sql` through
`web/supabase/migrations/202610270006_async_job_lifecycle.sql` in order, then
set the web gateway and worker's Supabase/model secrets. From `web/worker/`,
copy `.env.example` to `.env`, configure its values, and run:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
docker compose logs -f prism-worker
```

Keep `.env` private. Docker Compose validation and live Supabase/model
integration tests require a configured deployment.

## Project layout

```text
app/
  src/main/
    AndroidManifest.xml
    cpp/                 # pinned llama.cpp build and JNI vision bridge
    java/com/agent/ai/   # UI, accessibility, capture, and agent loop
    res/                 # UI, accessibility config, strings, theme
models/
  setup_model.sh         # Optional host-side GGUF download
web/
  src/app/               # dashboard and authenticated API routes
  src/lib/               # model, auth, connector, and Supabase helpers
  supabase/migrations/   # auth, memory, queue, connector, and job lifecycle
  worker/                # Dockerized asynchronous inference worker
```

Large downloaded model files are ignored by Git. Review the model's license and
usage terms before downloading or distributing it.                                                                                                                                                                                                                                                                                          