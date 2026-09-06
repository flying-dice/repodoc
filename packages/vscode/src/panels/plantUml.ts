import * as vscode from 'vscode';

/** The configured PlantUML server URL ('' disables PlantUML rendering). */
export function plantUmlServer(): string {
  return vscode.workspace.getConfiguration('repodoc').get<string>('plantUmlServer') ?? '';
}
