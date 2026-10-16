[CmdletBinding()]
param(
    [string[]]$OffersRoots = @(),
    [string]$CachePath = '',
    [string]$OverridesPath = '',
    [int]$Limit = 0,
    [switch]$Force,
    [switch]$ShowText
)

$ErrorActionPreference = 'Stop'

if (-not $OffersRoots.Count) {
    $OffersRoots = @(
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7RhNGE0LXRgNGLINCd0L7QstC+0YHRgtGA0L7QudC60Lg=')))),
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7RhNGE0LXRgNGLINCd0L7QstC+0YHRgtGA0L7QudC60LggMg==')))),
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7RhNGE0LXRgNGLINCd0L7QstC+0YHRgtGA0L7QudC60LggMw==')))),
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0KDQsNGB0YHRgNC+0YfQutCw'))))
    )
}
if ([string]::IsNullOrWhiteSpace($CachePath)) { $CachePath = Join-Path $PSScriptRoot 'offer-area-cache.json' }
if ([string]::IsNullOrWhiteSpace($OverridesPath)) { $OverridesPath = Join-Path $PSScriptRoot 'offer-area-overrides.json' }

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'Run this OCR script with Windows PowerShell: powershell.exe -File .\extract-offer-areas.ps1'
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

function Wait-WinRtOperation {
    param(
        [Parameter(Mandatory)]$Operation,
        [Parameter(Mandatory)][Type]$ResultType
    )

    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory)][string]$BasePath,
        [Parameter(Mandatory)][string]$Path
    )

    $baseUri = New-Object Uri(($BasePath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar))
    $pathUri = New-Object Uri($Path)
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
}

