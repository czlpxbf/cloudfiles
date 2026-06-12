import fs from 'fs';
import path from 'path';

// --- 引用主项目配置 ---
import { MAIN_PROJECT_NAME, MAIN_PROJECT_URL, TEMP_SITE_DIR } from './config.js'; 
import { deployMainJson } from './api.js';

// Get PROJECT_ROOT
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const DATA_FILE = 'main.json';
const BACKUP_FILE = 'main.json.bak';
const TEMP_DEPLOY_DIR = path.join(TEMP_SITE_DIR, '.temp_rv_deploy');

// --- 强制拉取远程索引 ---
async function fetchRemoteIndex() {
    if (!MAIN_PROJECT_URL) return;
    console.log(`[RV] 正在强制从云端拉取最新索引: ${MAIN_PROJECT_URL}/main.json`);
    try {
        const res = await fetch(`${MAIN_PROJECT_URL}/main.json?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const txt = await res.text();
        JSON.parse(txt); // 校验
        fs.writeFileSync(path.join(PROJECT_ROOT, DATA_FILE), txt);
        console.log('[RV]  本地索引已更新为云端最新版。');
    } catch (e) {
        console.warn(`[RV]  拉取索引失败 (${e.message})，将尝试使用本地缓存。`);
    }
}

// --- 辅助函数: 获取指定路径的节点 ---
function getNode(root, filePath) {
    let current = root;
    // 兼容 fs_root
    if (current.fs_root) {
        current = current.fs_root;
    }

    const parts = filePath.split('/').filter(p => p);

    // 遍历到父文件夹
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current.children || !current.children[part]) {
            return null;
        }
        current = current.children[part];
    }

    // 获取文件节点
    const fileName = parts[parts.length - 1];
    if (!current.children || !current.children[fileName]) {
        return null;
    }
    
    return { parent: current, fileName, node: current.children[fileName] };
}

// --- 同步逻辑 ---
async function syncIndexToCloud() {
  console.log('\n [Rename Version] 正在同步索引到 Cloudflare...');

  const sourceFile = path.join(PROJECT_ROOT, DATA_FILE);
  const rawData = fs.readFileSync(sourceFile, 'utf-8');
  const data = JSON.parse(rawData);
  const content = JSON.stringify(data, null, 2);

  try {
    await deployMainJson(content, MAIN_PROJECT_NAME);
    console.log(' [Rename Version] 索引同步成功！');
  } catch (error) {
    console.error(' [Rename Version] 索引同步失败:', error.message);
    throw error;
  }
}

/**
 * 给特定的历史版本添加名称 (别名)
 * @param {string} filePath - 文件完整路径
 * @param {string} targetCreatedAt - 要操作的版本的 createdAt 时间戳
 * @param {string} versionName - 给版本起的名字
 */
export async function renameOldVersion(filePath, targetCreatedAt, versionName) {
    // 操作前拉取最新索引
    await fetchRemoteIndex();

    console.log(`[Rename Version] 请求: 给文件 ${filePath} 的版本 [${targetCreatedAt}] 命名为 "${versionName}"`);

    const localFilePath = path.join(PROJECT_ROOT, DATA_FILE);
    if (!fs.existsSync(localFilePath)) {
        throw new Error(`找不到索引文件: ${localFilePath}`);
    }

    try {
        const rawData = fs.readFileSync(localFilePath, 'utf-8');
        const data = JSON.parse(rawData);

        fs.writeFileSync(path.join(PROJECT_ROOT, BACKUP_FILE), rawData);

        const sourceInfo = getNode(data, filePath);
        if (!sourceInfo || !Array.isArray(sourceInfo.node)) {
            throw new Error(`文件未找到或不是有效文件: ${filePath}`);
        }

        const versionIndex = sourceInfo.node.findIndex(v => v.createdAt === targetCreatedAt);
        if (versionIndex === -1) {
            console.log('[Debug] 可用版本:', sourceInfo.node.map(v => v.createdAt));
            throw new Error(`在 ${filePath} 中未找到时间戳为 ${targetCreatedAt} 的版本`);
        }

        // --- 核心逻辑变更：修改属性 ---
        if (versionName && versionName.trim() !== "") {
            sourceInfo.node[versionIndex].name = versionName;
            console.log(` 已为版本添加名称: ${versionName}`);
        } else {
            // 如果传空名，则移除名称
            if (sourceInfo.node[versionIndex].name) {
                delete sourceInfo.node[versionIndex].name;
                console.log(` 已移除版本名称`);
            } else {
                console.log(`ℹ 版本原本无名称，保持不变`);
            }
        }

        fs.writeFileSync(localFilePath, JSON.stringify(data, null, 2));
        await syncIndexToCloud();

    } catch (error) {
        console.error(' 重命名版本失败:', error);
        throw error;
    }
}
