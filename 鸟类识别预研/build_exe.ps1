# Build a portable Windows folder: dist\BirdLab\BirdLab.exe (+ models\ next to it)
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File build_exe.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { throw "missing .venv - see README" }

Write-Host "== [1/4] clean ==" -ForegroundColor Cyan
Remove-Item -Recurse -Force "$root\build", "$root\dist" -ErrorAction SilentlyContinue

Write-Host "== [2/4] pyinstaller (5-15 min on first run) ==" -ForegroundColor Cyan
& $py -m PyInstaller `
  --noconfirm --clean --onedir --windowed `
  --name BirdLab `
  --distpath "$root\dist" --workpath "$root\build" --specpath "$root\build" `
  --paths "$root\app" --paths "$root\experiments" `
  --hidden-import common --hidden-import species_classifier `
  --hidden-import birdnet_runtime --hidden-import audio_lib `
  --exclude-module librosa --exclude-module numba --exclude-module llvmlite `
  --exclude-module polars --exclude-module matplotlib --exclude-module pandas `
  --exclude-module IPython --exclude-module pytest --exclude-module tensorboard `
  --collect-all ultralytics --collect-all ai_edge_litert `
  --collect-all torchvision `
  --collect-all imageio_ffmpeg --collect-all soundfile `
  --add-data "$root\data\videos\V1_feeder_slovakia.webm;data\videos" `
  --add-data "$root\data\audio\wav;data\audio\wav" `
  "$root\app\gui.py"
if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed: $LASTEXITCODE" }

$target = Join-Path $root "dist\BirdLab"
Write-Host "== [3/4] copy models ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$target\models\birdnet", "$target\models\torch_hub\hub\checkpoints" | Out-Null
Copy-Item "$root\models\yolo11n.pt" "$target\models\" -Force
Copy-Item "$root\models\birdnet\*" "$target\models\birdnet\" -Force
$cache = Join-Path $env:USERPROFILE ".cache\torch\hub\checkpoints"
if (Test-Path $cache) { Copy-Item "$cache\*.pth" "$target\models\torch_hub\hub\checkpoints\" -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path "$target\results\gui" | Out-Null

@"
观鸟助手 · 技术预研测试台（便携版）
====================================

启动：双击 BirdLab.exe
（首次启动约 5-10 秒，模型加载完成后窗口才出现）

目录说明
  models\yolo11n.pt                  鸟类检测权重（5.4 MB）
  models\birdnet\                    BirdNET v2.4 音频模型（49 MB）
  models\torch_hub\                  物种分类权重缓存（离线可用）
  data\videos\                       示例视频
  data\audio\wav\                    示例音频（5 段鸟鸣 + 3 段负样本）
  results\gui\                       导出的 JSON / 验收记录 / selftest.log

无人值守自检（在命令行运行，结果同时写入 results\gui\selftest.log）
  BirdLab.exe --selftest-video data\videos\V1_feeder_slovakia.webm --frames 40 --cls resnet50
  BirdLab.exe --selftest-audio data\audio\wav\A1_blackbird.wav,data\audio\wav\N2_traffic.wav

已知限制
  - 屏幕采集请避开本窗口自身，否则会把自己框进去
  - 物种候选来自 ImageNet-59 词表，不是真实物种（详见 docs\visual-findings.md）
  - 仅 CPU 推理；无 NVIDIA GPU 加速
"@ | Set-Content -Path "$target\使用说明.txt" -Encoding UTF8

Write-Host "== [4/4] done ==" -ForegroundColor Green
$size = (Get-ChildItem $target -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("out: " + $target)
Write-Host ("size: {0:N0} MB" -f $size)
Write-Host ("exe: " + (Join-Path $target "BirdLab.exe"))

