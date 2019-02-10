
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as glob from 'glob';
import * as jsonfile from 'jsonfile';
import * as md5 from 'md5';
import * as vscode from 'vscode';

// let compile_commands:Map<string, string> = {};
let compile_commands: Map<string, boolean> = new Map<string, boolean>();

let last_hash_file = vscode.workspace.rootPath + '/.vscode/.last_compile_commands_hash';
let last_hash = null;
if(fs.existsSync(last_hash_file)) {
  last_hash = fs.readFileSync(last_hash_file, 'utf8');
}
let warned = false;
let build_dir = null;

export function build_current_package() {
  vscode.window.showErrorMessage('Build');
}

export function watch_compile_commands() {
  let ws = vscode.workspace.rootPath;
  child_process.exec('catkin locate -b', {'cwd': ws}, (err, stdout, stderr) => {
    if (err) {
      vscode.window.showErrorMessage(stderr);
      return;
    }

    console.log('Build dir: ' + stdout);
    build_dir = stdout.split('\n')[0];

    if (build_dir === null) {
      vscode.window.showErrorMessage('Cannot determine build directory');
      return;
    }

    let expr = build_dir + '/**/compile_commands.json';
    console.log('searching compile commands in', expr);

    const mg = new glob.Glob(expr, {mark: true}, (er, matches) => {
      if (er) {
        vscode.window.showErrorMessage(er.message);
        return;
      }
      let new_file = false;
      for (let file of matches) {
        if (!compile_commands.has(file)) {
          console.log('watching file', file);
          fs.watch(file, {encoding: 'buffer'}, (eventType, filename) => {
            if (filename) {
              console.log(filename, 'changed');
              reload_compile_commands();
            }
          });
          new_file = true;
          compile_commands.set(file, true);
        }
      }
      if (new_file) {
        console.log('new compile commands found');
        reload_compile_commands();
      }
      if (compile_commands.size === 0 && !warned) {
        warned = true;
        vscode.window.showWarningMessage(
            'No compile_commands.json file found in the workspace.\nMake sure that CMAKE_EXPORT_COMPILE_COMMANDS is on.');
      }
    });
  });
}


export function reload_compile_commands() {
  let ws = vscode.workspace.rootPath;
  let expr = build_dir + '/**/compile_commands.json';
  console.log('searching compile commands in', expr);

  const mg = new glob.Glob(expr, {mark: true}, (er, matches) => {
    if (er) {
      vscode.window.showErrorMessage(er.message);
      return;
    }
    let db = Array();
    let i = 1;
    for (let file of matches) {
      console.log('Reading', file);
      vscode.window.setStatusBarMessage(
          'Reading ' + file + ' (' + i + ' / ' + matches.length + ')');
      let db_part = jsonfile.readFileSync(file);
      db = db.concat(db_part);
      i++;
    }

    let db_file = ws + '/compile_commands.json';
    vscode.window.setStatusBarMessage('Writing combined ' + db_file);

    jsonfile.writeFile(db_file, db)
        .then(res => {
          vscode.window.setStatusBarMessage('Checking for differences');
          let hash = md5(db);
          console.log('Last hash: :', last_hash);
          console.log('Current hash: :', hash);
          if (last_hash !== hash) {
            fs.writeFileSync(last_hash_file, hash, 'utf8');
            last_hash = hash;
            console.log(
                'Change in compile commands detected, resetting the database');
            vscode.commands.executeCommand('C_Cpp.ResetDatabase');
            vscode.window.setStatusBarMessage(
                'Database ' + db_file + ' updated');
          } else {
            vscode.window.setStatusBarMessage('Nothing to do');
          }
        })
        .catch(error => vscode.window.showErrorMessage);
  });
  console.log(mg);
}