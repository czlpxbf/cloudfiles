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
    private string _statusText = "Ready";

    [RelayCommand]
    private void NavigateToFiles()
    {
        CurrentView = new FileListViewModel();
        StatusText = "File browser";
    }

    [RelayCommand]
    private void NavigateToUpload()
    {
        CurrentView = new UploadViewModel();
        StatusText = "Upload files";
    }

    [RelayCommand]
    private void NavigateToSettings()
    {
        CurrentView = new SettingsViewModel();
        StatusText = "Settings";
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
