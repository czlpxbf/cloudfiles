// lib/state.js
// 描述: 负责远程索引文件 (main.json) 的下载、解析、统计和部署。
// 处理与 "状态" 相关的 I/O 操作。

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { TEMP_SITE_DIR, MAIN_PROJECT_NAME } from './config.js';
import { now } from './utils.js';
import { deployMainJson } from './api.js';
import { calculateStats } from './tree.js';

/**
 * 下载远程 main.json 索引文件
 * @param {string} projectUrl - 主项目的 URL
 * @returns {Promise<object>} 远程索引的 JSON 对象
 */
export async function downloadRemoteIndex(projectUrl) {
  const emptyIndex = {
    fs_root: {
      type: 'folder',
      createdAt: now(),
      modifiedAt: now(),
      children: {}
    }
  };
  
  if (!projectUrl) return emptyIndex;

  console.log(`\n下载远程目录: ${projectUrl}/main.json ...`);
  try {
    const response = await fetch(`${projectUrl}/main.json`);

    if (response.status === 404) {
      console.log('ℹ 远程 main.json 不存在，将创建一个新的目录结构。');
      return emptyIndex;
    }

    if (!response.ok) {
      throw new Error(`下载 main.json 时发生网络错误: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(' 成功下载并解析远程 main.json');
    return data;

  } catch (error) {
    console.error(` 下载或解析远程 main.json 失败: ${error.message}`);
    console.error('为了防止数据丢失，脚本将终止。请检查 main project 的部署状态或手动修复 main.json。');
    throw error;
  }
}

/**
 * 部署更新后的索引文件 (main.json)
 * @param {object} jsonData - 要部署的 JSON 对象
 */
export async function deployIndex(jsonData) {
  console.log('\n正在计算统计信息...');
  if (!jsonData.fs_root) jsonData.fs_root = { type: 'folder', children: {} };
  
  const stats = calculateStats(jsonData.fs_root);
  delete jsonData.fs_root.stats;

  if (stats.totalSize > 0 || stats.totalChunks > 0) {
    jsonData.fs_root.stats = {
      totalSizeBytes: stats.totalSize,
      totalSizeGB: (stats.totalSize / (1024 * 1024 * 1024)).toFixed(3),
      totalChunks: stats.totalChunks
    };
    console.log(` 统计更新: 总大小 ${jsonData.fs_root.stats.totalSizeGB} GB, 总文件块 ${jsonData.fs_root.stats.totalChunks}`);
  } else {
    console.log('ℹ 目录为空，不添加统计信息。');
  }

  console.log('\n准备部署更新后的 main.json...');
  const siteDir = TEMP_SITE_DIR;
  if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
  const mainJsonPath = path.join(siteDir, 'main.json');
  const content = JSON.stringify(jsonData, null, 2);
  fs.writeFileSync(mainJsonPath, content);

  console.log('\n开始部署...');
  await deployMainJson(content, MAIN_PROJECT_NAME);
}
