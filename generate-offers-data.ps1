[CmdletBinding()]
param(
    [string[]]$OffersRoots = @(
        (Join-Path $PSScriptRoot 'Офферы Новостройки'),
        (Join-Path $PSScriptRoot 'Офферы Новостройки 2'),
        (Join-Path $PSScriptRoot 'Офферы Новостройки 3'),
        (Join-Path $PSScriptRoot 'Рассрочка')
    ),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'offers-data.js'),
    [string]$ScoutDataPath = (Join-Path $PSScriptRoot 'scout-data.json'),
    [string]$AreaCachePath = (Join-Path $PSScriptRoot 'offer-area-cache.json')
)

$ErrorActionPreference = 'Stop'

foreach ($offersRoot in $OffersRoots) {
    if (-not (Test-Path -LiteralPath $offersRoot -PathType Container)) {
        throw "Папка с офферами не найдена: $offersRoot"
    }
}

$typeLabels = @{
    'Акции, скидки'     = 'Акции и скидки'
    'Сниженная цена'    = 'Акции и скидки'
    'С ремонтом'        = 'С ремонтом'
    'БЕЗ ПВ и ЧПВ'      = 'Без ПВ и ЧПВ'
    'БЕЗ ПВ, ЧПВ'       = 'Без ПВ и ЧПВ'
    'СУБСИДИЯ СЕМЕЙКА'  = 'Субсидия «Семейка»'
    'Семейка субсидия'  = 'Субсидия «Семейка»'
    'СУБСИДИЯ СТАНДАРТ' = 'Субсидия «Стандарт»'
    'Рассрочка'          = 'Рассрочка'
}

$districtLabels = @{
    '5 ЗАРЕЧНЫЙ'                          = '5-й Заречный'
    'ДОК'                                 = 'ДОК'
    'Дом обороны'                         = 'Оборона'
    'ЗАРЕКА'                              = 'Зарека'
    'Заречный'                            = 'Заречный'
    'КПД'                                 = 'КПД'
    'ЛЕСОБАЗА'                            = 'Лесобаза'
    'Московский тракт, Плеханово'         = 'Плеханово, Московский тракт'
    'Московский, Плеханово'               = 'Плеханово, Московский тракт'
    'МЫС'                                 = 'Мыс'
    'Новопатрушева'                       = 'Новопатрушево'
    'Оборона'                             = 'Оборона'
    'ПЛЕХАНОВО, МОСКОВСКИЙ ТРАКТ'         = 'Плеханово, Московский тракт'
    'Плеханово, Московский, Рощино'       = 'Плеханово, Московский тракт, Рощино'
    'Рощино'                              = 'Рощино'
    'ТЮМЕНСКАЯ СЛОБОДА'                   = 'Тюменская слобода'
    'ЦЕНТР'                               = 'Центр'
    'Червишевский тракт'                  = 'Червишевский тракт'
    'Червишеский тракт'                   = 'Червишевский тракт'
}

$complexLabels = @{
    'ЖК беринг' = 'ЖК Беринг'
}

function ConvertTo-DisplayText {
    param([Parameter(Mandatory)][string]$Text)

    $clean = ($Text -replace '_', '%' -replace '\s+', ' ').Trim()
    return $clean
}

function ConvertTo-ComplexName {
    param([Parameter(Mandatory)][string]$Name)

    $clean = ($Name -replace '\s+', ' ').Trim()
    $clean = $clean -replace '^(?i:жк)\s+', 'ЖК '

    if ($complexLabels.ContainsKey($clean)) {
        return $complexLabels[$clean]
    }

    if ($clean -cmatch '^ЖК\s') {
        $tail = $clean.Substring(3)
        if ($tail -ceq $tail.ToUpperInvariant()) {
            $tail = (Get-Culture).TextInfo.ToTitleCase($tail.ToLowerInvariant())
        }
        return "ЖК $tail"
    }

    if ($clean -ceq $clean.ToUpperInvariant() -and $clean -notin @('ДОК', 'МАХ')) {
        return (Get-Culture).TextInfo.ToTitleCase($clean.ToLowerInvariant())
    }

    return $clean
}

