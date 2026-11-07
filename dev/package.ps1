$ErrorActionPreference = 'Stop'
$modulePath = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $modulePath 'dist'
New-Item -ItemType Directory -Force $distPath | Out-Null
$moduleId = (Get-Content -LiteralPath (Join-Path $modulePath 'module.json') -Raw | ConvertFrom-Json).id
$archive = Join-Path $distPath "$moduleId.zip"
$files = @('module.json','scripts','styles','art','examples','README.md','VALIDATION.md','package.json','tests') | ForEach-Object { Join-Path $modulePath $_ }
Compress-Archive -LiteralPath $files -DestinationPath $archive -Force
Write-Output $archive
