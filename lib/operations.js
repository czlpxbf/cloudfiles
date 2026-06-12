// lib/operations.js
// 描述: 封装所有用户可执行的核心操作 (API)。
// 修复 (最终稳定版): 
// 1. [日志策略] 增强“分块任务式”日志，在每个分块完成时打印详细的进度、大小和速度信息。
// 2. [并发机制] 弃用 PQueue，使用原生 Promise 并发池 (同 upload.js)。
// 3. [稳定性] 保持 6 线程并发与重试机制。

import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import crypto from 'crypto';
import https from 'https';

// 导入配置
import { DOWNLOAD_DIR, MAIN_PROJECT_NAME, DATA_PROJECT_NAME, CHUNK_SIZE } from './config.js';

// 导入工具
import { getMainProjectUrl, now } from './utils.js';

// 导入 API
import { listProjects, createProject } from './api.js';

// 导入状态和树逻辑
import { downloadRemoteIndex, deployIndex } from './state.js';
import {
  updateParentTimestamps,
  findFileInTree,
  findFileByTimestamp,
  findAndRemoveNodeFromTree,
  removeNodeAt,
  insertNodeAt
} from './tree.js';

// 导入上传逻辑
import { uploadSingleFile } from './upload.js';

// --- 配置高性能 HTTPS Agent ---
const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 200,
  maxFreeSockets: 20,
  timeout: 120000
});

// --- 辅助函数：格式化字节大小 ---
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 初始化检查
 */
export async function initializeProjectsAndIndex() {
  console.log('\n--- 开始环境初始化检查 ---');
  const projects = await listProjects();

  if (!projects.includes(MAIN_PROJECT_NAME)) {
    console.log(`主项目 ${MAIN_PROJECT_NAME} 不存在，即将创建...`);
    await createProject(MAIN_PROJECT_NAME);
    console.log(` 主项目 ${MAIN_PROJECT_NAME} 创建成功`);

    console.log('...正在为新项目部署一个空的 main.json 目录...');
    const emptyIndex = {
      fs_root: {
        type: 'folder',
        createdAt: now(),
        modifiedAt: now(),
        children: {}
      }
    };
    await deployIndex(emptyIndex);
    console.log(` 空的 main.json 部署成功`);
  } else {
    console.log(` 主项目 ${MAIN_PROJECT_NAME} 已存在`);
  }

  if (!projects.includes(DATA_PROJECT_NAME)) {
    console.log(`数据项目 ${DATA_PROJECT_NAME} 不存在，即将创建...`);
    await createProject(DATA_PROJECT_NAME);
    console.log(` 数据项目 ${DATA_PROJECT_NAME} 创建成功`);
  } else {
    console.log(` 数据项目 ${DATA_PROJECT_NAME} 已存在`);
  }
  console.log('--- 环境初始化检查完成 ---\n');
}

/**
 * 操作: 创建文件夹
 */
export async function handleMkdir(folderPath, view = null) {
  console.log(`--- 开始创建文件夹: "${folderPath}" ${view ? `(类型: ${view})` : ''} ---`);
  const projectUrl = await getMainProjectUrl();
  if (!projectUrl) return;
  let remoteJson = await downloadRemoteIndex(projectUrl);

  const parts = folderPath.split('/').filter(p => p);
  let current = remoteJson.fs_root;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLastPart = i === parts.length - 1;

    if (!current.children[part]) {
      const newFolder = {
        type: 'folder',
        createdAt: now(),
        modifiedAt: now(),
        children: {}
      };
      if (isLastPart && view) {
        newFolder.view = view;
        console.log(`... 设置 ${part} 的 view 为 "${view}"`);
      }
      current.children[part] = newFolder;
    } else if (current.children[part].type !== 'folder') {
      throw new Error(`路径冲突：一个名为 "${part}" 的文件已存在。`);
    } else if (isLastPart && view) {
      console.log(`... 文件夹 ${part} 已存在，更新其 view 为 "${view}"`);
      current.children[part].view = view;
      current.children[part].modifiedAt = now();
    }
    current = current.children[part];
  }

  updateParentTimestamps(remoteJson.fs_root, parts);
  await deployIndex(remoteJson);

  console.log(' mkdir 完成');
}

/**
 * 操作: 移除
 */
export async function handleRemove(itemPath) {
  console.log(`--- 开始执行删除流程 (目标路径: "${itemPath}") ---`);
  const projectUrl = await getMainProjectUrl();
  if (!projectUrl) return;
  let remoteJson = await downloadRemoteIndex(projectUrl);

  console.log(`\n正在从目录结构中移除 "${itemPath}"...`);
  const success = findAndRemoveNodeFromTree(remoteJson.fs_root, itemPath);

  if (success) {
    console.log(` 已成功从目录结构中移除条目。`);
    await deployIndex(remoteJson);
    console.log(` 已成功部署更新后的目录。`);
  } else {
    console.error(` 错误：在远程目录中未找到路径 "${itemPath}"。无任何更改。`);
  }
}

