// lib/utils.js
// 描述: 存放通用的辅助函数

import { MAIN_PROJECT_URL } from './config.js';
import { verifyToken } from './api.js';

/**
 * 获取当前 ISO 格式时间戳
 * @returns {string} ISO 格式的日期时间字符串
 */
export function now() {
  return new Date().toISOString();
}

/**
 * 获取主项目的 URL
 * @returns {Promise<string|null>}
 */
export async function getMainProjectUrl() {
  try {
    const fullUrl = `${MAIN_PROJECT_URL}`;
    console.log(` 已使用固定的主项目 URL: ${fullUrl}`);
    return fullUrl;
  } catch (error) {
    console.error(` 获取主项目 URL 失败。`, error.message);
    return null;
  }
}

/**
 * 确保 API Token 有效，如果无效则提示用户配置
 */
export async function ensureLoggedIn() {
  console.log('\n正在检查 API Token 状态...');
  try {
    const tokenInfo = await verifyToken();
    console.log(` 已通过验证 (Token 状态: ${tokenInfo.status})`);
    return true;
  } catch (error) {
    console.error(` API Token 验证失败: ${error.message}`);
    console.error('\n请确保 lib/config.js 中的 CLOUDFLARE_API_TOKEN 已正确配置。');
    console.error('获取方式: https://dash.cloudflare.com/profile/api-tokens');
    console.error('需要权限: Account → Cloudflare Pages → Edit\n');
    process.exit(1);
  }
}