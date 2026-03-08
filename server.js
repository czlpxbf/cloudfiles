import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import cors from 'cors';
import { execa } from 'execa';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import mime from 'mime-types';
import { rimraf } from 'rimraf';
import heicConvert from 'heic-convert';
import ExifReader from 'exifreader';
import { EventEmitter } from 'events';
import * as config from './lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverversion = "v1.0.0"; 
const PORT = 8000; 

// Use paths from config.js
const CHUNK_DIR = config.CHUNK_DIR;
const UPDATE_DIR = config.UPDATE_DIR;
const DOWNLOAD_DIR = config.DOWNLOAD_DIR;
const PREVIEW_CACHE_DIR = config.PREVIEW_CACHE_DIR;
const DEPLOY_SCRIPT = path.join(__dirname, 'main.js');

if (!fs.existsSync(CHUNK_DIR)) fs.mkdirSync(CHUNK_DIR, { recursive: true });
if (!fs.existsSync(UPDATE_DIR)) fs.mkdirSync(UPDATE_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
if (!fs.existsSync(PREVIEW_CACHE_DIR)) fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true });

const app = express();

const corsOptions = {
  origin: [config.MAIN_PROJECT_URL, 'http://localhost:3000', 'http://127.0.0.1:5500'], 
  methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// --- 任务管理系统 (SSE 核心) ---
const tasks = new Map();

function createTask() {
    const taskId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5);
    const emitter = new EventEmitter();
    tasks.set(taskId, {
        id: taskId,
        emitter,
        logs: [],
        createdAt: Date.now()
    });
    // 10分钟后自动清理过期任务
    setTimeout(() => {
        tasks.delete(taskId);
    }, 600 * 1000);
    return taskId;
}

function emitTaskEvent(taskId, type, data) {
    const task = tasks.get(taskId);
    if (task) {
        task.emitter.emit('event', { type, data });
        if (type === 'log') task.logs.push(data); 
    }
}

app.get('/api/task/events/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = tasks.get(taskId);

    if (!task) return res.status(404).send('Task not found');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (type, data) => {
        res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    };

    send('connected', { taskId });

    const listener = ({ type, data }) => send(type, data);
    task.emitter.on('event', listener);

    req.on('close', () => {
        task.emitter.off('event', listener);
    });
});

// 通用执行器：运行 CLI 并解析日志发送 SSE
function runTaskWithSSE(taskId, command, args) {
    const subprocess = execa(command, args, { all: true });
    
    subprocess.all.on('data', (chunk) => {
        // [修复] 按行分割日志，防止多个日志合并在同一个 chunk 中导致匹配失败
        const output = chunk.toString();
        const lines = output.split('\n');

        lines.forEach(lineRaw => {
            const line = lineRaw.trim();
            if (!line) return;

            console.log(`[Task ${taskId}] ${line}`);
            emitTaskEvent(taskId, 'log', line);

            // 解析进度
            const progressMatch = line.match(/总进度:\s*([\d.]+)%/);
            if (progressMatch) {
                emitTaskEvent(taskId, 'progress', parseFloat(progressMatch[1]));
            } else {
                const chunkMatch = line.match(/\((?:并发任务|分块)\s+(\d+)\/(\d+)\)/);
                if (chunkMatch) {
                    const current = parseInt(chunkMatch[1]);
                    const total = parseInt(chunkMatch[2]);
                    const percent = ((current / total) * 100).toFixed(1);
                    emitTaskEvent(taskId, 'progress', parseFloat(percent));
                }
            }

            // [核心修复] 捕获下载完成后的本地路径
            // 之前这里用的是 startsWith，如果前面有换行符就会失败
            if (line.includes('DOWNLOAD_PATH:')) {
                const parts = line.split('DOWNLOAD_PATH:');
                if (parts.length > 1) {
                    const downloadPath = parts[1].trim();
                    const filename = path.basename(downloadPath);
                    console.log(`[Task ${taskId}] Capture Download: ${filename}`);
                    emitTaskEvent(taskId, 'download_ready', filename);
                }
            }
        });
    });

    subprocess.then(() => {
        emitTaskEvent(taskId, 'complete', true);
    }).catch((err) => {
        console.error(`Task ${taskId} failed:`, err);
        emitTaskEvent(taskId, 'error', err.message);
    });
}

// --- 文件上传处理 ---

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { uploadId } = req.params;
    if (!uploadId) return cb(new Error('Missing uploadId'));
    const chunkPath = path.join(CHUNK_DIR, uploadId);
    if (!fs.existsSync(chunkPath)) fs.mkdirSync(chunkPath, { recursive: true });
    cb(null, chunkPath);
  },
  filename: (req, file, cb) => {
    cb(null, req.params.chunkIndex);
  }
});

const upload = multer({ storage });