/**
 * 操作: 移动
 */
export async function handleMove(srcPath, destPath) {
  console.log(`--- 开始移动/重命名: "${srcPath}" -> "${destPath}" ---`);
  const projectUrl = await getMainProjectUrl();
  if (!projectUrl) return;
  let remoteJson = await downloadRemoteIndex(projectUrl);

  const srcParts = srcPath.split('/').filter(p => p);
  const destParts = destPath.split('/').filter(p => p);

  const node = removeNodeAt(remoteJson.fs_root, srcParts);
  if (!node) {
    console.error(' 源路径不存在：' + srcPath);
    return;
  }

  try {
    insertNodeAt(remoteJson.fs_root, destParts, node);
  } catch (e) {
    console.error(' 插入目标失败：', e.message);
    insertNodeAt(remoteJson.fs_root, srcParts, node);
    throw e;
  }

  await deployIndex(remoteJson);
  console.log(' mv 完成');
}

/**
 * 操作: 上传
 */
export async function handleUpload(localPath, remotePath, options = {}) {
  console.log(`--- 开始执行上传流程 (版本控制已启用) ---`);
  console.log(`本地源: ${localPath}`);
  console.log(`远程目标: ${remotePath}`);

  const projectUrl = await getMainProjectUrl();
  let remoteJson = await downloadRemoteIndex(projectUrl);

  if (!fs.existsSync(localPath)) {
    console.log(` 源文件或目录不存在: ${localPath}`);
    return;
  }

  console.log(`\n 准备上传: ${localPath} → ${remotePath}`);
  
  const newNode = await uploadSingleFile(localPath);

  const { shotAt } = options;
  if (shotAt && newNode.type === 'file') {
    newNode.shotAt = shotAt;
    console.log(`... 记录拍摄时间: ${shotAt}`);
  }

  console.log(` 已处理内容: ${path.basename(localPath)}`);

  const parts = remotePath.split('/').filter(p => p);
  if (parts.length === 0) {
    console.error(' 不能上传到根目录。请指定一个文件名或路径。');
    return;
  }

  const leafName = parts[parts.length - 1];
  const parentParts = parts.slice(0, -1);

  let parentNode = remoteJson.fs_root;
  for (const part of parentParts) {
    if (!parentNode.children[part] || parentNode.children[part].type !== 'folder') {
      console.error(` 远程父目录不存在或路径中包含文件: /${parentParts.join('/')}`);
      return;
    }
    parentNode = parentNode.children[part];
  }

  const existingNode = parentNode.children[leafName];

  if (newNode.type === 'file') {
    if (!existingNode) {
      parentNode.children[leafName] = [newNode];
      console.log(` 新文件已创建: ${leafName}`);
    } else if (Array.isArray(existingNode)) {
      existingNode.push(newNode);
      console.log(` 新版本已添加: ${leafName} (共 ${existingNode.length} 个版本)`);
    } else {
      console.error(` 上传失败：一个名为 "${leafName}" 的文件夹已存在于目标位置。`);
      return;
    }
  } else {
    // 文件夹上传逻辑简化
    if (newNode.type === 'folder') {
        if (existingNode) {
            console.error(` 上传失败：目标位置已存在同名项目。`);
            return;
        }
        parentNode.children[leafName] = newNode;
        console.log(` 新文件夹已创建: ${leafName}`);
    } else {
        // 兼容性处理
        if (!existingNode) {
            parentNode.children[leafName] = [newNode];
            console.log(` 新文件已创建: ${leafName}`);
        } else if (Array.isArray(existingNode)) {
            existingNode.push(newNode);
            console.log(` 新版本已添加: ${leafName} (共 ${existingNode.length} 个版本)`);
        } else {
            console.error(` 上传失败：目标位置已存在文件夹。`);
            return;
        }
    }
  }

  updateParentTimestamps(remoteJson.fs_root, parts);

  try {
    await deployIndex(remoteJson);
    console.log(' 索引已部署');
  } catch (deployErr) {
    console.error(' 部署索引失败：', deployErr.message);
    throw deployErr;
  }

  console.log('--- 上传流程结束 ---');
}


/**
 * 操作: 下载一个文件
 * 降级版修复：仿照 upload.js 使用原生 Promise 递归池，移除 PQueue 依赖。
 * 新增：在分块下载完成时打印大小、进度和速度。
 */
