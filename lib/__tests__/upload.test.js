// lib/__tests__/upload.test.js
// upload.js 单元测试

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// mock config
vi.mock('../config.js', () => ({
  CHUNK_SIZE: 100, // 小分块便于测试
  TEMP_CHUNK_DIR: path.join(os.tmpdir(), 'cloudfiles-test-chunks'),
  MAX_RETRIES: 2,
  DATA_PROJECT_NAME: 'test-data-project',
  MAX_WORKERS: 2,
}));

// mock api.js
vi.mock('../api.js', () => ({
  deployFile: vi.fn(),
  deployFiles: vi.fn(),
}));

// mock utils.js
vi.mock('../utils.js', () => ({
  now: vi.fn(() => '2025-01-01T00:00:00.000Z'),
}));

import { uploadSingleFile } from '../upload.js';
import { deployFile, deployFiles } from '../api.js';

describe('upload.js', () => {
  let tmpDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudfiles-upload-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('uploadSingleFile - 文件上传', () => {
    it('应上传空文件并返回正确的元数据', async () => {
      const emptyFile = path.join(tmpDir, 'empty.txt');
      fs.writeFileSync(emptyFile, '');

      const result = await uploadSingleFile(emptyFile);

      expect(result.type).toBe('file');
      expect(result.size).toBe(0);
      expect(result.chunks).toEqual([]);
      expect(result.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(deployFile).not.toHaveBeenCalled();
    });

    it('应上传小文件（单分块）并返回包含 URL 的元数据', async () => {
      const smallFile = path.join(tmpDir, 'small.txt');
      fs.writeFileSync(smallFile, 'hello world');

      deployFile.mockResolvedValueOnce('https://abc123.test-data.pages.dev/data');

      const result = await uploadSingleFile(smallFile);

      expect(result.type).toBe('file');
      expect(result.size).toBe(11);
      expect(result.chunks).toEqual(['https://abc123.test-data.pages.dev/data']);
      expect(deployFile).toHaveBeenCalledTimes(1);
    });

    it('应在路径不存在时抛出错误', async () => {
      await expect(uploadSingleFile('/nonexistent/file.txt')).rejects.toThrow('路径不存在');
    });

    it('应上传大文件（多分块）', async () => {
      // CHUNK_SIZE = 100，所以 250 字节会产生 3 个分块
      const largeFile = path.join(tmpDir, 'large.bin');
      fs.writeFileSync(largeFile, Buffer.alloc(250, 'x'));

      deployFiles.mockResolvedValueOnce([
        'https://chunk0.pages.dev/chunk-0',
        'https://chunk0.pages.dev/chunk-1',
        'https://chunk0.pages.dev/chunk-2',
      ]);

      const result = await uploadSingleFile(largeFile);

      expect(result.type).toBe('file');
      expect(result.size).toBe(250);
      expect(result.chunks).toHaveLength(3);
      expect(deployFiles).toHaveBeenCalledTimes(1);
    });

    it('应在所有重试失败后抛出错误', async () => {
      const smallFile = path.join(tmpDir, 'fail.txt');
      fs.writeFileSync(smallFile, 'data');

      deployFile.mockRejectedValue(new Error('Network error'));

      await expect(uploadSingleFile(smallFile)).rejects.toThrow('上传失败');
    });
  });

  describe('uploadSingleFile - 目录上传', () => {
    it('应递归上传目录中的文件', async () => {
      const dir = path.join(tmpDir, 'mydir');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'file1.txt'), 'content1');
      fs.writeFileSync(path.join(dir, 'file2.txt'), 'content2');

      deployFile
        .mockResolvedValueOnce('https://f1.pages.dev/data')
        .mockResolvedValueOnce('https://f2.pages.dev/data');

      const result = await uploadSingleFile(dir);

      expect(result.type).toBe('folder');
      expect(result.children).toHaveProperty('file1.txt');
      expect(result.children).toHaveProperty('file2.txt');
      // 文件节点是数组（版本控制）
      expect(Array.isArray(result.children['file1.txt'])).toBe(true);
      expect(Array.isArray(result.children['file2.txt'])).toBe(true);
    });

    it('应处理嵌套目录', async () => {
      const dir = path.join(tmpDir, 'nested');
      const subDir = path.join(dir, 'subdir');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, 'deep.txt'), 'deep content');

      deployFile.mockResolvedValueOnce('https://deep.pages.dev/data');

      const result = await uploadSingleFile(dir);

      expect(result.type).toBe('folder');
      expect(result.children.subdir.type).toBe('folder');
      expect(result.children.subdir.children).toHaveProperty('deep.txt');
    });
  });
});
