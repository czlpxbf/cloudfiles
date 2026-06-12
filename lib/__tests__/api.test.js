// lib/__tests__/api.test.js
// api.js 单元测试 - mock fetch 以避免真实 API 调用

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock config.js 中的凭据
vi.mock('../config.js', () => ({
  CLOUDFLARE_API_TOKEN: 'test-token-123',
  CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
  MAIN_PROJECT_NAME: 'test-project',
  DATA_PROJECT_NAME: 'test-project-data',
  MAIN_PROJECT_URL: 'https://test-project.pages.dev',
  CHUNK_SIZE: 25 * 1024 * 1024,
  TEMP_CHUNK_DIR: '/tmp/test-chunks',
  TEMP_SITE_DIR: '/tmp/test-site',
  MAX_RETRIES: 3,
  MAX_WORKERS: 2,
  DISTRIBUTED_ARCHITECTURE: false,
  DOWNLOAD_DIR: '/tmp/test-download',
  UPDATE_DIR: '/tmp/test-update',
  CHUNK_DIR: '/tmp/test-chunks',
  PREVIEW_CACHE_DIR: '/tmp/test-preview-cache',
}));

// mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

import fetch from 'node-fetch';
import {
  verifyToken,
  getAccountId,
  listProjects,
  createProject,
  getProject,
  deployFile,
  deployMainJson,
  getProductionUrl,
} from '../api.js';

