using System.Text.Json.Serialization;

namespace Cloudfiles.Core.Models;

public class DeploymentInfo
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("environment")]
    public string Environment { get; set; } = "";

    [JsonPropertyName("created_on")]
    public string? CreatedOn { get; set; }

    [JsonPropertyName("modified_on")]
    public string? ModifiedOn { get; set; }

    [JsonPropertyName("latest_stage")]
    public DeploymentStage? LatestStage { get; set; }

    [JsonPropertyName("aliases")]
    public List<string>? Aliases { get; set; }

    [JsonPropertyName("is_skipped")]
    public bool IsSkipped { get; set; }

    public string Status => LatestStage?.Status ?? "unknown";
    public string StageName => LatestStage?.Name ?? "";
}

public class DeploymentStage
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("status")]
    public string Status { get; set; } = "";

    [JsonPropertyName("started_on")]
    public string? StartedOn { get; set; }

    [JsonPropertyName("ended_on")]
    public string? EndedOn { get; set; }
}
