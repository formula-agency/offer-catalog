[CmdletBinding()]
param(
    [string]$EnvPath = (Join-Path $PSScriptRoot 'scout.env'),
    [string]$CatalogPath = (Join-Path $PSScriptRoot 'offers-data.js'),
    [string]$ScoutDataPath = (Join-Path $PSScriptRoot 'scout-data.json'),
    [string]$ScoutOverridesPath = (Join-Path $PSScriptRoot 'scout-manual-overrides.json'),
    [string]$ScoutAliasesPath = (Join-Path $PSScriptRoot 'scout-project-aliases.json'),
    [string]$ReportPath = (Join-Path $PSScriptRoot 'scout-sync-report.json'),
    [string]$ApiCacheDirectory = (Join-Path $PSScriptRoot '.scout-cache'),
    [int]$ApiCacheMaxAgeHours = 6,
    [switch]$ForceScoutRefresh
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scout-integration.ps1')
$script:ScoutPayloadMemory = @{}
$script:ScoutPayloadAsOf = @{}

$scoutAliases = $null
if (Test-Path -LiteralPath $ScoutAliasesPath -PathType Leaf) {
    $scoutAliases = Get-Content -LiteralPath $ScoutAliasesPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
Set-ScoutProjectAliases -Aliases $scoutAliases

$scoutOverrides = $null
if (Test-Path -LiteralPath $ScoutOverridesPath -PathType Leaf) {
    $scoutOverrides = Get-Content -LiteralPath $ScoutOverridesPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-ScoutToken {
    $tokenNames = @('SCOUT_TOKEN', 'NEOPIC_TOKEN', 'SCOUT_API_TOKEN')
    $token = $null
    foreach ($tokenName in $tokenNames) {
        $token = [Environment]::GetEnvironmentVariable($tokenName, 'Process')
        if ([string]::IsNullOrWhiteSpace($token)) {
            $token = [Environment]::GetEnvironmentVariable($tokenName, 'User')
        }
        if (-not [string]::IsNullOrWhiteSpace($token)) { break }
    }
    if ([string]::IsNullOrWhiteSpace($token) -and (Test-Path -LiteralPath $EnvPath -PathType Leaf)) {
        $lines = @(Get-Content -LiteralPath $EnvPath -Encoding UTF8)
        foreach ($line in $lines) {
            if ($line -match '^\s*(?:export\s+)?(?:NEOPIC_TOKEN|SCOUT_TOKEN|SCOUT_API_TOKEN)\s*=\s*(.+?)\s*$') {
                $token = $Matches[1].Trim().Trim('"').Trim("'")
                break
            }
        }
        if ([string]::IsNullOrWhiteSpace($token)) {
            $rawTokenLine = $lines | Where-Object { $_.Trim() -and -not $_.TrimStart().StartsWith('#') -and $_ -notmatch '=' } | Select-Object -First 1
            if ($rawTokenLine) { $token = $rawTokenLine.Trim().Trim('"').Trim("'") }
        }
    }
    return $token
}

function Write-JsonUtf8 {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string]$Path)
    $utf8 = [Text.UTF8Encoding]::new($false)
    $json = $Value | ConvertTo-Json -Depth 30
    [IO.File]::WriteAllText($Path, $json + "`n", $utf8)
}

function Get-ScoutMatchKey {
    param([string]$ProjectName, [double]$Area)
    $areaKey = $Area.ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
    return "$(Resolve-ScoutProjectName $ProjectName)|$areaKey"
}

function Get-ScoutApiPayload {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][hashtable]$Headers
    )

    if (-not (Test-Path -LiteralPath $ApiCacheDirectory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $ApiCacheDirectory
    }
    $cachePath = Join-Path $ApiCacheDirectory "$Name.json"
    if ($script:ScoutPayloadMemory.ContainsKey($cachePath)) {
        return $script:ScoutPayloadMemory[$cachePath]
    }

    $cacheIsFresh = -not $ForceScoutRefresh -and
        (Test-Path -LiteralPath $cachePath -PathType Leaf) -and
        (Get-Item -LiteralPath $cachePath).LastWriteTime -gt (Get-Date).AddHours(-$ApiCacheMaxAgeHours)

    if ($cacheIsFresh) {
        Write-Host "Использую локальный кэш Scout: $Name"
    }
    else {
        Write-Host "Загружаю Scout: $Name"
        $temporaryPath = "$cachePath.tmp"
        try {
            Invoke-WebRequest -Method Get -Uri $Uri -Headers $Headers -OutFile $temporaryPath -TimeoutSec 600
            Move-Item -LiteralPath $temporaryPath -Destination $cachePath -Force
        }
        finally {
            if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
                Remove-Item -LiteralPath $temporaryPath -Force
            }
        }
    }

    Write-Host "Разбираю JSON Scout: $Name"
    $payload = Get-Content -LiteralPath $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:ScoutPayloadMemory[$cachePath] = $payload
    $script:ScoutPayloadAsOf[$Name] = (Get-Item -LiteralPath $cachePath).LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ssK')
    return $payload
}

