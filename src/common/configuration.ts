import * as vscode from 'vscode';

export function getExtensionConfiguration<ValueType>(key: string, def_value: ValueType = undefined): ValueType {
    return vscode.workspace.getConfiguration('catkin_tools').get(key, def_value);
}
