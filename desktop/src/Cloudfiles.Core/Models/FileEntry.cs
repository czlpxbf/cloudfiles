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
}
