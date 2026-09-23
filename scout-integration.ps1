Set-StrictMode -Version 2.0
$script:ScoutProjectAliasIndex = @{}

function Get-ScoutProperty {
    param(
        [AllowNull()]$InputObject,
        [Parameter(Mandatory)][string[]]$Names
    )

    if ($null -eq $InputObject) { return $null }
    foreach ($name in $Names) {
        $property = $InputObject.PSObject.Properties |
            Where-Object { $_.Name -ieq $name } |
            Select-Object -First 1
        if ($property -and $null -ne $property.Value) {
            if ($property.Value -is [string] -and [string]::IsNullOrWhiteSpace($property.Value)) { continue }
            if ($property.Value -is [System.Array]) { return ,$property.Value }
            return $property.Value
        }
    }
    return $null
}

function Get-ScoutItems {
    param([AllowNull()]$Payload)

    if ($null -eq $Payload) { return @() }
    if ($Payload -is [System.Array]) { return @($Payload) }
    if ($Payload -is [System.Collections.IEnumerable] -and $Payload -isnot [string] -and $Payload.PSObject.Properties.Count -eq 0) {
        return @($Payload)
    }

    foreach ($name in @('results', 'items', 'data', 'expositions', 'history_prices')) {
        $value = Get-ScoutProperty -InputObject $Payload -Names @($name)
        if ($null -ne $value) {
            if ($value -is [System.Array]) { return @($value) }
            $nested = Get-ScoutItems -Payload $value
            if ($nested.Count -gt 0) { return $nested }
        }
    }
    return @($Payload)
}

function ConvertTo-ScoutNumber {
    param([AllowNull()]$Value)

    if ($null -eq $Value) { return $null }
    $text = ("$Value".Trim() -replace '[\s\u00A0]', '').Replace(',', '.')
    $number = 0.0
    if ([double]::TryParse($text, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return $number
    }
    return $null
}

function ConvertTo-ScoutDate {
    param([AllowNull()]$Value)

    if ($null -eq $Value -or "$Value".Trim() -eq '') { return $null }
    $date = [datetime]::MinValue
    if ([datetime]::TryParse("$Value", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal, [ref]$date)) {
        return $date
    }
    return $null
}

function ConvertTo-ScoutIsoDate {
    param([AllowNull()]$Value)
    $date = ConvertTo-ScoutDate -Value $Value
    if ($date) { return $date.ToString('yyyy-MM-dd') }
    return $null
}

function Normalize-ScoutProjectName {
    param([AllowNull()][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) { return '' }

    $value = $Name.ToLowerInvariant().Replace('ё', 'е')
    $value = $value -replace '[«»"''`]', ' '
    $value = $value -replace '^\s*(?:жк|жилой\s+комплекс)\s+', ''
    $value = $value -replace '[^\p{L}\p{Nd}]+', ' '
    return ($value -replace '\s+', ' ').Trim()
}

function Set-ScoutProjectAliases {
    param([AllowNull()]$Aliases)

    $script:ScoutProjectAliasIndex = @{}
    if ($null -eq $Aliases) { return }

    foreach ($property in $Aliases.PSObject.Properties) {
        $canonical = Normalize-ScoutProjectName -Name $property.Name
        if ([string]::IsNullOrWhiteSpace($canonical)) { continue }

        $names = @($property.Name)
        if ($property.Value -is [System.Array]) { $names += @($property.Value) }
        elseif ($null -ne $property.Value) { $names += @($property.Value) }

        foreach ($name in $names) {
            $normalized = Normalize-ScoutProjectName -Name "$name"
            if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                $script:ScoutProjectAliasIndex[$normalized] = $canonical
            }
        }
    }
}

function Resolve-ScoutProjectName {
    param([AllowNull()][string]$Name)

    $normalized = Normalize-ScoutProjectName -Name $Name
    if ($script:ScoutProjectAliasIndex.ContainsKey($normalized)) {
        return $script:ScoutProjectAliasIndex[$normalized]
    }
    return $normalized
}

function Get-ScoutItemProjectNames {
    param([AllowNull()]$Item)

    return @(
        foreach ($field in @('project_name', 'raw_project')) {
            $value = Get-ScoutProperty -InputObject $Item -Names @($field)
            if ($null -eq $value) { continue }
            $resolved = Resolve-ScoutProjectName -Name "$value"
            if (-not [string]::IsNullOrWhiteSpace($resolved)) { $resolved }
        }
    ) | Sort-Object -Unique
}

function Get-ScoutEffectivePrice {
    param([AllowNull()]$Item)

    $price = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $Item -Names @('price'))
    if ($null -ne $price -and $price -gt 0) { return [long][Math]::Round($price) }
    $priceFull = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $Item -Names @('price_full'))
    if ($null -ne $priceFull -and $priceFull -gt 0) { return [long][Math]::Round($priceFull) }
    return $null
}

