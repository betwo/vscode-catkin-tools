import * as vscode from 'vscode';
import { logger } from './logging';


let status_bar_status: vscode.StatusBarItem = undefined;
let status_bar_profile: vscode.StatusBarItem = undefined;

const status_bar_prefix = '';
const status_bar_profile_prefix = 'catkin profile: ';

function getStatusWidget(): vscode.StatusBarItem {
    if (status_bar_status === undefined) {
        status_bar_status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

        status_bar_status.text = status_bar_prefix + 'initialized';
        status_bar_status.command = 'extension.b2.catkin_tools.reload_workspaces';
        status_bar_status.tooltip = 'Reload the compile_commands.json data bases';
        status_bar_status.show();
    }

    return status_bar_status;
}

function getProfileWidget(): vscode.StatusBarItem {
    if (status_bar_profile === undefined) {
        status_bar_profile = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        status_bar_profile.text = status_bar_profile_prefix;
        status_bar_profile.command = 'extension.b2.catkin_tools.switch_profile';
        status_bar_profile.tooltip = 'Change the workspace profile';
        status_bar_profile.show();
    }

    return status_bar_profile;
}

export function setStatusText(text: String) {
    let status = getStatusWidget();
    status.text = status_bar_prefix + text;
    logger.info(status.text);
}

export function setProfileText(text: String) {
    setStatusText("Initializing profiles");

    let profile = getProfileWidget();
    profile.text = status_bar_profile_prefix + text;
}