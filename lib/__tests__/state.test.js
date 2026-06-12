// lib/__tests__/state.test.js
// state.js 单元测试

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// mock config
vi.mock('../config.js', () => ({
  TEMP_SITE_DIR: path.join(os.tmpdir(), 'cloudfiles-test-site'),
  MAIN_PROJECT_NAME: 'test-project',
  MAIN_PROJECT_URL: 'https://test-project.pages.dev',
}));

// mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// mock api.js
vi.mock('../api.js', () => ({
  deployMainJson: vi.fn(),
}));

// mock utils.js
vi.mock('../utils.js', () => ({
  now: vi.fn(() => '2025-01-01T00:00:00.000Z'),
}));

// mock tree.js
vi.mock('../tree.js', () => ({
  calculateStats: vi.fn(() => ({ totalSize: 1024, totalChunks: 2 })),
}));

import fetch from 'node-fetch';
import { downloadRemoteIndex, deployIndex } from '../state.js';
import { deployMainJson } from '../api.js';
import { calculateStats } from '../tree.js';

describe('state.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('downloadRemoteIndex', () => {
    it('应在 projectUrl 为空时返回空索引', async () => {
      const result = await downloadRemoteIndex(null);
      expect(result.fs_root.type).toBe('folder');
      expect(result.fs_root.children).toEqual({});
      expect(fetch).not.toHaveBeenCalled();
    });

    it('应在远程返回 404 时返回空索引', async () => {
      fetch.mockResolvedValueOnce({
        status: 404,
        ok: false,
      });

      const result = await downloadRemoteIndex('https://test.pages.dev');
      expect(result.fs_root.type).toBe('folder');
      expect(result.fs_root.children).toEqual({});
    });

    it('应成功下载并解析远程 main.json', async () => {
      const remoteData = {
        fs_root: {
          type: 'folder',
          children: { 'file.txt': [{ type: 'file' }] },
        },
      };

      fetch.mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () => Promise.resolve(remoteData),
      });

      const result = await downloadRemoteIndex('https://test.pages.dev');
      expect(result.fs_root.children).toHaveProperty('file.txt');
    });

    it('应在网络错误时抛出异常', async () => {
      fetch.mockResolvedValueOnce({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
      });

      await expect(downloadRemoteIndex('https://test.pages.dev')).rejects.toThrow();
    });
  });

  describe('deployIndex', () => {
    it('应计算统计信息并调用 deployMainJson', async () => {
      const jsonData = {
        fs_root: {
          type: 'folder',
          children: {},
        },
      };

      await deployIndex(jsonData);

      expect(calculateStats).toHaveBeenCalled();
      expect(deployMainJson).toHaveBeenCalledTimes(1);

      // 验证传递的内容包含统计信息
      const deployedContent = deployMainJson.mock.calls[0][0];
      const parsed = JSON.parse(deployedContent);
      expect(parsed.fs_root.stats).toBeDefined();
      expect(parsed.fs_root.stats.totalSizeBytes).toBe(1024);
    });

    it('应在目录为空时不添加统计信息', async () => {
      calculateStats.mockReturnValueOnce({ totalSize: 0, totalChunks: 0 });

      const jsonData = {
        fs_root: {
          type: 'folder',
          children: {},
        },
      };

      await deployIndex(jsonData);

      const deployedContent = deployMainJson.mock.calls[0][0];
      const parsed = JSON.parse(deployedContent);
      expect(parsed.fs_root.stats).toBeUndefined();
    });
  });
});