function Test-ScoutActive {
    param([AllowNull()]$Item)

    $deleted = Get-ScoutProperty -InputObject $Item -Names @('deleted_flg', 'deleted')
    if ($null -ne $deleted -and "$deleted".Trim() -match '^(?i:y|yes|true|1)$') { return $false }

    $effectiveToValue = Get-ScoutProperty -InputObject $Item -Names @('effective_to')
    if ($null -eq $effectiveToValue -or "$effectiveToValue".Trim() -eq '') { return $true }
    if ("$effectiveToValue" -match '^9999-12-31') { return $true }
    $effectiveTo = ConvertTo-ScoutDate -Value $effectiveToValue
    if ($null -eq $effectiveTo) { return $true }
    return $effectiveTo.Date -ge (Get-Date).Date
}

function Test-ScoutDeleted {
    param([AllowNull()]$Item)
    $deleted = Get-ScoutProperty -InputObject $Item -Names @('deleted_flg', 'deleted')
    return $null -ne $deleted -and "$deleted".Trim() -match '^(?i:y|yes|true|1)$'
}

function Get-ScoutSourceType {
    param([AllowNull()]$Item)

    $officialFlag = Get-ScoutProperty -InputObject $Item -Names @('is_official', 'official_flg', 'developer_flg')
    if ($null -ne $officialFlag -and "$officialFlag".Trim() -match '^(?i:y|yes|true|1)$') { return 'official' }

    $parts = foreach ($name in @('source_type', 'source_kind', 'source', 'source_name', 'provider', 'feed_name', 'item_url')) {
        $value = Get-ScoutProperty -InputObject $Item -Names @($name)
        if ($null -ne $value) { "$value" }
    }
    $sourceId = Get-ScoutProperty -InputObject $Item -Names @('source_id')
    if ($null -ne $sourceId) { $parts += "$sourceId" }
    $haystack = ($parts -join ' ').ToLowerInvariant().Replace('ё', 'е')
    if ($haystack -match 'aggregator|агрегатор|etagi|этажи|cian|циан|avito|авито|domclick|домклик|yandex|яндекс') { return 'aggregator' }
    if ($haystack -match 'official|официал|застрой|developer|прямой|other_source') { return 'official' }
    return 'unknown'
}

function Get-ScoutCandidateSummary {
    param([AllowNull()]$Item)

    [ordered]@{
        source_type = Get-ScoutSourceType -Item $Item
        source_id = Get-ScoutProperty -InputObject $Item -Names @('source_id')
        project_name = Get-ScoutProperty -InputObject $Item -Names @('project_name')
        raw_project = Get-ScoutProperty -InputObject $Item -Names @('raw_project')
        house = Get-ScoutProperty -InputObject $Item -Names @('house_name', 'gp')
        section = Get-ScoutProperty -InputObject $Item -Names @('section')
        floor = Get-ScoutProperty -InputObject $Item -Names @('floor')
        square = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $Item -Names @('square'))
        comparison_price = Get-ScoutEffectivePrice -Item $Item
        item_url = Get-ScoutProperty -InputObject $Item -Names @('item_url')
    }
}

