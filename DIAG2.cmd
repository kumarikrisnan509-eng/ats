@echo off
cd /d "%~dp0"
set VM=ubuntu@141.148.192.4
set KEY=C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key

echo === ss listening ports ===
ssh -i "%KEY%" "%VM%" "sudo ss -tlnp | grep -E '8080|nginx'"
echo.
echo === curl from host to 127.0.0.1:8080 ===
ssh -i "%KEY%" "%VM%" "curl -sv http://127.0.0.1:8080/api/health 2>&1 | tail -25"
echo.
echo === curl from host to localhost:8080 ===
ssh -i "%KEY%" "%VM%" "curl -sv http://localhost:8080/api/health 2>&1 | tail -10"
echo.
echo === docker inspect ports ===
ssh -i "%KEY%" "%VM%" "sudo docker port ats-backend"
echo.
echo === nginx status ===
ssh -i "%KEY%" "%VM%" "sudo systemctl is-active nginx && sudo nginx -t 2>&1"
echo.
echo === nginx error log (last 20) ===
ssh -i "%KEY%" "%VM%" "sudo tail -20 /var/log/nginx/error.log"
echo.
pause
