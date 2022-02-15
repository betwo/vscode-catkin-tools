import * as fs from 'fs';
import * as child_process from 'child_process';

import { runCommand, ShellOutput } from '../common/shell_command';


export async function runCatkinCommand(
    args: string[],
    cwd: fs.PathLike,
    additional_env_vars?: [string, string][],
    callback?: (process: child_process.ChildProcess) => any,
    out?: (lines: string) => void,
    error?: (lines: string) => void
): Promise<ShellOutput> {
    try {
        return await runCommand("catkin", args, [], cwd, additional_env_vars, callback, out, error);
    } catch (error) {
        console.error(error);
        throw error;
    }
}