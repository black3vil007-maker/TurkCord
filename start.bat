@echo off
echo ========================================================
echo   TurkCord - Baslatiliyor (WebRTC & Sinyal Sunucusu)
echo ========================================================

start "TurkCord Server (Port 4000)" cmd /k "cd server && npm start"
timeout /t 2 /nobreak >nul
start "TurkCord Client (Port 3000)" cmd /k "cd client && npm run dev"

echo.
echo Sunucu ve Arayuz ayaga kalkti!
echo Tarayicinizda http://localhost:3000 adresini acabilirsiniz.
echo.
pause
