// lib/api.js
// Cloudflare Pages REST API 封装层
// 替代 Wrangler CLI，所有操作通过纯 HTTP API 完成
//
// Pages 部署流程 (逆向自 Wrangler CLI):
// 1. GET  upload-token → 获取 JWT
// 2. POST /pages/assets/upload → 上传文件 (base64, JWT 认证)
// 3. POST /pages/assets/upsert-hashes → 注册文件哈希
// 4. POST /accounts/{id}/pages/projects/{name}/deployments → 创建部署 (multipart/form-data)

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } from './config.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

// ========================================
// 通用请求函数
// ========================================

async function cloudflareRequest(endpoint, options = {}) {
  const { method = 'GET', body, headers = {}, json = true } = options;

  const reqHeaders = {
    'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
    ...headers
  };

  if (body && !reqHeaders['Content-Type']) {
    reqHeaders['Content-Type'] = 'application/json';
  }

  const fetchOptions = {
    method,
    headers: reqHeaders
  };

  if (body) {
    fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const response = await fetch(url, fetchOptions);

  if (json) {
    const data = await response.json();
    if (!data.success) {
      const errors = data.errors?.map(e => e.message).join('; ') || 'Unknown error';
      throw new Error(`Cloudflare API 错误: ${errors}`);
    }
    return data;
  }

  if (!response.ok) {
    throw new Error(`Cloudflare API 错误: HTTP ${response.status}`);
  }

  return response;
}

// ========================================
// 账号相关
// ========================================

/**
 * 验证 API Token 是否有效
 */
export async function verifyToken() {
  const data = await cloudflareRequest('/user/tokens/verify');
  return data.result;
}

/**
 * 获取账号 ID（如果未配置则自动检测）
 */
export async function getAccountId() {
  if (CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_ACCOUNT_ID !== 'your-account-id') {
    return CLOUDFLARE_ACCOUNT_ID;
  }
  const data = await cloudflareRequest('/accounts');
  if (data.result && data.result.length > 0) {
    return data.result[0].id;
  }
  throw new Error('未找到 Cloudflare 账号，请手动设置 CLOUDFLARE_ACCOUNT_ID');
}

// ========================================
// Pages 项目
// ========================================

/**
 * 列出所有 Pages 项目
 */
export async function listProjects() {
  const accountId = await getAccountId();
  const data = await cloudflareRequest(`/accounts/${accountId}/pages/projects`);
  return data.result.map(p => p.name);
}

/**
 * 创建 Pages 项目
 */
export async function createProject(projectName) {
  const accountId = await getAccountId();
  console.log(`  创建 Pages 项目: ${projectName}`);
  await cloudflareRequest(`/accounts/${accountId}/pages/projects`, {
    method: 'POST',
    body: {
      name: projectName,
      production_branch: 'main'
    }
  });
}

/**
 * 获取项目详情
 */
export async function getProject(projectName) {
  const accountId = await getAccountId();
  const data = await cloudflareRequest(`/accounts/${accountId}/pages/projects/${projectName}`);
  return data.result;
}

// ========================================
// 文件上传 (Pages Direct Upload API)
// ========================================

/**
 * 计算文件的哈希 (与 Wrangler 兼容: MD5 of body+path)
 */
function fileHash(fileBuffer, filePath) {
  return crypto.createHash('md5').update(fileBuffer).update(filePath).digest('hex');
}

/**
 * 获取上传 JWT token
 */
async function getUploadToken(accountId, projectName) {
  const data = await cloudflareRequest(
    `/accounts/${accountId}/pages/projects/${projectName}/upload-token`
  );
  return data.result?.jwt;
}

/**
 * 上传文件到 Pages Assets (base64 编码)
 */
async function uploadAssets(jwt, files) {
  // files: [{ key (hash), value (base64), metadata: { contentType }, base64: true }]
  const response = await fetch(`${API_BASE}/pages/assets/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(files)
  });

  const data = await response.json();
  if (!data.success) {
    const errors = data.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`上传文件失败: ${errors}`);
  }
  return data;
}

/**
 * 注册已上传文件的哈希
 */
async function upsertHashes(jwt, hashes) {
  const response = await fetch(`${API_BASE}/pages/assets/upsert-hashes`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hashes })
  });

  const data = await response.json();
  if (!data.success) {
    const errors = data.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`注册哈希失败: ${errors}`);
  }
  return data;
}

/**
 * 创建 Pages 部署 (multipart/form-data)
 */
async function createDeployment(accountId, projectName, manifest) {
  // manifest: { "/path": "hash", ... }
  const manifestJson = JSON.stringify(manifest);

  // 构建 multipart/form-data
  const boundary = '----CloudfilesBoundary' + crypto.randomBytes(16).toString('hex');
  const bodyParts = [];

  bodyParts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="manifest"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${manifestJson}\r\n`
  );

  bodyParts.push(`--${boundary}--\r\n`);

  const body = bodyParts.join('');

  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    }
  );

  const data = await response.json();
  if (!data.success) {
    const errors = data.errors?.map(e => e.message).join('; ') || 'Unknown error';
    throw new Error(`创建部署失败: ${errors}`);
  }
  return data;
}

