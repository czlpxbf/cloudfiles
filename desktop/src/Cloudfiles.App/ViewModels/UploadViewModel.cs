using System.IO;
using System.Collections.ObjectModel;
using System.Net.Http;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Cloudfiles.Core.Api;
using Cloudfiles.Core.Models;
using Cloudfiles.Core.Services;
using Microsoft.Win32;

namespace Cloudfiles.App.ViewModels;

public partial class UploadViewModel : ObservableObject
{
    private readonly CloudflareApiClient _apiClient;
    private readonly UploadService _uploadService;
    private readonly ConfigService _configService;

    [ObservableProperty]
    private ObservableCollection<UploadItem> _uploadItems = new();

    [ObservableProperty]
    private bool _isUploading;

    [ObservableProperty]
    private double _uploadProgress;

    [ObservableProperty]
    private string _statusMessage = "选择要上传的文件";

    [ObservableProperty]
    private string _remotePathPrefix = "/";

    public UploadViewModel()
    {
        var httpClient = new HttpClient();
        _apiClient = new CloudflareApiClient(httpClient);
        _configService = new ConfigService();
        _uploadService = new UploadService(_apiClient, new FileChunker());
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await _configService.LoadAsync();
        if (!string.IsNullOrEmpty(_configService.Config.ApiToken))
        {
            _apiClient.SetApiToken(_configService.Config.ApiToken);
        }
    }

    [RelayCommand]
    private void BrowseFiles()
    {
        var dialog = new OpenFileDialog
        {
            Multiselect = true,
            Title = "选择要上传的文件"
        };

        if (dialog.ShowDialog() == true)
        {
            foreach (var fileName in dialog.FileNames)
            {
                var fileInfo = new FileInfo(fileName);
                UploadItems.Add(new UploadItem
                {
                    LocalPath = fileName,
                    FileName = fileInfo.Name,
                    FileSize = fileInfo.Length,
                    RemotePath = RemotePathPrefix.TrimEnd('/') + "/" + fileInfo.Name,
                    ContentType = GetContentType(fileInfo.Extension)
                });
            }
            StatusMessage = $"已选择 {UploadItems.Count} 个文件";
        }
    }

    [RelayCommand]
    private void RemoveItem(UploadItem item)
    {
        UploadItems.Remove(item);
        StatusMessage = $"已选择 {UploadItems.Count} 个文件";
    }

    [RelayCommand]
    private async Task UploadAll()
    {
        if (UploadItems.Count == 0)
        {
            StatusMessage = "未选择文件";
            return;
        }

        if (string.IsNullOrEmpty(_configService.Config.AccountId) ||
            string.IsNullOrEmpty(_configService.Config.SelectedProject))
        {
            StatusMessage = "请先在设置中配置账户 ID 和项目";
            return;
        }

        var dataProjectName = _configService.Config.DataProjectName;
        if (string.IsNullOrEmpty(dataProjectName))
        {
            StatusMessage = "请先在设置中配置数据项目名称";
            return;
        }

        try
        {
            IsUploading = true;
            UploadProgress = 0;
            StatusMessage = "上传中...";

            var chunkUrls = new Dictionary<string, List<string>>();

            foreach (var item in UploadItems)
            {
                var fileBytes = await File.ReadAllBytesAsync(item.LocalPath);
                var chunks = new FileChunker { ChunkSizeBytes = _configService.Config.ChunkSizeMB * 1024 * 1024 }
                    .ChunkFile(item.RemotePath, fileBytes, item.ContentType);

                var urls = new List<string>();
                var chunkFiles = chunks.Select(c => (c.RemotePath, c.Bytes, c.ContentType)).ToList();

                _uploadService.ProgressChanged += (s, e) =>
                {
                    UploadProgress = e.Progress * 100;
                    StatusMessage = $"上传中... {UploadProgress:F0}%";
                };

                var uploadedUrls = await _uploadService.UploadFilesAsync(
                    _configService.Config.AccountId,
                    dataProjectName,
                    chunkFiles);

                urls.AddRange(uploadedUrls);
                chunkUrls[item.FileName] = urls;
            }

            // Update main.json
            StatusMessage = "更新文件索引...";
            await UpdateMainJsonAsync(chunkUrls);

            StatusMessage = $"上传完成! 已上传 {UploadItems.Count} 个文件";
            UploadItems.Clear();
        }
        catch (Exception ex)
        {
            StatusMessage = $"上传失败: {ex.Message}";
        }
        finally
        {
            IsUploading = false;
            UploadProgress = 0;
        }
    }

