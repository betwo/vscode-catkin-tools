import * as fs from 'fs';

import { runCommand, ShellOutput } from '../common/shell_command';


export async function runColconCommand(args: string[], cwd: fs.PathLike): Promise<ShellOutput> {
    try {
        return await runCommand("colcon", args, [], cwd);
    } catch (error) {
        console.error(error);
        throw error;
    }
}