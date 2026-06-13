using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Net.Http;
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
    private string _searchText = "";

    [ObservableProperty]
    private string _errorMessage = "";

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
            await LoadFilesAsync();
        }
    }

    [RelayCommand]
    private async Task LoadFiles()
    {
        await LoadFilesAsync();
    }

    private async Task LoadFilesAsync()
    {
        if (string.IsNullOrEmpty(_configService.Config.AccountId) ||
            string.IsNullOrEmpty(_configService.Config.SelectedProject))
        {
            ErrorMessage = "Please configure your account ID and project in Settings.";
            return;
        }

        try
        {
            IsLoading = true;
            ErrorMessage = "";
            var files = await _apiClient.ListFilesAsync(
                _configService.Config.AccountId,
                _configService.Config.SelectedProject);
            Files = new ObservableCollection<FileEntry>(files);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Failed to load files: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private async Task DownloadFile()
    {
        if (SelectedFile == null) return;

        try
        {
            var downloadService = new DownloadService(new HttpClient());
            var projectUrl = _configService.GetProjectUrl(_configService.Config.SelectedProject);
            var fileUrl = $"{projectUrl}{SelectedFile.Path}";

            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                FileName = Path.GetFileName(SelectedFile.Path),
                Title = "Save File"
            };

            if (dialog.ShowDialog() == true)
            {
                await downloadService.DownloadFileToDiskAsync(fileUrl, dialog.FileName);
            }
        }
        catch (Exception ex)
        {
            ErrorMessage = $"Download failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private void Search()
    {
        if (string.IsNullOrWhiteSpace(SearchText))
        {
            _ = LoadFilesAsync();
            return;
        }

        var filtered = Files.Where(f =>
            f.Path.Contains(SearchText, StringComparison.OrdinalIgnoreCase)).ToList();
        Files = new ObservableCollection<FileEntry>(filtered);
    }
}
