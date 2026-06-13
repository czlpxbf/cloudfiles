using System.Windows.Controls;
using System.Windows.Input;
using Cloudfiles.Core.Models;

namespace Cloudfiles.App.Views;

public partial class FileListView : System.Windows.Controls.UserControl
{
    public FileListView()
    {
        InitializeComponent();
    }

    private void FileList_DoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is ViewModels.FileListViewModel vm && vm.SelectedFile is FileEntry entry)
        {
            if (entry.IsFolder)
            {
                vm.OpenFolderCommand.Execute(entry);
            }
            else
            {
                vm.ShowVersionHistoryCommand.Execute(entry);
            }
        }
    }
}
