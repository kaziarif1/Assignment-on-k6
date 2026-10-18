param(
  [string]$SummaryPath = (Join-Path $PSScriptRoot '..\reports\k6-summary.json'),
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\screenshots\k6-metrics.png')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$summary = Get-Content -Raw $SummaryPath | ConvertFrom-Json
$m = $summary.metrics
$durationSeconds = ([double]$summary.state.testRunDurationMs / 1000)
$apiNames = @('deposit', 'sendmoney', 'payment')
$canvas = [Drawing.Bitmap]::new(1800, 1150)
$g = [Drawing.Graphics]::FromImage($canvas)
$g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$bg = [Drawing.Color]::FromArgb(13, 19, 27)
$panel = [Drawing.Color]::FromArgb(24, 34, 45)
$line = [Drawing.Color]::FromArgb(49, 64, 78)
$text = [Drawing.Color]::FromArgb(224, 234, 242)
$muted = [Drawing.Color]::FromArgb(151, 169, 183)
$green = [Drawing.Color]::FromArgb(105, 226, 169)
$red = [Drawing.Color]::FromArgb(255, 122, 122)
$g.Clear($bg)
$titleFont = [Drawing.Font]::new('Segoe UI', 30, [Drawing.FontStyle]::Bold)
$headFont = [Drawing.Font]::new('Segoe UI', 17, [Drawing.FontStyle]::Bold)
$bodyFont = [Drawing.Font]::new('Segoe UI', 15, [Drawing.FontStyle]::Regular)
$smallFont = [Drawing.Font]::new('Segoe UI', 12, [Drawing.FontStyle]::Regular)
$monoFont = [Drawing.Font]::new('Consolas', 15, [Drawing.FontStyle]::Regular)
function Get-Metric([string]$Name) { return $m.PSObject.Properties[$Name].Value }
function Draw-Text([string]$Value, [single]$X, [single]$Y, [Drawing.Font]$Font, [Drawing.Color]$Color) {
  $brush = [Drawing.SolidBrush]::new($Color)
  $g.DrawString($Value, $Font, $brush, $X, $Y)
  $brush.Dispose()
}
function Draw-Card([string]$Label, [string]$Value, [single]$X, [single]$Y, [Drawing.Color]$Accent) {
  $brush = [Drawing.SolidBrush]::new($panel)
  $g.FillRectangle($brush, [Drawing.Rectangle]::new([int]$X,[int]$Y,530,105))
  $brush.Dispose()
  Draw-Text $Label ($X+22) ($Y+14) $smallFont $muted
  Draw-Text $Value ($X+22) ($Y+40) $headFont $Accent
}

$http = $m.http_req_duration.values
$httpFailed = $m.http_req_failed.values
$checks = $m.checks.values
$transactionRequests = 0
foreach ($api in $apiNames) { $transactionRequests += [int](Get-Metric "${api}_requests").values.count }
$cardX = @(48, 635, 1222)
$allHttp = [int]$m.http_reqs.values.count
$failedHttp = [int]$httpFailed.passes
$checkPct = [math]::Round(([double]$checks.rate * 100), 2)
$failPct = [math]::Round(([double]$httpFailed.rate * 100), 2)
Draw-Text 'k6 metrics output | dMoney transaction workload' 48 34 $titleFont $text
Draw-Text ("Actual run summary · {0:N2} seconds · generated from k6-summary.json" -f $durationSeconds) 52 86 $bodyFont $muted
$cards = @(
  @('Transaction API requests', $transactionRequests.ToString('N0'), $green),
  @('All HTTP requests (incl. setup)', $allHttp.ToString('N0'), $text),
  @('Transaction throughput', ("{0:N2} req/s" -f ($transactionRequests / $durationSeconds)), $green),
  @('HTTP request failure rate', ("{0:N2}% ({1:N0} failed)" -f $failPct, $failedHttp), $red),
  @('Checks passed', ("{0:N2}%" -f $checkPct), $red),
  @('HTTP duration avg / p95', ("{0:N2} / {1:N2} ms" -f $http.avg, $http.'p(95)'), $green)
)
for ($i=0; $i -lt $cards.Count; $i++) {
  $x = $cardX[$i % 3]
  $y = 145 + ([math]::Floor($i / 3) * 126)
  Draw-Card $cards[$i][0] $cards[$i][1] $x $y $cards[$i][2]
}
Draw-Text 'API metrics' 48 425 $headFont $text
$cols = @('API','Requests','Failed','Failure rate','Avg duration','p95 duration','Transaction checks')
$colX = @(52, 365, 565, 755, 985, 1210, 1440)
for ($i=0; $i -lt $cols.Count; $i++) { Draw-Text $cols[$i] $colX[$i] 470 $smallFont $muted }
$pen = [Drawing.Pen]::new($line, 1)
$g.DrawLine($pen, 48, 500, 1750, 500)
for ($i=0; $i -lt $apiNames.Count; $i++) {
  $api = $apiNames[$i]
  $rowY = 520 + ($i * 70)
  $requests = [int](Get-Metric "${api}_requests").values.count
  $failed = [int](Get-Metric "${api}_failures").values.passes
  $failureRate = [double](Get-Metric "${api}_failures").values.rate * 100
  $duration = (Get-Metric "${api}_duration").values
  $checkRate = [double](Get-Metric "${api}_transaction_checks").values.rate * 100
  $cells = @(
    $api, $requests.ToString('N0'), $failed.ToString('N0'), ("{0:N2}%" -f $failureRate),
    ("{0:N2} ms" -f $duration.avg), ("{0:N2} ms" -f $duration.'p(95)'), ("{0:N2}% passed" -f $checkRate)
  )
  for ($j=0; $j -lt $cells.Count; $j++) { Draw-Text $cells[$j] $colX[$j] $rowY $bodyFont $text }
  $g.DrawLine($pen, 48, ($rowY+42), 1750, ($rowY+42))
}
Draw-Text 'Threshold summary' 48 770 $headFont $text
$thresholds = @(
  @('HTTP p95 < 1000 ms', ([double]$http.'p(95)' -lt 1000), ("Observed {0:N2} ms" -f $http.'p(95)')),
  @('HTTP failure rate < 1%', ([double]$httpFailed.rate -lt 0.01), ("Observed {0:N2}%" -f $failPct)),
  @('Checks pass rate >= 99%', ([double]$checks.rate -ge 0.99), ("Observed {0:N2}%" -f $checkPct))
)
for ($i=0; $i -lt $thresholds.Count; $i++) {
  $y = 820 + ($i * 58)
  $pass = [bool]$thresholds[$i][1]
  Draw-Text ($(if($pass){'PASS'}else{'FAIL'})) 54 $y $headFont $(if($pass){$green}else{$red})
  Draw-Text $thresholds[$i][0] 155 $y $bodyFont $text
  Draw-Text $thresholds[$i][2] 950 $y $bodyFont $muted
}
Draw-Text 'Source: reports/k6-summary.json · This image contains observed run metrics; no values are simulated.' 48 1058 $smallFont $muted
$dir = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$canvas.Save((Resolve-Path $dir).Path + '\' + (Split-Path -Leaf $OutputPath), [Drawing.Imaging.ImageFormat]::Png)
$pen.Dispose(); $g.Dispose(); $canvas.Dispose(); $titleFont.Dispose(); $headFont.Dispose(); $bodyFont.Dispose(); $smallFont.Dispose(); $monoFont.Dispose()
Write-Output "Saved $OutputPath"


