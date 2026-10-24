# 配置路径
$BundleDir = "D:\特殊文件夹\文档\ManosabaNaniScripts"
$UnityDataTool = "E:\UnityDataTool\UnityDataTool.exe"
$NodeScript = "D:\Workspace\Visual-Studio-Code\deliverable\convert-to-nani.mjs"
$DumpDir = Join-Path $BundleDir "DumpedTxt"

# 确保输出目录存在
if (-not (Test-Path $BundleDir)) { Write-Error "找不到 Bundle 目录: $BundleDir"; exit }
if (-not (Test-Path $UnityDataTool)) { Write-Error "找不到 UnityDataTool: $UnityDataTool"; exit }
if (-not (Test-Path $NodeScript)) { Write-Error "找不到 Node 脚本: $NodeScript"; exit }
if (-not (Test-Path $DumpDir)) { New-Item -ItemType Directory -Path $DumpDir | Out-Null }

$bundleFiles = Get-ChildItem -Path $BundleDir -Filter "*.bundle" -File
$total = $bundleFiles.Count
$current = 0

Write-Host "找到 $total 个 .bundle 文件，开始处理..." -ForegroundColor Cyan

foreach ($file in $bundleFiles) {
    $current++
    $percent = [math]::Round(($current / $total) * 100, 1)
    Write-Host "`n[$current/$total] ($percent%) 正在处理: $($file.Name)" -ForegroundColor Yellow

    $dumpFileName = $file.BaseName + ".dump.txt"
    $dumpFilePath = Join-Path $DumpDir $dumpFileName

    # 1. 执行 UnityDataTool dump
    Write-Host "  -> 正在执行 UnityDataTool dump..."
    # UnityDataTool 会把 CAB-xxx.txt 输出到当前目录，我们随后收集它们
    & $UnityDataTool dump $file.FullName 2>&1 | Out-Host

    # 查找刚刚生成的 CAB-xxx.txt 文件（通常在脚本所在目录或当前运行目录）
    $cabFiles = Get-ChildItem -Path (Get-Location) -Filter "CAB-*.txt" -File
    if ($cabFiles.Count -eq 0) {
        # 如果当前目录没有，去 Node 脚本所在目录找找
        $nodeDir = Split-Path $NodeScript -Parent
        $cabFiles = Get-ChildItem -Path $nodeDir -Filter "CAB-*.txt" -File
    }

    if ($cabFiles.Count -eq 0) {
        Write-Warning "  !! 未找到生成的 CAB-*.txt，跳过转换。"
        continue
    }

    # 将刚生成的 CAB 文件合并成你要的 dump.txt
    $cabFile = $cabFiles[0]
    Move-Item -Path $cabFile.FullName -Destination $dumpFilePath -Force
    Write-Host "  -> Dump 成功: $dumpFileName"

    # 2. 执行 Node.js 脚本转换
    Write-Host "  -> 正在执行 Node.js 转换..."
    $nodeDir = Split-Path $NodeScript -Parent
    Push-Location $nodeDir
    
    # 强制把标准输出和标准错误都打印出来，如果你写了 console.error 就能看见了
    node $NodeScript $dumpFilePath 2>&1 | Out-Host

    Pop-Location

    Write-Host "  -> 处理完成！" -ForegroundColor Green
}

Write-Host "`n全部处理完毕！" -ForegroundColor Cyan