function mockFetchResponse(data, ok = true, status = 200) {
  fetch.mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

describe('api.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyToken', () => {
    it('应在 Token 有效时返回结果', async () => {
      mockFetchResponse({
        success: true,
        result: { status: 'active', id: 'token-id' },
      });

      const result = await verifyToken();
      expect(result.status).toBe('active');
      expect(fetch).toHaveBeenCalledTimes(1);
      const call = fetch.mock.calls[0];
      expect(call[1].headers['Authorization']).toBe('Bearer test-token-123');
    });

    it('应在 API 返回失败时抛出错误', async () => {
      mockFetchResponse({
        success: false,
        errors: [{ message: 'Invalid token' }],
      });

      await expect(verifyToken()).rejects.toThrow('Cloudflare API 错误: Invalid token');
    });
  });

  describe('getAccountId', () => {
    it('应在已配置 CLOUDFLARE_ACCOUNT_ID 时直接返回', async () => {
      const result = await getAccountId();
      expect(result).toBe('test-account-id');
      expect(fetch).not.toHaveBeenCalled();
    });

    it('应在未配置时自动检测账号 ID', async () => {
      const config = await import('../config.js');
      const original = config.CLOUDFLARE_ACCOUNT_ID;
      config.CLOUDFLARE_ACCOUNT_ID = '';

      mockFetchResponse({
        success: true,
        result: [{ id: 'auto-detected-id', name: 'My Account' }],
      });

      const result = await getAccountId();
      expect(result).toBe('auto-detected-id');

      config.CLOUDFLARE_ACCOUNT_ID = original;
    });

    it('应在无账号时抛出错误', async () => {
      const config = await import('../config.js');
      const original = config.CLOUDFLARE_ACCOUNT_ID;
      config.CLOUDFLARE_ACCOUNT_ID = '';

      mockFetchResponse({
        success: true,
        result: [],
      });

      await expect(getAccountId()).rejects.toThrow('未找到 Cloudflare 账号');

      config.CLOUDFLARE_ACCOUNT_ID = original;
    });
  });

  describe('listProjects', () => {
    it('应返回项目名称列表', async () => {
      mockFetchResponse({
        success: true,
        result: [
          { name: 'project-a' },
          { name: 'project-b' },
        ],
      });

      const projects = await listProjects();
      expect(projects).toEqual(['project-a', 'project-b']);
    });
  });

  describe('createProject', () => {
    it('应发送 POST 请求创建项目', async () => {
      mockFetchResponse({ success: true, result: { name: 'new-project' } });

      await createProject('new-project');

      const call = fetch.mock.calls[0];
      expect(call[1].method).toBe('POST');
      const body = JSON.parse(call[1].body);
      expect(body.name).toBe('new-project');
      expect(body.production_branch).toBe('main');
    });
  });

  describe('getProject', () => {
    it('应返回项目详情', async () => {
      mockFetchResponse({
        success: true,
        result: { name: 'my-project', subdomain: 'my-project' },
      });

      const project = await getProject('my-project');
      expect(project.name).toBe('my-project');
    });
  });

  describe('getProductionUrl', () => {
    it('应返回带子域名的生产 URL', async () => {
      mockFetchResponse({
        success: true,
        result: { name: 'my-project', subdomain: 'my-project' },
      });

      const url = await getProductionUrl('my-project');
      expect(url).toBe('https://my-project.pages.dev');
    });

    it('应在子域名已含 .pages.dev 时不重复添加', async () => {
      mockFetchResponse({
        success: true,
        result: { name: 'my-project', subdomain: 'cloudfile-d4e.pages.dev' },
      });

      const url = await getProductionUrl('my-project');
      expect(url).toBe('https://cloudfile-d4e.pages.dev');
    });

    it('应在无子域名时回退到项目名', async () => {
      mockFetchResponse({
        success: true,
        result: { name: 'my-project', subdomain: null },
      });

      const url = await getProductionUrl('my-project');
      expect(url).toBe('https://my-project.pages.dev');
    });
  });

  describe('deployFile', () => {
    it('应完成完整的文件部署流程', async () => {
      // Step 1: 获取上传 JWT (upload-token)
      mockFetchResponse({
        success: true,
        result: { jwt: 'test-jwt-token' },
      });

      // Step 2: 上传文件 (pages/assets/upload)
      mockFetchResponse({
        success: true,
        result: {},
      });

      // Step 3: 注册哈希 (pages/assets/upsert-hashes)
      mockFetchResponse({
        success: true,
        result: {},
      });

      // Step 4: 创建部署 (deployments)
      mockFetchResponse({
        success: true,
        result: {
          id: 'deploy-123',
          project_subdomain: 'test-project-data',
        },
      });

      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const tmpFile = path.join(os.tmpdir(), `test-upload-${Date.now()}.bin`);
      fs.writeFileSync(tmpFile, Buffer.from('hello world'));

      try {
        const url = await deployFile(tmpFile, 'test-project-data', 'data');
        expect(url).toContain('test-project-data');
        expect(url).toContain('/data');
        expect(fetch).toHaveBeenCalledTimes(4); // upload-token + upload + upsert-hashes + deployment
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('应在未返回 JWT 时抛出错误', async () => {
      mockFetchResponse({
        success: true,
        result: {},
      });

      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const tmpFile = path.join(os.tmpdir(), `test-upload-${Date.now()}.bin`);
      fs.writeFileSync(tmpFile, Buffer.from('test'));

      try {
        await expect(deployFile(tmpFile, 'test-project')).rejects.toThrow('获取上传凭证失败');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('应在上传文件失败时抛出错误', async () => {
      // Step 1: JWT
      mockFetchResponse({
        success: true,
        result: { jwt: 'test-jwt' },
      });

      // Step 2: upload fails
      mockFetchResponse({
        success: false,
        errors: [{ message: 'Upload failed' }],
      });

      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const tmpFile = path.join(os.tmpdir(), `test-upload-${Date.now()}.bin`);
      fs.writeFileSync(tmpFile, Buffer.from('test'));

      try {
        await expect(deployFile(tmpFile, 'test-project')).rejects.toThrow('上传文件失败');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });

  describe('deployMainJson', () => {
    it('应完成 main.json 部署流程', async () => {
      // Step 1: upload-token
      mockFetchResponse({
        success: true,
        result: { jwt: 'test-jwt' },
      });

      // Step 2: upload
      mockFetchResponse({
        success: true,
        result: {},
      });

      // Step 3: upsert-hashes
      mockFetchResponse({
        success: true,
        result: {},
      });

      // Step 4: deployment
      mockFetchResponse({ success: true, result: { id: 'deploy-456' } });

      await deployMainJson('{"test": true}', 'test-project');

      expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('应在未返回 JWT 时抛出错误', async () => {
      mockFetchResponse({
        success: true,
        result: {},
      });

      await expect(deployMainJson('{}', 'test-project')).rejects.toThrow('获取上传凭证失败');
    });

    it('应在注册哈希失败时抛出错误', async () => {
      // Step 1: JWT
      mockFetchResponse({
        success: true,
        result: { jwt: 'test-jwt' },
      });

      // Step 2: upload success
      mockFetchResponse({
        success: true,
        result: {},
      });

      // Step 3: upsert-hashes fails
      mockFetchResponse({
        success: false,
        errors: [{ message: 'Hash error' }],
      });

      await expect(deployMainJson('{}', 'test-project')).rejects.toThrow('注册哈希失败');
    });
  });
});