function Get-ScoutHistoryItemById {
    param(
        [Parameter(Mandatory)][long]$ApartmentId,
        [Parameter(Mandatory)][long]$TotalCount,
        [Parameter(Mandatory)][hashtable]$Headers,
        [int]$PageSize = 1000
    )

    $low = 1
    $high = [int][Math]::Ceiling($TotalCount / $PageSize)
    while ($low -le $high) {
        $page = [int][Math]::Floor(($low + $high) / 2)
        $name = "history_page_${page}_size_${PageSize}"
        $uri = "https://neopic.site/ap/api/history_prices/?page=$page&page_size=$PageSize"
        $payload = Get-ScoutApiPayload -Name $name -Uri $uri -Headers $Headers
        $items = @(Get-ScoutItems -Payload $payload)
        if ($items.Count -eq 0) { return $null }

        $firstId = [long](Get-ScoutProperty -InputObject $items[0] -Names @('id'))
        $lastId = [long](Get-ScoutProperty -InputObject $items[-1] -Names @('id'))
        if ($ApartmentId -lt $firstId) {
            $high = $page - 1
            continue
        }
        if ($ApartmentId -gt $lastId) {
            $low = $page + 1
            continue
        }
        return $items | Where-Object { [long](Get-ScoutProperty -InputObject $_ -Names @('id')) -eq $ApartmentId } | Select-Object -First 1
    }
    return $null
}

& (Join-Path $PSScriptRoot 'generate-offers-data.ps1') -OutputPath $CatalogPath -ScoutDataPath $ScoutDataPath

$token = Get-ScoutToken
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Warning 'Scout не обновлён: токен не найден в переменной окружения или scout.env.'
    Write-Host 'Каталог изображений обновлён с последним сохранённым публичным кэшем Scout.'
    return
}

$headers = @{ Authorization = "Token $token" }
try {
    $expositionPayload = Get-ScoutApiPayload -Name 'expositions' -Uri 'https://neopic.site/ap/api/expositions/' -Headers $headers
    $historyPayload = Get-ScoutApiPayload -Name 'history_prices' -Uri 'https://neopic.site/ap/api/history_prices/' -Headers $headers
}
catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status) { throw "Scout API вернул HTTP $status. Токен в сообщении и логах не выводится." }
    throw 'Не удалось получить данные Scout. Токен в сообщении и логах не выводится.'
}
finally {
    $headers.Authorization = $null
    $token = $null
}

$expositions = @(Get-ScoutItems -Payload $expositionPayload)
$historyItems = @(Get-ScoutItems -Payload $historyPayload)
$dataAsOf = if ($script:ScoutPayloadAsOf.ContainsKey('expositions')) {
    $script:ScoutPayloadAsOf['expositions']
} else {
    (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
}
$catalogText = Get-Content -LiteralPath $CatalogPath -Raw -Encoding UTF8
$catalogJson = $catalogText -replace '^\s*window\.OFFERS_CATALOG\s*=\s*', '' -replace ';\s*$', ''
$catalog = $catalogJson | ConvertFrom-Json

$publicOffers = [ordered]@{}
$reportRows = @()
$groups = @($catalog.offers | Where-Object {
    $null -ne (Get-ScoutProperty -InputObject $_ -Names @('areaSqm'))
} | Group-Object {
    $area = Get-ScoutProperty -InputObject $_ -Names @('areaSqm')
    Get-ScoutMatchKey -ProjectName $_.complex -Area ([double]$area)
})

Write-Host "Индексирую экспозицию Scout для $($groups.Count) сочетаний ЖК + площадь..."
$projectIndex = @{}
foreach ($item in $expositions) {
    if (-not (Test-ScoutActive -Item $item)) { continue }
    foreach ($projectKey in @(Get-ScoutItemProjectNames -Item $item)) {
        if (-not $projectIndex.ContainsKey($projectKey)) {
            $projectIndex[$projectKey] = [Collections.ArrayList]::new()
        }
        $null = $projectIndex[$projectKey].Add($item)
    }
}

$selectionByGroup = @{}
foreach ($group in $groups) {
    $sample = $group.Group[0]
    $projectKey = Resolve-ScoutProjectName -Name $sample.complex
    $area = [double]$sample.areaSqm
    [object[]]$projectCandidates = @()
    if ($projectIndex.ContainsKey($projectKey)) {
        $projectCandidates = @($projectIndex[$projectKey])
    }
    $candidates = @()
    if ($projectCandidates.Count -gt 0) {
        $candidates = @($projectCandidates | Where-Object {
            $candidateArea = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $_ -Names @('square'))
            $null -ne $candidateArea -and [Math]::Abs($candidateArea - $area) -le 0.0100001
        })
    }
    $selected = Select-ScoutApartment -Candidates $candidates
    $selectionByGroup[$group.Name] = [pscustomobject]@{
        Candidates = $candidates
        Selected = $selected
        ProjectFound = $projectCandidates.Count -gt 0
    }
}

