
import * as vscode from 'vscode';
import { CppToolsApi, getCppToolsApi, Version } from 'vscode-cpptools';

import { CatkinWorkspace } from './catkin_workspace';
import { CatkinToolsProvider } from './cpp_configuration_provider';
import { CatkinPackageCompleterXml } from './package_xml_tools';

let catkin_workspace: CatkinWorkspace = null;
let provider: CatkinToolsProvider = null;

export let status_bar_item =
  vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

export let status_bar_prefix = 'catkin workspace: ';
status_bar_item.text = status_bar_prefix + 'initialized';
status_bar_item.command = 'extension.b2.catkin_tools.reload_compile_commands';
status_bar_item.tooltip = 'Reload the compile_commands.json data bases';
status_bar_item.show();

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
  return getCppToolsApi(Version.v2).then((api: CppToolsApi | undefined) => {
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
    return catkin_workspace.reload();
  });
}

export function reloadCompileCommand() {
  status_bar_item.text = status_bar_prefix + 'reloading';

  provider.loadDataBases();

  status_bar_item.text = status_bar_prefix + 'reload complete';
}
