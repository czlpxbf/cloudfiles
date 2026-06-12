// lib/__tests__/utils.test.js
// utils.js 单元测试

import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock config
vi.mock('../config.js', () => ({
  CLOUDFLARE_API_TOKEN: 'test-token',
  CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
  MAIN_PROJECT_URL: 'https://test-project.pages.dev',
}));

// mock api.js
vi.mock('../api.js', () => ({
  verifyToken: vi.fn(),
}));

import { now, getMainProjectUrl, ensureLoggedIn } from '../utils.js';
import { verifyToken } from '../api.js';

describe('utils.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('now', () => {
    it('应返回 ISO 格式的时间戳', () => {
      const result = now();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('应返回接近当前时间的时间戳', () => {
      const before = new Date().toISOString();
      const result = now();
      const after = new Date().toISOString();
      expect(result >= before).toBe(true);
      expect(result <= after).toBe(true);
    });
  });

  describe('getMainProjectUrl', () => {
    it('应返回配置中的主项目 URL', async () => {
      const url = await getMainProjectUrl();
      expect(url).toBe('https://test-project.pages.dev');
    });
  });

  describe('ensureLoggedIn', () => {
    it('应在 Token 有效时返回 true', async () => {
      verifyToken.mockResolvedValueOnce({ status: 'active' });

      const result = await ensureLoggedIn();
      expect(result).toBe(true);
      expect(verifyToken).toHaveBeenCalledTimes(1);
    });

    it('应在 Token 无效时调用 process.exit', async () => {
      verifyToken.mockRejectedValueOnce(new Error('Invalid token'));

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});

      await ensureLoggedIn();

      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });
});
