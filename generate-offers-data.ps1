[CmdletBinding()]
param(
    [string]$OffersRoot = (Join-Path $PSScriptRoot 'Офферы Новостройки'),
    [string]$OutputPath = (Join-Path $PSScriptRoot 'offers-data.js')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $OffersRoot -PathType Container)) {
    throw "Папка с офферами не найдена: $OffersRoot"
}

$typeLabels = @{
    'Акции, скидки'     = 'Акции и скидки'
    'БЕЗ ПВ и ЧПВ'      = 'Без ПВ и ЧПВ'
    'СУБСИДИЯ СЕМЕЙКА'  = 'Субсидия «Семейка»'
    'СУБСИДИЯ СТАНДАРТ' = 'Субсидия «Стандарт»'
}

$districtLabels = @{
    '5 ЗАРЕЧНЫЙ'                          = '5-й Заречный'
    'ДОК'                                 = 'ДОК'
    'ЗАРЕКА'                              = 'Зарека'
    'Заречный'                            = 'Заречный'
    'КПД'                                 = 'КПД'
    'ЛЕСОБАЗА'                            = 'Лесобаза'
    'Московский тракт, Плеханово'         = 'Плеханово, Московский тракт'
    'Московский, Плеханово'               = 'Плеханово, Московский тракт'
    'МЫС'                                 = 'Мыс'
    'Оборона'                             = 'Оборона'
    'ПЛЕХАНОВО, МОСКОВСКИЙ ТРАКТ'         = 'Плеханово, Московский тракт'
    'Плеханово, Московский, Рощино'       = 'Плеханово, Московский тракт, Рощино'
    'ТЮМЕНСКАЯ СЛОБОДА'                   = 'Тюменская слобода'
    'ЦЕНТР'                               = 'Центр'
    'Червишевский тракт'                  = 'Червишевский тракт'
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

$roomLabels = @{
    'studio' = 'Студия'
    '1'      = '1-комнатная'
    '2'      = '2-комнатная'
    '3'      = '3-комнатная'
    '4'      = '4-комнатная'
    'other'  = 'Не указано'
}

$rootPath = (Resolve-Path -LiteralPath $OffersRoot).Path
$processedFiles = @(
    Get-ChildItem -LiteralPath $rootPath -Recurse -File |
        Where-Object { $_.Directory.Name -eq 'Обработанные' } |
        Sort-Object FullName
)

$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
$utf8 = [System.Text.UTF8Encoding]::new($false)

try {
    $offers = foreach ($file in $processedFiles) {
        $relativePath = [System.IO.Path]::GetRelativePath($rootPath, $file.FullName)
        $parts = $relativePath -split '[\\/]'

        if ($parts.Count -lt 5) {
            Write-Warning "Пропущен файл с неожиданной структурой: $relativePath"
            continue
        }

        $typeRaw = $parts[0]
        $districtRaw = $parts[1]
        $complexRaw = $parts[2]
        $roomCode = Get-RoomCode -Name $file.BaseName

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

        $webPath = './Офферы Новостройки/' + (($relativePath -split '[\\/]' | ForEach-Object {
            [System.Uri]::EscapeDataString($_)
        }) -join '/')

        $idBytes = $hashAlgorithm.ComputeHash($utf8.GetBytes($relativePath.ToLowerInvariant()))
        $id = -join ($idBytes[0..7] | ForEach-Object { $_.ToString('x2') })

        [ordered]@{
            id          = $id
            type        = if ($typeLabels.ContainsKey($typeRaw)) { $typeLabels[$typeRaw] } else { $typeRaw }
            typeRaw     = $typeRaw
            district    = if ($districtLabels.ContainsKey($districtRaw)) { $districtLabels[$districtRaw] } else { $districtRaw }
            districtRaw = $districtRaw
            complex     = ConvertTo-ComplexName -Name $complexRaw
            complexRaw  = $complexRaw
            room        = $roomLabels[$roomCode]
            roomCode    = $roomCode
            title       = ConvertTo-DisplayText -Text $file.BaseName
            fileName    = $file.Name
            path        = $webPath
            extension   = $file.Extension.TrimStart('.').ToLowerInvariant()
        }
    }
}
finally {
    $hashAlgorithm.Dispose()
}

$latestWriteTime = $processedFiles |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty LastWriteTime

$catalog = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    updatedAt   = if ($latestWriteTime) { $latestWriteTime.ToString('yyyy-MM-dd') } else { $null }
    count       = $offers.Count
    offers      = @($offers)
}

$json = $catalog | ConvertTo-Json -Depth 6 -Compress
$javascript = "window.OFFERS_CATALOG = $json;`n"
[System.IO.File]::WriteAllText($OutputPath, $javascript, $utf8)

Write-Host "Каталог обновлён: $($offers.Count) офферов"
Write-Host "Файл данных: $OutputPath"
