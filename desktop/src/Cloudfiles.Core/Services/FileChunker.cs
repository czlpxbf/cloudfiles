namespace Cloudfiles.Core.Services;

public class FileChunker
{
    public int ChunkSizeBytes { get; set; } = 25 * 1024 * 1024; // 25 MB

    public List<FileChunk> ChunkFile(string remotePath, byte[] fileBytes, string contentType)
    {
        var chunks = new List<FileChunk>();

        if (fileBytes.Length <= ChunkSizeBytes)
        {
            chunks.Add(new FileChunk
            {
                RemotePath = remotePath,
                Bytes = fileBytes,
                ContentType = contentType,
                ChunkIndex = 0,
                TotalChunks = 1
            });
            return chunks;
        }

        var totalChunks = (int)Math.Ceiling((double)fileBytes.Length / ChunkSizeBytes);
        var offset = 0;

        for (var i = 0; i < totalChunks; i++)
        {
            var chunkSize = Math.Min(ChunkSizeBytes, fileBytes.Length - offset);
            var chunkBytes = new byte[chunkSize];
            Buffer.BlockCopy(fileBytes, offset, chunkBytes, 0, chunkSize);

            chunks.Add(new FileChunk
            {
                RemotePath = remotePath,
                Bytes = chunkBytes,
                ContentType = contentType,
                ChunkIndex = i,
                TotalChunks = totalChunks
            });

            offset += chunkSize;
        }

        return chunks;
    }
}

public class FileChunk
{
    public string RemotePath { get; set; } = "";
    public byte[] Bytes { get; set; } = Array.Empty<byte>();
    public string ContentType { get; set; } = "application/octet-stream";
    public int ChunkIndex { get; set; }
    public int TotalChunks { get; set; }
}
