import * as vscode from 'vscode';

export function getExtensionConfiguration(key: string, def_value: any = undefined) {
    return vscode.workspace.getConfiguration('catkin_tools').get(key, def_value);
}