$selectedApartmentIds = @($selectionByGroup.Values |
    ForEach-Object { Get-ScoutProperty -InputObject $_.Selected -Names @('apartment_id') } |
    Where-Object { $null -ne $_ } |
    Sort-Object -Unique)
if ($selectedApartmentIds.Count -gt 0) {
    Write-Host "Получаю историю для $($selectedApartmentIds.Count) выбранных квартир..."
    $historyToken = Get-ScoutToken
    $historyHeaders = @{ Authorization = "Token $historyToken" }
    try {
        foreach ($apartmentId in $selectedApartmentIds) {
            $existingHistory = $historyItems | Where-Object { [long](Get-ScoutProperty -InputObject $_ -Names @('id')) -eq [long]$apartmentId } | Select-Object -First 1
            if ($existingHistory) { continue }
            $historyItem = Get-ScoutHistoryItemById -ApartmentId ([long]$apartmentId) -TotalCount ([long]$historyPayload.count) -Headers $historyHeaders
            if ($historyItem) { $historyItems += $historyItem }
        }
    }
    finally {
        $historyHeaders.Authorization = $null
        $historyToken = $null
    }
}

foreach ($group in $groups) {
    $sample = $group.Group[0]
    $selection = $selectionByGroup[$group.Name]
    $candidates = @($selection.Candidates)
    $selected = $selection.Selected
    $publicResult = if ($selected) { New-ScoutPublicResult -Selected $selected -HistoryItems $historyItems -DataAsOf $dataAsOf } else { $null }
    if ($publicResult -and $scoutOverrides) {
        $overrideProperty = $scoutOverrides.PSObject.Properties | Where-Object Name -CEQ $group.Name | Select-Object -First 1
        $override = if ($overrideProperty) { $overrideProperty.Value } else { $null }
        if ($override) {
            foreach ($field in @('total_floors')) {
                $currentValue = Get-ScoutProperty -InputObject $publicResult -Names @($field)
                $overrideValue = Get-ScoutProperty -InputObject $override -Names @($field)
                if (($null -eq $currentValue -or "$currentValue".Trim() -eq '') -and $null -ne $overrideValue) {
                    $publicResult | Add-Member -NotePropertyName $field -NotePropertyValue $overrideValue
                }
            }
        }
    }

    foreach ($offer in $group.Group) {
        if ($publicResult) { $publicOffers[$offer.id] = $publicResult }
    }

    $reportRows += [pscustomobject][ordered]@{
        complex = $sample.complex
        area_sqm = [double]$sample.areaSqm
        offer_ids = @($group.Group.id)
        matched = [bool]$publicResult
        candidates = @($candidates | ForEach-Object { Get-ScoutCandidateSummary -Item $_ })
        reason = if ($publicResult) { $null } elseif (-not $selection.ProjectFound) { 'project_not_found' } elseif ($candidates.Count -eq 0) { 'area_not_found' } elseif (-not $selected) { 'Нет кандидата official или aggregator с валидной ценой' } else { 'История не прошла проверку source_id и параметров квартиры' }
        message = if ($publicResult) { $null } else { 'Проект или квартира с указанной площадью не найдены в Scout ни в официальных источниках, ни в агрегаторах.' }
        data_as_of = $dataAsOf
    }
}

$now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
$publicCache = [ordered]@{
    generatedAt = $now
    dataAsOf = $dataAsOf
    offers = $publicOffers
}
$report = [ordered]@{
    generatedAt = $now
    dataAsOf = $dataAsOf
    expositionCount = $expositions.Count
    historyCount = $historyItems.Count
    groupsChecked = $groups.Count
    matchedGroups = @($reportRows | Where-Object matched).Count
    unmatchedGroups = @($reportRows | Where-Object { -not $_.matched }).Count
    results = $reportRows
}

Write-JsonUtf8 -Value $publicCache -Path $ScoutDataPath
Write-JsonUtf8 -Value $report -Path $ReportPath
& (Join-Path $PSScriptRoot 'generate-offers-data.ps1') -OutputPath $CatalogPath -ScoutDataPath $ScoutDataPath

Write-Host "Scout обновлён: сопоставлено $($report.matchedGroups) из $($report.groupsChecked) сочетаний ЖК + площадь."
Write-Host "Технический отчёт: $ReportPath"
