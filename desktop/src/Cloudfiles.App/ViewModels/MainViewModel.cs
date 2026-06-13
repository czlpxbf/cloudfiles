using System.Windows;
using System.Windows.Input;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace Cloudfiles.App.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private FileListViewModel? _fileListViewModel;
    private UploadViewModel? _uploadViewModel;
    private SettingsViewModel? _settingsViewModel;

    [ObservableProperty]
    private ObservableObject _currentView;

    [ObservableProperty]
    private string _statusText = "Ready";

    public MainViewModel()
    {
        _fileListViewModel = new FileListViewModel();
        _currentView = _fileListViewModel;
    }

    [RelayCommand]
    private void NavigateToFiles()
    {
        _fileListViewModel ??= new FileListViewModel();
        CurrentView = _fileListViewModel;
        StatusText = "File browser";
    }

    [RelayCommand]
    private void NavigateToUpload()
    {
        _uploadViewModel ??= new UploadViewModel();
        CurrentView = _uploadViewModel;
        StatusText = "Upload files";
    }

    [RelayCommand]
    private void NavigateToSettings()
    {
        _settingsViewModel ??= new SettingsViewModel();
        CurrentView = _settingsViewModel;
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
