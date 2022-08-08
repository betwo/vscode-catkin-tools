import * as vscode from 'vscode';
import * as fs from 'fs';

import { WorkspaceTestInstance, WorkspaceTestInterface } from 'vscode-catkin-tools-api';
import { logger } from '../logging';
import { TestHandlerComposite } from './test_handler_composite';


export class TestHandlerCollection extends TestHandlerComposite {
    constructor(
        test_instance: WorkspaceTestInstance,
        child_collections: TestHandlerCollection[]
    ) {
        super(test_instance, child_collections);
    }

    dispose(): void { }

    async loadTests(build_dir: fs.PathLike, devel_dir: fs.PathLike, query_for_cases: boolean): Promise<void> { }

    test(): WorkspaceTestInterface {
        return this.test_instance.test;
    }

    instance(): WorkspaceTestInstance {
        return this.test_instance;
    }

    item(): vscode.TestItem {
        return this.test_instance.item;
    }

    createChildHandler(item: vscode.TestItem): TestHandlerCollection {
        let child = new TestHandlerCollection({ item: item, test: undefined, parameters: {} }, []);
        this.children.push(child);
        return child;
    }

    getChildHandler(item: vscode.TestItem): TestHandlerCollection {
        for (const child of this.children) {
            if (child.item().id === item.id) {
                return child as TestHandlerCollection;
            }
        }
        throw new Error('Child does not exist');
    }
}
