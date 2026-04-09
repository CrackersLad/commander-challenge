@echo off

:: 1. Protect your local changes by committing them first
git add .
IF "%~1"=="" (
    git commit -m "Auto-update"
) ELSE (
    git commit -m "%~1"
)

:: 2. Download auto-version bumps and merge them (without opening the Vim text editor)
git pull --no-edit

:: 3. Send the final package to GitHub
git push