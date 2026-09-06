import * as vscode from 'vscode';
import { sanitizeReadingWidth } from './readingWidthValue';

export { isPresetWidth, sanitizeReadingWidth } from './readingWidthValue';

/** Resolves the `repodoc.readingWidth` setting to a safe token. */
export function resolveReadingWidth(): string {
  return sanitizeReadingWidth(
    vscode.workspace.getConfiguration('repodoc').get<string>('readingWidth'),
  );
}
