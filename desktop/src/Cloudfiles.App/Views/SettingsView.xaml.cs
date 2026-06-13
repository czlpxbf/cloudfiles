using System.Windows.Controls;

namespace Cloudfiles.App.Views;

public partial class SettingsView : System.Windows.Controls.UserControl
{
    public SettingsView()
    {
        InitializeComponent();
    }

    private void ApiTokenBox_PasswordChanged(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is ViewModels.SettingsViewModel vm)
        {
            vm.ApiToken = ApiTokenBox.Password;
        }
    }
}
