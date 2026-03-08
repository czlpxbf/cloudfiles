// lib/utils.js
// 描述: 存放通用的辅助函数，这些函数不依赖于特定的业务逻辑。

import { execa } from 'execa';
import { MAIN_PROJECT_URL } from './config.js';

/**
 * 获取当前 ISO 格式时间戳
 * @returns {string} ISO 格式的日期时间字符串
 */
export function now() {
  return new Date().toISOString();
}

/**
 * 异步执行一个 shell 命令，并可选择是否实时输出
 * @param {string} command - 要执行的命令
 * @param {string[]} args - 命令参数
 * @param {object} options - execa 选项 (例如 { pipe: false } 来禁止实时输出)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function runCommand(command, args, options = {}) {
  console.log(`\n▶  执行: ${command} ${args.join(' ')}`);
  const childProc = execa(command, args, options);
  let stdout = '',
    stderr = '';
  
  // 默认将子进程输出流转发到当前进程
  if (options.pipe || options.pipe === undefined) {
    if (childProc.stdout) childProc.stdout.pipe(process.stdout);
    if (childProc.stderr) childProc.stderr.pipe(process.stderr);
  }
  if (childProc.stdout) childProc.stdout.on('data', data => stdout += data.toString());
  if (childProc.stderr) childProc.stderr.on('data', data => stderr += data.toString());
  
  await childProc;
  return { stdout, stderr };
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
 * 确保 wrangler 已经登录，如果未登录则提示登录
 */
export async function ensureLoggedIn() {
  console.log('\n正在检查登录状态...');
  try {
    await execa('wrangler', ['whoami']);
    console.log(' 已登录');
  } catch (error) {
    console.log('ℹ 您尚未登录或登录会话已过期，正在启动登录流程...');
    await runCommand('wrangler', ['login']);
    console.log(' 登录成功！');
  }
}
