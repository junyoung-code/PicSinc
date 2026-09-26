$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$yolo = Join-Path (Split-Path -Parent $project) 'experiments\yolo-outline'
$python = Join-Path $yolo '.venv\Scripts\python.exe'
$model = Join-Path $yolo '.cache\yolo26n-seg.pt'

if (-not (Test-Path $python)) { throw "Python venv missing: $python" }
if (-not (Test-Path $model)) { throw "YOLO model missing: $model" }
if (-not (Test-Path (Join-Path $project '.env.worker'))) { throw 'Create .env.worker in picsinc-merge' }

node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js is unavailable' }
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
if ($LASTEXITCODE -ne 0) { throw 'NVIDIA driver or GPU is unavailable' }
& $python -c 'import torch; print("torch=" + torch.__version__); print("cuda=" + str(torch.cuda.is_available())); print("gpu=" + (torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none")); print("architectures=" + ",".join(torch.cuda.get_arch_list())); assert torch.cuda.is_available(), "CUDA is unavailable"'
if ($LASTEXITCODE -ne 0) { throw 'PyTorch CUDA preflight failed' }
Get-FileHash $model -Algorithm SHA256 | Select-Object -ExpandProperty Hash
