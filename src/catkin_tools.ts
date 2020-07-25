
import * as vscode from 'vscode';
import { CppToolsApi, getCppToolsApi, Version } from 'vscode-cpptools';

import { CatkinWorkspace } from './catkin_workspace';
import { CatkinToolsProvider } from './cpp_configuration_provider';
import { CatkinPackageCompleterXml } from './package_xml_tools';

let catkin_workspace: CatkinWorkspace = null;
let provider: CatkinToolsProvider = null;

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

export async function initialize(
  context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<CatkinWorkspace> {
  let config = vscode.workspace.getConfiguration('clang');
  if (config['completion'] !== undefined && config['completion']['enable']) {
    let ack: string = 'Ok';
    let msg =
      'You seem to have clang.autocomplete enabled. This interferes with catkin-tools auto completion.\n' +
      'To disable it, change the setting "clang.completion.enable" to false.';
    vscode.window.showInformationMessage(msg, ack);
  }

  return registerProviders(context, outputChannel);
}

export async function registerProviders(
  context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): Promise<CatkinWorkspace> {
  catkin_workspace =
    new CatkinWorkspace(vscode.workspace.workspaceFolders[0], outputChannel);
  let api: CppToolsApi = await getCppToolsApi(Version.v2);
  if (api) {
    if (api.notifyReady) {
      provider = new CatkinToolsProvider(catkin_workspace, api);
      // Inform cpptools that a custom config provider will be able to service
      // the current workspace.

      api.registerCustomConfigurationProvider(provider);
      api.notifyReady(provider);
      provider.startListening();

    } else {
      vscode.window.showInformationMessage(
        'Catkin tools only supports C/C++ API 2.0 or later.');
    }
  }
  const package_xml_provider = vscode.languages.registerCompletionItemProvider(
    { pattern: '**/package.xml' },
    new CatkinPackageCompleterXml(catkin_workspace));

  context.subscriptions.push(package_xml_provider);
  return catkin_workspace;
}

export function reloadCompileCommand() {
  status_bar_status.text = status_bar_prefix + 'reloading';

  provider.loadDataBases();

  status_bar_status.text = status_bar_prefix + 'reload complete';
}


export async function switchProfile() {
  const [active_profile, profiles] = await provider.workspace.getProfile();

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
    provider.workspace.switchProfile(selection.label);
  }
}
