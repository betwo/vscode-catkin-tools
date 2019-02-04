
import * as vscode from 'vscode';
import * as glob from 'glob';
import * as jsonfile from 'jsonfile';
import * as md5 from 'md5';

// function for_each_compile_command(callback: (file: string) => void) {
//   let ws = vscode.workspace.rootPath;
//   let expr = ws + '/build*/**/compile_commands.json';
//   let _ = new glob.Glob(expr, {mark: true}, (er, matches) => {
//     if (er) {
//       vscode.window.showErrorMessage(er.message);
//       return;
//     }
//     for (let file of matches) {
//       callback(file);
//     }
//   });
// };

export function initialize() {
  vscode.window.setStatusBarMessage('Initializing catkin workspace');
  // for_each_compile_command((file) => {
  //     console.log('Found', file);
  // });
  vscode.tasks.onDidEndTask((event) => {
    reload_compile_commands();
  });
};

let last_hash = null

export function reload_compile_commands() {
  let ws = vscode.workspace.rootPath;
  let expr = ws + '/build*/**/compile_commands.json';
  console.log('searching compile commands in', expr);

  const mg = new glob.Glob(expr, {mark: true}, (er, matches) => {
    if (er) {
      vscode.window.showErrorMessage(er.message);
      return;
    }
    let db = Array();
    for (let file of matches) {
      console.log('Reading', file);
      let db_part = jsonfile.readFileSync(file);
      db = db.concat(db_part);
    }

    let db_file = ws + '/compile_commands.json'
    jsonfile.writeFile(db_file, db)
        .then(res => {
          let hash = md5(db);
          console.log("Last hash: :", last_hash)
          console.log("Current hash: :", hash)
          if(last_hash != hash) {
            last_hash = hash;
            console.log("Change in compile commands detected, resetting the database");
            vscode.window.showInformationMessage('Regenerated ' + db_file);
            vscode.commands.executeCommand("C_Cpp.ResetDatabase")
          }
        })
        .catch(error => vscode.window.showErrorMessage)
  });
  console.log(mg);
}