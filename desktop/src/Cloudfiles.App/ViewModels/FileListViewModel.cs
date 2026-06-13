using System.Collections.ObjectModel;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Cloudfiles.Core.Api;
using Cloudfiles.Core.Models;
using Cloudfiles.Core.Services;
using Microsoft.Win32;

namespace Cloudfiles.App.ViewModels;

public partial class FileListViewModel : ObservableObject
{
    private readonly CloudflareApiClient _apiClient;
    private readonly ConfigService _configService;
    private readonly DownloadService _downloadService;

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
        _apiClient = Core.Services.AppContext.Instance.ApiClient;
        _configService = Core.Services.AppContext.Instance.ConfigService;
        _downloadService = new DownloadService(_apiClient);
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await _configService.LoadAsync();
        if (!string.IsNullOrEmpty(_configService.Config.ApiToken))
        {
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
            ProjectUrl = $"https://{project.Subdomain}.pages.dev";
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
        if (string.IsNullOrEmpty(_configService.Config.AccountId) ||
            string.IsNullOrEmpty(_configService.Config.SelectedProject))
        {
            ErrorMessage = "请先在设置中配置账户 ID 和项目名称。";
            return;
        }

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            if (string.IsNullOrEmpty(ProjectUrl))
            {
                await LoadProjectUrlAsync();
            }

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

    #region 删除

    [RelayCommand]
    private async Task DeleteItem(FileEntry? entry)
    {
        if (entry == null)
        {
            if (SelectedFile == null)
            {
                ErrorMessage = "请先选择要删除的文件或文件夹";
                return;
            }
            entry = SelectedFile;
        }

        var confirm = System.Windows.MessageBox.Show(
            $"确定要删除 \"{entry.Name}\" 吗？{(entry.IsFolder ? "文件夹及其所有内容将被删除。" : "文件的所有版本将被删除。")}",
            "确认删除",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning);

        if (confirm != MessageBoxResult.Yes) return;

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            var index = await DownloadCurrentIndexAsync();
            if (index == null) return;

            var itemPath = entry.Path;
            var parts = itemPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                ErrorMessage = "不能删除根目录";
                return;
            }

            var indexDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(index.Value.GetRawText())!;
            var fsRoot = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(indexDict["fs_root"].GetRawText())!;
            var currentChildren = fsRoot;

            for (var i = 0; i < parts.Length - 1; i++)
            {
                if (!currentChildren.TryGetValue(parts[i], out var childNode))
                {
                    ErrorMessage = $"未找到路径: {itemPath}";
                    return;
                }
                var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
                if (!folderDict.TryGetValue("children", out var nextChildren))
                {
                    ErrorMessage = $"路径错误: {parts[i]} 不是文件夹";
                    return;
                }
                currentChildren = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(nextChildren.GetRawText())!;
            }

            var leafName = parts[^1];
            if (!currentChildren.ContainsKey(leafName))
            {
                ErrorMessage = $"未找到: {leafName}";
                return;
            }

            currentChildren.Remove(leafName);

            var now = DateTime.UtcNow.ToString("o");
            UpdateParentTimestampsInDict(fsRoot, parts, now);
            fsRoot["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));

            indexDict["fs_root"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fsRoot));
            var updatedJson = JsonSerializer.Serialize(indexDict, new JsonSerializerOptions { WriteIndented = true });
            await _apiClient.DeployMainJsonAsync(_configService.Config.AccountId, _configService.Config.SelectedProject, updatedJson);

            await LoadFileListAsync();
        }
        catch (Exception ex)
        {
            ErrorMessage = $"删除失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    #endregion

    #region 新建文件夹

    [RelayCommand]
    private async Task NewFolder()
    {
        var input = ShowInputDialog("新建文件夹", "请输入文件夹名称:");
        if (string.IsNullOrWhiteSpace(input)) return;

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            var index = await DownloadCurrentIndexAsync();
            if (index == null) return;

            var indexDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(index.Value.GetRawText())!;
            var fsRoot = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(indexDict["fs_root"].GetRawText())!;

            var parts = CurrentPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var currentChildren = fsRoot;

            foreach (var part in parts)
            {
                if (!currentChildren.TryGetValue(part, out var childNode))
                {
                    ErrorMessage = $"路径错误: {part}";
                    return;
                }
                var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
                if (!folderDict.TryGetValue("children", out var nextChildren))
                {
                    ErrorMessage = $"路径错误: {part} 不是文件夹";
                    return;
                }
                currentChildren = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(nextChildren.GetRawText())!;
            }

            if (currentChildren.ContainsKey(input))
            {
                ErrorMessage = $"\"{input}\" 已存在";
                return;
            }

            var now = DateTime.UtcNow.ToString("o");
            var newFolder = new
            {
                type = "folder",
                createdAt = now,
                modifiedAt = now,
                children = new { }
            };
            currentChildren[input] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(newFolder));

            var allParts = parts.Concat(new[] { input }).ToArray();
            UpdateParentTimestampsInDict(fsRoot, allParts, now);
            fsRoot["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));

            indexDict["fs_root"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fsRoot));
            var updatedJson = JsonSerializer.Serialize(indexDict, new JsonSerializerOptions { WriteIndented = true });
            await _apiClient.DeployMainJsonAsync(_configService.Config.AccountId, _configService.Config.SelectedProject, updatedJson);

            await LoadFileListAsync();
        }
        catch (Exception ex)
        {
            ErrorMessage = $"新建文件夹失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    #endregion

    #region 重命名

    [RelayCommand]
    private async Task RenameItem(FileEntry? entry)
    {
        if (entry == null) entry = SelectedFile;
        if (entry == null)
        {
            ErrorMessage = "请先选择要重命名的文件或文件夹";
            return;
        }

        var input = ShowInputDialog("重命名", "请输入新名称:", entry.Name);
        if (string.IsNullOrWhiteSpace(input) || input == entry.Name) return;

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            var index = await DownloadCurrentIndexAsync();
            if (index == null) return;

            var indexDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(index.Value.GetRawText())!;
            var fsRoot = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(indexDict["fs_root"].GetRawText())!;

            var parts = CurrentPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var currentChildren = fsRoot;

            foreach (var part in parts)
            {
                if (!currentChildren.TryGetValue(part, out var childNode))
                {
                    ErrorMessage = $"路径错误: {part}";
                    return;
                }
                var folderDict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(childNode.GetRawText())!;
                if (!folderDict.TryGetValue("children", out var nextChildren))
                {
                    ErrorMessage = $"路径错误: {part} 不是文件夹";
                    return;
                }
                currentChildren = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(nextChildren.GetRawText())!;
            }

            if (currentChildren.ContainsKey(input))
            {
                ErrorMessage = $"\"{input}\" 已存在";
                return;
            }

            if (!currentChildren.TryGetValue(entry.Name, out var nodeToMove))
            {
                ErrorMessage = $"未找到: {entry.Name}";
                return;
            }

            currentChildren.Remove(entry.Name);
            currentChildren[input] = nodeToMove;

            var now = DateTime.UtcNow.ToString("o");
            var allParts = parts.Concat(new[] { input }).ToArray();
            UpdateParentTimestampsInDict(fsRoot, allParts, now);
            fsRoot["modifiedAt"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(now));

            indexDict["fs_root"] = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(fsRoot));
            var updatedJson = JsonSerializer.Serialize(indexDict, new JsonSerializerOptions { WriteIndented = true });
            await _apiClient.DeployMainJsonAsync(_configService.Config.AccountId, _configService.Config.SelectedProject, updatedJson);

            await LoadFileListAsync();
        }
        catch (Exception ex)
        {
            ErrorMessage = $"重命名失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    #endregion

    #region 下载

    [RelayCommand]
    private async Task DownloadItem(FileEntry? entry)
    {
        if (entry == null) entry = SelectedFile;
        if (entry == null)
        {
            ErrorMessage = "请先选择要下载的文件";
            return;
        }

        if (entry.IsFolder)
        {
            ErrorMessage = "暂不支持下载文件夹，请选择文件";
            return;
        }

        if (entry.Chunks.Count == 0)
        {
            ErrorMessage = "该文件没有分块数据";
            return;
        }

        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            FileName = entry.Name,
            Title = "保存文件"
        };

        if (dialog.ShowDialog() != true) return;

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            await _downloadService.DownloadToFileAsync(entry.Chunks, dialog.FileName);

            System.Windows.MessageBox.Show($"文件已保存到: {dialog.FileName}", "下载完成", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"下载失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    public async Task DownloadVersionAsync(List<string> chunkUrls, string fileName)
    {
        var dialog = new Microsoft.Win32.SaveFileDialog
        {
            FileName = fileName,
            Title = "保存文件"
        };

        if (dialog.ShowDialog() != true) return;

        try
        {
            IsLoading = true;
            ErrorMessage = "";

            await _downloadService.DownloadToFileAsync(chunkUrls, dialog.FileName);

            System.Windows.MessageBox.Show($"文件已保存到: {dialog.FileName}", "下载完成", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"下载失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    #endregion

    #region 版本历史

    [RelayCommand]
    private void ShowVersionHistory(FileEntry? entry)
    {
        if (entry == null) entry = SelectedFile;
        if (entry == null || entry.IsFolder) return;

        var node = FindNodeAtPath(entry.Path);
        if (node == null) return;

        if (node.Value.ValueKind != JsonValueKind.Array) return;

        var versions = new List<FileVersionInfo>();
        var versionArray = node.Value.EnumerateArray().ToList();

        for (var i = 0; i < versionArray.Count; i++)
        {
            var v = versionArray[i];
            var chunks = new List<string>();
            if (v.TryGetProperty("chunks", out var chunksProp))
            {
                foreach (var chunk in chunksProp.EnumerateArray())
                {
                    chunks.Add(chunk.GetString() ?? "");
                }
            }

            versions.Add(new FileVersionInfo
            {
                Index = i + 1,
                CreatedAt = TryGetDateTime(v, "createdAt")?.ToString("yyyy-MM-dd HH:mm:ss") ?? "未知",
                Size = v.TryGetProperty("size", out var sizeProp) ? sizeProp.GetInt64() : 0,
                FormattedSize = FormatFileSize(v.TryGetProperty("size", out var sp) ? sp.GetInt64() : 0),
                Chunks = chunks,
                FileName = entry.Name
            });
        }

        var dialog = new Views.VersionHistoryDialog(versions, this);
        dialog.ShowDialog();
    }

    #endregion

    #region 辅助方法

    private async Task<JsonElement?> DownloadCurrentIndexAsync()
    {
        if (string.IsNullOrEmpty(ProjectUrl))
        {
            await LoadProjectUrlAsync();
        }

        if (string.IsNullOrEmpty(ProjectUrl))
        {
            ErrorMessage = "请先在设置中配置项目";
            return null;
        }

        try
        {
            return await _apiClient.GetFileIndexAsync(ProjectUrl);
        }
        catch
        {
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
            return JsonSerializer.Deserialize<JsonElement>(defaultJson);
        }
    }

    private static void UpdateParentTimestampsInDict(Dictionary<string, JsonElement> rootChildren, string[] parts, string now)
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

    private static string? ShowInputDialog(string title, string prompt, string defaultValue = "")
    {
        var bgColor = System.Windows.Media.ColorConverter.ConvertFromString("#1e1e2e")!;
        var textColor = System.Windows.Media.ColorConverter.ConvertFromString("#cdd6f4")!;
        var surfaceColor = System.Windows.Media.ColorConverter.ConvertFromString("#313244")!;
        var borderColor = System.Windows.Media.ColorConverter.ConvertFromString("#45475a")!;
        var accentColor = System.Windows.Media.ColorConverter.ConvertFromString("#89b4fa")!;
        var darkColor = System.Windows.Media.ColorConverter.ConvertFromString("#1e1e2e")!;

        var dialog = new Window
        {
            Title = title,
            Width = 400,
            Height = 180,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ResizeMode = ResizeMode.NoResize,
            Background = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)bgColor)
        };

        var stack = new System.Windows.Controls.StackPanel { Margin = new Thickness(24) };

        var label = new System.Windows.Controls.TextBlock
        {
            Text = prompt,
            Foreground = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)textColor),
            FontSize = 14,
            Margin = new Thickness(0, 0, 0, 12)
        };
        stack.Children.Add(label);

        var input = new System.Windows.Controls.TextBox
        {
            Text = defaultValue,
            FontSize = 14,
            Padding = new Thickness(10, 8, 10, 8),
            Background = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)surfaceColor),
            Foreground = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)textColor),
            BorderBrush = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)borderColor),
            CaretBrush = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)accentColor)
        };
        input.SelectAll();
        stack.Children.Add(input);

        var btnPanel = new System.Windows.Controls.StackPanel
        {
            Orientation = System.Windows.Controls.Orientation.Horizontal,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
            Margin = new Thickness(0, 16, 0, 0)
        };

        var okBtn = new System.Windows.Controls.Button
        {
            Content = "确定",
            Padding = new Thickness(24, 8, 24, 8),
            Background = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)accentColor),
            Foreground = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)darkColor),
            BorderThickness = new Thickness(0),
            FontWeight = FontWeights.SemiBold,
            Cursor = System.Windows.Input.Cursors.Hand
        };

        var cancelBtn = new System.Windows.Controls.Button
        {
            Content = "取消",
            Padding = new Thickness(24, 8, 24, 8),
            Margin = new Thickness(8, 0, 0, 0),
            Background = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)surfaceColor),
            Foreground = new System.Windows.Media.SolidColorBrush((System.Windows.Media.Color)textColor),
            BorderThickness = new Thickness(0),
            Cursor = System.Windows.Input.Cursors.Hand
        };

        string? result = null;
        okBtn.Click += (s, e) => { result = input.Text; dialog.DialogResult = true; dialog.Close(); };
        cancelBtn.Click += (s, e) => { dialog.DialogResult = false; dialog.Close(); };

        btnPanel.Children.Add(okBtn);
        btnPanel.Children.Add(cancelBtn);
        stack.Children.Add(btnPanel);

        dialog.Content = stack;
        input.Focus();

        var dialogResult = dialog.ShowDialog();
        return dialogResult == true ? result : null;
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

    private static string FormatFileSize(long bytes)
    {
        if (bytes == 0) return "0 B";
        string[] suffixes = { "B", "KB", "MB", "GB", "TB" };
        int order = 0;
        double size = bytes;
        while (size >= 1024 && order < suffixes.Length - 1)
        {
            order++;
            size /= 1024;
        }
        return $"{size:0.##} {suffixes[order]}";
    }

    #endregion
}

public class FileVersionInfo
{
    public int Index { get; set; }
    public string CreatedAt { get; set; } = "";
    public long Size { get; set; }
    public string FormattedSize { get; set; } = "";
    public List<string> Chunks { get; set; } = new();
    public string FileName { get; set; } = "";
}