function Get-AreaCandidates {
    param(
        [AllowEmptyString()][string]$Text,
        [AllowEmptyCollection()][object[]]$Lines = @(),
        [double]$ImageWidth = 0,
        [double]$ImageHeight = 0
    )

    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $lineItems = if ($Lines.Count) {
        @($Lines)
    } else {
        @($Text -split "`r?`n" | ForEach-Object { [pscustomobject]@{ Text = $_; X = 0; Y = 0; Width = 0; Height = 0 } })
    }
    $lineItems = @($lineItems)
    $positiveHeights = @($lineItems | ForEach-Object { [double]$_.Height } | Where-Object { $_ -gt 0 } | Sort-Object)
    $medianHeight = if ($positiveHeights.Count) { $positiveHeights[[int][Math]::Floor(($positiveHeights.Count - 1) / 2)] } else { 0 }
    $values = @()
    $globalIndex = 0
    for ($lineIndex = 0; $lineIndex -lt $lineItems.Count; $lineIndex++) {
        $lineItem = $lineItems[$lineIndex]
        $normalized = "$($lineItem.Text)" -replace [char]0x00A0, ' '
        $matches = [regex]::Matches($normalized, '(?<!\d)(\d{1,3}(?:[,.]\d{1,2})?)(?!\d)')
        foreach ($match in $matches) {
            $numberText = $match.Groups[1].Value.Replace(',', '.')
            $value = 0.0
            if (-not [double]::TryParse($numberText, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) { continue }
            # По спецификации 17 м² и меньше нельзя автоматически принимать за общую площадь.
            if ($value -le 17 -or $value -gt 300) { continue }

            $tailLength = [Math]::Min(14, $normalized.Length - ($match.Index + $match.Length))
            $tail = if ($tailLength -gt 0) { $normalized.Substring($match.Index + $match.Length, $tailLength) } else { '' }
            if ($tail -match '^\s*%') { continue }
            $hasUnit = $tail -match '^\s*(?:\u043c\s*(?:\u00b2|2)|m\s*(?:\u00b2|2)|\u043a\u0432\.?\s*\u043c)'
            $hasFraction = $match.Groups[1].Value -match '[,.]'
            if (-not $hasUnit -and -not $hasFraction) { continue }

            $context = $normalized.ToLowerInvariant().Replace([char]0x0451, [char]0x0435)
            $neighborStart = [Math]::Max(0, $lineIndex - 1)
            $neighborEnd = [Math]::Min($lineItems.Count - 1, $lineIndex + 1)
            $neighborText = (($lineItems[$neighborStart..$neighborEnd] | ForEach-Object { "$($_.Text)" }) -join ' ').ToLowerInvariant().Replace([char]0x0451, [char]0x0435)
            $isExplicit = $context -match '(?:\u043e\u0431\u0449(?:\u0430\u044f|\u0435\u0439)?\s+\u043f\u043b\u043e\u0449\u0430\u0434|\u043f\u043b\u043e\u0449\u0430\u0434[\u044c\u0438]\s+\u043a\u0432\u0430\u0440\u0442\u0438\u0440|s\s*\u043e\u0431\u0449)'
            $isApartmentLabel = $context -match '(?:\u0441\u0442\u0443\u0434\u0438\u044f|\d+\s*[- ]?\u043a\u043e\u043c\u043d\u0430\u0442\u043d|\u043a\u0432\u0430\u0440\u0442\u0438\u0440[\u0430\u044b]|(?:^|\s)[1-5]\s*[+\u043ae\u0435](?:\s|$))'
            $isExplicitNearby = -not $isExplicit -and $neighborText -match '(?:\u043e\u0431\u0449(?:\u0430\u044f|\u0435\u0439)?\s+\u043f\u043b\u043e\u0449\u0430\u0434|\u043f\u043b\u043e\u0449\u0430\u0434[\u044c\u0438]\s+\u043a\u0432\u0430\u0440\u0442\u0438\u0440|s\s*\u043e\u0431\u0449)'
            $isApartmentLabelNearby = -not $isApartmentLabel -and $neighborText -match '(?:\u0441\u0442\u0443\u0434\u0438\u044f|\d+\s*[- ]?\u043a\u043e\u043c\u043d\u0430\u0442\u043d|\u043a\u0432\u0430\u0440\u0442\u0438\u0440[\u0430\u044b]|(?:^|\s)[1-5]\s*[+\u043ae\u0435](?:\s|$))'
            $isRoomArea = -not $isExplicit -and $context -match '(?:\u043a\u0443\u0445\u043d|\u0441\u043f\u0430\u043b\u044c\u043d|\u0441\u0430\u043d\u0443\u0437|\u0432\u0430\u043d\u043d|\u043a\u043e\u0440\u0438\u0434\u043e\u0440|\u043f\u0440\u0438\u0445\u043e\u0436|\u043b\u043e\u0434\u0436\u0438|\u0431\u0430\u043b\u043a\u043e\u043d|\u0433\u0430\u0440\u0434\u0435\u0440\u043e\u0431|\u043a\u043b\u0430\u0434\u043e\u0432|\u0433\u043e\u0441\u0442\u0438\u043d|\u0436\u0438\u043b(?:\u0430\u044f|\u043e\u0439)\s+\u043f\u043b\u043e\u0449\u0430\u0434|\u0443\u0447\u0435\u0442\u043d\w*\s+\u043f\u043b\u043e\u0449\u0430\u0434)'
            $isMoneyOrTerm = $context -match '(?:\u20bd|\u0440\u0443\u0431|\u043f\u043b\u0430\u0442[\u0435\u0451]\u0436|\u0432\u0437\u043d\u043e\u0441|\u0441\u0442\u0430\u0432\u043a|\u0438\u043f\u043e\u0442\u0435\u043a|\u043c\u0435\u0441\.?|\u0433\u043e\u0434|\u043b\u0435\u0442)'
            $isDate = $context -match '(?:^|\D)(?:0?[1-9]|[12]\d|3[01])[.,](?:0?[1-9]|1[0-2])[.,](?:20)?\d{2}(?:\D|$)'
            if ($isRoomArea -or $isMoneyOrTerm -or $isDate) { continue }

            $score = 0
            if ($hasUnit) { $score += 25 }
            if ($hasFraction) { $score += 10 }
            if ($isApartmentLabel) { $score += 45 }
            if ($isExplicit) { $score += 120 }
            if ($isApartmentLabelNearby) { $score += 30 }
            if ($isExplicitNearby) { $score += 80 }
            $height = [double]$lineItem.Height
            if ($medianHeight -gt 0 -and $height -ge ($medianHeight * 1.35)) { $score += 15 }

            $x = [double]$lineItem.X
            $y = [double]$lineItem.Y
            $width = [double]$lineItem.Width
            $centerX = if ($ImageWidth -gt 0) { ($x + ($width / 2)) / $ImageWidth } else { $null }
            $centerY = if ($ImageHeight -gt 0) { ($y + ($height / 2)) / $ImageHeight } else { $null }
            $isCentral = $null -ne $centerX -and $centerX -ge 0.15 -and $centerX -le 0.85 -and $centerY -ge 0.05 -and $centerY -le 0.86
            if ($isCentral) { $score += 8 }

            $values += [pscustomobject]@{
                Value = [Math]::Round($value, 2)
                HasUnit = $hasUnit
                IsExplicit = $isExplicit
                Score = $score
                Index = $globalIndex + $match.Index
                Fragment = $normalized.Trim()
                LineIndex = $lineIndex
                X = [Math]::Round($x, 1)
                Y = [Math]::Round($y, 1)
                Width = [Math]::Round($width, 1)
                Height = [Math]::Round($height, 1)
                CenterX = if ($null -ne $centerX) { [Math]::Round($centerX, 4) } else { $null }
                CenterY = if ($null -ne $centerY) { [Math]::Round($centerY, 4) } else { $null }
                IsCentral = $isCentral
                IsApartmentLabel = $isApartmentLabel
                IsApartmentLabelNearby = $isApartmentLabelNearby
                IsExplicitNearby = $isExplicitNearby
            }
        }
        $globalIndex += $normalized.Length + 1
    }
    return @($values | Sort-Object `
        @{ Expression = 'Score'; Descending = $true }, `
        @{ Expression = 'HasUnit'; Descending = $true }, `
        @{ Expression = 'Index'; Descending = $false }, `
        @{ Expression = 'Value'; Descending = $false })
}

function Select-TotalAreaCandidate {
    param(
        [AllowEmptyCollection()][object[]]$Candidates,
        [AllowEmptyString()][string]$HintText = ''
    )

    if (-not $Candidates.Count) { return $null }
    $hint = $HintText.ToLowerInvariant().Replace([char]0x0451, [char]0x0435)
    $minimum = 17.01
    $maximum = 300.0
    if ($hint -match '(?:\u0441\u0442\u0443\u0434)') { $maximum = 65 }
    elseif ($hint -match '(?:^|[^0-9])3\s*(?:\+|\u043a|\u043a\u043e\u043c)') { $minimum = 50; $maximum = 220 }
    elseif ($hint -match '(?:^|[^0-9])2\s*(?:\+|\u043a|\u043a\u043e\u043c)') { $minimum = 35; $maximum = 150 }
    elseif ($hint -match '(?:^|[^0-9])1\s*(?:\+|\u043a|\u043a\u043e\u043c)') { $minimum = 24; $maximum = 95 }

    $plausible = @($Candidates | Where-Object { $_.Value -ge $minimum -and $_.Value -le $maximum })
    if (-not $plausible.Count) { return $null }
    $groups = @($plausible | Group-Object Value)
    foreach ($group in $groups) {
        $repeatBonus = if ($group.Count -gt 1) { [Math]::Min(30, ($group.Count - 1) * 15) } else { 0 }
        foreach ($candidate in $group.Group) {
            $candidate.Score += $repeatBonus
            $candidate | Add-Member -NotePropertyName RepeatCount -NotePropertyValue $group.Count -Force
        }
    }
    $ranked = @($plausible | Sort-Object `
        @{ Expression = 'Score'; Descending = $true }, `
        @{ Expression = 'HasUnit'; Descending = $true }, `
        @{ Expression = 'Index'; Descending = $false })
    $top = $ranked[0]

    # Одно уникальное правдоподобное значение или одно и то же значение в нескольких
    # сводных местах считаем подтверждённым. Площади комнат уже исключены контекстом.
    if ($groups.Count -eq 1 -and ($top.HasUnit -or $top.Value.ToString([Globalization.CultureInfo]::InvariantCulture) -match '\.')) {
        return $top
    }
    $nextDifferent = @($ranked | Where-Object { $_.Value -ne $top.Value } | Select-Object -First 1)
    if ($top.RepeatCount -gt 1 -and (-not $nextDifferent.Count -or $top.RepeatCount -gt $nextDifferent[0].RepeatCount) -and $top.Score -ge 43) {
        return $top
    }
    if (-not $top.IsExplicit -and -not $top.IsExplicitNearby -and -not $top.IsApartmentLabel -and -not $top.IsApartmentLabelNearby -and $top.Score -lt 43) {
        return $null
    }
    if ($ranked.Count -gt 1 -and -not $top.IsExplicit) {
        if ($nextDifferent.Count -and ($top.Score - $nextDifferent[0].Score) -lt 15) { return $null }
    }
    return $top
}

function Read-ImageText {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Engine
    )

    $file = Wait-WinRtOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
    $stream = Wait-WinRtOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Wait-WinRtOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Wait-WinRtOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $imageWidth = [double]$bitmap.PixelWidth
            $imageHeight = [double]$bitmap.PixelHeight
            $result = Wait-WinRtOperation ($Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $lines = @(
                foreach ($line in @($result.Lines)) {
                    $words = @($line.Words)
                    if ($words.Count) {
                        $x = ($words | ForEach-Object { [double]$_.BoundingRect.X } | Measure-Object -Minimum).Minimum
                        $y = ($words | ForEach-Object { [double]$_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
                        $right = ($words | ForEach-Object { [double]$_.BoundingRect.X + [double]$_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
                        $bottom = ($words | ForEach-Object { [double]$_.BoundingRect.Y + [double]$_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
                        $width = $right - $x
                        $height = $bottom - $y
                    } else {
                        $x = 0; $y = 0; $width = 0; $height = 0
                    }
                    [pscustomobject]@{ Text = $line.Text; X = $x; Y = $y; Width = $width; Height = $height }
                }
            )
            return [pscustomobject]@{ Text = $result.Text; Lines = $lines; Width = $imageWidth; Height = $imageHeight }
        }
        finally {
            if ($bitmap) { $bitmap.Dispose() }
        }
    }
    finally {
        if ($stream) { $stream.Dispose() }
    }
}

$cacheVersion = 3
$existing = @{}
if (Test-Path -LiteralPath $CachePath -PathType Leaf) {
    try {
        $cache = Get-Content -LiteralPath $CachePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cache.version -eq $cacheVersion -and $cache.entries) {
            foreach ($property in $cache.entries.PSObject.Properties) {
                $existing[$property.Name] = $property.Value
            }
        }
    }
    catch {
        Write-Warning "Could not read the area cache: $CachePath"
    }
}

$overrides = @{}
if (Test-Path -LiteralPath $OverridesPath -PathType Leaf) {
    $overrideData = Get-Content -LiteralPath $OverridesPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $overrideData.PSObject.Properties) {
        $overrides[$property.Name] = [double]$property.Value
    }
}

$language = New-Object Windows.Globalization.Language('ru-RU')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if (-not $engine) { throw 'Windows OCR for ru-RU is unavailable.' }

$processedFolderName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7QsdGA0LDQsdC+0YLQsNC90L3Ri9C1'))

$files = @(
    foreach ($root in $OffersRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -Recurse -File |
            Where-Object { $_.Directory.Name -eq $processedFolderName -and $_.Extension -match '^\.(?:png|jpe?g|webp)$' }
    }
) | Sort-Object FullName

if ($Limit -gt 0) { $files = @($files | Select-Object -First $Limit) }

$entries = [ordered]@{}
$processed = 0
$recognized = 0
$failed = 0
foreach ($file in $files) {
    $key = (Get-RelativePathCompat -BasePath $PSScriptRoot -Path $file.FullName) -replace '\\', '/'
    $fingerprint = "$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
    if ($overrides.ContainsKey($key)) {
        $entries[$key] = [pscustomobject][ordered]@{
            fingerprint = $fingerprint
            areaSqm = $overrides[$key]
            candidates = @($overrides[$key])
            source = 'manual-override'
        }
        $recognized++
        continue
    }
    $cached = $existing[$key]
    if (-not $Force -and $cached -and $cached.fingerprint -eq $fingerprint) {
        $entries[$key] = $cached
        if ($null -ne $cached.areaSqm) { $recognized++ }
        continue
    }

    $nameCandidates = @(Get-AreaCandidates -Text $file.BaseName)
    $nameSelected = Select-TotalAreaCandidate -Candidates $nameCandidates -HintText $file.BaseName
    if ($nameSelected) {
        $entries[$key] = [pscustomobject][ordered]@{
            fingerprint = $fingerprint
            areaSqm = $nameSelected.Value
            candidates = @($nameCandidates | Select-Object -ExpandProperty Value)
            source = 'accompanying_text'
            sourceFragment = $nameSelected.Fragment
            confidence = $nameSelected.Score
        }
        $recognized++
        continue
    }

    $processed++
    try {
        $ocr = Read-ImageText -Path $file.FullName -Engine $engine
        $candidates = @(Get-AreaCandidates -Text $ocr.Text -Lines $ocr.Lines -ImageWidth $ocr.Width -ImageHeight $ocr.Height)
        $selected = Select-TotalAreaCandidate -Candidates $candidates -HintText $file.BaseName
        $row = [ordered]@{
            fingerprint = $fingerprint
            areaSqm = if ($selected) { $selected.Value } else { $null }
            candidates = @($candidates | Select-Object -ExpandProperty Value)
            candidateDetails = @($candidates | Select-Object Value, Score, Fragment, RepeatCount, CenterX, CenterY, IsCentral, IsExplicit, IsExplicitNearby, IsApartmentLabel, IsApartmentLabelNearby)
            source = if ($selected) { 'image' } else { $null }
            sourceFragment = if ($selected) { $selected.Fragment } else { $null }
            confidence = if ($selected) { $selected.Score } else { $null }
        }
        if ($selected) { $recognized++ }
        $entries[$key] = [pscustomobject]$row
        if ($ShowText) {
            Write-Host "[$key] area=$($row.areaSqm) candidates=$($row.candidates -join ', ')"
            Write-Host $ocr.Text
        }
        elseif ($processed % 25 -eq 0) {
            Write-Host "OCR: processed $processed new files..."
        }
    }
    catch {
        $failed++
        $entries[$key] = [pscustomobject][ordered]@{
            fingerprint = $fingerprint
            areaSqm = $null
            candidates = @()
            error = $_.Exception.Message
        }
        Write-Warning "OCR failed for $key"
    }
}

$output = [ordered]@{
    version = $cacheVersion
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    entries = $entries
}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($CachePath, (($output | ConvertTo-Json -Depth 8) + "`n"), $utf8)
Write-Host "Area OCR: recognized $recognized of $($files.Count); processed $processed new files; errors $failed."
Write-Host "Area cache: $CachePath"
