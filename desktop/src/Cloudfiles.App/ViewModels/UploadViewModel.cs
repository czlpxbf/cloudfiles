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
    private string _statusMessage = "Select files to upload";

    [ObservableProperty]
    private string _remotePathPrefix = "/";

    public UploadViewModel()
    {
        var httpClient = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
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
            Title = "Select files to upload"
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
            StatusMessage = $"{UploadItems.Count} file(s) selected";
        }
    }

    [RelayCommand]
    private void RemoveItem(UploadItem item)
    {
        UploadItems.Remove(item);
        StatusMessage = $"{UploadItems.Count} file(s) selected";
    }

    [RelayCommand]
    private async Task UploadAll()
    {
        if (UploadItems.Count == 0)
        {
            StatusMessage = "请先选择要上传的文件";
            return;
        }

        if (string.IsNullOrEmpty(_configService.Config.AccountId) ||
            string.IsNullOrEmpty(_configService.Config.SelectedProject) ||
            string.IsNullOrEmpty(_configService.Config.DataProjectName))
        {
            StatusMessage = "请先在设置中配置账户 ID、主项目和数据项目";
            return;
        }

        try
        {
            IsUploading = true;
            UploadProgress = 0;
            StatusMessage = "正在分块...";

            // Step 1: Chunk all files and collect chunks
            var chunker = new FileChunker();
            var fileChunkInfos = new List<(UploadItem item, byte[] fileBytes, List<FileChunk> chunks, List<string> chunkUrls)>();

            long totalBytes = 0;
            foreach (var item in UploadItems)
            {
                var fileBytes = await File.ReadAllBytesAsync(item.LocalPath);
                var chunks = chunker.ChunkFile(fileBytes, item.ContentType);
                fileChunkInfos.Add((item, fileBytes, chunks, new List<string>()));
                totalBytes += fileBytes.Length;
            }

            // Step 2: Upload all chunks to data project in one batch
            StatusMessage = "正在上传分块到数据项目...";
            var allChunks = new List<(string remotePath, byte[] bytes, string contentType)>();
            foreach (var (_, _, chunks, _) in fileChunkInfos)
            {
                foreach (var chunk in chunks)
                {
                    allChunks.Add((chunk.RemotePath, chunk.Bytes, chunk.ContentType));
                }
            }

            var dataProject = await _apiClient.GetProjectAsync(_configService.Config.AccountId, _configService.Config.DataProjectName);
            var dataProjectSubdomain = dataProject.Subdomain;

            var chunkUrls = await _apiClient.DeployFilesAsync(
                _configService.Config.AccountId,
                _configService.Config.DataProjectName,
                allChunks);

            // Build chunk URL mapping: https://{subdomain}.pages.dev/chunk-{index}
            var chunkUrlIndex = 0;
            foreach (var info in fileChunkInfos)
            {
                for (var i = 0; i < info.chunks.Count; i++)
                {
                    info.chunkUrls.Add($"https://{dataProjectSubdomain}.pages.dev/{info.chunks[i].RemotePath}");
                }
            }

            UploadProgress = 50;
            StatusMessage = "正在更新文件索引...";

            // Step 3: Download current main.json from main project
            var mainProject = await _apiClient.GetProjectAsync(_configService.Config.AccountId, _configService.Config.SelectedProject);
            var mainProjectUrl = $"https://{mainProject.Subdomain}.pages.dev";

            JsonElement index;
            try
            {
                index = await _apiClient.GetFileIndexAsync(mainProjectUrl);
            }
            catch
            {
                // Create default index if not exists
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
                index = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(defaultIndex));
            }

            // Step 4: Add file version nodes to main.json
            var indexDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(index.GetRawText())!;
            var fsRoot = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(indexDict["fs_root"].GetRawText())!;
            var now = DateTime.UtcNow.ToString("o");

            foreach (var info in fileChunkInfos)
            {
                var remotePath = info.item.RemotePath.Trim('/');
                var parts = remotePath.Split('/');
                var leafName = parts[^1];
                var parentParts = parts[..^1];

                // Navigate to parent directory
                var currentChildren = fsRoot;
                foreach (var part in parentParts)
                {
                    if (!currentChildren.TryGetValue(part, out var childNode))
                    {
                        StatusMessage = $"上传失败: 父目录 /{string.Join("/", parentParts)} 不存在";
                        return;
                    }
                    var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
                    if (!folderDict.TryGetValue("children", out var nextChildren))
                    {
                        StatusMessage = $"上传失败: /{part} 不是文件夹";
                        return;
                    }
                    currentChildren = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(nextChildren.GetRawText())!;
                }

                // Create file version node
                var fileVersion = new
                {
                    type = "file",
                    size = info.fileBytes.Length,
                    chunks = info.chunkUrls,
                    createdAt = now,
                    modifiedAt = now
                };
                var fileVersionJson = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fileVersion));

                if (!currentChildren.ContainsKey(leafName))
                {
                    // New file: create array with one version
                    currentChildren[leafName] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(new[] { fileVersion }));
                }
                else
                {
                    var existing = currentChildren[leafName];
                    if (existing.ValueKind == JsonValueKind.Array)
                    {
                        // Existing file: append new version
                        var versions = existing.EnumerateArray().ToList();
                        versions.Add(fileVersionJson);
                        currentChildren[leafName] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(versions));
                    }
                    else
                    {
                        StatusMessage = $"上传失败: {leafName} 已存在且为文件夹";
                        return;
                    }
                }

                // Update parent timestamps
                UpdateParentTimestamps(fsRoot, parts, now);
            }

            // Step 5: Redeploy main.json
            fsRoot["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));
            indexDict["fs_root"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fsRoot));
            var updatedJson = JsonSerializer.Serialize(indexDict, new JsonSerializerOptions { WriteIndented = true });

            StatusMessage = "正在部署文件索引...";
            await _apiClient.DeployMainJsonAsync(_configService.Config.AccountId, _configService.Config.SelectedProject, updatedJson);

            UploadProgress = 100;
            StatusMessage = $"上传完成! {fileChunkInfos.Count} 个文件已部署";
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

    private static void UpdateParentTimestamps(Dictionary<string, JsonElement> rootChildren, string[] parts, string now)
    {
        var currentChildren = rootChildren;
        for (var i = 0; i < parts.Length - 1; i++)
        {
            var part = parts[i];
            if (!currentChildren.TryGetValue(part, out var childNode)) break;

            var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
            folderDict["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));
            currentChildren[part] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(folderDict));

            if (folderDict.TryGetValue("children", out var nextChildren))
            {
                currentChildren = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(nextChildren.GetRawText())!;
            }
            else
            {
                break;
            }
        }
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
