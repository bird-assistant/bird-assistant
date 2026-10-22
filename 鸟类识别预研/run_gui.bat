@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [错误] 未找到 .venv
  echo 请先按 README 的「安装」一节创建虚拟环境并安装依赖。
  pause
  exit /b 1
)

echo 启动测试台... 关闭本窗口即结束程序。
".venv\Scripts\python.exe" "app\gui.py" %*
if errorlevel 1 pause