function Get-RoomCode {
    param([Parameter(Mandatory)][string]$Name)

    $value = $Name.Trim().ToLowerInvariant()
    if ($value -match '^студ') { return 'studio' }
    if ($value -match '^1\s*(?:\+|ком|к\b)') { return '1' }
    if ($value -match '^1\s*$') { return '1' }
    if ($value -match '^2\s*(?:\+|ком|к\b)') { return '2' }
    if ($value -match '^2\s*$') { return '2' }
    if ($value -match '^3\s*(?:\+|ком|к\b)') { return '3' }
    if ($value -match '^3\s*$') { return '3' }
    if ($value -match '^4\s*(?:\+|ком|к\b)') { return '4' }
    if ($value -match '^4\s*$') { return '4' }
    return $null
}

function Get-OfferArea {
    param([Parameter(Mandatory)][string]$Text)

    $matches = [regex]::Matches($Text, '(?<!\d)(\d{1,3}[,.]\d{1,2})(?!\d)')
    if ($matches.Count -eq 0) { return $null }

    $candidates = foreach ($match in $matches) {
        $numberText = $match.Groups[1].Value.Replace(',', '.')
        $value = 0.0
        if (-not [double]::TryParse($numberText, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
            continue
        }
        if ($value -le 17 -or $value -gt 300) { continue }

        $tailLength = [Math]::Min(5, $Text.Length - ($match.Index + $match.Length))
        $tail = if ($tailLength -gt 0) { $Text.Substring($match.Index + $match.Length, $tailLength) } else { '' }
        if ($tail -match '^\s*%') { continue }
        [pscustomobject]@{
            Value = [Math]::Round($value, 2)
            HasUnit = $tail -match '^\s*(?:м²|м2|кв\.?\s*м)'
            Index = $match.Index
        }
    }

    $selected = $candidates | Sort-Object @{ Expression = 'HasUnit'; Descending = $true }, Index | Select-Object -First 1
    if ($selected) { return $selected.Value }
    return $null
}

function Get-OptionalPropertyValue {
    param([AllowNull()]$InputObject, [Parameter(Mandatory)][string]$Name)
    if ($null -eq $InputObject) { return $null }
    $property = $InputObject.PSObject.Properties | Where-Object { $_.Name -ieq $Name } | Select-Object -First 1
    if ($property) { return $property.Value }
    return $null
}

$scoutByOfferId = @{}
if (Test-Path -LiteralPath $ScoutDataPath -PathType Leaf) {
    try {
        $scoutCache = Get-Content -LiteralPath $ScoutDataPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($scoutCache.offers) {
            foreach ($property in $scoutCache.offers.PSObject.Properties) {
                $scoutByOfferId[$property.Name] = $property.Value
            }
        }
    }
    catch {
        Write-Warning "Не удалось прочитать публичный кэш Scout: $ScoutDataPath"
    }
}

$areaByCatalogPath = @{}
$areaMetadataByCatalogPath = @{}
if (Test-Path -LiteralPath $AreaCachePath -PathType Leaf) {
    try {
        $areaCache = Get-Content -LiteralPath $AreaCachePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($areaCache.entries) {
            foreach ($property in $areaCache.entries.PSObject.Properties) {
                if ($null -ne $property.Value.areaSqm) {
                    $area = [double]$property.Value.areaSqm
                    if ($area -gt 17) {
                        $areaByCatalogPath[$property.Name] = $area
                        $areaMetadataByCatalogPath[$property.Name] = $property.Value
                    }
                }
            }
        }
    }
    catch {
        Write-Warning "Не удалось прочитать кэш площадей: $AreaCachePath"
    }
}

$roomLabels = @{
    'studio' = 'Студия'
    '1'      = '1-комнатная'
    '2'      = '2-комнатная'
    '3'      = '3-комнатная'
    '4'      = '4-комнатная'
    'other'  = 'Не указано'
}

# У этих исходников технические GUID-имена, поэтому комнатность нельзя
# определить по имени файла. Значения взяты с самих макетов.
$roomOverrides = @{
    'b266723d-3446-40cb-b796-212c3bd2c62e' = '2'
    'abcaaeed-c9fa-4c83-88b0-f7f036b727bf' = 'studio'
    'ea3640a4-f1db-4de5-b4f6-198063a78182' = '2'
    'i (16)'                               = '1'
    'i (17)'                               = 'studio'
    'i (18)'                               = '1'
    'i (19)'                               = '1'
    'i (20)'                               = 'studio'
    'i (21)'                               = '2'
    'i (22)'                               = 'studio'
}

$titleOverrides = @{
    'i (16)' = '1-комнатная 40,3 м²'
    'i (17)' = 'Студия 33,8 м²'
    'i (18)' = '1-комнатная 34,84 м²'
    'i (19)' = '1-комнатная 36,2 м²'
    'i (20)' = 'Студия 32,0 м²'
    'i (21)' = '2-комнатная 54,0 м²'
    'i (22)' = 'Студия 24,68 м²'
}

# Точечные исключения для макетов, где важные признаки указаны внутри
# изображения, но не отражены в имени файла.
$roomPathOverrides = @{
    'Рассрочка/Московский тракт/ЖК Домашний/Обработанные/1+.jpg' = '2'
}

$renovationPathOverrides = @(
    'Рассрочка/Тюменская слобода/ЖК Символ/Обработанные/1+.jpg'
)

$rootEntries = @(
    foreach ($offersRoot in $OffersRoots) {
        $resolvedRoot = (Resolve-Path -LiteralPath $offersRoot).Path
        [pscustomobject]@{
            Path       = $resolvedRoot
            Name       = Split-Path -Leaf $resolvedRoot
            TypePrefix = if ((Split-Path -Leaf $resolvedRoot) -ieq 'Рассрочка') { 'Рассрочка' } else { $null }
        }
    }
)

$processedFiles = @(
    foreach ($rootEntry in $rootEntries) {
        Get-ChildItem -LiteralPath $rootEntry.Path -Recurse -File |
            Where-Object { $_.Directory.Name -eq 'Обработанные' } |
            ForEach-Object {
                [pscustomobject]@{
                    File     = $_
                    RootPath = $rootEntry.Path
                    RootName = $rootEntry.Name
                    TypePrefix = $rootEntry.TypePrefix
                }
            }
    }
) | Sort-Object { $_.File.FullName }

$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
$utf8 = [System.Text.UTF8Encoding]::new($false)

try {
    $offers = foreach ($record in $processedFiles) {
        $file = $record.File
        $relativePath = [System.IO.Path]::GetRelativePath($record.RootPath, $file.FullName)
        $relativeParts = @($relativePath -split '[\\/]')
        $parts = if ($record.TypePrefix) {
            @($record.TypePrefix) + $relativeParts
        }
        else {
            $relativeParts
        }

        if ($parts.Count -lt 5) {
            Write-Warning "Пропущен файл с неожиданной структурой: $relativePath"
            continue
        }

        $typeRaw = $parts[0]
        $districtRaw = $parts[1]
        $complexRaw = $parts[2]
        $catalogPathKey = ($record.RootName + '/' + ($relativePath -replace '\\', '/'))
        $primaryType = if ($typeLabels.ContainsKey($typeRaw)) { $typeLabels[$typeRaw] } else { $typeRaw }
        $offerTypes = @($primaryType)
        $hasRenovation = $typeRaw -ieq 'С ремонтом' -or
            $file.BaseName -match '(?i)(?:с\s+ремонтом|с\s+отделкой)' -or
            $catalogPathKey -in $renovationPathOverrides
        if ($hasRenovation -and 'С ремонтом' -notin $offerTypes) {
            $offerTypes += 'С ремонтом'
        }
        $roomCode = if ($roomPathOverrides.ContainsKey($catalogPathKey)) {
            $roomPathOverrides[$catalogPathKey]
        }
        elseif ($roomOverrides.ContainsKey($file.BaseName)) {
            $roomOverrides[$file.BaseName]
        }
        else {
            Get-RoomCode -Name $file.BaseName
        }

        if (-not $roomCode) {
            $complexDirectory = $file.Directory.Parent
            $fallbackRooms = @(
                Get-ChildItem -LiteralPath $complexDirectory.FullName -File -ErrorAction SilentlyContinue |
                    ForEach-Object { Get-RoomCode -Name $_.BaseName } |
                    Where-Object { $_ } |
                    Sort-Object -Unique
            )
            if ($fallbackRooms.Count -eq 1) {
                $roomCode = $fallbackRooms[0]
            }
        }

        if (-not $roomCode) { $roomCode = 'other' }

        $webPath = './' + [System.Uri]::EscapeDataString($record.RootName) + '/' + (($relativePath -split '[\\/]' | ForEach-Object {
            [System.Uri]::EscapeDataString($_)
        }) -join '/')

        $idSeed = if ($record.RootName -eq 'Офферы Новостройки') {
            $relativePath
        }
        else {
            "$($record.RootName)/$relativePath"
        }
        $idBytes = $hashAlgorithm.ComputeHash($utf8.GetBytes($idSeed.ToLowerInvariant()))
        $id = -join ($idBytes[0..7] | ForEach-Object { $_.ToString('x2') })

        $offerTitle = if ($titleOverrides.ContainsKey($file.BaseName)) {
            $titleOverrides[$file.BaseName]
        }
        else {
            ConvertTo-DisplayText -Text $file.BaseName
        }
        $offerArea = Get-OfferArea -Text $offerTitle
        $areaExtractionSource = if ($null -ne $offerArea) { 'accompanying_text' } else { $null }
        $areaExtractionFragment = if ($null -ne $offerArea) { $offerTitle } else { $null }
        $areaExtractionConfidence = $null
        $projectRelativeKey = ($record.RootName + '/' + ($relativePath -replace '\\', '/'))
        if ($null -eq $offerArea -and $areaByCatalogPath.ContainsKey($projectRelativeKey)) {
            $offerArea = $areaByCatalogPath[$projectRelativeKey]
            $areaMetadata = $areaMetadataByCatalogPath[$projectRelativeKey]
            $cachedSource = Get-OptionalPropertyValue -InputObject $areaMetadata -Name 'source'
            $areaExtractionSource = if ($cachedSource -eq 'manual-override') { 'structured_data' } elseif ($cachedSource) { $cachedSource } else { 'image' }
            $areaExtractionFragment = Get-OptionalPropertyValue -InputObject $areaMetadata -Name 'sourceFragment'
            $areaExtractionConfidence = Get-OptionalPropertyValue -InputObject $areaMetadata -Name 'confidence'
        }

        $offer = [ordered]@{
            id          = $id
            type        = $primaryType
            types       = @($offerTypes)
            typeRaw     = $typeRaw
            district    = if ($districtLabels.ContainsKey($districtRaw)) { $districtLabels[$districtRaw] } else { $districtRaw }
            districtRaw = $districtRaw
            complex     = ConvertTo-ComplexName -Name $complexRaw
            complexRaw  = $complexRaw
            room        = $roomLabels[$roomCode]
            roomCode    = $roomCode
            title       = $offerTitle
            fileName    = $file.Name
            path        = $webPath
            extension   = $file.Extension.TrimStart('.').ToLowerInvariant()
        }
        if ($null -ne $offerArea) {
            $offer.areaSqm = $offerArea
            $offer.areaExtractionSource = $areaExtractionSource
            if ($areaExtractionFragment) { $offer.areaExtractionFragment = "$areaExtractionFragment" }
            if ($null -ne $areaExtractionConfidence) { $offer.areaExtractionConfidence = [int]$areaExtractionConfidence }
        }
        if ($scoutByOfferId.ContainsKey($id)) {
            $offer.scout = $scoutByOfferId[$id]
        }
        $offer
    }
}
finally {
    $hashAlgorithm.Dispose()
}

$catalog = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    updatedAt   = (Get-Date).ToString('yyyy-MM-dd')
    count       = $offers.Count
    offers      = @($offers)
}

$json = $catalog | ConvertTo-Json -Depth 20 -Compress
$javascript = "window.OFFERS_CATALOG = $json;`n"
[System.IO.File]::WriteAllText($OutputPath, $javascript, $utf8)

Write-Host "Каталог обновлён: $($offers.Count) офферов"
Write-Host "Файл данных: $OutputPath"
