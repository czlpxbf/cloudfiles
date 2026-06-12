@echo off
echo.
echo ========================================
echo   Cloudfiles Logout v2.0.0
echo ========================================
echo.

echo [1/1] Resetting config.js...

(
echo // lib/config.js
echo // Description: Global configuration constants
echo
echo import os from 'os';
echo import path from 'path';
echo import { fileURLToPath } from 'url';
echo
echo const __filename = fileURLToPath(import.meta.url);
echo const __dirname = path.dirname(__filename);
echo const PROJECT_ROOT = path.resolve(__dirname, '..');
echo
echo // ========================================
echo // User Configuration - Please modify
echo // ========================================
echo
echo // Cloudflare API Token
echo export const CLOUDFLARE_API_TOKEN = 'your-api-token';
echo
echo // Cloudflare Account ID
echo export const CLOUDFLARE_ACCOUNT_ID = '';
echo
echo // Main project name
echo export const MAIN_PROJECT_NAME = 'your-project-name';
echo
echo // Data project name
echo export const DATA_PROJECT_NAME = 'your-project-name-data';
echo
echo // Main project URL
echo export const MAIN_PROJECT_URL = 'https://your-project-name.pages.dev';
echo
echo // ========================================
echo // System Configuration - Usually no need to modify
echo // ========================================
echo
echo export const UPDATE_DIR = path.join(PROJECT_ROOT, 'update');
echo export const DOWNLOAD_DIR = path.join(PROJECT_ROOT, 'download');
echo export const CHUNK_DIR = path.join(PROJECT_ROOT, 'chunks');
echo export const PREVIEW_CACHE_DIR = path.join(PROJECT_ROOT, 'preview_cache');
echo export const CHUNK_SIZE = 25 * 1024 * 1024;
echo export const TEMP_SITE_DIR = path.join(PROJECT_ROOT, 'temp-cloudfiles-site');
echo export const TEMP_CHUNK_DIR = path.join(PROJECT_ROOT, 'temp-chunk-upload');
echo export const MAX_RETRIES = 5;
echo
echo export const MAX_WORKERS = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2) || 1));
echo export const DISTRIBUTED_ARCHITECTURE = false;
) > "%~dp0lib\config.js"

echo.
echo ========================================
echo   Done! Config has been reset.
echo ========================================
echo.
pause