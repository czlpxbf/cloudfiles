namespace Cloudfiles.Core.Models;

public class FileEntry
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public bool IsFolder { get; set; }
    public long Size { get; set; }
    public string ContentType { get; set; } = "application/octet-stream";
    public DateTime? LastModified { get; set; }
    public int ChunkCount { get; set; }
    public List<string> Chunks { get; set; } = new();
    public int VersionCount { get; set; }

    public string FormattedSize => IsFolder ? "" : FormatFileSize(Size);

    public string VersionDisplay => IsFolder ? "文件夹" : $"{VersionCount} 个版本";

    private static string FormatFileSize(long bytes)
    {
        if (bytes == 0) return "0 B";
        string[] suffixes = { "B", "KB", "MB", "GB", "TB" };
        int order = 0;
        double size = bytes;
        while (size >= 1024 && order < suffixes.Length - 1)
        {
            order++;
            size /= 1024;
        }
        return $"{size:0.##} {suffixes[order]}";
    }
}
