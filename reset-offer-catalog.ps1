[CmdletBinding()]
param(
    [string]$CatalogPath = (Join-Path $PSScriptRoot 'offers-data.js'),
    [string]$ScoutDataPath = (Join-Path $PSScriptRoot 'scout-data.json'),
    [string]$ExclusionsPath = (Join-Path $PSScriptRoot 'catalog-exclusions.json')
)

$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)

if (-not (Test-Path -LiteralPath $CatalogPath -PathType Leaf)) {
    throw "Файл каталога не найден: $CatalogPath"
}

$catalogSource = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8
$catalogJson = $catalogSource -replace '^\s*window\.OFFERS_CATALOG\s*=\s*', '' -replace ';\s*$', ''
$catalog = $catalogJson | ConvertFrom-Json

$existingPaths = @()
if (Test-Path -LiteralPath $ExclusionsPath -PathType Leaf) {
    $existing = Get-Content -LiteralPath $ExclusionsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $existingPaths = @($existing.paths)
}

$catalogPaths = @(
    foreach ($offer in @($catalog.offers)) {
        if ([string]::IsNullOrWhiteSpace("$($offer.path)")) { continue }
        [Uri]::UnescapeDataString("$($offer.path)").TrimStart('.', '/') -replace '\\', '/'
    }
)
$allPaths = @($existingPaths + $catalogPaths | Where-Object { $_ } | Sort-Object -Unique)

$exclusions = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    reason = 'Все прежние офферы сняты с публикации перед загрузкой новых условий.'
    paths = $allPaths
}
[IO.File]::WriteAllText($ExclusionsPath, (($exclusions | ConvertTo-Json -Depth 5) + "`n"), $utf8)

$emptyScout = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    dataAsOf = $null
    offers = [ordered]@{}
}
[IO.File]::WriteAllText($ScoutDataPath, (($emptyScout | ConvertTo-Json -Depth 5) + "`n"), $utf8)

& (Join-Path $PSScriptRoot 'generate-offers-data.ps1') `
    -OutputPath $CatalogPath `
    -ScoutDataPath $ScoutDataPath `
    -ExclusionsPath $ExclusionsPath

Write-Host "С публикации снято путей: $($allPaths.Count)"
