# Restart only the repository-owned Web listener, keeping authentication in its log.
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$listeners = @(Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue)
foreach ($owner in @($listeners.OwningProcess | Select-Object -Unique)) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$owner"
  if ($process.CommandLine -notlike '*apps/cli/src/bin.ts web --no-open*' -or
      $process.ExecutablePath -ne 'D:\CodeTools\nvm\v24.9.0\node.exe') {
    throw "Port 3080 belongs to an unexpected process: $owner"
  }
  Stop-Process -Id $owner
  Wait-Process -Id $owner -Timeout 20 -ErrorAction SilentlyContinue
}
$env:PATH = 'D:\CodeTools\nvm\v24.9.0;' + $env:PATH
$output = Join-Path $env:TEMP 'cinlan-ui-repair-web.out.log'
$errors = Join-Path $env:TEMP 'cinlan-ui-repair-web.err.log'
$child = Start-Process -FilePath 'D:\CodeTools\nvm\v24.9.0\node.exe' `
  -ArgumentList @('--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--no-open') `
  -WorkingDirectory $workspace -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $output -RedirectStandardError $errors
$deadline = (Get-Date).AddSeconds(90)
do {
  $child.Refresh()
  if ($child.HasExited) { throw "Web exited with code $($child.ExitCode); inspect its local logs" }
  $listener = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
  $ready = Test-Path -LiteralPath $output
  if ($ready) { $ready = [bool](Select-String -LiteralPath $output -Pattern 'http://127.0.0.1:3080/' -Quiet) }
  if ($listener -and $ready) { Write-Output "WEB_RESTARTED PID=$($child.Id) URL=http://127.0.0.1:3080"; exit 0 }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
throw 'Web readiness timed out; inspect its local logs'
