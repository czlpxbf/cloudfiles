using System.Windows;
using Cloudfiles.App.ViewModels;

namespace Cloudfiles.App.Views;

public partial class VersionHistoryDialog : Window
{
    private VersionHistoryViewModel? ViewModel => DataContext as VersionHistoryViewModel;

    public VersionHistoryDialog(List<FileVersionInfo> versions, FileListViewModel viewModel)
    {
        InitializeComponent();
        DataContext = new VersionHistoryViewModel(versions, viewModel, this);
    }

    private void DownloadVersion_Click(object sender, RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button btn && btn.DataContext is FileVersionInfo version)
        {
            ViewModel?.DownloadVersion(version);
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }
}

public class VersionHistoryViewModel
{
    public List<FileVersionInfo> Versions { get; }
    private readonly FileListViewModel _fileListViewModel;
    private readonly Window _dialog;

    public VersionHistoryViewModel(List<FileVersionInfo> versions, FileListViewModel viewModel, Window dialog)
    {
        Versions = versions;
        _fileListViewModel = viewModel;
        _dialog = dialog;
    }

    public async Task DownloadVersion(FileVersionInfo version)
    {
        _dialog.Close();
        await _fileListViewModel.DownloadVersionAsync(version.Chunks, version.FileName);
    }

    public void Close()
    {
        _dialog.Close();
    }
}
