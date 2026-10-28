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

## Feature readiness (28 October 2026)

- **Model orchestration:** planner, executor, research, and review roles are
  supported. Role-specific model endpoints, names, and API keys are optional;
  unset roles fall back to the shared model configuration.
- **Parallel sub-agents:** planning runs read-only research and safety-review
  calls in parallel. They do not operate the phone or independently execute
  tasks.
- **Connectors:** the dashboard supports deployment-approved Streamable HTTP
  MCP servers configured by the operator. This repository does **not** ship a
  150+ ready-to-connect catalog. Connector authentication and service
  permissions must be configured and tested per service.
- **Worker isolation:** Docker Compose applies container hardening to the
  asynchronous inference worker. It is not a general-purpose sandbox for
  executing arbitrary model-generated code.
- **Asynchronous jobs:** queue, retry, cancellation, and cleanup logic are
  implemented. Live cloud jobs still require a continuously running worker
  and a configured model provider.
- **Persistent memory:** local and cloud memory paths require explicit
  opt-in; cloud memories can be reviewed and deleted in the dashboard.

The web dashboard and Android app share Prism's logo and a dark-first,
Material-inspired palette with a light/dark theme option. The layout is an
original Prism design informed by task-focused AI workspaces; it does not copy
Perplexity or ChatGPT branding, source, or assets.

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

### Start the local web console

Create `web/.env.local` with the public Supabase project URL and publishable
key. From PowerShell, run `powershell.exe -NoProfile -ExecutionPolicy Bypass
-File ".\start-local.ps1"` in the `web` directory. The launcher prompts for
the Supabase service-role key and OpenRouter API key without writing them to a
file, then starts the local dashboard with the OpenRouter endpoint and model
defaults. Keep this terminal open while using the console. Async Android cloud
tasks also need the separate `web/worker/start-local.ps1` process running.
The dashboard's admin-only **Test model connection** button makes a short text
request to the configured provider; a successful text test does not by itself
verify image input or the Android queue/worker path.

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

### Run the worker on Windows without Docker

Install Node.js 22+, then from PowerShell run:

```powershell
.\start-local.ps1
```

The script prompts for the Supabase project URL, shared model settings, and
optional planner/executor/research/review model settings. Service-role and
model-provider keys are entered as secure prompts and are not written to a
`.env` file. They exist in the worker process environment while it runs. Keep
the computer awake and the process running; closing PowerShell, sleeping the
PC, or losing connectivity pauses cloud tasks. This is a development/temporary
option, not an always-on production deployment. If Windows blocks script
execution, run it in a process-scoped policy bypass:

```powershell
powershell.exe -ExecutionPolicy Bypass -File ".\start-local.ps1"
```

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