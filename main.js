/**
 * Cloudfiles CLI
 * @version 1.0.0
 * @author Cloudfiles Team
 * @license MIT
 */
// main.js
import fs from 'fs';
import path from 'path';

import { TEMP_SITE_DIR, TEMP_CHUNK_DIR, MAIN_PROJECT_URL } from './lib/config.js';
import { ensureLoggedIn } from './lib/utils.js';

import { cleanVersions } from './lib/cv.js';
import { renameOldVersion } from './lib/renameold.js';
// 引入清理函数
import { performCleanup } from './lib/cleanup.js';

import {
  initializeProjectsAndIndex,
  handleMkdir,
  handleRemove,
  handleMove,
  handleUpload,
  handleDownload
} from './lib/operations.js';

function printUsage() {
  console.log(`
CLOUDFILES CLI v1.0.0
用法: node main.js <命令> [参数]

命令:
  up <本地文件或目录> [远程路径]   上传指定文件或目录到远程路径。
  dl <文件路径> [时间戳]          从云端下载指定版本的文件。
  rm <文件或目录路径>             删除文件或目录。
  mkdir <文件夹路径> [--view <类型>] 创建文件夹。
  mv <src> <dest>               移动或重命名文件/目录。
  
  cv                            [Clean Versions] 清理版本。
     [--path <remotePath>]        指定文件。
     [--target <createdAt>]       指定删除特定版本。
  
  rv <filePath> <createdAt> [name] [Rename Version] 给历史版本命名。
                                  filePath: 文件路径
                                  createdAt: 版本创建时间
                                  name: (可选) 版本名称，留空则移除名称

示例:
  node main.js rv /doc.txt "2023-10-01..." "初稿"
  node main.js rv /doc.txt "2023-10-01..." "" (移除名称)
`);
}

async function fetchLatestIndex() {
    console.log(' 正在强制刷新 main.json ...');
    if (!MAIN_PROJECT_URL) {
        console.warn(' 未配置 MAIN_PROJECT_URL，跳过强制刷新。');
        return;
    }
    
    try {
        const indexUrl = `${MAIN_PROJECT_URL}/main.json?t=${Date.now()}`;
        const response = await fetch(indexUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.text();
        JSON.parse(data);
        fs.writeFileSync('main.json', data);
        console.log(' main.json 刷新成功');
    } catch (error) {
        console.warn(' 刷新失败，使用本地索引。');
    }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    const authRequiredCommands = ['up', 'rm', 'mkdir', 'mv', 'cv', 'rv', 'dl'];
    
    if (authRequiredCommands.includes(command)) {
      if (command !== 'dl' || (command === 'dl' && !fs.existsSync('main.json'))) {
         await ensureLoggedIn();
         await initializeProjectsAndIndex(); 
      }
    }

    switch (command) {
      case 'up': {
        
        const localPathArg = args[1];
        if (!localPathArg) { console.error(' 请提供本地路径。'); process.exit(1); }
        const localPath = path.resolve(localPathArg);
        const remotePath = args[2] || ('/' + path.basename(localPathArg));
        const shotAtIndex = args.indexOf('--shot-at');
        const shotAt = shotAtIndex > -1 ? args[shotAtIndex + 1] : null;
        await handleUpload(localPath, remotePath, { shotAt });
        break;
      }
      
      case 'dl': {
        // 【新增】下载前清理残留缓存
        performCleanup();

        const filePath = args[1];
        const timestamp = args[2];
        if (!filePath) { console.error(' 请提供文件路径。'); process.exit(1); }
        await handleDownload(filePath, timestamp); 
        break;
      }
      
      case 'rm': {
        const itemPath = args[1];
        if (!itemPath) { console.error(' 请提供路径。'); process.exit(1); }
        await handleRemove(itemPath);
        break;
      }
      
      case 'mkdir': {
        const folderPath = args[1];
        if (!folderPath) { console.error(' 请提供路径。'); process.exit(1); }
        const view = args.indexOf('--view') > -1 ? args[args.indexOf('--view') + 1] : null;
        await handleMkdir(folderPath, view);
        break;
      }
      
      case 'mv': {
        const src = args[1], dest = args[2];
        if (!src || !dest) { console.error(' 请提供 src 和 dest。'); process.exit(1); }
        await handleMove(src, dest);
        break;
      }

      case 'cv': {
        await fetchLatestIndex();
        const targetCreatedAt = args.indexOf('--target') > -1 ? args[args.indexOf('--target') + 1] : null;
        const targetPath = args.indexOf('--path') > -1 ? args[args.indexOf('--path') + 1] : null;
        await cleanVersions(targetPath, targetCreatedAt);
        break;
      }

      case 'rv': {
        // node main.js rv <filePath> <createdAt> [name]
        await fetchLatestIndex();

        const filePath = args[1];
        const targetCreatedAt = args[2];
        // name 是可选的，如果 args[3] 存在则使用，否则为空字符串
        const versionName = args[3] || "";

        if (!filePath || !targetCreatedAt) {
            console.error(' 参数不足: rv <filePath> <createdAt> [name]');
            printUsage();
            process.exit(1);
        }

        await renameOldVersion(filePath, targetCreatedAt, versionName);
        break;
      }
      
      default:
        console.log('无效命令。');
        printUsage();
    }
    
  } catch (error) {
    console.error('\n错误:', error.message);
    process.exit(1);
  } finally {
    // 正常退出时的清理保持不变
    try { fs.rmSync(TEMP_SITE_DIR, { recursive: true, force: true }); } catch (e) {};
    try { fs.rmSync(TEMP_CHUNK_DIR, { recursive: true, force: true }); } catch (e) {};
  }
}

main();