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
    private ObservableCollection<DeploymentInfo> _deployments = new();

    [ObservableProperty]
    private DeploymentInfo? _selectedDeployment;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _searchText = "";

    [ObservableProperty]
    private string _errorMessage = "";

    [ObservableProperty]
    private string _projectUrl = "";

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
            ProjectUrl = _configService.GetProjectUrl(_configService.Config.SelectedProject);
            await LoadDeploymentsAsync();
        }
    }

    [RelayCommand]
    private async Task Refresh()
    {
        await LoadDeploymentsAsync();
    }

    private async Task LoadDeploymentsAsync()
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
            var deployments = await _apiClient.ListDeploymentsAsync(
                _configService.Config.AccountId,
                _configService.Config.SelectedProject);
            Deployments = new ObservableCollection<DeploymentInfo>(deployments);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"加载部署列表失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void Search()
    {
        if (string.IsNullOrWhiteSpace(SearchText))
        {
            _ = LoadDeploymentsAsync();
            return;
        }

        var filtered = Deployments.Where(d =>
            d.Url.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
            d.Environment.Contains(SearchText, StringComparison.OrdinalIgnoreCase) ||
            (d.CreatedOn ?? "").Contains(SearchText, StringComparison.OrdinalIgnoreCase)).ToList();
        Deployments = new ObservableCollection<DeploymentInfo>(filtered);
    }

    [RelayCommand]
    private void OpenUrl()
    {
        if (SelectedDeployment == null) return;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = SelectedDeployment.Url,
                UseShellExecute = true
            });
        }
        catch { }
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
}
