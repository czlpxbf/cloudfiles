import fs from 'fs';
import path from 'path';
import { UPDATE_DIR, DOWNLOAD_DIR } from './config.js';

/**
 * 检查并清理临时目录
 * 只清理 upload 临时目录，不清理 download 目录
 * download 目录的临时文件会在下载完成后自动清理
 */
export function performCleanup() {
  // 只清理 UPDATE_DIR（上传临时目录）
  // 不清理 DOWNLOAD_DIR，避免 Windows 文件系统延迟问题
  const dirs = [UPDATE_DIR];
  let cleanedCount = 0;

  dirs.forEach(dir => {
    try {
      if (fs.existsSync(dir)) {
        // 读取目录内容
        const files = fs.readdirSync(dir);
        
        // 如果有内容才进行清理
        if (files.length > 0) {
          files.forEach(file => {
            const curPath = path.join(dir, file);
            // 递归强制删除目录下的子项（文件或子文件夹）
            fs.rmSync(curPath, { recursive: true, force: true });
          });
          cleanedCount++;
        }
      }
    } catch (error) {
      // 捕获权限错误或其他异常，不阻止主程序运行，仅打印警告
      console.warn(`[Cleanup]  清理临时目录内容失败: ${dir} - ${error.message}`);
    }
  });

  // 清理 download 目录中超过 24 小时的临时文件夹（断点续传缓存）
  try {
    if (fs.existsSync(DOWNLOAD_DIR)) {
      const files = fs.readdirSync(DOWNLOAD_DIR);
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000; // 24小时
      
      files.forEach(file => {
        const curPath = path.join(DOWNLOAD_DIR, file);
        try {
          const stat = fs.statSync(curPath);
          // 只删除超过 24 小时的临时目录（32位十六进制名称，md5哈希）
          if (stat.isDirectory() && /^[a-f0-9]{32}$/.test(file)) {
            if (now - stat.mtimeMs > oneDay) {
              fs.rmSync(curPath, { recursive: true, force: true });
              cleanedCount++;
            }
          }
        } catch (e) {
          // 忽略单个文件清理失败
        }
      });
    }
  } catch (error) {
    console.warn(`[Cleanup]  清理下载目录失败: ${error.message}`);
  }

  if (cleanedCount > 0) {
    console.log(' 检测到残留缓存，已在任务开始前清理完毕。');
  }
}