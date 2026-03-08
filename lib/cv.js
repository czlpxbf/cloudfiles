import fs from 'fs';
import path from 'path';

// --- 引用主项目配置 ---
import { MAIN_PROJECT_NAME, MAIN_PROJECT_URL, TEMP_SITE_DIR, UPDATE_DIR, DOWNLOAD_DIR } from './config.js'; 
import { runCommand } from './utils.js';

// Get PROJECT_ROOT from config
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DATA_FILE = 'main.json';
const BACKUP_FILE = 'main.json.bak';
const TEMP_DEPLOY_DIR = path.join(TEMP_SITE_DIR, '.temp_cv_deploy');

// --- 强制拉取远程索引 ---
async function fetchRemoteIndex() {
    if (!MAIN_PROJECT_URL) return;
    console.log(`[CV] 正在强制从云端拉取最新索引: ${MAIN_PROJECT_URL}/main.json`);
    try {
        const res = await fetch(`${MAIN_PROJECT_URL}/main.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const txt = await res.text();
        JSON.parse(txt);
        fs.writeFileSync(path.join(PROJECT_ROOT, DATA_FILE), txt);
        console.log('[CV]  本地索引已更新为云端最新版。');
    } catch (e) {
        console.warn(`[CV]  拉取索引失败 (${e.message})，将尝试使用本地缓存。`);
    }
}

// --- 递归清理逻辑 ---
function cleanDirectory(node, targetCreatedAt, currentPath = 'root') {
  if (node.fs_root) {
      console.log('[Debug] cleanDirectory: 检测到 fs_root，进入处理。');
      return cleanDirectory(node.fs_root, targetCreatedAt, '/');
  }

  let stats = { processed: 0, cleaned: 0, removedVersions: 0 };

  if (node.type === 'folder' && node.children) {
    for (const [name, child] of Object.entries(node.children)) {
      const childPath = path.join(currentPath, name);

      if (Array.isArray(child)) {
        stats.processed++;
        const originalCount = child.length;

        if (targetCreatedAt) {
          // 模式 A: 全局删除指定时间戳的版本
          const initialLength = child.length;
          node.children[name] = child.filter(ver => ver.createdAt !== targetCreatedAt);
          
          const deletedCount = initialLength - node.children[name].length;
          if (deletedCount > 0) {
            console.log(`[删除指定版本] ${childPath}: 已移除 createdAt=${targetCreatedAt}`);
            stats.cleaned++;
            stats.removedVersions += deletedCount;
          }

        } else {
          // 模式 B: 全局保留最新版
          if (child.length > 1) {
            child.sort((a, b) => {
              const timeA = new Date(a.modifiedAt || a.createdAt).getTime();
              const timeB = new Date(b.modifiedAt || b.createdAt).getTime();
              return timeB - timeA;
            });

            node.children[name] = [child[0]];

            const removedCount = originalCount - 1;
            stats.cleaned++;
            stats.removedVersions += removedCount;
            
            console.log(`[清理旧版本] ${childPath}: 删除了 ${removedCount} 个旧版本，当前最新: ${child[0].createdAt}`);
          }
        }
        
        if (node.children[name].length === 0) {
            console.warn(`警告: ${childPath} 的所有版本均已被删除。`);
            delete node.children[name];
        }

      } else if (child.type === 'folder') {
        const childStats = cleanDirectory(child, targetCreatedAt, childPath);
        stats.processed += childStats.processed;
        stats.cleaned += childStats.cleaned;
        stats.removedVersions += childStats.removedVersions;
      }
    }
  }

  return stats;
}

// --- 模糊匹配 ---
function findKeyRoughly(obj, targetKey) {
    if (obj[targetKey]) return targetKey;
    const normalizedTarget = targetKey.normalize('NFC');
    const found = Object.keys(obj).find(k => k.normalize('NFC') === normalizedTarget);
    return found || null;
}

// --- 针对特定文件的清理逻辑 ---
function cleanSpecificFile(root, targetPath, targetCreatedAt) {
    console.log(`[Debug] cleanSpecificFile 正在查找: ${targetPath}`);

    let current = root;
    if (current.fs_root) {
        current = current.fs_root;
    }

    const parts = targetPath.split('/').filter(p => p);
    
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current.children) {
            throw new Error(`路径中断: ${targetPath} (缺少 children)`);
        }
        const matchedKey = findKeyRoughly(current.children, part);
        if (!matchedKey) {
            console.log(`[Debug] 可用节点: ${Object.keys(current.children).join(', ')}`);
            throw new Error(`找不到路径: ${targetPath} (在 '${part}' 处中断)`);
        }
        current = current.children[matchedKey];
    }
    
    const fileName = parts[parts.length - 1];
    if (!current.children) throw new Error(`目标父目录不是文件夹: ${targetPath}`);

    const matchedFileName = findKeyRoughly(current.children, fileName);
    if (!matchedFileName) {
        throw new Error(`目标不是文件或不存在: ${targetPath}`);
    }

    const fileVersions = current.children[matchedFileName];
    if (!fileVersions || !Array.isArray(fileVersions)) {
        throw new Error(`目标路径指向的不是一个有效的文件记录: ${targetPath}`);
    }

    let removedCount = 0;

    if (targetCreatedAt) {
        const initialLen = fileVersions.length;
        current.children[matchedFileName] = fileVersions.filter(v => v.createdAt !== targetCreatedAt);
        removedCount = initialLen - current.children[matchedFileName].length;
        if (removedCount > 0) {
             console.log(`[删除单文件版本] ${targetPath}: 已移除版本 ${targetCreatedAt}`);
        }
    } else {
        if (fileVersions.length > 1) {
            fileVersions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            current.children[matchedFileName] = [fileVersions[0]];
            removedCount = fileVersions.length - 1;
             console.log(`[清理单文件历史] ${targetPath}: 已清理历史，保留最新版 ${fileVersions[0].createdAt}`);
        }
    }
    
    if (current.children[matchedFileName].length === 0) {
        delete current.children[matchedFileName];
        console.log(`ℹ 文件 ${targetPath} 已无版本，条目已移除。`);
    }

    return { processed: 1, cleaned: removedCount > 0 ? 1 : 0, removedVersions: removedCount };
}

export async function cleanVersions(targetPath = null, targetCreatedAt = null) {
  await fetchRemoteIndex();

  const filePath = path.join(PROJECT_ROOT, DATA_FILE);

  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到索引文件: ${filePath}。请先执行 up 或 dl 初始化。`);
  }

  try {
    console.log(`正在读取 ${DATA_FILE}...`);
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(rawData);

    fs.writeFileSync(path.join(PROJECT_ROOT, BACKUP_FILE), rawData);

    let stats;
    if (targetPath) {
        console.log(`正在针对特定文件执行清理: ${targetPath}`);
        stats = cleanSpecificFile(data, targetPath, targetCreatedAt);
    } else {
        console.log('开始全盘分析并执行清理...');
        stats = cleanDirectory(data, targetCreatedAt);
    }

    console.log('--------------------------------------------------');
    console.log(`扫描对象:   ${targetPath || 'Whole Drive'}`);
    console.log(`修改操作:   ${stats.cleaned}`);
    console.log(`移除版本数: ${stats.removedVersions}`);
    console.log('--------------------------------------------------');

    if (stats.removedVersions > 0) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(` 本地 ${DATA_FILE} 已更新。`);
      
      // 同步逻辑 (保持和 renameold.js 一致)
      const { syncIndexToCloud } = await import('./renameold.js'); 
      // 实际上 cv.js 自己有 syncIndexToCloud，这里我们不需要import，
      // 因为 cv.js 内部代码我已经包含了 syncIndexToCloud 的逻辑 (见上文 cv.js 内容)
      // 注意：上面的 cv.js 代码块没有包含 syncIndexToCloud 的导出/定义，
      // 让我修正上面的 cv.js 代码块以包含 syncIndexToCloud，避免报错。
      await runSync(filePath); // 调用内部函数

    } else {
      console.log(' 没有发现需要删除的版本，跳过上传。');
    }

  } catch (error) {
    console.error('清理版本过程中发生错误:', error);
    throw error; 
  }
}

// 补充 cv.js 内部需要的 sync 函数
async function runSync(localPath) {
    const { SITE_PROJECT_NAME } = await import('./config.js'); // 或者是 MAIN_PROJECT_NAME
    // 为了保持一致性，直接复制 syncIndexToCloud 逻辑到 cv.js 内部
    console.log('\n正在执行 War Up (同步索引到 Cloudflare)...');
    if (fs.existsSync(TEMP_DEPLOY_DIR)) fs.rmSync(TEMP_DEPLOY_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEMP_DEPLOY_DIR);
    fs.copyFileSync(localPath, path.join(TEMP_DEPLOY_DIR, DATA_FILE));
    
    try {
        console.log(`   正在上传 ${DATA_FILE} 到主项目: ${MAIN_PROJECT_NAME}...`);
        await runCommand('wrangler', [
          'pages', 'deploy', TEMP_DEPLOY_DIR,
          `--project-name=${MAIN_PROJECT_NAME}`,
          '--commit-dirty=true'
        ]);
        console.log(' 索引同步成功！');
    } finally {
        try { fs.rmSync(TEMP_DEPLOY_DIR, { recursive: true, force: true }); } catch (e) { }
    }
}