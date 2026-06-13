using System.Collections.ObjectModel;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Cloudfiles.Core.Api;
using Cloudfiles.Core.Models;
using Cloudfiles.Core.Services;

namespace Cloudfiles.App.ViewModels;

public partial class FileListViewModel : ObservableObject
{
    private readonly CloudflareApiClient _apiClient;
    private readonly ConfigService _configService;

    [ObservableProperty]
    private ObservableCollection<FileEntry> _files = new();

    [ObservableProperty]
    private FileEntry? _selectedFile;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _errorMessage = "";

    [ObservableProperty]
    private string _projectUrl = "";

    [ObservableProperty]
    private string _currentPath = "/";

    [ObservableProperty]
    private string _breadcrumb = "fs_root";

    private JsonElement _fileIndexRoot;

    public FileListViewModel()
    {
        var httpClient = new HttpClient();
        _apiClient = new CloudflareApiClient(httpClient);
        _configService = new ConfigService();
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await _configService.LoadAsync();
        if (!string.IsNullOrEmpty(_configService.Config.ApiToken))
        {
            _apiClient.SetApiToken(_configService.Config.ApiToken);
            await LoadProjectUrlAsync();
            await LoadFileListAsync();
        }
    }

    private async Task LoadProjectUrlAsync()
    {
        if (string.IsNullOrEmpty(_configService.Config.AccountId) ||
            string.IsNullOrEmpty(_configService.Config.SelectedProject))
        {
            return;
        }

        try
        {
            var project = await _apiClient.GetProjectAsync(
                _configService.Config.AccountId,
                _configService.Config.SelectedProject);
            ProjectUrl = _configService.GetProjectUrl(project);
        }
        catch { }
    }

    [RelayCommand]
    private async Task Refresh()
    {
        await LoadFileListAsync();
    }

    private async Task LoadFileListAsync()
    {
        if (string.IsNullOrEmpty(ProjectUrl))
        {
            ErrorMessage = "请先在设置中配置账户 ID 和项目名称。";
            return;
        }

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            var index = await _apiClient.GetFileIndexAsync(ProjectUrl);

            if (index.TryGetProperty("fs_root", out var root))
            {
                _fileIndexRoot = root;
                CurrentPath = "/";
                Breadcrumb = "fs_root";
                ParseAndDisplayChildren(root);
            }
            else
            {
                Files.Clear();
                ErrorMessage = "main.json 格式不正确，缺少 fs_root 节点。";
            }
        }
        catch (HttpRequestException ex)
        {
            ErrorMessage = $"加载文件列表失败: {ex.Message}";
            Files.Clear();
        }
        catch (Exception ex)
        {
            ErrorMessage = $"解析文件列表失败: {ex.Message}";
            Files.Clear();
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ParseAndDisplayChildren(JsonElement node)
    {
        var entries = new ObservableCollection<FileEntry>();

        if (!node.TryGetProperty("children", out var children))
        {
            Files = entries;
            return;
        }

        foreach (var property in children.EnumerateObject())
        {
            var name = property.Name;
            var value = property.Value;

            if (value.ValueKind == JsonValueKind.Object &&
                value.TryGetProperty("type", out var typeProp) &&
                typeProp.GetString() == "folder")
            {
                entries.Add(new FileEntry
                {
                    Name = name,
                    Path = CurrentPath == "/" ? $"/{name}" : $"{CurrentPath}/{name}",
                    IsFolder = true,
                    LastModified = TryGetDateTime(value, "modifiedAt") ?? TryGetDateTime(value, "createdAt")
                });
            }
            else if (value.ValueKind == JsonValueKind.Array)
            {
                var versions = value.EnumerateArray().ToList();
                var latestVersion = versions.LastOrDefault();
                if (latestVersion.ValueKind != JsonValueKind.Undefined &&
                    latestVersion.TryGetProperty("type", out var fileType) &&
                    fileType.GetString() == "file")
                {
                    var chunks = new List<string>();
                    if (latestVersion.TryGetProperty("chunks", out var chunksProp))
                    {
                        foreach (var chunk in chunksProp.EnumerateArray())
                        {
                            chunks.Add(chunk.GetString() ?? "");
                        }
                    }

                    entries.Add(new FileEntry
                    {
                        Name = name,
                        Path = CurrentPath == "/" ? $"/{name}" : $"{CurrentPath}/{name}",
                        IsFolder = false,
                        Size = latestVersion.TryGetProperty("size", out var sizeProp) ? sizeProp.GetInt64() : 0,
                        LastModified = TryGetDateTime(latestVersion, "modifiedAt") ?? TryGetDateTime(latestVersion, "createdAt"),
                        ChunkCount = chunks.Count,
                        Chunks = chunks,
                        VersionCount = versions.Count
                    });
                }
            }
        }

        var sorted = entries.OrderByDescending(f => f.IsFolder).ThenBy(f => f.Name, StringComparer.OrdinalIgnoreCase).ToList();
        Files = new ObservableCollection<FileEntry>(sorted);
    }

    [RelayCommand]
    private void OpenFolder(FileEntry? entry)
    {
        if (entry == null || !entry.IsFolder) return;

        NavigateIntoFolder(entry.Name);
    }

    private void NavigateIntoFolder(string folderName)
    {
        var node = FindNodeAtPath(CurrentPath);
        if (node == null) return;

        if (!node.Value.TryGetProperty("children", out var children)) return;
        if (!children.TryGetProperty(folderName, out var folderNode)) return;

        CurrentPath = CurrentPath == "/" ? $"/{folderName}" : $"{CurrentPath}/{folderName}";
        Breadcrumb = CurrentPath.TrimStart('/').Replace("/", " > ");
        ParseAndDisplayChildren(folderNode);
    }

    [RelayCommand]
    private void NavigateUp()
    {
        if (CurrentPath == "/") return;

        var parts = CurrentPath.Trim('/').Split('/');
        if (parts.Length <= 1)
        {
            CurrentPath = "/";
            Breadcrumb = "fs_root";
            ParseAndDisplayChildren(_fileIndexRoot);
        }
        else
        {
            var newPath = "/" + string.Join("/", parts[..^1]);
            CurrentPath = newPath;
            Breadcrumb = CurrentPath.TrimStart('/').Replace("/", " > ");

            var node = FindNodeAtPath(CurrentPath);
            if (node != null)
            {
                ParseAndDisplayChildren(node.Value);
            }
        }
    }

    private JsonElement? FindNodeAtPath(string path)
    {
        if (path == "/") return _fileIndexRoot;

        var parts = path.Trim('/').Split('/');
        JsonElement current = _fileIndexRoot;

        foreach (var part in parts)
        {
            if (!current.TryGetProperty("children", out var children)) return null;
            if (!children.TryGetProperty(part, out var child)) return null;
            current = child;
        }

        return current;
    }

    [RelayCommand]
    private void OpenProjectUrl()
    {
        if (string.IsNullOrEmpty(ProjectUrl)) return;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = ProjectUrl,
                UseShellExecute = true
            });
        }
        catch { }
    }

    private static DateTime? TryGetDateTime(JsonElement element, string propertyName)
    {
        if (element.TryGetProperty(propertyName, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            var str = prop.GetString();
            if (DateTime.TryParse(str, out var dt))
            {
                return dt;
            }
        }
        return null;
    }
}
