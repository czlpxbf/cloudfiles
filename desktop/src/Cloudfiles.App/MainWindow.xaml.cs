using System.Windows;
using Cloudfiles.App.ViewModels;

namespace Cloudfiles.App;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel();
    }
}
