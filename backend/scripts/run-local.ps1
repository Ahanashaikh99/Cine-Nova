# Compatibility wrapper for existing Windows shortcuts.
# The shared Node.js runner supports both Windows and macOS.
param(
    [ValidateSet('start', 'test', 'verify:live', 'test:postman')]
    [string]$Task = 'start'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$commands = @{
    'start' = 'start:local'
    'test' = 'test:local'
    'verify:live' = 'verify:local'
    'test:postman' = 'postman:local'
}
Push-Location -LiteralPath $projectRoot
try {
    & npm.cmd run $commands[$Task]
    $resultCode = $LASTEXITCODE
} finally { Pop-Location }
exit $resultCode
