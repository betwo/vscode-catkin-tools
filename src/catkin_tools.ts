
import * as vscode from 'vscode';

import { CatkinWorkspace } from './catkin_workspace';
import { runCatkinCommand } from './catkin_command';
import { CatkinPackageCompleterXml } from './package_xml_tools';
import { CatkinToolsProvider } from './catkin_tools_provider';

let provider: CatkinToolsProvider = undefined;

export let status_bar_status =
  vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);


export let status_bar_profile =
  vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
export let status_bar_profile_prefix = 'catkin profile: ';
status_bar_profile.text = status_bar_profile_prefix;
status_bar_profile.command = 'extension.b2.catkin_tools.switch_profile';
status_bar_profile.tooltip = 'Change the catkin_tools profile';
status_bar_profile.show();

export let status_bar_prefix = '';
status_bar_status.text = status_bar_prefix + 'initialized';
status_bar_status.command = 'extension.b2.catkin_tools.reload_compile_commands';
status_bar_status.tooltip = 'Reload the compile_commands.json data bases';
status_bar_status.show();

// Public functions

export function setProvider(p: CatkinToolsProvider) {
  provider = p;
}
export function getProvider(): CatkinToolsProvider {
  return provider;
}

export async function initialize(
  context: vscode.ExtensionContext, root: vscode.WorkspaceFolder, outputChannel: vscode.OutputChannel): Promise<CatkinWorkspace> {
  let config = vscode.workspace.getConfiguration('clang');
  if (config['completion'] !== undefined && config['completion']['enable']) {
    let ack: string = 'Ok';
    let msg =
      'You seem to have clang.autocomplete enabled. This interferes with catkin-tools auto completion.\n' +
      'To disable it, change the setting "clang.completion.enable" to false.';
    vscode.window.showInformationMessage(msg, ack);
  }

  let catkin_workspace = new CatkinWorkspace(root, outputChannel);
  const package_xml_provider = vscode.languages.registerCompletionItemProvider(
    { pattern: '**/package.xml' },
    new CatkinPackageCompleterXml(catkin_workspace));
  context.subscriptions.push(package_xml_provider);
  return catkin_workspace;
}

export async function reloadAllWorkspaces() {
  status_bar_status.text = status_bar_prefix + 'reloading';

  let workers = [];
  for (const [_, workspace] of provider.workspaces) {
    workers.push(workspace.reload());
  }
  let reloaded_spaces: CatkinWorkspace[] = await Promise.all(workers);

  if (reloaded_spaces.every(entry => entry !== undefined)) {
    status_bar_status.text = status_bar_prefix + 'reload complete';
  } else {
    status_bar_status.text = status_bar_prefix + 'reload failed';
  }
}

export async function isCatkinWorkspace(folder: vscode.WorkspaceFolder) {
  try {
    await runCatkinCommand(["locate", "-s"], folder.uri.fsPath);
    return true;
  } catch (error) {
    return false;
  }
}

export async function selectWorkspace(): Promise<CatkinWorkspace> {
  const workspace_list = [];
  for (const [_, workspace] of provider.workspaces) {
    workspace_list.push(<vscode.QuickPickItem>{
      label: await workspace.getName(),
      description: await workspace.getRootPath()
    });
  }
  return await vscode.window.showQuickPick(workspace_list);
}

export async function switchProfile() {
  let workspace: CatkinWorkspace;
  if (vscode.window.activeTextEditor) {
    let vscode_workspace = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    workspace = provider.getWorkspace(vscode_workspace);
  }

  if (workspace === undefined) {
    workspace = await selectWorkspace();
  }

  const active_profile = await workspace.getActiveProfile();
  const profiles = await workspace.getProfiles();

  const profile_list = [];
  for (const profile of profiles) {
    profile_list.push(<vscode.QuickPickItem>{
      label: profile,
      description: profile === active_profile ? "(active)" : "",
      picked: profile === active_profile
    });
  }
  const selection = await vscode.window.showQuickPick(profile_list);

  if (selection !== undefined) {
    workspace.switchProfile(selection.label);
  }
}
