/**
 * Cloudfiles Setup Script v2.0.0
 * 
 * 使用 Cloudflare REST API 替代 Wrangler CLI
 * 用户只需提供 API Token，无需安装任何额外工具
 * 
 * This script will:
 * - Verify Cloudflare API Token
 * - Create Pages projects (or use existing)
 * - Get production URL
 * - Update config.js
 * - Deploy initial main.json (only for NEW projects)
 * 
 * Prerequisites:
 * - Node.js >= 18.0.0
 * - Cloudflare account (free tier works)
 * - Cloudflare API Token (Pages 编辑权限)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// ========================================
// Cloudflare API 工具函数 (内联，避免循环依赖)
// ========================================

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function cloudflareRequest(token, endpoint, options = {}) {
  const { method = 'GET', body } = options;
  
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const fetchOptions = {
    method,
    headers
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const response = await fetch(url, fetchOptions);
  const data = await response.json();

  if (!data.success) {
    const errors = data.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`API 错误: ${errors}`);
  }

  return data;
}

async function verifyToken(token) {
  console.log('验证 API Token...');
  const data = await cloudflareRequest(token, '/user/tokens/verify');
  return data.result;
}

async function getAccountId(token) {
  console.log('获取账号信息...');
  const data = await cloudflareRequest(token, '/accounts');
  const accounts = data.result;
  if (accounts.length === 0) {
    throw new Error('未找到 Cloudflare 账号');
  }
  if (accounts.length === 1) {
    return accounts[0].id;
  }
  // 多账号，让用户选择
  console.log('\n发现多个 Cloudflare 账号:');
  accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} (${a.id})`));
  const choice = await question(`请选择账号 (1-${accounts.length}): `);
  const idx = parseInt(choice) - 1;
  if (idx < 0 || idx >= accounts.length) {
    throw new Error('无效选择');
  }
  return accounts[idx].id;
}

async function listProjects(token, accountId) {
  const data = await cloudflareRequest(token, `/accounts/${accountId}/pages/projects`);
  return data.result.map(p => p.name);
}

async function createProject(token, accountId, projectName) {
  console.log(`创建 Pages 项目: ${projectName}`);
  await cloudflareRequest(token, `/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    body: {
      name: projectName,
      production_branch: 'main'
    }
  });
}

async function getProjectUrl(token, accountId, projectName) {
  console.log(`获取项目 URL: ${projectName}`);
  const data = await cloudflareRequest(token, `/accounts/${accountId}/pages/projects/${projectName}`);
  const subdomain = data.result?.subdomain || data.result?.canonical_deployment?.subdomain;
  if (subdomain) {
    return subdomain.includes('.pages.dev') ? `https://${subdomain}` : `https://${subdomain}.pages.dev`;
  }
  return `https://${projectName}.pages.dev`;
}

async function deployMainJsonViaApi(token, accountId, projectName, content) {
  const crypto = (await import('crypto')).default;
  const fileBuffer = Buffer.from(content, 'utf-8');
  const remotePath = '/main.json';
  const hash = crypto.createHash('md5').update(fileBuffer).update(remotePath).digest('hex');

  console.log(`部署 main.json 到 ${projectName}...`);

  // Step 1: 获取上传 JWT
  const tokenResult = await cloudflareRequest(token, `/accounts/${accountId}/pages/projects/${projectName}/upload-token`);
  const jwt = tokenResult.result?.jwt;
  if (!jwt) throw new Error('获取上传凭证失败');

  // Step 2: 上传文件 (base64)
  const base64Content = fileBuffer.toString('base64');
  const uploadResponse = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{
      key: hash,
      value: base64Content,
      metadata: { contentType: 'application/json' },
      base64: true
    }])
  });
  const uploadData = await uploadResponse.json();
  if (!uploadData.success) {
    const errors = uploadData.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`上传文件失败: ${errors}`);
  }

  // Step 3: 注册哈希
  const hashResponse = await fetch('https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hashes: [hash] })
  });
  const hashData = await hashResponse.json();
  if (!hashData.success) {
    const errors = hashData.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`注册哈希失败: ${errors}`);
  }

  // Step 4: 创建部署 (multipart/form-data)
  const manifest = JSON.stringify({ [remotePath]: hash });
  const boundary = '----CloudfilesSetup' + crypto.randomBytes(16).toString('hex');
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\n\r\n${manifest}\r\n--${boundary}--\r\n`;

  const deployResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    }
  );
  const deployData = await deployResponse.json();
  if (!deployData.success) {
    const errors = deployData.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`创建部署失败: ${errors}`);
  }

  console.log('✓ main.json 部署成功');
}

async function checkMainJsonExists(projectUrl) {
  try {
    const response = await fetch(`${projectUrl}/main.json`, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

// ========================================
// 配置更新
// ========================================

function updateConfig(token, accountId, mainProject, dataProject, mainUrl) {
  const configPath = path.join(PROJECT_ROOT, 'lib', 'config.js');
  
  const configContent = `// lib/config.js
// Description: Global configuration constants
// 
// This file is auto-generated by setup.js
// Do NOT edit manually unless you know what you're doing
//
// Run 'login.bat' to configure your project

import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ========================================
// User Configuration (Auto-generated)
// ========================================

// [CUSTOMIZE] Cloudflare API Token (需要 Pages 编辑权限)
// 获取方式: https://dash.cloudflare.com/profile/api-tokens
export const CLOUDFLARE_API_TOKEN = '${token}';

// [CUSTOMIZE] Cloudflare Account ID (可选，留空则自动检测)
// 获取方式: https://dash.cloudflare.com → 右侧 API 区域
export const CLOUDFLARE_ACCOUNT_ID = '${accountId}';

// [CUSTOMIZE] Main project name (Cloudflare Pages project name)
export const MAIN_PROJECT_NAME = '${mainProject}';

// [CUSTOMIZE] Data project name (for storing file data)
export const DATA_PROJECT_NAME = '${dataProject}';

// [CUSTOMIZE] Main project URL (Cloudflare Pages domain)
export const MAIN_PROJECT_URL = '${mainUrl}';

// ========================================
// System Configuration (Do NOT modify)
// ========================================

export const UPDATE_DIR = path.join(PROJECT_ROOT, 'update');
export const DOWNLOAD_DIR = path.join(PROJECT_ROOT, 'download');
export const CHUNK_DIR = path.join(PROJECT_ROOT, 'chunks');
export const PREVIEW_CACHE_DIR = path.join(PROJECT_ROOT, 'preview_cache');
export const CHUNK_SIZE = 25 * 1024 * 1024;
export const TEMP_SITE_DIR = path.join(PROJECT_ROOT, 'temp-cloudfiles-site');
export const TEMP_CHUNK_DIR = path.join(PROJECT_ROOT, 'temp-chunk-upload');
export const MAX_RETRIES = 5;

export const MAX_WORKERS = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2) || 1));
export const DISTRIBUTED_ARCHITECTURE = false;
`;

  const libPath = path.join(PROJECT_ROOT, 'lib');
  if (!fs.existsSync(libPath)) {
    fs.mkdirSync(libPath, { recursive: true });
  }
  fs.writeFileSync(configPath, configContent, 'utf8');
  console.log('✓ config.js 更新成功');
}

// ========================================
// 主流程
// ========================================

async function main() {
  console.log('\n========================================');
  console.log('  Cloudfiles Setup v2.0.0');
  console.log('  (纯 API 模式，无需 Wrangler)');
  console.log('========================================\n');

  // Step 1: 获取 API Token
  console.log('[Step 1/4] 配置 Cloudflare API Token\n');
  console.log('请先创建一个 Cloudflare API Token:');
  console.log('  1. 打开 https://dash.cloudflare.com/profile/api-tokens');
  console.log('  2. 点击 "创建令牌" → 使用 "自定义令牌" 模板');
  console.log('  3. 权限设置: 账户 → Cloudflare Pages → 编辑');
  console.log('  4. 复制生成的 Token\n');

  const apiToken = await question('请输入你的 Cloudflare API Token: ');
  
  if (!apiToken || apiToken.trim() === '') {
    console.log('\n✗ API Token 是必填项！');
    rl.close();
    process.exit(1);
  }

  const token = apiToken.trim();

  // Step 2: 验证 Token 并获取账号
  console.log('\n[Step 2/4] 验证 API Token...\n');

  try {
    const tokenInfo = await verifyToken(token);
    console.log(`✓ Token 有效 (状态: ${tokenInfo.status})`);
  } catch (error) {
    console.log(`\n✗ Token 验证失败: ${error.message}`);
    console.log('请检查 Token 是否正确，以及是否拥有 Pages 编辑权限。');
    rl.close();
    process.exit(1);
  }

  const accountId = await getAccountId(token);
  console.log(`✓ 账号 ID: ${accountId}\n`);

  // Step 3: 获取项目列表并配置
  console.log('[Step 3/4] 配置项目\n');

  const existingProjects = await listProjects(token, accountId);
  
  if (existingProjects.length > 0) {
    console.log(`发现 ${existingProjects.length} 个现有 Pages 项目:`);
    existingProjects.forEach(p => console.log(`  - ${p}`));
    console.log('');
  } else {
    console.log('未发现现有 Pages 项目。\n');
  }

  const projectName = await question('请输入项目名称 (e.g., my-cloudfiles): ');
  
  if (!projectName || projectName.trim() === '') {
    console.log('\n✗ 项目名称是必填项！');
    rl.close();
    process.exit(1);
  }

  const mainProject = projectName.trim();
  const dataProject = `${mainProject}-data`;

  const mainExists = existingProjects.includes(mainProject);
  const dataExists = existingProjects.includes(dataProject);
  const isNewProject = !mainExists;

  console.log(`\n项目配置:`);
  console.log(`  API Token: ${token.substring(0, 12)}...`);
  console.log(`  账号 ID: ${accountId}`);
  console.log(`  主项目: ${mainProject} ${mainExists ? '(已存在)' : '(新建)'}`);
  console.log(`  数据项目: ${dataProject} ${dataExists ? '(已存在)' : '(新建)'}`);
  
  if (isNewProject) {
    console.log('\n  ℹ️  新项目，将创建项目并部署初始文件。');
  } else {
    console.log('\n  ℹ️  已有项目，只更新本地配置（不覆盖数据）。');
  }
  console.log('');

  const confirm = await question('确认继续? (Y/N): ');
  if (confirm.toUpperCase() !== 'Y') {
    console.log('\n已取消。');
    rl.close();
    process.exit(0);
  }

  // Step 4: 创建项目并部署
  console.log('\n[Step 4/4] 设置项目...\n');

  if (isNewProject) {
    try {
      await createProject(token, accountId, mainProject);
      console.log(`✓ 主项目 "${mainProject}" 创建成功\n`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`✓ 主项目 "${mainProject}" 已存在\n`);
      } else {
        console.log(`! 创建主项目失败: ${error.message}\n`);
      }
    }

    try {
      await createProject(token, accountId, dataProject);
      console.log(`✓ 数据项目 "${dataProject}" 创建成功\n`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`✓ 数据项目 "${dataProject}" 已存在\n`);
      } else {
        console.log(`! 创建数据项目失败: ${error.message}\n`);
      }
    }
  } else {
    console.log(`✓ 使用现有主项目 "${mainProject}"`);
    console.log(`✓ 使用现有数据项目 "${dataProject}"\n`);
  }

  // 获取生产 URL
  const mainUrl = await getProjectUrl(token, accountId, mainProject);
  console.log(`✓ 生产 URL: ${mainUrl}\n`);

  // 更新 config.js
  updateConfig(token, accountId, mainProject, dataProject, mainUrl);

  // 部署初始 main.json（仅新项目）
  if (isNewProject) {
    console.log('部署初始 main.json...');
    const mainJson = JSON.stringify({
      fs_root: {
        type: 'folder',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
        children: {}
      }
    }, null, 2);
    await deployMainJsonViaApi(token, accountId, mainProject, mainJson);
  } else {
    const mainJsonExists = await checkMainJsonExists(mainUrl);
    if (!mainJsonExists) {
      console.log('⚠️  main.json 不存在，正在部署...');
      const mainJson = JSON.stringify({
        fs_root: {
          type: 'folder',
          createdAt: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
          children: {}
        }
      }, null, 2);
      await deployMainJsonViaApi(token, accountId, mainProject, mainJson);
    } else {
      console.log('✓ main.json 已存在，跳过部署。');
      console.log('  你的现有文件是安全的！\n');
    }
  }

  // Done
  console.log('\n========================================');
  console.log('  设置完成！');
  console.log('========================================\n');
  console.log('配置概览:');
  console.log(`  API Token: ${token.substring(0, 12)}...`);
  console.log(`  账号 ID: ${accountId}`);
  console.log(`  主项目: ${mainProject}`);
  console.log(`  数据项目: ${dataProject}`);
  console.log(`  URL: ${mainUrl}`);
  
  if (isNewProject) {
    console.log('\n✨ 新项目创建成功！');
  } else {
    console.log('\n✨ 配置更新成功！现有文件已保留。');
  }
  
  console.log('\n下一步:');
  console.log('  1. 运行: start.bat');
  console.log('  2. 打开: http://localhost:8000');
  console.log('  3. 或使用 CLI: node main.js up ./file.pdf /\n');

  rl.close();
}

main().catch((error) => {
  console.error('\n错误:', error.message);
  rl.close();
  process.exit(1);
});