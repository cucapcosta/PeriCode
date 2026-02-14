import { ipcMain, app } from "electron";
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export function registerCommandHandlers(): void {
  ipcMain.handle(
    "command:openVSCode",
    async (_event, projectPath: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        execFile("code", [projectPath], { shell: true }, (err) => {
          if (err) {
            reject(new Error(`Failed to open VSCode: ${err.message}`));
          } else {
            resolve();
          }
        });
      });
    }
  );

  // Dev-only: rebuild is excluded from CI release builds (injected at build time)
  if (!__CI_BUILD__) {
  ipcMain.handle(
    "command:rebuild",
    async (_event, projectPath: string): Promise<void> => {
      // Create a batch script that:
      // 1. Waits for PeriCode to close
      // 2. Runs npm run make (builds the distributable)
      // 3. Opens the built app
      // 4. Deletes itself
      const isWin = process.platform === "win32";
      const scriptName = isWin ? "pericode-rebuild.bat" : "pericode-rebuild.sh";
      const scriptPath = path.join(os.tmpdir(), scriptName);

      if (isWin) {
        const squirrelDir = path.join(projectPath, "out", "make", "squirrel.windows", "x64").replace(/\\/g, "\\\\");

        const batchContent = `@echo off
title PeriCode Rebuild
echo Waiting for PeriCode to close...
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   Building PeriCode (npm run make)...
echo ========================================
echo.

cd /d "${projectPath}"
call npm run make

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Build failed! Press any key to exit...
    pause >nul
    del "%~f0"
    exit /b 1
)

echo.
echo ========================================
echo   Installing PeriCode...
echo ========================================
echo.

set "INSTALLER_DIR=${squirrelDir}"
set "SETUP_EXE="
for %%f in ("%INSTALLER_DIR%\\*Setup.exe") do (
    set "SETUP_EXE=%%f"
)

if defined SETUP_EXE (
    echo Running installer: %SETUP_EXE%
    start "" "%SETUP_EXE%"
    timeout /t 2 /nobreak >nul
) else (
    echo.
    echo Could not find Setup.exe in %INSTALLER_DIR%
    echo Please install manually.
    pause
)

echo.
echo Done! You can close this window.
del "%~f0"
`;
        fs.writeFileSync(scriptPath, batchContent, { encoding: "utf8" });

        spawn("cmd.exe", ["/c", "start", "cmd.exe", "/c", scriptPath], {
          detached: true,
          stdio: "ignore",
          shell: true,
        }).unref();
      } else {
        const appName = "pericode";
        const macAppPath = path.join(projectPath, "out", `${appName}-darwin-x64`, `${appName}.app`);
        const linuxAppPath = path.join(projectPath, "out", `${appName}-linux-x64`, appName);

        const shellContent = `#!/bin/bash
echo "Waiting for PeriCode to close..."
sleep 2

echo ""
echo "========================================"
echo "  Building PeriCode (npm run make)..."
echo "========================================"
echo ""

cd "${projectPath}"
npm run make

if [ $? -ne 0 ]; then
    echo ""
    echo "Build failed!"
    read -p "Press Enter to exit..."
    rm -f "$0"
    exit 1
fi

echo ""
echo "========================================"
echo "  Starting PeriCode..."
echo "========================================"
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
    if [ -d "${macAppPath}" ]; then
        open "${macAppPath}"
    else
        echo "Could not find built app at ${macAppPath}"
        echo "Please start manually from: ${projectPath}/out"
    fi
else
    if [ -f "${linuxAppPath}" ]; then
        "${linuxAppPath}" &
    else
        echo "Could not find built app at ${linuxAppPath}"
        echo "Please start manually from: ${projectPath}/out"
    fi
fi

rm -f "$0"
`;
        fs.writeFileSync(scriptPath, shellContent, { encoding: "utf8", mode: 0o755 });

        const terminal = process.platform === "darwin" ? "open" : "x-terminal-emulator";
        const args = process.platform === "darwin"
          ? ["-a", "Terminal", scriptPath]
          : ["-e", scriptPath];

        spawn(terminal, args, {
          detached: true,
          stdio: "ignore",
        }).unref();
      }

      setTimeout(() => {
        app.quit();
      }, 500);
    }
  );
  } // end dev-only rebuild guard

  ipcMain.handle(
    "command:build",
    async (_event, projectPath: string, buildCommand: string): Promise<{ success: boolean; output: string }> => {
      const isWin = process.platform === "win32";

      return new Promise((resolve) => {
        const child = spawn(buildCommand, {
          cwd: projectPath,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";

        child.stdout?.on("data", (data) => {
          output += data.toString();
        });

        child.stderr?.on("data", (data) => {
          output += data.toString();
        });

        child.on("close", (code) => {
          resolve({
            success: code === 0,
            output: output.trim(),
          });
        });

        child.on("error", (err) => {
          resolve({
            success: false,
            output: `Failed to start build: ${err.message}`,
          });
        });
      });
    }
  );
}
