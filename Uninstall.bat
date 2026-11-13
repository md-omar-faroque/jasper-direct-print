@echo off
title Jasper Direct Print - Uninstall
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jasper.directprint" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.jasper.directprint" /f >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\JasperDirectPrint" >nul 2>&1
echo Native host removed. Now remove the extension from chrome://extensions.
pause
