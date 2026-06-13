using Cloudfiles.Core.Api;
using Cloudfiles.Core.Models;

namespace Cloudfiles.Core.Services;

public class DownloadService
{
    private readonly HttpClient _httpClient;

    public DownloadService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public event EventHandler<DownloadProgressEventArgs>? ProgressChanged;

    public async Task<byte[]> DownloadFileAsync(string url)
    {
        var response = await _httpClient.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength ?? 0;
        using var stream = await response.Content.ReadAsStreamAsync();
        using var memoryStream = new MemoryStream();

        var buffer = new byte[8192];
        int bytesRead;
        long totalRead = 0;

        while ((bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length)) > 0)
        {
            await memoryStream.WriteAsync(buffer, 0, bytesRead);
            totalRead += bytesRead;

            ProgressChanged?.Invoke(this, new DownloadProgressEventArgs
            {
                BytesDownloaded = totalRead,
                TotalBytes = totalBytes,
                Url = url
            });
        }

        return memoryStream.ToArray();
    }

    public async Task DownloadFileToDiskAsync(string url, string localPath)
    {
        var fileBytes = await DownloadFileAsync(url);

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
    public long BytesDownloaded { get; set; }
    public long TotalBytes { get; set; }
    public string Url { get; set; } = "";
    public double Progress => TotalBytes > 0 ? (double)BytesDownloaded / TotalBytes : 0;
}
