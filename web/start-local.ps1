$ErrorActionPreference = "Stop"

function Read-SecretValue([string]$Prompt) {
  $secureValue = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$envFile = Join-Path $PSScriptRoot ".env.local"
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Create web\.env.local with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before starting Prism."
}

$envNames = Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match "^\s*([^#=\s]+)\s*=") { $matches[1] }
}
foreach ($requiredName in @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
  if ($envNames -notcontains $requiredName) {
    throw "web\.env.local must define $requiredName."
  }
}

$env:SUPABASE_SERVICE_ROLE_KEY = Read-SecretValue "Supabase service-role/secret key"
$env:PRISM_MODEL_ENDPOINT = Read-Host "OpenRouter endpoint (Enter for https://openrouter.ai/api/v1)"
if (-not $env:PRISM_MODEL_ENDPOINT) {
  $env:PRISM_MODEL_ENDPOINT = "https://openrouter.ai/api/v1"
}
$env:PRISM_MODEL_NAME = Read-Host "Vision model ID (Enter for google/gemini-2.5-flash)"
if (-not $env:PRISM_MODEL_NAME) {
  $env:PRISM_MODEL_NAME = "google/gemini-2.5-flash"
}
$env:PRISM_MODEL_API_KEY = Read-SecretValue "OpenRouter API key"
if (-not $env:PRISM_MODEL_API_KEY) {
  throw "An OpenRouter API key is required."
}

Push-Location $PSScriptRoot
try {
  npm.cmd run dev
  if ($LASTEXITCODE -ne 0) { throw "Prism web development server stopped with a failure." }
}
finally {
  Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\PRISM_MODEL_ENDPOINT -ErrorAction SilentlyContinue
  Remove-Item Env:\PRISM_MODEL_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:\PRISM_MODEL_API_KEY -ErrorAction SilentlyContinue
  Pop-Location
}
