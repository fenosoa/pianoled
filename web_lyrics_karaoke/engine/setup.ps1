# Crée le venv, installe torch (CUDA si GPU NVIDIA, sinon CPU) puis les dépendances.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = ".\.venv\Scripts\python.exe"
& $py -m pip install -U pip
$index = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { "cu124" } else { "cpu" }
# torch déjà installé globalement ? sinon décommente la ligne CUDA
& $py -m pip install torch torchaudio --index-url "https://download.pytorch.org/whl/$index"
& $py -m pip install -r requirements.txt
& $py -c "import torch; print('CUDA:', torch.cuda.is_available())"
