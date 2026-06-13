using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Cloudfiles.Core.Models;

namespace Cloudfiles.Core.Api;

public class CloudflareApiClient
{
    private readonly HttpClient _httpClient;
    private string? _apiToken;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    public CloudflareApiClient(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public void SetApiToken(string token)
    {
        _apiToken = token;
    }

    public async Task<TokenInfo> VerifyTokenAsync()
    {
        var request = CreateRequest(HttpMethod.Get,
            "https://api.cloudflare.com/client/v4/user/tokens/verify");
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<CloudflareResponse<TokenInfo>>(json, JsonOptions);
        return result?.Result ?? throw new InvalidOperationException("验证 Token 失败");
    }

    public async Task<string> GetAccountIdAsync()
    {
        var request = CreateRequest(HttpMethod.Get,
            "https://api.cloudflare.com/client/v4/accounts");
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<CloudflareResponse<List<JsonElement>>>(json, JsonOptions);
        var account = result?.Result?.FirstOrDefault()
            ?? throw new InvalidOperationException("未找到账户信息");

        return account.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("无法获取账户 ID");
    }

    public async Task<List<PagesProject>> ListProjectsAsync(string accountId)
    {
        var request = CreateRequest(HttpMethod.Get,
            $"https://api.cloudflare.com/client/v4/accounts/{accountId}/pages/projects");
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<CloudflareResponse<List<PagesProject>>>(json, JsonOptions);
        return result?.Result ?? new List<PagesProject>();
    }

    public async Task<PagesProject> GetProjectAsync(string accountId, string projectName)
    {
        var request = CreateRequest(HttpMethod.Get,
            $"https://api.cloudflare.com/client/v4/accounts/{accountId}/pages/projects/{projectName}");
        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<CloudflareResponse<PagesProject>>(json, JsonOptions);
        return result?.Result ?? throw new InvalidOperationException($"获取项目 {projectName} 失败");
    }

    public async Task<PagesProject> CreateProjectAsync(string accountId, string projectName, string? productionBranch = null)
    {
        var body = new
        {
            name = projectName,
            production_branch = productionBranch ?? "main"
        };

        var request = CreateRequest(HttpMethod.Post,
            $"https://api.cloudflare.com/client/v4/accounts/{accountId}/pages/projects");
        request.Content = JsonContent.Create(body, options: JsonOptions);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        var result = JsonSerializer.Deserialize<CloudflareResponse<PagesProject>>(json, JsonOptions);
        return result?.Result ?? throw new InvalidOperationException($"创建项目 {projectName} 失败");
    }

    public async Task<string> DeployFileAsync(string accountId, string projectName, string remotePath, byte[] fileBytes, string contentType)
    {
        var urls = await DeployFilesAsync(accountId, projectName, new List<(string remotePath, byte[] bytes, string contentType)>
        {
            (remotePath, fileBytes, contentType)
        });
        return urls[0];
    }

    public async Task<List<string>> DeployFilesAsync(string accountId, string projectName, List<(string remotePath, byte[] bytes, string contentType)> files)
    {
        if (files.Count == 0)
        {
            return new List<string>();
        }

        // Step 1: Get upload JWT
        var jwtRequest = CreateRequest(HttpMethod.Get,
            $"https://api.cloudflare.com/client/v4/accounts/{accountId}/pages/projects/{projectName}/upload-token");
        var jwtResponse = await _httpClient.SendAsync(jwtRequest);
        jwtResponse.EnsureSuccessStatusCode();

        var jwtJson = await jwtResponse.Content.ReadAsStringAsync();
        var jwtResult = JsonSerializer.Deserialize<CloudflareResponse<JsonElement>>(jwtJson, JsonOptions);
        var jwt = jwtResult?.Result.GetProperty("jwt").GetString()
            ?? throw new InvalidOperationException("获取上传 JWT 失败");

        // Step 2: Upload assets (base64 encoded)
        var uploadItems = new List<object>();
        var manifest = new Dictionary<string, string>();

        foreach (var (remotePath, bytes, contentType) in files)
        {
            var hash = ComputeHash(bytes, remotePath);
            var base64Content = Convert.ToBase64String(bytes);

            uploadItems.Add(new
            {
                key = hash,
                value = base64Content,
                metadata = new { contentType },
                base64 = true
            });

            manifest[remotePath] = hash;
        }

        var uploadRequest = new HttpRequestMessage(HttpMethod.Post,
            "https://api.cloudflare.com/client/v4/pages/assets/upload");
        uploadRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        uploadRequest.Content = JsonContent.Create(uploadItems);
        var uploadResponse = await _httpClient.SendAsync(uploadRequest);
        uploadResponse.EnsureSuccessStatusCode();

        // Step 3: Upsert hashes
        var hashes = manifest.Values.ToList();
        var upsertRequest = new HttpRequestMessage(HttpMethod.Post,
            "https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes");
        upsertRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", jwt);
        upsertRequest.Content = JsonContent.Create(new { hashes });
        var upsertResponse = await _httpClient.SendAsync(upsertRequest);
        upsertResponse.EnsureSuccessStatusCode();

        // Step 4: Create deployment with manifest
        var manifestJson = JsonSerializer.Serialize(manifest);
        using var formContent = new MultipartFormDataContent();
        formContent.Add(new StringContent(manifestJson, Encoding.UTF8, "application/json"), "manifest");

        var deployRequest = new HttpRequestMessage(HttpMethod.Post,
            $"https://api.cloudflare.com/client/v4/accounts/{accountId}/pages/projects/{projectName}/deployments");
        deployRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);
        deployRequest.Content = formContent;

        var deployResponse = await _httpClient.SendAsync(deployRequest);
        deployResponse.EnsureSuccessStatusCode();

        var deployJson = await deployResponse.Content.ReadAsStringAsync();
        var deployResult = JsonSerializer.Deserialize<CloudflareResponse<JsonElement>>(deployJson, JsonOptions);

        var urls = new List<string>();
        if (deployResult?.Result.TryGetProperty("url", out var urlProp) == true)
        {
            var baseUrl = urlProp.GetString() ?? "";
            foreach (var (remotePath, _, _) in files)
            {
                urls.Add($"{baseUrl}{remotePath}");
            }
        }

        return urls;
    }

    public async Task DeployMainJsonAsync(string accountId, string projectName, string jsonContent)
    {
        var bytes = Encoding.UTF8.GetBytes(jsonContent);
        await DeployFileAsync(accountId, projectName, "/main.json", bytes, "application/json");
    }

    public async Task<JsonElement> GetFileIndexAsync(string projectUrl)
    {
        var url = projectUrl.TrimEnd('/') + "/main.json";
        var response = await _httpClient.GetAsync(url);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    public async Task<byte[]> DownloadChunkAsync(string url)
    {
        var response = await _httpClient.GetAsync(url);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync();
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string url)
    {
        var request = new HttpRequestMessage(method, url);
        if (!string.IsNullOrEmpty(_apiToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiToken);
        }
        return request;
    }

    private static string ComputeHash(byte[] fileBytes, string remotePath)
    {
        var pathBytes = Encoding.UTF8.GetBytes(remotePath);
        var combined = new byte[fileBytes.Length + pathBytes.Length];
        Buffer.BlockCopy(fileBytes, 0, combined, 0, fileBytes.Length);
        Buffer.BlockCopy(pathBytes, 0, combined, fileBytes.Length, pathBytes.Length);

        using var md5 = MD5.Create();
        var hashBytes = md5.ComputeHash(combined);
        return Convert.ToHexString(hashBytes).ToLowerInvariant();
    }
}
