// lib/upload.js
// 描述: 封装文件上传的复杂逻辑，包括(并行)分块、重试和递归目录处理。
// 修复：完全移除了 Worker Threads，改用主线程中的异步并发池，更简单健壮。

import fs from 'fs';
import path from 'path';
// 移除了 'worker_threads'
import { CHUNK_SIZE, TEMP_CHUNK_DIR, MAX_RETRIES, DATA_PROJECT_NAME, MAX_WORKERS } from './config.js';
// 导入主线程的 runCommand
import { now, runCommand } from './utils.js';

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
 * (新) 异步上传单个分块的函数
 * 这将在主线程中并发执行
 * @param {object} task - 任务详情
 * @returns {Promise<string>} 上传后的 URL
 */
async function uploadChunk(task) {
  const { chunkFilePath, chunkIndex, totalChunks, taskId } = task;

  // 1. 为此任务创建唯一的临时部署目录
  // (使用 taskId 确保并发任务的目录不冲突)
  const taskDeployDir = path.join(TEMP_CHUNK_DIR, `task-${taskId}`);
  if (fs.existsSync(taskDeployDir)) {
    fs.rmSync(taskDeployDir, { recursive: true, force: true });
  }
  fs.mkdirSync(taskDeployDir, { recursive: true });

  // 2. 将分块文件复制到部署目录中，并命名为 'data'
  const deployDataPath = path.join(taskDeployDir, 'data');
  fs.copyFileSync(chunkFilePath, deployDataPath);
  
  let success = false;
  let attempt = 0;
  let lastStdout = '';

  while (!success && attempt < MAX_RETRIES) {
    attempt++;
    console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks}) 正在上传分块 (尝试 ${attempt}/${MAX_RETRIES})...`);

    try {
      // 3. 部署这个任务专属的目录 (使用全局的 runCommand)
      const { stdout } = await runCommand('wrangler', [
        'pages', 'deploy', taskDeployDir, 
        `--project-name=${DATA_PROJECT_NAME}`
      ], { pipe: false }); // pipe: false 必须设置，用于捕获 stdout

      lastStdout = stdout;
      const urlMatch = stdout.match(/(https?:\/\/[a-z0-9\-]+\.[^.]+\.pages\.dev)/i);

      if (urlMatch?.[1]) {
        const url = `${urlMatch[1]}/data`;
        success = true;
        console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks})  成功解析 URL: ${url}`);
        
        // 4. 清理
        fs.rmSync(taskDeployDir, { recursive: true, force: true });
        return url; // 返回成功解析的 URL

      } else {
        console.warn(`           (并发任务 ${chunkIndex + 1}/${totalChunks})  警告：第 ${attempt} 次尝试未能解析 URL。`);
        if (attempt < MAX_RETRIES) {
          const delay = 2000;
          console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks}) 将在 ${delay / 1000} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (error) {
      console.error(`           (并发任务 ${chunkIndex + 1}/${totalChunks})  第 ${attempt} 次尝试执行 Wrangler 命令失败:`, error.message);
      if (attempt < MAX_RETRIES) {
        const delay = 2000;
        console.log(`           (并发任务 ${chunkIndex + 1}/${totalChunks}) 将在 ${delay / 1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // 4. 清理
        fs.rmSync(taskDeployDir, { recursive: true, force: true });
        throw error; // 抛出错误，让 promise pool 捕获
      }
    }
  }

  if (!success) {
    // 4. 清理
    fs.rmSync(taskDeployDir, { recursive: true, force: true });
    
    console.error(' 错误：在所有重试后，仍未能从 Wrangler 的部署输出中解析到 URL。');
    console.error('--- Wrangler 的最后一次完整输出 (stdout) 如下 ---');
    console.error(lastStdout);
    console.error('----------------------------------------------');
    throw new Error(`无法解析部署 URL，已达到最大重试次数 (${MAX_RETRIES})。`);
  }
}


/**
 * (内部函数) 上传单个大文件，(并行)处理分块和重试
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
  // 3. (主线程) 先把文件全部分割
  const chunkTasks = await splitFileIntoChunks(fullPath, chunkStagingDir);
  console.log(`            文件分割完毕，共 ${chunkTasks.length} 个分块。`);
  
  // 4. (并行) 使用异步并发池上传所有分块
  const results = new Array(numChunks);
  // 充实任务队列
  const taskQueue = chunkTasks.map((task, index) => ({
    ...task,
    totalChunks: chunkTasks.length,
    taskId: index // 用于创建唯一目录
  }));

  console.log(`           启动 ${MAX_WORKERS} 个并发上传任务...`);
  
  let tasksInProgress = 0;
  let nextTaskIndex = 0;

  await new Promise((resolve, reject) => {
    
    function startNextTask() {
      // 检查是否所有任务都已启动并且已完成
      if (nextTaskIndex >= taskQueue.length && tasksInProgress === 0) {
        resolve(); // 所有任务成功完成
        return;
      }

      // 检查是否可以启动新任务
      while (tasksInProgress < MAX_WORKERS && nextTaskIndex < taskQueue.length) {
        tasksInProgress++;
        const task = taskQueue[nextTaskIndex];
        nextTaskIndex++;
        
        // 启动任务
        uploadChunk(task)
          .then(url => {
            results[task.chunkIndex] = url; // 按顺序存储结果
            tasksInProgress--;
            startNextTask(); // 启动下一个任务
          })
          .catch(err => {
            // 任何一个任务失败，立即拒绝主 Promise
            reject(new Error(`分块 ${task.chunkIndex} 上传失败: ${err.message}`));
          });
      }
    }

    // 启动初始的并发任务
    startNextTask();
  });


  // 5. 检查是否有未完成的任务（理论上 reject 会捕获，但作为安全检查）
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

  // 逻辑不变
  if (stats.isFile()) {
    // uploadFile 现在是并行版本了
    return await uploadFile(currentPath);
  }

  // 逻辑不变
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
        // 文件上传后成为一个单元素数组 (用于版本控制)
        structure.children[entry.name] = [await uploadFile(fullPath)];
      }
    }
    return structure;
  }

  throw new Error('不支持的路径类型: ' + currentPath);
}

