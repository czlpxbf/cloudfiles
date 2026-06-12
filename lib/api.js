// lib/api.js
// Cloudflare Pages REST API 封装层
// 替代 Wrangler CLI，所有操作通过纯 HTTP API 完成

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
// 文件上传
// ========================================

/**
 * 计算文件的 SHA256 哈希
 */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 上传单个文件到 Pages 项目并返回部署 URL
 * 
 * Cloudflare Pages 上传流程:
 * 1. POST /assets/upload → 获取每个文件的临时上传 URL
 * 2. PUT 文件到返回的临时 URL
 * 3. POST /deployments → 创建部署（关联已上传文件）
 * 4. 返回最终的文件 URL
 * 
 * @param {string} filePath - 本地文件路径
 * @param {string} projectName - Pages 项目名
 * @param {string} remoteFileName - 远程文件名（默认 'data'）
 * @returns {Promise<string>} 部署后的文件 URL
 */
export async function deployFile(filePath, projectName, remoteFileName = 'data') {
  const accountId = await getAccountId();
  const fileBuffer = fs.readFileSync(filePath);
  const fileHash = sha256(fileBuffer);
  const fileSize = fileBuffer.length;

  console.log(`           API 上传: ${path.basename(filePath)} (${(fileSize / 1024).toFixed(1)} KB, SHA256: ${fileHash.substring(0, 12)}...)`);

  // Step 1: 获取上传凭证
  console.log(`           获取上传凭证...`);
  const uploadResult = await cloudflareRequest(
    `/accounts/${accountId}/pages/projects/${projectName}/assets/upload`
  );

  // Step 2: 上传文件到临时 URL
  // 上传 URL 在 result.jwt 中，或者 result 直接包含上传信息
  // Cloudflare API 返回的格式可能因版本而异
  const jwt = uploadResult.result?.jwt;
  if (!jwt) {
    throw new Error('获取上传凭证失败：未返回 JWT');
  }

  console.log(`           上传文件到 Pages...`);
  const uploadResponse = await cloudflareRequest(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/assets/upload`,
    {
      method: 'POST',
      body: {
        jwt,
        assets: [{
          name: remoteFileName,
          sha256: fileHash,
          size: fileSize
        }]
      }
    }
  );

  const assetUploadUrl = uploadResponse.result?.assets?.[0]?.uploadURL;
  if (!assetUploadUrl) {
    throw new Error('获取上传 URL 失败');
  }

  // PUT 文件到临时 URL
  await fetch(assetUploadUrl, {
    method: 'PUT',
    body: fileBuffer,
    headers: { 'Content-Type': 'application/octet-stream' }
  });

  console.log(`           文件上传成功`);

  // Step 3: 创建部署
  console.log(`           创建部署...`);
  const deployResult = await cloudflareRequest(
    `/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      body: {
        assets: {
          [remoteFileName]: {
            sha256: fileHash,
            size: fileSize
          }
        }
      }
    }
  );

  // Step 4: 构建最终 URL
  const deploymentId = deployResult.result?.id;
  const projectSubdomain = deployResult.result?.project_subdomain;
  
  // URL 格式: https://{deployment-id}.{project}.pages.dev/{filename}
  // 或者使用项目子域名
  let fileUrl;
  if (projectSubdomain) {
    fileUrl = `https://${deploymentId}.${projectSubdomain}.pages.dev/${remoteFileName}`;
  } else {
    // 使用项目名回退
    fileUrl = `https://${deploymentId}.${projectName}.pages.dev/${remoteFileName}`;
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
  const fileHash = sha256(fileBuffer);
  const fileSize = fileBuffer.length;

  console.log(`\n部署 main.json 到主项目: ${projectName}`);

  // Step 1: 获取上传凭证
  const uploadResult = await cloudflareRequest(
    `/accounts/${accountId}/pages/projects/${projectName}/assets/upload`
  );

  const jwt = uploadResult.result?.jwt;
  if (!jwt) {
    throw new Error('获取上传凭证失败：未返回 JWT');
  }

  // Step 2: 上传 main.json
  console.log(` 上传 main.json (${fileSize} bytes)...`);
  const uploadResponse = await cloudflareRequest(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/assets/upload`,
    {
      method: 'POST',
      body: {
        jwt,
        assets: [{
          name: 'main.json',
          sha256: fileHash,
          size: fileSize
        }]
      }
    }
  );

  const assetUploadUrl = uploadResponse.result?.assets?.[0]?.uploadURL;
  if (!assetUploadUrl) {
    throw new Error('获取上传 URL 失败');
  }

  await fetch(assetUploadUrl, {
    method: 'PUT',
    body: fileBuffer,
    headers: { 'Content-Type': 'application/json' }
  });

  // Step 3: 创建部署
  console.log(' 创建部署...');
  await cloudflareRequest(
    `/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      body: {
        assets: {
          'main.json': {
            sha256: fileHash,
            size: fileSize
          }
        }
      }
    }
  );

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
    return `https://${subdomain}.pages.dev`;
  }
  return `https://${projectName}.pages.dev`;
}