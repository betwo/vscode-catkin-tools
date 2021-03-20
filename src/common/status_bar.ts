import * as vscode from 'vscode';


export let status_bar_status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);


export let status_bar_profile = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
export let status_bar_profile_prefix = 'profile: ';
status_bar_profile.text = status_bar_profile_prefix;
status_bar_profile.command = 'extension.b2.catkin_tools.switch_profile';
status_bar_profile.tooltip = 'Change the workspace profile';
status_bar_profile.show();

export let status_bar_prefix = '';
status_bar_status.text = status_bar_prefix + 'initialized';
status_bar_status.command = 'extension.b2.catkin_tools.reload_workspaces';
status_bar_status.tooltip = 'Reload the compile_commands.json data bases';
status_bar_status.show();
