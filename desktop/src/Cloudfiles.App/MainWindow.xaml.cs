using System.Windows;
using Cloudfiles.App.ViewModels;
using Cloudfiles.Core.Services;

namespace Cloudfiles.App;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        _ = AppContext.Instance.InitializeAsync();
        DataContext = new MainViewModel();
    }
}
