using Cloudfiles.Core.Api;

namespace Cloudfiles.Core.Services;

public class DownloadService
{
    private readonly CloudflareApiClient _apiClient;
    private readonly SemaphoreSlim _semaphore = new(4); // Max 4 concurrent downloads

    public DownloadService(CloudflareApiClient apiClient)
    {
        _apiClient = apiClient;
    }

    public event EventHandler<DownloadProgressEventArgs>? ProgressChanged;

    public async Task<byte[]> DownloadAndMergeChunksAsync(List<string> chunkUrls)
    {
        var totalChunks = chunkUrls.Count;
        var chunks = new byte[totalChunks][];
        var completedChunks = 0;

        var tasks = chunkUrls.Select(async (url, index) =>
        {
            await _semaphore.WaitAsync();
            try
            {
                chunks[index] = await _apiClient.DownloadChunkAsync(url);
                Interlocked.Increment(ref completedChunks);

                ProgressChanged?.Invoke(this, new DownloadProgressEventArgs
                {
                    CompletedChunks = completedChunks,
                    TotalChunks = totalChunks,
                    Progress = (double)completedChunks / totalChunks * 100
                });
            }
            finally
            {
                _semaphore.Release();
            }
        });

        await Task.WhenAll(tasks);

        // Merge all chunks
        var totalSize = chunks.Sum(c => c.Length);
        var result = new byte[totalSize];
        var offset = 0;
        foreach (var chunk in chunks)
        {
            Buffer.BlockCopy(chunk, 0, result, offset, chunk.Length);
            offset += chunk.Length;
        }

        return result;
    }

    public async Task DownloadToFileAsync(List<string> chunkUrls, string localPath)
    {
        var data = await DownloadAndMergeChunksAsync(chunkUrls);

        var directory = Path.GetDirectoryName(localPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllBytesAsync(localPath, data);
    }
}

public class DownloadProgressEventArgs : EventArgs
{
    public int CompletedChunks { get; set; }
    public int TotalChunks { get; set; }
    public double Progress { get; set; }
}
