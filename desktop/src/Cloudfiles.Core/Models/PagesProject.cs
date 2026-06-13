using System.Text.Json.Serialization;

namespace Cloudfiles.Core.Models;

public class PagesProject
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("subdomain")]
    public string Subdomain { get; set; } = "";

    [JsonPropertyName("domains")]
    public List<string>? Domains { get; set; }

    [JsonPropertyName("created_on")]
    public string? CreatedOn { get; set; }

    [JsonPropertyName("production_branch")]
    public string? ProductionBranch { get; set; }
}
