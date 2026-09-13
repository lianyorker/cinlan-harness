param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [int]$StringsLimit = 40,

    [int]$ImportsLimit = 80,

    [switch]$RunAnalysis
)

# Use UTF-8 for stable command output.
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\..\scripts\lib\ToolDiscovery.ps1')

$bootstrapScript = Join-Path $PSScriptRoot '..\..\scripts\bootstrap-reverse.ps1'

function Get-RequiredToolSpec {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $spec = Resolve-ReverseToolSpec -Name $Name
    if (-not $spec.Available) {
        throw "Missing command: $Name. After explicit approval run: powershell -File `"$bootstrapScript`" -Capability r2 -Install"
    }
    return $spec
}

function Write-Section {
    param(
        [Parameter(Mandatory = $true)]
    [string]$Title
    )

    # Stable section names make output readable and grep-friendly.
    ""
    "=== $Title ==="
}

$rabin2 = Get-RequiredToolSpec -Name 'rabin2'
$r2 = $null
if ($RunAnalysis) {
    $r2 = Get-RequiredToolSpec -Name 'r2'
}

# Normalize to an absolute path before invoking r2 or rabin2.
$resolvedPath = Resolve-Path -LiteralPath $TargetPath
$target = $resolvedPath.Path

"Target: $target"

Write-Section -Title 'File information'
& $rabin2.Command @($rabin2.PrefixArgs + @('-I', '--', $target))

Write-Section -Title 'Sections'
& $rabin2.Command @($rabin2.PrefixArgs + @('-S', '--', $target))

Write-Section -Title 'Imports'
& $rabin2.Command @($rabin2.PrefixArgs + @('-i', '--', $target)) | Select-Object -First $ImportsLimit

Write-Section -Title 'Exports'
& $rabin2.Command @($rabin2.PrefixArgs + @('-E', '--', $target))

Write-Section -Title 'Strings'
& $rabin2.Command @($rabin2.PrefixArgs + @('-zz', '--', $target)) | Select-Object -First $StringsLimit

if ($RunAnalysis) {
    Write-Section -Title 'Functions and entry analysis'
    & $r2.Command @($r2.PrefixArgs + @('-A', '-q', '-c', 's entry0;afl;iz;ii;q', '--', $target))
}
