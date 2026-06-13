namespace Cloudfiles.Core.Models;

public class FileEntry
{
    public string Path { get; set; } = "";
    public long Size { get; set; }
    public string ContentType { get; set; } = "application/octet-stream";
    public DateTime? LastModified { get; set; }
}
