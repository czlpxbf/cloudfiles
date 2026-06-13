using System.Text.Json;
using Cloudfiles.Core.Models;

namespace Cloudfiles.Core.Services;

public class ConfigService
{
    private static readonly string ConfigDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Cloudfiles");

    private static readonly string ConfigPath = Path.Combine(ConfigDir, "config.json");

    public AppConfig Config { get; private set; } = new();

    public async Task LoadAsync()
    {
        if (!File.Exists(ConfigPath))
        {
            Config = new AppConfig();
            return;
        }

        var json = await File.ReadAllTextAsync(ConfigPath);
        Config = JsonSerializer.Deserialize<AppConfig>(json) ?? new AppConfig();
    }

    public async Task SaveAsync()
    {
        if (!Directory.Exists(ConfigDir))
        {
            Directory.CreateDirectory(ConfigDir);
        }

        var json = JsonSerializer.Serialize(Config, new JsonSerializerOptions { WriteIndented = true });
        await File.WriteAllTextAsync(ConfigPath, json);
    }

    public string GetProjectUrl(PagesProject project)
    {
        var subdomain = project.Subdomain;
        if (string.IsNullOrEmpty(subdomain))
        {
            return "";
        }

        if (subdomain.EndsWith(".pages.dev", StringComparison.OrdinalIgnoreCase))
        {
            return $"https://{subdomain}";
        }

        return $"https://{subdomain}.pages.dev";
    }
}

public class AppConfig
{
    public string ApiToken { get; set; } = "";
    public string AccountId { get; set; } = "";
    public string SelectedProject { get; set; } = "";
    public string DataProjectName { get; set; } = "";
    public int ChunkSizeMB { get; set; } = 25;
}