function Find-ScoutCandidates {
    param(
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Expositions,
        [Parameter(Mandatory)][string]$ProjectName,
        [Parameter(Mandatory)][double]$Area
    )

    $normalizedProject = Resolve-ScoutProjectName -Name $ProjectName
    return @($Expositions | Where-Object {
        if (-not (Test-ScoutActive -Item $_)) { return $false }
        $candidateProjects = @(Get-ScoutItemProjectNames -Item $_)
        if ($normalizedProject -notin $candidateProjects) { return $false }
        $candidateArea = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $_ -Names @('square'))
        return $null -ne $candidateArea -and [Math]::Abs($candidateArea - $Area) -le 0.0100001
    })
}

function Select-ScoutApartment {
    param([Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Candidates)

    $priced = @($Candidates | Where-Object { $null -ne (Get-ScoutEffectivePrice -Item $_) })
    if ($priced.Count -eq 0) { return $null }

    $official = @($priced | Where-Object { (Get-ScoutSourceType -Item $_) -eq 'official' })
    $pool = $official
    if ($pool.Count -eq 0) {
        $pool = @($priced | Where-Object { (Get-ScoutSourceType -Item $_) -eq 'aggregator' })
    }
    if ($pool.Count -eq 0) { return $null }

    return $pool | Sort-Object `
        @{ Expression = { Get-ScoutEffectivePrice -Item $_ }; Descending = $true }, `
        @{ Expression = { $value = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $_ -Names @('section')); if ($null -eq $value) { -1 } else { $value } }; Descending = $true }, `
        @{ Expression = { $value = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $_ -Names @('floor')); if ($null -eq $value) { -1 } else { $value } }; Descending = $true }, `
        @{ Expression = {
            $sourceId = "$(Get-ScoutProperty -InputObject $_ -Names @('source_id'))"
            $numericId = 0L
            if ([long]::TryParse($sourceId, [ref]$numericId)) { return ('0{0:D20}' -f $numericId) }
            return "1$sourceId"
        }; Descending = $false } |
        Select-Object -First 1
}

function Test-ScoutHistoryIdentity {
    param(
        [Parameter(Mandatory)]$Selected,
        [Parameter(Mandatory)]$HistoryItem
    )

    $selectedSourceId = Get-ScoutProperty -InputObject $Selected -Names @('source_id')
    $historySourceId = Get-ScoutProperty -InputObject $HistoryItem -Names @('source_id')
    if ($null -eq $selectedSourceId -or $null -eq $historySourceId -or "$selectedSourceId" -cne "$historySourceId") { return $false }

    $selectedSourceType = Get-ScoutSourceType -Item $Selected
    $historySourceType = Get-ScoutSourceType -Item $HistoryItem
    if ($historySourceType -ne 'unknown' -and $historySourceType -ne $selectedSourceType) { return $false }

    $checks = @(
        @(@('project_name'), @('project', 'project_name'), 'project'),
        @(@('section'), @('section'), 'text'),
        @(@('floor'), @('floor'), 'text'),
        @(@('square'), @('square'), 'number'),
        @(@('rooms_real'), @('rooms_real'), 'text')
    )
    foreach ($check in $checks) {
        $left = Get-ScoutProperty -InputObject $Selected -Names $check[0]
        $right = Get-ScoutProperty -InputObject $HistoryItem -Names $check[1]
        if ($null -eq $left -or $null -eq $right) { continue }
        if ($check[2] -eq 'project') {
            if ((Resolve-ScoutProjectName "$left") -ne (Resolve-ScoutProjectName "$right")) { return $false }
        }
        elseif ($check[2] -eq 'number') {
            $leftNumber = ConvertTo-ScoutNumber $left
            $rightNumber = ConvertTo-ScoutNumber $right
            if ($null -eq $leftNumber -or $null -eq $rightNumber -or [Math]::Abs($leftNumber - $rightNumber) -ge 0.005) { return $false }
        }
        elseif ("$left".Trim().ToLowerInvariant() -ne "$right".Trim().ToLowerInvariant()) { return $false }
    }


    $selectedHouseId = Get-ScoutProperty -InputObject $Selected -Names @('house_id')
    $historyHouseId = Get-ScoutProperty -InputObject $HistoryItem -Names @('house_id', 'house')
    if ($null -ne $selectedHouseId -and $null -ne $historyHouseId) {
        if ("$selectedHouseId" -cne "$historyHouseId") { return $false }
    }
    else {
        $selectedHouse = Get-ScoutProperty -InputObject $Selected -Names @('house_name', 'gp')
        $historyHouse = Get-ScoutProperty -InputObject $HistoryItem -Names @('house_name', 'gp')
        if ($null -ne $selectedHouse -and $null -ne $historyHouse -and "$selectedHouse".Trim().ToLowerInvariant() -ne "$historyHouse".Trim().ToLowerInvariant()) {
            return $false
        }
    }
    return $true
}

