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
  Pop-Location
}
