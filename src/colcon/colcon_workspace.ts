import * as vscode from 'vscode';
import { runColconCommand } from './colcon_command';


export async function isColconWorkspace(folder: vscode.WorkspaceFolder) {
  try {
    let packages = await runColconCommand(["list", "-n"], folder.uri.fsPath);
    return packages.stdout.length > 0;
  } catch (error) {
    return false;
  }
}
