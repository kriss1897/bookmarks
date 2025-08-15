/**
 * @deprecated Use TreeBuilder with IndexedDBOperationStorage instead.
 * This file provides backward compatibility for existing code.
 * 
 * Migration example:
 * Before: new PersistentTreeOpsBuilder({ ... })
 * After: createPersistentTreeBuilder({ ... })
 */

import { TreeBuilder, type TreeBuilderConfig } from './treeBuilder';
import { IndexedDBOperationStorage } from './storage';
import { databaseService } from '../workers/database';

/**
 * @deprecated Use TreeBuilder with IndexedDBOperationStorage instead
 */
export class PersistentTreeOpsBuilder extends TreeBuilder {
  constructor(init?: { 
    tree?: ReturnType<import('./bookmarksTree').BookmarkTree["serialize"]>; 
    log?: import('./treeBuilder').OperationEnvelope[]; 
    rootNode?: { id?: string; title?: string; isOpen?: boolean };
    autoLoad?: boolean;
  }) {
    console.warn('[PersistentTreeOpsBuilder] This class is deprecated. Use createPersistentTreeBuilder() instead.');
    
    const config: TreeBuilderConfig = {
      tree: init?.tree,
      log: init?.log,
      rootNode: init?.rootNode,
      storage: new IndexedDBOperationStorage(databaseService),
      autoLoad: init?.autoLoad
    };

    super(config);
  }

  /**
   * @deprecated This method is handled automatically by TreeBuilder.initialize()
   */
  async initializeFromStorage(): Promise<void> {
    console.warn('[PersistentTreeOpsBuilder] initializeFromStorage() is deprecated. Initialization is handled automatically.');
    return this.initialize();
  }
}
