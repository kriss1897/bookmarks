# TreeBuilder Refactoring Migration Guide

This guide explains how to migrate from the old `TreeOpsBuilder` and `PersistentTreeOpsBuilder` classes to the new unified `TreeBuilder` with abstract storage.

## Overview of Changes

### Before (Old Architecture)
- `TreeOpsBuilder`: In-memory operations only
- `PersistentTreeOpsBuilder`: Extended TreeOpsBuilder with IndexedDB persistence
- Storage logic was tightly coupled to the builder classes

### After (New Architecture)
- `TreeBuilder`: Unified class that handles all operations
- `OperationStorage`: Abstract storage interface
- `MemoryOperationStorage`: In-memory implementation
- `IndexedDBOperationStorage`: IndexedDB implementation
- Storage logic is decoupled and pluggable

## Migration Examples

### 1. Basic In-Memory Usage

**Before:**
```typescript
import { TreeOpsBuilder } from './lib/treeOps';

const builder = new TreeOpsBuilder({
  rootNode: { title: 'My Bookmarks', id: 'root' }
});
```

**After:**
```typescript
import { createMemoryTreeBuilder } from './lib/treeBuilderFactory';

const builder = createMemoryTreeBuilder({
  rootNode: { title: 'My Bookmarks', id: 'root' },
  autoLoad: false // Since we're not using persistence
});
```

### 2. Persistent Usage with IndexedDB

**Before:**
```typescript
import { PersistentTreeOpsBuilder } from './lib/persistentTreeOps';

const builder = new PersistentTreeOpsBuilder({
  rootNode: { title: 'My Bookmarks', id: 'root' }
});

// Wait for initialization
await builder.waitForInitialization();
```

**After:**
```typescript
import { createPersistentTreeBuilder } from './lib/treeBuilderFactory';

const builder = createPersistentTreeBuilder({
  rootNode: { title: 'My Bookmarks', id: 'root' }
});

// Wait for initialization (auto-loads by default)
await builder.waitForInitialization();
```

### 3. Custom Storage Implementation

**After (New Capability):**
```typescript
import { TreeBuilder, OperationStorage } from './lib/treeBuilderFactory';

class LocalStorageOperationStorage extends OperationStorage {
  async persistOperation(env: OperationEnvelope): Promise<void> {
    const ops = await this.loadOperations();
    ops.push(env);
    localStorage.setItem('tree-operations', JSON.stringify(ops));
  }

  async loadOperations(): Promise<OperationEnvelope[]> {
    const stored = localStorage.getItem('tree-operations');
    return stored ? JSON.parse(stored) : [];
  }

  async clearOperations(): Promise<void> {
    localStorage.removeItem('tree-operations');
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}

const builder = new TreeBuilder({
  storage: new LocalStorageOperationStorage(),
  rootNode: { title: 'My Bookmarks', id: 'root' }
});
```

## API Changes

### Constructor Options

**Before (TreeOpsBuilder):**
```typescript
new TreeOpsBuilder({
  tree?: SerializedTree,
  log?: OperationEnvelope[],
  rootNode?: { id?: string; title?: string; isOpen?: boolean }
})
```

**Before (PersistentTreeOpsBuilder):**
```typescript
new PersistentTreeOpsBuilder({
  tree?: SerializedTree,
  log?: OperationEnvelope[],
  rootNode?: { id?: string; title?: string; isOpen?: boolean },
  autoLoad?: boolean
})
```

**After (TreeBuilder):**
```typescript
new TreeBuilder({
  tree?: SerializedTree,
  log?: OperationEnvelope[],
  rootNode?: { id?: string; title?: string; isOpen?: boolean },
  storage?: OperationStorage,
  autoLoad?: boolean
})
```

### Method Changes

All operation methods remain the same:
- `createFolder()`, `createBookmark()`, `moveNode()`, etc.
- `dispatch()`, `apply()`, `replay()`
- `waitForInitialization()`

**New methods:**
- `getStorage()`: Get the current storage implementation
- `clearPersistedOperations()`: Clear all stored operations

## Breaking Changes

1. **Import paths changed:**
   - `TreeOpsBuilder` is now `TreeBuilder`
   - `PersistentTreeOpsBuilder` is replaced by `TreeBuilder` with `IndexedDBOperationStorage`

2. **Constructor signature:**
   - Storage is now configurable via the `storage` option
   - Default behavior uses `MemoryOperationStorage`

3. **Initialization:**
   - `autoLoad` now defaults to `true` when using persistent storage
   - When `autoLoad` is true, you must call `waitForInitialization()` before using the builder

## Recommended Migration Steps

1. **Update imports:**
   ```typescript
   // Old
   import { TreeOpsBuilder } from './lib/treeOps';
   import { PersistentTreeOpsBuilder } from './lib/persistentTreeOps';
   
   // New
   import { createMemoryTreeBuilder, createPersistentTreeBuilder } from './lib/treeBuilderFactory';
   ```

2. **Replace class instantiation:**
   - Use factory functions for common cases
   - Use `TreeBuilder` constructor for custom storage

3. **Handle initialization:**
   - Ensure you await `waitForInitialization()` when using persistent storage
   - Consider the `autoLoad` option for your use case

4. **Test thoroughly:**
   - Verify that existing operations still work
   - Test persistence behavior if applicable
   - Ensure proper error handling

## Benefits of New Architecture

1. **Separation of Concerns:** Storage logic is separate from tree operations
2. **Testability:** Easy to mock storage for testing
3. **Flexibility:** Can implement custom storage backends (localStorage, remote APIs, etc.)
4. **Type Safety:** Better TypeScript support with clearer interfaces
5. **Maintainability:** Single class to maintain instead of inheritance hierarchy