export async function handleDownload(filePath, timestamp = null) {
  console.log('--- 开始执行下载流程 ---');

  const projectUrl = await getMainProjectUrl();
  if (!projectUrl) return;

  const remoteJson = await downloadRemoteIndex(projectUrl);

  console.log(`\n正在目录中查找文件: ${filePath}...`);
  
  let fileNode;
  if (timestamp) {
    fileNode = findFileByTimestamp(remoteJson.fs_root, filePath, timestamp);
    if (!fileNode) {
        console.error(` 未找到版本 ${timestamp}，尝试下载最新版本。`);
    }
  }

  if (!fileNode) {
    fileNode = findFileInTree(remoteJson.fs_root, filePath);
  }

  if (!fileNode) {
    console.error(` 错误：在远程目录中未找到文件 "${filePath}"。`);
    return;
  }

  const totalSize = fileNode.size || 0; 
  console.log(` 准备下载: ${filePath}`);
  console.log(`   版本: ${fileNode.createdAt}`);
  console.log(`   大小: ${formatBytes(totalSize)}`);
  console.log(`   分块: ${fileNode.chunks.length} 个`);

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);
  
  const baseName = path.basename(filePath);
  let outputName = baseName;
  if (timestamp) {
      const safeTimestamp = new Date(fileNode.createdAt).toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const ext = path.extname(baseName);
      const nameWithoutExt = path.basename(baseName, ext);
      outputName = `${nameWithoutExt}_${safeTimestamp}${ext}`;
  }
  const outputPath = path.join(DOWNLOAD_DIR, outputName);

  if (fileNode.chunks.length === 0) {
    fs.writeFileSync(outputPath, '');
    console.log(`\n 文件为空，已创建。`);
    return;
  }

  // 使用文件路径的哈希作为临时目录名，支持断点续传
  const fileHash = crypto.createHash('md5').update(filePath).digest('hex');
  const tempDir = path.join(DOWNLOAD_DIR, fileHash);
  const metaPath = path.join(tempDir, '.metadata');
  
  // Windows 兼容性：确保 download 目录存在并稳定
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }
  
  // 创建临时目录（如果不存在）
  if (!fs.existsSync(tempDir)) {
    await fsPromises.mkdir(tempDir, { recursive: true });
  }

  // --- 计算每个分块的预期大小 ---
  // 分块大小固定为 CHUNK_SIZE (25MB)，最后一个分块可能较小
  const chunkSizes = [];
  for (let i = 0; i < fileNode.chunks.length; i++) {
    if (i === fileNode.chunks.length - 1) {
      // 最后一个分块：剩余大小
      const lastSize = totalSize - (i * CHUNK_SIZE);
      chunkSizes.push(lastSize > 0 ? lastSize : CHUNK_SIZE);
    } else {
      chunkSizes.push(CHUNK_SIZE);
    }
  }

  const startTime = Date.now();
  
  // 并发数设置 - 根据分块数量动态调整，最大32
  const concurrency = Math.min(32, Math.max(16, fileNode.chunks.length));
  const totalChunks = fileNode.chunks.length;
  
  // 准备任务队列
  const tasks = fileNode.chunks.map((url, i) => ({ url, index: i }));
  
  let tasksInProgress = 0;
  let nextTaskIndex = 0;
  let downloadFailed = false;
  
  // 统计变量
  let downloadedBytes = 0;  // 只计算本次实际下载的字节数
  let completedChunks = 0;

  // --- 断点续传：检查已下载的分块（精确验证大小） ---
  let skippedChunks = 0;
  let skippedBytes = 0;
  
  console.log(' 检查已下载的分块...');
  
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = path.join(tempDir, `${i}.chunk`);
    const expectedSize = chunkSizes[i];
    
    if (fs.existsSync(chunkPath)) {
      const stat = fs.statSync(chunkPath);
      // 精确验证：大小必须完全匹配
      if (stat.size === expectedSize) {
        skippedChunks++;
        skippedBytes += stat.size;
        console.log(`   分块 ${i + 1}/${totalChunks}: 已完整 (${formatBytes(stat.size)})`);
      } else {
        // 大小不匹配，删除损坏的文件
        console.log(`   分块 ${i + 1}/${totalChunks}: 损坏 (期望 ${formatBytes(expectedSize)}, 实际 ${formatBytes(stat.size)})，将重新下载`);
        fs.unlinkSync(chunkPath);
      }
    }
  }
  
  // downloadedBytes 不包含 skippedBytes，只计算本次下载
  
  if (skippedChunks > 0) {
    console.log(`\n 检测到 ${skippedChunks}/${totalChunks} 个完整分块，将跳过（断点续传）`);
  } else {
    console.log(' 未检测到已下载的分块，开始全新下载');
  }

  console.log(`\n 开始下载 (${totalChunks} 个分块，${concurrency} 线程并发)...`);
  if (skippedChunks > 0) {
    console.log(` 需要下载: ${totalChunks - skippedChunks} 个分块 (${formatBytes(totalSize - skippedBytes)})`);
  }

  // --- 内部函数：单个分块下载任务 (带重试) ---
  const downloadChunkTask = async (task) => {
    const { url, index } = task;
    const tempChunkPath = path.join(tempDir, `${index}.chunk`);
    const expectedSize = chunkSizes[index];
    const maxRetries = 3;

    // --- 断点续传：跳过已完整下载的分块 ---
    if (fs.existsSync(tempChunkPath)) {
      const stat = fs.statSync(tempChunkPath);
      if (stat.size === expectedSize) {
        completedChunks++;
        const progress = ((completedChunks / totalChunks) * 100).toFixed(1);
        console.log(`           (分块 ${index + 1}/${totalChunks})  已完整，跳过 | 总进度: ${progress}%`);
        return;
      } else {
        // 大小不匹配，删除损坏的文件
        fs.unlinkSync(tempChunkPath);
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (downloadFailed) throw new Error("已终止");

            // Windows 兼容性：确保临时目录存在
            if (!fs.existsSync(tempDir)) {
              fs.mkdirSync(tempDir, { recursive: true });
            }

            const response = await fetch(url, { agent });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            // 使用高水位标记优化写入性能
            const fileStream = fs.createWriteStream(tempChunkPath, { 
              highWaterMark: 4 * 1024 * 1024 // 4MB 缓冲区
            });
            
            // 管道传输
            await new Promise((resolve, reject) => {
                response.body.pipe(fileStream);
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
                response.body.on('error', reject);
            });
            
            // 验证下载的文件大小
            const stat = fs.statSync(tempChunkPath);
            if (stat.size !== expectedSize) {
              throw new Error(`大小不匹配 (期望: ${expectedSize}, 实际: ${stat.size})`);
            }
            
            // 统计与计算
            const chunkSize = stat.size;
            downloadedBytes += chunkSize;
            completedChunks++;
            
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;
            const progress = ((completedChunks / totalChunks) * 100).toFixed(1);

            // 任务结束日志 - 详细信息
            console.log(`           (分块 ${index + 1}/${totalChunks})  完成 [${formatBytes(chunkSize)}] | 总进度: ${progress}% | 平均速度: ${formatBytes(speed)}/s`);
            return; // 成功返回

        } catch (error) {
            if (downloadFailed) throw error; // 如果已被标记失败，直接抛出

            if (attempt === maxRetries) {
                console.error(` (分块 ${index + 1}/${totalChunks}) 失败: ${error.message}`);
                throw error;
            } else {
                console.log(`           (分块 ${index + 1}/${totalChunks})  下载失败，等待重试...`);
                // 删除可能损坏的文件
                if (fs.existsSync(tempChunkPath)) {
                  try { fs.unlinkSync(tempChunkPath); } catch (e) {}
                }
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }
        }
    }
  };

  // --- 并发控制循环 (仿照 upload.js) ---
  try {
      await new Promise((resolve, reject) => {
        const startNextTask = () => {
            if (downloadFailed) return;

            // 检查是否全部完成
            if (nextTaskIndex >= tasks.length && tasksInProgress === 0) {
                resolve();
                return;
            }

            // 填充并发槽位
            while (tasksInProgress < concurrency && nextTaskIndex < tasks.length) {
                if (downloadFailed) break;

                tasksInProgress++;
                const task = tasks[nextTaskIndex];
                nextTaskIndex++;

                downloadChunkTask(task)
                    .then(() => {
                        tasksInProgress--;
                        startNextTask(); // 递归启动下一个
                    })
                    .catch((err) => {
                        downloadFailed = true;
                        reject(err); // 任何一个失败，整体失败
                    });
            }
        };

        // 启动初始任务
        startNextTask();
      });

      console.log(`\n 所有分块下载完毕，准备合并...`);

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalSpeed = totalTime > 0 ? totalSize / totalTime : 0;

      const finalStream = fs.createWriteStream(outputPath);
      for (let i = 0; i < fileNode.chunks.length; i++) {
          const tempChunkPath = path.join(tempDir, `${i}.chunk`);
          const readStream = fs.createReadStream(tempChunkPath);
          await new Promise((resolve, reject) => {
              readStream.pipe(finalStream, { end: false });
              readStream.on('end', resolve);
              readStream.on('error', reject);
          });
      }
      finalStream.end();
      
      console.log(` 文件保存成功: ${outputPath}`);
      console.log(` 总耗时: ${totalTime}s | 平均速度: ${formatBytes(finalSpeed)}/s`);
      console.log(`DOWNLOAD_PATH:${outputPath}`);

  } catch (error) {
    console.error(` 下载流程失败: ${error.message}`);
  } finally {
    try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
  }
}