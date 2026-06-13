using Cloudfiles.Core.Api;

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
    /// Upload files to the data project. Returns chunk URLs per file.
    /// </summary>
    public async Task<List<List<string>>> UploadFilesAsync(
        string accountId, string projectName, string dataProjectSubdomain,
        List<(string localPath, string remotePath)> files)
    {
        var allChunks = new List<(string remotePath, byte[] bytes, string contentType)>();
        var fileChunkCounts = new List<int>();
        long totalBytes = 0;

        foreach (var (localPath, _) in files)
        {
            var fileBytes = await File.ReadAllBytesAsync(localPath);
            var contentType = GetContentType(Path.GetExtension(localPath));
            var chunks = _chunker.ChunkFile(fileBytes, contentType);
            fileChunkCounts.Add(chunks.Count);

            foreach (var chunk in chunks)
            {
                allChunks.Add((chunk.RemotePath, chunk.Bytes, chunk.ContentType));
            }
            totalBytes += fileBytes.Length;
        }

        // Upload all chunks in one batch
        await _apiClient.DeployFilesAsync(accountId, projectName, allChunks);

        // Build chunk URLs per file
        var result = new List<List<string>>();
        var chunkIndex = 0;
        for (var i = 0; i < files.Count; i++)
        {
            var urls = new List<string>();
            for (var j = 0; j < fileChunkCounts[i]; j++)
            {
                urls.Add($"https://{dataProjectSubdomain}.pages.dev/{allChunks[chunkIndex].remotePath}");
                chunkIndex++;
            }
            result.Add(urls);
        }

        ProgressChanged?.Invoke(this, new UploadProgressEventArgs { BytesUploaded = totalBytes, TotalBytes = totalBytes });

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
            _ => "application/octet-stream"
        };
    }
}

public class UploadProgressEventArgs : EventArgs
{
    public long BytesUploaded { get; set; }
    public long TotalBytes { get; set; }
    public double Progress => TotalBytes > 0 ? (double)BytesUploaded / TotalBytes : 0;
}
