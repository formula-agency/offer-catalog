$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scout-integration.ps1')
$aliases = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'scout-project-aliases.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Set-ScoutProjectAliases -Aliases $aliases

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ("$Actual" -ne "$Expected") {
        throw "$Message. Ожидалось: $Expected. Получено: $Actual"
    }
}

$expositions = @(
    [pscustomobject]@{
        project_name = 'ЖК Тест'; square = 41.05; source_type = 'aggregator'; price = 6100000
        section = 9; floor = 20; source_id = 'agg-1'; deleted_flg = 'N'
    },
    [pscustomobject]@{
        project_name = 'Тест'; square = 41.05; source_type = 'official'; price = 5850000
        section = 1; floor = 10; source_id = 'off-1'; deleted_flg = 'N'
    },
    [pscustomobject]@{
        project_name = 'Тест'; square = 41.05; source_type = 'official'; price = 5850000
        section = 2; floor = 2; source_id = 'off-2'; house_id = 'h1'; house_name = 'Дом 1'
        rooms_real = '2E'; effective_from = '2026-09-01'; item_url = 'https://example.com/2'; deleted_flg = 'N'
    },
    [pscustomobject]@{
        project_name = 'Тест'; square = 41.07; source_type = 'official'; price = 9000000
        section = 8; floor = 8; source_id = 'wrong-area'; deleted_flg = 'N'
    },
    [pscustomobject]@{
        project_name = 'Тест'; square = 41.05; source_type = 'official'; price = 9900000
        section = 8; floor = 8; source_id = 'deleted'; deleted_flg = 'Y'
    }
)

$historyItems = @(
    [pscustomobject]@{
        source_id = 'off-2'; project_name = 'Тест'; house_id = 'h1'; section = 2; floor = 2
        square = 41.05; rooms_real = '2E'
        price_history = @(
            [pscustomobject]@{ effective_from = '2026-03-19'; effective_to = '2026-04-01'; processed_dt = '2026-03-19T10:00:00'; price = 6000000; deleted_flg = 'Y' },
            [pscustomobject]@{ effective_from = '2026-04-01'; effective_to = '2026-05-01'; processed_dt = '2026-04-01T10:00:00'; price = 5900000; deleted_flg = 'Y' },
            [pscustomobject]@{ effective_from = '2026-04-01'; effective_to = '2026-05-01'; processed_dt = '2026-04-01T12:00:00'; price = 5850000; deleted_flg = 'Y' },
            [pscustomobject]@{ effective_from = '2026-05-01'; effective_to = '2026-06-01'; processed_dt = '2026-05-01T10:00:00'; price = 5850000; deleted_flg = 'Y' },
            [pscustomobject]@{ effective_from = '2026-06-01'; processed_dt = '2026-06-01T10:00:00'; price = 5800000; deleted_flg = 'Y' }
        )
    }
)

$candidates = @(Find-ScoutCandidates -Expositions $expositions -ProjectName 'ЖК Тест' -Area 41.05)
$selected = Select-ScoutApartment -Candidates $candidates
$result = New-ScoutPublicResult -Selected $selected -HistoryItems $historyItems -DataAsOf '2026-09-23T10:00:00+05:00'

Assert-Equal $candidates.Count 3 'Фильтр активных кандидатов или площади работает неверно'
Assert-Equal $selected.source_id 'off-2' 'Приоритет официального источника или tie-breaker работает неверно'
Assert-Equal $result.start_price_rub 6000000 'Стартовая цена рассчитана неверно'
Assert-Equal $result.current_price_rub 5850000 'Текущая цена рассчитана неверно'
Assert-Equal $result.price_change_rub -150000 'Изменение цены рассчитано неверно'
Assert-Equal $result.price_history.Count 2 'История не удалила только версии/последовательные дубли'
Assert-Equal ($result.price_history.price_rub -join ',') '6000000,5850000' 'Промежуточная история сформирована неверно'
Assert-Equal $result.data_as_of '2026-09-23T10:00:00+05:00' 'Свежесть экспозиции не попала в публичный результат'
Assert-Equal (Select-ScoutApartment -Candidates @()) $null 'Пустой список кандидатов должен возвращать null'

$aliasCandidates = @(Find-ScoutCandidates -Expositions @(
    [pscustomobject]@{
        project_name = 'Внутреннее имя'; raw_project = 'Умный квартал UNO'; square = 38.2
        source_type = 'aggregator'; price = 5100000; source_id = 'ETAGI-1'; deleted_flg = 'N'
    }
) -ProjectName 'ЖК УНО' -Area 38.20)
Assert-Equal $aliasCandidates.Count 1 'Поиск по raw_project и реестру алиасов работает неверно'
Assert-Equal (Select-ScoutApartment -Candidates $aliasCandidates).source_id 'ETAGI-1' 'Aggregator должен использоваться при отсутствии official'

$unknownOnly = @(
    [pscustomobject]@{ project_name = 'Тест'; square = 41.05; source_type = 'new-feed'; price = 7000000; source_id = 'new-1'; deleted_flg = 'N' }
)
Assert-Equal (Select-ScoutApartment -Candidates $unknownOnly) $null 'Unknown нельзя использовать как автоматический fallback'

Write-Host 'Scout integration tests: OK'