    private async Task UpdateMainJsonAsync(Dictionary<string, List<string>> chunkUrls)
    {
        var accountId = _configService.Config.AccountId;
        var mainProjectName = _configService.Config.SelectedProject;

        // Get the main project URL to download current main.json
        var project = await _apiClient.GetProjectAsync(accountId, mainProjectName);
        var projectUrl = _configService.GetProjectUrl(project);

        JsonElement index;
        try
        {
            index = await _apiClient.GetFileIndexAsync(projectUrl);
        }
        catch
        {
            // If main.json doesn't exist yet, create a default structure
            var defaultIndex = new
            {
                fs_root = new
                {
                    type = "folder",
                    createdAt = DateTime.UtcNow.ToString("o"),
                    modifiedAt = DateTime.UtcNow.ToString("o"),
                    children = new { }
                }
            };
            var defaultJson = JsonSerializer.Serialize(defaultIndex);
            index = JsonSerializer.Deserialize<JsonElement>(defaultJson);
        }

        // Build the updated main.json
        var indexDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(index.GetRawText())!;
        var fsRootText = indexDict["fs_root"].GetRawText();
        var fsRoot = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(fsRootText)!;

        JsonElement childrenElement;
        if (fsRoot.TryGetValue("children", out var existingChildren))
        {
            childrenElement = existingChildren;
        }
        else
        {
            childrenElement = JsonSerializer.Deserialize<JsonElement>("{}");
        }

        var childrenDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childrenElement.GetRawText())!;

        var now = DateTime.UtcNow.ToString("o");

        foreach (var (fileName, urls) in chunkUrls)
        {
            var fileEntry = new
            {
                type = "file",
                size = 0,
                chunks = urls,
                createdAt = now,
                modifiedAt = now
            };

            if (childrenDict.TryGetValue(fileName, out var existing) && existing.ValueKind == JsonValueKind.Array)
            {
                // Append new version to the array
                var versions = existing.EnumerateArray().ToList();
                versions.Add(JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fileEntry)));
                childrenDict[fileName] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(versions));
            }
            else
            {
                // Create new array with first version
                var versions = new[] { fileEntry };
                childrenDict[fileName] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(versions));
            }
        }

        fsRoot["children"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(childrenDict));
        fsRoot["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));
        indexDict["fs_root"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fsRoot));

        var updatedJson = JsonSerializer.Serialize(indexDict, new JsonSerializerOptions { WriteIndented = true });
        await _apiClient.DeployMainJsonAsync(accountId, mainProjectName, updatedJson);
    }

    private static string GetContentType(string extension)
    {
        return extension.ToLowerInvariant() switch
        {
            ".html" or ".htm" => "text/html",
            ".css" => "text/css",
            ".js" => "application/javascript",
            ".json" => "application/json",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            ".woff" => "font/woff",
            ".woff2" => "font/woff2",
            ".ttf" => "font/ttf",
            ".pdf" => "application/pdf",
            ".txt" => "text/plain",
            ".xml" => "application/xml",
            ".zip" => "application/zip",
            _ => "application/octet-stream"
        };
    }
}

public class UploadItem
{
    public string LocalPath { get; set; } = "";
    public string FileName { get; set; } = "";
    public long FileSize { get; set; }
    public string RemotePath { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public string FormattedSize => FormatFileSize(FileSize);

    private static string FormatFileSize(long bytes)
    {
        string[] suffixes = { "B", "KB", "MB", "GB" };
        int order = 0;
        double size = bytes;
        while (size >= 1024 && order < suffixes.Length - 1)
        {
            order++;
            size /= 1024;
        }
        return $"{size:0.##} {suffixes[order]}";
    }
}
