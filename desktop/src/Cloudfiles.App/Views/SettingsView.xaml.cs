using System.Windows.Controls;

namespace Cloudfiles.App.Views;

public partial class SettingsView : UserControl
{
    private bool _isSettingPassword;

    public SettingsView()
    {
        InitializeComponent();
    }

    private void SettingsView_Loaded(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is ViewModels.SettingsViewModel vm && !string.IsNullOrEmpty(vm.ApiToken) && string.IsNullOrEmpty(ApiTokenBox.Password))
        {
            _isSettingPassword = true;
            ApiTokenBox.Password = vm.ApiToken;
            _isSettingPassword = false;
        }
    }

    private void ApiTokenBox_PasswordChanged(object sender, System.Windows.RoutedEventArgs e)
    {
        if (_isSettingPassword)
            return;

        if (DataContext is ViewModels.SettingsViewModel vm)
        {
            if (string.IsNullOrEmpty(ApiTokenBox.Password) && !string.IsNullOrEmpty(vm.ApiToken))
                return;

            vm.ApiToken = ApiTokenBox.Password;
        }
    }
}
