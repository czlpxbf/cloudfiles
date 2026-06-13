using System.Collections.ObjectModel;
using System.IO;
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
        var dialog = new Microsoft.Win32.OpenFileDialog
        {
            Multiselect = true,
            Title = "选择要上传的文件"
        };

        if (dialog.ShowDialog() == true)
        {
            foreach (var fileName in dialog.FileNames)
            {
                var fileInfo = new FileInfo(fileName);
                var remotePath = BuildRemotePath(fileInfo.Name);
                UploadItems.Add(new UploadItem
                {
                    LocalPath = fileName,
                    FileName = fileInfo.Name,
                    FileSize = fileInfo.Length,
                    RemotePath = remotePath,
                    ContentType = GetContentType(fileInfo.Extension),
                    IsDirectory = false
                });
            }
            StatusMessage = $"已选择 {UploadItems.Count} 个项目";
        }
    }

    [RelayCommand]
    private void BrowseDirectory()
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog
        {
            Description = "选择要上传的目录",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false
        };

        if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            var selectedPath = dialog.SelectedPath;
            var dirInfo = new DirectoryInfo(selectedPath);
            var dirName = dirInfo.Name;

            // 递归添加目录中的所有文件，保留相对路径
            AddDirectoryFiles(selectedPath, dirName);

            StatusMessage = $"已选择 {UploadItems.Count} 个项目";
        }
    }

    private void AddDirectoryFiles(string directoryPath, string relativePrefix)
    {
        var dirInfo = new DirectoryInfo(directoryPath);

        foreach (var file in dirInfo.GetFiles())
        {
            var relativePath = relativePrefix + "/" + file.Name;
            var remotePath = BuildRemotePath(relativePath);
            UploadItems.Add(new UploadItem
            {
                LocalPath = file.FullName,
                FileName = file.Name,
                FileSize = file.Length,
                RemotePath = remotePath,
                ContentType = GetContentType(file.Extension),
                IsDirectory = false,
                RelativePathInDir = relativePath
            });
        }

        foreach (var dir in dirInfo.GetDirectories())
        {
            var subRelativePrefix = relativePrefix + "/" + dir.Name;
            AddDirectoryFiles(dir.FullName, subRelativePrefix);
        }
    }

    private string BuildRemotePath(string fileNameOrRelativePath)
    {
        var prefix = RemotePathPrefix?.Trim('/') ?? "";
        if (string.IsNullOrEmpty(prefix))
        {
            return "/" + fileNameOrRelativePath;
        }
        return "/" + prefix + "/" + fileNameOrRelativePath;
    }

    [RelayCommand]
    private void RemoveItem(UploadItem item)
    {
        UploadItems.Remove(item);
        StatusMessage = $"已选择 {UploadItems.Count} 个项目";
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
            StatusMessage = "准备上传...";

            // 获取数据项目信息以得到 subdomain
            var dataProject = await _apiClient.GetProjectAsync(_configService.Config.AccountId, dataProjectName);
            var dataProjectSubdomain = dataProject.Subdomain;

            // 更新 chunker 的分块大小
            var chunker = new FileChunker { ChunkSizeBytes = _configService.Config.ChunkSizeMB * 1024 * 1024 };
            var uploadService = new UploadService(_apiClient, chunker);

            uploadService.ProgressChanged += (s, e) =>
            {
                UploadProgress = e.Progress * 100;
                StatusMessage = $"上传分块中... {UploadProgress:F0}%";
            };

            // 准备文件列表
            var files = UploadItems.Select(item => (item.LocalPath, item.RemotePath)).ToList();

            StatusMessage = "上传分块到数据项目...";

            // 上传所有文件的分块到数据项目
            var allChunkUrls = await uploadService.UploadFilesAsync(
                _configService.Config.AccountId,
                dataProjectName,
                dataProjectSubdomain,
                files);

            // 获取每个文件的大小
            var fileSizes = new List<long>();
            foreach (var item in UploadItems)
            {
                var fileInfo = new FileInfo(item.LocalPath);
                fileSizes.Add(fileInfo.Length);
            }

            // 更新 main.json
            StatusMessage = "更新文件索引...";
            await UpdateMainJsonAsync(allChunkUrls, fileSizes);

            StatusMessage = $"上传完成! 已上传 {UploadItems.Count} 个文件";
            UploadProgress = 100;
            UploadItems.Clear();
        }
        catch (Exception ex)
        {
            StatusMessage = $"上传失败: {ex.Message}";
        }
        finally
        {
            IsUploading = false;
        }
    }

    private async Task UpdateMainJsonAsync(List<List<string>> allChunkUrls, List<long> fileSizes)
    {
        var accountId = _configService.Config.AccountId;
        var mainProjectName = _configService.Config.SelectedProject;

        // 获取主项目 URL 以下载当前 main.json
        var project = await _apiClient.GetProjectAsync(accountId, mainProjectName);
        var projectUrl = _configService.GetProjectUrl(project);

        JsonElement index;
        try
        {
            index = await _apiClient.GetFileIndexAsync(projectUrl);
        }
        catch
        {
            // 如果 main.json 不存在，创建默认结构
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

        // 解析 main.json 为可操作的字典结构
        var indexDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(index.GetRawText())!;
        var fsRoot = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(indexDict["fs_root"].GetRawText())!;

        // 获取 children
        Dictionary<string, JsonElement> childrenDict;
        if (fsRoot.TryGetValue("children", out var existingChildren))
        {
            childrenDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(existingChildren.GetRawText())!;
        }
        else
        {
            childrenDict = new Dictionary<string, JsonElement>();
        }

        var now = DateTime.UtcNow.ToString("o");

        // 逐个处理上传的文件
        for (var i = 0; i < UploadItems.Count; i++)
        {
            var item = UploadItems[i];
            var chunkUrls = allChunkUrls[i];
            var fileSize = fileSizes[i];

            // 构建 file version node
            var fileVersionNode = new
            {
                type = "file",
                size = fileSize,
                chunks = chunkUrls,
                createdAt = now,
                modifiedAt = now
            };
            var fileVersionJson = JsonSerializer.Serialize(fileVersionNode);
            var fileVersionElement = JsonSerializer.Deserialize<JsonElement>(fileVersionJson);

            // 解析远程路径: /documents/folder/file.txt -> ["documents", "folder", "file.txt"]
            var parts = item.RemotePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                throw new InvalidOperationException($"无效的远程路径: {item.RemotePath}");
            }

            var leafName = parts[parts.Length - 1];
            var parentParts = parts[..^1];

            // 从 fs_root.children 开始导航到父目录
            var parentNode = childrenDict;
            foreach (var part in parentParts)
            {
                if (!parentNode.TryGetValue(part, out var childNode))
                {
                    throw new InvalidOperationException($"远程父目录不存在: /{string.Join("/", parentParts)} (缺少 {part})");
                }

                // 检查是否为文件夹节点（不是数组=文件版本列表）
                if (childNode.ValueKind == JsonValueKind.Array)
                {
                    throw new InvalidOperationException($"路径冲突: \"{part}\" 是文件，不是文件夹");
                }

                // 这是一个文件夹对象，获取其 children
                var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
                if (!folderDict.TryGetValue("children", out var folderChildren))
                {
                    throw new InvalidOperationException($"文件夹 \"{part}\" 缺少 children 属性");
                }
                parentNode = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(folderChildren.GetRawText())!;
            }

            // 在父目录中插入文件版本
            if (parentNode.TryGetValue(leafName, out var existingNode))
            {
                if (existingNode.ValueKind == JsonValueKind.Array)
                {
                    // 已存在的文件（版本数组），追加新版本
                    var versions = existingNode.EnumerateArray().ToList();
                    versions.Add(fileVersionElement);
                    parentNode[leafName] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(versions));
                }
                else
                {
                    // 已存在同名文件夹，报错
                    throw new InvalidOperationException($"上传失败：一个名为 \"{leafName}\" 的文件夹已存在于目标位置");
                }
            }
            else
            {
                // 新文件，创建版本数组
                var versions = new[] { fileVersionElement };
                parentNode[leafName] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(versions));
            }

            // 更新父文件夹时间戳
            UpdateParentTimestamps(childrenDict, parts, now);
        }

        // 重建 fsRoot
        fsRoot["children"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(childrenDict));
        fsRoot["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));
        indexDict["fs_root"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fsRoot));

        var updatedJson = JsonSerializer.Serialize(indexDict, new JsonSerializerOptions { WriteIndented = true });
        await _apiClient.DeployMainJsonAsync(accountId, mainProjectName, updatedJson);
    }

    /// <summary>
    /// 向上更新父文件夹的修改时间（复刻 Node.js 的 updateParentTimestamps）
    /// </summary>
    private static void UpdateParentTimestamps(Dictionary<string, JsonElement> rootChildren, string[] parts, string now)
    {
        // parts 指向被修改的节点路径，需要更新从根到该节点父级的所有文件夹 modifiedAt
        // 根节点 (fs_root) 的 modifiedAt 在调用处已更新

        var currentNode = rootChildren;
        for (var i = 0; i < parts.Length - 1; i++)
        {
            var part = parts[i];
            if (!currentNode.TryGetValue(part, out var childNode))
            {
                break;
            }

            // 这是一个文件夹节点
            var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
            folderDict["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));
            currentNode[part] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(folderDict));

            // 继续深入
            if (folderDict.TryGetValue("children", out var nextChildren))
            {
                currentNode = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(nextChildren.GetRawText())!;
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
    public bool IsDirectory { get; set; }
    public string? RelativePathInDir { get; set; }
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
