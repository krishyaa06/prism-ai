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

$env:SUPABASE_URL = Read-Host "Supabase project URL"
$env:SUPABASE_SERVICE_ROLE_KEY = Read-SecretValue "Supabase service-role key"
$env:PRISM_MODEL_ENDPOINT = Read-Host "OpenAI-compatible model endpoint URL"
$env:PRISM_MODEL_NAME = Read-Host "Vision model ID"
$env:PRISM_MODEL_API_KEY = Read-SecretValue "Model provider API key"

$roles = @("PLANNER", "EXECUTOR", "RESEARCH", "REVIEW")
foreach ($role in $roles) {
  $endpointName = "PRISM_MODEL_${role}_ENDPOINT"
  $modelName = "PRISM_MODEL_${role}_NAME"
  $apiKeyName = "PRISM_MODEL_${role}_API_KEY"
  $endpoint = Read-Host "Optional $role model endpoint (Enter to use shared endpoint)"
  $model = Read-Host "Optional $role model ID (Enter to use shared model)"
  $apiKey = Read-SecretValue "Optional $role API key (Enter to use shared key)"
  if ($endpoint) { Set-Item -Path "Env:\$endpointName" -Value $endpoint }
  if ($model) { Set-Item -Path "Env:\$modelName" -Value $model }
  if ($apiKey) { Set-Item -Path "Env:\$apiKeyName" -Value $apiKey }
}

Push-Location $PSScriptRoot
try {
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "Could not install Prism worker dependencies." }
  npm.cmd start
  if ($LASTEXITCODE -ne 0) { throw "Prism worker stopped with a failure." }
}
finally {
  Remove-Item Env:\SUPABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:\PRISM_MODEL_ENDPOINT -ErrorAction SilentlyContinue
  Remove-Item Env:\PRISM_MODEL_NAME -ErrorAction SilentlyContinue
  Remove-Item Env:\PRISM_MODEL_API_KEY -ErrorAction SilentlyContinue
  foreach ($role in $roles) {
    Remove-Item "Env:\PRISM_MODEL_${role}_ENDPOINT" -ErrorAction SilentlyContinue
    Remove-Item "Env:\PRISM_MODEL_${role}_NAME" -ErrorAction SilentlyContinue
    Remove-Item "Env:\PRISM_MODEL_${role}_API_KEY" -ErrorAction SilentlyContinue
  }
  Pop-Location
}
