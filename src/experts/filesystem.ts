/**
 * YamX - Filesystem Expert
 * Handles all file operations with workflow: validate → permission check → backup → execute → verify.
 */

import { BaseExpert, ExpertResult, ExecutionContext, WorkflowDefinition } from './base.js';
import { expertRegistry } from './registry.js';
import {
  readFile, readFiles, writeFile, writeFiles, editFile,
  listFiles, searchFiles, deleteFile,
} from '../tools/filesystem.js';
import {
  multiEdit, copyFile, moveFile, fileInfo, grepSearch, treeTool, patchFile, findReferences,
} from '../tools/advanced.js';

export class FilesystemExpert extends BaseExpert {
  readonly name = 'filesystem';
  readonly domain = 'files';
  readonly capabilities = [
    'read files with line numbers and metadata',
    'write and create files atomically',
    'surgically edit files with exact text replacement',
    'search files with regex patterns',
    'list directories with glob support',
    'delete, move, and copy files',
    'show directory trees',
    'find symbol references across files',
    'apply patch files',
  ];

  async canHandle(intent: string): Promise<boolean> {
    return intent.startsWith('read_') || intent.startsWith('write_') || intent.startsWith('edit_')
      || intent.startsWith('search_') || intent.startsWith('list_') || intent.startsWith('delete_')
      || intent.startsWith('move_') || intent.startsWith('copy_') || intent === 'patch_file'
      || intent === 'directory_tree' || intent === 'grep_search' || intent === 'find_references'
      || intent === 'file_info' || intent === 'multi_edit';
  }

  async execute(intent: string, params: Record<string, any>, context: ExecutionContext): Promise<ExpertResult> {
    try {
      switch (intent) {
        case 'read_file':
          return this.formatSuccess(await readFile.execute(params));
        case 'read_files':
          return this.formatSuccess(await readFiles.execute(params));
        case 'write_file':
          return this.formatSuccess(await writeFile.execute(params));
        case 'write_files':
          return this.formatSuccess(await writeFiles.execute(params));
        case 'edit_file':
          return this.formatSuccess(await editFile.execute(params));
        case 'multi_edit':
          return this.formatSuccess(await multiEdit.execute(params));
        case 'search_files':
          return this.formatSuccess(await searchFiles.execute(params));
        case 'list_files':
          return this.formatSuccess(await listFiles.execute(params));
        case 'delete_file':
          return this.formatSuccess(await deleteFile.execute(params));
        case 'copy_file':
          return this.formatSuccess(await copyFile.execute(params));
        case 'move_file':
          return this.formatSuccess(await moveFile.execute(params));
        case 'file_info':
          return this.formatSuccess(await fileInfo.execute(params));
        case 'grep_search':
          return this.formatSuccess(await grepSearch.execute(params));
        case 'directory_tree':
          return this.formatSuccess(await treeTool.execute(params));
        case 'patch_file':
          return this.formatSuccess(await patchFile.execute(params));
        case 'find_references':
          return this.formatSuccess(await findReferences.execute(params));
        default:
          return this.formatError(`Unknown filesystem intent: ${intent}`);
      }
    } catch (err: any) {
      return this.formatError(`Filesystem error: ${err?.message || err}`);
    }
  }

  getWorkflow(): WorkflowDefinition {
    return {
      name: 'filesystem',
      steps: [
        { name: 'validate_paths', description: 'Ensure paths are inside project and exist', required: true },
        { name: 'check_permissions', description: 'Verify read/write permissions', required: true },
        { name: 'backup_if_destructive', description: 'Create backup before destructive ops', required: false },
        { name: 'execute', description: 'Perform the file operation', required: true },
        { name: 'verify', description: 'Confirm the operation succeeded', required: true },
      ],
    };
  }
}

expertRegistry.register(new FilesystemExpert());