function Get-ScoutPriceHistory {
    param(
        [Parameter(Mandatory)]$Selected,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$HistoryItems,
        [Parameter(Mandatory)][double]$Area
    )

    $containers = @($HistoryItems | Where-Object { Test-ScoutHistoryIdentity -Selected $Selected -HistoryItem $_ })
    $rawPoints = @()
    foreach ($container in $containers) {
        $nested = Get-ScoutProperty -InputObject $container -Names @('price_history')
        if ($null -ne $nested) { $rawPoints += @(Get-ScoutItems -Payload $nested) }
        elseif ($null -ne (Get-ScoutEffectivePrice -Item $container)) { $rawPoints += $container }
    }

    $valid = @($rawPoints | Where-Object {
        $isDeleted = Test-ScoutDeleted -Item $_
        $effectiveTo = ConvertTo-ScoutIsoDate (Get-ScoutProperty -InputObject $_ -Names @('effective_to'))
        # Scout marks completed historical price intervals as deleted. Keep those
        # closed intervals; discard only deleted points without a real end date.
        $isClosedHistoricalInterval = $isDeleted -and $effectiveTo -and $effectiveTo -ne '9999-12-31'
        (-not $isDeleted -or $isClosedHistoricalInterval) -and
            $null -ne (Get-ScoutEffectivePrice -Item $_) -and
            $null -ne (ConvertTo-ScoutDate (Get-ScoutProperty -InputObject $_ -Names @('effective_from')))
    } | Sort-Object `
        @{ Expression = { ConvertTo-ScoutDate (Get-ScoutProperty -InputObject $_ -Names @('effective_from')) }; Descending = $false }, `
        @{ Expression = { $date = ConvertTo-ScoutDate (Get-ScoutProperty -InputObject $_ -Names @('processed_dt')); if ($date) { $date } else { [datetime]::MinValue } }; Descending = $false })

    $latestByDate = [ordered]@{}
    foreach ($point in $valid) {
        $dateKey = ConvertTo-ScoutIsoDate (Get-ScoutProperty -InputObject $point -Names @('effective_from'))
        $latestByDate[$dateKey] = $point
    }
    $deduplicated = @()
    $lastPrice = $null
    foreach ($point in $latestByDate.Values) {
        $price = Get-ScoutEffectivePrice -Item $point
        if ($null -ne $lastPrice -and $price -eq $lastPrice) { continue }
        $deduplicated += $point
        $lastPrice = $price
    }

    $currentPrice = Get-ScoutEffectivePrice -Item $Selected
    if ($deduplicated.Count -eq 0 -or (Get-ScoutEffectivePrice -Item $deduplicated[-1]) -ne $currentPrice) {
        $deduplicated += $Selected
    }

    $prices = @($deduplicated | ForEach-Object { Get-ScoutEffectivePrice -Item $_ })
    $startPrice = [long]$prices[0]
    $result = @()
    for ($index = 0; $index -lt $deduplicated.Count; $index++) {
        $point = $deduplicated[$index]
        $price = [long]$prices[$index]
        $previousPrice = if ($index -gt 0) { [long]$prices[$index - 1] } else { $null }
        $row = [ordered]@{
            effective_from = ConvertTo-ScoutIsoDate (Get-ScoutProperty -InputObject $point -Names @('effective_from'))
            price_rub = $price
            price_per_sqm_rub = [long][Math]::Round($price / $Area)
        }
        $effectiveTo = ConvertTo-ScoutIsoDate (Get-ScoutProperty -InputObject $point -Names @('effective_to'))
        if ($effectiveTo -and $effectiveTo -ne '9999-12-31') { $row.effective_to = $effectiveTo }
        if ($null -ne $previousPrice) {
            $row.change_from_previous_rub = $price - $previousPrice
            $row.change_from_previous_percent = [Math]::Round((($price / $previousPrice) - 1) * 100, 2)
        }
        $row.change_from_start_rub = $price - $startPrice
        $row.change_from_start_percent = [Math]::Round((($price / $startPrice) - 1) * 100, 2)
        $result += [pscustomobject]$row
    }
    return @($result)
}

