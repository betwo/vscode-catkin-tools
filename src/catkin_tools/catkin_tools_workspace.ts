import * as vscode from 'vscode';
import { runCatkinCommand } from './catkin_command';


export async function isCatkinWorkspace(folder: vscode.WorkspaceFolder) {
  try {
    await runCatkinCommand(["locate", "-s"], folder.uri.fsPath, 2);
    return true;
  } catch (error) {
    return false;
  }
}
