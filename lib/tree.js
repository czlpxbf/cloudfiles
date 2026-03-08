// lib/tree.js
// 描述: 封装所有对内存中 JSON 树结构的操作 (查找、遍历、修改、统计)。
// 这些函数应该是“纯”的，不执行 I/O (如 fetch 或 execa)。

import { now } from './utils.js';

/**
 * 向上更新父文件夹的修改时间
 * @param {object} rootNode - 根节点
 * @param {string[]} parts - 指向*被修改*节点的路径数组
 */
export function updateParentTimestamps(rootNode, parts) {
  let current = rootNode;
  const currentTime = now();
  if (current) {
    current.modifiedAt = currentTime; // 始终更新根目录
  }
  // 遍历路径中的每个部分，更新对应文件夹的时间戳
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current && current.children && current.children[part]) {
      current = current.children[part];
      current.modifiedAt = currentTime;
    } else {
      break; // 如果路径中断，则停止
    }
  }
}

/**
 * 递归计算节点（文件或文件夹）的总大小和分块数
 * @param {object|Array} node - 树中的一个节点
 * @returns {{totalSize: number, totalChunks: number}}
 */
export function calculateStats(node) {
  let totalSize = 0;
  let totalChunks = 0;

  if (!node) return { totalSize: 0, totalChunks: 0 };

  // --- 修复：如果节点是数组，代表是文件，统计 *所有* 版本的总和 ---
  if (Array.isArray(node)) {
    // node 是一个文件版本的数组, e.g. [ { size: 100, chunks: [...] }, { size: 200, chunks: [...] } ]
    // 我们需要把所有版本的 size 和 chunks 加起来
    return node.reduce((acc, version) => {
      acc.totalSize += version.size || 0;
      acc.totalChunks += version.chunks?.length || 0;
      return acc;
    }, { totalSize: 0, totalChunks: 0 });
  }
  // --- 修复结束 ---

  // 如果节点是文件夹，则递归其子节点
  if (node.type === 'folder' && node.children) {
    for (const childName in node.children) {
      const childStats = calculateStats(node.children[childName]);
      totalSize += childStats.totalSize;
      totalChunks += childStats.totalChunks;
    }
  }

  return { totalSize, totalChunks };
}

/**
 * 在树中查找一个节点（文件或文件夹）
 * @param {object} rootNode - 根节点
 * @param {string} itemPath - 路径
 * @returns {object|Array|null} 找到的节点 (文件夹对象或文件版本数组)
 */
export function findNode(rootNode, itemPath) {
  const parts = itemPath.split('/').filter(p => p);
  let currentNode = rootNode;
  for (const part of parts) {
    if (!currentNode || currentNode.type !== 'folder' || !currentNode.children[part]) {
      return null;
    }
    currentNode = currentNode.children[part];
  }
  return currentNode;
}

/**
 * 在树中查找一个文件节点的*最新版本*
 * (这个函数用于 'dl' 命令, 保持不变)
 * @param {object} rootNode - 根节点
 * @param {string} filePath - 文件路径
 * @returns {object|null} 最新的文件版本对象
 */
export function findFileInTree(rootNode, filePath) {
  const node = findNode(rootNode, filePath);

  if (!node || !Array.isArray(node) || node.length === 0) {
    return null;
  }

  const latestVersion = [...node].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  return latestVersion;
}

/**
 * --- (新增) ---
 * 在树中查找一个文件节点的*特定版本*
 * @param {object} rootNode - 根节点
 * @param {string} filePath - 文件路径
 * @param {string} timestamp - 目标版本的 'createdAt' ISO 字符串
 * @returns {object|null} 匹配的文件版本对象
 */
export function findFileByTimestamp(rootNode, filePath, timestamp) {
  const node = findNode(rootNode, filePath); // 复用已有的 findNode

  if (!node || !Array.isArray(node) || node.length === 0) {
    return null;
  }

  // 查找 createdAt 完全匹配的版本
  const specificVersion = node.find(version => version.createdAt === timestamp);

  return specificVersion || null;
}
// --- 新增结束 ---


/**
 * 从树中查找并删除一个节点
 * @param {object} rootNode - 根节点
 * @param {string} itemPath - 要删除的路径
 * @returns {boolean} 是否成功删除
 */
export function findAndRemoveNodeFromTree(rootNode, itemPath) {
  const parts = itemPath.split('/').filter(p => p);
  if (parts.length === 0) {
    console.error(' 不能删除根目录。');
    return false;
  }

  let currentNode = rootNode;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!currentNode?.children?.[part] || currentNode.children[part].type !== 'folder') {
      return false;
    }
    currentNode = currentNode.children[part];
  }

  const finalPart = parts[parts.length - 1];
  if (currentNode?.children?.[finalPart]) {
    delete currentNode.children[finalPart];
    updateParentTimestamps(rootNode, parts); // 更新时间戳
    return true;
  }

  return false;
}


/**
 * (用于 mv) 确保路径上的文件夹都存在，如果不存在则创建
 * @param {object} rootNode - 根节点
 * @param {string[]} parts - 路径数组
 * @returns {object} 路径末端的文件夹节点
 */
export function createFolderIfMissing(rootNode, parts) {
  let current = rootNode;
  for (const part of parts) {
    if (!current.children[part]) {
      current.children[part] = {
        type: 'folder',
        createdAt: now(),
        modifiedAt: now(),
        children: {}
      };
    } else if (current.children[part].type !== 'folder') {
      throw new Error(`路径冲突：${part} 不是文件夹`);
    }
    current = current.children[part];
  }
  return current;
}

/**
 * (用于 mv) 在指定路径移除一个节点
 * @param {object} rootNode - 根节点
 * @param {string[]} parts - 路径数组
 * @returns {object|null} 被移除的节点
 */
export function removeNodeAt(rootNode, parts) {
  if (parts.length === 0) return null;
  let curr = rootNode;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!curr.children?.[p]) return null;
    curr = curr.children[p];
  }
  const last = parts[parts.length - 1];
  if (!curr.children?.[last]) return null;
  const node = curr.children[last];
  delete curr.children[last];
  updateParentTimestamps(rootNode, parts.slice(0, -1)); // 更新原父目录时间戳
  return node;
}

/**
 * (用于 mv) 在指定路径插入一个节点
 * @param {object} rootNode - 根节点
 * @param {string[]} parts - 路径数组
 * @param {object} node - 要插入的节点
 */
export function insertNodeAt(rootNode, parts, node) {
  if (parts.length === 0) throw new Error('目标路径不能为空');
  const parentParts = parts.slice(0, -1);
  const leaf = parts[parts.length - 1];
  const parent = createFolderIfMissing(rootNode, parentParts);

  if (parent.children[leaf]) {
    throw new Error(`目标路径 "${parts.join('/')}" 已存在。`);
  }

  // 更新被移动节点自身的时间戳
  const currentTime = now();
  if (Array.isArray(node)) {
    // (注意: 'mv' 一个文件时, node 是文件版本数组)
    // 我们应该更新 *所有* 版本的 'modifiedAt' 吗?
    // 还是只更新 'modifiedAt' on the parent?
    // 为简单起见，我们只更新父级 (已在 removeNodeAt 和 createFolderIfMissing 中完成)
    // 并且让节点数据保持不变。
  } else {
    // (注意: 'mv' 一个文件夹时, node 是文件夹对象)
    node.modifiedAt = currentTime;
  }

  // 将节点插入新位置
  parent.children[leaf] = node;
  
  // 更新新父目录的时间戳
  updateParentTimestamps(rootNode, parts);
}