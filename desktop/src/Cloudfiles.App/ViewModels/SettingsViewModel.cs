using System.Collections.ObjectModel;
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

    partial void OnApiTokenChanged(string value)
    {
        _apiClient.SetApiToken(value);
    }

    [ObservableProperty]
    private string _accountId = "";

    [ObservableProperty]
    private PagesProject? _selectedProject;

    [ObservableProperty]
    private PagesProject? _selectedDataProject;

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
        _apiClient = Core.Services.AppContext.Instance.ApiClient;
        _configService = Core.Services.AppContext.Instance.ConfigService;
        _ = InitializeAsync();
    }

    private async Task InitializeAsync()
    {
        await _configService.LoadAsync();
        ApiToken = _configService.Config.ApiToken;
        AccountId = _configService.Config.AccountId;
        ChunkSizeMB = _configService.Config.ChunkSizeMB;

        if (!string.IsNullOrEmpty(AccountId) && !string.IsNullOrEmpty(ApiToken))
        {
            try
            {
                var projects = await _apiClient.ListProjectsAsync(AccountId);
                Projects = new ObservableCollection<PagesProject>(projects);

                if (!string.IsNullOrEmpty(_configService.Config.SelectedProject))
                {
                    SelectedProject = Projects.FirstOrDefault(p => p.Name == _configService.Config.SelectedProject);
                }
                if (!string.IsNullOrEmpty(_configService.Config.DataProjectName))
                {
                    SelectedDataProject = Projects.FirstOrDefault(p => p.Name == _configService.Config.DataProjectName);
                }
            }
            catch { }
        }
    }

    [RelayCommand]
    private async Task VerifyToken()
    {
        if (string.IsNullOrWhiteSpace(ApiToken))
        {
            VerificationMessage = "请输入 API Token";
            return;
        }

        try
        {
            IsVerifying = true;
            VerificationMessage = "验证中...";
            _apiClient.SetApiToken(ApiToken);

            var tokenInfo = await _apiClient.VerifyTokenAsync();
            IsTokenValid = tokenInfo.Status == "active";
            VerificationMessage = IsTokenValid
                ? $"Token 有效 (ID: {tokenInfo.Id})"
                : $"Token 状态: {tokenInfo.Status}";
        }
        catch (Exception ex)
        {
            IsTokenValid = false;
            VerificationMessage = $"验证失败: {ex.Message}";
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
            VerificationMessage = $"加载项目失败: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task Save()
    {
        _configService.Config.ApiToken = ApiToken;
        _configService.Config.AccountId = AccountId;
        _configService.Config.SelectedProject = SelectedProject?.Name ?? "";
        _configService.Config.DataProjectName = SelectedDataProject?.Name ?? "";
        _configService.Config.ChunkSizeMB = ChunkSizeMB;
        await _configService.SaveAsync();
        VerificationMessage = "设置已保存";
    }
}
