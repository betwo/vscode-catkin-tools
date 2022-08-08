import * as vscode from 'vscode';
import { logger } from '../../../common/logging';

export class NoninteractiveTestRun implements vscode.TestRun {
  name: string = "headless";
  token: vscode.CancellationToken;
  isPersisted: boolean;

  items_enqueued: vscode.TestItem[] = [];
  items_started: vscode.TestItem[] = [];
  items_skipped: vscode.TestItem[] = [];
  items_failed: vscode.TestItem[] = [];
  items_errored: vscode.TestItem[] = [];
  items_passed: vscode.TestItem[] = [];

  enqueued(test: vscode.TestItem): void {
    logger.warn("enqueued:", test);
    this.items_enqueued.push(test);
  }
  started(test: vscode.TestItem): void {
    logger.warn("started:", test);
    this.items_started.push(test);
  }
  skipped(test: vscode.TestItem): void {
    logger.warn("skipped:", test);
    this.items_skipped.push(test);
  }
  failed(test: vscode.TestItem, message: vscode.TestMessage | readonly vscode.TestMessage[], duration?: number): void {
    logger.error(message);
    logger.error("failed:", test);
    this.items_failed.push(test);
  }
  errored(test: vscode.TestItem, message: vscode.TestMessage | readonly vscode.TestMessage[], duration?: number): void {
    logger.error(message);
    logger.error("errored:", test);
    this.items_errored.push(test);
  }
  passed(test: vscode.TestItem, duration?: number): void {
    logger.warn("passed:", test);
    this.items_passed.push(test);
  }
  appendOutput(output: string): void {
  }
  end(): void {
  }
}
