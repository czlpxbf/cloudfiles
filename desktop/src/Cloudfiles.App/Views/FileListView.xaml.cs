using System.Windows.Controls;
using System.Windows.Input;

namespace Cloudfiles.App.Views;

public partial class FileListView : UserControl
{
    public FileListView()
    {
        InitializeComponent();
    }

    private void ProjectUrl_Click(object sender, MouseButtonEventArgs e)
    {
        if (DataContext is ViewModels.FileListViewModel vm && !string.IsNullOrEmpty(vm.ProjectUrl))
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = vm.ProjectUrl,
                    UseShellExecute = true
                });
            }
            catch { }
        }
    }
}
