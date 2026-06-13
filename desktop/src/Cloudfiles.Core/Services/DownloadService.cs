using Cloudfiles.Core.Api;

namespace Cloudfiles.Core.Services;

public class DownloadService
{
    private readonly CloudflareApiClient _apiClient;

    public DownloadService(CloudflareApiClient apiClient)
    {
        _apiClient = apiClient;
    }

    public event EventHandler<DownloadProgressEventArgs>? ProgressChanged;

    /// <summary>
    /// 并行下载分块并合并为完整字节数组
    /// </summary>
    /// <param name="chunkUrls">分块 URL 列表（按顺序）</param>
    /// <returns>合并后的字节数组</returns>
    public async Task<byte[]> DownloadAndMergeChunksAsync(List<string> chunkUrls)
    {
        if (chunkUrls.Count == 0)
        {
            return Array.Empty<byte>();
        }

        var totalChunks = chunkUrls.Count;
        var completedChunks = 0;
        var chunkData = new byte[totalChunks][];

        // 使用 SemaphoreSlim 限制并发数为 4
        using var semaphore = new SemaphoreSlim(4);
        var tasks = new List<Task>();

        for (var i = 0; i < totalChunks; i++)
        {
            var index = i;
            await semaphore.WaitAsync();

            var task = Task.Run(async () =>
            {
                try
                {
                    chunkData[index] = await _apiClient.DownloadChunkAsync(chunkUrls[index]);

                    Interlocked.Increment(ref completedChunks);
                    var progress = (double)completedChunks / totalChunks * 100;
                    ProgressChanged?.Invoke(this, new DownloadProgressEventArgs
                    {
                        CompletedChunks = completedChunks,
                        TotalChunks = totalChunks,
                        Progress = progress
                    });
                }
                finally
                {
                    semaphore.Release();
                }
            });

            tasks.Add(task);
        }

        await Task.WhenAll(tasks);

        // 按顺序合并所有分块
        using var memoryStream = new MemoryStream();
        foreach (var data in chunkData)
        {
            if (data != null)
            {
                await memoryStream.WriteAsync(data, 0, data.Length);
            }
        }

        return memoryStream.ToArray();
    }

    /// <summary>
    /// 下载分块并保存到本地文件
    /// </summary>
    public async Task DownloadToFileAsync(List<string> chunkUrls, string localPath)
    {
        var fileBytes = await DownloadAndMergeChunksAsync(chunkUrls);

        var directory = Path.GetDirectoryName(localPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllBytesAsync(localPath, fileBytes);
    }
}

public class DownloadProgressEventArgs : EventArgs
{
    public int CompletedChunks { get; set; }
    public int TotalChunks { get; set; }
    public double Progress { get; set; }
}
