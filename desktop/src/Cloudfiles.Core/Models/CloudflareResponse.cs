using System.Text.Json.Serialization;

namespace Cloudfiles.Core.Models;

public class CloudflareResponse<T>
{
    [JsonPropertyName("result")]
    public T? Result { get; set; }

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("errors")]
    public List<CloudflareError>? Errors { get; set; }

    [JsonPropertyName("messages")]
    public List<string>? Messages { get; set; }
}

public class CloudflareError
{
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";
}
