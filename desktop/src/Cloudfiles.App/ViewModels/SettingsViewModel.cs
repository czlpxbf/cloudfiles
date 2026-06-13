using System.Collections.ObjectModel;
using System.Net.Http;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Cloudfiles.Core.Api;
using Cloudfiles.Core.Models;
using Cloudfiles.Core.Services;

namespace Cloudfiles.App.ViewModels;

public partial class SettingsViewModel : ObservableObject
{
    private readonly CloudflareApiClient _apiClient;
    private readonly ConfigService _configService;

    [ObservableProperty]
    private string _apiToken = "";

    [ObservableProperty]
    private string _accountId = "";

    [ObservableProperty]
    private string _selectedProject = "";

    [ObservableProperty]
    private ObservableCollection<PagesProject> _projects = new();

    [ObservableProperty]
    private bool _isVerifying;

    [ObservableProperty]
    private bool _isTokenValid;

    [ObservableProperty]
    private string _verificationMessage = "";

    [ObservableProperty]
    private int _chunkSizeMB = 25;

    public SettingsViewModel()
    {
        var httpClient = new HttpClient();
        _apiClient = new CloudflareApiClient(httpClient);
        _configService = new ConfigService();
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await _configService.LoadAsync();
        ApiToken = _configService.Config.ApiToken;
        AccountId = _configService.Config.AccountId;
        SelectedProject = _configService.Config.SelectedProject;
        ChunkSizeMB = _configService.Config.ChunkSizeMB;

        if (!string.IsNullOrEmpty(ApiToken))
        {
            _apiClient.SetApiToken(ApiToken);
        }
    }

    [RelayCommand]
    private async Task VerifyToken()
    {
        if (string.IsNullOrWhiteSpace(ApiToken))
        {
            VerificationMessage = "Please enter an API token";
            return;
        }

        try
        {
            IsVerifying = true;
            VerificationMessage = "Verifying...";
            _apiClient.SetApiToken(ApiToken);

            var tokenInfo = await _apiClient.VerifyTokenAsync();
            IsTokenValid = tokenInfo.Status == "active";
            VerificationMessage = IsTokenValid
                ? $"Token valid (ID: {tokenInfo.Id})"
                : $"Token status: {tokenInfo.Status}";
        }
        catch (Exception ex)
        {
            IsTokenValid = false;
            VerificationMessage = $"Verification failed: {ex.Message}";
        }
        finally
        {
            IsVerifying = false;
        }
    }

    [RelayCommand]
    private async Task LoadProjects()
    {
        if (string.IsNullOrWhiteSpace(AccountId) || string.IsNullOrWhiteSpace(ApiToken))
        {
            return;
        }

        try
        {
            _apiClient.SetApiToken(ApiToken);
            var projects = await _apiClient.ListProjectsAsync(AccountId);
            Projects = new ObservableCollection<PagesProject>(projects);
        }
        catch (Exception ex)
        {
            VerificationMessage = $"Failed to load projects: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task Save()
    {
        _configService.Config.ApiToken = ApiToken;
        _configService.Config.AccountId = AccountId;
        _configService.Config.SelectedProject = SelectedProject;
        _configService.Config.ChunkSizeMB = ChunkSizeMB;
        await _configService.SaveAsync();
        VerificationMessage = "Settings saved successfully";
    }
}
