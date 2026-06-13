using System.Windows;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace Cloudfiles.App.ViewModels;

public partial class MainViewModel : ObservableObject
{
    [ObservableProperty]
    private ObservableObject _currentView = new FileListViewModel();

    [ObservableProperty]
    private string _statusText = "就绪";

    [RelayCommand]
    private void NavigateToFiles()
    {
        CurrentView = new FileListViewModel();
        StatusText = "部署列表";
    }

    [RelayCommand]
    private void NavigateToUpload()
    {
        CurrentView = new UploadViewModel();
        StatusText = "上传文件";
    }

    [RelayCommand]
    private void NavigateToSettings()
    {
        CurrentView = new SettingsViewModel();
        StatusText = "设置";
    }

    [RelayCommand]
    private void Minimize()
    {
        Application.Current.MainWindow.WindowState = WindowState.Minimized;
    }

    [RelayCommand]
    private void Maximize()
    {
        var window = Application.Current.MainWindow;
        window.WindowState = window.WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;
    }

    [RelayCommand]
    private void Close()
    {
        Application.Current.MainWindow.Close();
    }
}
