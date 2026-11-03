param(
  [string]$FoundryApp = "$env:ProgramFiles\Foundry Virtual Tabletop\resources\app",
  [string]$SourceData = 'Z:\TTRPG\Foundry\Foundry Data'
)
$ErrorActionPreference = 'Stop'
$modulePath = Split-Path -Parent $PSScriptRoot
$testData = Join-Path $PSScriptRoot 'data'
if (Test-Path -LiteralPath (Join-Path $testData 'Data\worlds\pointcrawl-test\data')) { throw 'Test world already exists. Reuse it; setup does not overwrite databases.' }
foreach ($relative in @('Config','Data\systems','Data\modules','Data\worlds\pointcrawl-test')) { New-Item -ItemType Directory -Force (Join-Path $testData $relative) | Out-Null }
Copy-Item -LiteralPath (Join-Path $SourceData 'Config\license.json') -Destination (Join-Path $testData 'Config\license.json')
foreach ($relative in @('Data\systems\dnd5e','Data\modules\socketlib')) {
  $destination = Join-Path $testData $relative
  if (-not (Test-Path -LiteralPath $destination)) { Copy-Item -LiteralPath (Join-Path $SourceData $relative) -Destination $destination -Recurse }
}
$moduleLink = Join-Path $testData 'Data\modules\mjl-pointcrawl'
if (-not (Test-Path -LiteralPath $moduleLink)) { New-Item -ItemType Junction -Path $moduleLink -Target $modulePath | Out-Null }
@{id='pointcrawl-test';title='Pointcrawl — изолированный тест';system='dnd5e';coreVersion='14.361';systemVersion='5.3.3';compatibility=@{minimum='14';verified='14.361'};description='Изолированный тест без данных кампании.'} | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $testData 'Data\worlds\pointcrawl-test\world.json')
@{dataPath=$testData.Replace('\','/');port=30010;upnp=$false;telemetry=$false;hotReload=$true;language='en.core';hostname='127.0.0.1'} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $testData 'Config\options.json')
Write-Output "Prepared isolated data at $testData"
Write-Output "node `"$FoundryApp\main.mjs`" --dataPath=`"$testData`" --port=30010 --world=pointcrawl-test --noupdate"
Write-Output 'Enable mjl-pointcrawl and socketlib in the test world, then run tests/foundry.mjs from the parent workspace.'
