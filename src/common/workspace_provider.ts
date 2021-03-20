import * as vscode from 'vscode';
import * as fs from 'fs';

export interface WorkspaceProvider {
    getWorkspaceType(): string;

    getCodeWorkspace(): vscode.WorkspaceFolder;

    getRootPath(): Promise<fs.PathLike>;

    getSrcDir(): Promise<string>;
    getBuildDir(): Promise<string>;
    getDevelDir(): Promise<string>;
    getInstallDir(): Promise<string>;

    getCmakeArguments(): Promise<string>;

    checkProfile(): Promise<void>;
    getProfiles(): Promise<string[]>;
    getActiveProfile(): Promise<string>;
    switchProfile(profile: string): Promise<boolean>;

    getBuildTask(): Promise<vscode.Task>;

    reload(): any;
    enableCompileCommandsGeneration(): any;

    makePackageBuildCommand(package_name: string): string;
}