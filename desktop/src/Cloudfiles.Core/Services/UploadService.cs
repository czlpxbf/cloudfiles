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

    public async Task<List<string>> UploadFileAsync(string accountId, string projectName, string remotePath, byte[] fileBytes, string contentType)
    {
        var chunks = _chunker.ChunkFile(remotePath, fileBytes, contentType);

        if (chunks.Count == 1)
        {
            var url = await _apiClient.DeployFileAsync(accountId, projectName, remotePath, fileBytes, contentType);
            ProgressChanged?.Invoke(this, new UploadProgressEventArgs { BytesUploaded = fileBytes.Length, TotalBytes = fileBytes.Length, FileName = remotePath });
            return new List<string> { url };
        }

        // For multi-chunk files, deploy all chunks together
        var fileList = chunks.Select(c => (c.RemotePath, c.Bytes, c.ContentType)).ToList();
        var urls = await _apiClient.DeployFilesAsync(accountId, projectName, fileList);

        var totalBytes = fileBytes.Length;
        ProgressChanged?.Invoke(this, new UploadProgressEventArgs { BytesUploaded = totalBytes, TotalBytes = totalBytes, FileName = remotePath });

        return urls;
    }

    public async Task<List<string>> UploadFilesAsync(string accountId, string projectName, List<(string remotePath, byte[] bytes, string contentType)> files)
    {
        var allFiles = new List<(string remotePath, byte[] bytes, string contentType)>();
        long totalBytes = 0;

        foreach (var file in files)
        {
            var chunks = _chunker.ChunkFile(file.remotePath, file.bytes, file.contentType);
            foreach (var chunk in chunks)
            {
                allFiles.Add((chunk.RemotePath, chunk.Bytes, chunk.ContentType));
            }
            totalBytes += file.bytes.Length;
        }

        var urls = await _apiClient.DeployFilesAsync(accountId, projectName, allFiles);

        ProgressChanged?.Invoke(this, new UploadProgressEventArgs { BytesUploaded = totalBytes, TotalBytes = totalBytes, FileName = $"{files.Count} files" });

        return urls;
    }
}

public class UploadProgressEventArgs : EventArgs
{
    public long BytesUploaded { get; set; }
    public long TotalBytes { get; set; }
    public string FileName { get; set; } = "";
    public double Progress => TotalBytes > 0 ? (double)BytesUploaded / TotalBytes : 0;
}
