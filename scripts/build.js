// scripts/build.js
// Cloudfiles Windows 发行版构建脚本
// 将应用文件 + Node.js 运行时打包到 dist/ 目录

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'cloudfiles');

const version = process.argv[2] ||
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const SERVER_BAT = `@echo off
chcp 65001 >nul
title Cloudfiles Server
cd /d "%~dp0"
set "PATH=%~dp0;%PATH%"

echo.
echo ========================================
echo   Cloudfiles v${version}
echo ========================================
echo.

echo [Starting] Server...
echo.

start "Cloudfiles Server" cmd /k "node.exe server.js"

timeout /t 3 /nobreak >nul

echo [Opening] Browser...
start http://localhost:8000

echo.
echo ========================================
echo   Server started!
echo   URL: http://localhost:8000
echo.
echo   Close this window will NOT stop server
echo   To stop: close "Cloudfiles Server" window
echo ========================================
echo.

timeout /t 5 /nobreak >nul
`;

const SETUP_BAT = `@echo off
chcp 65001 >nul
title Cloudfiles Setup
cd /d "%~dp0"
set "PATH=%~dp0;%PATH%"

echo.
echo ========================================
echo   Cloudfiles Setup v${version}
echo ========================================
echo.

node.exe setup.js

echo.
pause
`;

console.log(`\n========================================`);
console.log(`  Building Cloudfiles v${version}`);
console.log(`========================================\n`);

// Step 1: Clean dist
step('Cleaning dist directory');
rmrf(DIST);
fs.mkdirSync(DIST, { recursive: true });

// Step 2: Copy app files
step('Copying application files');
const FILES = ['server.js', 'main.js', 'setup.js', 'package.json', 'package-lock.json'];
const DIRS = [
  { name: 'lib', exclude: ['__tests__'] },
  { name: 'index' },
];

for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, file));
  }
}

for (const dir of DIRS) {
  const src = path.join(ROOT, dir.name);
  if (fs.existsSync(src)) {
    cpDir(src, path.join(DIST, dir.name), dir.exclude || []);
  }
}

// Step 3: Install production dependencies
step('Installing production dependencies');
execSync('npm ci --omit=dev', { cwd: DIST, stdio: 'inherit' });

// Step 4: Copy Node.js runtime
step('Copying Node.js runtime');
const nodeExe = process.execPath;
fs.copyFileSync(nodeExe, path.join(DIST, 'node.exe'));
console.log(`  Node.js: ${process.version}`);
console.log(`  Source: ${nodeExe}`);

// Step 5: Create launcher scripts
step('Creating launcher scripts');
fs.writeFileSync(path.join(DIST, 'Cloudfiles Server.bat'), SERVER_BAT, 'utf8');
fs.writeFileSync(path.join(DIST, 'Cloudfiles Setup.bat'), SETUP_BAT, 'utf8');

console.log(`\n========================================`);
console.log(`  Build complete!`);
console.log(`  Output: ${DIST}`);
console.log(`========================================\n`);

// --- Helpers ---

function step(name) {
  console.log(`\n[${name}]`);
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function cpDir(src, dest, exclude) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      cpDir(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