/**
 * 上传单个文件到 Pages 项目并返回部署 URL
 *
 * @param {string} filePath - 本地文件路径
 * @param {string} projectName - Pages 项目名
 * @param {string} remoteFileName - 远程文件名（默认 'data'）
 * @returns {Promise<string>} 部署后的文件 URL
 */
export async function deployFile(filePath, projectName, remoteFileName = 'data') {
  const accountId = await getAccountId();
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;
  const remotePath = `/${remoteFileName}`;
  const hash = fileHash(fileBuffer, remotePath);

  console.log(`           API 上传: ${path.basename(filePath)} (${(fileSize / 1024).toFixed(1)} KB, hash: ${hash.substring(0, 12)}...)`);

  // Step 1: 获取上传 JWT
  console.log(`           获取上传凭证...`);
  const jwt = await getUploadToken(accountId, projectName);
  if (!jwt) {
    throw new Error('获取上传凭证失败：未返回 JWT');
  }

  // Step 2: 上传文件 (base64)
  console.log(`           上传文件到 Pages...`);
  const base64Content = fileBuffer.toString('base64');
  await uploadAssets(jwt, [{
    key: hash,
    value: base64Content,
    metadata: { contentType: 'application/octet-stream' },
    base64: true
  }]);

  // Step 3: 注册哈希
  await upsertHashes(jwt, [hash]);

  // Step 4: 创建部署
  console.log(`           创建部署...`);
  const deployResult = await createDeployment(accountId, projectName, {
    [remotePath]: hash
  });

  // 构建文件 URL
  const projectSubdomain = deployResult.result?.project_subdomain;
  let fileUrl;
  if (projectSubdomain) {
    fileUrl = `https://${projectSubdomain}.pages.dev${remotePath}`;
  } else {
    fileUrl = `https://${projectName}.pages.dev${remotePath}`;
  }

  console.log(`           URL: ${fileUrl}`);
  return fileUrl;
}

/**
 * 部署主项目（main.json 索引文件）
 *
 * @param {string} content - main.json 的内容
 * @param {string} projectName - 主项目名
 */
export async function deployMainJson(content, projectName) {
  const accountId = await getAccountId();
  const fileBuffer = Buffer.from(content, 'utf-8');
  const fileSize = fileBuffer.length;
  const remotePath = '/main.json';
  const hash = fileHash(fileBuffer, remotePath);

  console.log(`\n部署 main.json 到主项目: ${projectName}`);

  // Step 1: 获取上传 JWT
  const jwt = await getUploadToken(accountId, projectName);
  if (!jwt) {
    throw new Error('获取上传凭证失败：未返回 JWT');
  }

  // Step 2: 上传 main.json (base64)
  console.log(` 上传 main.json (${fileSize} bytes)...`);
  const base64Content = fileBuffer.toString('base64');
  await uploadAssets(jwt, [{
    key: hash,
    value: base64Content,
    metadata: { contentType: 'application/json' },
    base64: true
  }]);

  // Step 3: 注册哈希
  await upsertHashes(jwt, [hash]);

  // Step 4: 创建部署
  console.log(' 创建部署...');
  await createDeployment(accountId, projectName, {
    [remotePath]: hash
  });

  console.log(' main.json 部署成功');
}

/**
 * 获取项目的生产 URL
 */
export async function getProductionUrl(projectName) {
  const accountId = await getAccountId();
  const data = await cloudflareRequest(`/accounts/${accountId}/pages/projects/${projectName}`);
  const subdomain = data.result?.subdomain || data.result?.canonical_deployment?.subdomain;
  if (subdomain) {
    return subdomain.includes('.pages.dev') ? `https://${subdomain}` : `https://${subdomain}.pages.dev`;
  }
  return `https://${projectName}.pages.dev`;
}
