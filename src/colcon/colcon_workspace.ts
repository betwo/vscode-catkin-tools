import * as vscode from 'vscode';
import { getExtensionConfiguration } from '../common/configuration';
import { runColconCommand } from './colcon_command';


export async function isColconWorkspace(folder: vscode.WorkspaceFolder) {
  const colcon_enabled = getExtensionConfiguration('colconSupportEnabled', false);
  if(!colcon_enabled) {
    return false;
  }
  try {
    let packages = await runColconCommand(["list", "-n"], folder.uri.fsPath);
    return packages.stdout.length > 0;
  } catch (error) {
    return false;
  }
}
