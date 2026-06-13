using System.Text.Json.Serialization;

namespace Cloudfiles.Core.Models;

public class TokenInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("expires_on")]
    public string? ExpiresOn { get; set; }
}