function Add-ScoutValue {
    param(
        [Parameter(Mandatory)][System.Collections.Specialized.OrderedDictionary]$Target,
        [Parameter(Mandatory)][string]$Name,
        [AllowNull()]$Value
    )
    if ($null -eq $Value -or "$Value".Trim() -eq '') { return }
    $Target[$Name] = $Value
}

function New-ScoutPublicResult {
    param(
        [Parameter(Mandatory)]$Selected,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$HistoryItems,
        [AllowNull()][string]$DataAsOf
    )

    $area = ConvertTo-ScoutNumber (Get-ScoutProperty -InputObject $Selected -Names @('square'))
    $history = @(Get-ScoutPriceHistory -Selected $Selected -HistoryItems $HistoryItems -Area $area)
    if ($history.Count -eq 0) { return $null }
    $start = $history[0]
    $current = $history[-1]

    $result = [ordered]@{}
    Add-ScoutValue $result 'data_as_of' $DataAsOf
    Add-ScoutValue $result 'residential_complex' (Get-ScoutProperty -InputObject $Selected -Names @('project_name'))
    $houseName = Get-ScoutProperty -InputObject $Selected -Names @('house_name')
    $gp = Get-ScoutProperty -InputObject $Selected -Names @('gp')
    $houseDisplay = if ($gp -and $houseName -and "$gp".Trim() -ne "$houseName".Trim()) { "$gp, $houseName" } elseif ($houseName) { $houseName } else { $gp }
    Add-ScoutValue $result 'house' $houseDisplay
    Add-ScoutValue $result 'section' (Get-ScoutProperty -InputObject $Selected -Names @('section'))
    Add-ScoutValue $result 'floor' (Get-ScoutProperty -InputObject $Selected -Names @('floor'))
    Add-ScoutValue $result 'total_floors' (Get-ScoutProperty -InputObject $Selected -Names @('total_floors', 'floors_total', 'max_floor', 'house_floors'))
    $result.area_sqm = [Math]::Round($area, 2)
    Add-ScoutValue $result 'rooms_real' (Get-ScoutProperty -InputObject $Selected -Names @('rooms_real'))

    $sourceType = Get-ScoutSourceType -Item $Selected
    $priceSource = [ordered]@{ type = if ($sourceType -eq 'aggregator') { 'Агрегатор' } else { 'Официальный' } }
    $url = Get-ScoutProperty -InputObject $Selected -Names @('item_url')
    if ($url) { $priceSource.url = "$url" }
    $result.price_source = $priceSource
    $result.first_seen_date = $start.effective_from
    $result.start_price_rub = [long]$start.price_rub
    $result.current_price_rub = [long]$current.price_rub
    $result.price_change_rub = [long]($current.price_rub - $start.price_rub)
    $result.price_change_percent = [Math]::Round((($current.price_rub / $start.price_rub) - 1) * 100, 2)
    $result.start_price_per_sqm_rub = [long]$start.price_per_sqm_rub
    $result.current_price_per_sqm_rub = [long]$current.price_per_sqm_rub
    $result.price_per_sqm_change_rub = [long]($current.price_per_sqm_rub - $start.price_per_sqm_rub)
    $result.price_history = $history
    return [pscustomobject]$result
}