async function getShootingTime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.heic', '.heif'].includes(ext)) return null;
  try {
    const fileBuffer = await fs.promises.readFile(filePath);
    const tags = ExifReader.load(fileBuffer, { expanded: true });
    let exifTags = tags.exif || (tags.ifd0 ? tags.ifd0.exif : tags.ifd0);
    
    if (exifTags) {
      const originalDateTag = exifTags.DateTimeOriginal || exifTags.CreateDate;
      if (originalDateTag && originalDateTag.description) {
        const parts = originalDateTag.description.match(/(\d{4}):(\d{2}):(\d{2})\s(\d{2}):(\d{2}):(\d{2})/);
        if (parts) {
          const d = new Date(Date.UTC(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]), parseInt(parts[4]), parseInt(parts[5]), parseInt(parts[6])));
          if (!isNaN(d.getTime())) return d.toISOString();
        }
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

app.get('/api/upload-status/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const chunkDir = path.join(CHUNK_DIR, uploadId);
  try {
    if (fs.existsSync(chunkDir)) {
      const uploadedChunks = await fs.promises.readdir(chunkDir);
      res.json({ uploadedChunks });
    } else {
      res.json({ uploadedChunks: [] });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get upload status.' });
  }
});

app.post('/api/upload-chunk/:uploadId/:chunkIndex', upload.single('chunk'), (req, res) => {
  res.status(200).json({ message: 'Chunk uploaded' });
});

app.post('/api/upload-complete', async (req, res) => {
  const { uploadId, filename, remotePath } = req.body;
  if (!uploadId || !filename || !remotePath) return res.status(400).json({ error: 'Missing params' });

  const chunkDir = path.join(CHUNK_DIR, uploadId);
  const finalFilePath = path.join(UPDATE_DIR, filename);

  try {
    if (!fs.existsSync(chunkDir)) return res.status(404).json({ error: 'Chunk dir not found' });
    const chunkFiles = await fs.promises.readdir(chunkDir);
    chunkFiles.sort((a, b) => parseInt(a) - parseInt(b));

    const writeStream = fs.createWriteStream(finalFilePath);
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(chunkDir, chunkFile);
      const readStream = fs.createReadStream(chunkPath);
      await new Promise((resolve, reject) => {
        readStream.pipe(writeStream, { end: false });
        readStream.on('end', resolve);
        readStream.on('error', reject);
      });
    }
    writeStream.end();
    await rimraf(chunkDir);

    const taskId = createTask();
    const remoteTargetPath = path.posix.join(remotePath, filename);
    
    (async () => {
        try {
            const shotAt = await getShootingTime(finalFilePath);
            const execArgs = [DEPLOY_SCRIPT, 'up', finalFilePath, remoteTargetPath];
            if (shotAt) execArgs.push('--shot-at', shotAt);
            runTaskWithSSE(taskId, 'node', execArgs);
        } catch (e) {
            emitTaskEvent(taskId, 'error', e.message);
        }
    })();

    res.status(200).json({ ok: true, taskId });

  } catch (error) {
    res.status(500).json({ error: 'Merge failed: ' + error.message });
  }
});

app.get('/api/list', async (req, res) => {
  try {
    const r = await fetch(`${config.MAIN_PROJECT_URL}/main.json?t=${Date.now()}`); 
    if (!r.ok) return res.status(500).json({ error: 'Fetch main.json failed' });
    const json = await r.json();
    res.json(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新: 准备下载任务
app.post('/api/prepare-download', async (req, res) => {
    const { path: filePath, timestamp } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Missing path' });

    const taskId = createTask();
    const execArgs = [DEPLOY_SCRIPT, 'dl', filePath];
    if (timestamp) execArgs.push(timestamp);

    runTaskWithSSE(taskId, 'node', execArgs);

    res.json({ ok: true, taskId });
});

// 新: 服务下载好的文件
app.get('/api/serve-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(DOWNLOAD_DIR, filename);
    
    // 安全检查，防止路径遍历
    if (filename.includes('..') || filename.includes('/')) {
        return res.status(400).send('Invalid filename');
    }

    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (err) {
                // 如果客户端中断下载，这里会报错，通常忽略
                if (!res.headersSent) res.status(500).send('Transfer failed');
            } else {
                // 下载完成后是否删除？目前保留，让用户手动或定时任务清理
                // fs.unlinkSync(filePath); 
            }
        });
    } else {
        res.status(404).send('File not found or expired');
    }
});

