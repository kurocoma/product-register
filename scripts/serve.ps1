# Product Register WebUI - local dev server (UTF-8 BOM)
# Usage:
#   .\scripts\serve.ps1
#   .\scripts\serve.ps1 -Mode lan
#   .\scripts\serve.ps1 -Port 3010
# Port priority: -Port, env PRODUCT_REGISTER_PORT, default 3000

param(
    [ValidateSet("local", "lan")]
    [string]$Mode = "local",
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"

if ($Port -le 0) {
    if ($env:PRODUCT_REGISTER_PORT) {
        $Port = [int]$env:PRODUCT_REGISTER_PORT
    } else {
        $Port = 3000
    }
}

$bindHost = if ($Mode -eq "lan") { "0.0.0.0" } else { "127.0.0.1" }
$urlHost = if ($Mode -eq "lan") { "localhost" } else { "127.0.0.1" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$webuiRoot = Join-Path $repoRoot "webui"

if (-not (Test-Path -LiteralPath $webuiRoot)) {
    throw ("serve: webui folder not found: {0}" -f $webuiRoot)
}

Set-Location -LiteralPath $webuiRoot

function Resolve-PnpmCommand {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        return "pnpm"
    }
    if (Get-Command corepack -ErrorAction SilentlyContinue) {
        corepack enable pnpm | Out-Null
        if (Get-Command pnpm -ErrorAction SilentlyContinue) {
            return "pnpm"
        }
    }
    throw "serve: pnpm not found. Install Node.js and enable pnpm."
}

$pnpm = Resolve-PnpmCommand
$nodeModulesPath = Join-Path $webuiRoot "node_modules"

if (-not (Test-Path -LiteralPath $nodeModulesPath)) {
    Write-Host "serve: running pnpm install..."
    & $pnpm install
    if ($LASTEXITCODE -ne 0) {
        throw "serve: pnpm install failed."
    }
}

if ($Mode -eq "lan") {
    Write-Host ("serve: LAN mode - http://<this-pc-ip>:{0}/" -f $Port) -ForegroundColor Yellow
    Write-Host "serve: use on trusted LAN only." -ForegroundColor Yellow
} else {
    Write-Host ("serve: local mode - http://{0}:{1}/" -f $urlHost, $Port)
}

Write-Host "serve: close this window to stop the server."

& $pnpm dev -- -p $Port -H $bindHost
