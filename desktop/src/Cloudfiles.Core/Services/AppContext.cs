using System.Net.Http;
using Cloudfiles.Core.Api;

namespace Cloudfiles.Core.Services;

public class AppContext
{
    private static AppContext? _instance;
    public static AppContext Instance => _instance ??= new AppContext();

    public HttpClient HttpClient { get; }
    public CloudflareApiClient ApiClient { get; }
    public ConfigService ConfigService { get; }

    private AppContext()
    {
        HttpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        ApiClient = new CloudflareApiClient(HttpClient);
        ConfigService = new ConfigService();
    }

    public async Task InitializeAsync()
    {
        await ConfigService.LoadAsync();
        if (!string.IsNullOrEmpty(ConfigService.Config.ApiToken))
        {
            ApiClient.SetApiToken(ConfigService.Config.ApiToken);
        }
    }
}
