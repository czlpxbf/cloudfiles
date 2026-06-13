using Cloudfiles.Core.Api;
using Cloudfiles.Core.Models;

namespace Cloudfiles.Core.Services;

public class UploadService
{
    private readonly CloudflareApiClient _apiClient;
    private readonly FileChunker _chunker;

    public UploadService(CloudflareApiClient apiClient, FileChunker chunker)
    {
        _apiClient = apiClient;
        _chunker = chunker;
    }

    public event EventHandler<UploadProgressEventArgs>? ProgressChanged;

    /// <summary>
    /// 上传文件列表到数据项目，返回每个文件的分块 URL 列表
    /// </summary>
    /// <param name="accountId">Cloudflare 账户 ID</param>
    /// <param name="dataProjectName">数据项目名称</param>
    /// <param name="dataProjectSubdomain">数据项目子域名（如 cloudfile-data.pages.dev）</param>
    /// <param name="files">文件列表（本地路径 + 远程路径）</param>
    /// <returns>每个文件的分块 URL 列表，格式为 https://{subdomain}/chunk-{index}</returns>
    public async Task<List<List<string>>> UploadFilesAsync(
        string accountId,
        string dataProjectName,
        string dataProjectSubdomain,
        List<(string localPath, string remotePath)> files)
    {
        var allChunkFiles = new List<(string remotePath, byte[] bytes, string contentType)>();
        var fileChunkIndices = new List<(int startIndex, int count)>();
        long totalBytes = 0;

        // 构建数据项目 URL
        var dataProjectUrl = dataProjectSubdomain.EndsWith(".pages.dev", StringComparison.OrdinalIgnoreCase)
            ? $"https://{dataProjectSubdomain}"
            : $"https://{dataProjectSubdomain}.pages.dev";

        foreach (var (localPath, _) in files)
        {
            var fileBytes = await File.ReadAllBytesAsync(localPath);
            var contentType = GetContentType(Path.GetExtension(localPath));
            var chunks = _chunker.ChunkFile(fileBytes, contentType);

            var startIndex = allChunkFiles.Count;
            var count = chunks.Count;

            foreach (var chunk in chunks)
            {
                allChunkFiles.Add((chunk.RemotePath, chunk.Bytes, chunk.ContentType));
            }

            fileChunkIndices.Add((startIndex, count));
            totalBytes += fileBytes.Length;
        }

        // 批量上传所有分块到数据项目
        if (allChunkFiles.Count > 0)
        {
            await _apiClient.DeployFilesAsync(accountId, dataProjectName, allChunkFiles);
        }

        ProgressChanged?.Invoke(this, new UploadProgressEventArgs
        {
            BytesUploaded = totalBytes,
            TotalBytes = totalBytes,
            FileName = $"{files.Count} 个文件"
        });

        // 构建每个文件的分块 URL 列表
        var result = new List<List<string>>();
        foreach (var (startIndex, count) in fileChunkIndices)
        {
            var chunkUrls = new List<string>();
            for (var i = 0; i < count; i++)
            {
                var chunkRemotePath = allChunkFiles[startIndex + i].remotePath;
                // chunkRemotePath 格式为 "chunk-{index}"，拼接为完整 URL
                chunkUrls.Add($"{dataProjectUrl}/{chunkRemotePath}");
            }
            result.Add(chunkUrls);
        }

        return result;
    }

    private static string GetContentType(string extension)
    {
        return extension.ToLowerInvariant() switch
        {
            ".html" or ".htm" => "text/html",
            ".css" => "text/css",
            ".js" => "application/javascript",
            ".json" => "application/json",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            ".pdf" => "application/pdf",
            ".txt" => "text/plain",
            ".xml" => "application/xml",
            ".zip" => "application/zip",
            _ => "application/octet-stream"
        };
    }
}

public class UploadProgressEventArgs : EventArgs
{
    public long BytesUploaded { get; set; }
    public long TotalBytes { get; set; }
    public string FileName { get; set; } = "";
    public double Progress => TotalBytes > 0 ? (double)BytesUploaded / TotalBytes : 0;
}
