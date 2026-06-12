// lib/upload.js
// 描述: 封装文件上传的复杂逻辑，包括(并行)分块、重试和递归目录处理。
// 使用 Cloudflare REST API 替代 Wrangler CLI

import fs from 'fs';
import path from 'path';
import { CHUNK_SIZE, TEMP_CHUNK_DIR, MAX_RETRIES, DATA_PROJECT_NAME, MAX_WORKERS } from './config.js';
import { now } from './utils.js';
import { deployFile, deployFiles } from './api.js';

/**
 * (内部函数) 将大文件分割成多个临时分块文件
 * @param {string} fullPath - 文件的完整本地路径
 * @param {string} chunkStagingDir - 存放分块的临时目录
 * @returns {Promise<Array<object>>} 分块任务列表
 */
async function splitFileIntoChunks(fullPath, chunkStagingDir) {
  const readStream = fs.createReadStream(fullPath, { highWaterMark: CHUNK_SIZE });
  const tasks = [];
  let chunkIndex = 0;

  for await (const chunk of readStream) {
    const chunkFilePath = path.join(chunkStagingDir, `chunk-${chunkIndex}.bin`);
    fs.writeFileSync(chunkFilePath, chunk);
    tasks.push({
      chunkIndex: chunkIndex,
      chunkFilePath: chunkFilePath
    });
    chunkIndex++;
  }
  
  return tasks;
}

/**
 * 上传单个分块到 Cloudflare Pages（通过 REST API）
 * 仅用于单分块文件，多分块文件使用 batchUploadChunks
 * @param {object} task - 任务详情
 * @returns {Promise<string>} 上传后的 URL
 */
async function uploadChunk(task) {
  const { chunkFilePath, chunkIndex, totalChunks } = task;

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks}) 正在上传分块 (尝试 ${attempt}/${MAX_RETRIES})...`);
    
    try {
      const remoteName = `chunk-${chunkIndex}`;
      const url = await deployFile(chunkFilePath, DATA_PROJECT_NAME, remoteName);
      console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks})  成功`);
      return url;
    } catch (error) {
      lastError = error;
      console.warn(`           (并发任务 ${chunkIndex + 1}/${totalChunks})  失败: ${error.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = 2000 * attempt;
        console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks}) 将在 ${delay / 1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`分块 ${chunkIndex} 上传失败，已达到最大重试次数 (${MAX_RETRIES}): ${lastError?.message}`);
}


/**
 * (内部函数) 上传单个大文件，并行处理分块和重试
 * @param {string} fullPath - 文件的完整本地路径
 * @returns {Promise<object>} 文件元数据对象 (用于 main.json)
 */
async function uploadFile(fullPath) {
  const stats = fs.statSync(fullPath);
  const fileSize = stats.size;
  const numChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
  const currentTime = now();

  console.log(`   处理文件: ${path.basename(fullPath)} (大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB, 分块: ${numChunks}, 并发数: ${MAX_WORKERS})`);

  // 1. 处理空文件
  if (fileSize === 0) {
    console.log('           文件为空，跳过上传分块。');
    return { type: 'file', size: 0, chunks: [], createdAt: currentTime, modifiedAt: currentTime };
  }

  // 2. 创建临时分块文件的存放目录
  const chunkStagingDir = path.join(TEMP_CHUNK_DIR, 'chunks', Date.now().toString());
  if (fs.existsSync(chunkStagingDir)) {
    fs.rmSync(chunkStagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(chunkStagingDir, { recursive: true });

  console.log('           正在将文件分割为本地分块...');
  // 3. 先把文件全部分割
  const chunkTasks = await splitFileIntoChunks(fullPath, chunkStagingDir);
  console.log(`            文件分割完毕，共 ${chunkTasks.length} 个分块。`);

  // 4. 批量上传所有分块（共享一次部署，大幅减少 API 调用）
  let results;
  if (chunkTasks.length === 1) {
    // 单分块：直接用 deployFile
    console.log(`           启动上传任务...`);
    const url = await uploadChunk({ ...chunkTasks[0], totalChunks: 1 });
    results = [url];
  } else {
    // 多分块：批量上传，共享一次 JWT + 一次部署
    console.log(`           批量上传 ${chunkTasks.length} 个分块 (共享部署)...`);
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const files = chunkTasks.map(task => ({
          filePath: task.chunkFilePath,
          remoteFileName: `chunk-${task.chunkIndex}`
        }));
        results = await deployFiles(files, DATA_PROJECT_NAME);
        break;
      } catch (error) {
        lastError = error;
        console.warn(`           批量上传失败 (尝试 ${attempt}/${MAX_RETRIES}): ${error.message}`);
        if (attempt < MAX_RETRIES) {
          const delay = 2000 * attempt;
          console.log(`           将在 ${delay / 1000} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw new Error(`批量上传失败，已达到最大重试次数: ${lastError?.message}`);
        }
      }
    }
  }

  // 5. 检查是否有未完成的任务
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      throw new Error(`分块 ${i} 上传失败 (未返回 URL)。`);
    }
  }

  console.log('\n            所有分块均已上传成功。');

  // 6. 清理本地的临时分块目录
  try {
    fs.rmSync(chunkStagingDir, { recursive: true, force: true });
    console.log('            已清理本地临时分块文件。');
  } catch (e) {
    console.warn(`            清理 ${chunkStagingDir} 失败: ${e.message}`);
  }

  // 7. 返回元数据
  return { type: 'file', size: fileSize, chunks: results, createdAt: currentTime, modifiedAt: currentTime };
}


/**
 * 递归上传单个文件或目录
 * @param {string} currentPath - 本地路径
 * @returns {Promise<object>} 节点元数据 (文件或文件夹)
 */
export async function uploadSingleFile(currentPath) {
  if (!fs.existsSync(currentPath)) throw new Error(`路径不存在: ${currentPath}`);
  const stats = fs.statSync(currentPath);

  if (stats.isFile()) {
    return await uploadFile(currentPath);
  }

  if (stats.isDirectory()) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    const currentTime = now();
    const structure = {
      type: 'folder',
      createdAt: currentTime,
      modifiedAt: currentTime,
      children: {}
    };

    console.log(`\n进入目录: ${currentPath}`);

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        structure.children[entry.name] = await uploadSingleFile(fullPath);
      } else if (entry.isFile()) {
        structure.children[entry.name] = [await uploadFile(fullPath)];
      }
    }
    return structure;
  }

  throw new Error('不支持的路径类型: ' + currentPath);
}