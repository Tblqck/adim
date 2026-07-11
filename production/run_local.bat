@echo off
cd /d C:\Users\MSI\Documents\id\development\admin\production
python -m uvicorn local_server:app --port 8000 --reload
pause
