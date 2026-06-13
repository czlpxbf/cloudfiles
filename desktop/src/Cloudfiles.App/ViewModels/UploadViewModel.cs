using System.IO;
using System.Collections.ObjectModel;
using System.Net.Http;
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
        StatusMessage = $"{UploadItems.Count} file(s) selected";
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

        try
        {
            IsUploading = true;
            UploadProgress = 0;
            StatusMessage = "上传中...";

            var files = new List<(string remotePath, byte[] bytes, string contentType)>();

            foreach (var item in UploadItems)
            {
                var fileBytes = await File.ReadAllBytesAsync(item.LocalPath);
                files.Add((item.RemotePath, fileBytes, item.ContentType));
            }

            _uploadService.ProgressChanged += (s, e) =>
            {
                UploadProgress = e.Progress * 100;
                StatusMessage = $"上传中... {UploadProgress:F0}%";
            };

            var urls = await _uploadService.UploadFilesAsync(
                _configService.Config.AccountId,
                _configService.Config.SelectedProject,
                files);

            StatusMessage = $"上传完成! 已部署 {urls.Count} 个文件";
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