// 保留旧接口
app.get('/api/download', async (req, res) => {
    const { path: filePath, timestamp } = req.query;
    if (!filePath) return res.status(400).send('Missing path');
    
    try {
      const execArgs = [DEPLOY_SCRIPT, 'dl', filePath];
      if (timestamp) execArgs.push(timestamp);
      
      const subprocess = execa('node', execArgs, { stderr: 'inherit' });
      const { stdout } = await subprocess;
      
      let downloadedFilePath = null;
      const lines = stdout.split('\n');
      for (const line of lines) {
          if (line.startsWith('DOWNLOAD_PATH:')) {
              downloadedFilePath = line.substring('DOWNLOAD_PATH:'.length).trim();
              break;
          }
      }
      const localFile = downloadedFilePath || path.join(DOWNLOAD_DIR, path.basename(filePath));
      if (!fs.existsSync(localFile)) return res.status(500).send('Download failed');
      res.download(localFile);
    } catch (err) {
      res.status(500).send('Download failed: ' + err.message);
    }
});

app.get('/api/preview', async (req, res) => {
  const { path: filePath, timestamp, force } = req.query;
  if (!filePath) return res.status(400).send('Missing path');
  
  try {
    const fileExt = path.extname(filePath).toLowerCase();
    const isHeif = fileExt === '.heic' || fileExt === '.heif';
    const isText = ['.txt', '.md', '.json', '.js', '.ts', '.css', '.scss', '.html', '.htm', '.xml', '.yaml', '.yml', '.ini', '.conf', '.cfg', '.log', '.csv', '.sh', '.bat', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.sql', '.vue', '.jsx', '.tsx'].includes(fileExt);
    
    const cacheKeyBase = (filePath + (timestamp || 'latest')).replace(/[^a-z0-9]/gi, '_');
    const cacheExt = isHeif ? '.jpg' : (isText ? '.txt' : fileExt);
    const cacheMimeType = isHeif ? 'image/jpeg' : (isText ? 'text/plain; charset=utf-8' : (mime.lookup(filePath) || 'application/octet-stream'));
    const cacheFilePath = path.join(PREVIEW_CACHE_DIR, `${cacheKeyBase}${cacheExt}`);
    
    // 检查缓存
    if (fs.existsSync(cacheFilePath)) {
      res.setHeader('Content-Type', cacheMimeType);
      fs.createReadStream(cacheFilePath).pipe(res);
      return;
    }

    // 下载文件
    const execArgs = [DEPLOY_SCRIPT, 'dl', filePath];
    if (timestamp) execArgs.push(timestamp);

    const subprocess = execa('node', execArgs, { stderr: 'inherit' });
    const { stdout } = await subprocess;
    
    let downloadedFilePath = null;
    const lines = stdout.split('\n');
    for (const line of lines) {
        if (line.startsWith('DOWNLOAD_PATH:')) {
            downloadedFilePath = line.substring('DOWNLOAD_PATH:'.length).trim();
            break;
        }
    }
    const localFile = downloadedFilePath || path.join(DOWNLOAD_DIR, path.basename(filePath));
    if (!fs.existsSync(localFile)) return res.status(500).send('Preview download failed');

    // 获取文件大小
    const fileStat = fs.statSync(localFile);
    const fileSize = fileStat.size;

    // 处理不同类型文件
    if (isHeif) {
        const inputBuffer = await fs.promises.readFile(localFile);
        const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 0.9 });
        await fs.promises.writeFile(cacheFilePath, outputBuffer);
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(outputBuffer);
    } else if (isText) {
        // 文本文件处理
        const textContent = await fs.promises.readFile(localFile, 'utf-8');
        await fs.promises.writeFile(cacheFilePath, textContent);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(textContent);
    } else {
        // 其他文件：流式传输
        const readStream = fs.createReadStream(localFile);
        const writeStream = fs.createWriteStream(cacheFilePath);
        readStream.pipe(writeStream);
        res.setHeader('Content-Type', cacheMimeType);
        readStream.pipe(res);
    }
  } catch (err) {
    res.status(500).send('Preview failed: ' + err.message);
  }
});

