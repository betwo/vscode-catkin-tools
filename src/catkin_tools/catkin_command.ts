import * as fs from 'fs';

import { runCommand, ShellOutput } from '../common/shell_command';


export async function runCatkinCommand(args: string[], cwd: fs.PathLike): Promise<ShellOutput> {
    try {
        return await runCommand("catkin", args, [], cwd);
    } catch (error) {
        console.error(error);
        throw error;
    }
}