// 新增：获取文件信息（大小等）
app.get('/api/file-info', async (req, res) => {
  const { path: filePath, timestamp } = req.query;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });
  
  try {
    // 先检查缓存
    const fileExt = path.extname(filePath).toLowerCase();
    const cacheKeyBase = (filePath + (timestamp || 'latest')).replace(/[^a-z0-9]/gi, '_');
    const cacheExt = fileExt;
    const cacheFilePath = path.join(PREVIEW_CACHE_DIR, `${cacheKeyBase}${cacheExt}`);
    
    if (fs.existsSync(cacheFilePath)) {
      const stat = fs.statSync(cacheFilePath);
      return res.json({ 
        size: stat.size, 
        cached: true,
        ext: fileExt
      });
    }
    
    // 检查download目录
    const downloadPath = path.join(DOWNLOAD_DIR, path.basename(filePath));
    if (fs.existsSync(downloadPath)) {
      const stat = fs.statSync(downloadPath);
      return res.json({ 
        size: stat.size, 
        cached: false,
        ext: fileExt
      });
    }
    
    // 需要从云端获取文件大小 - 通过main.js的list命令
    // 这里简化处理，返回需要下载的标志
    res.json({ 
      size: null, 
      cached: false,
      ext: fileExt,
      needDownload: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增：清理缓存API
app.post('/api/clear-cache', (req, res) => {
  try {
    if (fs.existsSync(PREVIEW_CACHE_DIR)) {
      const files = fs.readdirSync(PREVIEW_CACHE_DIR);
      let cleared = 0;
      files.forEach(file => {
        const filePath = path.join(PREVIEW_CACHE_DIR, file);
        fs.unlinkSync(filePath);
        cleared++;
      });
      res.json({ ok: true, cleared });
    } else {
      res.json({ ok: true, cleared: 0 });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/remove', async (req, res) => {
  try {
    const p = req.body.path || req.query.path;
    if (!p) return res.status(400).json({ error: 'Missing path' });
    await execa('node', [DEPLOY_SCRIPT, 'rm', p], { stderr: 'inherit', stdout: 'inherit' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/mkdir', async (req, res) => {
  try {
    const { path: p, view } = req.body;
    if (!p) return res.status(400).json({ error: 'Missing path' });
    const execArgs = [DEPLOY_SCRIPT, 'mkdir', p];
    if (view) execArgs.push('--view', view);
    await execa('node', execArgs, { stderr: 'inherit', stdout: 'inherit' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rename', async (req, res) => {
  try {
    const { src, dest } = req.body;
    if (!src || !dest) return res.status(400).json({ error: 'Missing src/dest' });
    await execa('node', [DEPLOY_SCRIPT, 'mv', src, dest], { stderr: 'inherit', stdout: 'inherit' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clean-versions', async (req, res) => {
  try {
    const { target, path: filePath } = req.body;
    const execArgs = [DEPLOY_SCRIPT, 'cv'];
    if (target) execArgs.push('--target', target);
    if (filePath) execArgs.push('--path', filePath);
    
    await execa('node', execArgs, { stderr: 'inherit', stdout: 'inherit' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rename-version', async (req, res) => {
    try {
      const { filePath, createdAt, name } = req.body;
      if (!filePath || !createdAt) return res.status(400).json({ error: 'Missing args' });
      const execArgs = [DEPLOY_SCRIPT, 'rv', filePath, createdAt];
      execArgs.push(name || "");
      await execa('node', execArgs, { stderr: 'inherit', stdout: 'inherit' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
});

app.get(/.*/, async (req, res) => {
  try {
    const indexDir = path.join(__dirname, 'index');
    let requestedPath = req.path;
    if (requestedPath.endsWith('/')) requestedPath += 'index.html';

    let filePath = path.join(indexDir, requestedPath);
    let fileExists = false;

    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile()) fileExists = true;
    } catch (e) {}

    if (!fileExists) {
      const ext = path.extname(requestedPath);
      if (!ext || (req.headers.accept && req.headers.accept.includes('text/html'))) {
        const fallbackPath = path.join(indexDir, 'index.html');
        if (fs.existsSync(fallbackPath)) {
          filePath = fallbackPath;
          fileExists = true;
        }
      }
    }

    if (fileExists) {
      if (filePath.endsWith('.html')) {
        let htmlContent = await fs.promises.readFile(filePath, 'utf-8');
        const injectedHtml = htmlContent.replace(
          '\'%%MAIN_PROJECT_URL%%\'',
          JSON.stringify(config.MAIN_PROJECT_URL)
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(injectedHtml);
      } else {
        res.sendFile(filePath);
      }
    } else {
      res.status(404).send('Not Found');
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

app.listen(PORT, () => {
  console.log(` HTTP server running on port ${PORT}`);
  console.log(`Version: ${serverversion}`);
});

// ========================================
// 关闭时清理缓存
// ========================================
function clearPreviewCache() {
  try {
    if (fs.existsSync(PREVIEW_CACHE_DIR)) {
      const files = fs.readdirSync(PREVIEW_CACHE_DIR);
      files.forEach(file => {
        const filePath = path.join(PREVIEW_CACHE_DIR, file);
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // 忽略删除失败的文件
        }
      });
      console.log(`[Exit] Cleared ${files.length} preview cache files`);
    }
  } catch (err) {
    console.error('[Exit] Failed to clear preview cache:', err.message);
  }
}

// 监听进程退出事件
process.on('SIGINT', () => {
  console.log('\n[Exit] Received SIGINT, cleaning up...');
  clearPreviewCache();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Exit] Received SIGTERM, cleaning up...');
  clearPreviewCache();
  process.exit(0);
});

// Windows 特有的关闭事件
if (process.platform === 'win32') {
  process.on('SIGHUP', () => {
    console.log('\n[Exit] Received SIGHUP, cleaning up...');
    clearPreviewCache();
    process.exit(0);
  });
}